// Server-side metadata helpers for the public storefront / product
// pages. Used by the route layout.tsx files' generateMetadata so a
// shared /@handle (or /@handle/products/<slug>) link unfurls with the
// stylist's own name, description, and image — and is crawlable —
// instead of inheriting the generic app card.
//
// These run server-side (request time on the SSR web build). They use a
// fresh anonymous Supabase client and the SAME anon-callable, SECURITY
// DEFINER RPCs the client pages already use (public_resolve_booking_slug,
// public_get_product), so they expose nothing the page itself doesn't.
//
// Every function is fully defensive: any failure (network, missing env,
// unknown handle) resolves to null so the caller falls back to root
// metadata. generateMetadata must never throw.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  "https://bjqazhplxqqhftekspfl.supabase.co";
const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "sb_publishable_b-GByxuYeehWa-9F7Z1MdQ_FKqx32XO";

export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://braidbosspro.app"
).replace(/\/$/, "");

const anonClient = (): SupabaseClient =>
  createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

// SSR metadata must never block page render on a slow/unreachable DB.
// Race every lookup against a short timeout; on timeout the caller's
// try/catch turns the rejection into a null → root-metadata fallback.
const META_TIMEOUT_MS = 2500;
const withTimeout = <T>(p: PromiseLike<T>): Promise<T> =>
  Promise.race([
    Promise.resolve(p),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("meta_timeout")), META_TIMEOUT_MS),
    ),
  ]);

const cleanHandle = (raw: string | string[] | undefined): string => {
  const v = Array.isArray(raw) ? raw[0] : raw || "";
  try {
    return decodeURIComponent(v).trim().replace(/^@/, "");
  } catch {
    return String(v).trim().replace(/^@/, "");
  }
};

export type StorefrontMeta = {
  handle: string;
  // Brand-first name for the shop/storefront pages: shop_name → business_name.
  studioName: string;
  // Person-first name for the booking page's "Book with …" title: the
  // stylist's studio name (business_name, e.g. "Sheree") is preferred over
  // the shop/brand name. Mirrors the in-app booking-page tab title and the
  // "Studio name" field, which the app documents as "shown on your booking
  // page — your stylist name."
  bookingName: string;
  description: string | null;
  imageUrl: string | null;
  locationText: string | null;
  active: boolean;
};

export const getStorefrontMeta = async (
  rawHandle: string | string[] | undefined,
): Promise<StorefrontMeta | null> => {
  const handle = cleanHandle(rawHandle);
  if (!handle) return null;
  try {
    const supabase = anonClient();
    const { data, error } = await withTimeout(
      supabase.rpc("public_resolve_booking_slug", { slug_in: handle }),
    );
    if (error) return null;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || row.active === false) return null;

    // Pull the storefront-only display fields (shop name/description and
    // branded imagery). Best-effort — fall back to the booking-page
    // counterparts the resolver already returned.
    let shopName: string | null = null;
    let shopDescription: string | null = null;
    let shopLogo: string | null = null;
    try {
      const { data: extra } = await withTimeout(
        supabase
          .from("booking_links")
          .select("shop_name, shop_description, shop_logo_url, banner_image_url")
          .eq("slug", row.slug)
          .maybeSingle(),
      );
      shopName = extra?.shop_name ?? null;
      shopDescription = extra?.shop_description ?? null;
      shopLogo = extra?.shop_logo_url ?? extra?.banner_image_url ?? null;
    } catch {
      /* extended fields are optional */
    }

    const businessName =
      row.business_name && String(row.business_name).trim()
        ? String(row.business_name).trim()
        : null;
    const trimmedShopName = shopName && shopName.trim() ? shopName.trim() : null;
    // Storefront/shop pages lead with the brand; the booking page leads with
    // the stylist's studio (personal) name. Both fall back to the other name,
    // then to the @handle, so neither is ever blank.
    const studioName = trimmedShopName || businessName || `@${handle}`;
    const bookingName = businessName || trimmedShopName || `@${handle}`;
    const description =
      (shopDescription && shopDescription.trim()) ||
      (row.intro && String(row.intro).trim()) ||
      null;
    const imageUrl =
      shopLogo ||
      (row.logo_url ? String(row.logo_url) : null) ||
      null;

    return {
      handle,
      studioName,
      bookingName,
      description,
      imageUrl,
      locationText: row.location_text ? String(row.location_text) : null,
      active: row.active !== false,
    };
  } catch {
    return null;
  }
};

export type ProductMeta = {
  handle: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  price: number | null;
};

export const getProductMeta = async (
  rawHandle: string | string[] | undefined,
  rawProductSlug: string | string[] | undefined,
): Promise<ProductMeta | null> => {
  const handle = cleanHandle(rawHandle);
  const productSlug = cleanHandle(rawProductSlug); // reuse trim/decoding
  if (!handle || !productSlug) return null;
  try {
    const supabase = anonClient();
    // Resolve the canonical booking slug first (handle may be the branded
    // slug); public_get_product keys on the canonical slug.
    const { data: resolved, error: resolveErr } = await withTimeout(
      supabase.rpc("public_resolve_booking_slug", { slug_in: handle }),
    );
    if (resolveErr) return null;
    const profile = Array.isArray(resolved) ? resolved[0] : resolved;
    if (!profile || profile.active === false) return null;

    const { data, error } = await withTimeout(
      supabase.rpc("public_get_product", {
        slug_in: profile.slug,
        product_slug_in: productSlug,
      }),
    );
    if (error) return null;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;

    const priceNum = Number(row.price);
    return {
      handle,
      title: String(row.title || "Product").trim(),
      description: row.description ? String(row.description).trim() : null,
      imageUrl: row.image_url ? String(row.image_url) : null,
      price: Number.isFinite(priceNum) ? priceNum : null,
    };
  } catch {
    return null;
  }
};

// Truncate a description for og/meta without cutting mid-word.
export const clampDescription = (text: string | null, max = 160): string | undefined => {
  if (!text) return undefined;
  const s = text.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
};
