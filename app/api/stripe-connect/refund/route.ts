// POST /api/stripe-connect/refund
//
// Issue a refund on a single Stripe charge from the Payments &
// Transactions page — the "Issue refund" button, à la the Square app.
// Unlike /api/cancel-appointment (which refunds *because* a booking is
// being cancelled) this refunds a standalone transaction the stylist
// taps in their ledger, supporting BOTH full and partial amounts.
//
// Order of operations:
//   1. Auth: Bearer JWT must resolve to a signed-in stylist.
//   2. Resolve their connected account (profiles is canonical).
//   3. Call Stripe /refunds on the connected account for the given
//      payment_intent or charge. Omitting `amount` refunds the full
//      remaining balance; passing it (in dollars) does a partial refund.
//   4. Best-effort: email the client a refund confirmation, resolving
//      their address from the charge's billing details or the linked
//      booking_request. Never fails the refund if the email can't send.
//
// Mirrors the Stripe Connect refund helper used elsewhere (Bearer JWT →
// owner; refund on the connected account via the Stripe-Account header).

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

const escapeHtml = (v: string): string =>
  v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

type RefundAttempt =
  | { ok: true; refundId: string; amount: number }
  | { ok: false; error: string };

// Issue the refund. `amountCents` null ⇒ Stripe refunds the full
// remaining balance; a positive value ⇒ partial refund.
const issueRefund = async (
  stripeSecret: string,
  accountId: string,
  ref: { paymentIntent?: string; charge?: string },
  amountCents: number | null,
  note: string | null,
): Promise<RefundAttempt> => {
  try {
    const params = new URLSearchParams();
    if (ref.paymentIntent) params.set("payment_intent", ref.paymentIntent);
    else if (ref.charge) params.set("charge", ref.charge);
    params.set("reason", "requested_by_customer");
    // Free-text reason isn't a valid Stripe `reason` enum, so stash the
    // stylist's note on metadata where it shows in the dashboard.
    if (note) params.set("metadata[note]", note.slice(0, 500));
    if (amountCents && amountCents > 0) params.set("amount", String(amountCents));
    const res = await fetch(`${STRIPE_API}/refunds`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecret}`,
        "Stripe-Version": STRIPE_VERSION,
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

// Pull the charge so we can resolve the client's email + the originating
// booking_request for a nicer confirmation email. Best-effort — returns
// nulls on any failure.
const fetchCharge = async (
  stripeSecret: string,
  accountId: string,
  ref: { paymentIntent?: string; charge?: string },
): Promise<{ email: string | null; name: string | null; bookingRequestId: string | null; description: string | null }> => {
  const empty = { email: null, name: null, bookingRequestId: null, description: null };
  try {
    let url: string;
    if (ref.charge) {
      url = `${STRIPE_API}/charges/${ref.charge}`;
    } else if (ref.paymentIntent) {
      url = `${STRIPE_API}/payment_intents/${ref.paymentIntent}?expand[]=latest_charge`;
    } else {
      return empty;
    }
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${stripeSecret}`,
        "Stripe-Version": STRIPE_VERSION,
        "Stripe-Account": accountId,
      },
      cache: "no-store",
    });
    if (!res.ok) return empty;
    const json = await res.json();
    const charge = ref.charge ? json : json?.latest_charge;
    const meta = (charge?.metadata || json?.metadata || {}) as Record<string, string>;
    return {
      email: charge?.billing_details?.email || charge?.receipt_email || null,
      name: charge?.billing_details?.name || meta.client_name || meta.clientName || null,
      bookingRequestId: meta.booking_request_id || meta.bookingRequestId || null,
      description: charge?.description || null,
    };
  } catch {
    return empty;
  }
};

