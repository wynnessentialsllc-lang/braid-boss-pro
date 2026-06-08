import { describe, it, expect } from "vitest";
import {
  recipeCost,
  recipeCostFromInventory,
  lineFromInventoryItem,
  type RecipeLine,
} from "./recipe-cost";

const line = (over: Partial<RecipeLine>): RecipeLine => ({
  id: "l1",
  itemId: "i1",
  itemName: "Braiding hair",
  quantity: 1,
  unitCost: 0,
  ...over,
});

describe("recipeCost", () => {
  it("sums quantity × snapshotted unit cost", () => {
    const lines = [
      line({ id: "a", itemId: "hair", itemName: "Braiding hair", quantity: 2, unitCost: 4.5 }),
      line({ id: "b", itemId: "bundle", itemName: "Human bundle", quantity: 2, unitCost: 19 }),
    ];
    expect(recipeCost(lines)).toBe(47); // 2*4.5 + 2*19
  });

  it("returns 0 for empty / null", () => {
    expect(recipeCost([])).toBe(0);
    expect(recipeCost(null)).toBe(0);
    expect(recipeCost(undefined)).toBe(0);
  });

  it("coerces garbage quantities/costs to 0", () => {
    const lines = [
      // @ts-expect-error testing runtime coercion of bad quantity
      line({ quantity: "x", unitCost: 10 }),
      line({ quantity: 3, unitCost: 5 }),
    ];
    expect(recipeCost(lines)).toBe(15);
  });
});

describe("recipeCostFromInventory", () => {
  it("uses current inventory unit cost over the snapshot", () => {
    const lines = [line({ itemId: "hair", quantity: 2, unitCost: 4.5 })];
    const items = [{ id: "hair", name: "Braiding hair", unitCost: 6 }];
    expect(recipeCostFromInventory(lines, items)).toBe(12); // 2 * 6 (current)
  });

  it("falls back to the snapshot when the item was removed", () => {
    const lines = [line({ itemId: "gone", quantity: 2, unitCost: 4.5 })];
    expect(recipeCostFromInventory(lines, [])).toBe(9); // 2 * 4.5 (snapshot)
  });
});

describe("lineFromInventoryItem", () => {
  it("snapshots name and cost from the item", () => {
    const l = lineFromInventoryItem("row1", { id: "hair", name: " Outre X-Pression ", unitCost: "4.50" }, 2);
    expect(l).toEqual({
      id: "row1",
      itemId: "hair",
      itemName: "Outre X-Pression",
      quantity: 2,
      unitCost: 4.5,
    });
  });

  it("defaults a blank name and missing cost gracefully", () => {
    const l = lineFromInventoryItem("row1", { id: "x", name: "", unitCost: null });
    expect(l.itemName).toBe("Item");
    expect(l.unitCost).toBe(0);
    expect(l.quantity).toBe(1);
  });
});
