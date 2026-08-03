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
import { buyLabel, requoteForAddress, splitIntoParcels, type NormalizedRate } from "../../lib/shippo";

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
    .select(
      "shippo_api_token, ship_parcel_length_in, ship_parcel_width_in, ship_parcel_height_in, pickup_address_line1, pickup_address_line2, pickup_city, pickup_state, pickup_postal_code",
    )
    .eq("user_id", userId)
    .maybeSingle();
  const token = String((shop as any)?.shippo_api_token || "").trim();
  if (!token) {
    return fail(409, "Add your Shippo API token in Shipping settings before buying a label.");
  }

  // Re-quote with the full Stripe-collected address.
  //
  // The original rate (from the cart's "ZIP + State" rate-shopping form)
  // was quoted against a partial address. Stripe Checkout then collected
  // the buyer's actual street address, which can differ — different ZIP,
  // city, even state — and the carrier rate can drift accordingly. Buying
  // the label with the original rate id would print to the cart-entered
  // destination, not the buyer's real address.
  //
  // We re-quote against the full shipping_address and look for the same
  // carrier + service. If found, swap the rate id; otherwise fall back to
  // the original. Fail-soft: any error in the re-quote path drops back to
  // the original rate id silently — the worst case is the legacy behavior.
  let effectiveRateId = rateId;
  let requotedRate: NormalizedRate | null = null;
  const shipAddr = order.shipping_address as any | null;
  const hasFullAddress =
    shipAddr &&
    typeof shipAddr === "object" &&
    typeof shipAddr.line1 === "string" && shipAddr.line1.trim() &&
    typeof shipAddr.postal_code === "string" && shipAddr.postal_code.trim() &&
    typeof shipAddr.state === "string" && shipAddr.state.trim();
  if (hasFullAddress && order.shipping_carrier && order.shipping_service) {
    try {
      const parcelL = Number((shop as any)?.ship_parcel_length_in);
      const parcelW = Number((shop as any)?.ship_parcel_width_in);
      const parcelH = Number((shop as any)?.ship_parcel_height_in);
      const fromZip = String((shop as any)?.pickup_postal_code || "").trim();
      if (
        [parcelL, parcelW, parcelH].every((n) => Number.isFinite(n) && n > 0) &&
        fromZip
      ) {
        // Sum the cart's total weight from line_items → products. The
        // checkout already validated weights are present on every line, so
        // a null here means a deleted product (rare) — we skip those.
        const slugs = Array.from(
          new Set(
            (order.line_items as any[] | null || [])
              .map((li: any) => String(li?.product_slug || ""))
              .filter(Boolean),
          ),
        );
        let weightOz = 0;
        if (slugs.length > 0) {
          const { data: products } = await admin
            .from("products")
            .select("slug, weight_oz, requires_signature, insurance_amount")
            .eq("user_id", userId)
            .in("slug", slugs);
          const bySlug = new Map<string, { weight_oz: number | null; requires_signature: boolean; insurance_amount: number | null }>();
          for (const p of products || []) {
            bySlug.set(String((p as any).slug), {
              weight_oz: (p as any).weight_oz == null ? null : Number((p as any).weight_oz),
              requires_signature: !!(p as any).requires_signature,
              insurance_amount:
                (p as any).insurance_amount == null ? null : Number((p as any).insurance_amount),
            });
          }
          let needsSignature = false;
          let insuranceTotal = 0;
          for (const li of (order.line_items as any[] | null || [])) {
            const slug = String(li?.product_slug || "");
            const qty = Math.max(1, Number(li?.quantity) || 1);
            const p = bySlug.get(slug);
            if (!p || p.weight_oz == null || !Number.isFinite(p.weight_oz) || p.weight_oz <= 0) continue;
            weightOz += p.weight_oz * qty;
            if (p.requires_signature) needsSignature = true;
            if (p.insurance_amount && p.insurance_amount > 0) {
              insuranceTotal += p.insurance_amount * qty;
            }
          }
          if (weightOz > 0) {
            // Stylist contact — Shippo requires email + phone on transactions.
            // Same lookup the rate-shopping route uses.
            let fromEmail = "";
            let fromPhone = "";
            try {
              const { data: w } = await admin.auth.admin.getUserById(userId);
              fromEmail = String(w?.user?.email || "").trim();
            } catch { /* non-fatal */ }
            try {
              const { data: bl } = await admin
                .from("booking_links")
                .select("phone")
                .eq("user_id", userId)
                .eq("active", true)
                .order("created_at", { ascending: true })
                .limit(1)
                .maybeSingle();
              fromPhone = String((bl as any)?.phone || "").trim();
            } catch { /* non-fatal */ }

            requotedRate = await requoteForAddress({
              token,
              from: {
                name: "Shop",
                street1: String((shop as any)?.pickup_address_line1 || ""),
                street2: String((shop as any)?.pickup_address_line2 || ""),
                city: String((shop as any)?.pickup_city || ""),
                state: String((shop as any)?.pickup_state || ""),
                zip: fromZip,
                country: "US",
                email: fromEmail,
                phone: fromPhone,
              },
              to: {
                name: order.customer_name || "Customer",
                street1: String(shipAddr.line1 || ""),
                street2: String(shipAddr.line2 || ""),
                city: String(shipAddr.city || ""),
                state: String(shipAddr.state || ""),
                zip: String(shipAddr.postal_code || ""),
                country: String(shipAddr.country || "US"),
              },
              parcels: splitIntoParcels({ length: parcelL, width: parcelW, height: parcelH }, weightOz),
              extras: {
                signature_confirmation: needsSignature ? "STANDARD" : null,
                insurance_amount: insuranceTotal > 0 ? insuranceTotal : null,
              },
              carrier: order.shipping_carrier,
              service: order.shipping_service,
            });
            if (requotedRate) {
              effectiveRateId = requotedRate.id;
              console.log(
                `[shipping-label] order ${order.id}: re-quoted ${order.shipping_carrier} ${order.shipping_service} for ${shipAddr.city}, ${shipAddr.state} ${shipAddr.postal_code} → rate ${requotedRate.id} ($${(requotedRate.amount_cents / 100).toFixed(2)})`,
              );
            } else {
              console.log(
                `[shipping-label] order ${order.id}: re-quote returned no matching rate; falling back to original ${rateId}`,
              );
            }
          }
        }
      }
    } catch (e: any) {
      console.warn(`[shipping-label] re-quote failed for order ${order.id}: ${e?.message || e}`);
    }
  }

  let label;
  try {
    label = await buyLabel(token, effectiveRateId);
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
      // Persist the rate id we actually bought against. When the re-quote
      // path swapped it for a full-address rate, future label-history
      // lookups should show the rate that priced the shipment, not the
      // stale cart-time rate.
      shipping_rate_id: effectiveRateId,
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
    // Resolve the stylist email SERVER-SIDE via queue_stylist_email_alert.
    // admin.auth.admin.getUserById returns no email in this runtime, so the
    // old `if (stylistEmail)` guard silently dropped this "label printed"
    // receipt every time.
    await admin.rpc("queue_stylist_email_alert", {
      user_id_in: userId,
      notification_type_in: "stylist_label_printed",
      subject_in: `Label printed · #${String(order.id).slice(0, 8).toUpperCase()}`,
      body_in: `Label printed for ${order.customer_name || "a customer"}.`,
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
