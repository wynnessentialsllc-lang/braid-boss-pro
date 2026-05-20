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
import { INVENTORY_CATEGORIES, INVENTORY_UNITS, type InventoryItem } from "./inventory";

export type CsvImportRow = {
  // Parsed item. id is generated client-side now so we can link
  // products against it without round-tripping to the DB first.
  item: InventoryItem;
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
    const unitRaw = pickField(r, ["unit", "uom"]);
    const unitCostRaw = pickField(r, ["unit cost", "cost", "unit price", "cost per unit"]);
    const retailPriceRaw = pickField(r, ["retail price", "price", "sale price", "retail"]);
    const quantityRaw = pickField(r, ["quantity", "qty", "on hand", "stock"]);
    const thresholdRaw = pickField(r, ["low stock threshold", "low stock", "reorder at", "alert at", "threshold"]);
    const supplierRaw = pickField(r, ["supplier", "vendor", "brand"]);
    const productRaw = pickField(r, ["storefront product", "storefront_product", "linked product", "product link"]);

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
      archivedAt: null,
    };

    out.push({
      item,
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

// Sample CSV the "Download template" button serves. Headers match
// the primary aliases parseInventoryCsv looks for, so a stylist who
// fills this in and re-imports is guaranteed to round-trip.
export const INVENTORY_CSV_TEMPLATE = [
  "name,category,unit,unit_cost,retail_price,quantity,low_stock_threshold,sku,supplier,storefront_product",
  "X-Pression Pre-Stretched 24in (Black),Braiding hair,bundle,6.50,,12,4,XP24-1B,Outre,",
  "Got2b Glued Edge Control,Products,each,5.99,9.99,6,2,G2B-EC,Got2b,got2b-glued-edge-control",
  "Rat-tail comb,Tools,each,2.25,,3,1,,Diane,",
].join("\r\n");
