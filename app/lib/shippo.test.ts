import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buyLabel,
  fetchShipmentRates,
  listCarrierAccounts,
  listWebhooks,
  normalizeRate,
  registerTrackingWebhook,
  sortAndCapRates,
  type NormalizedRate,
} from "./shippo";

const make = (over: Partial<NormalizedRate> = {}): NormalizedRate => ({
  id: over.id ?? `r_${Math.random().toString(36).slice(2, 8)}`,
  carrier: over.carrier ?? "USPS",
  service: over.service ?? "Priority Mail",
  amount_cents: over.amount_cents ?? 999,
  currency: over.currency ?? "USD",
  estimated_days: "estimated_days" in over ? over.estimated_days! : 2,
});

describe("normalizeRate", () => {
  it("returns null when object_id is missing", () => {
    expect(normalizeRate({ amount: "5.00", provider: "USPS" })).toBeNull();
  });

  it("returns null when amount is non-numeric", () => {
    expect(normalizeRate({ object_id: "r1", amount: "free" })).toBeNull();
  });

  it("converts decimal dollars to cents", () => {
    const r = normalizeRate({
      object_id: "r1",
      amount: "8.65",
      provider: "USPS",
      servicelevel: { name: "Priority Mail" },
      currency: "usd",
      estimated_days: 3,
    });
    expect(r).toEqual({
      id: "r1",
      carrier: "USPS",
      service: "Priority Mail",
      amount_cents: 865,
      currency: "USD",
      estimated_days: 3,
    });
  });

  it("falls back to servicelevel.token when name is missing", () => {
    const r = normalizeRate({
      object_id: "r1",
      amount: "5.00",
      provider: "UPS",
      servicelevel: { token: "ups_ground" },
    });
    expect(r?.service).toBe("ups_ground");
  });

  it("uses 'Carrier' / 'Standard' as last-resort labels", () => {
    const r = normalizeRate({ object_id: "r1", amount: "1.00" });
    expect(r?.carrier).toBe("Carrier");
    expect(r?.service).toBe("Standard");
  });

  it("treats a missing / negative estimated_days as null", () => {
    expect(normalizeRate({ object_id: "r1", amount: "1.00" })?.estimated_days).toBeNull();
    expect(
      normalizeRate({ object_id: "r1", amount: "1.00", estimated_days: -1 })?.estimated_days,
    ).toBeNull();
  });
});

describe("sortAndCapRates", () => {
  it("orders by price ascending, ties broken by speed", () => {
    const sorted = sortAndCapRates([
      make({ id: "a", amount_cents: 1500, estimated_days: 2 }),
      make({ id: "b", amount_cents: 999, estimated_days: 5 }),
      make({ id: "c", amount_cents: 999, estimated_days: 2 }),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  it("caps the list to 5 entries", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      make({ id: `r${i}`, amount_cents: 100 * (i + 1) }),
    );
    expect(sortAndCapRates(many)).toHaveLength(5);
  });

  it("sorts a null estimated_days last on ties", () => {
    const sorted = sortAndCapRates([
      make({ id: "a", amount_cents: 500, estimated_days: null }),
      make({ id: "b", amount_cents: 500, estimated_days: 3 }),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(["b", "a"]);
  });
});

describe("buyLabel", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the parsed label on SUCCESS", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        object_id: "txn_1",
        status: "SUCCESS",
        tracking_number: "9400111111111111111111",
        tracking_url_provider: "https://tools.usps.com/track?9400…",
        label_url: "https://shippo-delivery.s3.amazonaws.com/lbl.pdf",
        eta: "2026-06-18T00:00:00Z",
      }),
    });
    const label = await buyLabel("tok", "r1");
    expect(label).toEqual({
      transaction_id: "txn_1",
      tracking_number: "9400111111111111111111",
      tracking_url: "https://tools.usps.com/track?9400…",
      label_url: "https://shippo-delivery.s3.amazonaws.com/lbl.pdf",
      eta: "2026-06-18T00:00:00Z",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/transactions/");
    expect((init.headers as any).Authorization).toBe("ShippoToken tok");
    expect(JSON.parse(init.body)).toMatchObject({
      rate: "r1",
      label_file_type: "PDF",
      async: false,
    });
  });

  it("throws the first Shippo message on ERROR status", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "ERROR",
        messages: [{ text: "Rate is no longer valid." }],
      }),
    });
    await expect(buyLabel("tok", "r1")).rejects.toThrow("Rate is no longer valid.");
  });

  it("throws on non-2xx HTTP", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });
    await expect(buyLabel("bad", "r1")).rejects.toThrow(/Shippo 401/);
  });
});

