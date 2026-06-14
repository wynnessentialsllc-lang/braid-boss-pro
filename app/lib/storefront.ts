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
  // Star rating when this row came from a client-submitted appointment
  // review. Null for manually-entered testimonials.
  stars: number | null;
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
    stars: r.stars == null ? null : Number(r.stars),
  }));
  return { ok: true, reviews };
};

// ============================================================
// Client-submitted reviews — moderation queue ("Client Love")
// ============================================================

export type ClientReview = {
  id: string;
  appointment_id: string;
  stars: number;
  notes: string | null;
  would_book_again: boolean | null;
  private_feedback: string | null;
  display_name: string | null;
  status: "pending" | "featured" | "hidden";
  is_favorite: boolean;
  submitted_at: string;
  client_name: string | null;
  service_name: string | null;
  appt_date: string | null;
};

export const useClientReviews = (userId: string | null): {
  reviews: ClientReview[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setStatus: (id: string, status: ClientReview["status"]) => Promise<boolean>;
  setFavorite: (id: string, favorite: boolean) => Promise<boolean>;
} => {
  const [reviews, setReviews] = useState<ClientReview[]>([]);
  const [loading, setLoading] = useState<boolean>(!!userId);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (!userId) { setReviews([]); return; }
    setLoading(true);
    setError(null);
    const supabase = getSupabase();
    const { data, error: err } = await supabase.rpc("owner_list_client_reviews");
    if (err) { setError(err.message); setLoading(false); return; }
    setReviews(((data || []) as any[]).map(r => ({
      id: String(r.id),
      appointment_id: String(r.appointment_id),
      stars: Number(r.stars) || 0,
      notes: r.notes ?? null,
      would_book_again: r.would_book_again ?? null,
      private_feedback: r.private_feedback ?? null,
      display_name: r.display_name ?? null,
      status: (r.status as ClientReview["status"]) || "pending",
      is_favorite: !!r.is_favorite,
      submitted_at: r.submitted_at ?? "",
      client_name: r.client_name ?? null,
      service_name: r.service_name ?? null,
      appt_date: r.appt_date ?? null,
    })));
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => { if (!cancelled) await refresh(); })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const setStatus: ReturnType<typeof useClientReviews>["setStatus"] = async (id, status) => {
    const supabase = getSupabase();
    const { data, error: err } = await supabase.rpc("set_client_review_status", {
      review_id_in: id, status_in: status,
    });
    if (err || !(data as any)?.ok) { setError(err?.message || "Couldn't update the review."); return false; }
    setReviews(prev => prev.map(r => r.id === id ? { ...r, status } : r));
    return true;
  };

  const setFavorite: ReturnType<typeof useClientReviews>["setFavorite"] = async (id, favorite) => {
    const supabase = getSupabase();
    const { data, error: err } = await supabase.rpc("set_client_review_favorite", {
      review_id_in: id, favorite_in: favorite,
    });
    if (err || !(data as any)?.ok) { setError(err?.message || "Couldn't update the review."); return false; }
    setReviews(prev => prev.map(r => r.id === id ? { ...r, is_favorite: favorite } : r));
    return true;
  };

  return { reviews, loading, error, refresh, setStatus, setFavorite };
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
  // Optional link to an inventory_items row (Inventory V1). When set,
  // the storefront purchase webhook fires inventory_apply_movement on
  // checkout.session.completed so the underlying stock decrements in
  // lockstep with the sale.
  inventory_item_id: string | null;
  // Marketing V4 — weeks after a paid order before the buyer is
  // emailed a "time to restock?" nudge. null = no auto-nudge (one-
  // off items like bonnets / tools).
  reorder_after_weeks: number | null;
  // When true, a paid order for this product issues a gift card code
  // per unit (see the product-checkout webhook) instead of shipping
  // a physical item. Denominations are the product's variants.
  is_gift_card: boolean;
  // When true (and is_gift_card), the storefront shows an "Other
  // amount" input so the buyer can choose any amount in range.
  gift_card_allow_custom: boolean;
  // Shipping weight in ounces — used to quote live carrier (Shippo) rates.
  weight_oz: number | null;
  // Carrier extras folded into the rate at quote time. require_signature
  // turns on STANDARD signature_confirmation; insurance_amount declares
  // the parcel value (and is multiplied by quantity when summed).
  requires_signature: boolean;
  insurance_amount: number | null;
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
  | "inventory_item_id"
  | "reorder_after_weeks"
  | "is_gift_card"
  | "gift_card_allow_custom"
  | "weight_oz"
  | "requires_signature"
  | "insurance_amount"
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
  // Targeted setter for the inventory link. Bypasses the full
  // upsert payload so callers that only need to set this one column
  // CANNOT accidentally blank image_url, price, description,
  // variants, etc. — past versions of this code did exactly that
  // when called via `upsert({ id, title, inventory_item_id })`.
  setInventoryLink: (productId: string, inventoryItemId: string | null) => Promise<boolean>;
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
      // Featured first (stylist's explicit pin), then alphabetical
      // by title so the catalog reads predictably. Pre-#314 we sorted
      // by sort_order + created_at, which was effectively "newest first"
      // — confusing once the catalog grew past a few items.
      .order("title", { ascending: true });
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

  // PATCH-safe upsert on existing rows: if draft.id is set, merge the
  // draft over the canonical product first so omitted fields keep
  // their current values. Brand-new products (no id) still build
  // their full payload from the draft as before.
  const mergeDraftWithExisting = (draft: Partial<ProductInput> & { id?: string }): Partial<ProductInput> & { id?: string } => {
    if (!draft.id) return draft;
    const existing = products.find(p => p.id === draft.id);
    if (!existing) return draft;
    const has = (k: keyof typeof draft) =>
      Object.prototype.hasOwnProperty.call(draft, k) && draft[k] !== undefined;
    return {
      id: draft.id,
      title:                  has("title")                  ? draft.title!                  : existing.title,
      slug:                   has("slug")                   ? draft.slug!                   : existing.slug,
      description:            has("description")            ? draft.description!            : existing.description,
      image_url:              has("image_url")              ? draft.image_url!              : existing.image_url,
      gallery_images:         has("gallery_images")         ? draft.gallery_images!         : existing.gallery_images,
      price:                  has("price")                  ? draft.price!                  : existing.price,
      compare_at_price:       has("compare_at_price")       ? draft.compare_at_price!       : existing.compare_at_price,
      inventory_count:        has("inventory_count")        ? draft.inventory_count!        : existing.inventory_count,
      category:               has("category")               ? draft.category!               : existing.category,
      is_featured:            has("is_featured")            ? draft.is_featured!            : existing.is_featured,
      local_pickup_available: has("local_pickup_available") ? draft.local_pickup_available! : existing.local_pickup_available,
      external_checkout_url:  has("external_checkout_url")  ? draft.external_checkout_url!  : existing.external_checkout_url,
      requires_shipping:      has("requires_shipping")      ? draft.requires_shipping!      : existing.requires_shipping,
      variant_label:          has("variant_label")          ? draft.variant_label!          : existing.variant_label,
      variants:               has("variants")               ? draft.variants!               : existing.variants,
      sort_order:             has("sort_order")             ? draft.sort_order!             : existing.sort_order,
      active:                 has("active")                 ? draft.active!                 : existing.active,
      inventory_item_id:      has("inventory_item_id")      ? draft.inventory_item_id!      : (existing as any).inventory_item_id ?? null,
      reorder_after_weeks:    has("reorder_after_weeks")    ? draft.reorder_after_weeks!   : (existing as any).reorder_after_weeks ?? null,
      is_gift_card:           has("is_gift_card")           ? draft.is_gift_card!           : (existing as any).is_gift_card ?? false,
      gift_card_allow_custom: has("gift_card_allow_custom") ? draft.gift_card_allow_custom! : (existing as any).gift_card_allow_custom ?? false,
      weight_oz:              has("weight_oz")              ? draft.weight_oz!              : (existing as any).weight_oz ?? null,
      requires_signature:     has("requires_signature")     ? draft.requires_signature!     : (existing as any).requires_signature ?? false,
      insurance_amount:       has("insurance_amount")       ? draft.insurance_amount!       : (existing as any).insurance_amount ?? null,
    };
  };

  const upsert: ReturnType<typeof useProducts>["upsert"] = async (rawDraft) => {
    if (!userId) return null;
    const draft = mergeDraftWithExisting(rawDraft);
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
      // Pass through — null clears the link, empty string is treated
      // the same as not-set so the picker's "— Not linked —" option
      // does what the stylist expects.
      inventory_item_id: draft.inventory_item_id && String(draft.inventory_item_id).trim()
        ? String(draft.inventory_item_id).trim()
        : null,
      // Marketing V4 — empty / 0 / non-number => null (no auto-nudge).
      // Clamped to the DB check (1..52).
      reorder_after_weeks: (() => {
        const raw = (draft as any).reorder_after_weeks;
        if (raw == null || raw === "") return null;
        const n = Math.floor(Number(raw));
        if (!Number.isFinite(n) || n <= 0) return null;
        return Math.min(52, n);
      })(),
      is_gift_card: !!draft.is_gift_card,
      // Custom amount only meaningful for gift cards; force off
      // otherwise so a stale flag can't linger on a normal product.
      gift_card_allow_custom: !!draft.is_gift_card && !!draft.gift_card_allow_custom,
      // Shipping weight (oz) for live carrier rates. Empty / 0 / non-number
      // => null (no weight set).
      weight_oz: (() => {
        const raw = (draft as any).weight_oz;
        if (raw == null || raw === "") return null;
        const n = Number(raw);
        return Number.isFinite(n) && n > 0 ? n : null;
      })(),
      // Carrier extras. requires_signature is a hard boolean so a stale
      // null falls back to false on insert; insurance_amount mirrors
      // weight_oz's empty-→-null normalization.
      requires_signature: !!(draft as any).requires_signature,
      insurance_amount: (() => {
        const raw = (draft as any).insurance_amount;
        if (raw == null || raw === "") return null;
        const n = Number(raw);
        return Number.isFinite(n) && n > 0 ? n : null;
      })(),
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

  // Targeted single-column update for the inventory link. Goes
  // straight to the DB with `update({ inventory_item_id }).eq(id)`
  // so no other column can possibly be touched — even if a caller
  // accidentally passes a malformed draft.
  const setInventoryLink: ReturnType<typeof useProducts>["setInventoryLink"] = async (productId, inventoryItemId) => {
    if (!userId) return false;
    const supabase = getSupabase();
    const { error: err } = await supabase
      .from("products")
      .update({ inventory_item_id: inventoryItemId || null })
      .eq("id", productId)
      .eq("user_id", userId);
    if (err) { setError(err.message); return false; }
    setProducts(prev => prev.map(p =>
      p.id === productId ? ({ ...p, inventory_item_id: inventoryItemId || null } as Product) : p,
    ));
    return true;
  };

  return { products, loading, error, refresh, upsert, remove, setInventoryLink };
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
  is_gift_card: boolean;
  gift_card_allow_custom: boolean;
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
  is_gift_card: !!p.is_gift_card,
  gift_card_allow_custom: !!p.gift_card_allow_custom,
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

// Shop fulfillment config (shipping / delivery / pickup), surfaced to the
// storefront so the buyer can pick a method + see its fee before checkout.
// Returns null when the shop hasn't enabled any method (legacy checkout).
export type ShopFulfillment = {
  pickup_enabled: boolean;
  delivery_enabled: boolean;
  shipping_enabled: boolean;
  shipping_mode: string;
  shipping_flat_rate: number | null;
  shipping_free_threshold: number | null;
  delivery_fee: number | null;
  pickup_instructions: string | null;
  delivery_radius_miles: number | null;
  // Stylist-configured pickup ETA range — surfaced to the buyer under the
  // Pickup radio so "Free" reads as "Free + here's when". Both nullable
  // (legacy shops); both are days, integers.
  turnaround_days_min: number | null;
  turnaround_days_max: number | null;
};

// One upcoming pickup-allowed date for the storefront's date picker. The
// public_get_pickup_availability RPC returns the next 21 days the stylist
// is open + has pickup_enabled, with start/end times for that day from
// availability_rules. When the list is empty, the storefront falls back
// to the A4 free-text preferred-pickup-time field.
export type PickupSlot = {
  date: string;       // YYYY-MM-DD (ISO date)
  start_time: string; // "HH:MM"
  end_time: string;   // "HH:MM"
};

// Shop policies — buyer-facing shipping / return / refund text the
// stylist publishes via shop_settings. Read by the public policies
// page (/@handle/policies) and linked from the cart checkout
// disclosure as the chargeback / consumer-law / BNPL safety net.
export type ShopPolicies = {
  shipping_policy: string | null;
  return_policy: string | null;
  refund_policy: string | null;
  studio_name: string | null;
  handle: string | null;
};

export const fetchShopPolicies = async (
  slug: string,
): Promise<ShopPolicies | null> => {
  if (!slug) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("public_get_shop_policies", { slug_in: slug });
  if (error) return null;
  const row = (Array.isArray(data) ? data[0] : data) as any;
  if (!row) return null;
  return {
    shipping_policy: row.shipping_policy ?? null,
    return_policy: row.return_policy ?? null,
    refund_policy: row.refund_policy ?? null,
    studio_name: row.studio_name ?? null,
    handle: row.handle ?? null,
  };
};

export const fetchPickupAvailability = async (
  slug: string,
  daysAhead = 21,
): Promise<PickupSlot[]> => {
  if (!slug) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("public_get_pickup_availability", {
    slug_in: slug,
    days_ahead: daysAhead,
  });
  if (error || !Array.isArray(data)) return [];
  return data
    .map((r: any) => {
      const d = r?.pickup_date ? new Date(r.pickup_date) : null;
      if (!d || Number.isNaN(d.valueOf())) return null;
      // Render in UTC to avoid the buyer's local time pushing the date
      // back across midnight (the DB stamps midnight UTC for each date).
      const iso = d.toISOString().slice(0, 10);
      return {
        date: iso,
        start_time: String(r.start_time || ""),
        end_time: String(r.end_time || ""),
      } as PickupSlot;
    })
    .filter((s): s is PickupSlot => s !== null);
};

// Render the pickup turnaround as a buyer-friendly string. Returns null
// when the stylist hasn't set either bound — in that case the cart shows
// no ETA line at all, which is the original behavior.
//
// Branches:
//   • min only       → "Usually ready in N days"
//   • max only       → "Usually ready in up to N days"
//   • equal bounds   → "Usually ready in N day(s)"
//   • different      → "Usually ready in 1–3 days"
// "day" / "days" singular handled inline; "in 1 day" reads more naturally
// than "in 1 days" and we don't want to surprise a stylist who set "1, 1".
export const formatPickupEta = (cfg: ShopFulfillment): string | null => {
  const min = cfg.turnaround_days_min;
  const max = cfg.turnaround_days_max;
  const valid = (n: number | null): n is number =>
    n != null && Number.isFinite(n) && n > 0;
  if (!valid(min) && !valid(max)) return null;
  const dayWord = (n: number) => (n === 1 ? "day" : "days");
  if (valid(min) && valid(max)) {
    if (min === max) return `Usually ready in ${min} ${dayWord(min)}`;
    return `Usually ready in ${min}–${max} days`;
  }
  if (valid(min)) return `Usually ready in ${min} ${dayWord(min)}`;
  return `Usually ready in up to ${max} ${dayWord(max!)}`;
};

const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const fetchShopFulfillment = async (
  slug: string,
): Promise<ShopFulfillment | null> => {
  if (!slug) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("public_get_shop_fulfillment", { slug_in: slug });
  if (error) return null;
  const row = (Array.isArray(data) ? data[0] : data) as any;
  if (!row) return null;
  const cfg: ShopFulfillment = {
    pickup_enabled: !!row.pickup_enabled,
    delivery_enabled: !!row.delivery_enabled,
    shipping_enabled: !!row.shipping_enabled,
    shipping_mode: String(row.shipping_mode || "flat"),
    shipping_flat_rate: numOrNull(row.shipping_flat_rate),
    shipping_free_threshold: numOrNull(row.shipping_free_threshold),
    delivery_fee: numOrNull(row.delivery_fee),
    pickup_instructions: row.pickup_instructions ?? null,
    delivery_radius_miles: numOrNull(row.delivery_radius_miles),
    turnaround_days_min: numOrNull(row.turnaround_days_min),
    turnaround_days_max: numOrNull(row.turnaround_days_max),
  };
  if (!cfg.pickup_enabled && !cfg.delivery_enabled && !cfg.shipping_enabled) return null;
  return cfg;
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
    is_gift_card: false,
    gift_card_allow_custom: false,
  }));
  return { ok: true, products };
};
