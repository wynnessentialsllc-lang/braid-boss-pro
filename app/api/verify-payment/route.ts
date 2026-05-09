// Verify a Stripe Checkout Session and grant lifetime access.
//
// The /payment-success page POSTs here with { session_id } from the
// redirect URL. We retrieve the session directly from the Stripe REST
// API (no SDK to keep deploys lean), confirm:
//
//   - payment_status === "paid"
//   - client_reference_id matches the signed-in Supabase user
//
// then write profiles.lifetime_access = true via the Supabase service
// role (which bypasses the RLS lockdown set in the migration).
//
// No webhook needed for the MVP — this single round-trip is the only
// place lifetime_access ever gets set.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STRIPE_API = "https://api.stripe.com/v1";

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};

const fail = (status: number, message: string) =>
  NextResponse.json({ error: message }, { status });

export async function POST(req: Request) {
  let body: { session_id?: string; access_token?: string };
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid JSON body.");
  }

  const sessionId = body?.session_id?.trim();
  const accessToken = body?.access_token?.trim();
  if (!sessionId || !sessionId.startsWith("cs_")) {
    return fail(400, "Missing or malformed session_id.");
  }
  if (!accessToken) {
    return fail(401, "Missing access_token.");
  }

  let stripeSecret: string;
  let supabaseUrl: string;
  let serviceKey: string;
  try {
    stripeSecret = env("STRIPE_SECRET_KEY");
    supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      env("SUPABASE_URL");
    serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  } catch (e: any) {
    return fail(500, e?.message || "Server is not configured.");
  }

  // Identify the caller from the Supabase access token. We pass it
  // through a fresh client (anon key would also work; the service key
  // is fine here because we only use it to call auth.getUser).
  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } =
    await adminClient.auth.getUser(accessToken);
  if (userError || !userData?.user) {
    return fail(401, "Could not identify the signed-in user.");
  }
  const userId = userData.user.id;

  // Retrieve the Checkout Session from Stripe.
  const stripeRes = await fetch(
    `${STRIPE_API}/checkout/sessions/${encodeURIComponent(sessionId)}`,
    {
      headers: {
        Authorization: `Bearer ${stripeSecret}`,
        "Stripe-Version": "2024-06-20",
      },
      cache: "no-store",
    },
  );
  if (!stripeRes.ok) {
    const text = await stripeRes.text().catch(() => "");
    return fail(
      502,
      `Stripe rejected the lookup (${stripeRes.status}). ${text.slice(0, 200)}`,
    );
  }
  const session = (await stripeRes.json()) as {
    id?: string;
    payment_status?: string;
    status?: string;
    client_reference_id?: string | null;
  };

  if (session.payment_status !== "paid") {
    return fail(
      402,
      `Payment is not complete yet (status: ${session.payment_status || "unknown"}).`,
    );
  }
  if (session.client_reference_id && session.client_reference_id !== userId) {
    return fail(
      403,
      "This receipt belongs to a different account.",
    );
  }

  // Write the unlock. Upsert in case the profile row doesn't exist yet.
  // profiles keys on `id` (= auth.users.id), not `user_id`.
  const { error: writeError } = await adminClient
    .from("profiles")
    .upsert(
      {
        id: userId,
        lifetime_access: true,
        stripe_checkout_session_id: session.id ?? sessionId,
        upgraded_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
  if (writeError) {
    return fail(500, `Could not save the unlock: ${writeError.message}`);
  }

  return NextResponse.json({ ok: true, lifetime_access: true });
}
