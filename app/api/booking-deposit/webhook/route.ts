// Stripe webhook for booking-request deposits.
//
// On `checkout.session.completed`, look up the booking_request by
// metadata.booking_request_id and call mark_deposit_paid_via_webhook,
// which is SECURITY DEFINER and idempotent — a retried delivery is a
// no-op once the row is past awaiting_deposit.
//
// Signature verification is done manually using Node `crypto` so we
// don't have to pull in the Stripe SDK. The algorithm matches what
// the SDK's `webhooks.constructEvent` does:
//   sig header  → "t=<ts>,v1=<hex>,..."
//   payload     → `${ts}.${rawBody}`
//   expected    → HMAC-SHA256(secret, payload), hex
// We reject if no v1 signature matches and (optionally) if the
// timestamp is too old.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOLERANCE_SECONDS = 5 * 60;

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};

const verifySignature = (
  rawBody: string,
  header: string | null,
  secret: string,
): { ok: true } | { ok: false; reason: string } => {
  if (!header) return { ok: false, reason: "missing signature header" };
  const parts = header.split(",").map(p => p.trim());
  let ts: number | null = null;
  const v1: string[] = [];
  for (const p of parts) {
    const [k, v] = p.split("=");
    if (k === "t" && v) ts = Number(v);
    else if (k === "v1" && v) v1.push(v);
  }
  if (!ts || v1.length === 0) return { ok: false, reason: "malformed signature header" };
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > TOLERANCE_SECONDS) {
    return { ok: false, reason: "signature timestamp out of tolerance" };
  }
  const payload = `${ts}.${rawBody}`;
  const expected = createHmac("sha256", secret).update(payload, "utf8").digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  for (const candidate of v1) {
    let candidateBuf: Buffer;
    try { candidateBuf = Buffer.from(candidate, "hex"); }
    catch { continue; }
    if (candidateBuf.length === expectedBuf.length && timingSafeEqual(candidateBuf, expectedBuf)) {
      return { ok: true };
    }
  }
  return { ok: false, reason: "no signature match" };
};

