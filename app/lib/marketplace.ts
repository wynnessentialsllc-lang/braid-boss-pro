// Mini-marketplace V1 — discovery fetch + opt-in API.
//
// The public /discover page calls fetchDiscoverStylists (anon,
// through the public_discover_stylists RPC). The in-app Marketplace
// screen uses loadMarketplaceListing / saveMarketplaceListing to
// flip the opt-in flag and set the city/state that drives search.

import { getSupabase } from "./supabase";

// Canonical braid-style vocabulary. MUST stay in sync with the
// services_style_tags_chk constraint in
// 20261117000000_marketplace_phase1_opt_out.sql. The /discover filter
// chips and the in-app service editor both render from this list, so a
// stylist can only ever tag services with slugs the marketplace knows
// how to filter on.
export const STYLE_TAGS: ReadonlyArray<{ slug: string; label: string }> = [
  { slug: "knotless", label: "Knotless" },
  { slug: "boho", label: "Boho" },
  { slug: "micros", label: "Micros" },
  { slug: "feed_in", label: "Feed-in / Stitch" },
  { slug: "cornrows", label: "Cornrows" },
  { slug: "twists", label: "Twists" },
  { slug: "locs", label: "Locs" },
  { slug: "passion_twists", label: "Passion Twists" },
  { slug: "kids", label: "Kids" },
  { slug: "takedown", label: "Takedown / Maintenance" },
] as const;

const STYLE_LABEL = new Map(STYLE_TAGS.map(s => [s.slug, s.label]));
export const styleLabel = (slug: string): string => STYLE_LABEL.get(slug) || slug;

export type DiscoverStylist = {
  slug: string;
  businessName: string;
  logoUrl: string | null;
  coverPhoto: string | null;   // gallery-first hero image (falls back to logo)
  city: string | null;
  state: string | null;
  intro: string | null;
  priceMin: number | null;
  priceMax: number | null;
  ratingAvg: number | null;
  ratingCount: number;
  styleTags: string[];         // canonical slugs this stylist offers
  travels: boolean;            // offers mobile / travels to client
};

export type DiscoverFilters = {
  city?: string;
  style?: string;              // one canonical style slug
  mobileOnly?: boolean;
  minRating?: number;
};

// Public, anon-callable. Empty filters => browse every listed stylist.
export const fetchDiscoverStylists = async (
  filters: DiscoverFilters = {},
): Promise<DiscoverStylist[]> => {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("public_discover_stylists", {
    city_in: filters.city?.trim() || null,
    style_in: filters.style?.trim() || null,
    mobile_only: filters.mobileOnly ?? false,
    min_rating: filters.minRating ?? null,
  });
  if (error) throw error;
  return ((data || []) as any[]).map(r => ({
    slug: String(r.slug || ""),
    businessName: String(r.business_name || "Braid stylist"),
    logoUrl: r.logo_url || null,
    coverPhoto: r.cover_photo || r.logo_url || null,
    city: r.business_city || null,
    state: r.business_state || null,
    intro: r.intro || null,
    priceMin: r.price_min == null ? null : Number(r.price_min),
    priceMax: r.price_max == null ? null : Number(r.price_max),
    ratingAvg: r.rating_avg == null ? null : Number(r.rating_avg),
    ratingCount: Number(r.rating_count) || 0,
    styleTags: Array.isArray(r.style_tags) ? (r.style_tags as string[]) : [],
    travels: Boolean(r.travels),
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

// Phase 1 is OPT-OUT: a complete + active stylist is auto-listed unless
// they set `hidden`. The in-app Account & Sync card surfaces this status
// plus a completeness checklist — the same gate the discovery RPC
// enforces, mirrored client-side so the stylist sees exactly what's
// missing before they show up.
export type MarketplaceListing = {
  hidden: boolean;           // the opt-out flag (false => eligible to list)
  city: string;
  state: string;
  slug: string | null;       // null when the stylist has no booking link yet
  bookingLinkActive: boolean;
  hasImage: boolean;         // logo or at least one gallery photo
  hasPricedService: boolean; // ≥1 active service with a price
};

// Derived: is this stylist actually appearing on /discover right now?
export const isListed = (l: MarketplaceListing): boolean =>
  !l.hidden &&
  l.bookingLinkActive &&
  !!l.slug &&
  l.city.trim().length > 0 &&
  l.hasImage &&
  l.hasPricedService;

// Human-readable list of what's still blocking a listing (empty => listed).
export const listingGaps = (l: MarketplaceListing): string[] => {
  const gaps: string[] = [];
  if (!l.slug) gaps.push("Set up your booking link");
  else if (!l.bookingLinkActive) gaps.push("Turn your booking link back on");
  if (l.city.trim().length === 0) gaps.push("Add the city you work in");
  if (!l.hasImage) gaps.push("Add a logo or at least one gallery photo");
  if (!l.hasPricedService) gaps.push("Add at least one active service with a price");
  return gaps;
};

// Reads the stylist's booking_links row plus the two completeness
// signals that don't live on it (an image, a priced service).
export const loadMarketplaceListing = async (
  userId: string,
): Promise<MarketplaceListing> => {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("booking_links")
    .select("marketplace_hidden, business_city, business_state, slug, active, logo_url, gallery_photos")
    .eq("user_id", userId)
    .maybeSingle();
  const { count } = await supabase
    .from("services")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_active", true)
    .gt("base_price", 0);
  const gallery = Array.isArray(data?.gallery_photos) ? data!.gallery_photos : [];
  return {
    hidden: data?.marketplace_hidden ?? false,
    city: data?.business_city || "",
    state: data?.business_state || "",
    slug: data?.slug || null,
    bookingLinkActive: data?.active ?? false,
    hasImage: !!(data?.logo_url) || gallery.length > 0,
    hasPricedService: (count ?? 0) > 0,
  };
};

// Writes the marketplace-owned fields back onto booking_links. Only the
// opt-out flag + city/state — never touches slug / services / hours.
// Fails clearly if the stylist has no booking link yet.
export const saveMarketplaceListing = async (
  userId: string,
  patch: { hidden: boolean; city: string; state: string },
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
      marketplace_hidden: patch.hidden,
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