describe("fetchShipmentRates extras", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ rates: [] }) });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const baseOpts = {
    token: "t",
    from: { zip: "94117", country: "US" },
    to: { zip: "20500", country: "US" },
    parcel: { length: 10, width: 8, height: 4, weight_oz: 16 },
  };

  it("omits the extra block when no extras are requested", async () => {
    await fetchShipmentRates(baseOpts);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.extra).toBeUndefined();
  });

  it("includes signature_confirmation=STANDARD when requested", async () => {
    await fetchShipmentRates({
      ...baseOpts,
      extras: { signature_confirmation: "STANDARD" },
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.extra.signature_confirmation).toBe("STANDARD");
  });

  it("includes insurance block with capped amount", async () => {
    await fetchShipmentRates({
      ...baseOpts,
      extras: { insurance_amount: 250.5 },
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.extra.insurance).toEqual({
      amount: "250.50",
      currency: "USD",
      content: "Retail goods",
    });
  });

  it("caps insurance at $5000", async () => {
    await fetchShipmentRates({
      ...baseOpts,
      extras: { insurance_amount: 25_000 },
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.extra.insurance.amount).toBe("5000.00");
  });

  it("skips insurance when amount is 0 or negative", async () => {
    await fetchShipmentRates({ ...baseOpts, extras: { insurance_amount: 0 } });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.extra).toBeUndefined();
  });
});

describe("listCarrierAccounts", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns only active carriers", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          { carrier: "usps", carrier_name: "USPS", active: true, test: false },
          { carrier: "fedex", carrier_name: "FedEx", active: false, test: false },
          { carrier: "ups", carrier_name: "UPS", active: true, test: true },
        ],
      }),
    });
    const out = await listCarrierAccounts("t");
    expect(out).toEqual([
      { name: "USPS", carrier: "usps", test: false },
      { name: "UPS", carrier: "ups", test: true },
    ]);
  });

  it("throws a clean message on 401", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
    await expect(listCarrierAccounts("bad")).rejects.toThrow(/rejected the token/);
  });

  it("throws on 5xx", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(listCarrierAccounts("t")).rejects.toThrow(/Shippo 500/);
  });
});

describe("listWebhooks", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns normalized webhooks", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          { object_id: "w1", url: "https://a/", event: "track_updated", active: true },
          { object_id: "w2", url: "https://b/", event: "transaction_created", active: false },
          { url: "https://c/" }, // missing id — dropped
        ],
      }),
    });
    const out = await listWebhooks("t");
    expect(out).toEqual([
      { id: "w1", url: "https://a/", event: "track_updated", active: true },
      { id: "w2", url: "https://b/", event: "transaction_created", active: false },
    ]);
  });

  it("throws a clean message on 401", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
    await expect(listWebhooks("bad")).rejects.toThrow(/rejected the token/);
  });
});

describe("registerTrackingWebhook", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs a track_updated webhook and returns it normalized", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        object_id: "w_new",
        url: "https://app.example/api/shippo-webhook?secret=abc",
        event: "track_updated",
        active: true,
      }),
    });
    const hook = await registerTrackingWebhook(
      "t",
      "https://app.example/api/shippo-webhook?secret=abc",
    );
    expect(hook).toEqual({
      id: "w_new",
      url: "https://app.example/api/shippo-webhook?secret=abc",
      event: "track_updated",
      active: true,
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.event).toBe("track_updated");
    expect(body.active).toBe(true);
    expect(body.url).toContain("/api/shippo-webhook?secret=");
  });

  it("throws on a Shippo error", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => "url already registered",
    });
    await expect(
      registerTrackingWebhook("t", "https://x/api/shippo-webhook?secret=y"),
    ).rejects.toThrow(/Shippo 400/);
  });
});
