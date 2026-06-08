// Inventory CSV import — parse, validate, link to storefront products.
//
// Header aliases mean the stylist's spreadsheet doesn't have to use
// exact column names. "Item", "Name", "Product Name" all map to name.
// Unknown headers are ignored; missing columns are tolerated and
// just fall back to defaults (zero quantity, zero cost, etc).
//
// Linking: if the CSV has a `storefront_product` column, we match
// case-insensitively first by slug, then by exact title. Matched
// products get their inventory_item_id set to the new item's id in
// a follow-up pass — keeps the import atomic from the stylist's
// perspective.

import { parseCsv, pickField } from "./csv";
import {
  INVENTORY_CATEGORIES,
  INVENTORY_UNITS,
  isForSale,
  type InventoryItem,
  type InventoryItemType,
} from "./inventory";

export type CsvImportRow = {
  // Parsed item. id is generated client-side now so we can link
  // products against it without round-tripping to the DB first.
  item: InventoryItem;
  // Optional storefront product fields lifted from the same row.
  // When present we create / refresh a linked storefront product
  // alongside the inventory item in one pass — Square exports
  // include all of these.
  productFields: {
    description: string | null;
    retailPrice: number | null;
  } | null;
  // Diagnostic flags surfaced in the preview UI.
  isDuplicateName: boolean;       // matches an existing inventory item by name
  errors: string[];               // hard errors — row will be skipped on import
  warnings: string[];             // soft notes — row is fine but worth a glance
  // Storefront product matched by slug/title, if the CSV had a
  // storefront_product column and we found one. null when unmatched.
  matchedProductId: string | null;
  matchedProductTitle: string | null;
};

export type CsvImportResult = {
  headers: string[];
  rows: CsvImportRow[];
  // Aggregate counts so the preview can render a one-line summary
  // without rolling its own reducer.
  summary: {
    total: number;
    valid: number;
    skipped: number;
    duplicates: number;
    productsToLink: number;
  };
};

type ExistingProduct = { id: string; title: string; slug: string };

const NUM_RE = /[^\d.\-]/g;
const parseNum = (raw: string): number | null => {
  const s = (raw || "").trim();
  if (!s) return null;
  const n = parseFloat(s.replace(NUM_RE, ""));
  return Number.isFinite(n) ? n : null;
};

// Case-insensitive + punctuation-tolerant match so "Got2b Glued"
// finds "got2b-glued" as a product slug. Same normalization the
// product slug helper uses, so what the stylist types in the CSV
// matches what the DB stored.
const norm = (s: string): string =>
  (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const genId = (): string => {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 10);
  return `inv_${t}${r}`;
};

const closestCategory = (raw: string): string | null => {
  const s = (raw || "").trim();
  if (!s) return null;
  const exact = INVENTORY_CATEGORIES.find(c => c.toLowerCase() === s.toLowerCase());
  if (exact) return exact;
  // Substring fallback so "Hair" matches "Hair / bundles".
  const partial = INVENTORY_CATEGORIES.find(c =>
    c.toLowerCase().includes(s.toLowerCase()) || s.toLowerCase().includes(c.toLowerCase()));
  return partial || s; // free-text category is allowed, just less ideal
};

// Map a free-text type cell to a stored item type. Tolerant of the
// words a stylist might use ("sell", "supply", "used on clients", …).
// Defaults to "retail" so a missing/garbled cell keeps the item
// sellable — matching the column default in the DB.
const closestItemType = (raw: string): InventoryItemType => {
  const s = (raw || "").trim().toLowerCase();
  if (!s) return "retail";
  if (/\bboth\b|sold *(&|and|\/|\+) *use/.test(s)) return "both";
  if (/sale|sell|retail|resell|store|shop/.test(s)) return "retail";
  if (/service|used|use|supply|supplies|consum|client/.test(s)) return "service";
  return "retail";
};

const closestUnit = (raw: string): string | null => {
  const s = (raw || "").trim().toLowerCase();
  if (!s) return null;
  const exact = INVENTORY_UNITS.find(u => u === s);
  if (exact) return exact;
  // Common pluralizations — "bundles" → "bundle".
  if (s.endsWith("s")) {
    const sing = s.slice(0, -1);
    const stem = INVENTORY_UNITS.find(u => u === sing);
    if (stem) return stem;
  }
  return s;
};

/**
 * Parse a CSV string against the inventory schema and resolve any
 * product links in a single pass. Pure — no DB calls. The caller
 * decides whether to commit.
 */
