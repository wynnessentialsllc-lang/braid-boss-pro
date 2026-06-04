// POST /api/stripe-connect/webhook
//
// Active production endpoint for Stripe Connect deliveries. NEVER
// returns 410 — Stripe is configured to send live events here and
// retiring this URL would break deposit collection.
//
// Handled events:
//   account.updated                    → mirror flags into profiles
//   account.application.deauthorized   → flip profile to `disabled`
//   checkout.session.completed         → mark deposit paid
//   payment_intent.succeeded           → backstop mark deposit paid
//                                         when the session metadata
//                                         path missed
//   payment_intent.payment_failed      → set payment_status='failed'
//
// Anything else is acknowledged with 200 + a server log so Stripe
// doesn't keep retrying. Signature verified manually with HMAC-SHA256
// using STRIPE_CONNECT_WEBHOOK_SECRET — no SDK dependency.
//
// The endpoint is idempotent: the underlying RPCs (mark_deposit_paid_
// via_webhook, apply_stripe_connect_account_update) are no-ops once
// the row is in a terminal state, so Stripe retries are safe.

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

// Stripe webhooks must POST. GET is documented as 405 by convention;
// returning a friendly 200 helps when ops curls the URL to check it's
// alive, but Stripe never GETs so either is fine. Use 200 so health
// probes succeed.
export async function GET() {
  return NextResponse.json(
    { ok: true, endpoint: "stripe-connect-webhook", method: "GET" },
    { status: 200 },
  );
}

