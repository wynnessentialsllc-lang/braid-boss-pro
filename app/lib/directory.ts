// Server-side helpers for the crawlable /braiders directory (the SEO
// engine that turns opted-in stylists into indexable city + style
// landing pages). Everything here is fail-soft: the RPC calls are
// wrapped so a build-time prerender or a transient Supabase outage
// yields an empty directory (pages still render) instead of throwing.
//
// React `cache` dedupes the underlying fetch within a single request, so
// a page's generateMetadata and its body share one RPC round-trip.

import { cache } from "react";
import { fetchDiscoverStylists, type DiscoverStylist } from "./marketplace";

export type CityGroup = {
  slug: string;
  city: string;
  state: string | null;
  label: string;
  count: number;
};

// "Atlanta", "GA" -> "atlanta-ga". Stable, URL-safe, and reversible
// enough that we can match a slug back to a city group built from live
// data (we never reconstruct the display name from the slug — we look it
// up in the grouped list instead).
export const citySlug = (city: string, state?: string | null): string =>
  [city, state]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const cityLabel = (city: string, state?: string | null): string =>
  state ? `${city}, ${state}` : city;

// All opted-in, listed stylists. Cached per request; never throws.
export const getListedStylists = cache(async (): Promise<DiscoverStylist[]> => {
  try {
    return await fetchDiscoverStylists();
  } catch {
    return [];
  }
});

// Stylists offering a given canonical style slug. Cached per request.
export const getStylistsByStyle = cache(async (style: string): Promise<DiscoverStylist[]> => {
  try {
    return await fetchDiscoverStylists({ style });
  } catch {
    return [];
  }
});

// Distinct cities among listed stylists, most-populated first.
export const groupCities = (stylists: DiscoverStylist[]): CityGroup[] => {
  const map = new Map<string, CityGroup>();
  for (const s of stylists) {
    if (!s.city) continue;
    const slug = citySlug(s.city, s.state);
    if (!slug) continue;
    const existing = map.get(slug);
    if (existing) existing.count += 1;
    else map.set(slug, { slug, city: s.city, state: s.state, label: cityLabel(s.city, s.state), count: 1 });
  }
  return Array.from(map.values()).sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label),
  );
};

// Look up a single city group by its slug, plus the stylists in it.
export const getCityGroup = cache(
  async (slug: string): Promise<{ group: CityGroup; stylists: DiscoverStylist[] } | null> => {
    const all = await getListedStylists();
    const inCity = all.filter((s) => s.city && citySlug(s.city, s.state) === slug);
    if (inCity.length === 0) return null;
    const first = inCity[0];
    return {
      group: {
        slug,
        city: first.city as string,
        state: first.state,
        label: cityLabel(first.city as string, first.state),
        count: inCity.length,
      },
      stylists: inCity,
    };
  },
);
