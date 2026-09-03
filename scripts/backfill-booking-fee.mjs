// One-off backfill: recover booking_fee_amount for bookings paid before
// the admin metric existed to record it.
//
//   node scripts/backfill-booking-fee.mjs [--dry-run]
//
// Timeline that created the gap:
//   Aug 31 — "Add a client-paid booking fee" starts charging clients the
//            fee and stamping it into Stripe metadata (booking_fee_cents)
//            on the Checkout Session / PaymentIntent, but booking_requests
//            has no column to hold it yet.
//   Sep 3  — "Surface the client-paid booking fee in the admin command
//            center" adds booking_requests.booking_fee_amount and wires
//            the webhook RPCs to fill it in going forward — but only
//            going forward. Every deposit paid in between has a real fee
//            already charged and routed to the platform in Stripe, with
//            no trace of it in the database, so it reads as $0 on the
//            admin dashboard.
//
// This walks every paid booking_requests row still missing
// booking_fee_amount, re-fetches its PaymentIntent from Stripe (metadata
// is the ground truth — it's what checkout actually stamped, not a
// derived guess), and fills the column in from there. Rows where the fee
// genuinely wasn't charged (metadata absent or 0) are left null, same as
// the webhook path already treats them.
//
// Requires STRIPE_SECRET_KEY, SUPABASE_SERVICE_ROLE_KEY, and
// NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) in the environment — the
// same production credentials the app itself uses. Safe to re-run: only
// rows where booking_fee_amount is still null are touched.

import { createClient } from "@supabase/supabase-js";

const DRY_RUN = process.argv.includes("--dry-run");

const env = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};

const stripeSecret = env("STRIPE_SECRET_KEY");
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || env("SUPABASE_URL");
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: rows, error } = await admin
  .from("booking_requests")
  .select("id, stripe_payment_intent_id, stripe_connect_account_id, deposit_paid_at, client_name")
  .eq("deposit_paid", true)
  .is("booking_fee_amount", null)
  .not("stripe_payment_intent_id", "is", null)
  .not("stripe_connect_account_id", "is", null)
  .order("deposit_paid_at", { ascending: true });

if (error) {
  console.error("Failed to read booking_requests:", error.message);
  process.exit(1);
}

console.log(`${rows.length} paid booking(s) with no recorded booking fee. Checking Stripe...`);
if (DRY_RUN) console.log("(dry run — no writes)");

let recovered = 0;
let recoveredCents = 0;
let noFee = 0;
let failed = 0;

for (const row of rows) {
  try {
    const res = await fetch(
      `https://api.stripe.com/v1/payment_intents/${row.stripe_payment_intent_id}`,
      {
        headers: {
          Authorization: `Bearer ${stripeSecret}`,
          "Stripe-Version": "2024-06-20",
          "Stripe-Account": row.stripe_connect_account_id,
        },
        cache: "no-store",
      },
    );
    if (!res.ok) {
      console.warn(`  [${row.id}] Stripe lookup failed (${res.status}) — skipping`);
      failed++;
      continue;
    }
    const pi = await res.json();
    const raw = pi?.metadata?.booking_fee_cents;
    const cents = raw != null && Number.isFinite(Number(raw)) ? Math.max(0, Math.floor(Number(raw))) : 0;
    if (cents <= 0) {
      noFee++;
      continue;
    }
    const dollars = cents / 100;
    console.log(`  [${row.id}] ${row.client_name || "unknown client"} — $${dollars.toFixed(2)} fee on ${row.deposit_paid_at}`);
    if (!DRY_RUN) {
      const { error: updErr } = await admin
        .from("booking_requests")
        .update({ booking_fee_amount: dollars })
        .eq("id", row.id)
        .is("booking_fee_amount", null);
      if (updErr) {
        console.warn(`  [${row.id}] update failed: ${updErr.message}`);
        failed++;
        continue;
      }
    }
    recovered++;
    recoveredCents += cents;
  } catch (e) {
    console.warn(`  [${row.id}] error: ${e?.message || e}`);
    failed++;
  }
}

console.log(
  `\nDone. ${recovered} row(s) ${DRY_RUN ? "would be " : ""}updated ($${(recoveredCents / 100).toFixed(2)} total), ` +
    `${noFee} had no fee charged, ${failed} failed.`,
);
