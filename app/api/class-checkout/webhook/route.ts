// Stripe webhook for class sign-ups.
//
// On `checkout.session.completed`, flip the class_registration to
// 'paid' via mark_class_registration_paid (idempotent) and email the
// student their confirmation + access details — the in-person location
// or the virtual meeting link, which are only revealed once paid.
//
// Signature verification + dedupe mirror the product-checkout webhook
// exactly (manual HMAC-SHA256, no Stripe SDK; record_stripe_webhook_event
// guards Stripe retries).

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "crypto";
import { sendEmail } from "../../../lib/email";

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

// Format the class start for a human, in the braider's timezone when set.
const fmtWhen = (startsAt: string | null, tz: string | null): string => {
  if (!startsAt) return "Time TBA — the braider will be in touch.";
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: tz || undefined,
    }).format(new Date(startsAt));
  } catch {
    return new Date(startsAt).toLocaleString();
  }
};

export async function POST(req: Request) {
  let secret: string;
  let supabaseUrl: string;
  let serviceKey: string;
  try {
    // Falls back to the deposit secret for single-endpoint deployments;
    // set STRIPE_CLASS_WEBHOOK_SECRET once a dedicated endpoint is wired.
    secret = process.env.STRIPE_CLASS_WEBHOOK_SECRET || env("STRIPE_DEPOSIT_WEBHOOK_SECRET");
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

  const eventId: string | undefined = typeof evt?.id === "string" ? evt.id : undefined;
  if (eventId) {
    const { data: firstTime, error: dedupeErr } = await admin.rpc("record_stripe_webhook_event", {
      event_id_in: eventId,
      event_type_in: evt.type,
      endpoint_in: "class_checkout",
      account_id_in: typeof evt?.account === "string" ? evt.account : null,
    });
    if (dedupeErr) {
      console.error("[class-checkout/webhook] dedupe failed:", dedupeErr.message);
      return NextResponse.json({ error: dedupeErr.message }, { status: 500 });
    }
    if (firstTime === false) {
      return NextResponse.json({ received: true, duplicate: true }, { status: 200 });
    }
  }

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

  const { data: rows, error: markErr } = await admin.rpc("mark_class_registration_paid", {
    session_id_in: sessionId,
    payment_intent_in: paymentIntent,
    amount_total_in: amountTotal,
    student_email_in: email,
    student_name_in: name,
  });
  if (markErr) {
    console.error("[class-checkout/webhook] mark paid failed:", markErr.message);
    return NextResponse.json({ error: markErr.message }, { status: 500 });
  }
  const result = Array.isArray(rows) ? rows[0] : rows;
  if (!result) {
    // No matching registration — checkout was never recorded. Ack so
    // Stripe stops retrying.
    return NextResponse.json({ received: true, skipped: "no_registration" }, { status: 200 });
  }

  // Only email on the first transition to paid, not on Stripe retries.
  if (!result.already_paid && result.student_email) {
    const when = fmtWhen(result.starts_at, result.timezone);
    const isVirtual = result.format === "virtual";
    const accessLine = isVirtual
      ? result.meeting_url
        ? `<p style="margin:0 0 6px;"><strong>Join link:</strong> <a href="${result.meeting_url}">${result.meeting_url}</a></p>`
        : `<p style="margin:0 0 6px;">Your join link will be sent before the class.</p>`
      : result.location_text
        ? `<p style="margin:0 0 6px;"><strong>Location:</strong> ${result.location_text}</p>`
        : `<p style="margin:0 0 6px;">Location details will follow from your braider.</p>`;
    const seatLine =
      Number(result.seats) > 1 ? `<p style="margin:0 0 6px;"><strong>Seats:</strong> ${result.seats}</p>` : "";

    await sendEmail({
      to: result.student_email,
      subject: `You're signed up: ${result.class_title}`,
      html: `
        <h1 style="font-size:20px;margin:0 0 12px;">You're in! 🎉</h1>
        <p style="margin:0 0 12px;">Your spot in <strong>${result.class_title}</strong> is confirmed.</p>
        <p style="margin:0 0 6px;"><strong>When:</strong> ${when}</p>
        ${seatLine}
        ${accessLine}
        <p style="margin:16px 0 0;font-size:13px;color:#6F6477;">See you there!</p>
      `,
      text: `You're signed up for ${result.class_title}. When: ${when}. ${
        isVirtual ? `Join: ${result.meeting_url || "link to follow"}` : `Location: ${result.location_text || "details to follow"}`
      }`,
    });
  }

  return NextResponse.json({ received: true, registration_id: result.registration_id }, { status: 200 });
}