export const parseInventoryCsv = (
  csv: string,
  existing: { items: InventoryItem[]; products: ExistingProduct[] },
): CsvImportResult => {
  const { headers, rows } = parseCsv(csv);
  // Lookup tables for duplicate detection + product matching.
  // Names are matched case-insensitively, trimmed; products try
  // slug first, then title.
  const existingNames = new Set(
    (existing.items || []).map(i => (i?.name || "").trim().toLowerCase()).filter(Boolean),
  );
  const productBySlug = new Map<string, ExistingProduct>();
  const productByTitle = new Map<string, ExistingProduct>();
  for (const p of existing.products || []) {
    if (p?.slug) productBySlug.set(norm(p.slug), p);
    if (p?.title) productByTitle.set(norm(p.title), p);
  }

  const out: CsvImportRow[] = [];
  for (const r of rows) {
    const name = pickField(r, ["name", "item", "item name", "product", "product name", "title"]).trim();
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!name) {
      // Skip silently-empty rows (just the trailing newline cell).
      const allBlank = Object.values(r).every(v => !v || !v.trim());
      if (allBlank) continue;
      errors.push("Name is required.");
    }

    const skuRaw = pickField(r, ["sku", "code"]);
    const categoryRaw = pickField(r, ["category", "type"]);
    // Dedicated item-type column. Kept distinct from the "type" alias
    // above (which maps to category) so a sheet can carry both. When
    // absent, we infer below from whether a retail price is present.
    const itemTypeRaw = pickField(r, [
      "item type", "item_type", "usage", "use", "sell or use", "sale or service", "stock type",
    ]);
    const unitRaw = pickField(r, ["unit", "uom"]);
    const unitCostRaw = pickField(r, ["unit cost", "cost", "unit price", "cost per unit"]);
    const retailPriceRaw = pickField(r, ["retail price", "price", "sale price", "retail"]);
    const quantityRaw = pickField(r, ["quantity", "qty", "on hand", "stock"]);
    const thresholdRaw = pickField(r, ["low stock threshold", "low stock", "reorder at", "alert at", "threshold"]);
    const supplierRaw = pickField(r, ["supplier", "vendor", "brand"]);
    const productRaw = pickField(r, ["storefront product", "storefront_product", "linked product", "product link"]);
    // Square / generic catalog exports often include a Description
    // column. Capture it so we can refresh the linked storefront
    // product's description in the same pass — without this the
    // storefront stays blank even after a successful CSV.
    const descriptionRaw = pickField(r, ["description", "details", "product description"]);

    const unitCost = parseNum(unitCostRaw);
    if (unitCostRaw && unitCost == null) warnings.push(`Couldn't read cost "${unitCostRaw}".`);
    if (unitCost != null && unitCost < 0) errors.push("Cost can't be negative.");

    const retailPrice = parseNum(retailPriceRaw);
    if (retailPriceRaw && retailPrice == null) warnings.push(`Couldn't read retail price "${retailPriceRaw}".`);
    if (retailPrice != null && retailPrice < 0) errors.push("Retail price can't be negative.");

    const quantity = parseNum(quantityRaw) ?? 0;
    if (quantityRaw && parseNum(quantityRaw) == null) warnings.push(`Couldn't read quantity "${quantityRaw}".`);

    const threshold = parseNum(thresholdRaw) ?? 0;
    if (thresholdRaw && parseNum(thresholdRaw) == null) warnings.push(`Couldn't read threshold "${thresholdRaw}".`);
    if (threshold < 0) errors.push("Threshold can't be negative.");

    let matchedProductId: string | null = null;
    let matchedProductTitle: string | null = null;
    if (productRaw) {
      const key = norm(productRaw);
      const hit = productBySlug.get(key) || productByTitle.get(key);
      if (hit) {
        matchedProductId = hit.id;
        matchedProductTitle = hit.title;
      } else {
        warnings.push(`No storefront product matches "${productRaw}".`);
      }
    }

    const isDuplicateName = !!name && existingNames.has(name.toLowerCase());
    if (isDuplicateName) warnings.push("An inventory item with this name already exists.");

    // Type: explicit column wins; otherwise infer from the row — a
    // retail price or a matched storefront product means it's for sale,
    // anything else is treated as a service supply.
    const itemTypeValue: InventoryItemType = itemTypeRaw
      ? closestItemType(itemTypeRaw)
      : (retailPrice != null || matchedProductId ? "retail" : "service");

    const item: InventoryItem = {
      id: genId(),
      name,
      sku: skuRaw || null,
      category: closestCategory(categoryRaw),
      unit: closestUnit(unitRaw),
      unitCost: unitCost ?? 0,
      retailPrice: retailPrice,
      quantityOnHand: quantity,
      lowStockThreshold: threshold,
      supplier: supplierRaw || null,
      photoPath: null,
      storefrontProductId: matchedProductId,
      itemType: itemTypeValue,
      archivedAt: null,
    };

    // Build the optional product-field payload when the row carries
    // anything we'd patch onto a storefront product. We only build
    // it when there's actually something to apply, so the commit
    // step can skip the product-update call entirely on rows that
    // are pure inventory.
    const productFields = (descriptionRaw || retailPrice != null)
      ? {
          description: descriptionRaw?.trim() || null,
          retailPrice: retailPrice,
        }
      : null;

    out.push({
      item,
      productFields,
      isDuplicateName,
      errors,
      warnings,
      matchedProductId,
      matchedProductTitle,
    });
  }

  const valid = out.filter(r => r.errors.length === 0).length;
  const duplicates = out.filter(r => r.isDuplicateName).length;
  const productsToLink = out.filter(r => r.errors.length === 0 && r.matchedProductId).length;
  return {
    headers,
    rows: out,
    summary: {
      total: out.length,
      valid,
      skipped: out.length - valid,
      duplicates,
      productsToLink,
    },
  };
};

