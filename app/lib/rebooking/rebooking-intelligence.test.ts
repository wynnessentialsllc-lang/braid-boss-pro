import { describe, it, expect } from "vitest";
import {
  computeRebookingOpportunities,
  computeClientRebookingInsight,
  isRebookingMuted,
  rebookingSnoozeUntil,
} from "./rebooking-intelligence";

// A client due for rebooking: one completed appointment 100 days ago,
// no future booking — comfortably overdue for any style window.
const client = (
  over: Partial<{ id: string; name: string; rebookingOptOut: boolean; rebookingSnoozedUntil: string | null }> = {},
) => ({ id: "c1", name: "Asha", ...over });
const appts = [
  { id: "a1", clientId: "c1", date: "2026-03-01", status: "completed", style: "Knotless braids", totalPrice: 180 },
];
const TODAY = "2026-06-14";

describe("isRebookingMuted", () => {
  it("is false for a normal client", () => {
    expect(isRebookingMuted(client(), TODAY)).toBe(false);
  });
  it("is true when opted out", () => {
    expect(isRebookingMuted(client({ rebookingOptOut: true }), TODAY)).toBe(true);
  });
  it("is true while a snooze is still in the future", () => {
    expect(isRebookingMuted(client({ rebookingSnoozedUntil: "2026-09-01" }), TODAY)).toBe(true);
  });
  it("is false once the snooze date has passed", () => {
    expect(isRebookingMuted(client({ rebookingSnoozedUntil: "2026-06-01" }), TODAY)).toBe(false);
  });
  it("is false for empty/blank snooze", () => {
    expect(isRebookingMuted(client({ rebookingSnoozedUntil: "" }), TODAY)).toBe(false);
    expect(isRebookingMuted(client({ rebookingSnoozedUntil: null }), TODAY)).toBe(false);
  });
});

describe("rebookingSnoozeUntil", () => {
  it("returns the date N weeks out", () => {
    expect(rebookingSnoozeUntil("2026-06-14", 4)).toBe("2026-07-12");
  });
});

describe("computeRebookingOpportunities service-configured window", () => {
  const apptWithService = [
    { id: "a1", clientId: "c1", date: "2026-03-01", status: "completed", style: "Knotless braids", totalPrice: 180, serviceId: "svc1" },
  ];

  it("falls back to the style-name table when no services are passed", () => {
    const ops = computeRebookingOpportunities([client()], apptWithService, TODAY);
    // Knotless braids -> 6 weeks -> 2026-03-01 + 42 days
    expect(ops[0].recommended_rebook_date).toBe("2026-04-12");
  });

  it("prefers the service's configured rebook_after_weeks over the style table", () => {
    const ops = computeRebookingOpportunities(
      [client()], apptWithService, TODAY,
      [{ id: "svc1", rebook_after_weeks: 10 }],
    );
    // Configured 10 weeks wins over knotless's hardcoded 6 -> +70 days
    expect(ops[0].recommended_rebook_date).toBe("2026-05-10");
  });

  it("falls back to the style table when the matched service has no configured window", () => {
    const ops = computeRebookingOpportunities(
      [client()], apptWithService, TODAY,
      [{ id: "svc1", rebook_after_weeks: null }],
    );
    expect(ops[0].recommended_rebook_date).toBe("2026-04-12");
  });

  it("ignores a services list that doesn't include the appointment's service", () => {
    const ops = computeRebookingOpportunities(
      [client()], apptWithService, TODAY,
      [{ id: "some-other-service", rebook_after_weeks: 12 }],
    );
    expect(ops[0].recommended_rebook_date).toBe("2026-04-12");
  });

  it("computeClientRebookingInsight applies the same precedence", () => {
    const withoutConfig = computeClientRebookingInsight("c1", apptWithService, TODAY);
    expect(withoutConfig?.recommended_rebook_date).toBe("2026-04-12");

    const withConfig = computeClientRebookingInsight(
      "c1", apptWithService, TODAY, [{ id: "svc1", rebook_after_weeks: 10 }],
    );
    expect(withConfig?.recommended_rebook_date).toBe("2026-05-10");
  });
});

describe("computeRebookingOpportunities mute filtering", () => {
  it("surfaces a due client by default", () => {
    const ops = computeRebookingOpportunities([client()], appts, TODAY);
    expect(ops.map((o) => o.client_id)).toContain("c1");
  });
  it("hides an opted-out client", () => {
    const ops = computeRebookingOpportunities([client({ rebookingOptOut: true })], appts, TODAY);
    expect(ops).toHaveLength(0);
  });
  it("hides a client snoozed into the future", () => {
    const ops = computeRebookingOpportunities([client({ rebookingSnoozedUntil: "2026-12-01" })], appts, TODAY);
    expect(ops).toHaveLength(0);
  });
  it("re-surfaces a client once their snooze has elapsed", () => {
    const ops = computeRebookingOpportunities([client({ rebookingSnoozedUntil: "2026-06-01" })], appts, TODAY);
    expect(ops.map((o) => o.client_id)).toContain("c1");
  });
});
