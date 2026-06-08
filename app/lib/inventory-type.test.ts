import { describe, it, expect } from "vitest";
import {
  itemType,
  itemTypeLabel,
  isForSale,
  isServiceUse,
  computeInventoryTotals,
  type InventoryItem,
} from "./inventory";
import {
  parseInventoryCsv,
  buildPushToStorefrontSuggestions,
  buildShopSeedSuggestions,
} from "./inventory-import";

const item = (over: Partial<InventoryItem>): InventoryItem => ({
  id: Math.random().toString(36).slice(2),
  name: "Item",
  ...over,
});

describe("itemType", () => {
  it("defaults legacy / unset rows to retail", () => {
    expect(itemType(item({}))).toBe("retail");
    expect(itemType(item({ itemType: null }))).toBe("retail");
    expect(itemType(item({ itemType: "" }))).toBe("retail");
    expect(itemType(item({ itemType: "bogus" }))).toBe("retail");
  });

  it("reads service and both", () => {
    expect(itemType(item({ itemType: "service" }))).toBe("service");
    expect(itemType(item({ itemType: "both" }))).toBe("both");
    expect(itemType(item({ itemType: "SERVICE" }))).toBe("service");
  });

  it("labels each type", () => {
    expect(itemTypeLabel("retail")).toBe("For sale");
    expect(itemTypeLabel("service")).toBe("Used on clients");
    expect(itemTypeLabel("both")).toBe("Sold & used");
  });
});

describe("isForSale / isServiceUse", () => {
  it("retail is sellable only", () => {
    const i = item({ itemType: "retail" });
    expect(isForSale(i)).toBe(true);
    expect(isServiceUse(i)).toBe(false);
  });
  it("service is usable only", () => {
    const i = item({ itemType: "service" });
    expect(isForSale(i)).toBe(false);
    expect(isServiceUse(i)).toBe(true);
  });
  it("both counts as each", () => {
    const i = item({ itemType: "both" });
    expect(isForSale(i)).toBe(true);
    expect(isServiceUse(i)).toBe(true);
  });
});

describe("computeInventoryTotals type split", () => {
  it("splits value by type, counting both in each bucket", () => {
    const items = [
      item({ itemType: "retail", quantityOnHand: 2, unitCost: 10 }),  // 20, sale
      item({ itemType: "service", quantityOnHand: 1, unitCost: 5 }),  // 5, service
      item({ itemType: "both", quantityOnHand: 3, unitCost: 4 }),     // 12, both
    ];
    const t = computeInventoryTotals(items);
    expect(t.itemCount).toBe(3);
    expect(t.totalValue).toBe(37);
    expect(t.forSaleCount).toBe(2);     // retail + both
    expect(t.forSaleValue).toBe(32);    // 20 + 12
    expect(t.serviceCount).toBe(2);     // service + both
    expect(t.serviceValue).toBe(17);    // 5 + 12
  });
});

describe("CSV import classification", () => {
  const empty = { items: [], products: [] };

  it("reads an explicit item_type column", () => {
    const csv = [
      "name,item_type,quantity",
      "Edge control,both,5",
      "Comb,service,2",
      "Bonnet,retail,3",
    ].join("\n");
    const { rows } = parseInventoryCsv(csv, empty);
    expect(itemType(rows[0].item)).toBe("both");
    expect(itemType(rows[1].item)).toBe("service");
    expect(itemType(rows[2].item)).toBe("retail");
  });

  it("infers retail when a retail price is present, service otherwise", () => {
    const csv = [
      "name,retail_price,quantity",
      "Bonnet,12.00,3",
      "Rat-tail comb,,2",
    ].join("\n");
    const { rows } = parseInventoryCsv(csv, empty);
    expect(itemType(rows[0].item)).toBe("retail");
    expect(itemType(rows[1].item)).toBe("service");
  });

  it("does not let the category 'type' alias steal the item_type column", () => {
    const csv = [
      "name,type,item_type,quantity",
      "Bundle,Braiding hair,service,4",
    ].join("\n");
    const { rows } = parseInventoryCsv(csv, empty);
    expect(rows[0].item.category).toBe("Braiding hair");
    expect(itemType(rows[0].item)).toBe("service");
  });
});

describe("push to storefront skips service-only items", () => {
  it("omits service items but keeps retail/both and linked items", () => {
    const items = [
      item({ id: "a", name: "Bonnet", itemType: "retail" }),
      item({ id: "b", name: "Edge control", itemType: "both" }),
      item({ id: "c", name: "Comb", itemType: "service" }),
      item({ id: "d", name: "Linked supply", itemType: "service", storefrontProductId: "p1" }),
    ];
    const out = buildPushToStorefrontSuggestions(items, []);
    const ids = out.map(s => s.itemId).sort();
    expect(ids).toEqual(["a", "b", "d"]); // 'c' (service, unlinked) skipped
  });
});

describe("seed from shop is store stock", () => {
  it("tags seeded products as retail", () => {
    const out = buildShopSeedSuggestions(
      [{ id: "p1", title: "Bonnet", slug: "bonnet", category: "accessories", price: 12, inventory_count: 4, image_url: null, inventory_item_id: null }],
      [],
    );
    expect(itemType(out[0].item)).toBe("retail");
  });
});
