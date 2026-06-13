// Local-delivery radius check (server-only).
//
// Resolves whether a buyer ZIP falls within a shop's max delivery radius,
// reusing the mobile-service distance math + the Mapbox geocoder. The shop's
// geocoded origin is cached on shop_settings so we don't re-geocode the shop
// address on every request. Used by both /api/delivery-check (buyer UI
// preview) and the checkout route (authoritative gate).

import type { SupabaseClient } from "@supabase/supabase-js";
import { geocodeAddress } from "./mapbox-geocode";
import { haversineMiles, isInServiceArea, normalizeZip } from "./mobile-service";

export type DeliveryCheck =
  | { configured: false }
  | { configured: true; within: boolean; miles: number; radius: number; reason?: string };

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
  // No delivery, no radius, or no Mapbox token → nothing to enforce.
  if (!s || !(s as any).delivery_enabled || !Number.isFinite(radius) || radius <= 0 || !mapboxToken) {
    return { configured: false };
  }

  // Resolve the origin coords, geocoding + caching the shop address on first use.
  let originLat = Number((s as any).delivery_origin_lat);
  let originLng = Number((s as any).delivery_origin_lng);
  if (!Number.isFinite(originLat) || !Number.isFinite(originLng)) {
    const originAddr = [
      (s as any).pickup_address_line1,
      (s as any).pickup_city,
      (s as any).pickup_state,
      (s as any).pickup_postal_code,
    ]
      .filter(Boolean)
      .join(", ");
    if (!originAddr) return { configured: true, within: false, miles: 0, radius, reason: "no_origin" };
    const originHit = await geocodeAddress(mapboxToken, originAddr, {
      city: (s as any).pickup_city,
      state: (s as any).pickup_state,
    });
    if (!originHit) return { configured: true, within: false, miles: 0, radius, reason: "no_origin" };
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
  if (!zip) return { configured: true, within: false, miles: 0, radius, reason: "bad_zip" };

  const buyerHit = await geocodeAddress(mapboxToken, zip, {
    state: (s as any).pickup_state,
    proximity: { lat: originLat, lng: originLng },
  });
  if (!buyerHit) return { configured: true, within: false, miles: 0, radius, reason: "bad_zip" };

  const miles = haversineMiles({ lat: originLat, lng: originLng }, { lat: buyerHit.lat, lng: buyerHit.lng });
  const area = isInServiceArea({ radius_miles: radius, blocked_zips: [] }, miles, zip);
  return { configured: true, within: area.ok, miles: Math.round(miles * 10) / 10, radius };
}
