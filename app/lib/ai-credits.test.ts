import { describe, it, expect } from "vitest";
import { AI_CREDIT_COSTS, outOfCreditsMessage } from "./ai-credits";
import { SMS_COST_PER_SEGMENT_USD, SMS_PACKS } from "./sms-packs";

// Retail value of one credit at the cheapest (worst-case) pack rate.
const worstCaseCreditValue = Math.min(
  ...SMS_PACKS.map(p => p.priceCents / 100 / p.credits),
);

describe("AI_CREDIT_COSTS", () => {
  it("charges at least what a text costs, since AI calls cost more", () => {
    for (const [feature, cost] of Object.entries(AI_CREDIT_COSTS)) {
      expect(cost, feature).toBeGreaterThanOrEqual(2);
    }
  });

  it("prices photo analysis above the Sonnet routes — it runs on Opus", () => {
    expect(AI_CREDIT_COSTS["social-ai-photo"]).toBeGreaterThan(
      AI_CREDIT_COSTS["social-ai"],
    );
  });

  it("covers the underlying model spend with margin at every pack rate", () => {
    // A Sonnet call at these token budgets runs roughly $0.018.
    const sonnetCallUsd = 0.018;
    const revenue = AI_CREDIT_COSTS["social-ai"] * worstCaseCreditValue;
    expect(revenue).toBeGreaterThan(sonnetCallUsd);
  });

  it("is worth more than the segment cost it displaces", () => {
    expect(worstCaseCreditValue).toBeGreaterThan(SMS_COST_PER_SEGMENT_USD);
  });

  it("does not meter the public booking-page routes", () => {
    // style-consult / booking-concierge / booking-color-photo are
    // anonymous and slug-keyed; billing them to the stylist would let a
    // visitor drain her balance and stop her appointment reminders.
    const keys = Object.keys(AI_CREDIT_COSTS);
    expect(keys).not.toContain("style-consult");
    expect(keys).not.toContain("booking-concierge");
    expect(keys).not.toContain("booking-color-photo");
  });
});

describe("outOfCreditsMessage", () => {
  it("says what was needed and what is left", () => {
    expect(outOfCreditsMessage(2, 1)).toContain("2 credits");
    expect(outOfCreditsMessage(2, 1)).toContain("you have 1");
  });

  it("reads correctly for a single credit", () => {
    expect(outOfCreditsMessage(1, 0)).toContain("1 credit and");
  });
});
