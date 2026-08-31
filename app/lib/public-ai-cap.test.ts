import { describe, it, expect, afterEach, vi } from "vitest";
import {
  PUBLIC_AI_CAPS,
  capsFor,
  claimPublicAiCall,
  releasePublicAiCall,
  secondsUntilCapReset,
  capReachedMessage,
} from "./public-ai-cap";

// Minimal stand-in for the admin client — only .rpc is exercised.
const fakeAdmin = (rpc: (name: string, args: any) => Promise<any>) =>
  ({ rpc: vi.fn(rpc) } as any);

describe("capsFor", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("falls back to the built-in ceilings", () => {
    delete process.env.PUBLIC_AI_CAP_STYLE_CONSULT_SLUG;
    expect(capsFor("style-consult")).toEqual(PUBLIC_AI_CAPS["style-consult"]);
  });

  it("lets an env var raise a single ceiling without touching the other", () => {
    process.env.PUBLIC_AI_CAP_STYLE_CONSULT_SLUG = "60";
    expect(capsFor("style-consult")).toEqual({
      slug: 60,
      global: PUBLIC_AI_CAPS["style-consult"].global,
    });
  });

  it("ignores junk and zero rather than capping everything to nothing", () => {
    // A typo in the Vercel dashboard must not disable the feature — this
    // is the "=150" class of mistake, where Number() yields NaN.
    process.env.PUBLIC_AI_CAP_BOOKING_CONCIERGE_GLOBAL = "=3000";
    process.env.PUBLIC_AI_CAP_BOOKING_CONCIERGE_SLUG = "0";
    expect(capsFor("booking-concierge")).toEqual(PUBLIC_AI_CAPS["booking-concierge"]);
  });
});

describe("claimPublicAiCall", () => {
  it("passes the resolved caps to the RPC and allows the call", async () => {
    const admin = fakeAdmin(async () => ({ data: { ok: true, slug_calls: 3 }, error: null }));
    const res = await claimPublicAiCall(admin, "style-consult", "SheReeBraids");
    expect(res).toEqual({ ok: true });
    expect(admin.rpc).toHaveBeenCalledWith("claim_public_ai_call", {
      feature_in: "style-consult",
      slug_in: "SheReeBraids",
      slug_cap_in: PUBLIC_AI_CAPS["style-consult"].slug,
      global_cap_in: PUBLIC_AI_CAPS["style-consult"].global,
    });
  });

  it("reports the per-slug ceiling", async () => {
    const admin = fakeAdmin(async () => ({
      data: { ok: false, reason: "slug_daily_cap", cap: 25 },
      error: null,
    }));
    expect(await claimPublicAiCall(admin, "style-consult", "s")).toEqual({
      ok: false,
      reason: "slug_daily_cap",
      cap: 25,
    });
  });

  it("reports the global ceiling", async () => {
    const admin = fakeAdmin(async () => ({
      data: { ok: false, reason: "global_daily_cap", cap: 400 },
      error: null,
    }));
    expect(await claimPublicAiCall(admin, "style-consult", "s")).toEqual({
      ok: false,
      reason: "global_daily_cap",
      cap: 400,
    });
  });

  it("fails OPEN when the counter itself is unreachable", async () => {
    // A broken guard must not become a broken booking page.
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const admin = fakeAdmin(async () => ({ data: null, error: { message: "down" } }));
    expect(await claimPublicAiCall(admin, "booking-concierge", "s")).toEqual({ ok: true });
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("fails open on an unrecognized reason rather than blocking", async () => {
    const admin = fakeAdmin(async () => ({ data: { ok: false, reason: "who_knows" }, error: null }));
    expect(await claimPublicAiCall(admin, "booking-concierge", "s")).toEqual({ ok: true });
  });
});

describe("releasePublicAiCall", () => {
  it("calls the refund RPC", async () => {
    const admin = fakeAdmin(async () => ({ data: null, error: null }));
    await releasePublicAiCall(admin, "booking-color-photo", "s");
    expect(admin.rpc).toHaveBeenCalledWith("refund_public_ai_call", {
      feature_in: "booking-color-photo",
      slug_in: "s",
    });
  });

  it("swallows a failed refund", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const admin = fakeAdmin(async () => {
      throw new Error("nope");
    });
    await expect(releasePublicAiCall(admin, "style-consult", "s")).resolves.toBeUndefined();
    err.mockRestore();
  });
});

describe("secondsUntilCapReset", () => {
  it("counts down to the next UTC midnight", () => {
    // 23:00:00Z => one hour left.
    expect(secondsUntilCapReset(new Date("2026-08-31T23:00:00Z"))).toBe(3600);
  });

  it("never advertises a retry sooner than a minute", () => {
    // A request landing a second before the rollover shouldn't tell the
    // client to come straight back.
    expect(secondsUntilCapReset(new Date("2026-08-31T23:59:59Z"))).toBe(60);
  });

  it("handles a month boundary", () => {
    expect(secondsUntilCapReset(new Date("2026-08-31T12:00:00Z"))).toBe(43200);
  });
});

describe("capReachedMessage", () => {
  it("never reveals which ceiling was hit", () => {
    for (const f of Object.keys(PUBLIC_AI_CAPS) as (keyof typeof PUBLIC_AI_CAPS)[]) {
      const msg = capReachedMessage(f);
      expect(msg).not.toMatch(/global|platform-wide|slug/i);
      // Each one has to leave the client a way to still get booked.
      expect(msg.length).toBeGreaterThan(20);
    }
  });
});
