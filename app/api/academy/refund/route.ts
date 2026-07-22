// POST /api/academy/refund
//
// Refund a paid class registration or video purchase. Braider-only:
// the caller's Bearer JWT must own the row. The refund is issued on the
// braider's connected account (Stripe can't be called from SQL), then
// the row is flipped to 'refunded' by the service role and the buyer
// gets a best-effort confirmation email.
//
// Mirrors /api/booking-deposit/refund's auth + Stripe Connect refund
// shape: verify the session, refund the payment_intent with the
// Stripe-Account header, record the disposition.
//
// Body: { kind: "class" | "video", id: "<uuid>" }

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "../../../lib/email";

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

const refundIntent = async (
  stripeSecret: string,
  accountId: string,
  paymentIntentId: string,
): Promise<{ ok: true; refundId: string; amount: number } | { ok: false; error: string }> => {
  try {
    const params = new URLSearchParams();
    params.set("payment_intent", paymentIntentId);
    params.set("reason", "requested_by_customer");
    // Also return the platform application fee to the connected account,
    // so refunding a sale doesn't leave the braider out-of-pocket our cut.
    params.set("refund_application_fee", "true");
    const res = await fetch(`${STRIPE_API}/refunds`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecret}`,
        "content-type": "application/x-www-form-urlencoded",
        "Stripe-Account": accountId,
      },
      body: params.toString(),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: body?.error?.message || `stripe_${res.status}` };
    }
    return {
      ok: true,
      refundId: String(body?.id || ""),
      amount: typeof body?.amount === "number" ? Math.round(body.amount) / 100 : 0,
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || "network" };
  }
};

export async function POST(req: Request) {
  let body: { kind?: string; id?: string };
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid JSON body.");
  }
  const kind = String(body?.kind || "").trim();
  const id = String(body?.id || "").trim();
  if (kind !== "class" && kind !== "video") return fail(400, "kind must be 'class' or 'video'.");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, "Missing or malformed id.");

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

  const auth = req.headers.get("authorization") || "";
  const tokenStr = auth.replace(/^Bearer\s+/i, "").trim();
  if (!tokenStr) return fail(401, "Missing bearer token.");

  const userClient = createClient(supabaseUrl, serviceKey, {
    global: { headers: { Authorization: `Bearer ${tokenStr}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const {
    data: { user },
    error: whoErr,
  } = await userClient.auth.getUser();
  if (whoErr || !user) return fail(401, "Invalid session.");

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const table = kind === "class" ? "class_registrations" : "video_purchases";
  const emailCol = kind === "class" ? "student_email" : "buyer_email";
  const nameCol = kind === "class" ? "student_name" : "buyer_name";

  // Load the row, scoped to the owner so a braider can only refund
  // their own sales.
  const { data: row, error: readErr } = await admin
    .from(table)
    .select(
      `id, user_id, status, amount_total, currency, stripe_payment_intent, stripe_account_id, ${emailCol}, ${nameCol}`,
    )
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (readErr) return fail(500, "Couldn't load that sale.");
  if (!row) return fail(404, "Sale not found.");

  if (row.status === "refunded") {
    // Idempotent — already refunded.
    return NextResponse.json({ ok: true, disposition: "already_refunded", refunded: 0 });
  }
  if (row.status !== "paid") {
    return fail(409, `Only a paid sale can be refunded (status: ${row.status}).`);
  }

  const paymentIntentId = row.stripe_payment_intent ? String(row.stripe_payment_intent) : null;
  if (!paymentIntentId) {
    return fail(409, "No payment on file to refund. Refund manually in Stripe if needed.");
  }

  // Connected account the charge landed on. profiles is canonical; the
  // row's snapshot is a fallback.
  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_connect_account_id")
    .eq("id", user.id)
    .maybeSingle();
  const acctId =
    profile?.stripe_connect_account_id || (row.stripe_account_id ? String(row.stripe_account_id) : null);
  if (!acctId) return fail(409, "No connected Stripe account found for this sale.");

  // Atomically claim the refund: flip paid → refunded, conditional on it
  // still being paid. This serializes concurrent refund clicks — only the
  // request that wins the conditional update calls Stripe, so the same
  // payment_intent is never refunded twice.
  const { data: claimed, error: claimErr } = await admin
    .from(table)
    .update({ status: "refunded", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("status", "paid")
    .select("id")
    .maybeSingle();
  if (claimErr) return fail(500, "Couldn't start the refund. Try again in a moment.");
  if (!claimed) {
    // Another request already claimed it (or it's no longer paid).
    return NextResponse.json({ ok: true, disposition: "already_refunded", refunded: 0 });
  }

  const attempt = await refundIntent(stripeSecret, acctId, paymentIntentId);
  if (!attempt.ok) {
    // Roll the claim back so a later retry can refund.
    await admin
      .from(table)
      .update({ status: "paid", updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", user.id);
    return fail(502, `Stripe couldn't process the refund: ${attempt.error}`);
  }

  const refundedAmount = attempt.amount > 0 ? attempt.amount : Number(row.amount_total) || 0;

  // Best-effort buyer email — never fail the refund because of it.
  try {
    const to = (row as any)[emailCol] as string | null;
    const name = ((row as any)[nameCol] as string | null) || "there";
    const currency = String(row.currency || "usd").toUpperCase();
    if (to) {
      const amt = (() => {
        try {
          return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(refundedAmount);
        } catch {
          return `$${refundedAmount.toFixed(2)}`;
        }
      })();
      await sendEmail({
        to,
        subject: kind === "class" ? "Your class refund" : "Your video refund",
        html: `
          <h1 style="font-size:20px;margin:0 0 12px;">You've been refunded</h1>
          <p style="margin:0 0 12px;">Hi ${name}, a refund of <strong>${amt}</strong> is on its way back to your card. It can take a few business days to appear, depending on your bank.</p>
          <p style="margin:0;font-size:13px;color:#6F6477;">If you have any questions, just reply to your braider.</p>
        `,
        text: `You've been refunded ${amt}. It can take a few business days to appear on your card.`,
      });
    }
  } catch (e: any) {
    console.error("[academy/refund] refund email failed:", e?.message || e);
  }

  return NextResponse.json({
    ok: true,
    disposition: "refunded",
    refunded: refundedAmount,
    refund_id: attempt.refundId || null,
  });
}
