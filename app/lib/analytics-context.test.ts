import { describe, it, expect } from "vitest";
import {
  classifyReferrer,
  deviceClass,
  osFromUa,
  browserFromUa,
  sanitizeMetadata,
} from "./analytics-context";

describe("classifyReferrer", () => {
  it("treats a missing referrer as direct", () => {
    expect(classifyReferrer(null, "braidbosspro.app")).toBe("direct");
  });

  it("treats our own host (and its subdomains) as internal", () => {
    expect(classifyReferrer("braidbosspro.app", "braidbosspro.app")).toBe("internal");
    expect(classifyReferrer("www.braidbosspro.app", "braidbosspro.app")).toBe("internal");
    expect(classifyReferrer("book.braidbosspro.app", "braidbosspro.app")).toBe("internal");
  });

  it("classifies AI assistants ahead of search", () => {
    expect(classifyReferrer("chatgpt.com", "braidbosspro.app")).toBe("ai");
    expect(classifyReferrer("claude.ai", "braidbosspro.app")).toBe("ai");
    expect(classifyReferrer("www.perplexity.ai", "braidbosspro.app")).toBe("ai");
    // Would otherwise match the google.com search rule.
    expect(classifyReferrer("gemini.google.com", "braidbosspro.app")).toBe("ai");
  });

  it("classifies search and social", () => {
    expect(classifyReferrer("www.google.com", "braidbosspro.app")).toBe("search");
    expect(classifyReferrer("duckduckgo.com", "braidbosspro.app")).toBe("search");
    expect(classifyReferrer("l.instagram.com", "braidbosspro.app")).toBe("social");
    expect(classifyReferrer("t.co", "braidbosspro.app")).toBe("social");
  });

  it("falls back to referral for anything else", () => {
    expect(classifyReferrer("somebraidblog.com", "braidbosspro.app")).toBe("referral");
  });
});

describe("deviceClass", () => {
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  const IPAD = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  const ANDROID_PHONE = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
  const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  it("buckets by user agent", () => {
    expect(deviceClass(IPHONE, 390)).toBe("phone");
    expect(deviceClass(IPAD, 820)).toBe("tablet");
    expect(deviceClass(ANDROID_PHONE, 412)).toBe("phone");
    expect(deviceClass(MAC, 1440)).toBe("desktop");
  });

  it("falls back to viewport width when the UA says nothing", () => {
    expect(deviceClass("", 375)).toBe("phone");
    expect(deviceClass("", 800)).toBe("tablet");
    expect(deviceClass("", 1600)).toBe("desktop");
    // Unknown width must not be read as a phone.
    expect(deviceClass("", 0)).toBe("desktop");
  });

  it("reads OS and browser", () => {
    expect(osFromUa(IPHONE)).toBe("ios");
    expect(osFromUa(ANDROID_PHONE)).toBe("android");
    expect(osFromUa(MAC)).toBe("macos");
    expect(browserFromUa(IPHONE)).toBe("safari");
    expect(browserFromUa(MAC)).toBe("chrome");
    expect(browserFromUa("Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537.36 Edg/120")).toBe("edge");
  });
});

describe("sanitizeMetadata", () => {
  it("drops PII-shaped keys", () => {
    const out = sanitizeMetadata({
      serviceName: "Knotless Medium",
      email: "someone@example.com",
      phone: "555-0100",
      name: "Jane",
      notes: "allergic to...",
    });
    expect(out).toEqual({ serviceName: "Knotless Medium" });
  });

  it("keeps scalars, drops nested structures", () => {
    const out = sanitizeMetadata({
      slotCount: 3,
      soldOut: false,
      empty: null,
      nested: { a: 1 },
      list: [1, 2],
    });
    expect(out).toEqual({ slotCount: 3, soldOut: false, empty: null });
  });

  it("truncates long strings and tolerates junk input", () => {
    const out = sanitizeMetadata({ blurb: "x".repeat(500) });
    expect((out.blurb as string).length).toBe(200);
    expect(sanitizeMetadata(undefined)).toEqual({});
  });
});
