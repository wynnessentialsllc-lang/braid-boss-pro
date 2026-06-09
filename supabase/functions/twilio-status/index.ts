// Edge Function: twilio-status
//
// Twilio's message status callback. The dispatch worker sends each SMS
// with a StatusCallback pointing here, and Twilio POSTs a delivery
// update (application/x-www-form-urlencoded) as the message moves through
// queued → sent → delivered | undelivered | failed.
//
// We forward the terminal outcome to record_sms_delivery_status, which
// stamps notification_queue.status (delivered / failed) and refunds one
// SMS credit when an accepted message ends up undelivered (e.g. carrier
// error 30032 — toll-free not verified). Intermediate statuses are
// acknowledged and ignored.
//
// Security: Twilio signs every request with X-Twilio-Signature (HMAC-SHA1
// over the full URL + alphabetically-sorted POST params, keyed by the
// account auth token). We fail CLOSED — a spoofed callback could refund
// credits or fake a delivered status, so an unsigned/invalid request is
// rejected.
//
// verify_jwt = false (set in supabase/config.toml) — Twilio cannot send
// a Supabase JWT.

// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
// Optional override for the public URL Twilio used to reach us, in case
// the function sits behind a proxy that rewrites the request URL (which
// would otherwise break signature validation). Normally unset.
const PUBLIC_WEBHOOK_URL = Deno.env.get("TWILIO_STATUS_PUBLIC_URL") || "";

const ok = (status = 200) =>
  new Response(JSON.stringify({ ok: true }), {
    status,
    headers: { "content-type": "application/json" },
  });

// Twilio request signature: full request URL, then every POST param as
// key+value in alphabetical key order, HMAC-SHA1 with the auth token,
// base64, compared to X-Twilio-Signature.
const verifyTwilioSignature = async (
  url: string,
  params: Record<string, string>,
  header: string | null,
): Promise<boolean> => {
  if (!header) return false;
  let data = url;
  for (const key of Object.keys(params).sort()) {
    data += key + params[key];
  }
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(TWILIO_AUTH_TOKEN),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(data),
  );
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  if (expected.length !== header.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ header.charCodeAt(i);
  }
  return diff === 0;
};

serve(async (req) => {
  if (req.method === "GET") {
    return new Response(
      JSON.stringify({ ok: true, endpoint: "twilio-status" }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  if (req.method !== "POST") return ok(405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("[twilio-status] supabase env missing");
    return ok(200); // 200 so Twilio doesn't retry-storm; nothing actionable.
  }

  let params: Record<string, string> = {};
  try {
    const form = await req.formData();
    for (const [k, v] of form.entries()) params[k] = String(v);
  } catch {
    return ok(200);
  }

  // Fail closed — this endpoint can refund credits, so never act on an
  // unauthenticated request.
  if (!TWILIO_AUTH_TOKEN) {
    console.error("[twilio-status] TWILIO_AUTH_TOKEN unset — refusing unsigned request");
    return ok(403);
  }
  {
    const url = PUBLIC_WEBHOOK_URL || req.url;
    const valid = await verifyTwilioSignature(
      url,
      params,
      req.headers.get("x-twilio-signature"),
    );
    if (!valid) {
      console.warn("[twilio-status] bad signature, rejecting");
      return ok(403);
    }
  }

  // Twilio uses MessageSid/MessageStatus (SmsSid/SmsStatus on older API).
  const sid = String(params["MessageSid"] || params["SmsSid"] || "");
  const status = String(params["MessageStatus"] || params["SmsStatus"] || "");
  const errorCode = String(params["ErrorCode"] || "");
  if (!sid || !status) return ok(200);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { error } = await admin.rpc("record_sms_delivery_status", {
      message_sid_in: sid,
      status_in: status,
      error_code_in: errorCode || null,
    });
    if (error) {
      console.error("[twilio-status] record_sms_delivery_status:", error.message);
    } else {
      console.info(`[twilio-status] ${sid.slice(-6)} → ${status}${errorCode ? ` (${errorCode})` : ""}`);
    }
  } catch (e: any) {
    console.error("[twilio-status] handler threw:", e?.message || e);
  }

  return ok(200);
});
