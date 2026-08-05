// Self-healing sweep for Academy purchases stuck in 'pending'.
//
// The class/video checkout webhooks are the primary path that flips a
// purchase to 'paid'. But a webhook can fail to land — a bad/rotated
// signing secret, a duplicate endpoint, a transient 5xx, or (as happened
// in production) a crash inside the mark-paid RPC. When it does, the
// buyer is charged by Stripe but their row never leaves 'pending', so the
// /watch page and class confirmation hang forever on "confirming".
//
// This route is the backstop. On a schedule (pg_cron → pg_net, see
// 20261220000000_academy_reconcile_pending_cron.sql) it:
//   1. Finds pending registrations/purchases past a short grace window
//      that carry a Stripe session id + connected account.
//   2. Asks Stripe whether that Checkout Session actually paid (queried
//      AS the connected account, same as the direct charge).
//   3. If paid, calls the idempotent mark-paid RPC and emails the buyer
//      their access — exactly what the webhook would have done.
// Sessions Stripe reports as unpaid/expired/open are left untouched.
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
// the lookback so the query stays cheap. A purchase older than the grace
// window whose session Stripe reports paid is a genuine miss.
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

  const summary = {
    videos: { checked: 0, recovered: 0 },
    classes: { checked: 0, recovered: 0 },
  };

  // ── Video purchases ────────────────────────────────────────────────
  const { data: vids } = await admin
    .from("video_purchases")
    .select("id, stripe_session_id, stripe_account_id, buyer_email")
    .eq("status", "pending")
    .not("stripe_session_id", "is", null)
    .not("stripe_account_id", "is", null)
    .gte("created_at", lower)
    .lte("created_at", upper)
    .order("created_at", { ascending: true })
    .limit(BATCH);

  for (const row of (vids || []) as any[]) {
    summary.videos.checked += 1;
    const session = await getSession(stripeSecret, row.stripe_session_id, row.stripe_account_id);
    if (!sessionIsPaid(session)) continue;

    const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : null;
    const amountTotal = Number(session.amount_total || 0) / 100;
    const email = session.customer_details?.email || session.customer_email || row.buyer_email || null;
    const name = session.customer_details?.name || null;

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
    summary.videos.recovered += 1;

    if (!result.already_paid && result.buyer_email && result.access_token) {
      const watchUrl = `${baseUrl()}/watch/${encodeURIComponent(result.access_token)}`;
      const expiryLine =
        result.access_model === "rent" && result.access_expires_at
          ? `<p style="margin:0 0 12px;font-size:13px;color:#6F6477;">Your access is available until ${new Date(
              result.access_expires_at,
            ).toLocaleString()}.</p>`
          : `<p style="margin:0 0 12px;font-size:13px;color:#6F6477;">You have permanent access — save this link.</p>`;
      try {
        await sendEmail({
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
        /* best-effort — the purchase is already unlocked either way */
      }
    }
  }

  // ── Class registrations ────────────────────────────────────────────
  const { data: regs } = await admin
    .from("class_registrations")
    .select("id, stripe_session_id, stripe_account_id, student_email")
    .eq("status", "pending")
    .not("stripe_session_id", "is", null)
    .not("stripe_account_id", "is", null)
    .gte("created_at", lower)
    .lte("created_at", upper)
    .order("created_at", { ascending: true })
    .limit(BATCH);

  for (const row of (regs || []) as any[]) {
    summary.classes.checked += 1;
    const session = await getSession(stripeSecret, row.stripe_session_id, row.stripe_account_id);
    if (!sessionIsPaid(session)) continue;

    const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : null;
    const amountTotal = Number(session.amount_total || 0) / 100;
    const email = session.customer_details?.email || session.customer_email || row.student_email || null;
    const name = session.customer_details?.name || null;

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
    summary.classes.recovered += 1;

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
      try {
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
      } catch {
        /* best-effort */
      }
    }
  }

  return NextResponse.json({ ok: true, ...summary }, { status: 200 });
}
