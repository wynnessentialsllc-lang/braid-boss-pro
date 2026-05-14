// Storefront commerce layer — Phases 3-5.
//
// Three resources, three hooks. Each follows the discounts.ts /
// service-categories.ts pattern: minimal CRUD against the
// already-RLS'd tables, plus public fetchers that hit the
// SECURITY DEFINER RPCs so /book/<slug> can read them
// anonymously through the canonical-slug resolver.

import { useEffect, useState } from "react";
import { getSupabase } from "./supabase";

// ============================================================
// PHASE 3 — Public reviews ("Client Love")
// ============================================================

export type PublicReview = {
  id: string;
  stylist_user_id: string;
  reviewer_name: string;
  review_text: string;
  service_name: string | null;
  image_url: string | null;
  is_featured: boolean;
  is_verified_booking: boolean;
  created_at: string;
  updated_at: string;
};

export type PublicReviewInput = Pick<
  PublicReview,
  "reviewer_name" | "review_text" | "service_name" | "image_url"
  | "is_featured" | "is_verified_booking"
>;

export const usePublicReviews = (userId: string | null): {
  reviews: PublicReview[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  upsert: (draft: Partial<PublicReviewInput> & { id?: string }) => Promise<PublicReview | null>;
  remove: (id: string) => Promise<boolean>;
} => {
  const [reviews, setReviews] = useState<PublicReview[]>([]);
  const [loading, setLoading] = useState<boolean>(!!userId);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (!userId) { setReviews([]); return; }
    setLoading(true);
    setError(null);
    const supabase = getSupabase();
    const { data, error: err } = await supabase
      .from("public_reviews")
      .select("*")
      .eq("stylist_user_id", userId)
      .order("is_featured", { ascending: false })
      .order("created_at", { ascending: false });
    if (err) { setError(err.message); setLoading(false); return; }
    setReviews((data || []) as PublicReview[]);
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => { if (!cancelled) await refresh(); })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const upsert: ReturnType<typeof usePublicReviews>["upsert"] = async (draft) => {
    if (!userId) return null;
    const reviewer_name = (draft.reviewer_name || "").trim();
    const review_text = (draft.review_text || "").trim();
    if (!reviewer_name) { setError("Reviewer name is required."); return null; }
    if (!review_text) { setError("Review text is required."); return null; }
    if (reviewer_name.length > 80) { setError("Reviewer name must be 80 characters or less."); return null; }
    if (review_text.length > 600) { setError("Review must be 600 characters or less."); return null; }
    const payload = {
      stylist_user_id: userId,
      reviewer_name,
      review_text,
      service_name: draft.service_name?.trim() || null,
      image_url: draft.image_url?.trim() || null,
      is_featured: !!draft.is_featured,
      is_verified_booking: !!draft.is_verified_booking,
    };
    const supabase = getSupabase();
    const { data, error: err } = draft.id
      ? await supabase.from("public_reviews").update(payload).eq("id", draft.id).eq("stylist_user_id", userId).select("*").maybeSingle()
      : await supabase.from("public_reviews").insert(payload).select("*").maybeSingle();
    if (err || !data) { setError(err?.message || "Couldn't save the review."); return null; }
    setError(null);
    await refresh();
    return data as PublicReview;
  };

  const remove: ReturnType<typeof usePublicReviews>["remove"] = async (id) => {
    if (!userId) return false;
    const supabase = getSupabase();
    const { error: err } = await supabase
      .from("public_reviews").delete().eq("id", id).eq("stylist_user_id", userId);
    if (err) { setError(err.message); return false; }
    setReviews(prev => prev.filter(r => r.id !== id));
    return true;
  };

  return { reviews, loading, error, refresh, upsert, remove };
};

export const fetchPublicReviews = async (
  slug: string,
): Promise<{ ok: true; reviews: PublicReview[] } | { ok: false; error: string }> => {
  if (!slug) return { ok: false, error: "Missing booking slug." };
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("public_list_reviews", { slug_in: slug });
  if (error) return { ok: false, error: error.message };
  const reviews = ((data || []) as any[]).map(r => ({
    id: String(r.id),
    stylist_user_id: "",            // not surfaced over public RPC
    reviewer_name: String(r.reviewer_name || ""),
    review_text: String(r.review_text || ""),
    service_name: r.service_name ?? null,
    image_url: r.image_url ?? null,
    is_featured: !!r.is_featured,
    is_verified_booking: !!r.is_verified_booking,
    created_at: r.created_at ?? "",
    updated_at: r.created_at ?? "",
  }));
  return { ok: true, reviews };
};

