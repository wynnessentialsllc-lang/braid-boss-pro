// POST /api/shipping-rates  { handle, items, ship_to }
//
// Live carrier (Shippo) rate-shopping for a storefront cart. Returns a list of
// rates the buyer can pick from before checkout; the chosen rate's id is then
// passed to /api/product-checkout, which re-fetches it from Shippo to confirm
// the amount before charging. Two-step on purpose:
//   1. Quote here (token-protected, server-only) — cheap to call, no order yet.
//   2. Confirm at checkout — Shippo rates expire (~7d), so a stale id is caught.
//
// Validates that the shop is configured for carrier shipping (mode='carrier',
// has a Shippo token, a default parcel, and a pickup address). Each cart line
// must resolve via the public product RPC and carry a weight_oz; missing
// weight is a clean 400 because a 0-weight shipment yields nonsense rates.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchShipmentRates, type NormalizedRate } from "../../lib/shippo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LINES = 30;

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};
const fail = (status: number, message: string) =>
  NextResponse.json({ error: message }, { status });

type RateLineInput = {
  product_slug?: string;
  quantity?: number;
  variant_id?: string | null;
};

type ShipTo = {
  zip?: string;
  state?: string | null;
  city?: string | null;
  country?: string | null;
};

export async function POST(req: Request) {
  let body: { handle?: string; items?: RateLineInput[]; ship_to?: ShipTo };
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid JSON body.");
  }
  const handle = (body?.handle || "").trim().replace(/^@/, "");
  if (!handle) return fail(400, "Missing stylist handle.");

  const shipTo = body?.ship_to || {};
  const zip = String(shipTo.zip || "").trim();
  if (!/^\d{5}(?:-\d{4})?$/.test(zip)) {
    return fail(400, "Enter a valid US ZIP code.");
  }
  const country = (String(shipTo.country || "US").trim() || "US").toUpperCase();
  if (country !== "US") {
    // Shippo supports international, but the storefront flow + Stripe shipping
    // collection are US-only today. Reject explicitly so a wrong country
    // doesn't quietly produce no rates.
    return fail(400, "Only US shipping addresses are supported.");
  }

  const inputItems: Array<{ slug: string; quantity: number; variant_id: string | null }> = [];
  for (const raw of Array.isArray(body.items) ? body.items : []) {
    const slug = String(raw?.product_slug || "").trim();
    if (!slug) continue;
    const q = Math.max(1, Math.min(99, Math.floor(Number(raw?.quantity || 1))));
    const vid =
      typeof raw?.variant_id === "string" && raw.variant_id.trim() ? raw.variant_id.trim() : null;
    inputItems.push({ slug, quantity: q, variant_id: vid });
  }
  if (inputItems.length === 0) return fail(400, "Cart is empty.");
  if (inputItems.length > MAX_LINES) return fail(400, `Cart exceeds ${MAX_LINES} items.`);

  let supabaseUrl: string;
  let serviceKey: string;
  try {
    supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || env("SUPABASE_URL");
    serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  } catch (e: any) {
    return fail(500, e?.message || "Server is not configured.");
  }
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Resolve stylist user_id from the public handle (anon-safe RPC).
  const { data: resolved } = await admin.rpc("public_resolve_booking_slug", { slug_in: handle });
  const row = Array.isArray(resolved) ? resolved[0] : resolved;
  const userId = row?.user_id ? String(row.user_id) : null;
  if (!userId) return fail(404, "Shop not found.");

  // Pull the carrier config + pickup address. shop_settings is owner-only RLS;
  // we read it via the service role specifically because the token is a
  // per-stylist secret that the storefront must never see.
  const { data: shop } = await admin
    .from("shop_settings")
    .select(
      "shipping_enabled, shipping_mode, shippo_api_token, ship_parcel_length_in, ship_parcel_width_in, ship_parcel_height_in, pickup_address_line1, pickup_address_line2, pickup_city, pickup_state, pickup_postal_code",
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (!shop || !shop.shipping_enabled) {
    return fail(409, "This shop doesn't offer shipping.");
  }
  if (shop.shipping_mode !== "carrier") {
    // Defensive: the storefront only calls this when the shop is in carrier
    // mode, but a stale tab could call it after the shop flipped back to
    // flat. Tell the caller plainly so it can fall back to the flat rate.
    return fail(409, "This shop uses a flat shipping rate.");
  }
  const token = String(shop.shippo_api_token || "").trim();
  if (!token) {
    return fail(409, "This shop hasn't finished Shippo setup.");
  }
  const parcelL = Number(shop.ship_parcel_length_in);
  const parcelW = Number(shop.ship_parcel_width_in);
  const parcelH = Number(shop.ship_parcel_height_in);
  if (![parcelL, parcelW, parcelH].every((n) => Number.isFinite(n) && n > 0)) {
    return fail(409, "This shop hasn't set a default package size.");
  }
  const fromZip = String(shop.pickup_postal_code || "").trim();
  if (!fromZip) {
    return fail(409, "This shop hasn't set a pickup address.");
  }

  // Sum cart weight from products.weight_oz. We read products directly (admin)
  // rather than widening the public RPC just for this — the rate-shopping
  // call is server-only and we already need the service role for the token.
  const slugs = Array.from(new Set(inputItems.map((i) => i.slug)));
  const { data: products, error: prodErr } = await admin
    .from("products")
    .select("slug, weight_oz, active, title")
    .eq("user_id", userId)
    .in("slug", slugs);
  if (prodErr) return fail(500, prodErr.message);
  const bySlug = new Map<string, { weight_oz: number | null; active: boolean; title: string }>();
  for (const p of products || []) {
    bySlug.set(String((p as any).slug), {
      weight_oz: (p as any).weight_oz == null ? null : Number((p as any).weight_oz),
      active: !!(p as any).active,
      title: String((p as any).title || ""),
    });
  }

  let totalWeightOz = 0;
  for (const item of inputItems) {
    const p = bySlug.get(item.slug);
    if (!p || !p.active) return fail(404, `Product not found: ${item.slug}`);
    if (p.weight_oz == null || !Number.isFinite(p.weight_oz) || p.weight_oz <= 0) {
      return fail(409, `'${p.title || item.slug}' is missing a shipping weight.`);
    }
    totalWeightOz += p.weight_oz * item.quantity;
  }

  // Pull the stylist's email + phone for the shipment's address_from. Shippo
  // requires both on transactions (label purchase) so carriers can deliver
  // tracking notifications; setting them at quote time lets the same shipment
  // object be promoted to a transaction in phase 3b without re-creation.
  // auth.users is the canonical email; booking_links holds the public phone.
  let fromEmail = "";
  let fromPhone = "";
  try {
    const { data } = await admin.auth.admin.getUserById(userId);
    fromEmail = String(data?.user?.email || "").trim();
  } catch {
    /* non-fatal — Shippo's email requirement only bites at label purchase */
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
      from: {
        name: "Shop",
        street1: shop.pickup_address_line1 || "",
        street2: shop.pickup_address_line2 || "",
        city: shop.pickup_city || "",
        state: shop.pickup_state || "",
        zip: fromZip,
        country: "US",
        email: fromEmail,
        phone: fromPhone,
      },
      to: {
        name: "Customer",
        // Buyer hasn't entered a street yet — Stripe Checkout collects that.
        // For domestic carrier quotes, ZIP + state are enough; an empty
        // street1 is accepted by Shippo for rate quotes.
        street1: "",
        city: shipTo.city || "",
        state: shipTo.state || "",
        zip,
        country: "US",
      },
      parcel: {
        length: parcelL,
        width: parcelW,
        height: parcelH,
        weight_oz: totalWeightOz,
      },
    });
  } catch (e: any) {
    // Shippo failures: 4xx (bad address, missing parcel) and 5xx (transient).
    // We log the full message but return a generic + retryable hint so a
    // weird Shippo response can't leak the token / account details to the UI.
    console.warn(`[shipping-rates] Shippo error for ${userId}: ${e?.message || e}`);
    return fail(502, "Couldn't fetch live shipping rates. Try again in a moment.");
  }

  if (rates.length === 0) {
    return fail(409, "No carriers can ship this order to that address.");
  }

  return NextResponse.json({ rates });
}
