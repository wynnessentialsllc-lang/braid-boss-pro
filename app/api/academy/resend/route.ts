// POST /api/academy/resend
//
// Braider-only: resend a buyer their access email for a PAID class
// registration or video purchase — the watch link (video) or the class
// details. Mirrors /api/academy/refund's auth + ownership shape: the
// caller's Bearer JWT must own the row.
//
// The buyer has no login; the tokenised email is their only way back to a
// purchased video, so this gives the braider a one-tap recovery when the
// original email bounced, was deleted, or never sent.
//
// Body: { kind: "class" | "video", id: "<uuid>" }

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "../../../lib/email";
import { buildVideoAccessEmail, buildClassAccessEmail } from "../../../lib/academy-emails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};
const fail = (status: number, message: string) =>
  NextResponse.json({ error: message }, { status });

const baseUrl = (): string =>
  (process.env.NEXT_PUBLIC_SITE_URL || process.env.APP_PUBLIC_URL || "https://braidbosspro.app").replace(/\/$/, "");

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

  let supabaseUrl: string;
  let serviceKey: string;
  try {
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

  // Ownership + payment check. Only a paid sale has access to resend.
  const { data: row, error: readErr } = await admin
    .from(table)
    .select(`id, user_id, status, stripe_session_id, ${emailCol}`)
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (readErr) return fail(500, "Couldn't load that sale.");
  if (!row) return fail(404, "Sale not found.");
  if ((row as any).status !== "paid") {
    return fail(409, `Only a paid sale has an access email to resend (status: ${(row as any).status}).`);
  }
  const sessionId = (row as any).stripe_session_id ? String((row as any).stripe_session_id) : null;
  if (!sessionId) return fail(409, "No checkout on file for this sale.");

  // Reuse the idempotent mark-paid RPC purely as a read: for an
  // already-paid row it performs no update and returns the access
  // details (token, title, class specifics) the email needs.
  if (kind === "video") {
    const { data: rows, error } = await admin.rpc("mark_video_purchase_paid", {
      session_id_in: sessionId,
      payment_intent_in: null,
      amount_total_in: 0,
      buyer_email_in: null,
      buyer_name_in: null,
    });
    if (error) return fail(500, "Couldn't load the purchase details.");
    const result = Array.isArray(rows) ? rows[0] : rows;
    if (!result || !result.buyer_email || !result.access_token) {
      return fail(409, "This purchase isn't ready to resend.");
    }
    const mail = buildVideoAccessEmail({
      videoTitle: result.video_title,
      accessToken: result.access_token,
      accessModel: result.access_model,
      accessExpiresAt: result.access_expires_at ?? null,
      baseUrl: baseUrl(),
    });
    const sent = await sendEmail({ to: result.buyer_email, ...mail });
    if (!sent.ok) {
      return fail(502, "reason" in sent && sent.reason === "missing_env"
        ? "Email isn't set up yet (Resend). Configure it to send access emails."
        : "Couldn't send the email. Try again in a moment.");
    }
    await admin
      .from("video_purchases")
      .update({ access_email_sent_at: new Date().toISOString() })
      .eq("id", id);
    return NextResponse.json({ ok: true, to: result.buyer_email });
  }

  const { data: rows, error } = await admin.rpc("mark_class_registration_paid", {
    session_id_in: sessionId,
    payment_intent_in: null,
    amount_total_in: 0,
    student_email_in: null,
    student_name_in: null,
  });
  if (error) return fail(500, "Couldn't load the sign-up details.");
  const result = Array.isArray(rows) ? rows[0] : rows;
  if (!result || !result.student_email) {
    return fail(409, "This sign-up isn't ready to resend.");
  }
  const mail = buildClassAccessEmail({
    classTitle: result.class_title,
    startsAt: result.starts_at ?? null,
    timezone: result.timezone ?? null,
    format: result.format,
    meetingUrl: result.meeting_url ?? null,
    locationText: result.location_text ?? null,
    seats: Number(result.seats || 1),
  });
  const sent = await sendEmail({ to: result.student_email, ...mail });
  if (!sent.ok) {
    return fail(502, "reason" in sent && sent.reason === "missing_env"
      ? "Email isn't set up yet (Resend). Configure it to send access emails."
      : "Couldn't send the email. Try again in a moment.");
  }
  await admin
    .from("class_registrations")
    .update({ access_email_sent_at: new Date().toISOString() })
    .eq("id", id);
  return NextResponse.json({ ok: true, to: result.student_email });
}
