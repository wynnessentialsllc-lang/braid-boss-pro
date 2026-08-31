import { describe, it, expect } from "vitest";
import {
  SMS_PACKS,
  findSmsPack,
  SMS_COST_PER_SEGMENT_USD,
  smsLiabilityUsd,
} from "./sms-packs";

describe("SMS_PACKS", () => {
  it("every pack sells above what a segment costs to deliver", () => {
    for (const p of SMS_PACKS) {
      const perCredit = p.priceCents / 100 / p.credits;
      expect(perCredit).toBeGreaterThan(SMS_COST_PER_SEGMENT_USD);
    }
  });

  it("bigger packs never cost more per credit than smaller ones", () => {
    const bySize = [...SMS_PACKS].sort((a, b) => a.credits - b.credits);
    for (let i = 1; i < bySize.length; i++) {
      const prev = bySize[i - 1].priceCents / bySize[i - 1].credits;
      const cur = bySize[i].priceCents / bySize[i].credits;
      expect(cur).toBeLessThanOrEqual(prev);
    }
  });
});

describe("findSmsPack", () => {
  it("resolves known ids and rejects anything else", () => {
    expect(findSmsPack("starter")?.credits).toBe(250);
    expect(findSmsPack("nope")).toBeNull();
    expect(findSmsPack("")).toBeNull();
  });
});

describe("smsLiabilityUsd", () => {
  it("prices unredeemed credits at the per-segment cost", () => {
    expect(smsLiabilityUsd(1000)).toBeCloseTo(12.3, 2);
    expect(smsLiabilityUsd(197)).toBeCloseTo(2.42, 2);
  });

  it("treats an empty or nonsensical balance as no liability", () => {
    expect(smsLiabilityUsd(0)).toBe(0);
    expect(smsLiabilityUsd(-5)).toBe(0);
    expect(smsLiabilityUsd(NaN)).toBe(0);
  });
});
