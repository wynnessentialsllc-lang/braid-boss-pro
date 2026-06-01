import { describe, it, expect } from "vitest";
import {
  normalizeSlug,
  isReservedSlug,
  generateSlug,
  validateSlug,
  slugReasonMessage,
  buildBookingUrl,
  SLUG_MAX_LENGTH,
  SLUG_PATTERN,
} from "./publicSlug";

describe("normalizeSlug", () => {
  it("lowercases, trims, and hyphenates non-alphanumeric runs", () => {
    expect(normalizeSlug("  My Studio!! ")).toBe("my-studio");
    expect(normalizeSlug("A__B--C")).toBe("a-b-c");
  });

  it("strips leading and trailing hyphens", () => {
    expect(normalizeSlug("---hi---")).toBe("hi");
    expect(normalizeSlug("!!!a b!!!")).toBe("a-b");
  });

  it("returns empty string for null/undefined/blank", () => {
    expect(normalizeSlug(null)).toBe("");
    expect(normalizeSlug(undefined)).toBe("");
    expect(normalizeSlug("   ")).toBe("");
  });

  it("truncates to the max length", () => {
    expect(normalizeSlug("a".repeat(60))).toHaveLength(SLUG_MAX_LENGTH);
  });
});

describe("isReservedSlug", () => {
  it("flags reserved words case-insensitively", () => {
    expect(isReservedSlug("admin")).toBe(true);
    expect(isReservedSlug("ADMIN")).toBe(true);
    expect(isReservedSlug("book")).toBe(true);
  });

  it("does not flag ordinary slugs or empty input", () => {
    expect(isReservedSlug("sbw-braiding")).toBe(false);
    expect(isReservedSlug("")).toBe(false);
  });
});

describe("validateSlug", () => {
  it("accepts a valid branded slug", () => {
    expect(validateSlug("sbw-braiding")).toEqual({ ok: true });
  });

  it("rejects slugs that are too short after normalization", () => {
    const result = validateSlug("ab");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("too_short");
  });

  it("rejects reserved slugs", () => {
    const result = validateSlug("settings");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("reserved");
  });
});

describe("generateSlug", () => {
  it("derives a slug from a business name", () => {
    expect(generateSlug("My Studio")).toBe("my-studio");
  });

  it("falls back to 'studio' when the name has no usable characters", () => {
    expect(generateSlug("")).toBe("studio");
    expect(generateSlug("!!!")).toBe("studio");
  });

  it("produces a pattern-valid, length-bounded slug with a suffix", () => {
    const slug = generateSlug("My Studio", { suffix: true });
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(SLUG_PATTERN.test(slug)).toBe(true);
    expect(slug.startsWith("my-studio-")).toBe(true);
  });
});

describe("slugReasonMessage", () => {
  it("maps known reasons to copy", () => {
    expect(slugReasonMessage("available")).toBe("This link is available.");
    expect(slugReasonMessage("taken")).toContain("already using");
  });

  it("falls back for unknown reasons", () => {
    expect(slugReasonMessage("something-else")).toBe(
      "Couldn't save that booking link. Try again.",
    );
  });
});

describe("buildBookingUrl", () => {
  it("builds the public booking URL from a slug", () => {
    expect(buildBookingUrl("sbw-braiding")).toBe(
      "https://braidbosspro.app/book/sbw-braiding",
    );
  });
});
