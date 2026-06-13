// POST /api/shippo-setup
//
// Auto-registers the platform's track_updated webhook against the stylist's
// own Shippo account. Idempotent: if a matching webhook (same URL + event)
// is already registered, returns "already" instead of creating a duplicate.
// Called by the Settings UI right after a successful "Test connection" so a
// stylist's onboarding is one tap: paste token → test → webhook is live.
//
// The webhook URL embeds SHIPPO_WEBHOOK_SECRET as a query param — the
// receiving /api/shippo-webhook route rejects calls without a matching
// secret. (Shippo HMAC signature verification is a future hardening pass.)
//
// Auth: Bearer JWT, owner-only. The Shippo token never leaves the server.
// The candidate token in the body lets the stylist register before saving
// the token; without it we fall back to the stored shop_settings token.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { listWebhooks, registerTrackingWebhook, type ShippoWebhook } from "../../lib/shippo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};
const fail = (status: number, message: string) =>
  NextResponse.json({ error: message }, { status });

// Build the canonical webhook URL the platform uses. Origin precedence:
//   1. NEXT_PUBLIC_SITE_URL  — the deploy's canonical host (set in Vercel).
//   2. request origin        — fallback when the env isn't configured.
// We strip a trailing slash and always pin the path so a stylist running
// against a preview deploy doesn't accidentally register a webhook against
// the production host (or vice versa).
const buildWebhookUrl = (req: Request, secret: string): string => {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  let origin = fromEnv || "";
  if (!origin) {
    try {
      origin = new URL(req.url).origin;
    } catch {
      origin = "";
    }
  }
  return `${origin}/api/shippo-webhook?secret=${encodeURIComponent(secret)}`;
};

export async function POST(req: Request) {
  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const candidate = String(body?.token || "").trim();

  let supabaseUrl: string;
  let serviceKey: string;
  let webhookSecret: string;
  try {
    supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || env("SUPABASE_URL");
    serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
    webhookSecret = env("SHIPPO_WEBHOOK_SECRET");
  } catch (e: any) {
    console.error("[shippo-setup] env missing:", e?.message);
    return fail(500, e?.message || "Server is not configured.");
  }

  const authHeader = req.headers.get("authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return fail(401, "Missing bearer token.");

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: who, error: whoErr } = await admin.auth.getUser(jwt);
  if (whoErr || !who?.user) return fail(401, "Invalid session.");
  const userId = who.user.id;

  let token = candidate;
  if (!token) {
    const { data: shop } = await admin
      .from("shop_settings")
      .select("shippo_api_token")
      .eq("user_id", userId)
      .maybeSingle();
    token = String((shop as any)?.shippo_api_token || "").trim();
  }
  if (!token) {
    return fail(400, "No Shippo token. Paste your token first, then test.");
  }

  const url = buildWebhookUrl(req, webhookSecret);

  // Look first — Shippo will happily create duplicates so we have to dedupe
  // ourselves. Match on exact URL + event so two deploys (prod + staging)
  // can each have their own active hook on the same Shippo account.
  let existing: ShippoWebhook[];
  try {
    existing = await listWebhooks(token);
  } catch (e: any) {
    console.warn(`[shippo-setup] list failed for ${userId}: ${e?.message || e}`);
    const msg = String(e?.message || "");
    const auth = /token|reject|401|403/i.test(msg);
    return fail(auth ? 401 : 502, auth ? "Shippo rejected the token." : "Couldn't reach Shippo.");
  }
  const match = existing.find(
    (w) => w.event === "track_updated" && w.url === url && w.active,
  );
  if (match) {
    console.log(`[shippo-setup] already registered for ${userId} (${match.id})`);
    return NextResponse.json({
      ok: true,
      already: true,
      webhook: match,
      url,
    });
  }

  let hook: ShippoWebhook;
  try {
    hook = await registerTrackingWebhook(token, url);
  } catch (e: any) {
    console.warn(`[shippo-setup] register failed for ${userId}: ${e?.message || e}`);
    return fail(502, "Couldn't register the webhook. Try again in a moment.");
  }
  console.log(`[shippo-setup] registered for ${userId} (${hook.id})`);

  return NextResponse.json({
    ok: true,
    already: false,
    webhook: hook,
    url,
  });
}
