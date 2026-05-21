// Mini-marketplace V1 — discovery fetch + opt-in API.
//
// The public /discover page calls fetchDiscoverStylists (anon,
// through the public_discover_stylists RPC). The in-app Marketplace
// screen uses loadMarketplaceListing / saveMarketplaceListing to
// flip the opt-in flag and set the city/state that drives search.

import { getSupabase } from "./supabase";

export type DiscoverStylist = {
  slug: string;
  businessName: string;
  logoUrl: string | null;
  city: string | null;
  state: string | null;
  intro: string | null;
  priceMin: number | null;
  priceMax: number | null;
  ratingAvg: number | null;
  ratingCount: number;
};

// Public, anon-callable. city blank => browse every listed stylist.
export const fetchDiscoverStylists = async (
  city?: string,
): Promise<DiscoverStylist[]> => {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("public_discover_stylists", {
    city_in: city?.trim() || null,
  });
  if (error) throw error;
  return ((data || []) as any[]).map(r => ({
    slug: String(r.slug || ""),
    businessName: String(r.business_name || "Braid stylist"),
    logoUrl: r.logo_url || null,
    city: r.business_city || null,
    state: r.business_state || null,
    intro: r.intro || null,
    priceMin: r.price_min == null ? null : Number(r.price_min),
    priceMax: r.price_max == null ? null : Number(r.price_max),
    ratingAvg: r.rating_avg == null ? null : Number(r.rating_avg),
    ratingCount: Number(r.rating_count) || 0,
  })).filter(s => s.slug);
};

export type StylistReview = {
  stars: number;
  notes: string | null;
  displayName: string | null;
  submittedAt: string | null;
};

// Public, anon-callable. A stylist's client reviews by booking-link
// slug — same status<>'hidden' filter the marketplace card count
// uses, so count and content always agree. Used by both the
// /discover card and the public booking page.
export const fetchStylistReviews = async (
  slug: string,
): Promise<StylistReview[]> => {
  if (!slug) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("public_stylist_reviews", {
    slug_in: slug,
  });
  if (error) throw error;
  return ((data || []) as any[]).map(r => ({
    stars: Number(r.stars) || 0,
    notes: r.notes || null,
    displayName: r.display_name || null,
    submittedAt: r.submitted_at || null,
  }));
};

export type MarketplaceListing = {
  enabled: boolean;
  city: string;
  state: string;
  slug: string | null;       // null when the stylist has no booking link yet
  bookingLinkActive: boolean;
};

// Reads the stylist's own booking_links row — the marketplace
// listing rides on it (opt-in flag + city/state + slug).
export const loadMarketplaceListing = async (
  userId: string,
): Promise<MarketplaceListing> => {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("booking_links")
    .select("marketplace_enabled, business_city, business_state, slug, active")
    .eq("user_id", userId)
    .maybeSingle();
  return {
    enabled: data?.marketplace_enabled ?? false,
    city: data?.business_city || "",
    state: data?.business_state || "",
    slug: data?.slug || null,
    bookingLinkActive: data?.active ?? false,
  };
};

// Writes the marketplace fields back onto booking_links. Only the
// columns this screen owns — never touches slug / services / hours.
// Fails clearly if the stylist has no booking link yet (you can't
// be listed without a booking page to link to).
export const saveMarketplaceListing = async (
  userId: string,
  patch: { enabled: boolean; city: string; state: string },
): Promise<void> => {
  const supabase = getSupabase();
  const { data: existing } = await supabase
    .from("booking_links")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!existing) {
    throw new Error("Set up your booking link first — the marketplace listing links to it.");
  }
  const { error } = await supabase
    .from("booking_links")
    .update({
      marketplace_enabled: patch.enabled,
      business_city: patch.city.trim() || null,
      business_state: patch.state.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  if (error) throw error;
};

export const priceRangeLabel = (
  min: number | null,
  max: number | null,
  currency: string = "USD",
): string | null => {
  const fmt = (n: number) => {
    try { return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n); }
    catch { return `$${Math.round(n)}`; }
  };
  if (min == null && max == null) return null;
  if (min != null && max != null) {
    return min === max ? `${fmt(min)}` : `${fmt(min)}–${fmt(max)}`;
  }
  return fmt((min ?? max) as number);
};
