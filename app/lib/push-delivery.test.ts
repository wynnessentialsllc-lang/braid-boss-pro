import { describe, it, expect, vi, beforeEach } from "vitest";

// Configurable result for the SELECT chain, plus spies on the writes.
let selectResult: { data: any[] | null; error: any };
let upsertCalls: any[];
let deleteCalled: boolean;

// Minimal chainable Supabase mock. Each from() returns a fresh builder;
// the first terminal-ish method (select/upsert/delete) tags the builder so
// `await`/`.then()` resolves the right shape.
const makeBuilder = () => {
  let kind: "select" | "upsert" | "delete" = "select";
  const builder: any = {
    select: () => { kind = "select"; return builder; },
    upsert: (row: any) => { upsertCalls.push(row); kind = "upsert"; return builder; },
    delete: () => { deleteCalled = true; kind = "delete"; return builder; },
    eq: () => builder,
    gte: () => builder,
    lt: () => builder,
    then: (onF: any, onR: any) =>
      Promise.resolve(
        kind === "select" ? selectResult : { data: null, error: null },
      ).then(onF, onR),
  };
  return builder;
};

vi.mock("./supabase", () => ({
  getSupabase: () => ({ from: () => makeBuilder() }),
}));

import {
  loadDeliveredHistoryRemote,
  recordDeliveryRemote,
} from "./push-dispatch";

describe("loadDeliveredHistoryRemote", () => {
  beforeEach(() => {
    selectResult = { data: [], error: null };
    upsertCalls = [];
    deleteCalled = false;
  });

  it("returns the local cache (empty in node) without hitting the DB for an empty user", async () => {
    const out = await loadDeliveredHistoryRemote("");
    expect(out).toEqual({});
    expect(deleteCalled).toBe(false);
  });

  it("merges server rows into the history keyed by rule_id", async () => {
    selectResult = {
      data: [
        { rule_id: "appt_48h:a1", delivered_at: "2026-06-10T00:00:00.000Z" },
        { rule_id: "today_clients:2026-06-13", delivered_at: "2026-06-13T12:00:00.000Z" },
      ],
      error: null,
    };
    const out = await loadDeliveredHistoryRemote("user-1");
    expect(out["appt_48h:a1"]).toBe("2026-06-10T00:00:00.000Z");
    expect(out["today_clients:2026-06-13"]).toBe("2026-06-13T12:00:00.000Z");
  });

  it("ignores malformed rows with no rule_id", async () => {
    selectResult = {
      data: [{ delivered_at: "2026-06-10T00:00:00.000Z" } as any],
      error: null,
    };
    const out = await loadDeliveredHistoryRemote("user-1");
    expect(out).toEqual({});
  });

  it("falls back to the local cache on a query error (never a flood of re-fires)", async () => {
    selectResult = { data: null, error: { message: "network" } };
    const out = await loadDeliveredHistoryRemote("user-1");
    expect(out).toEqual({});
  });

  it("prunes stale rows past the retention window", async () => {
    selectResult = { data: [], error: null };
    await loadDeliveredHistoryRemote("user-1");
    expect(deleteCalled).toBe(true);
  });
});

describe("recordDeliveryRemote", () => {
  beforeEach(() => {
    upsertCalls = [];
  });

  it("upserts the delivery keyed by (user_id, rule_id)", async () => {
    await recordDeliveryRemote("user-1", "appt_48h:a1", "2026-06-11T09:00:00.000Z");
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0]).toEqual({
      user_id: "user-1",
      rule_id: "appt_48h:a1",
      delivered_at: "2026-06-11T09:00:00.000Z",
    });
  });

  it("no-ops when user or rule id is missing", async () => {
    await recordDeliveryRemote("", "appt_48h:a1", "2026-06-11T09:00:00.000Z");
    await recordDeliveryRemote("user-1", "", "2026-06-11T09:00:00.000Z");
    expect(upsertCalls).toHaveLength(0);
  });
});
