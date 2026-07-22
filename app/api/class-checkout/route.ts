// Create a Stripe Checkout Session for a class sign-up.
//
// Mirrors app/api/booking-deposit/checkout and app/api/product-checkout:
// a direct charge on the braider's Stripe Connect account (via the
// `Stripe-Account` header) with an optional PLATFORM_FEE_BPS
// application fee. The money lands in the braider's balance; the
// platform takes its basis-point cut.
//
// Flow:
//   1. Resolve the class via public_get_class (handle + class slug) —
//      this also returns the braider's connected acct + charges_enabled
//      and live seats_remaining.
//   2. Validate: published, priced, charges-enabled, seats available.
//   3. Mint a pending class_registration row (service role) with a
//      bearer access_token used by the confirmation page + email.
//   4. Create the Checkout Session AS the connected account.
//   5. Persist the session id on the registration; return { url }.
//
// The webhook (/api/class-checkout/webhook) flips the registration to
// 'paid' and emails the student their access details (location for
// in-person, meeting link for virtual) — those are NEVER exposed here.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STRIPE_API = "https://api.stripe.com/v1";
// A single checkout can register a small party — a student bringing a
// friend or two. Anything larger is almost certainly a fat-fingered or
// hostile request, so cap it.
const MAX_SEATS = 10;

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};
const fail = (status: number, message: string) =>
  NextResponse.json({ error: message }, { status });

const baseUrlOf = (req: Request): string => {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  try {
    return new URL(req.url).origin;
  } catch {
    return "";
  }
};

// URL-safe bearer token for the student's confirmation page. base64url
// of 24 random bytes → 32 chars, unguessable.
const genAccessToken = (): string => randomBytes(24).toString("base64url");

