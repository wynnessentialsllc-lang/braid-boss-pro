// Hair/supply "recipe" costing for the pricing calculator.
//
// A recipe is the bill of materials for a style: which inventory items
// it consumes and how many of each. "Medium Boho Knotless → 2 packs
// braiding hair + 2 human bundles." Summing quantity × unit cost gives
// the real hair/product cost, so the stylist stops guessing it and the
// profit numbers (lib/pricing-profit.ts) become accurate.
//
// Unit cost is SNAPSHOTTED onto each line when the item is added, so a
// saved quote doesn't silently reprice months later if the stylist
// updates an item's cost in inventory (same rationale as the discount
// snapshot on saved quotes). recipeCostFromInventory() re-resolves
// against current inventory when the stylist explicitly wants today's
// numbers.
//
// Pure module: no React, no Supabase. Unit-tested in recipe-cost.test.ts.

const round2 = (n: number): number => Math.round(n * 100) / 100;

export type RecipeLine = {
  /** Stable row id (uid) for React keys + edits. */
  id: string;
  /** Inventory item id this line draws from. */
  itemId: string;
  /** Item name snapshotted for display in saved quotes. */
  itemName: string;
  /** How many units of the item the style consumes. */
  quantity: number;
  /** Per-unit cost snapshotted when the line was added. */
  unitCost: number;
};

/** Minimal shape we need off an inventory item to build a recipe line. */
export type RecipeInventoryItem = {
  id: string;
  name?: string | null;
  unitCost?: number | string | null;
};

/** Total cost of a recipe using each line's snapshotted unit cost. */
export const recipeCost = (lines: RecipeLine[] | null | undefined): number => {
  if (!Array.isArray(lines)) return 0;
  const total = lines.reduce((sum, l) => {
    const qty = Number(l?.quantity) || 0;
    const cost = Number(l?.unitCost) || 0;
    return sum + qty * cost;
  }, 0);
  return round2(total);
};

/**
 * Re-resolve a recipe's cost against the CURRENT inventory unit costs
 * (rather than the snapshotted ones). Lines whose item no longer exists
 * fall back to their snapshotted unit cost so the total never silently
 * drops a removed item to $0.
 */
export const recipeCostFromInventory = (
  lines: RecipeLine[] | null | undefined,
  items: RecipeInventoryItem[] | null | undefined,
): number => {
  if (!Array.isArray(lines)) return 0;
  const byId = new Map<string, RecipeInventoryItem>();
  if (Array.isArray(items)) for (const it of items) if (it?.id) byId.set(it.id, it);
  const total = lines.reduce((sum, l) => {
    const qty = Number(l?.quantity) || 0;
    const current = byId.get(l?.itemId);
    const cost = current != null ? Number(current.unitCost) || 0 : Number(l?.unitCost) || 0;
    return sum + qty * cost;
  }, 0);
  return round2(total);
};

/** Build a recipe line from an inventory item, snapshotting name + cost. */
export const lineFromInventoryItem = (
  id: string,
  item: RecipeInventoryItem,
  quantity = 1,
): RecipeLine => ({
  id,
  itemId: item.id,
  itemName: (item.name || "").trim() || "Item",
  quantity: Number(quantity) || 0,
  unitCost: Number(item.unitCost) || 0,
});