// =====================================================================
// Seed from Shop — turn storefront products into inventory items.
//
// Same destination as the CSV flow (one new inventory_items row +
// products.inventory_item_id link per selected product), but the
// source is the stylist's existing storefront. No retyping, no
// CSV — just preview the suggested rows and commit.
// =====================================================================

export type StorefrontProductSeed = {
  id: string;
  title: string;
  slug: string;
  category: string | null;        // storefront product category enum value
  price: number | null;
  inventory_count: number | null;
  image_url: string | null;
  inventory_item_id: string | null;
};

export type ShopSeedSuggestion = {
  productId: string;
  productTitle: string;
  alreadyLinked: boolean;
  // Pre-built inventory item the commit step will upsert if the
  // stylist keeps this row selected. Fields default-safe — unit_cost
  // is 0 because the storefront doesn't track cost-of-goods (stylist
  // can fill it in later); quantity comes from inventory_count when
  // present, otherwise 0.
  item: InventoryItem;
};

// Storefront category enum → inventory category label. Best effort
// only — anything unknown falls back to "Other" so the import never
// blocks on an exotic category.
const STOREFRONT_TO_INVENTORY_CATEGORY: Record<string, string> = {
  hair_bundles:  "Hair / bundles",
  braiding_hair: "Braiding hair",
  oils:          "Products",
  edge_control:  "Products",
  bonnets:       "Products",
  accessories:   "Supplies",
  tools:         "Tools",
  maintenance:   "Products",
  digital:       "Other",
  other:         "Other",
};

const mapStorefrontCategory = (raw: string | null | undefined): string => {
  if (!raw) return "Other";
  return STOREFRONT_TO_INVENTORY_CATEGORY[raw] || "Other";
};

/**
 * Build the seed suggestions for the "Seed from Shop" sheet. Pure —
 * the caller picks which suggestions to commit and runs the upserts
 * themselves so the wiring stays in one place (page.tsx).
 *
 * Products already linked to inventory show up so the stylist can
 * see them, but they're flagged so the UI can disable them.
 */
export const buildShopSeedSuggestions = (
  products: StorefrontProductSeed[] | null | undefined,
  existingItems: InventoryItem[] | null | undefined,
): ShopSeedSuggestion[] => {
  const linkedItemIds = new Set(
    (products || [])
      .map(p => (p?.inventory_item_id || "").trim())
      .filter(Boolean),
  );
  const itemById = new Map<string, InventoryItem>();
  for (const i of (existingItems || [])) itemById.set(i.id, i);

  const out: ShopSeedSuggestion[] = [];
  for (const p of (products || [])) {
    if (!p?.id || !p?.title) continue;
    const alreadyLinked = !!p.inventory_item_id && itemById.has(p.inventory_item_id);
    const item: InventoryItem = {
      id: genId(),
      name: p.title.trim(),
      sku: p.slug || null,
      category: mapStorefrontCategory(p.category),
      unit: "each",
      unitCost: 0,
      retailPrice: p.price ?? null,
      quantityOnHand: Number.isFinite(p.inventory_count as number) ? Number(p.inventory_count) : 0,
      lowStockThreshold: 0,
      supplier: null,
      photoPath: p.image_url || null,
      storefrontProductId: p.id,
      // Seeded straight from the storefront, so it's store stock.
      itemType: "retail",
      archivedAt: null,
    };
    out.push({
      productId: p.id,
      productTitle: p.title,
      alreadyLinked,
      item,
    });
  }
  // Linked rows last so the stylist's eye lands on actionable rows
  // first when they open the sheet.
  out.sort((a, b) => Number(a.alreadyLinked) - Number(b.alreadyLinked));
  return out;
};