// ============================================================
// PHASE 4 — Lightweight products
// ============================================================

// Phase 1 commerce category set. Stored as the snake_case string in
// the DB; the UI surfaces the labels from PRODUCT_CATEGORY_LABEL.
// Keep the order matched with the spec so the admin picker reads as
// it was specified.
export const PRODUCT_CATEGORIES = [
  "hair_bundles",
  "braiding_hair",
  "oils",
  "edge_control",
  "bonnets",
  "accessories",
  "tools",
  "maintenance",
  "digital",
  "other",
] as const;
export type ProductCategory = typeof PRODUCT_CATEGORIES[number];

export const PRODUCT_CATEGORY_LABEL: Record<ProductCategory, string> = {
  hair_bundles: "Hair Bundles",
  braiding_hair: "Braiding Hair",
  oils: "Oils",
  edge_control: "Edge Control",
  bonnets: "Bonnets",
  accessories: "Accessories",
  tools: "Tools",
  maintenance: "Maintenance",
  digital: "Digital Products",
  other: "Other",
};

// Single-dimension product variant — one row of the variant
// picker on the storefront (e.g. Color: Black / Pink / Purple).
// Each row gets a short randomized id at create time so the
// storefront + checkout can reference it without name collisions
// (two variants with the same name stay distinguishable).
export type ProductVariant = {
  id: string;
  name: string;
  // Phase 2b: per-variant overrides. All are optional — when null /
  // undefined the storefront falls back to the product-level value.
  inventory_count?: number | null;
  low_stock_threshold?: number | null;
  compare_at_price?: number | null;
  price?: number | null;
  image_url?: string | null;
};

export const newVariantId = (): string => {
  // 8 char base36 random — collision risk inside a single product's
  // variant list is negligible (~36^8 = 2.8e12 namespace).
  return Math.random().toString(36).slice(2, 10);
};

