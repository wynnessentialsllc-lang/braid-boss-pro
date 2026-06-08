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
  // What the item is FOR — keeps store stock (things sold to clients)
  // separate from service supplies (things used ON clients, not sold):
  //   - "retail"  → sold to clients, not used in services
  //   - "service" → used to service clients, not for sale
  //   - "both"    → sold AND used (e.g. an oil sold at the chair and
  //                 also applied during a style)
  // Drives where the item surfaces: only "retail"/"both" can be pushed
  // to the storefront; only "service"/"both" appear as service
  // materials. Defaults to "retail" when unset (see itemType()).
  itemType?: InventoryItemType | string | null;
  archivedAt?: string | null;
  // Optional color / size variations of the same product (e.g. a
  // braiding hair stocked in colors 1B, 27, 6/30). Each variation
  // carries its OWN on-hand count and (optional) low-stock alert;
  // cost and retail price stay shared on the parent. The parent's
  // quantityOnHand is kept as the SUM of its variations by the
  // inventory_apply_movement RPC, so item-level totals stay correct.
  // Persisted through the inventory_items.data jsonb blob, so no
  // schema column is needed.
  variations?: InventoryVariation[] | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type InventoryVariation = {
  id: string;
  name: string;
  quantityOnHand?: number | string | null;
  // Optional per-variation low-stock threshold. When unset, the
  // variation falls back to the parent item's lowStockThreshold.
  lowStockThreshold?: number | string | null;
};

