// POST /api/membership/cancel
//
// Cancels a membership's Stripe subscription on the stylist's connected
// account. The client keeps whatever visits/credit they've already been
// granted (we never claw back the rolling package); they just aren't
// billed again.
//
// Auth: Supabase access_token in the body (same contract as
// /api/no-show-charge). The caller must own the membership.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STRIPE_API = "https://api.stripe.com/v1";
const STRIPE_VERSION = "2024-06-20";

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};
const fail = (status: number, message: string) =>
  NextResponse.json({ error: message }, { status });

export async function POST(req: Request) {
  let body: { access_token?: string; membership_id?: string };
  try { body = await req.json(); } catch { return fail(400, "Invalid JSON."); }

  const accessToken = body?.access_token?.trim();
  if (!accessToken) return fail(401, "Missing access_token.");
  const membershipId = String(body?.membership_id || "").trim();
  if (!membershipId) return fail(400, "Missing membership_id.");

  let stripeSecret: string;
  let supabaseUrl: string;
  let serviceKey: string;
  try {
    stripeSecret = env("STRIPE_SECRET_KEY");
    supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || env("SUPABASE_URL");
    serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  } catch (e: any) {
    return fail(500, e?.message || "Server is not configured.");
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await admin.auth.getUser(accessToken);
  if (userErr || !userData?.user) return fail(401, "Could not identify the signed-in user.");
  const userId = userData.user.id;

  // Load the membership, scoped to the signed-in stylist.
  const { data: m, error: mErr } = await admin
    .from("client_memberships")
    .select("id, status, stripe_subscription_id, stripe_connect_account_id")
    .eq("id", membershipId)
    .eq("user_id", userId)
    .maybeSingle();
  if (mErr) return fail(500, "Couldn't load the membership.");
  if (!m) return fail(404, "Membership not found.");
  if (m.status === "canceled") {
    return NextResponse.json({ ok: true, already: true });
  }

  const subId = m.stripe_subscription_id;
  const acctId = m.stripe_connect_account_id;
  if (!subId || !acctId) {
    // No live subscription on file — just mark it canceled locally.
    await admin.from("client_memberships")
      .update({ status: "canceled", canceled_at: new Date().toISOString() })
      .eq("id", m.id);
    return NextResponse.json({ ok: true, local: true });
  }

  // Cancel immediately on the connected account.
  try {
    const res = await fetch(`${STRIPE_API}/subscriptions/${subId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${stripeSecret}`,
        "Stripe-Version": STRIPE_VERSION,
        "Stripe-Account": acctId,
      },
      cache: "no-store",
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      // A subscription Stripe already considers gone is fine — treat as done.
      const code = (j as any)?.error?.code;
      if (res.status !== 404 && code !== "resource_missing") {
        return fail(502, (j as any)?.error?.message || "Stripe couldn't cancel the subscription.");
      }
    }
  } catch {
    return fail(502, "Couldn't reach Stripe. Please try again.");
  }

  // Optimistic local update; the customer.subscription.deleted webhook
  // confirms the same state.
  await admin.from("client_memberships")
    .update({ status: "canceled", canceled_at: new Date().toISOString() })
    .eq("id", m.id);

  return NextResponse.json({ ok: true });
}
