// POST /api/shippo-webhook?secret=…
//
// Receives Shippo `track_updated` events for any tracking number we issued
// from /api/shipping-label. On DELIVERED we stamp delivered_at + flip
// fulfillment_status to 'delivered' so the buyer's order page can show the
// final state instead of sitting on "Shipped" forever.
//
// Auth: Shippo doesn't sign webhooks, so we use a shared secret embedded in
// the URL (?secret=…) validated against SHIPPO_WEBHOOK_SECRET. The stylist
// (or platform) registers https://…/api/shippo-webhook?secret=<env> as the
// webhook URL in their Shippo dashboard. Defense in depth: we also match by
// tracking_number against an existing order under the service role, so even
// a leaked secret can only nudge real orders to a forward fulfillment state.
//
// Idempotent: timestamps are coalesced so a re-delivery event (Shippo retries
// failed webhooks for up to 24h) won't overwrite the first delivered_at.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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
  // Secret check — 200 either way so Shippo doesn't keep retrying a bogus
  // hit, but we log the rejection so a misconfigured webhook URL is
  // discoverable.
  const expected = process.env.SHIPPO_WEBHOOK_SECRET?.trim() || "";
  const provided = new URL(req.url).searchParams.get("secret")?.trim() || "";
  if (!expected || provided !== expected) {
    console.warn("[shippo-webhook] rejected: secret mismatch");
    return ok();
  }

  let body: any;
  try {
    body = await req.json();
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
    .select("id, fulfillment_status, delivered_at")
    .eq("tracking_number", trackingNumber)
    .maybeSingle();
  if (!order) {
    // Unknown tracking — could be a stale label or a different platform.
    // Ack so Shippo stops retrying; no DB write.
    return ok();
  }

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