// Normalize a single variant from any input shape (DB row, RPC
// payload, admin draft). Coerces numeric fields, strips blanks,
// preserves ids when an existing variant matches by id.
export const normalizeVariant = (v: any, fallbackName = ""): ProductVariant => {
  const num = (raw: any): number | null => {
    if (raw === null || raw === undefined || raw === "") return null;
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const intish = (raw: any): number | null => {
    const n = num(raw);
    return n == null ? null : Math.max(0, Math.floor(n));
  };
  return {
    id: String(v?.id || newVariantId()),
    name: String(v?.name || fallbackName || "").trim(),
    inventory_count: intish(v?.inventory_count),
    low_stock_threshold: intish(v?.low_stock_threshold),
    compare_at_price: (() => {
      const n = num(v?.compare_at_price);
      return n != null && n >= 0 ? n : null;
    })(),
    price: (() => {
      const n = num(v?.price);
      return n != null && n >= 0 ? n : null;
    })(),
    image_url: v?.image_url ? String(v.image_url).trim() || null : null,
  };
};

// Parse a multi-line textarea into a ProductVariant[]. Each non-empty
// line becomes one variant; ids + per-variant fields carry over for
// any line that matches an existing variant name so editing the
// textarea doesn't churn ids (and break orders that already
// reference them) or wipe per-variant inventory.
export const parseVariantsFromText = (
  raw: string,
  existing: ProductVariant[] = [],
): ProductVariant[] => {
  const seenByName = new Map(existing.map((v) => [v.name.toLowerCase(), v]));
  const seenIds = new Set<string>();
  const out: ProductVariant[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const name = line.trim();
    if (!name) continue;
    if (out.some((v) => v.name.toLowerCase() === name.toLowerCase())) continue;
    const prior = seenByName.get(name.toLowerCase());
    let id = prior?.id || newVariantId();
    while (seenIds.has(id)) id = newVariantId();
    seenIds.add(id);
    out.push({
      id,
      name,
      // Preserve per-variant fields from the existing list — the
      // textarea only edits names; structured fields go through
      // the per-row editor.
      inventory_count: prior?.inventory_count ?? null,
      low_stock_threshold: prior?.low_stock_threshold ?? null,
      compare_at_price: prior?.compare_at_price ?? null,
      price: prior?.price ?? null,
      image_url: prior?.image_url ?? null,
    });
  }
  return out;
};

// Resolve which inventory count to enforce for a (product, variant)
// pair. When the variant has its own explicit count, that wins; else
// fall back to the product-level inventory_count. null = untracked.
export const effectiveInventory = (
  productInventoryCount: number | null | undefined,
  variant: ProductVariant | null | undefined,
): number | null => {
  if (variant && variant.inventory_count != null) return variant.inventory_count;
  return productInventoryCount == null ? null : productInventoryCount;
};

// Resolve the low-stock threshold for a (product, variant) pair.
// Defaults to 5 when neither side sets one — matches the pre-Phase-2b
// storefront copy ('Only N left' fires at <= 5).
export const effectiveLowStockThreshold = (
  variant: ProductVariant | null | undefined,
): number => {
  if (variant && variant.low_stock_threshold != null) return variant.low_stock_threshold;
  return 5;
};

// Resolve display price for a (product, variant) pair. Variant
// overrides win when set.
export const effectivePrice = (
  productPrice: number | null | undefined,
  variant: ProductVariant | null | undefined,
): number | null => {
  if (variant && variant.price != null) return variant.price;
  return productPrice == null ? null : productPrice;
};

export const effectiveCompareAtPrice = (
  productCompareAtPrice: number | null | undefined,
  variant: ProductVariant | null | undefined,
): number | null => {
  if (variant && variant.compare_at_price != null) return variant.compare_at_price;
  return productCompareAtPrice == null ? null : productCompareAtPrice;
};

export const effectiveImageUrl = (
  productImageUrl: string | null | undefined,
  variant: ProductVariant | null | undefined,
): string | null => {
  if (variant && variant.image_url) return variant.image_url;
  return productImageUrl || null;
};

export type Product = {
  id: string;
  user_id: string;
  title: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  gallery_images: string[];
  price: number | null;
  compare_at_price: number | null;
  inventory_count: number | null;
  category: ProductCategory | null;
  is_featured: boolean;
  local_pickup_available: boolean;
  external_checkout_url: string | null;
  requires_shipping: boolean;
  variant_label: string | null;
  variants: ProductVariant[];
  stripe_price_id: string | null;
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type ProductInput = Pick<
  Product,
  "title" | "slug" | "description" | "image_url" | "gallery_images"
  | "variant_label" | "variants"
  | "price" | "compare_at_price" | "inventory_count" | "category"
  | "is_featured" | "local_pickup_available" | "external_checkout_url"
  | "requires_shipping" | "sort_order" | "active"
>;

// URL-friendly slug from a free-form title. Mirrors the DB
// regexp_replace used in the migration so admin-typed slugs match
// what the backfill produced for legacy rows.
export const slugifyProductTitle = (raw: string): string => {
  const base = (raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "product";
};

export const useProducts = (userId: string | null): {
  products: Product[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  upsert: (draft: Partial<ProductInput> & { id?: string }) => Promise<Product | null>;
  remove: (id: string) => Promise<boolean>;
} => {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState<boolean>(!!userId);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (!userId) { setProducts([]); return; }
    setLoading(true);
    setError(null);
    const supabase = getSupabase();
    const { data, error: err } = await supabase
      .from("products")
      .select("*")
      .eq("user_id", userId)
      .order("is_featured", { ascending: false })
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });
    if (err) { setError(err.message); setLoading(false); return; }
    // Normalize gallery_images — the DB stores jsonb, the type
    // exposes string[] so consumers don't need to handle either
    // shape downstream.
    const rows = ((data || []) as any[]).map(r => ({
      ...r,
      gallery_images: Array.isArray(r.gallery_images)
        ? (r.gallery_images as string[])
        : [],
      variants: Array.isArray(r.variants)
        ? (r.variants as any[]).map(v => normalizeVariant(v)).filter(v => v.name)
        : [],
    })) as Product[];
    setProducts(rows);
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => { if (!cancelled) await refresh(); })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const upsert: ReturnType<typeof useProducts>["upsert"] = async (draft) => {
    if (!userId) return null;
    const title = (draft.title || "").trim();
    if (!title) { setError("Product title is required."); return null; }
    if (title.length > 100) { setError("Title must be 100 characters or less."); return null; }
    const price = draft.price == null || draft.price === ("" as any) ? null : Number(draft.price);
    if (price != null && (!Number.isFinite(price) || price < 0)) {
      setError("Price can't be negative."); return null;
    }
    const compareAt = draft.compare_at_price == null || (draft.compare_at_price as any) === ""
      ? null : Number(draft.compare_at_price);
    if (compareAt != null && (!Number.isFinite(compareAt) || compareAt < 0)) {
      setError("Compare-at price can't be negative."); return null;
    }
    const inventoryCount = draft.inventory_count == null || (draft.inventory_count as any) === ""
      ? null : Math.floor(Number(draft.inventory_count));
    if (inventoryCount != null && (!Number.isFinite(inventoryCount) || inventoryCount < 0)) {
      setError("Inventory can't be negative."); return null;
    }
    // Validate category against the Phase 1 set. Null is allowed so
    // legacy rows without a category stay editable.
    let category: ProductCategory | null = null;
    if (draft.category) {
      if (!(PRODUCT_CATEGORIES as readonly string[]).includes(draft.category)) {
        setError("Pick a category from the list."); return null;
      }
      category = draft.category as ProductCategory;
    }
    // Slug: explicit draft slug wins; otherwise derive from title.
    // The DB column is not-null + unique-per-user; we let Postgres
    // reject collisions and surface the error.
    const slug = slugifyProductTitle(draft.slug || draft.title || "product");
    const gallery = Array.isArray(draft.gallery_images)
      ? draft.gallery_images.map(s => String(s).trim()).filter(Boolean)
      : [];
    const payload = {
      user_id: userId,
      title,
      slug,
      description: draft.description?.trim() || null,
      image_url: draft.image_url?.trim() || null,
      gallery_images: gallery,
      price,
      compare_at_price: compareAt,
      inventory_count: inventoryCount,
      category,
      is_featured: !!draft.is_featured,
      local_pickup_available: !!draft.local_pickup_available,
      external_checkout_url: draft.external_checkout_url?.trim() || null,
      requires_shipping: !!draft.requires_shipping,
      // Variant fields. variant_label is the picker title (e.g.
      // 'Color', 'Size'); variants is the list of options. When
      // variants is empty the storefront skips the picker
      // altogether — backwards compatible with pre-variant products.
      variant_label: draft.variant_label?.trim() ? draft.variant_label.trim() : null,
      variants: Array.isArray(draft.variants)
        ? (draft.variants as ProductVariant[])
            .map(v => normalizeVariant(v))
            .filter(v => v.name)
        : [],
      sort_order: Number.isFinite(draft.sort_order) ? Number(draft.sort_order) : 0,
      active: draft.active === false ? false : true,
    };
    const supabase = getSupabase();
    const { data, error: err } = draft.id
      ? await supabase.from("products").update(payload).eq("id", draft.id).eq("user_id", userId).select("*").maybeSingle()
      : await supabase.from("products").insert(payload).select("*").maybeSingle();
    if (err || !data) {
      // Surface unique-violation as a friendlier message — the most
      // likely cause is two products sharing a slug after the title
      // edit; tell the stylist what fixed it.
      const msg = err?.message || "";
      if (msg.includes("products_user_slug_uidx") || msg.includes("duplicate key")) {
        setError("You already have a product with that URL slug — tweak the title or set a unique slug.");
      } else {
        setError(msg || "Couldn't save the product.");
      }
      return null;
    }
    setError(null);
    await refresh();
    return data as Product;
  };

  const remove: ReturnType<typeof useProducts>["remove"] = async (id) => {
    if (!userId) return false;
    const supabase = getSupabase();
    const { error: err } = await supabase
      .from("products").delete().eq("id", id).eq("user_id", userId);
    if (err) { setError(err.message); return false; }
    setProducts(prev => prev.filter(p => p.id !== id));
    return true;
  };

  return { products, loading, error, refresh, upsert, remove };
};

export type PublicProduct = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  gallery_images: string[];
  price: number | null;
  compare_at_price: number | null;
  inventory_count: number | null;
  category: ProductCategory | null;
  is_featured: boolean;
  local_pickup_available: boolean;
  external_checkout_url: string | null;
  requires_shipping: boolean;
  variant_label: string | null;
  variants: ProductVariant[];
};