export async function POST(req: Request) {
  let body: {
    handle?: string;
    class_slug?: string;
    seats?: number;
    student_name?: string;
    student_email?: string;
  };
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid JSON body.");
  }

  const handle = (body?.handle || "").trim().replace(/^@/, "");
  const classSlug = (body?.class_slug || "").trim();
  if (!handle) return fail(400, "Missing stylist handle.");
  if (!classSlug) return fail(400, "Missing class.");

  const seats = (() => {
    const n = Math.floor(Number(body?.seats));
    if (!Number.isFinite(n) || n < 1) return 1;
    return Math.min(n, MAX_SEATS);
  })();

  const studentName = String(body?.student_name || "").replace(/[<>]/g, "").trim().slice(0, 120) || null;
  const studentEmail = (() => {
    const raw = String(body?.student_email || "").trim().slice(0, 254).toLowerCase();
    if (!raw) return null;
    return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(raw) ? raw : null;
  })();
  if (!studentEmail) return fail(400, "A valid email is required to sign up.");

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

  // Resolve the class via the public RPC (same resolver the sign-up
  // page uses), which also hands back the connected-account fields and
  // live seat availability.
  const { data: rows, error: classErr } = await admin.rpc("public_get_class", {
    slug_in: handle,
    class_slug_in: classSlug,
  });
  if (classErr) return fail(500, "Couldn't load the class.");
  const cls = Array.isArray(rows) ? rows[0] : rows;
  if (!cls) return fail(404, "That class isn't available.");

  const price = Number(cls.price);
  if (!Number.isFinite(price) || price <= 0) {
    return fail(400, "This class isn't set up for paid sign-up.");
  }
  const stylistUserId = cls.user_id ? String(cls.user_id) : null;
  const stylistAccountId = cls.stylist_account_id ? String(cls.stylist_account_id) : null;
  if (!stylistUserId) return fail(500, "Couldn't resolve the braider.");
  if (!stylistAccountId) return fail(409, "This braider hasn't connected Stripe yet.");
  if (!cls.stylist_charges_enabled) {
    return fail(409, "This braider's Stripe account isn't ready to take payments.");
  }

  // Seat availability. null = unlimited. A small race is possible
  // between two simultaneous buyers; capacity is a soft ceiling for v1
  // (paid seats never drive the count below zero at read time).
  const remaining = cls.seats_remaining;
  if (remaining != null && Number(remaining) < seats) {
    return fail(
      409,
      Number(remaining) <= 0
        ? "This class is full."
        : `Only ${remaining} seat${Number(remaining) === 1 ? "" : "s"} left.`,
    );
  }

  const currency = String(cls.currency || "usd").toLowerCase();
  const unitCents = Math.round(price * 100);
  const totalCents = unitCents * seats;

  const feeBps = (() => {
    const raw = Number(process.env.PLATFORM_FEE_BPS || 0);
    if (!Number.isFinite(raw) || raw < 0 || raw > 10_000) return 0;
    return Math.floor(raw);
  })();
  const applicationFeeCents = feeBps > 0 ? Math.floor((totalCents * feeBps) / 10_000) : 0;

  const accessToken = genAccessToken();

  // Reserve the seat(s) atomically BEFORE Stripe. create_class_registration
  // locks the class row, clears stale holds, re-checks capacity, and
  // inserts the pending registration in one transaction — so two
  // simultaneous buyers can never oversell. It returns null when the
  // class would go over capacity. The pending row holds the seat during
  // checkout and is released automatically if payment never completes.
  const { data: newRegId, error: rpcErr } = await admin.rpc("create_class_registration", {
    class_id_in: cls.id,
    user_id_in: stylistUserId,
    seats_in: seats,
    amount_total_in: totalCents / 100,
    application_fee_in: applicationFeeCents > 0 ? applicationFeeCents / 100 : null,
    currency_in: currency,
    student_name_in: studentName,
    student_email_in: studentEmail,
    access_token_in: accessToken,
    stripe_account_id_in: stylistAccountId,
  });
  if (rpcErr) {
    return fail(500, "Couldn't start your sign-up. Try again in a moment.");
  }
  if (!newRegId) {
    return fail(409, "This class just filled up — try another date or join the waitlist.");
  }
  const reg = { id: String(newRegId), access_token: accessToken };

  const baseUrl = baseUrlOf(req);
  const productName = `${cls.title}${seats > 1 ? ` — ${seats} seats` : ""}`;

  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("payment_method_types[]", "card");
  form.set("line_items[0][quantity]", String(seats));
  form.set("line_items[0][price_data][currency]", currency);
  form.set("line_items[0][price_data][unit_amount]", String(unitCents));
  form.set("line_items[0][price_data][product_data][name]", productName);
  form.set("customer_email", studentEmail);
  form.set(
    "success_url",
    `${baseUrl}/@${encodeURIComponent(handle)}/classes/${encodeURIComponent(classSlug)}?registered=${encodeURIComponent(accessToken)}`,
  );
  form.set(
    "cancel_url",
    `${baseUrl}/@${encodeURIComponent(handle)}/classes/${encodeURIComponent(classSlug)}?cancelled=1`,
  );
  form.set("metadata[class_registration_id]", String(reg.id));
  form.set("metadata[class_id]", String(cls.id));
  form.set("metadata[stylist_user_id]", stylistUserId);
  form.set("metadata[seats]", String(seats));
  form.set("payment_intent_data[metadata][class_registration_id]", String(reg.id));
  if (applicationFeeCents > 0) {
    form.set("payment_intent_data[application_fee_amount]", String(applicationFeeCents));
  }

  const stripeRes = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecret}`,
      "Stripe-Version": "2024-06-20",
      "Stripe-Account": stylistAccountId,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
    cache: "no-store",
  });
  if (!stripeRes.ok) {
    const text = await stripeRes.text().catch(() => "");
    await admin
      .from("class_registrations")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", reg.id);
    return fail(502, `Couldn't start checkout (${stripeRes.status}). ${text.slice(0, 160)}`);
  }
  const session = (await stripeRes.json()) as { id?: string; url?: string };
  if (!session.id || !session.url) {
    await admin.from("class_registrations").update({ status: "failed" }).eq("id", reg.id);
    return fail(502, "Stripe returned an unusable session.");
  }

  await admin
    .from("class_registrations")
    .update({ stripe_session_id: session.id })
    .eq("id", reg.id);

  return NextResponse.json({ url: session.url });
}
