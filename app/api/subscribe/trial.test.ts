import { describe, it, expect } from "vitest";
import { computeTrialParam } from "./trial";

// Fixed "now" so every case is deterministic regardless of when the
// suite runs.
const NOW_MS = Date.parse("2026-09-03T12:00:00.000Z");
const NOW_UNIX = Math.floor(NOW_MS / 1000);

describe("computeTrialParam", () => {
  it("carries over the remaining time when the caller is mid local-trial", () => {
    // 10 days still left on the local trial.
    const periodEnd = new Date(NOW_MS + 10 * 24 * 60 * 60 * 1000).toISOString();
    const result = computeTrialParam("trialing", periodEnd, NOW_MS);
    expect(result).toEqual({
      kind: "trial_end",
      value: Math.floor(Date.parse(periodEnd) / 1000),
    });
  });

  it("charges immediately once the local trial has already lapsed", () => {
    const periodEnd = new Date(NOW_MS - 60 * 60 * 1000).toISOString(); // 1h ago
    expect(computeTrialParam("trialing", periodEnd, NOW_MS)).toEqual({ kind: "none" });
  });

  it("charges immediately when status isn't 'trialing'", () => {
    const periodEnd = new Date(NOW_MS + 10 * 24 * 60 * 60 * 1000).toISOString();
    for (const status of ["active", "past_due", "canceled", null, undefined, ""]) {
      expect(computeTrialParam(status as any, periodEnd, NOW_MS)).toEqual({ kind: "none" });
    }
  });

  it("charges immediately when there's no period end at all", () => {
    expect(computeTrialParam("trialing", null, NOW_MS)).toEqual({ kind: "none" });
    expect(computeTrialParam("trialing", undefined, NOW_MS)).toEqual({ kind: "none" });
    expect(computeTrialParam("trialing", "", NOW_MS)).toEqual({ kind: "none" });
  });

  it("charges immediately when the period end can't be parsed as a date", () => {
    expect(computeTrialParam("trialing", "not-a-date", NOW_MS)).toEqual({ kind: "none" });
  });

  it("charges immediately when the remaining time is inside the safety buffer", () => {
    // 30 seconds left — strictly in the future, but under the 60s buffer.
    const periodEnd = new Date(NOW_MS + 30 * 1000).toISOString();
    expect(computeTrialParam("trialing", periodEnd, NOW_MS)).toEqual({ kind: "none" });
  });

  it("sends trial_end right at the edge of the safety buffer, but not exactly on it", () => {
    // Exactly 60s out lands on the boundary (`<=` excludes it) — still none.
    const atBoundary = new Date((NOW_UNIX + 60) * 1000).toISOString();
    expect(computeTrialParam("trialing", atBoundary, NOW_MS)).toEqual({ kind: "none" });

    // One second past the boundary should go through.
    const pastBoundary = new Date((NOW_UNIX + 61) * 1000).toISOString();
    expect(computeTrialParam("trialing", pastBoundary, NOW_MS)).toEqual({
      kind: "trial_end",
      value: NOW_UNIX + 61,
    });
  });

  it("floors sub-second precision down to whole Unix seconds", () => {
    const periodEnd = new Date(NOW_MS + 10 * 24 * 60 * 60 * 1000 + 750).toISOString();
    const result = computeTrialParam("trialing", periodEnd, NOW_MS);
    expect(result.kind).toBe("trial_end");
    if (result.kind === "trial_end") {
      expect(Number.isInteger(result.value)).toBe(true);
    }
  });
});