const normalizePublicProduct = (p: any): PublicProduct => ({
  id: String(p.id),
  title: String(p.title || ""),
  slug: String(p.slug || ""),
  description: p.description ?? null,
  image_url: p.image_url ?? null,
  gallery_images: Array.isArray(p.gallery_images) ? p.gallery_images.map(String) : [],
  price: p.price == null ? null : Number(p.price),
  compare_at_price: p.compare_at_price == null ? null : Number(p.compare_at_price),
  inventory_count: p.inventory_count == null ? null : Number(p.inventory_count),
  category: (p.category as ProductCategory | null) ?? null,
  is_featured: !!p.is_featured,
  local_pickup_available: !!p.local_pickup_available,
  external_checkout_url: p.external_checkout_url ?? null,
  requires_shipping: !!p.requires_shipping,
  variant_label: p.variant_label ? String(p.variant_label) : null,
  variants: Array.isArray(p.variants)
    ? (p.variants as any[])
        .map((v) => normalizeVariant(v))
        .filter((v) => v.id && v.name)
    : [],
});

export const fetchPublicProducts = async (
  slug: string,
): Promise<{ ok: true; products: PublicProduct[] } | { ok: false; error: string }> => {
  if (!slug) return { ok: false, error: "Missing booking slug." };
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("public_list_products", { slug_in: slug });
  if (error) return { ok: false, error: error.message };
  const products = ((data || []) as any[]).map(normalizePublicProduct);
  return { ok: true, products };
};

