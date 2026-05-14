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

export type Product = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  price: number | null;
  is_featured: boolean;
  local_pickup_available: boolean;
  external_checkout_url: string | null;
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type ProductInput = Pick<
  Product,
  "title" | "description" | "image_url" | "price"
  | "is_featured" | "local_pickup_available" | "external_checkout_url"
  | "sort_order" | "active"
>;

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
    setProducts((data || []) as Product[]);
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
    const payload = {
      user_id: userId,
      title,
      description: draft.description?.trim() || null,
      image_url: draft.image_url?.trim() || null,
      price,
      is_featured: !!draft.is_featured,
      local_pickup_available: !!draft.local_pickup_available,
      external_checkout_url: draft.external_checkout_url?.trim() || null,
      sort_order: Number.isFinite(draft.sort_order) ? Number(draft.sort_order) : 0,
      active: draft.active === false ? false : true,
    };
    const supabase = getSupabase();
    const { data, error: err } = draft.id
      ? await supabase.from("products").update(payload).eq("id", draft.id).eq("user_id", userId).select("*").maybeSingle()
      : await supabase.from("products").insert(payload).select("*").maybeSingle();
    if (err || !data) { setError(err?.message || "Couldn't save the product."); return null; }
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
  description: string | null;
  image_url: string | null;
  price: number | null;
  is_featured: boolean;
  local_pickup_available: boolean;
  external_checkout_url: string | null;
};

export const fetchPublicProducts = async (
  slug: string,
): Promise<{ ok: true; products: PublicProduct[] } | { ok: false; error: string }> => {
  if (!slug) return { ok: false, error: "Missing booking slug." };
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("public_list_products", { slug_in: slug });
  if (error) return { ok: false, error: error.message };
  const products = ((data || []) as any[]).map(p => ({
    id: String(p.id),
    title: String(p.title || ""),
    description: p.description ?? null,
    image_url: p.image_url ?? null,
    price: p.price == null ? null : Number(p.price),
    is_featured: !!p.is_featured,
    local_pickup_available: !!p.local_pickup_available,
    external_checkout_url: p.external_checkout_url ?? null,
  }));
  return { ok: true, products };
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
  const products = ((data || []) as any[]).map(p => ({
    id: String(p.product_id),
    title: String(p.title || ""),
    description: p.description ?? null,
    image_url: p.image_url ?? null,
    price: p.price == null ? null : Number(p.price),
    is_featured: false,
    local_pickup_available: !!p.local_pickup_available,
    external_checkout_url: p.external_checkout_url ?? null,
  }));
  return { ok: true, products };
};
