// POST /api/sms-credits/autorecharge-run — the auto-recharge sweep.
//
// Called on a schedule by pg_cron via pg_net. Finds accounts whose
// balance has fallen below their threshold and charges the card on
// file off-session, crediting the pack on success.
//
// This is the one place in the product that charges a card nobody is
// looking at, so the ordering is deliberate:
//
//   1. claim_sms_autorecharge() re-validates eligibility under a row
//      lock and writes the pending purchase row. Nothing is charged
//      until a claim succeeds, and two concurrent sweeps cannot both
//      claim the same account.
//   2. The claim's purchase id is the Stripe idempotency key, so a
//      retried request returns the ORIGINAL charge rather than making
//      a second one.
//   3. settle_sms_autorecharge() credits (once — it keys off
//      status <> 'paid') or records the failure and backs off.
//
// If this route dies between 2 and 3 the purchase row stays 'pending'
// and the cooldown keeps that account quiet; the card was charged at
// most once, and the next sweep's idempotency key differs, so the
// worst case is one uncredited charge visible in the purchases table
// rather than a double charge.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { findSmsPack } from "../../../lib/sms-packs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STRIPE_API = "https://api.stripe.com/v1";

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};

export async function POST(req: Request) {
  let stripeKey: string;
  let supabaseUrl: string;
  let serviceKey: string;
  let cronSecret: string;
  try {
    stripeKey = env("STRIPE_SECRET_KEY");
    supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || env("SUPABASE_URL");
    serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
    cronSecret = env("AUTORECHARGE_CRON_SECRET");
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "not configured" }, { status: 500 });
  }

  // Shared-secret gate. This endpoint moves money, so an unauthenticated
  // caller must never reach the sweep.
  const provided = req.headers.get("x-cron-secret") || "";
  if (provided.length !== cronSecret.length || provided !== cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: due, error: dueErr } = await admin.rpc("sms_autorecharge_due", {
    limit_in: 50,
  });
  if (dueErr) {
    console.error("[autorecharge-run] due query failed:", dueErr.message);
    return NextResponse.json({ error: dueErr.message }, { status: 500 });
  }

  const rows = (due || []) as { user_id: string; pack_id: string }[];
  let charged = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const pack = findSmsPack(row.pack_id);
    if (!pack) {
      skipped++;
      continue;
    }

    const { data: claimRes, error: claimErr } = await admin.rpc("claim_sms_autorecharge", {
      user_id_in: row.user_id,
      pack_credits_in: pack.credits,
      pack_cents_in: pack.priceCents,
    });
    const claim = (claimRes || {}) as any;
    if (claimErr || claim.ok !== true) {
      skipped++;
      continue;
    }

    const purchaseId = String(claim.purchase_id);
    const form = new URLSearchParams();
    form.set("amount", String(pack.priceCents));
    form.set("currency", "usd");
    form.set("customer", String(claim.customer));
    form.set("payment_method", String(claim.payment_method));
    // off_session + confirm is what makes this a true background charge.
    form.set("off_session", "true");
    form.set("confirm", "true");
    form.set("description", `Braid Boss Pro · ${pack.credits} SMS credits (auto-recharge)`);
    form.set("metadata[purpose]", "sms_autorecharge");
    form.set("metadata[user_id]", row.user_id);
    form.set("metadata[purchase_id]", purchaseId);

    let ok = false;
    let reference: string | null = null;
    let errMsg: string | null = null;
    try {
      const res = await fetch(`${STRIPE_API}/payment_intents`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeKey}`,
          "content-type": "application/x-www-form-urlencoded",
          // Keyed to the claim, so a retry of this exact attempt can
          // never produce a second charge.
          "Idempotency-Key": `autorecharge:${purchaseId}`,
        },
        body: form.toString(),
      });
      const json = await res.json().catch(() => null) as any;
      if (res.ok && json?.status === "succeeded") {
        ok = true;
        reference = json?.id || null;
      } else {
        // A card needing authentication can't be charged off-session;
        // it is a real failure, not a transient one.
        errMsg = json?.error?.message || json?.status || `http_${res.status}`;
      }
    } catch (e: any) {
      errMsg = `network: ${e?.message || e}`;
    }

    const { error: settleErr } = await admin.rpc("settle_sms_autorecharge", {
      purchase_id_in: purchaseId,
      succeeded_in: ok,
      reference_in: reference,
      error_in: errMsg,
    });
    if (settleErr) {
      // The charge may have gone through — surface loudly rather than
      // silently losing the link between payment and credits.
      console.error(
        `[autorecharge-run] settle failed for purchase ${purchaseId} (charged=${ok}):`,
        settleErr.message,
      );
    }

    if (ok) charged++;
    else failed++;
  }

  return NextResponse.json({ ok: true, considered: rows.length, charged, skipped, failed });
}