// Detail page payload. Carries the stylist's connect-account-id +
// charges-enabled flag so the buy button can short-circuit when the
// stylist hasn't completed Stripe onboarding — no point sending the
// visitor through checkout against an account that can't take charges.
export type PublicProductDetail = PublicProduct & {
  stylist_account_id: string | null;
  stylist_charges_enabled: boolean;
};

export const fetchPublicProduct = async (
  slug: string,
  productSlug: string,
): Promise<{ ok: true; product: PublicProductDetail } | { ok: false; error: string }> => {
  if (!slug) return { ok: false, error: "Missing booking slug." };
  if (!productSlug) return { ok: false, error: "Missing product slug." };
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("public_get_product", {
    slug_in: slug,
    product_slug_in: productSlug,
  });
  if (error) return { ok: false, error: error.message };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false, error: "Product not found." };
  const product: PublicProductDetail = {
    ...normalizePublicProduct(row),
    stylist_account_id: row.stylist_account_id ?? null,
    stylist_charges_enabled: !!row.stylist_charges_enabled,
  };
  return { ok: true, product };
};

// ============================================================
// PHASE 5 — Service → product recommendations
// ============================================================

// Owner-side: read the link rows for one service so the editor can
// show which products are currently recommended.
export const fetchServiceRecommendations = async (
  serviceId: string,
): Promise<{ ok: true; productIds: string[] } | { ok: false; error: string }> => {
  if (!serviceId) return { ok: false, error: "Missing service id." };
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("service_product_recommendations")
    .select("product_id, display_order")
    .eq("service_id", serviceId)
    .order("display_order", { ascending: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true, productIds: ((data || []) as any[]).map(r => String(r.product_id)) };
};

// Owner-side: replace the entire rec set for a service. Simpler than
// diffing; the table is small and the link rows have no other state.
export const saveServiceRecommendations = async (
  serviceId: string,
  productIds: string[],
): Promise<{ ok: true } | { ok: false; error: string }> => {
  if (!serviceId) return { ok: false, error: "Missing service id." };
  const supabase = getSupabase();
  const { error: delErr } = await supabase
    .from("service_product_recommendations")
    .delete()
    .eq("service_id", serviceId);
  if (delErr) return { ok: false, error: delErr.message };
  if (productIds.length === 0) return { ok: true };
  const rows = productIds.map((product_id, i) => ({
    service_id: serviceId,
    product_id,
    display_order: i,
  }));
  const { error: insErr } = await supabase
    .from("service_product_recommendations")
    .insert(rows);
  if (insErr) return { ok: false, error: insErr.message };
  return { ok: true };
};

// Public RPC fetcher — booking page calls this whenever the visitor
// picks a service.
export const fetchPublicServiceRecommendations = async (
  slug: string,
  serviceId: string,
): Promise<{ ok: true; products: PublicProduct[] } | { ok: false; error: string }> => {
  if (!slug || !serviceId) return { ok: true, products: [] };
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("public_list_service_recommendations", {
    slug_in: slug,
    service_id_in: serviceId,
  });
  if (error) return { ok: false, error: error.message };
  // Service recommendations only return a subset of fields, so we
  // synthesize the missing PublicProduct columns with safe defaults
  // — gallery + sale price aren't surfaced through this RPC.
  const products: PublicProduct[] = ((data || []) as any[]).map(p => ({
    id: String(p.product_id),
    title: String(p.title || ""),
    slug: String(p.slug || ""),
    description: p.description ?? null,
    image_url: p.image_url ?? null,
    gallery_images: [],
    price: p.price == null ? null : Number(p.price),
    compare_at_price: null,
    inventory_count: null,
    category: null,
    is_featured: false,
    local_pickup_available: !!p.local_pickup_available,
    external_checkout_url: p.external_checkout_url ?? null,
    requires_shipping: false,
    variant_label: null,
    variants: [],
  }));
  return { ok: true, products };
};
