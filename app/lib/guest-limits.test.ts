import { describe, it, expect } from "vitest";
import { isTrialExpired } from "./guest-limits";

describe("isTrialExpired", () => {
  it("is not expired when the trial period end is in the future", () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    expect(isTrialExpired("trialing", future)).toBe(false);
  });

  it("is expired when status is 'trialing' and the period end is in the past", () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(isTrialExpired("trialing", past)).toBe(true);
  });

  it("is never expired when there is no period end yet", () => {
    expect(isTrialExpired("trialing", null)).toBe(false);
    expect(isTrialExpired("trialing", undefined)).toBe(false);
    expect(isTrialExpired("trialing", "")).toBe(false);
  });

  it("is never expired via this helper for a non-'trialing' status, even with a past period end", () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(isTrialExpired("active", past)).toBe(false);
    expect(isTrialExpired("past_due", past)).toBe(false);
    expect(isTrialExpired(null, past)).toBe(false);
    expect(isTrialExpired(undefined, past)).toBe(false);
  });

  it("treats an unparseable period end as not expired (safe default)", () => {
    expect(isTrialExpired("trialing", "not-a-date")).toBe(false);
  });
});
