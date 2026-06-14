// POST /api/shipping-label  { order_id }
//
// Owner-only label purchase. The stylist buys the prepaid shipping label for a
// carrier-shipped order through their own Shippo account: we call Shippo
// /transactions with the rate id we persisted at checkout (phase 3a), then
// stamp the label URL + tracking on the order and queue the order-shipped
// email. Idempotent — a second call on an order that already has label_url
// returns the existing label instead of buying a duplicate.
//
// Auth: Bearer JWT, owner-verified against product_orders.user_id. The Shippo
// token never leaves the server; the client only receives the label PDF URL
// and the carrier-issued tracking. Rate expiry (Shippo rates live ~7d) is
// surfaced cleanly so the stylist can re-quote with the buyer's address.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buyLabel } from "../../lib/shippo";

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
  let body: { order_id?: string };
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid JSON body.");
  }
  const orderId = String(body?.order_id || "").trim();
  if (!orderId) return fail(400, "Missing order_id.");

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

  // Owner-scoped read. Pulling everything we need in one shot — order ownership,
  // current label state, the rate id, and the stylist's Shippo token.
  const { data: order, error: orderErr } = await admin
    .from("product_orders")
    .select(
      "id, user_id, status, fulfillment_status, shipping_rate_id, shipping_carrier, shipping_service, label_url, label_purchased_at, tracking_number, tracking_url, customer_email, customer_name, customer_token, shipping_address, line_items, currency, amount_total",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (orderErr) return fail(500, orderErr.message);
  if (!order) return fail(404, "Order not found.");
  if (order.user_id !== userId) return fail(403, "Not your order.");

  // Idempotent: a label that already exists is returned as-is so a double-tap
  // from the stylist's UI can't bill them twice. The shipped_at stamp on
  // mark_order_shipped is already coalesced, so this also matches the DB's
  // "first transition wins" pattern.
  if (order.label_url) {
    return NextResponse.json({
      label_url: order.label_url,
      tracking_number: order.tracking_number,
      tracking_url: order.tracking_url,
      carrier: order.shipping_carrier,
      service: order.shipping_service,
      already: true,
    });
  }

  if (order.status !== "paid") {
    return fail(409, "Order isn't paid yet — can't buy a label.");
  }
  const rateId = String(order.shipping_rate_id || "").trim();
  if (!rateId) {
    return fail(409, "This order doesn't have a live shipping rate — print a label outside the app.");
  }

  const { data: shop } = await admin
    .from("shop_settings")
    .select("shippo_api_token")
    .eq("user_id", userId)
    .maybeSingle();
  const token = String((shop as any)?.shippo_api_token || "").trim();
  if (!token) {
    return fail(409, "Add your Shippo API token in Shipping settings before buying a label.");
  }

  let label;
  try {
    label = await buyLabel(token, rateId);
  } catch (e: any) {
    const msg = String(e?.message || "");
    // Shippo's "rate is not associated with a shipment" / "expired" surfaces in
    // the error text; map both to a clean re-quote prompt so the stylist
    // knows what to do next instead of seeing a raw Shippo message.
    const expired = /rate|expired|not\sfound|not\sassociated/i.test(msg);
    console.warn(`[shipping-label] Shippo buy failed for order ${orderId}: ${msg}`);
    return fail(
      expired ? 409 : 502,
      expired
        ? "That shipping rate expired. Re-quote rates with the buyer's address and try again."
        : "Couldn't buy the label. Try again in a moment.",
    );
  }
  if (!label.label_url || !label.tracking_number) {
    return fail(502, "Shippo returned an incomplete label.");
  }

  // Single update: stamp the label + tracking + flip fulfillment to shipped.
  // We coalesce shipped_at/label_purchased_at so a manual re-run can't
  // overwrite the original timestamp. tracking_carrier prefers the carrier
  // recorded at checkout (more accurate than re-deriving from the rate id).
  const nowIso = new Date().toISOString();
  const { error: updErr } = await admin
    .from("product_orders")
    .update({
      label_url: label.label_url,
      label_purchased_at: nowIso,
      tracking_number: label.tracking_number,
      tracking_url: label.tracking_url,
      tracking_carrier: order.shipping_carrier || null,
      fulfillment_status: "shipped",
      shipped_at: nowIso,
      fulfilled_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", orderId)
    .is("label_url", null); // race guard: skip if another caller won the buy
  if (updErr) return fail(500, updErr.message);

  // Best-effort buyer email. The mark_order_shipped flow queues this on the
  // client side, but the label-purchase path bypasses that RPC, so we mirror
  // the enqueue here. A queue failure must not undo the label purchase.
  if (order.customer_email) {
    try {
      const items = Array.isArray(order.line_items)
        ? (order.line_items as any[]).map((li: any) => ({
            title: li?.title,
            variant: [li?.variant_label, li?.variant_name].filter(Boolean).join(" · ") || null,
            quantity: Number(li?.quantity) || 1,
            unitAmount: Number(li?.unit_amount) || 0,
          }))
        : [];
      await admin.rpc("queue_notification", {
        user_id_in: userId,
        channel_in: "email",
        notification_type_in: "order_shipped",
        body_in: "Your order has shipped.",
        subject_in: `Your order has shipped · #${String(order.id).slice(0, 8).toUpperCase()}`,
        recipient_email_in: order.customer_email,
        recipient_name_in: order.customer_name || null,
        payload_in: {
          orderRef: String(order.id).slice(0, 8).toUpperCase(),
          items,
          customerName: order.customer_name || null,
          carrier: order.shipping_carrier || null,
          trackingNumber: label.tracking_number,
          trackingUrl: label.tracking_url,
        },
        dedupe_key_in: `order_shipped:${order.id}`,
      });
    } catch (e: any) {
      console.warn(`[shipping-label] email enqueue failed: ${e?.message || e}`);
    }
  }

  // Best-effort stylist receipt. Mirrors the buyer email but to the
  // stylist's signup email, so they get a paper-trail without having to
  // re-open the Orders screen. We pull the email from auth.users (same
  // canonical source the rate-shopping route uses).
  try {
    const { data: who2 } = await admin.auth.admin.getUserById(userId);
    const stylistEmail = String(who2?.user?.email || "").trim();
    if (stylistEmail) {
      const shipTo = order.shipping_address as any | null;
      const cityState = shipTo
        ? [shipTo.city, shipTo.state].filter(Boolean).join(", ")
        : "";
      // Reuse the buyer's customer_token so the View order link is the
      // same public tracking page the buyer sees. The stylist's Orders
      // screen has its own deep links, but the public page is enough for
      // a quick "did the label go through?" check.
      const baseUrl =
        process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || new URL(req.url).origin;
      const viewOrderUrl = `${baseUrl}/orders/${encodeURIComponent(String((order as any).customer_token || ""))}`;
      await admin.rpc("queue_notification", {
        user_id_in: userId,
        channel_in: "email",
        notification_type_in: "stylist_label_printed",
        body_in: `Label printed for ${order.customer_name || "a customer"}.`,
        subject_in: `Label printed · #${String(order.id).slice(0, 8).toUpperCase()}`,
        recipient_email_in: stylistEmail,
        recipient_name_in: null,
        payload_in: {
          orderRef: String(order.id).slice(0, 8).toUpperCase(),
          customerName: order.customer_name || order.customer_email || "Customer",
          shipToCityState: cityState,
          carrier: order.shipping_carrier || null,
          service: order.shipping_service || null,
          trackingNumber: label.tracking_number,
          trackingUrl: label.tracking_url,
          labelUrl: label.label_url,
          viewOrderUrl,
          // Label cost isn't on the order row — Shippo charged it to the
          // stylist's Shippo balance, separate from Stripe. Best effort:
          // omit when we don't have it, the template renders without.
          labelCostUsd: null,
        },
        dedupe_key_in: `stylist_label_printed:${order.id}`,
      });
    }
  } catch (e: any) {
    console.warn(`[shipping-label] stylist email enqueue failed: ${e?.message || e}`);
  }

  return NextResponse.json({
    label_url: label.label_url,
    tracking_number: label.tracking_number,
    tracking_url: label.tracking_url,
    carrier: order.shipping_carrier,
    service: order.shipping_service,
    already: false,
  });
}
