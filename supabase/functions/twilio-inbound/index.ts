// Edge Function: twilio-inbound
//
// Twilio's inbound-SMS webhook. Twilio POSTs here (application/
// x-www-form-urlencoded) every time someone texts our shared sending
// number. We use it for one thing: keeping public.sms_opt_outs in sync
// with what people text, so the reminder/confirmation enqueue paths
// (which all check sms_opt_outs) honor STOP/START.
//
//   STOP / STOPALL / UNSUBSCRIBE / CANCEL / END / QUIT  → record opt-out
//   START / UNSTOP / YES                                 → clear opt-out
//   anything else (incl. HELP)                           → no DB change
//
// We deliberately return an EMPTY TwiML document and let Twilio's
// built-in Advanced Opt-Out send the carrier-compliant STOP/HELP/START
// replies. That keeps the legally-required wording on Twilio (who keeps
// it current per carrier rules) and avoids double-texting / double-
// billing the sender. Keep Advanced Opt-Out enabled on the Messaging
// Service / number. See docs/b12_2_sms_setup.md.
//
// Security: Twilio signs every request with X-Twilio-Signature (HMAC-
// SHA1 over the full URL + alphabetically-sorted POST params, keyed by
// the account auth token). We verify it when TWILIO_AUTH_TOKEN is set
// so a spoofed request can't toggle someone's opt-out state.
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
const PUBLIC_WEBHOOK_URL = Deno.env.get("TWILIO_INBOUND_PUBLIC_URL") || "";

const STOP_WORDS = new Set([
  "STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT",
]);
const START_WORDS = new Set(["START", "UNSTOP", "YES"]);
// HELP/INFO are answered by Twilio's Advanced Opt-Out (carrier-compliant
// wording) — we don't forward them as client messages.
const HELP_WORDS = new Set(["HELP", "INFO"]);

// Empty TwiML — acknowledges receipt, sends no message of our own.
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
const twiml = (status = 200) =>
  new Response(EMPTY_TWIML, {
    status,
    headers: { "content-type": "text/xml; charset=utf-8" },
  });

const xmlEscape = (s: string): string =>
  s.replace(/[<>&'"]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;"
      : c === "'" ? "&apos;" : "&quot;");

// TwiML that sends one auto-reply back to the texter. Used only for
// non-keyword inbound (STOP/HELP/START stay on Twilio's Advanced Opt-Out,
// which doesn't touch other inbound, so there's no double-reply).
const messageTwiml = (text: string, status = 200) =>
  new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${xmlEscape(text)}</Message></Response>`,
    { status, headers: { "content-type": "text/xml; charset=utf-8" } },
  );

// Twilio request signature. Algorithm: take the full request URL, then
// append every POST param as key+value in alphabetical key order, HMAC-
// SHA1 with the auth token, base64-encode, compare to X-Twilio-Signature.
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
  const keyData = new TextEncoder().encode(TWILIO_AUTH_TOKEN);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
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
  // Constant-time-ish compare.
  if (expected.length !== header.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ header.charCodeAt(i);
  }
  return diff === 0;
};

// First word, letters only, uppercased. Twilio/carriers treat the
// keyword loosely (leading/trailing punctuation, trailing text), so we
// match on the first token only: "STOP please" → STOP.
const keywordOf = (body: string): string =>
  (body || "")
    .trim()
    .split(/\s+/)[0]
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase();

serve(async (req) => {
  if (req.method === "GET") {
    return new Response(
      JSON.stringify({ ok: true, endpoint: "twilio-inbound" }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  if (req.method !== "POST") {
    return twiml(405);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("[twilio-inbound] supabase env missing");
    // 200 so Twilio doesn't retry-storm; nothing actionable on their end.
    return twiml(200);
  }

  // Parse the form body once into a plain map (needed for both the
  // signature check and the keyword logic).
  let params: Record<string, string> = {};
  try {
    const form = await req.formData();
    for (const [k, v] of form.entries()) params[k] = String(v);
  } catch {
    return twiml(200);
  }

  // Signature validation. Fail CLOSED: with no token configured we can't
  // prove the request came from Twilio, and this endpoint has verify_jwt
  // off — processing unsigned requests would let anyone spoof a `From`
  // number to toggle another client's SMS opt-in/out (STOP/START). Refuse
  // rather than process unauthenticated.
  if (!TWILIO_AUTH_TOKEN) {
    console.error("[twilio-inbound] TWILIO_AUTH_TOKEN unset — refusing unsigned request");
    return twiml(403);
  }
  {
    const url = PUBLIC_WEBHOOK_URL || req.url;
    const ok = await verifyTwilioSignature(
      url,
      params,
      req.headers.get("x-twilio-signature"),
    );
    if (!ok) {
      console.warn("[twilio-inbound] bad signature, rejecting");
      return twiml(403);
    }
  }

  const from = String(params["From"] || "");
  const body = String(params["Body"] || "");
  const keyword = keywordOf(body);
  if (!from || !keyword) return twiml(200);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    if (STOP_WORDS.has(keyword)) {
      const { error } = await admin.rpc("sms_record_opt_out", {
        phone_in: from,
        source_in: "sms_stop",
        user_id_in: null,
      });
      if (error) console.error("[twilio-inbound] record_opt_out:", error.message);
      else console.info(`[twilio-inbound] opted out ${from.slice(-4)} (${keyword})`);
    } else if (START_WORDS.has(keyword)) {
      const { error } = await admin.rpc("sms_clear_opt_out", { phone_in: from });
      if (error) console.error("[twilio-inbound] clear_opt_out:", error.message);
      else console.info(`[twilio-inbound] opted back in ${from.slice(-4)} (${keyword})`);
    } else if (!HELP_WORDS.has(keyword)) {
      // A real reply (not STOP/START/HELP). Route it to the stylist's
      // client_messages thread; auto-reply once per 12h so the client
      // knows it landed and the line isn't actively monitored.
      const { data, error } = await admin.rpc("record_inbound_sms_reply", {
        phone_in: from,
        body_in: body,
      });
      if (error) {
        console.error("[twilio-inbound] forward reply:", error.message);
      } else if (data?.ok) {
        console.info(`[twilio-inbound] forwarded reply from ${from.slice(-4)}`);
        if (data.auto_reply) {
          const studio = String(data.studio_name || "your stylist");
          return messageTwiml(
            `Braid Boss Pro: thanks! ${studio} got your message and will follow up. ` +
              `This number only sends appointment updates. Reply STOP to opt out.`,
          );
        }
      }
    }
    // HELP: no state change. Twilio's Advanced Opt-Out sends the reply.
  } catch (e: any) {
    console.error("[twilio-inbound] handler threw:", e?.message || e);
  }

  return twiml(200);
});