// Stable id for a new variation row.
export const newVariationId = (): string =>
  `var_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// Normalize the variations field into clean InventoryVariation objects:
// trims names, drops blanks/dupes (case-insensitive on name), coerces
// quantities. Tolerates the legacy string[] / comma-string shapes that
// an earlier build could have written into the data blob (those become
// zero-count variations).
export const itemVariations = (i: InventoryItem | null | undefined): InventoryVariation[] => {
  const raw = i?.variations;
  const list: any[] = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? String(raw).split(",")
      : [];
  const seen = new Set<string>();
  const out: InventoryVariation[] = [];
  for (const entry of list) {
    const v = typeof entry === "string" ? { name: entry } : (entry || {});
    const name = String(v.name ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: v.id ? String(v.id) : newVariationId(),
      name,
      quantityOnHand: num(v.quantityOnHand),
      lowStockThreshold:
        v.lowStockThreshold == null || v.lowStockThreshold === ""
          ? null
          : num(v.lowStockThreshold),
    });
  }
  return out;
};

export const hasVariations = (i: InventoryItem | null | undefined): boolean =>
  itemVariations(i).length > 0;

export const variationQuantity = (v: InventoryVariation): number => num(v?.quantityOnHand);

// A variation's effective low-stock threshold: its own when set,
// otherwise the parent item's.
export const variationThreshold = (v: InventoryVariation, item: InventoryItem): number =>
  v?.lowStockThreshold == null || v.lowStockThreshold === ""
    ? itemThreshold(item)
    : num(v.lowStockThreshold);

export const isVariationLow = (v: InventoryVariation, item: InventoryItem): boolean => {
  const t = variationThreshold(v, item);
  if (t <= 0) return false;
  return variationQuantity(v) <= t;
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

// Store stock vs. service supplies. The value is what's persisted;
// the label is what the stylist reads in the UI.
export const INVENTORY_ITEM_TYPES = [
  { value: "retail", label: "For sale" },
  { value: "service", label: "Used on clients" },
  { value: "both", label: "Sold & used" },
] as const;
export type InventoryItemType = (typeof INVENTORY_ITEM_TYPES)[number]["value"];

// Normalize the stored item type, defaulting to "retail" for legacy
// rows / unset values so existing behavior (everything sellable) is the
// safe fallback.
export const itemType = (i: InventoryItem | null | undefined): InventoryItemType => {
  const t = String(i?.itemType ?? "").trim().toLowerCase();
  return t === "service" || t === "both" ? (t as InventoryItemType) : "retail";
};

export const itemTypeLabel = (t: InventoryItemType): string =>
  INVENTORY_ITEM_TYPES.find(x => x.value === t)?.label || t;

// Sellable to clients — eligible for the storefront and chair-side sales.
export const isForSale = (i: InventoryItem | null | undefined): boolean => {
  const t = itemType(i);
  return t === "retail" || t === "both";
};

// Consumed while servicing a client — eligible as a service material.
export const isServiceUse = (i: InventoryItem | null | undefined): boolean => {
  const t = itemType(i);
  return t === "service" || t === "both";
};

export const INVENTORY_UNITS = [
  "bundle",
  "pack",
  "bottle",
  "tube",
  "each",
  "roll",
  "yard",
  "use",
  "application",
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

// "each" is the catch-all unit for individual items, so "10 each" reads
// awkwardly — it just means 10 in stock. Hide it in display; real units
// (bundle, bottle, pack, …) still render.
export const displayUnit = (unit?: string | null): string => {
  const u = String(unit ?? "").trim();
  return u.toLowerCase() === "each" ? "" : u;
};
// Format a quantity with its unit for display, e.g. "7 bundle" or just
// "10" when the unit is the generic "each".
export const fmtStock = (qty: number, unit?: string | null): string => {
  const u = displayUnit(unit);
  return u ? `${qty} ${u}` : `${qty}`;
};

// "Low stock" if at or below the user-set threshold AND the item is
// active. A threshold of 0 means the stylist doesn't want alerts on
// that SKU, so we don't surface it as low.
export const isLowStock = (i: InventoryItem): boolean => {
  if (!i || i.archivedAt) return false;
  // When an item has variations, "low" means any one color/size is at
  // or below its own threshold — that's what the stylist needs to
  // reorder, even if the combined pool looks healthy.
  const variations = itemVariations(i);
  if (variations.length > 0) return variations.some(v => isVariationLow(v, i));
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
  // Store stock vs. service supplies. "both"-typed items count toward
  // BOTH tallies, so these can sum to more than itemCount — that's
  // intentional (a dual-use item is genuinely in both buckets).
  forSaleCount: number;
  forSaleValue: number;
  serviceCount: number;
  serviceValue: number;
  byCategory: { category: string; itemCount: number; totalValue: number }[];
};

export const computeInventoryTotals = (
  items: InventoryItem[] | null | undefined,
): InventoryTotals => {
  const active = (items || []).filter(isActiveItem);
  const cat = new Map<string, { itemCount: number; totalValue: number }>();
  let totalValue = 0;
  let lowStockCount = 0;
  let forSaleCount = 0;
  let forSaleValue = 0;
  let serviceCount = 0;
  let serviceValue = 0;
  for (const i of active) {
    const v = itemValue(i);
    totalValue += v;
    if (isLowStock(i)) lowStockCount += 1;
    if (isForSale(i)) { forSaleCount += 1; forSaleValue += v; }
    if (isServiceUse(i)) { serviceCount += 1; serviceValue += v; }
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
    forSaleCount,
    forSaleValue: round2(forSaleValue),
    serviceCount,
    serviceValue: round2(serviceValue),
    byCategory,
  };
};

// ---- Reports helpers --------------------------------------------------

// Items currently at or below their low-stock threshold (active only).
// Sorted by "how far below" so the loudest signals lead the list.
export const getLowStockItems = (items: InventoryItem[] | null | undefined): InventoryItem[] => {
  const out = (items || []).filter(isLowStock);
  out.sort((a, b) => {
    const ga = itemThreshold(a) - itemQuantity(a);
    const gb = itemThreshold(b) - itemQuantity(b);
    return gb - ga;
  });
  return out;
};

// Movement-level cost basis. Prefers the snapshot (locked in at the
// time of the movement) so historical figures don't shift when a
// stylist later edits the master unit_cost. Falls back to the
// current master cost only when no snapshot exists.
const movementUnitCost = (
  m: InventoryMovement,
  itemById: Map<string, InventoryItem>,
): number => {
  if (m?.unitCostSnapshot != null && Number.isFinite(Number(m.unitCostSnapshot))) {
    return Number(m.unitCostSnapshot);
  }
  const item = itemById.get(m?.itemId || "");
  return item ? itemUnitCost(item) : 0;
};

// Consumption reasons — anything that takes stock OUT for a real
// purpose (used on a client, sold, wasted). Excludes 'adjustment'
// because adjustments are corrections, not consumption; including
// them would let a typo-fix look like cost-of-goods.
const CONSUMPTION_REASONS: ReadonlySet<MovementReason> = new Set([
  "service_use",
  "storefront_sale",
  "waste",
]);

// Total cost of materials consumed in [startISO, endISO). Date
// comparison is on the YYYY-MM-DD prefix of createdAt so callers can
// pass calendar boundaries without needing the original timezone.
export const computeMaterialsCostInRange = (
  movements: InventoryMovement[] | null | undefined,
  items: InventoryItem[] | null | undefined,
  startISO: string,
  endISO: string,
): number => {
  if (!startISO || !endISO) return 0;
  const itemById = new Map<string, InventoryItem>();
  for (const i of (items || [])) itemById.set(i.id, i);
  let total = 0;
  for (const m of (movements || [])) {
    if (!m) continue;
    if (!CONSUMPTION_REASONS.has(m.reason)) continue;
    const day = String(m.createdAt || "").slice(0, 10);
    if (!day || day < startISO || day >= endISO) continue;
    const qty = Math.abs(Number(m.delta) || 0);
    if (qty <= 0) continue;
    total += qty * movementUnitCost(m, itemById);
  }
  return round2(total);
};

export type StyleMaterialsCost = {
  style: string;
  appointmentCount: number;
  totalCost: number;
};

// Group consumption movements by appointment → style. Used by the
// Profit view to answer "which styles are eating the most material".
// Movements without an appointment_id (storefront sales, waste,
// manual deductions) are excluded — they don't belong to a style.
export const groupMaterialsCostByStyle = (
  movements: InventoryMovement[] | null | undefined,
  items: InventoryItem[] | null | undefined,
  appointments: Array<{ id: string; style?: string | null }> | null | undefined,
  startISO?: string,
  endISO?: string,
): StyleMaterialsCost[] => {
  const itemById = new Map<string, InventoryItem>();
  for (const i of (items || [])) itemById.set(i.id, i);
  const apptStyle = new Map<string, string>();
  for (const a of (appointments || [])) {
    if (a?.id) apptStyle.set(a.id, (a.style || "").trim() || "Unspecified");
  }
  const byStyle = new Map<string, { totalCost: number; appts: Set<string> }>();
  for (const m of (movements || [])) {
    if (!m || m.reason !== "service_use") continue;
    if (!m.appointmentId) continue;
    if (startISO && endISO) {
      const day = String(m.createdAt || "").slice(0, 10);
      if (!day || day < startISO || day >= endISO) continue;
    }
    const style = apptStyle.get(m.appointmentId) || "Unspecified";
    const qty = Math.abs(Number(m.delta) || 0);
    if (qty <= 0) continue;
    const cost = qty * movementUnitCost(m, itemById);
    const cur = byStyle.get(style) || { totalCost: 0, appts: new Set<string>() };
    cur.totalCost += cost;
    cur.appts.add(m.appointmentId);
    byStyle.set(style, cur);
  }
  return Array.from(byStyle.entries())
    .map(([style, v]) => ({ style, appointmentCount: v.appts.size, totalCost: round2(v.totalCost) }))
    .sort((a, b) => b.totalCost - a.totalCost);
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
  // When set, the movement targets a single color/size variation and
  // the RPC keeps the parent item's quantity_on_hand as the new sum.
  variationId?: string | null;
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
    variation_id_in: input.variationId ?? null,
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
