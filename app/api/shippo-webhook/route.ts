// POST /api/shippo-webhook?secret=…
//
// Receives Shippo `track_updated` events for any tracking number we issued
// from /api/shipping-label. On DELIVERED we stamp delivered_at + flip
// fulfillment_status to 'delivered' so the buyer's order page can show the
// final state instead of sitting on "Shipped" forever.
//
// Auth (layered):
//   1. URL ?secret=  vs SHIPPO_WEBHOOK_SECRET  — the original platform-wide
//      shared secret. Required for every request.
//   2. Shippo-Auth-Signature HMAC-SHA256  — additive, per-stylist. Verified
//      when the matched order's stylist has saved their Shippo webhook
//      signing secret in Settings. When configured, both checks must pass.
//
// Layered on purpose so already-registered webhooks (URL secret only) keep
// working during the rollout window. New stylists who paste their signing
// secret get a real HMAC check; the URL secret remains as defense in depth
// against secret-rotation gaps.
//
// Idempotent: timestamps are coalesced so a re-delivery event (Shippo retries
// failed webhooks for up to 24h) won't overwrite the first delivered_at.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyShippoSignature } from "../../lib/shippo-signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};
const ok = () => NextResponse.json({ ok: true });

// Forward-only fulfillment transitions Shippo can drive. We never roll a
// shipped/delivered order backward off a stale TRANSIT event, and we never
// touch refunded/canceled orders.
const TERMINAL_BACKWARD = new Set(["delivered", "refunded", "canceled"]);

export async function POST(req: Request) {
  // 1) URL secret. 200 either way so Shippo doesn't retry-storm a bogus
  //    hit, but log so a misconfigured webhook URL is discoverable.
  const expected = process.env.SHIPPO_WEBHOOK_SECRET?.trim() || "";
  const provided = new URL(req.url).searchParams.get("secret")?.trim() || "";
  if (!expected || provided !== expected) {
    console.warn("[shippo-webhook] rejected: url secret mismatch");
    return ok();
  }

  // Read the raw body once so the HMAC verifier can hash the exact bytes
  // Shippo signed. Re-parse as JSON ourselves to dispatch on event type.
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return ok();
  }
  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return ok();
  }

  const event = String(body?.event || "").trim();
  if (event !== "track_updated") {
    // Shippo can fire other events (transaction_created, etc). Ack so it
    // doesn't retry; do nothing.
    return ok();
  }

  const data = body?.data || {};
  const trackingNumber = String(data?.tracking_number || "").trim();
  const status = String(data?.tracking_status?.status || "").toUpperCase();
  const statusDateRaw = data?.tracking_status?.status_date || data?.tracking_status?.object_updated;
  const statusDate = statusDateRaw ? new Date(String(statusDateRaw)) : new Date();
  if (!trackingNumber || !status) return ok();

  let supabaseUrl: string;
  let serviceKey: string;
  try {
    supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || env("SUPABASE_URL");
    serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  } catch (e: any) {
    console.error("[shippo-webhook] env missing:", e?.message);
    return ok();
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: order } = await admin
    .from("product_orders")
    .select("id, user_id, fulfillment_status, delivered_at")
    .eq("tracking_number", trackingNumber)
    .maybeSingle();
  if (!order) {
    // Unknown tracking — could be a stale label or a different platform.
    // Ack so Shippo stops retrying; no DB write.
    return ok();
  }

  // 2) HMAC verification. We resolve the stylist's signing secret via the
  //    matched order's user_id; that means we can't verify until we've
  //    matched a tracking number. That's intentional — Shippo signs with
  //    the *Shippo account's* secret, so we have to know which Shippo
  //    account fired the event before we can verify. The URL secret is the
  //    coarse outer gate; HMAC is the per-stylist inner gate.
  const { data: shop } = await admin
    .from("shop_settings")
    .select("shippo_webhook_secret")
    .eq("user_id", order.user_id)
    .maybeSingle();
  const signingSecret = String((shop as any)?.shippo_webhook_secret || "").trim();
  if (signingSecret) {
    const v = verifyShippoSignature({
      rawBody,
      header: req.headers.get("shippo-auth-signature"),
      secret: signingSecret,
    });
    if (!v.ok) {
      console.warn(
        `[shippo-webhook] rejected: HMAC ${v.reason} for tracking ${trackingNumber}`,
      );
      return ok();
    }
  }
  // No signing secret configured for this stylist → fall through to the
  // URL-secret-only check we already passed. Logging here would spam the
  // happy path for every stylist who hasn't pasted theirs yet.

  // Only DELIVERED currently drives a write. RETURNED / FAILURE are useful
  // signals but we don't model them in product_orders yet — adding them
  // would require new status values, which is a separate change.
  if (status !== "DELIVERED") return ok();

  // Don't roll a refunded/canceled order to delivered, and don't overwrite a
  // delivered_at we already stamped from a previous event.
  if (TERMINAL_BACKWARD.has(String(order.fulfillment_status))) return ok();
  if (order.delivered_at) return ok();

  const nowIso = new Date().toISOString();
  const delivered = Number.isNaN(statusDate.valueOf()) ? nowIso : statusDate.toISOString();
  await admin
    .from("product_orders")
    .update({
      fulfillment_status: "delivered",
      delivered_at: delivered,
      updated_at: nowIso,
    })
    .eq("id", order.id)
    .is("delivered_at", null); // race guard — first delivery event wins

  return ok();
}
