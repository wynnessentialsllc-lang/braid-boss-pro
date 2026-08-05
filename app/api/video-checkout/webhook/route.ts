// Stripe webhook for video-lesson purchases.
//
// On `checkout.session.completed`, flip the video_purchase to 'paid'
// via mark_video_purchase_paid (idempotent; stamps the rental expiry)
// and email the buyer their private watch link. Signature verification
// + dedupe mirror the product-checkout webhook.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "crypto";
import { sendEmail } from "../../../lib/email";
import { buildVideoAccessEmail, buildVideoSaleAlert } from "../../../lib/academy-emails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOLERANCE_SECONDS = 5 * 60;

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};

const baseUrlOf = (req: Request): string => {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  try {
    return new URL(req.url).origin;
  } catch {
    return "";
  }
};

const verifySignature = (
  rawBody: string,
  header: string | null,
  secret: string,
): { ok: true } | { ok: false; reason: string } => {
  if (!header) return { ok: false, reason: "missing signature header" };
  const parts = header.split(",").map((p) => p.trim());
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
    try {
      candidateBuf = Buffer.from(candidate, "hex");
    } catch {
      continue;
    }
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
    secret = process.env.STRIPE_VIDEO_WEBHOOK_SECRET || env("STRIPE_DEPOSIT_WEBHOOK_SECRET");
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
  try {
    evt = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  if (evt?.type !== "checkout.session.completed") {
    return NextResponse.json({ received: true, ignored: evt?.type }, { status: 200 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const session = evt?.data?.object;
  const sessionId: string | undefined = session?.id;
  if (!sessionId) {
    return NextResponse.json({ received: true, skipped: "no_session_id" }, { status: 200 });
  }
  const paymentIntent: string | null =
    typeof session?.payment_intent === "string" ? session.payment_intent : null;
  const amountTotal = Number(session?.amount_total || 0) / 100;
  const email = session?.customer_details?.email || session?.customer_email || null;
  const name = session?.customer_details?.name || null;

  // Do the (idempotent) work FIRST, so a transient failure returns 500
  // with nothing committed and Stripe's redelivery re-runs it, instead of
  // a dedupe row silently dropping a paid purchase. mark_video_purchase_paid
  // flips a pending row only once (retry → already_paid).
  const { data: rows, error: markErr } = await admin.rpc("mark_video_purchase_paid", {
    session_id_in: sessionId,
    payment_intent_in: paymentIntent,
    amount_total_in: amountTotal,
    buyer_email_in: email,
    buyer_name_in: name,
  });
  if (markErr) {
    console.error("[video-checkout/webhook] mark paid failed:", markErr.message);
    return NextResponse.json({ error: markErr.message }, { status: 500 });
  }
  const result = Array.isArray(rows) ? rows[0] : rows;
  if (!result) {
    return NextResponse.json({ received: true, skipped: "no_purchase" }, { status: 200 });
  }

  // Best-effort audit dedupe AFTER the work; email is gated on already_paid
  // (only the flipping delivery emails), not on the shared event table.
  const eventId: string | undefined = typeof evt?.id === "string" ? evt.id : undefined;
  if (eventId) {
    try {
      await admin.rpc("record_stripe_webhook_event", {
        event_id_in: eventId,
        event_type_in: evt.type,
        endpoint_in: "video_checkout",
        account_id_in: typeof evt?.account === "string" ? evt.account : null,
      });
    } catch {
      /* best-effort audit — never fail the ack over it */
    }
  }

  if (!result.already_paid && result.buyer_email && result.access_token) {
    const mail = buildVideoAccessEmail({
      videoTitle: result.video_title,
      accessToken: result.access_token,
      accessModel: result.access_model,
      accessExpiresAt: result.access_expires_at ?? null,
      baseUrl: baseUrlOf(req),
    });
    const sent = await sendEmail({ to: result.buyer_email, ...mail });
    // Stamp only on an accepted send, so the reconcile sweep retries a
    // skipped/failed delivery instead of the buyer being locked out.
    if (sent.ok) {
      await admin
        .from("video_purchases")
        .update({ access_email_sent_at: new Date().toISOString() })
        .eq("id", result.purchase_id)
        .is("access_email_sent_at", null);
    }
  }

  // Notify the seller (braider) on the first paid transition — email +
  // web push + in-app bell, via the same worker every other stylist alert
  // uses. queue_stylist_email_alert resolves the owner's email server-side
  // and never depends on the app's own email env, so this fires reliably.
  if (!result.already_paid) {
    const stylistUserId =
      typeof session?.metadata?.stylist_user_id === "string" ? session.metadata.stylist_user_id : null;
    if (stylistUserId) {
      const alert = buildVideoSaleAlert({
        videoTitle: result.video_title,
        buyerLabel: result.buyer_name || result.buyer_email || "Someone",
        amount: amountTotal,
        currency: String(session?.currency || "usd"),
      });
      try {
        await admin.rpc("queue_stylist_email_alert", {
          user_id_in: stylistUserId,
          notification_type_in: "academy_video_sale",
          subject_in: alert.subject,
          body_in: alert.body,
          payload_in: {},
          dedupe_key_in: `academy_video_sale:${result.purchase_id}`,
        });
      } catch (e) {
        console.warn("[video-checkout/webhook] seller alert enqueue failed:", e);
      }
    }
  }

  return NextResponse.json({ received: true, purchase_id: result.purchase_id }, { status: 200 });
}