export async function POST(req: Request) {
  let secret: string;
  let supabaseUrl: string;
  let serviceKey: string;
  try {
    secret = env("STRIPE_DEPOSIT_WEBHOOK_SECRET");
    supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || env("SUPABASE_URL");
    serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "not configured" }, { status: 500 });
  }

  const rawBody = await req.text();
  const sigHeader = req.headers.get("stripe-signature");
  const verify = verifySignature(rawBody, sigHeader, secret);
  if (!verify.ok) {
    return NextResponse.json({ error: verify.reason }, { status: 400 });
  }

  let evt: any;
  try { evt = JSON.parse(rawBody); }
  catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const eventId: string | undefined = typeof evt?.id === "string" ? evt.id : undefined;

  // We only care about completed Checkout Sessions for this flow.
  // Other event types (refund, dispute, etc.) are ignored for V1.
  if (evt?.type !== "checkout.session.completed") {
    return NextResponse.json({ received: true, ignored: evt?.type }, { status: 200 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Idempotency claim — atomic. A duplicate replay returns false
  // and we short-circuit before any side effects.
  if (eventId) {
    const { data: firstTime, error: dedupeErr } = await admin.rpc(
      "record_stripe_webhook_event",
      {
        event_id_in: eventId,
        event_type_in: evt.type,
        endpoint_in: "booking_deposit",
        account_id_in: typeof evt?.account === "string" ? evt.account : null,
      },
    );
    if (dedupeErr) {
      // Don't proceed if the dedupe write failed — better to let
      // Stripe retry than risk double-processing.
      console.error("[booking-deposit/webhook] dedupe failed:", dedupeErr.message);
      return NextResponse.json({ error: dedupeErr.message }, { status: 500 });
    }
    if (firstTime === false) {
      return NextResponse.json({ received: true, duplicate: true, event_id: eventId }, { status: 200 });
    }
  }

  const session = evt?.data?.object;
  const requestId: string | undefined =
    session?.metadata?.booking_request_id ||
    session?.payment_intent_data?.metadata?.booking_request_id;
  const sessionId: string | undefined = session?.id;
  const paymentIntent: string | undefined =
    typeof session?.payment_intent === "string" ? session.payment_intent : undefined;
  // Full-ticket BNPL payments (created by /api/booking-full/checkout) carry
  // payment_kind = 'full'. They land in the same paid-pending-approval
  // state but via a different RPC (records paid_in_full + amount_paid) and
  // skip no-show card capture (BNPL methods aren't saved off-session).
  const isFullPayment: boolean =
    session?.metadata?.payment_kind === "full" ||
    session?.payment_intent_data?.metadata?.payment_kind === "full";

  // Online package purchase — this endpoint is the configured Stripe
  // webhook for connected-account checkout.session.completed, so package
  // buys (created by /api/package-checkout) land here too. Dispatch on
  // the metadata and issue the package, then ack.
  const packageTemplateId: string | undefined = session?.metadata?.package_template_id;
  if (packageTemplateId) {
    if (session?.payment_status && session.payment_status !== "paid") {
      return NextResponse.json({ received: true, ignored: `payment_status=${session.payment_status}` }, { status: 200 });
    }
    try {
      // Idempotency: never issue twice for the same Checkout session.
      if (sessionId) {
        const { data: existing } = await admin
          .from("client_packages")
          .select("id")
          .eq("stripe_session_id", sessionId)
          .maybeSingle();
        if (existing) {
          return NextResponse.json({ received: true, duplicate: true }, { status: 200 });
        }
      }
      const { data: tpl } = await admin
        .from("package_templates")
        .select("id, user_id, name, kind, visits, credit_amount, price, service_label")
        .eq("id", packageTemplateId)
        .maybeSingle();
      if (!tpl) {
        return NextResponse.json({ received: true, ignored: "template_not_found" }, { status: 200 });
      }
      const isVisits = tpl.kind === "visits";
      const visits = isVisits ? Math.max(1, Number(tpl.visits) || 1) : null;
      const credit = !isVisits ? Math.max(0, Number(tpl.credit_amount) || 0) : null;
      const buyerName = session?.metadata?.buyer_name || null;
      const buyerEmail = session?.metadata?.buyer_email || session?.customer_details?.email || null;
      await admin.from("client_packages").insert({
        user_id: tpl.user_id,
        client_id: null,
        client_name: buyerName,
        template_id: tpl.id,
        name: tpl.name,
        kind: tpl.kind,
        total_visits: visits,
        remaining_visits: visits,
        initial_amount: credit,
        balance: credit,
        price: Number(tpl.price) || 0,
        service_label: tpl.service_label,
        status: "active",
        source: "online",
        purchaser_name: buyerName,
        purchaser_email: buyerEmail,
        stripe_session_id: sessionId || null,
      });
      // In-app bell so the stylist knows to assign the package.
      try {
        await admin.from("notifications").insert({
          id: `package:${sessionId}`,
          user_id: tpl.user_id,
          category: "package",
          title: "New package purchased",
          body: `${buyerName || buyerEmail || "Someone"} bought "${tpl.name}". Assign it to a client.`,
          data: { templateId: tpl.id, buyerEmail },
        });
      } catch { /* bell is best-effort */ }
    } catch (e) {
      console.error("[booking-deposit/webhook] package issuance failed:", e);
      return NextResponse.json({ error: "package issuance failed" }, { status: 500 });
    }
    return NextResponse.json({ received: true, package: true }, { status: 200 });
  }

  if (!requestId) {
    // Not one of ours — ack so Stripe doesn't retry forever.
    return NextResponse.json({ received: true, ignored: "no_booking_request_id" }, { status: 200 });
  }
  if (session?.payment_status && session.payment_status !== "paid") {
    return NextResponse.json({ received: true, ignored: `payment_status=${session.payment_status}` }, { status: 200 });
  }

  const { error: rpcErr } = isFullPayment
    ? await admin.rpc("mark_full_payment_paid_via_webhook", {
        request_id_in: requestId,
        stripe_session_id_in: sessionId || null,
        stripe_payment_intent_in: paymentIntent || null,
        amount_paid_in:
          typeof session?.amount_total === "number"
            ? session.amount_total / 100
            : null,
      })
    : await admin.rpc("mark_deposit_paid_via_webhook", {
        request_id_in: requestId,
        stripe_session_id_in: sessionId || null,
        stripe_payment_intent_in: paymentIntent || null,
      });
  if (rpcErr) {
    // Surface the error so Stripe retries — it's likely a transient DB
    // issue worth re-delivering.
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }

  // No-show protection: record the saved card (off-session reusable) on
  // the connected account so the stylist can later charge a no-show fee
  // via /api/no-show-charge. Best-effort — never blocks the deposit ack.
  // Skipped for full BNPL payments: there's no saved card and a fully-paid
  // booking has no balance to protect.
  try {
    const acctId = typeof evt?.account === "string" ? evt.account : null;
    const stripeSecret = process.env.STRIPE_SECRET_KEY;
    if (!isFullPayment && acctId && paymentIntent && stripeSecret) {
      const piRes = await fetch(
        `https://api.stripe.com/v1/payment_intents/${paymentIntent}?expand[]=payment_method`,
        {
          headers: {
            Authorization: `Bearer ${stripeSecret}`,
            "Stripe-Version": "2024-06-20",
            "Stripe-Account": acctId,
          },
          cache: "no-store",
        },
      );
      if (piRes.ok) {
        const pi = await piRes.json();
        const pm = pi?.payment_method;
        const pmId = typeof pm === "string" ? pm : pm?.id || null;
        const card = pm && typeof pm === "object" ? pm.card : null;
        const cust =
          (typeof session?.customer === "string" ? session.customer : null) ||
          (typeof pi?.customer === "string" ? pi.customer : null);
        const patch: Record<string, unknown> = {};
        if (cust) patch.stripe_customer_id = cust;
        if (pmId) patch.stripe_payment_method_id = pmId;
        if (card?.brand) patch.nshow_card_brand = card.brand;
        if (card?.last4) patch.nshow_card_last4 = card.last4;
        if (Object.keys(patch).length > 0) {
          await admin.from("booking_requests").update(patch).eq("id", requestId);
        }
      }
    }
  } catch (e) {
    console.warn("[booking-deposit/webhook] no-show card capture failed:", e);
  }

  // Best-effort: enqueue the post-payment notifications. This is the
  // FIRST automated touch for both the client and the stylist — the
  // booking page intentionally holds the "request received"
  // acknowledgment until the deposit clears, so nobody is pinged about
  // an unpaid request. The RPC's idempotency contract means this only
  // runs after a successful state transition, and queue_notification
  // dedupes per request so a Stripe replay can't double-send.
  try {
    const { data: br } = await admin
      .from("booking_requests")
      .select("user_id, client_email, client_name, service_name_snapshot, service_name, preferred_date, preferred_time")
      .eq("id", requestId)
      .maybeSingle();
    if (br?.user_id) {
      const { data: studio } = await admin
        .rpc("public_get_studio_name", { user_id_in: br.user_id });
      const studioName =
        typeof studio === "string" && studio.trim() ? studio.trim() : null;
      const serviceName = br.service_name_snapshot || br.service_name || null;
      // Tailor the copy: a full BNPL payment isn't a "deposit".
      const clientPaidSubject = isFullPayment
        ? "Payment received — pending approval"
        : "Deposit received — pending approval";
      const clientPaidBody = isFullPayment
        ? "Payment received — pending approval."
        : "Deposit received — pending approval.";
      const ownerPaidBody = isFullPayment
        ? `${br.client_name || "A client"} paid in full — review and approve the booking.`
        : `${br.client_name || "A client"} paid their deposit — review and approve the booking.`;

      // Client — "received, pending approval". Dedupes on
      // `deposit_received:<request_id>`.
      if (br.client_email) {
        await admin.rpc("queue_notification", {
          user_id_in: br.user_id,
          channel_in: "email",
          notification_type_in: "deposit_received",
          body_in: clientPaidBody,
          subject_in: clientPaidSubject,
          recipient_email_in: br.client_email,
          recipient_name_in: br.client_name || null,
          payload_in: {
            clientName: br.client_name || "there",
            studioName: studioName || "your stylist",
            serviceName,
            preferredDate: br.preferred_date || null,
            preferredTime: br.preferred_time || null,
          },
          dedupe_key_in: `deposit_received:${requestId}`,
          booking_request_id_in: requestId,
        });
      }

      // Stylist — notify now that a real (paid) booking has landed and
      // needs review. This is the stylist's first ping about the
      // request, and the resulting stylist-addressed row is turned into
      // a web push by trg_push_stylist_addressed.
      //
      // Resolve the owner email SERVER-SIDE via queue_stylist_email_alert
      // instead of admin.auth.admin.getUserById(): that call returns no
      // email in this runtime, so the old `if (ownerEmail)` guard skipped
      // the alert on every paid booking (stylist_deposit_paid was never
      // enqueued). The RPC reads auth.users.email in Postgres — the same
      // reliable path the no-deposit flow already uses. Isolated in its
      // own try so it can't be skipped by, or skip, the client receipt
      // enqueue above. Dedupes on `deposit_paid_owner:<id>`.
      try {
        await admin.rpc("queue_stylist_email_alert", {
          user_id_in: br.user_id,
          notification_type_in: "stylist_deposit_paid",
          subject_in: "New paid booking — ready to review",
          body_in: ownerPaidBody,
          payload_in: {
            clientName: br.client_name || "A client",
            studioName: studioName || "your studio",
            serviceName,
            preferredDate: br.preferred_date || null,
            preferredTime: br.preferred_time || null,
          },
          dedupe_key_in: `deposit_paid_owner:${requestId}`,
          booking_request_id_in: requestId,
        });
      } catch (e) {
        console.warn("[booking-deposit/webhook] stylist alert enqueue failed:", e);
      }
    }
  } catch (e) {
    // Enqueue failure is non-fatal — the row is already paid.
    console.warn("[booking-deposit/webhook] notification enqueue failed:", e);
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
