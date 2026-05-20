// Inventory V1 — types + pure aggregation helpers.
//
// One source of truth for hair, products, supplies. The same bundle
// can be consumed by either the storefront (online sale) or a
// service appointment (used on a client). All quantity changes go
// through the inventory_apply_movement RPC so the on-hand count and
// the movement ledger stay in lock-step.

import { getSupabase } from "./supabase";

export type InventoryItem = {
  id: string;
  name: string;
  sku?: string | null;
  category?: string | null;
  unit?: string | null;
  unitCost?: number | string | null;
  retailPrice?: number | string | null;
  quantityOnHand?: number | string | null;
  lowStockThreshold?: number | string | null;
  supplier?: string | null;
  photoPath?: string | null;
  storefrontProductId?: string | null;
  archivedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type InventoryMovement = {
  id: string;
  itemId: string;
  delta: number;
  reason: MovementReason;
  appointmentId?: string | null;
  storefrontOrderId?: string | null;
  businessExpenseId?: string | null;
  unitCostSnapshot?: number | null;
  note?: string | null;
  createdAt?: string | null;
};

export type MovementReason =
  | "purchase"
  | "service_use"
  | "storefront_sale"
  | "adjustment"
  | "waste"
  | "return";

// Mirrors the Expenses categories so a braider tagging "Hair /
// bundles" on an expense sees the same label on their stock.
export const INVENTORY_CATEGORIES = [
  "Hair / bundles",
  "Braiding hair",
  "Products",
  "Tools",
  "Supplies",
  "Packaging",
  "Other",
] as const;
export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number];

export const INVENTORY_UNITS = [
  "bundle",
  "pack",
  "bottle",
  "tube",
  "each",
  "roll",
  "yard",
] as const;
export type InventoryUnit = (typeof INVENTORY_UNITS)[number];

// ---- Coercion ---------------------------------------------------------

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Number(n.toFixed(2));

export const itemQuantity = (i: InventoryItem): number => num(i?.quantityOnHand);
export const itemUnitCost = (i: InventoryItem): number => num(i?.unitCost);
export const itemRetailPrice = (i: InventoryItem): number => num(i?.retailPrice);
export const itemThreshold = (i: InventoryItem): number => num(i?.lowStockThreshold);
export const itemValue = (i: InventoryItem): number => round2(itemQuantity(i) * itemUnitCost(i));

// "Low stock" if at or below the user-set threshold AND the item is
// active. A threshold of 0 means the stylist doesn't want alerts on
// that SKU, so we don't surface it as low.
export const isLowStock = (i: InventoryItem): boolean => {
  if (!i || i.archivedAt) return false;
  const t = itemThreshold(i);
  if (t <= 0) return false;
  return itemQuantity(i) <= t;
};

export const isActiveItem = (i: InventoryItem): boolean => !i?.archivedAt;

// ---- Aggregates -------------------------------------------------------

export type InventoryTotals = {
  itemCount: number;
  totalValue: number;
  lowStockCount: number;
  byCategory: { category: string; itemCount: number; totalValue: number }[];
};

export const computeInventoryTotals = (
  items: InventoryItem[] | null | undefined,
): InventoryTotals => {
  const active = (items || []).filter(isActiveItem);
  const cat = new Map<string, { itemCount: number; totalValue: number }>();
  let totalValue = 0;
  let lowStockCount = 0;
  for (const i of active) {
    const v = itemValue(i);
    totalValue += v;
    if (isLowStock(i)) lowStockCount += 1;
    const k = (i.category || "Other").trim() || "Other";
    const cur = cat.get(k) || { itemCount: 0, totalValue: 0 };
    cur.itemCount += 1;
    cur.totalValue += v;
    cat.set(k, cur);
  }
  const byCategory = Array.from(cat.entries())
    .map(([category, v]) => ({ category, itemCount: v.itemCount, totalValue: round2(v.totalValue) }))
    .sort((a, b) => b.totalValue - a.totalValue);
  return {
    itemCount: active.length,
    totalValue: round2(totalValue),
    lowStockCount,
    byCategory,
  };
};

// ---- RPC wrapper ------------------------------------------------------

const uid = (): string => {
  // 26-char base32-ish id, matches the rest of the app's id style.
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 12);
  return `mov_${t}${r}`;
};

export type ApplyMovementInput = {
  itemId: string;
  delta: number;
  reason: MovementReason;
  appointmentId?: string | null;
  storefrontOrderId?: string | null;
  businessExpenseId?: string | null;
  unitCostSnapshot?: number | null;
  note?: string | null;
};

export type ApplyMovementResult = {
  itemId: string;
  quantityOnHand: number;
  lowStock: boolean;
};

// Calls the inventory_apply_movement RPC. The RPC is the only place
// that touches quantity_on_hand — local state updates happen in the
// store after this resolves, so a failed RPC never leaves the local
// count out of sync with the cloud.
export const applyMovement = async (
  input: ApplyMovementInput,
): Promise<ApplyMovementResult> => {
  if (!input.itemId) throw new Error("applyMovement: itemId required");
  if (!input.delta || !Number.isFinite(input.delta)) throw new Error("applyMovement: delta required");
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("inventory_apply_movement", {
    movement_id_in: uid(),
    item_id_in: input.itemId,
    delta_in: input.delta,
    reason_in: input.reason,
    appointment_id_in: input.appointmentId ?? null,
    storefront_order_id_in: input.storefrontOrderId ?? null,
    business_expense_id_in: input.businessExpenseId ?? null,
    unit_cost_snapshot_in: input.unitCostSnapshot ?? null,
    note_in: input.note ?? null,
  });
  if (error) throw error;
  // RPC returns SETOF — pick the first row.
  const row = Array.isArray(data) ? data[0] : data;
  return {
    itemId: String(row?.item_id ?? input.itemId),
    quantityOnHand: Number(row?.quantity_on_hand ?? 0),
    lowStock: !!row?.low_stock,
  };
};