export async function POST(req: Request) {
  let body: {
    payment_intent?: string;
    charge?: string;
    amount?: number;
    reason?: string;
    client_email?: string;
    client_name?: string;
    service_name?: string;
  };
  try { body = await req.json(); }
  catch { return fail(400, "Invalid JSON body."); }

  const paymentIntent = body?.payment_intent?.trim() || undefined;
  const charge = body?.charge?.trim() || undefined;
  if (!paymentIntent && !charge) {
    return fail(400, "Missing payment_intent or charge to refund.");
  }
  const amount = Number(body?.amount);
  const amountCents =
    Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : null;
  const reason = (body?.reason || "").trim() || null;

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

  // Auth: resolve caller via Bearer JWT.
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return fail(401, "Missing bearer token.");

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: whoErr } = await admin.auth.getUser(token);
  if (whoErr || !user) return fail(401, "Invalid session.");

  // Connected account the charge lives on. profiles is canonical.
  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_connect_account_id")
    .eq("id", user.id)
    .maybeSingle();
  const acctId = profile?.stripe_connect_account_id || null;
  if (!acctId) {
    return fail(409, "Your Stripe account isn't connected — can't issue a card refund.");
  }

  const attempt = await issueRefund(
    stripeSecret,
    acctId,
    { paymentIntent, charge },
    amountCents,
    reason,
  );
  if (!attempt.ok) {
    return fail(402, `Stripe refund failed: ${attempt.error}`);
  }

  // ---- Best-effort client refund-confirmation email ----------------
  // Never fails the refund. Resolves the client's email from the charge
  // (or the linked booking_request) and enqueues a pre-rendered email
  // through the existing notification queue (HTML passthrough path).
  let emailed = false;
  try {
    const info = await fetchCharge(stripeSecret, acctId, { paymentIntent, charge });
    let clientEmail = (body?.client_email || info.email || "").trim();
    let clientName = (body?.client_name || info.name || "there").trim() || "there";
    let serviceName = (body?.service_name || info.description || "").trim() || null;

    if (info.bookingRequestId) {
      const { data: br } = await admin
        .from("booking_requests")
        .select("client_email, client_name, service_name, service_name_snapshot")
        .eq("id", info.bookingRequestId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (br) {
        clientEmail = clientEmail || (br.client_email || "").trim();
        clientName = clientName === "there" ? (br.client_name || "there") : clientName;
        serviceName = serviceName || br.service_name_snapshot || br.service_name || null;
      }
    }

    if (clientEmail && clientEmail.includes("@")) {
      let studioName = "your stylist";
      try {
        const { data: sn } = await admin.rpc("public_get_studio_name", { user_id_in: user.id });
        if (typeof sn === "string" && sn.trim()) studioName = sn.trim();
      } catch { /* studio name best-effort */ }

      const refundedStr = `$${attempt.amount.toFixed(2)}`;
      const html = `
        <div style="font-family:'DM Sans',Helvetica,Arial,sans-serif;color:#15111A;line-height:1.55;">
          <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#7C3AED;margin:0 0 10px;font-weight:700;">Refund issued</p>
          <h1 style="font-size:20px;line-height:1.25;margin:0 0 12px;">Your refund of ${refundedStr} is on its way.</h1>
          <p style="font-size:15px;margin:0 0 14px;">
            Hi ${escapeHtml(clientName)}, ${escapeHtml(studioName)} has issued you a refund of
            <strong>${refundedStr}</strong>${serviceName ? ` for <strong>${escapeHtml(serviceName)}</strong>` : ""}.
          </p>
          <p style="font-size:14px;color:#6F6477;margin:0 0 14px;">
            The refund goes back to the card you paid with and typically appears on your
            statement within 5–10 business days.
          </p>
          <p style="font-size:13px;color:#9F95A8;margin-top:18px;">If you have any questions about this refund, just reply to this email and your stylist will follow up.</p>
        </div>`;

      const enq = await admin.rpc("queue_notification", {
        user_id_in: user.id,
        channel_in: "email",
        notification_type_in: "payment_refunded",
        body_in: `You've been refunded ${refundedStr}${serviceName ? ` for ${serviceName}` : ""}.`,
        subject_in: `Your refund of ${refundedStr} — ${studioName}`,
        recipient_email_in: clientEmail,
        recipient_name_in: clientName === "there" ? null : clientName,
        payload_in: { html, refundAmount: attempt.amount, studioName, serviceName },
        dedupe_key_in: `payment_refunded:${attempt.refundId}`,
      });
      emailed = !!(enq && (enq as any).ok !== false);
    }
  } catch (e: any) {
    console.warn("[stripe-connect/refund] refund email enqueue failed:", e?.message || e);
  }

  return NextResponse.json({
    ok: true,
    refunded: attempt.amount,
    refund_id: attempt.refundId,
    emailed,
  });
}
