// Local-delivery radius check (server-only).
//
// Resolves whether a buyer ZIP falls within a shop's max delivery radius,
// reusing the mobile-service distance math + the Mapbox geocoder. Distance is
// ZIP-centroid to ZIP-centroid: that's the granularity the buyer provides, and
// ZIP geocoding is far more reliable than resolving a full street address
// (which often returns nothing). The shop origin is geocoded once and cached
// on shop_settings.
//
// Fail-open: if we can't geocode either point (no token, Mapbox miss, etc.) we
// return { configured: false } so the caller treats delivery as allowed rather
// than wrongly rejecting a real buyer. Only a successfully-computed distance
// beyond the radius blocks. Used by /api/delivery-check (buyer preview) and the
// checkout route (authoritative gate).

import type { SupabaseClient } from "@supabase/supabase-js";
import { geocodeAddress } from "./mapbox-geocode";
import { haversineMiles, isInServiceArea, normalizeZip } from "./mobile-service";

export type DeliveryCheck =
  | { configured: false }
  | { configured: true; within: boolean; miles: number; radius: number };

export async function checkDeliveryRadius(
  admin: SupabaseClient,
  mapboxToken: string,
  userId: string,
  buyerZipRaw: string,
): Promise<DeliveryCheck> {
  const { data: s } = await admin
    .from("shop_settings")
    .select(
      "delivery_enabled, delivery_radius_miles, delivery_origin_lat, delivery_origin_lng, pickup_address_line1, pickup_city, pickup_state, pickup_postal_code",
    )
    .eq("user_id", userId)
    .maybeSingle();

  const radius = Number((s as any)?.delivery_radius_miles);
  // No delivery, no radius, or no geocoder → nothing to enforce (allow).
  if (!s || !(s as any).delivery_enabled || !Number.isFinite(radius) || radius <= 0 || !mapboxToken) {
    return { configured: false };
  }
  const row = s as any;

  // Resolve the origin, geocoding + caching on first use. Prefer the pickup
  // ZIP (reliable); fall back to the full street address only if there's no ZIP.
  // NB: coerce null → NaN explicitly — Number(null) is 0, which would look like
  // a valid (0,0) origin and skip geocoding entirely.
  let originLat = row.delivery_origin_lat == null ? NaN : Number(row.delivery_origin_lat);
  let originLng = row.delivery_origin_lng == null ? NaN : Number(row.delivery_origin_lng);
  if (!Number.isFinite(originLat) || !Number.isFinite(originLng)) {
    const originZip = normalizeZip(row.pickup_postal_code);
    const fullAddr = [row.pickup_address_line1, row.pickup_city, row.pickup_state, row.pickup_postal_code]
      .filter(Boolean)
      .join(", ");
    const originHit = originZip
      ? await geocodeAddress(mapboxToken, originZip, { state: row.pickup_state })
      : fullAddr
        ? await geocodeAddress(mapboxToken, fullAddr, { city: row.pickup_city, state: row.pickup_state })
        : null;
    if (!originHit) {
      console.warn(`[delivery] origin geocode failed for ${userId} (zip=${originZip || "none"})`);
      return { configured: false };
    }
    originLat = originHit.lat;
    originLng = originHit.lng;
    await admin
      .from("shop_settings")
      .update({
        delivery_origin_lat: originLat,
        delivery_origin_lng: originLng,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
  }

  const zip = normalizeZip(buyerZipRaw);
  if (!zip) return { configured: false };
  const buyerHit = await geocodeAddress(mapboxToken, zip, {
    state: row.pickup_state,
    proximity: { lat: originLat, lng: originLng },
  });
  if (!buyerHit) {
    console.warn(`[delivery] buyer ZIP geocode failed for ${userId} (zip=${zip})`);
    return { configured: false };
  }

  const miles = haversineMiles({ lat: originLat, lng: originLng }, { lat: buyerHit.lat, lng: buyerHit.lng });
  // Small buffer so a centroid sitting just past the line isn't a false reject.
  const area = isInServiceArea({ radius_miles: radius + 0.5, blocked_zips: [] }, miles, zip);
  return { configured: true, within: area.ok, miles: Math.round(miles * 10) / 10, radius };
}
