import { describe, it, expect } from "vitest";
import {
  tzOffsetMs,
  isValidTimeZone,
  todayIsoInTz,
  nowMsForTz,
  listTimeZones,
  formatTimeZoneLabel,
} from "./timezone";

const HOUR = 3600_000;

// A summer instant (US daylight saving in effect) and a winter one, so the
// DST-sensitive assertions below actually exercise both sides.
const SUMMER = new Date("2026-07-15T16:00:00.000Z");
const WINTER = new Date("2026-01-15T16:00:00.000Z");

describe("tzOffsetMs", () => {
  it("returns the offset in effect at that instant, not a fixed one", () => {
    // New York is UTC-4 in July (EDT) and UTC-5 in January (EST).
    expect(tzOffsetMs("America/New_York", SUMMER)).toBe(-4 * HOUR);
    expect(tzOffsetMs("America/New_York", WINTER)).toBe(-5 * HOUR);
  });

  it("handles zones ahead of UTC and half-hour offsets", () => {
    expect(tzOffsetMs("Europe/Berlin", SUMMER)).toBe(2 * HOUR);
    expect(tzOffsetMs("Asia/Kolkata", SUMMER)).toBe(5.5 * HOUR);
  });

  it("is zero for UTC", () => {
    expect(tzOffsetMs("UTC", SUMMER)).toBe(0);
  });

  it("degrades to UTC rather than throwing on a bad zone", () => {
    expect(tzOffsetMs("Not/AZone", SUMMER)).toBe(0);
    expect(tzOffsetMs("", SUMMER)).toBe(0);
  });
});

describe("isValidTimeZone", () => {
  it("accepts real IANA zones", () => {
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
  });

  it("rejects junk, empties, and non-strings", () => {
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone("   ")).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
  });
});

describe("todayIsoInTz", () => {
  it("gives the stylist's calendar date, not the server's", () => {
    // 01:00 UTC on the 16th is still the 15th in New York. A UTC server
    // would roll the business day over five hours early.
    const lateUtc = new Date("2026-07-16T01:00:00.000Z");
    expect(todayIsoInTz("UTC", lateUtc)).toBe("2026-07-16");
    expect(todayIsoInTz("America/New_York", lateUtc)).toBe("2026-07-15");
  });

  it("rolls forward for zones ahead of UTC", () => {
    const lateUtc = new Date("2026-07-15T23:00:00.000Z");
    expect(todayIsoInTz("Asia/Tokyo", lateUtc)).toBe("2026-07-16");
  });

  it("always returns YYYY-MM-DD", () => {
    expect(todayIsoInTz("America/New_York", SUMMER)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("nowMsForTz", () => {
  it("shifts the clock so wall-clock date math lands on the right instant", () => {
    // This is the property the rule sweep depends on. notification-rules
    // builds an appointment start with new Date(y, m-1, d, hh, mm) — in a
    // UTC process that is the wall-clock time read as UTC. Comparing it to
    // nowMsForTz must yield the TRUE remaining time.
    const tz = "America/New_York";
    // 2 PM Eastern on 2026-07-15 is 18:00 UTC.
    const trueStart = new Date("2026-07-15T18:00:00.000Z");
    // What a UTC process computes from the stored wall clock "14:00".
    const utcInterpretation = Date.UTC(2026, 6, 15, 14, 0);

    // Ninety minutes before the appointment really starts.
    const now = new Date(trueStart.getTime() - 90 * 60_000);
    const delta = utcInterpretation - nowMsForTz(tz, now);
    expect(delta).toBe(90 * 60_000);
  });

  it("is a no-op for a UTC stylist", () => {
    expect(nowMsForTz("UTC", SUMMER)).toBe(SUMMER.getTime());
  });
});

describe("listTimeZones", () => {
  it("returns a sorted, de-duplicated list", () => {
    const list = listTimeZones();
    expect(list.length).toBeGreaterThan(0);
    expect(list).toEqual([...list].sort((a, b) => a.localeCompare(b)));
    expect(new Set(list).size).toBe(list.length);
  });

  it("covers the US zones a stylist is most likely to need", () => {
    const list = listTimeZones();
    for (const tz of [
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles",
    ]) {
      expect(list).toContain(tz);
    }
  });

  it("folds in pinned zones so a saved setting can never be dropped", () => {
    // The guarantee that matters: whatever the runtime does or doesn't
    // enumerate, the stylist's current value stays selectable.
    const list = listTimeZones(["Asia/Kolkata", "Europe/Berlin"]);
    expect(list).toContain("Asia/Kolkata");
    expect(list).toContain("Europe/Berlin");
  });

  it("ignores null, undefined, and invalid pins", () => {
    const list = listTimeZones([null, undefined, "", "Not/AZone"]);
    expect(list).not.toContain("Not/AZone");
    expect(list.every((tz) => typeof tz === "string" && tz.length > 0)).toBe(true);
  });
});

describe("formatTimeZoneLabel", () => {
  it("shows the offset in effect at that moment, not standard time", () => {
    expect(formatTimeZoneLabel("America/New_York", SUMMER)).toBe("America/New York (UTC-4)");
    expect(formatTimeZoneLabel("America/New_York", WINTER)).toBe("America/New York (UTC-5)");
  });

  it("renders half-hour offsets", () => {
    expect(formatTimeZoneLabel("Asia/Kolkata", SUMMER)).toBe("Asia/Kolkata (UTC+5:30)");
  });

  it("renders UTC without a signed offset suffix beyond +0", () => {
    expect(formatTimeZoneLabel("UTC", SUMMER)).toBe("UTC (UTC+0)");
  });

  it("passes a bad zone through instead of throwing", () => {
    expect(formatTimeZoneLabel("Not/AZone", SUMMER)).toBe("Not/AZone");
  });
});
