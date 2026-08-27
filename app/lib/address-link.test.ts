import { describe, it, expect } from "vitest";
import {
  findAddresses,
  isLikelyAddress,
  mapsDirectionsUrl,
  normalizeAddressQuery,
  splitByAddresses,
} from "./address-link";

describe("findAddresses", () => {
  it("finds a labeled address line", () => {
    const body = "Please arrive on time.\nAddress: 5309 Knowlton St, Cincinnati, OH 45223\nBring your own hair.";
    expect(findAddresses(body).map((a) => a.value)).toEqual([
      "5309 Knowlton St, Cincinnati, OH 45223",
    ]);
  });

  it("accepts the qualified label phrasings braiders type", () => {
    for (const label of ["Service address", "Studio Location", "Salon address", "Where"]) {
      const hits = findAddresses(`${label}: 42 Peachtree Ave, Atlanta, GA`);
      expect(hits.map((a) => a.value)).toEqual(["42 Peachtree Ave, Atlanta, GA"]);
    }
  });

  it("reads the next line when the label line has no value", () => {
    const body = "Address:\n123 Main Street\nSuite 4";
    expect(findAddresses(body).map((a) => a.value)).toEqual(["123 Main Street"]);
  });

  it("finds a bare street address with no label", () => {
    const body = "Come to 88 Rosewood Blvd Apt 3, Dallas, TX 75201 fifteen minutes early.";
    expect(findAddresses(body).map((a) => a.value)).toEqual([
      "88 Rosewood Blvd Apt 3, Dallas, TX 75201",
    ]);
  });

  it("stops at the end of the address, not the end of the sentence", () => {
    // The suffix period is kept — it reads as "St." and maps fine either
    // way; what matters is that the sentence after it is not swallowed.
    const body = "Address: 123 Main St. Please park in the rear.";
    expect(findAddresses(body).map((a) => a.value)).toEqual(["123 Main St."]);
  });

  it("drops a trailing parenthetical note", () => {
    const body = "Address: 88 Rosewood Blvd (ring the buzzer)";
    expect(findAddresses(body).map((a) => a.value)).toEqual(["88 Rosewood Blvd"]);
  });

  it("keeps a named venue line that has no street suffix", () => {
    const body = "Location: The Braid Loft, Cincinnati, OH";
    expect(findAddresses(body).map((a) => a.value)).toEqual(["The Braid Loft, Cincinnati, OH"]);
  });

  it("keeps spans that slice the source verbatim, even with odd spacing", () => {
    const body = "Address:   5309   Knowlton St ,  Cincinnati , OH\nSee you then.";
    for (const hit of findAddresses(body)) {
      expect(body.slice(hit.start, hit.end)).toBe(hit.value);
    }
  });

  it("skips placeholders instead of linking them", () => {
    expect(findAddresses("Address: TBD")).toEqual([]);
    expect(findAddresses("Location: to be shared 24 hours before")).toEqual([]);
    expect(findAddresses("Address: your home — this is a mobile service")).toEqual([]);
  });

  it("does not match prices, dates or phone numbers", () => {
    const body = "A $150 deposit is due. Booked for 3 May 2026. Call 513-555-0134.";
    expect(findAddresses(body)).toEqual([]);
  });

  it("returns non-overlapping hits in document order", () => {
    const body = "Address: 12 Oak St, Akron, OH\nBackup: 500 Vine Road, Akron, OH";
    const hits = findAddresses(body);
    expect(hits.map((a) => a.value)).toEqual(["12 Oak St, Akron, OH", "500 Vine Road, Akron, OH"]);
    expect(hits[0].end).toBeLessThanOrEqual(hits[1].start);
  });

  it("reports offsets that slice the original text back out", () => {
    const body = "Address: 5309 Knowlton St, Cincinnati, OH 45223\n";
    const [hit] = findAddresses(body);
    expect(body.slice(hit.start, hit.end)).toBe(hit.value);
  });

  it("handles empty and non-string input", () => {
    expect(findAddresses("")).toEqual([]);
    expect(findAddresses("   \n  ")).toEqual([]);
    expect(findAddresses(undefined as unknown as string)).toEqual([]);
  });
});

describe("isLikelyAddress", () => {
  it("accepts a street address and a city/state pair", () => {
    expect(isLikelyAddress("123 Main St")).toBe(true);
    expect(isLikelyAddress("The Braid Loft, Cincinnati, OH")).toBe(true);
  });

  it("rejects placeholders and stray words", () => {
    expect(isLikelyAddress("TBD")).toBe(false);
    expect(isLikelyAddress("mobile")).toBe(false);
    expect(isLikelyAddress("soon")).toBe(false);
  });
});

describe("splitByAddresses", () => {
  it("round-trips to the original text", () => {
    const body = "Arrive at Address: 5309 Knowlton St, Cincinnati, OH 45223\nThanks!";
    const joined = splitByAddresses(body).map((s) => s.value).join("");
    expect(joined).toBe(body);
  });

  it("marks the address segment", () => {
    const segs = splitByAddresses("Address: 12 Oak St, Akron, OH");
    expect(segs.filter((s) => s.type === "address").map((s) => s.value)).toEqual([
      "12 Oak St, Akron, OH",
    ]);
  });

  it("returns a single text segment when nothing matches", () => {
    expect(splitByAddresses("No address here.")).toEqual([
      { type: "text", value: "No address here." },
    ]);
  });

  it("returns nothing for empty text", () => {
    expect(splitByAddresses("")).toEqual([]);
  });
});

describe("normalizeAddressQuery", () => {
  it("collapses multi-line addresses into one query", () => {
    expect(normalizeAddressQuery("5309 Knowlton St\nSuite 2\nCincinnati, OH")).toBe(
      "5309 Knowlton St, Suite 2, Cincinnati, OH",
    );
  });
});

describe("mapsDirectionsUrl", () => {
  it("deep-links Apple Maps on Apple devices", () => {
    const url = mapsDirectionsUrl("12 Oak St, Akron, OH", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)");
    expect(url).toBe("https://maps.apple.com/?daddr=12%20Oak%20St%2C%20Akron%2C%20OH");
  });

  it("uses the Google Maps universal link everywhere else", () => {
    const url = mapsDirectionsUrl("12 Oak St", "Mozilla/5.0 (Linux; Android 14)");
    expect(url).toBe("https://www.google.com/maps/dir/?api=1&destination=12%20Oak%20St");
  });

  it("returns an empty string for empty input", () => {
    expect(mapsDirectionsUrl("")).toBe("");
    expect(mapsDirectionsUrl("   \n ")).toBe("");
  });
});
