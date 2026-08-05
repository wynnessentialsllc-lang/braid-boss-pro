// Self-healing sweep for Academy purchases stuck in 'pending' AND for
// paid purchases whose access email never went out.
//
// The class/video checkout webhooks are the primary path that (a) flips a
// purchase to 'paid' and (b) emails the buyer their access (watch link /
// class details). Either half can fail — a bad/rotated signing secret, a
// duplicate endpoint, a transient 5xx, a crash in the mark-paid RPC, or a
// Resend hiccup. When the flip fails the buyer is charged with no access;
// when only the email fails the buyer has no way back to the tokenised
// /watch link. Both strand a paying customer.
//
// This route is the backstop for both. On a schedule (pg_cron → pg_net,
// see 20261220000000_academy_reconcile_pending_cron.sql) it selects
// class/video rows whose access email has not been confirmed sent, past a
// short grace window:
//   • status 'pending' → ask Stripe (as the connected account) whether the
//     Checkout Session actually paid; if so, mark it paid.
//   • status 'paid'    → already confirmed; just (re)send the email.
// Then it emails access — reusing the exact webhook templates — and stamps
// access_email_sent_at only on an accepted send, so it retries next tick
// otherwise. Sessions Stripe reports unpaid/expired/open are left alone.
//
// Auth: internal-only. The caller must present the project service-role
// key as a Bearer token (constant-time compared), mirroring how the
// send-push edge function authenticates internal pg_net calls. The cron
// job reads that key from Supabase Vault.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "crypto";
import { sendEmail } from "../../../lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STRIPE_API = "https://api.stripe.com/v1";

// Leave the normal webhook time to land before we reconcile, and bound
// the lookback so the query stays cheap.
const GRACE_MINUTES = 10;
const LOOKBACK_DAYS = 30;
const BATCH = 100;

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};

const constantTimeEqual = (a: string, b: string): boolean => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
};

const baseUrl = (): string =>
  (process.env.NEXT_PUBLIC_SITE_URL || process.env.APP_PUBLIC_URL || "https://braidbosspro.app").replace(/\/$/, "");

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

