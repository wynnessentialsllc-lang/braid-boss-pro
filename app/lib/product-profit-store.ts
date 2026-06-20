// Supabase CRUD for saved Product Profit Calculator products.
//
// Thin data layer over public.product_profit_products (RLS-pinned to the
// signed-in user — see 20261103000000_product_profit_products.sql). The
// full calculator input round-trips through the `data` jsonb; name /
// category / archived are mirrored to columns for list ordering. All math
// stays in lib/product-profit.ts; this module only moves rows.

import { getSupabase } from "./supabase";
import {
  blankProduct,
  type ProductProfitInput,
  type SavedProduct,
} from "./product-profit";

const TABLE = "product_profit_products";

/** App-style id, matching inventory.ts ("prod_"-prefixed base36). */
export const newProductId = (): string => {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 12);
  return `prod_${t}${r}`;
};

// A saved row may predate a field added to ProductProfitInput; merge over
// blankProduct() so the UI always reads a complete, well-typed shape.
const rowToSaved = (row: any): SavedProduct => {
  const input: ProductProfitInput = {
    ...blankProduct(),
    ...(row?.data || {}),
    // Promoted columns win over stale jsonb copies.
    name: row?.name ?? row?.data?.name ?? "",
    category: row?.category ?? row?.data?.category ?? "Other",
  };
  return {
    id: String(row?.id),
    name: input.name || "",
    category: input.category || "Other",
    archived: !!row?.archived,
    updatedAt: row?.updated_at || row?.created_at || "",
    input,
  };
};

const savedToRow = (userId: string, product: SavedProduct) => ({
  user_id: userId,
  id: product.id,
  name: product.input.name || null,
  category: product.input.category || null,
  archived: !!product.archived,
  // Keep name/category inside data too so an offline export stays whole.
  data: product.input,
});

/** Load every product for the signed-in user, active first, newest first. */
export const listProducts = async (
  userId: string,
): Promise<SavedProduct[]> => {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .select("id, name, category, archived, data, created_at, updated_at")
    .eq("user_id", userId)
    .order("archived", { ascending: true })
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map(rowToSaved);
};

/** Insert or update a product. Returns the persisted SavedProduct. */
export const saveProduct = async (
  userId: string,
  product: SavedProduct,
): Promise<SavedProduct> => {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .upsert(savedToRow(userId, product), { onConflict: "user_id,id" })
    .select("id, name, category, archived, data, created_at, updated_at")
    .single();
  if (error) throw new Error(error.message);
  return rowToSaved(data);
};

/** Archive / unarchive (soft state — keeps history for COGS reporting). */
export const setArchived = async (
  userId: string,
  id: string,
  archived: boolean,
): Promise<void> => {
  const supabase = getSupabase();
  const { error } = await supabase
    .from(TABLE)
    .update({ archived })
    .eq("user_id", userId)
    .eq("id", id);
  if (error) throw new Error(error.message);
};

/** Hard-delete a product. */
export const deleteProduct = async (
  userId: string,
  id: string,
): Promise<void> => {
  const supabase = getSupabase();
  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq("user_id", userId)
    .eq("id", id);
  if (error) throw new Error(error.message);
};

/** A fresh, unsaved product wrapper around blankProduct(). */
export const newSavedProduct = (): SavedProduct => ({
  id: newProductId(),
  name: "",
  category: "Hair Oil",
  archived: false,
  updatedAt: "",
  input: blankProduct(),
});

/** Clone an existing product into a new "(Copy)" draft. */
export const duplicateSavedProduct = (source: SavedProduct): SavedProduct => ({
  id: newProductId(),
  name: `${source.name || "Untitled"} (Copy)`,
  category: source.category,
  archived: false,
  updatedAt: "",
  input: {
    ...source.input,
    name: `${source.input.name || "Untitled"} (Copy)`,
  },
});
