import { describe, it, expect } from "vitest";
import {
  computeBookingWindow,
  isDateBookable,
  isMonthBeyondWindow,
  describeBookingWindow,
} from "./bookingWindow";

// A fixed reference "now" so every case is deterministic.
// July 10, 2026, 09:00 local.
const JUL_10 = new Date(2026, 6, 10, 9, 0, 0);

describe("computeBookingWindow — rolling", () => {
  it("opens the next N days from today", () => {
    const win = computeBookingWindow({ mode: "rolling", windowDays: 60 }, JUL_10);
    expect(win.mode).toBe("rolling");
    expect(win.minDate).toBe("2026-07-10");
    expect(win.maxDate).toBe("2026-09-08"); // Jul 10 + 60 days
    expect(win.nextReleaseDate).toBeNull();
  });

  it("honours a 30-day preset", () => {
    const win = computeBookingWindow({ mode: "rolling", windowDays: 30 }, JUL_10);
    expect(win.maxDate).toBe("2026-08-09");
  });

  it("clamps absurd day counts into range", () => {
    const win = computeBookingWindow({ mode: "rolling", windowDays: 99999 }, JUL_10);
    // clamped to 730 days
    expect(win.windowDays).toBe(730);
  });
});

describe("computeBookingWindow — fixed", () => {
  it("caps at the cutoff date", () => {
    const win = computeBookingWindow({ mode: "fixed", until: "2026-08-01" }, JUL_10);
    expect(win.mode).toBe("fixed");
    expect(win.maxDate).toBe("2026-08-01");
  });

  it("has no cap when no cutoff is set", () => {
    const win = computeBookingWindow({ mode: "fixed", until: null }, JUL_10);
    expect(win.maxDate).toBeNull();
  });
});

describe("computeBookingWindow — monthly_release", () => {
  it("before the drop day: only the current month is open", () => {
    // Release on the 15th; today is the 10th (before the drop).
    const win = computeBookingWindow(
      { mode: "monthly_release", releaseDay: 15, releaseMonths: 1 },
      JUL_10,
    );
    expect(win.maxDate).toBe("2026-07-31");
    expect(win.nextReleaseDate).toBe("2026-07-15");
    expect(win.nextReleaseMaxDate).toBe("2026-08-31");
  });

  it("on/after the drop day: the next month is revealed", () => {
    const jul20 = new Date(2026, 6, 20, 9, 0, 0);
    const win = computeBookingWindow(
      { mode: "monthly_release", releaseDay: 15, releaseMonths: 1 },
      jul20,
    );
    expect(win.maxDate).toBe("2026-08-31");
    expect(win.nextReleaseDate).toBe("2026-08-15");
    expect(win.nextReleaseMaxDate).toBe("2026-09-30");
  });

  it("multi-month reach opens several months per drop", () => {
    const jul20 = new Date(2026, 6, 20, 9, 0, 0);
    const win = computeBookingWindow(
      { mode: "monthly_release", releaseDay: 1, releaseMonths: 3 },
      jul20,
    );
    // Drop in July opens through end of October (July + 3).
    expect(win.maxDate).toBe("2026-10-31");
  });

  it("clamps the release day to a value every month has", () => {
    const win = computeBookingWindow(
      { mode: "monthly_release", releaseDay: 31, releaseMonths: 1 },
      JUL_10,
    );
    expect(win.releaseDay).toBe(28);
  });
});

describe("minimum notice", () => {
  it("pushes the earliest bookable date forward", () => {
    const win = computeBookingWindow(
      { mode: "rolling", windowDays: 60, minNoticeHours: 48 },
      JUL_10,
    );
    expect(win.minDate).toBe("2026-07-12"); // +48h
  });

  it("no notice keeps today bookable", () => {
    const win = computeBookingWindow({ mode: "rolling", minNoticeHours: 0 }, JUL_10);
    expect(win.minDate).toBe("2026-07-10");
  });
});

describe("isDateBookable", () => {
  const win = computeBookingWindow({ mode: "rolling", windowDays: 60 }, JUL_10);
  it("accepts dates inside the window", () => {
    expect(isDateBookable(win, "2026-07-10")).toBe(true);
    expect(isDateBookable(win, "2026-09-08")).toBe(true);
  });
  it("rejects past and beyond-horizon dates", () => {
    expect(isDateBookable(win, "2026-07-09")).toBe(false);
    expect(isDateBookable(win, "2026-09-09")).toBe(false);
  });
});

describe("isMonthBeyondWindow", () => {
  const win = computeBookingWindow({ mode: "rolling", windowDays: 60 }, JUL_10);
  it("is false for a month containing the horizon", () => {
    expect(isMonthBeyondWindow(win, 2026, 9)).toBe(false);
  });
  it("is true for a month entirely past the horizon", () => {
    expect(isMonthBeyondWindow(win, 2026, 10)).toBe(true);
  });
  it("is never beyond when the window is uncapped", () => {
    const open = computeBookingWindow({ mode: "fixed", until: null }, JUL_10);
    expect(isMonthBeyondWindow(open, 2030, 1)).toBe(false);
  });
});

describe("describeBookingWindow", () => {
  it("summarises each mode in plain language", () => {
    expect(describeBookingWindow({ mode: "rolling", windowDays: 90 })).toMatch(/next 90 days/);
    expect(describeBookingWindow({ mode: "fixed", until: "2026-08-01" })).toMatch(/through/);
    expect(
      describeBookingWindow({ mode: "monthly_release", releaseDay: 1, releaseMonths: 1 }),
    ).toMatch(/1st of each month/);
  });
});