// Retrieve a Checkout Session AS the connected account (direct charge).
// Returns null on any error so a single bad row never aborts the batch.
const getSession = async (
  stripeSecret: string,
  sessionId: string,
  accountId: string,
): Promise<any | null> => {
  try {
    const res = await fetch(`${STRIPE_API}/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${stripeSecret}`,
        "Stripe-Version": "2024-06-20",
        "Stripe-Account": accountId,
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
};

const sessionIsPaid = (s: any): boolean =>
  !!s && (s.payment_status === "paid" || (s.status === "complete" && s.payment_status !== "unpaid"));

export async function POST(req: Request) {
  let stripeSecret: string;
  let supabaseUrl: string;
  let serviceKey: string;
  try {
    stripeSecret = env("STRIPE_SECRET_KEY");
    supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || env("SUPABASE_URL");
    serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "not configured" }, { status: 500 });
  }

  // Internal auth: Bearer must be the service-role key.
  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token || !constantTimeEqual(token, serviceKey)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const nowMs = Date.now();
  const upper = new Date(nowMs - GRACE_MINUTES * 60_000).toISOString();
  const lower = new Date(nowMs - LOOKBACK_DAYS * 24 * 60 * 60_000).toISOString();
  const stamp = new Date(nowMs).toISOString();

  const summary = {
    videos: { checked: 0, recovered: 0, emailed: 0 },
    classes: { checked: 0, recovered: 0, emailed: 0 },
  };

  // ── Video purchases ────────────────────────────────────────────────
  // Anything paid-or-payable whose access email hasn't been confirmed.
  const { data: vids } = await admin
    .from("video_purchases")
    .select("id, status, stripe_session_id, stripe_account_id, buyer_email")
    .is("access_email_sent_at", null)
    .in("status", ["pending", "paid"])
    .not("stripe_session_id", "is", null)
    .not("stripe_account_id", "is", null)
    .gte("created_at", lower)
    .lte("created_at", upper)
    .order("created_at", { ascending: true })
    .limit(BATCH);

  for (const row of (vids || []) as any[]) {
    summary.videos.checked += 1;

    let paymentIntent: string | null = null;
    let amountTotal = 0;
    let email: string | null = row.buyer_email || null;
    let name: string | null = null;

    // A pending row must be confirmed paid at Stripe first; a paid row is
    // already confirmed and only needs its email (re)sent.
    if (row.status !== "paid") {
      const session = await getSession(stripeSecret, row.stripe_session_id, row.stripe_account_id);
      if (!sessionIsPaid(session)) continue;
      paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : null;
      amountTotal = Number(session.amount_total || 0) / 100;
      email = session.customer_details?.email || session.customer_email || row.buyer_email || null;
      name = session.customer_details?.name || null;
    }

    const { data: rows, error } = await admin.rpc("mark_video_purchase_paid", {
      session_id_in: row.stripe_session_id,
      payment_intent_in: paymentIntent,
      amount_total_in: amountTotal,
      buyer_email_in: email,
      buyer_name_in: name,
    });
    if (error) continue;
    const result = Array.isArray(rows) ? rows[0] : rows;
    if (!result) continue;
    if (row.status !== "paid") summary.videos.recovered += 1;

    if (!result.buyer_email || !result.access_token) continue;

    const watchUrl = `${baseUrl()}/watch/${encodeURIComponent(result.access_token)}`;
    const expiryLine =
      result.access_model === "rent" && result.access_expires_at
        ? `<p style="margin:0 0 12px;font-size:13px;color:#6F6477;">Your access is available until ${new Date(
            result.access_expires_at,
          ).toLocaleString()}.</p>`
        : `<p style="margin:0 0 12px;font-size:13px;color:#6F6477;">You have permanent access — save this link.</p>`;

    let sent;
    try {
      sent = await sendEmail({
        to: result.buyer_email,
        subject: `Your video access: ${result.video_title}`,
        html: `
          <h1 style="font-size:20px;margin:0 0 12px;">Thanks for your purchase! 🎬</h1>
          <p style="margin:0 0 12px;">You now have access to <strong>${result.video_title}</strong>.</p>
          <p style="margin:0 0 16px;">
            <a href="${watchUrl}" style="display:inline-block;background:#7C3AED;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;">
              Watch now
            </a>
          </p>
          ${expiryLine}
          <p style="margin:0;font-size:12px;color:#9A8B72;word-break:break-all;">Or paste this link: ${watchUrl}</p>
        `,
        text: `Thanks for your purchase! Watch ${result.video_title} here: ${watchUrl}`,
      });
    } catch {
      continue; // leave unsent → retry next tick
    }
    if (sent.ok) {
      summary.videos.emailed += 1;
      await admin
        .from("video_purchases")
        .update({ access_email_sent_at: stamp })
        .eq("id", row.id)
        .is("access_email_sent_at", null);
    }
  }

  // ── Class registrations ────────────────────────────────────────────
  const { data: regs } = await admin
    .from("class_registrations")
    .select("id, status, stripe_session_id, stripe_account_id, student_email")
    .is("access_email_sent_at", null)
    .in("status", ["pending", "paid"])
    .not("stripe_session_id", "is", null)
    .not("stripe_account_id", "is", null)
    .gte("created_at", lower)
    .lte("created_at", upper)
    .order("created_at", { ascending: true })
    .limit(BATCH);

  for (const row of (regs || []) as any[]) {
    summary.classes.checked += 1;

    let paymentIntent: string | null = null;
    let amountTotal = 0;
    let email: string | null = row.student_email || null;
    let name: string | null = null;

    if (row.status !== "paid") {
      const session = await getSession(stripeSecret, row.stripe_session_id, row.stripe_account_id);
      if (!sessionIsPaid(session)) continue;
      paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : null;
      amountTotal = Number(session.amount_total || 0) / 100;
      email = session.customer_details?.email || session.customer_email || row.student_email || null;
      name = session.customer_details?.name || null;
    }

    const { data: rows, error } = await admin.rpc("mark_class_registration_paid", {
      session_id_in: row.stripe_session_id,
      payment_intent_in: paymentIntent,
      amount_total_in: amountTotal,
      student_email_in: email,
      student_name_in: name,
    });
    if (error) continue;
    const result = Array.isArray(rows) ? rows[0] : rows;
    if (!result) continue;
    if (row.status !== "paid") summary.classes.recovered += 1;

    if (!result.student_email) continue;

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

    let sent;
    try {
      sent = await sendEmail({
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
    } catch {
      continue;
    }
    if (sent.ok) {
      summary.classes.emailed += 1;
      await admin
        .from("class_registrations")
        .update({ access_email_sent_at: stamp })
        .eq("id", row.id)
        .is("access_email_sent_at", null);
    }
  }

  return NextResponse.json({ ok: true, ...summary }, { status: 200 });
}
