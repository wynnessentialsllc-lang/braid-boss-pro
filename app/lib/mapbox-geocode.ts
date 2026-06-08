// Mapbox geocoder helper — shared between /api/mobile-geocode (stylist
// verifies their travel base) and /api/mobile-quote (client checks
// their address against the stylist's service area).
//
// The bare Mapbox call rejects partial inputs like "5309 Knowlton St"
// because the same street name exists in multiple cities. Two cheap
// improvements rescue the most common bad input:
//
//   1. Append the stylist's city + state to the query when the typed
//      address doesn't already include them. "5309 Knowlton St" then
//      becomes "5309 Knowlton St, Los Angeles, CA" before it leaves
//      our server — Mapbox locks straight onto the address.
//   2. Pass a proximity bias (lat/lng) so Mapbox prefers nearby hits
//      over identically-named streets in other states.
//
// We also flip on autocomplete + bump the candidate cap so a near-miss
// still resolves instead of failing outright. Mapbox doesn't charge
// differently for any of these tweaks.

import { normalizeZip } from "./mobile-service";

export type GeocodeHit = {
  lat: number;
  lng: number;
  zip: string;
  label: string;
};

export type GeocodeContext = {
  city?: string | null;
  state?: string | null;
  proximity?: { lat: number; lng: number } | null;
};

const ALPHA = /^[A-Za-z]+$/;

// Loose check: does the typed address already include something that
// looks like a US state? Catches "CA", "California", "tx", "Texas".
const hasStateHint = (address: string, state: string | null | undefined): boolean => {
  const s = address.toLowerCase();
  if (state && ALPHA.test(state)) {
    if (s.includes(`, ${state.toLowerCase()}`)) return true;
    if (s.includes(` ${state.toLowerCase()} `)) return true;
    if (s.endsWith(` ${state.toLowerCase()}`)) return true;
  }
  // Any 5-digit zip implies enough specificity to skip the augment.
  return /\b\d{5}(-\d{4})?\b/.test(s);
};

const hasCityHint = (address: string, city: string | null | undefined): boolean => {
  if (!city) return false;
  return address.toLowerCase().includes(city.toLowerCase());
};

/** Augment a partial address with the stylist's city/state when missing. */
export const augmentAddress = (
  raw: string,
  ctx: Pick<GeocodeContext, "city" | "state">,
): string => {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  const city = (ctx.city || "").trim();
  const state = (ctx.state || "").trim();
  // If both bits are missing OR we can already see the state / a zip,
  // leave it alone — augmenting a complete address with a duplicate
  // city would confuse Mapbox.
  if (!city && !state) return trimmed;
  if (hasStateHint(trimmed, state)) return trimmed;

  const pieces: string[] = [trimmed];
  if (city && !hasCityHint(trimmed, city)) pieces.push(city);
  if (state) pieces.push(state);
  return pieces.join(", ");
};

/**
 * Geocode an address through Mapbox with the stylist's location as
 * context. Returns null when no usable feature comes back.
 */
export const geocodeAddress = async (
  token: string,
  rawAddress: string,
  context: GeocodeContext = {},
): Promise<GeocodeHit | null> => {
  if (!token) return null;
  const query = augmentAddress(rawAddress, context);
  if (!query) return null;

  const url = new URL(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`,
  );
  url.searchParams.set("access_token", token);
  url.searchParams.set("country", "us");
  url.searchParams.set("types", "address,postcode,place");
  // Bump from 1 -> 5 + flip autocomplete on so a partial / lightly
  // misspelled address still has a chance to resolve. We pick the
  // first US "address" feature when there's more than one hit.
  url.searchParams.set("limit", "5");
  url.searchParams.set("autocomplete", "true");
  if (context.proximity
      && Number.isFinite(context.proximity.lat)
      && Number.isFinite(context.proximity.lng)) {
    url.searchParams.set("proximity", `${context.proximity.lng},${context.proximity.lat}`);
  }

  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null) as any;
  const features: any[] = Array.isArray(body?.features) ? body.features : [];
  if (features.length === 0) return null;
  // Prefer an "address" feature over a postcode/place when we have a
  // mix; Mapbox returns them in best-match order so the first
  // address-typed feature is the right pick.
  const feature =
    features.find(f => Array.isArray(f?.place_type) && f.place_type.includes("address"))
    || features[0];
  if (!feature || !Array.isArray(feature.center) || feature.center.length < 2) return null;

  const [lng, lat] = feature.center as [number, number];
  const contextZip = Array.isArray(feature.context)
    ? feature.context.find(
        (c: any) => typeof c?.id === "string" && c.id.startsWith("postcode"),
      )?.text
    : null;
  const zip = normalizeZip(contextZip || feature.text || feature.place_name);

  return {
    lat: Number(lat),
    lng: Number(lng),
    zip,
    label: String(feature.place_name || query).slice(0, 200),
  };
};