// =====================================================================
// Push to Storefront — turn inventory items into storefront products.
//
// Mirror of the Seed-from-Shop direction. Given a set of inventory
// items and the user's existing storefront products, build the
// upsert payload for each item so the caller can commit. Drafts are
// always created INACTIVE so the stylist gets a preview pass before
// customers see them.
// =====================================================================

// Reverse of STOREFRONT_TO_INVENTORY_CATEGORY — we map back into
// the storefront enum so an inventory item with category
// "Hair / bundles" becomes a storefront product in "hair_bundles".
// Anything unrecognized falls back to "other".
const INVENTORY_TO_STOREFRONT_CATEGORY: Record<string, string> = {
  "Hair / bundles":  "hair_bundles",
  "Braiding hair":   "braiding_hair",
  "Products":        "other",
  "Tools":           "tools",
  "Supplies":        "accessories",
  "Packaging":       "accessories",
  "Other":           "other",
};

const inventoryCategoryToStorefront = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  return INVENTORY_TO_STOREFRONT_CATEGORY[raw.trim()] || "other";
};

export type PushToStorefrontSuggestion = {
  itemId: string;
  itemName: string;
  alreadyLinked: boolean;          // item already has a storefront_product_id
  existingProductId: string | null; // when alreadyLinked, the linked product id
  // Payload to write — either as a new product (no productId) or
  // as a PATCH on the existing product (productId set). The shape
  // matches productsApi.upsert's Partial<ProductInput> & { id? }.
  draft: {
    id?: string;
    title: string;
    slug?: string;
    description: string | null;
    price: number | null;
    image_url: string | null;
    category: string | null;
    // Omitted entirely when patching an existing product — PATCH-safe
    // upsert (post-#313) preserves whatever the stylist had set.
    // Defaults to false on brand-new pushes so a draft can be
    // previewed before customers see it.
    active?: boolean;
    inventory_item_id: string;
  };
};

export const buildPushToStorefrontSuggestions = (
  items: InventoryItem[] | null | undefined,
  existingProducts: StorefrontProductSeed[] | null | undefined,
): PushToStorefrontSuggestion[] => {
  const productById = new Map<string, StorefrontProductSeed>();
  for (const p of (existingProducts || [])) productById.set(p.id, p);
  const out: PushToStorefrontSuggestion[] = [];
  for (const i of (items || [])) {
    if (!i?.id || !i?.name) continue;
    if (i.archivedAt) continue;
    // Service-only supplies aren't for sale — don't offer them as
    // storefront drafts. Already-linked items still surface so their
    // status shows even if mis-typed.
    if (!isForSale(i) && !i.storefrontProductId) continue;
    const linked = i.storefrontProductId ? productById.get(i.storefrontProductId) || null : null;
    const retail = i.retailPrice == null ? null : Number(i.retailPrice);
    out.push({
      itemId: i.id,
      itemName: i.name,
      alreadyLinked: !!linked,
      existingProductId: linked?.id || null,
      draft: {
        // Setting id only when we already have a storefront product
        // makes productsApi.upsert do a PATCH on that row (post-#313
        // it's PATCH-safe), so non-draft fields on the existing
        // product survive untouched.
        ...(linked?.id ? { id: linked.id } : {}),
        title: i.name,
        description: null, // inventory items don't have descriptions in V1
        price: Number.isFinite(retail as number) ? retail : null,
        image_url: i.photoPath || null,
        category: inventoryCategoryToStorefront(i.category),
        // `active` is OMITTED on PATCH so the linked product's
        // existing visibility is preserved; on fresh creates we
        // default to false so the listing starts as a draft.
        ...(linked ? {} : { active: false }),
        inventory_item_id: i.id,
      },
    });
  }
  // Already-linked items last so the stylist's eye lands on
  // actionable rows first.
  out.sort((a, b) => Number(a.alreadyLinked) - Number(b.alreadyLinked));
  return out;
};

// Sample CSV the "Download template" button serves. Headers match
// the primary aliases parseInventoryCsv looks for, so a stylist who
// fills this in and re-imports is guaranteed to round-trip.
export const INVENTORY_CSV_TEMPLATE = [
  "name,category,item_type,unit,unit_cost,retail_price,quantity,low_stock_threshold,sku,supplier,storefront_product",
  "X-Pression Pre-Stretched 24in (Black),Braiding hair,service,bundle,6.50,,12,4,XP24-1B,Outre,",
  "Got2b Glued Edge Control,Products,both,each,5.99,9.99,6,2,G2B-EC,Got2b,got2b-glued-edge-control",
  "Bonnet (satin),Products,retail,each,3.00,12.00,8,2,BNT-ST,Generic,",
  "Rat-tail comb,Tools,service,each,2.25,,3,1,,Diane,",
].join("\r\n");
