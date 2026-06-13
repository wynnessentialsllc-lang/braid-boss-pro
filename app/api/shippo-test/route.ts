// POST /api/shippo-test  { token? }
//
// "Test connection" for the Shipping settings UI. Lists the carrier accounts
// associated with a Shippo token so the stylist sees concretely which
// carriers will quote (USPS, UPS, FedEx, …) and catches a paste error before
// a buyer hits the cart.
//
// Two modes:
//   1. token supplied in the body — used while the stylist is editing the
//      token field, before they've saved. The token never persists from this
//      route; it's only echoed to Shippo and dropped.
//   2. no token in the body — uses the stylist's stored shippo_api_token.
//      Lets a stylist re-validate without re-pasting.
//
// Auth: Bearer JWT, same pattern as /api/shipping-label. Owner-only so a
// stranger can't probe someone else's stored token.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { listCarrierAccounts, listWebhooks } from "../../lib/shippo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};
const fail = (status: number, message: string) =>
  NextResponse.json({ error: message }, { status });

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
  try {
    supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || env("SUPABASE_URL");
    serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  } catch (e: any) {
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
    return fail(400, "No Shippo token to test. Paste your token first.");
  }

  let carriers: { name: string; carrier: string; test: boolean }[];
  try {
    carriers = await listCarrierAccounts(token);
  } catch (e: any) {
    const msg = String(e?.message || "");
    // 401 from listCarrierAccounts already came back as a clean user-facing
    // message; surface anything else as a generic retryable error so a
    // transient Shippo blip doesn't read like the stylist's token is bad.
    const auth = /token|reject|401|403/i.test(msg);
    return fail(auth ? 401 : 502, msg || "Couldn't reach Shippo.");
  }

  // Best-effort webhook status check. We compute the URL the platform would
  // register and look for an active track_updated hook with that exact URL.
  // Wrapped in try/catch so a webhook-secret misconfig (or a transient
  // Shippo blip) doesn't fail the carrier check the user actually asked for.
  let webhookActive = false;
  let webhookUrl: string | null = null;
  try {
    const secret = process.env.SHIPPO_WEBHOOK_SECRET?.trim() || "";
    if (secret) {
      const origin =
        process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || new URL(req.url).origin;
      webhookUrl = `${origin}/api/shippo-webhook?secret=${encodeURIComponent(secret)}`;
      const hooks = await listWebhooks(token);
      webhookActive = hooks.some(
        (w) => w.event === "track_updated" && w.url === webhookUrl && w.active,
      );
    }
  } catch (e: any) {
    console.warn(`[shippo-test] webhook check failed: ${e?.message || e}`);
  }

  return NextResponse.json({
    ok: true,
    // Distinguish test-mode tokens so the stylist isn't surprised when a
    // live label costs real money. The token prefix is the canonical signal
    // (shippo_test_ vs shippo_live_), but every returned account also flags
    // its own test/live mode — we surface the token prefix as the source of
    // truth for the UI.
    mode: token.startsWith("shippo_test_") ? "test" : "live",
    carriers,
    webhook_active: webhookActive,
    webhook_url: webhookUrl,
  });
}
