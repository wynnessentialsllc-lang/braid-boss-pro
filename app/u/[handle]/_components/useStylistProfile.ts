"use client";

// Resolve a /@handle URL segment to the canonical booking-link row
// using the SECURITY DEFINER `public_resolve_booking_slug` RPC. The
// resolver was originally built for the /book/<slug> route — it
// accepts either the random legacy slug or the branded profile slug
// and returns the canonical booking-link fields. The storefront
// pages use the same resolver so a stylist's branded URL keeps
// working everywhere.

import { useEffect, useState } from "react";
import { getSupabase } from "../../../lib/supabase";

export type StylistProfile = {
  user_id: string;
  slug: string;              // Canonical booking_links.slug
  branded_slug: string | null;
  business_name: string | null;
  // Storefront-only brand/store name. Falls back to business_name when
  // null so existing shops are unchanged. See 20260911 migration.
  shop_name: string | null;
  intro: string | null;
  logo_url: string | null;
  banner_image_url: string | null;
  // Storefront-only branding overrides (20260912). Each falls back to
  // its booking-page counterpart (logo_url / banner_image_url) when
  // null, so existing shops render exactly as before.
  shop_logo_url: string | null;
  shop_banner_url: string | null;
  location_text: string | null;
  business_city: string | null;
  business_state: string | null;
  phone: string | null;
  policies: string | null;
  accent_color: string | null;
  instagram_url: string | null;
  tiktok_url: string | null;
  website_url: string | null;
  years_in_business: number | null;
  active: boolean;
};

export type UseStylistProfileState =
  | { status: "loading"; profile: null; error: null }
  | { status: "ready"; profile: StylistProfile; error: null }
  | { status: "not_found"; profile: null; error: string };

export const useStylistProfile = (handle: string): UseStylistProfileState => {
  const [state, setState] = useState<UseStylistProfileState>({
    status: "loading",
    profile: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cleanHandle = (handle || "").trim().replace(/^@/, "");
      if (!cleanHandle) {
        if (!cancelled) {
          setState({ status: "not_found", profile: null, error: "Missing handle." });
        }
        return;
      }
      const supabase = getSupabase();
      const { data, error } = await supabase.rpc("public_resolve_booking_slug", {
        slug_in: cleanHandle,
      });
      if (cancelled) return;
      if (error) {
        setState({ status: "not_found", profile: null, error: error.message });
        return;
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || row.active === false) {
        setState({
          status: "not_found",
          profile: null,
          error: "We couldn't find that storefront.",
        });
        return;
      }
      // Pull the extended storefront fields from booking_links —
      // the resolver already returns the core columns, but a handful
      // of the Phase-4 storefront columns aren't in its return type,
      // so we fetch them in a second light query.
      const { data: extra } = await supabase
        .from("booking_links")
        .select(
          "shop_name, shop_logo_url, shop_banner_url, banner_image_url, business_city, business_state, instagram_url, tiktok_url, website_url, years_in_business",
        )
        .eq("slug", row.slug)
        .maybeSingle();
      setState({
        status: "ready",
        profile: {
          user_id: String(row.user_id),
          slug: String(row.slug),
          branded_slug: row.branded_slug ?? null,
          business_name: row.business_name ?? null,
          shop_name: extra?.shop_name ?? null,
          intro: row.intro ?? null,
          logo_url: row.logo_url ?? null,
          banner_image_url: extra?.banner_image_url ?? null,
          shop_logo_url: extra?.shop_logo_url ?? null,
          shop_banner_url: extra?.shop_banner_url ?? null,
          location_text: row.location_text ?? null,
          business_city: extra?.business_city ?? null,
          business_state: extra?.business_state ?? null,
          phone: row.phone ?? null,
          policies: row.policies ?? null,
          accent_color: row.accent_color ?? null,
          instagram_url: extra?.instagram_url ?? null,
          tiktok_url: extra?.tiktok_url ?? null,
          website_url: extra?.website_url ?? null,
          years_in_business: extra?.years_in_business ?? null,
          active: row.active !== false,
        },
        error: null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [handle]);

  return state;
};
