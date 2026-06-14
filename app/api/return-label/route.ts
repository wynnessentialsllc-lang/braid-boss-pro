// POST /api/return-label  { order_id }
//
// Owner-only return-label purchase. Generates a prepaid Shippo label from the
// buyer's shipping address (Stripe-collected) back to the shop's pickup
// address. Independent of the refund flow — the stylist can issue a return
// label without refunding, refund without a return label, or both.
//
// Strategy:
//   1. Read the order + shop + product weights (same lookups as the outbound
//      label route).
//   2. Build a Shippo Shipment with addresses reversed.
//   3. Fetch rates; pick the same carrier + service the outbound used when
//      available, else the cheapest matching carrier, else the overall
//      cheapest. The buyer shouldn't be paying premium tariffs to return.
//   4. Buy the label, persist return_label_url + return_tracking_*.
//
// Idempotent: a second call on an order that already has return_label_url
// returns the cached label instead of buying a duplicate.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buyLabel, fetchShipmentRates, type NormalizedRate } from "../../lib/shippo";

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

  const { data: order, error: orderErr } = await admin
    .from("product_orders")
    .select(
      "id, user_id, status, shipping_address, shipping_carrier, shipping_service, line_items, customer_email, customer_name, return_label_url, return_tracking_number, return_tracking_url, return_purchased_at",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (orderErr) return fail(500, orderErr.message);
  if (!order) return fail(404, "Order not found.");
  if (order.user_id !== userId) return fail(403, "Not your order.");

  // Idempotent return — a second call returns the cached label.
  if (order.return_label_url) {
    return NextResponse.json({
      label_url: order.return_label_url,
      tracking_number: order.return_tracking_number,
      tracking_url: order.return_tracking_url,
      already: true,
    });
  }

  if (order.status !== "paid") {
    return fail(409, "Order isn't paid — can't generate a return label.");
  }

  const shipAddr = order.shipping_address as any | null;
  if (
    !shipAddr ||
    !shipAddr.line1 ||
    !shipAddr.postal_code ||
    !shipAddr.state
  ) {
    return fail(409, "Order is missing the buyer's shipping address — nothing to return from.");
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
    return fail(409, "Add your Shippo API token in Shipping settings first.");
  }
  const parcelL = Number((shop as any)?.ship_parcel_length_in);
  const parcelW = Number((shop as any)?.ship_parcel_width_in);
  const parcelH = Number((shop as any)?.ship_parcel_height_in);
  const pickupZip = String((shop as any)?.pickup_postal_code || "").trim();
  if (
    ![parcelL, parcelW, parcelH].every((n) => Number.isFinite(n) && n > 0) ||
    !pickupZip
  ) {
    return fail(409, "Set a default package size + pickup address in Shipping settings first.");
  }

  // Sum the cart's weight from line_items → products.
  const slugs = Array.from(
    new Set(
      ((order.line_items as any[] | null) || [])
        .map((li: any) => String(li?.product_slug || ""))
        .filter(Boolean),
    ),
  );
  let weightOz = 0;
  if (slugs.length > 0) {
    const { data: products } = await admin
      .from("products")
      .select("slug, weight_oz")
      .eq("user_id", userId)
      .in("slug", slugs);
    const bySlug = new Map<string, number>();
    for (const p of products || []) {
      const w = (p as any).weight_oz == null ? null : Number((p as any).weight_oz);
      if (w != null && Number.isFinite(w) && w > 0) {
        bySlug.set(String((p as any).slug), w);
      }
    }
    for (const li of (order.line_items as any[] | null) || []) {
      const slug = String(li?.product_slug || "");
      const qty = Math.max(1, Number(li?.quantity) || 1);
      const w = bySlug.get(slug);
      if (w) weightOz += w * qty;
    }
  }
  if (weightOz <= 0) {
    return fail(409, "Order has no shipping weight — can't quote a return label.");
  }

  // Stylist contact (Shippo requires email + phone on transactions). Same
  // lookups the outbound label / rate-shopping flows use.
  let fromEmail = "";
  let fromPhone = "";
  try {
    const { data: w } = await admin.auth.admin.getUserById(userId);
    fromEmail = String(w?.user?.email || "").trim();
  } catch {
    /* non-fatal */
  }
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
  } catch {
    /* non-fatal */
  }

  let rates: NormalizedRate[];
  try {
    rates = await fetchShipmentRates({
      token,
      // Reversed: the buyer is shipping back to the shop.
      from: {
        name: order.customer_name || "Customer",
        street1: String(shipAddr.line1 || ""),
        street2: String(shipAddr.line2 || ""),
        city: String(shipAddr.city || ""),
        state: String(shipAddr.state || ""),
        zip: String(shipAddr.postal_code || ""),
        country: String(shipAddr.country || "US"),
        email: order.customer_email || fromEmail,
        phone: fromPhone, // buyer phone not collected; fall back to shop's
      },
      to: {
        name: "Shop",
        street1: String((shop as any)?.pickup_address_line1 || ""),
        street2: String((shop as any)?.pickup_address_line2 || ""),
        city: String((shop as any)?.pickup_city || ""),
        state: String((shop as any)?.pickup_state || ""),
        zip: pickupZip,
        country: "US",
        email: fromEmail,
        phone: fromPhone,
      },
      parcel: { length: parcelL, width: parcelW, height: parcelH, weight_oz: weightOz },
    });
  } catch (e: any) {
    console.warn(`[return-label] rate fetch failed for ${orderId}: ${e?.message || e}`);
    return fail(502, "Couldn't fetch return rates from Shippo.");
  }
  if (rates.length === 0) {
    return fail(409, "No carriers can ship a return from that address.");
  }

  // Pick the same carrier+service as the outbound shipment when available;
  // otherwise the cheapest rate at the same carrier; otherwise the overall
  // cheapest. Return labels shouldn't be premium — a slow + cheap option
  // is fine.
  const wantCarrier = (order.shipping_carrier || "").toLowerCase();
  const wantService = (order.shipping_service || "").toLowerCase();
  const sameCarrierRates = rates.filter((r) => r.carrier.toLowerCase() === wantCarrier);
  const chosen =
    sameCarrierRates.find((r) => r.service.toLowerCase() === wantService) ||
    sameCarrierRates[0] ||
    rates[0];

  let label;
  try {
    label = await buyLabel(token, chosen.id);
  } catch (e: any) {
    console.warn(`[return-label] buy failed for ${orderId}: ${e?.message || e}`);
    return fail(502, "Couldn't buy the return label. Try again in a moment.");
  }
  if (!label.label_url || !label.tracking_number) {
    return fail(502, "Shippo returned an incomplete label.");
  }

  const nowIso = new Date().toISOString();
  const { error: updErr } = await admin
    .from("product_orders")
    .update({
      return_label_url: label.label_url,
      return_tracking_number: label.tracking_number,
      return_tracking_url: label.tracking_url,
      return_purchased_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", orderId)
    .is("return_label_url", null); // race guard
  if (updErr) return fail(500, updErr.message);

  console.log(
    `[return-label] order ${orderId}: bought ${chosen.carrier} ${chosen.service} ($${(chosen.amount_cents / 100).toFixed(2)}) tracking ${label.tracking_number}`,
  );

  return NextResponse.json({
    label_url: label.label_url,
    tracking_number: label.tracking_number,
    tracking_url: label.tracking_url,
    carrier: chosen.carrier,
    service: chosen.service,
    amount_cents: chosen.amount_cents,
    already: false,
  });
}
