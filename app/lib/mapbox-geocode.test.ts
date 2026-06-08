import { describe, it, expect } from "vitest";
import { augmentAddress } from "./mapbox-geocode";

describe("augmentAddress", () => {
  it("appends city + state to a bare street address", () => {
    expect(augmentAddress("5309 Knowlton Street", { city: "Los Angeles", state: "CA" }))
      .toBe("5309 Knowlton Street, Los Angeles, CA");
  });

  it("leaves a fully-qualified address alone", () => {
    expect(augmentAddress("5309 Knowlton St, Los Angeles, CA 90032", { city: "Los Angeles", state: "CA" }))
      .toBe("5309 Knowlton St, Los Angeles, CA 90032");
  });

  it("leaves an address with a zip alone (zip is enough)", () => {
    expect(augmentAddress("5309 Knowlton St 90032", { city: "Los Angeles", state: "CA" }))
      .toBe("5309 Knowlton St 90032");
  });

  it("leaves an address with the state already present alone", () => {
    expect(augmentAddress("5309 Knowlton St, CA", { city: "Los Angeles", state: "CA" }))
      .toBe("5309 Knowlton St, CA");
  });

  it("doesn't double up the city when the address already names it", () => {
    expect(augmentAddress("5309 Knowlton St Los Angeles", { city: "Los Angeles", state: "CA" }))
      .toBe("5309 Knowlton St Los Angeles, CA");
  });

  it("returns the input unchanged when no context is provided", () => {
    expect(augmentAddress("5309 Knowlton Street", {})).toBe("5309 Knowlton Street");
  });

  it("handles state-only context", () => {
    expect(augmentAddress("5309 Knowlton St", { state: "CA" }))
      .toBe("5309 Knowlton St, CA");
  });

  it("trims whitespace", () => {
    expect(augmentAddress("  5309 Knowlton St  ", { city: "Los Angeles", state: "CA" }))
      .toBe("5309 Knowlton St, Los Angeles, CA");
  });
});