export async function POST(req: Request) {
  let secret: string;
  let supabaseUrl: string;
  let serviceKey: string;
  try {
    secret = env("STRIPE_CONNECT_WEBHOOK_SECRET");
    supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || env("SUPABASE_URL");
    serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  } catch (e: any) {
    console.error("[stripe-connect/webhook] missing env:", e?.message);
    return NextResponse.json({ error: e?.message || "not configured" }, { status: 500 });
  }

  const rawBody = await req.text();
  const verify = verifySignature(rawBody, req.headers.get("stripe-signature"), secret);
  if (!verify.ok) {
    console.warn("[stripe-connect/webhook] signature rejected:", verify.reason);
    return NextResponse.json({ error: verify.reason }, { status: 400 });
  }

  let evt: any;
  try { evt = JSON.parse(rawBody); }
  catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const eventType: string = evt?.type || "";
  const eventId: string | undefined = typeof evt?.id === "string" ? evt.id : undefined;
  const dataObject = evt?.data?.object || {};
  const connectAccount: string | undefined = typeof evt?.account === "string" ? evt.account : undefined;

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Idempotency claim — must happen before any side-effect work.
  // Duplicate Stripe replays (5xx retries, dashboard "resend") will
  // short-circuit here instead of double-firing the RPCs.
  if (eventId) {
    const { data: firstTime, error: dedupeErr } = await admin.rpc(
      "record_stripe_webhook_event",
      {
        event_id_in: eventId,
        event_type_in: eventType,
        endpoint_in: "stripe_connect",
        account_id_in: connectAccount ?? null,
      },
    );
    if (dedupeErr) {
      console.error("[stripe-connect/webhook] dedupe failed:", dedupeErr.message);
      return NextResponse.json({ error: dedupeErr.message }, { status: 500 });
    }
    if (firstTime === false) {
      return NextResponse.json(
        { received: true, duplicate: true, event: eventType, event_id: eventId },
        { status: 200 },
      );
    }
  }

  try {
    switch (eventType) {
      // -------------------------------------------------------------
      // Account state changes
      // -------------------------------------------------------------
      case "account.updated": {
        const accountId: string | undefined = dataObject?.id || connectAccount;
        if (!accountId) {
          console.warn("[stripe-connect/webhook] account.updated without account id");
          return NextResponse.json({ received: true, ignored: "no_account_id" }, { status: 200 });
        }
        const { error: rpcErr } = await admin.rpc("apply_stripe_connect_account_update", {
          account_id_in: accountId,
          charges_enabled_in: !!dataObject?.charges_enabled,
          payouts_enabled_in: !!dataObject?.payouts_enabled,
          details_submitted_in: !!dataObject?.details_submitted,
          deauthorized_in: false,
        });
        if (rpcErr) {
          console.error("[stripe-connect/webhook] apply_update failed:", rpcErr.message);
          return NextResponse.json({ error: rpcErr.message }, { status: 500 });
        }
        return NextResponse.json({ received: true, event: eventType }, { status: 200 });
      }

      case "account.application.deauthorized": {
        const accountId: string | undefined = connectAccount || dataObject?.id;
        if (!accountId) {
          console.warn("[stripe-connect/webhook] deauthorized without account id");
          return NextResponse.json({ received: true, ignored: "no_account_id" }, { status: 200 });
        }
        const { error: rpcErr } = await admin.rpc("apply_stripe_connect_account_update", {
          account_id_in: accountId,
          charges_enabled_in: false,
          payouts_enabled_in: false,
          details_submitted_in: false,
          deauthorized_in: true,
        });
        if (rpcErr) {
          console.error("[stripe-connect/webhook] deauthorize failed:", rpcErr.message);
          return NextResponse.json({ error: rpcErr.message }, { status: 500 });
        }
        return NextResponse.json({ received: true, event: eventType }, { status: 200 });
      }

      // -------------------------------------------------------------
      // Payment outcomes — direct charges on connected accounts
      // -------------------------------------------------------------
      case "checkout.session.completed": {
        const requestId: string | undefined =
          dataObject?.metadata?.booking_request_id ||
          dataObject?.payment_intent_data?.metadata?.booking_request_id;
        const sessionId: string | undefined = dataObject?.id;
        const paymentIntent: string | undefined =
          typeof dataObject?.payment_intent === "string" ? dataObject.payment_intent : undefined;
        const paymentStatus: string | undefined = dataObject?.payment_status;
        const amountTotalCents: number | undefined =
          typeof dataObject?.amount_total === "number" ? dataObject.amount_total : undefined;
        // Pay-in-full BNPL bookings (created by /api/booking-full/checkout)
        // tag the session with payment_kind=full. They flip into the same
        // paid-pending-approval state but via mark_full_payment_paid_via_
        // webhook, which records paid_in_full + amount_paid so the
        // resulting appointment shows a $0 balance (NOT the quoted deposit).
        const isFullPayment: boolean =
          dataObject?.metadata?.payment_kind === "full" ||
          dataObject?.payment_intent_data?.metadata?.payment_kind === "full";

        console.info(
          "[stripe-connect/webhook] checkout.session.completed received",
          {
            sessionId,
            booking_request_id: requestId,
            payment_status: paymentStatus,
            amount_total: amountTotalCents,
          },
        );

        if (!requestId) {
          console.warn("[stripe-connect/webhook] missing booking_request_id metadata");
          return NextResponse.json({ received: true, ignored: "no_booking_request_id" }, { status: 200 });
        }
        if (paymentStatus && paymentStatus !== "paid") {
          console.warn(`[stripe-connect/webhook] session not paid yet (status=${paymentStatus})`);
          return NextResponse.json(
            { received: true, ignored: `payment_status=${paymentStatus}` },
            { status: 200 },
          );
        }

        // Step 1 — flip approval_status / payment_status / deposit_paid
        // via the security-definer RPC. Both RPCs are idempotent: a
        // retried Stripe delivery is a no-op once the row is past
        // awaiting_deposit, so duplicate retries don't double-process.
        // A full payment routes through the full-payment RPC so the row
        // records paid_in_full + amount_paid.
        const { error: rpcErr } = isFullPayment
          ? await admin.rpc("mark_full_payment_paid_via_webhook", {
              request_id_in: requestId,
              stripe_session_id_in: sessionId || null,
              stripe_payment_intent_in: paymentIntent || null,
              amount_paid_in:
                typeof amountTotalCents === "number" ? amountTotalCents / 100 : null,
            })
          : await admin.rpc("mark_deposit_paid_via_webhook", {
              request_id_in: requestId,
              stripe_session_id_in: sessionId || null,
              stripe_payment_intent_in: paymentIntent || null,
            });
        if (rpcErr) {
          console.error(
            `[stripe-connect/webhook] mark paid failed for ${requestId}: ${rpcErr.message}`,
          );
          return NextResponse.json({ error: rpcErr.message }, { status: 500 });
        }

        // Step 2 — persist the actual paid amount (in dollars) from
        // amount_total when present, so the queue UI shows the truth
        // instead of the originally-quoted deposit if they ever
        // diverge. Only writes when the row's deposit_amount is null
        // or zero so a manual override stays intact. Skipped for full
        // payments — mark_full_payment_paid_via_webhook already records
        // amount_paid, and deposit_amount stays as the quoted deposit.
        if (!isFullPayment && typeof amountTotalCents === "number" && amountTotalCents > 0) {
          const amountDollars = Math.round(amountTotalCents) / 100;
          const { error: amountErr } = await admin
            .from("booking_requests")
            .update({ deposit_amount: amountDollars })
            .eq("id", requestId)
            .or("deposit_amount.is.null,deposit_amount.eq.0");
          if (amountErr) {
            console.warn(
              `[stripe-connect/webhook] amount sync failed for ${requestId}: ${amountErr.message}`,
            );
            // Don't fail the webhook — the row is already paid.
          }
        }

        // Step 3 — enqueue the client-facing "deposit received" email.
        // queue_notification dedupes on `deposit_received:<request_id>`
        // so a Stripe replay can't double-send.
        try {
          const { data: br } = await admin
            .from("booking_requests")
            .select("user_id, client_email, client_name, service_name_snapshot, service_name, preferred_date, preferred_time")
            .eq("id", requestId)
            .maybeSingle();
          if (br?.client_email) {
            const { data: studio } = await admin
              .rpc("public_get_studio_name", { user_id_in: br.user_id });
            await admin.rpc("queue_notification", {
              user_id_in: br.user_id,
              channel_in: "email",
              notification_type_in: "deposit_received",
              body_in: isFullPayment
                ? "Payment received — pending approval."
                : "Deposit received — pending approval.",
              subject_in: isFullPayment
                ? "Payment received — pending approval"
                : "Deposit received — pending approval",
              recipient_email_in: br.client_email,
              recipient_name_in: br.client_name || null,
              payload_in: {
                clientName: br.client_name || "there",
                studioName: (typeof studio === "string" && studio.trim()) ? studio.trim() : "your stylist",
                serviceName: br.service_name_snapshot || br.service_name || null,
                preferredDate: br.preferred_date || null,
                preferredTime: br.preferred_time || null,
                // Pay-in-full flag + amount so the email template renders
                // "Payment received / $50" instead of deposit wording.
                paidInFull: isFullPayment,
                amountPaid:
                  isFullPayment && typeof amountTotalCents === "number"
                    ? Math.round(amountTotalCents) / 100
                    : null,
              },
              dedupe_key_in: `deposit_received:${requestId}`,
              booking_request_id_in: requestId,
            });
          }
        } catch (e) {
          console.warn("[stripe-connect/webhook] email enqueue failed:", e);
        }

        console.info(
          `[stripe-connect/webhook] marked deposit paid for booking_request_id=${requestId}`,
        );
        return NextResponse.json(
          {
            received: true,
            event: eventType,
            booking_request_id: requestId,
            processed: true,
          },
          { status: 200 },
        );
      }

      case "payment_intent.succeeded": {
        // Backstop in case checkout.session.completed never arrived or
        // its metadata was stripped. We mirror booking_request_id (and
        // payment_kind) into payment_intent metadata at session creation
        // time, so look there first.
        const requestId: string | undefined = dataObject?.metadata?.booking_request_id;
        const paymentIntentId: string | undefined = dataObject?.id;
        // A full payment carries payment_kind=full in the PI metadata.
        // Pass amount_paid_in=null so the RPC falls back to service_price
        // (which is exactly what the full-payment checkout charged).
        const isFullPayment: boolean = dataObject?.metadata?.payment_kind === "full";
        const markPaid = (id: string) =>
          isFullPayment
            ? admin.rpc("mark_full_payment_paid_via_webhook", {
                request_id_in: id,
                stripe_session_id_in: null,
                stripe_payment_intent_in: paymentIntentId || null,
                amount_paid_in: null,
              })
            : admin.rpc("mark_deposit_paid_via_webhook", {
                request_id_in: id,
                stripe_session_id_in: null,
                stripe_payment_intent_in: paymentIntentId || null,
              });

        if (!requestId) {
          // Try to recover by matching against any row we previously
          // stamped with this payment_intent id.
          if (paymentIntentId) {
            const { data: existing } = await admin
              .from("booking_requests")
              .select("id")
              .eq("stripe_payment_intent_id", paymentIntentId)
              .maybeSingle();
            if (existing?.id) {
              const { error: rpcErr } = await markPaid(existing.id);
              if (rpcErr) {
                console.error("[stripe-connect/webhook] mark_paid (pi recover) failed:", rpcErr.message);
                return NextResponse.json({ error: rpcErr.message }, { status: 500 });
              }
              return NextResponse.json({ received: true, event: eventType, recovered: true }, { status: 200 });
            }
          }
          console.warn("[stripe-connect/webhook] payment_intent.succeeded without booking_request_id");
          return NextResponse.json({ received: true, ignored: "no_booking_request_id" }, { status: 200 });
        }

        const { error: rpcErr } = await markPaid(requestId);
        if (rpcErr) {
          console.error("[stripe-connect/webhook] mark_paid (pi) failed:", rpcErr.message);
          return NextResponse.json({ error: rpcErr.message }, { status: 500 });
        }
        return NextResponse.json({ received: true, event: eventType }, { status: 200 });
      }

      case "payment_intent.payment_failed": {
        const requestId: string | undefined = dataObject?.metadata?.booking_request_id;
        const paymentIntentId: string | undefined = dataObject?.id;
        const failureMessage: string | undefined =
          dataObject?.last_payment_error?.message ||
          dataObject?.failure_message;

        // Flip the matching row to payment_status='failed' so the
        // approvals queue can surface the failure. Don't change
        // approval_status — the stylist can still chase or cancel.
        if (requestId) {
          const { error: updErr } = await admin
            .from("booking_requests")
            .update({ payment_status: "failed" })
            .eq("id", requestId);
          if (updErr) {
            console.error("[stripe-connect/webhook] mark_failed failed:", updErr.message);
            return NextResponse.json({ error: updErr.message }, { status: 500 });
          }
        } else if (paymentIntentId) {
          await admin
            .from("booking_requests")
            .update({ payment_status: "failed" })
            .eq("stripe_payment_intent_id", paymentIntentId);
        }
        if (failureMessage) {
          console.warn(`[stripe-connect/webhook] payment failed: ${failureMessage}`);
        }
        return NextResponse.json({ received: true, event: eventType }, { status: 200 });
      }

      // -------------------------------------------------------------
      // Unknown event — 200 + log so Stripe doesn't retry forever
      // -------------------------------------------------------------
      default: {
        console.info("[stripe-connect/webhook] ignored event:", eventType);
        return NextResponse.json({ received: true, ignored: eventType }, { status: 200 });
      }
    }
  } catch (e: any) {
    // Unexpected error — return 500 so Stripe retries with backoff.
    console.error("[stripe-connect/webhook] unexpected error:", e?.message);
    return NextResponse.json({ error: e?.message || "internal" }, { status: 500 });
  }
}
