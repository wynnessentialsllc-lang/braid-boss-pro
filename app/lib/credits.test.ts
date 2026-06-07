import { describe, it, expect } from "vitest";
import { creditBalance, creditBalancesByClient, type CreditEntry } from "./credits";

const entry = (over: Partial<CreditEntry>): CreditEntry => ({
  id: Math.random().toString(36).slice(2),
  user_id: "u1",
  client_id: "c1",
  amount: 0,
  kind: "grant",
  reason: null,
  appointment_id: null,
  created_at: "2026-06-07T00:00:00.000Z",
  ...over,
});

describe("creditBalance", () => {
  it("nets grants against redemptions", () => {
    const ledger = [
      entry({ amount: 25, kind: "grant" }),
      entry({ amount: 10, kind: "grant" }),
      entry({ amount: -15, kind: "redeem", appointment_id: "appt_1" }),
    ];
    expect(creditBalance(ledger)).toBe(20);
  });

  it("is zero for an empty or missing ledger", () => {
    expect(creditBalance([])).toBe(0);
    expect(creditBalance(null)).toBe(0);
    expect(creditBalance(undefined)).toBe(0);
  });

  it("rounds to cents", () => {
    const ledger = [entry({ amount: 10.005 }), entry({ amount: 0.001 })];
    expect(creditBalance(ledger)).toBe(10.01);
  });
});

describe("creditBalancesByClient", () => {
  it("rolls up per client", () => {
    const ledger = [
      entry({ client_id: "c1", amount: 25 }),
      entry({ client_id: "c1", amount: -5, kind: "redeem" }),
      entry({ client_id: "c2", amount: 40 }),
    ];
    const map = creditBalancesByClient(ledger);
    expect(map.get("c1")).toBe(20);
    expect(map.get("c2")).toBe(40);
    expect(map.has("c3")).toBe(false);
  });
});
