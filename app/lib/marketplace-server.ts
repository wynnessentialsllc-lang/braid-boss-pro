// Server-only marketplace fetcher.
//
// Calls the same anon-callable RPCs that /discover uses, but via
// plain fetch so it works during build (sitemap) and in server
// components without sharing the browser supabase singleton.
//
// Cached for 1 hour — discovery data changes slowly and the SEO
// pages don't need to be perfectly fresh.

import "server-only";
import type { StylistSeo } from "./seo";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://bjqazhplxqqhftekspfl.supabase.co";
const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "sb_publishable_b-GByxuYeehWa-9F7Z1MdQ_FKqx32XO";

const REVALIDATE_SECONDS = 3600;

const callRpc = async <T = unknown>(
  fn: string,
  body: Record<string, unknown>,
): Promise<T[]> => {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
      },
      body: JSON.stringify(body),
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json) ? (json as T[]) : [];
  } catch {
    return [];
  }
};

const mapStylist = (r: any): StylistSeo => ({
  slug: String(r.slug || ""),
  businessName: String(r.business_name || "Braid stylist"),
  intro: r.intro || null,
  logoUrl: r.logo_url || null,
  city: r.business_city || null,
  state: r.business_state || null,
  priceMin: r.price_min == null ? null : Number(r.price_min),
  priceMax: r.price_max == null ? null : Number(r.price_max),
  ratingAvg: r.rating_avg == null ? null : Number(r.rating_avg),
  ratingCount: Number(r.rating_count) || 0,
});

export const fetchDiscoverStylistsServer = async (
  city?: string,
): Promise<StylistSeo[]> => {
  const rows = await callRpc<any>("public_discover_stylists", {
    city_in: city?.trim() || null,
  });
  return rows.map(mapStylist).filter(s => s.slug);
};

// Public services by stylist slug — used to decide which stylists
// "offer" a given style on the city × style matrix pages. Falls back
// to empty when the public RPC isn't available.
export type PublicServiceLite = {
  name: string;
  price: number | null;
};

export const fetchPublicServicesBySlug = async (
  slug: string,
): Promise<PublicServiceLite[]> => {
  const rows = await callRpc<any>("public_list_services", { slug_in: slug });
  return rows.map(r => ({
    name: String(r.name || ""),
    price: r.base_price == null ? null : Number(r.base_price),
  })).filter(s => s.name);
};

// Public reviews by slug, server-side.
export type PublicReviewLite = {
  stars: number;
  notes: string | null;
  displayName: string | null;
  submittedAt: string | null;
};

export const fetchStylistReviewsServer = async (
  slug: string,
): Promise<PublicReviewLite[]> => {
  const rows = await callRpc<any>("public_stylist_reviews", { slug_in: slug });
  return rows.map(r => ({
    stars: Number(r.stars) || 0,
    notes: r.notes || null,
    displayName: r.display_name || null,
    submittedAt: r.submitted_at || null,
  }));
};
