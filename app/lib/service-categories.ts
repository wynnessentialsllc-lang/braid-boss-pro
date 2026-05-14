// Service categories — owner-side CRUD hook.
//
// Categories sit one level above services: Category → Service →
// Variation. They are optional. Services with no category fall into
// the "Other Services" bucket on both the editor and the public
// booking page, so existing rows keep working without any data
// migration.
//
// Mirrors the shape of useServices() so wiring into the existing
// store + ServicesScreen is mechanical.

import { useEffect, useState } from "react";
import { getSupabase } from "./supabase";

export type ServiceCategory = {
  id: string;
  user_id: string;
  name: string;
  slug: string | null;
  description: string | null;
  image_url: string | null;
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type ServiceCategoryInput = Pick<
  ServiceCategory,
  "name" | "slug" | "description" | "image_url" | "sort_order" | "active"
>;

export type ServiceCategoryValidationError = {
  field: keyof ServiceCategoryInput | "form";
  message: string;
};

// URL-safe per-user slug. We auto-derive from name; users never have
// to think about it.
export const slugifyCategoryName = (name: string): string => {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
};

export const validateServiceCategory = (
  draft: Partial<ServiceCategoryInput>,
): ServiceCategoryValidationError[] => {
  const errors: ServiceCategoryValidationError[] = [];
  const name = (draft.name || "").trim();
  if (!name) errors.push({ field: "name", message: "Category name is required." });
  if (name.length > 60) errors.push({ field: "name", message: "Name must be 60 characters or less." });
  const desc = draft.description?.trim() || null;
  if (desc && desc.length > 280) {
    errors.push({ field: "description", message: "Description must be 280 characters or less." });
  }
  return errors;
};

export const useServiceCategories = (
  userId: string | null,
): {
  categories: ServiceCategory[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  upsert: (draft: Partial<ServiceCategoryInput> & { id?: string }) => Promise<ServiceCategory | null>;
  remove: (id: string) => Promise<boolean>;
  reorder: (id: string, direction: "up" | "down") => Promise<void>;
} => {
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [loading, setLoading] = useState<boolean>(!!userId);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (!userId) { setCategories([]); return; }
    setLoading(true);
    setError(null);
    const supabase = getSupabase();
    const { data, error: err } = await supabase
      .from("service_categories")
      .select("*")
      .eq("user_id", userId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setCategories((data || []) as ServiceCategory[]);
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => { if (!cancelled) await refresh(); })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const upsert: ReturnType<typeof useServiceCategories>["upsert"] = async (draft) => {
    if (!userId) return null;
    const errs = validateServiceCategory(draft);
    if (errs.length > 0) {
      setError(errs[0].message);
      return null;
    }
    const supabase = getSupabase();
    const name = (draft.name || "").trim();
    // Auto-derive slug when not provided. Per-user uniqueness is
    // enforced by service_categories_user_slug_uidx — we suffix on
    // collision below.
    let slug = draft.slug?.trim() || slugifyCategoryName(name);
    if (!slug) slug = null as any;
    const payload: Record<string, any> = {
      user_id: userId,
      name,
      slug: slug || null,
      description: draft.description?.trim() || null,
      image_url: draft.image_url?.trim() || null,
      sort_order: Number.isFinite(draft.sort_order) ? Number(draft.sort_order) : 0,
      active: draft.active ?? true,
    };
    const tryOnce = async (slugAttempt: string | null) => {
      payload.slug = slugAttempt;
      if (draft.id) {
        return await supabase
          .from("service_categories")
          .update(payload)
          .eq("id", draft.id)
          .eq("user_id", userId)
          .select("*")
          .maybeSingle();
      }
      return await supabase
        .from("service_categories")
        .insert(payload)
        .select("*")
        .maybeSingle();
    };
    let { data, error: err } = await tryOnce(payload.slug);
    // Slug collision → retry with a numeric suffix. Bounded retries
    // so a bug can't loop forever.
    let attempt = 1;
    while (err && /service_categories_user_slug_uidx|duplicate key/i.test(err.message) && attempt < 5) {
      const base = slugifyCategoryName(name) || "category";
      const next = `${base}-${attempt + 1}`;
      ({ data, error: err } = await tryOnce(next));
      attempt += 1;
    }
    if (err || !data) {
      setError(err?.message || "Could not save the category.");
      return null;
    }
    setError(null);
    await refresh();
    return data as ServiceCategory;
  };

  const remove: ReturnType<typeof useServiceCategories>["remove"] = async (id) => {
    if (!userId) return false;
    const supabase = getSupabase();
    const { error: err } = await supabase
      .from("service_categories")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);
    if (err) { setError(err.message); return false; }
    // services.category_id is ON DELETE SET NULL — any services in
    // this category demote to "Other Services" automatically.
    setCategories(prev => prev.filter(c => c.id !== id));
    return true;
  };

  // Swap sort_order with the neighbor on either side. Avoids the
  // complexity of a full drag-and-drop list while still letting
  // stylists arrange the booking page how they want.
  const reorder: ReturnType<typeof useServiceCategories>["reorder"] = async (id, direction) => {
    if (!userId) return;
    const ordered = [...categories].sort((a, b) =>
      a.sort_order - b.sort_order || a.name.localeCompare(b.name),
    );
    const idx = ordered.findIndex(c => c.id === id);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= ordered.length) return;
    const a = ordered[idx];
    const b = ordered[swapIdx];
    // If the two share a sort_order, normalize before swapping so
    // the swap is observable.
    const aOrder = a.sort_order;
    const bOrder = b.sort_order;
    const supabase = getSupabase();
    const { error: e1 } = await supabase
      .from("service_categories")
      .update({ sort_order: bOrder === aOrder ? bOrder + 1 : bOrder })
      .eq("id", a.id).eq("user_id", userId);
    const { error: e2 } = await supabase
      .from("service_categories")
      .update({ sort_order: bOrder === aOrder ? aOrder : aOrder })
      .eq("id", b.id).eq("user_id", userId);
    if (e1 || e2) {
      setError((e1 || e2)?.message || "Couldn't reorder categories.");
    }
    await refresh();
  };

  return { categories, loading, error, refresh, upsert, remove, reorder };
};
