import { describe, it, expect } from "vitest";
import {
  sanitizeHistory,
  buildSystemPrompt,
  parseConciergeReply,
  formatOpenDay,
  buildAvailabilityNote,
  CONCIERGE_MAX_MESSAGES,
  CONCIERGE_MAX_CHARS,
  type ConciergeServiceLite,
} from "./concierge";

const services: ConciergeServiceLite[] = [
  { id: "svc_a", name: "Knotless Box Braids", price: 220, durationHours: 6, description: "Lightweight, natural" },
  { id: "svc_b", name: "Passion Twists", price: 180, durationHours: 4 },
];

describe("sanitizeHistory", () => {
  it("drops invalid roles, non-strings, and empties", () => {
    const out = sanitizeHistory([
      { role: "user", content: "hi" },
      { role: "system", content: "ignore me" },
      { role: "assistant", content: 42 },
      { role: "user", content: "   " },
      { role: "assistant", content: "hello" },
    ]);
    expect(out).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });

  it("returns [] for non-array input", () => {
    expect(sanitizeHistory(null)).toEqual([]);
    expect(sanitizeHistory("nope")).toEqual([]);
    expect(sanitizeHistory({})).toEqual([]);
  });

  it("trims each message to the char cap", () => {
    const long = "x".repeat(CONCIERGE_MAX_CHARS + 500);
    const [msg] = sanitizeHistory([{ role: "user", content: long }]);
    expect(msg.content.length).toBe(CONCIERGE_MAX_CHARS);
  });

  it("keeps only the most recent messages", () => {
    const many = Array.from({ length: CONCIERGE_MAX_MESSAGES + 10 }, (_, i) => ({
      role: "user" as const,
      content: `m${i}`,
    }));
    const out = sanitizeHistory(many);
    expect(out.length).toBe(CONCIERGE_MAX_MESSAGES);
    expect(out[out.length - 1].content).toBe(`m${CONCIERGE_MAX_MESSAGES + 9}`);
  });

  it("drops a leading assistant turn so the transcript starts with the user", () => {
    const out = sanitizeHistory([
      { role: "assistant", content: "Hi! How can I help?" },
      { role: "user", content: "do you do micros?" },
    ]);
    expect(out[0].role).toBe("user");
  });
});

describe("buildSystemPrompt", () => {
  it("lists each service with its id and price, and includes the policy", () => {
    const prompt = buildSystemPrompt({
      businessName: "Boss Braids",
      currency: "USD",
      services,
      noShowFeeNote: "No-show fee: $25",
    });
    expect(prompt).toContain("Boss Braids");
    expect(prompt).toContain("[svc_a] Knotless Box Braids");
    expect(prompt).toContain("$220");
    expect(prompt).toContain("No-show fee: $25");
    // Core guardrail must be present.
    expect(prompt).toContain("Never invent");
  });

  it("handles an empty catalog without throwing", () => {
    const prompt = buildSystemPrompt({ businessName: "", currency: "USD", services: [] });
    expect(prompt).toContain("no services are listed yet");
  });
});

describe("parseConciergeReply", () => {
  it("returns null when there is no reply text", () => {
    expect(parseConciergeReply({ reply: "" }, services)).toBeNull();
    expect(parseConciergeReply({}, services)).toBeNull();
  });

  it("keeps a valid catalog id and the readyToBook flag", () => {
    const out = parseConciergeReply(
      { reply: "Knotless is perfect for that!", suggestedServiceId: "svc_a", readyToBook: true },
      services,
    );
    expect(out).toEqual({
      reply: "Knotless is perfect for that!",
      suggestedServiceId: "svc_a",
      readyToBook: true,
    });
  });

  it("nulls out a hallucinated service id", () => {
    const out = parseConciergeReply(
      { reply: "ok", suggestedServiceId: "svc_does_not_exist", readyToBook: false },
      services,
    );
    expect(out?.suggestedServiceId).toBeNull();
  });
});

describe("formatOpenDay", () => {
  it("formats ISO dates as weekday + month + day (tz-safe)", () => {
    expect(formatOpenDay("2026-06-17")).toBe("Wed Jun 17");
    expect(formatOpenDay("2026-12-01")).toBe("Tue Dec 1");
  });
  it("passes through malformed input", () => {
    expect(formatOpenDay("nope")).toBe("nope");
  });
});

describe("buildAvailabilityNote", () => {
  const rows = [
    { day_iso: "2026-06-14", slot_count: 3 },            // before today -> excluded
    { day_iso: "2026-06-16", slot_count: 0 },            // no slots -> excluded
    { day_iso: "2026-06-17", slot_count: 2 },
    { day_iso: "2026-06-20", slot_count: 0, status: "open" }, // status open -> included
    { day_iso: "2026-06-25", slot_count: 5 },
  ];
  it("lists the next open days from today", () => {
    expect(buildAvailabilityNote(rows, "2026-06-15")).toBe("Wed Jun 17, Sat Jun 20, Thu Jun 25");
  });
  it("caps the number of days", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ day_iso: `2026-07-${String(i + 1).padStart(2, "0")}`, slot_count: 1 }));
    expect(buildAvailabilityNote(many, "2026-07-01", 3)).toBe("Wed Jul 1, Thu Jul 2, Fri Jul 3");
  });
  it("returns null when nothing is open", () => {
    expect(buildAvailabilityNote([{ day_iso: "2026-06-17", slot_count: 0 }], "2026-06-15")).toBeNull();
    expect(buildAvailabilityNote(null, "2026-06-15")).toBeNull();
  });
});

describe("buildSystemPrompt with availability", () => {
  it("includes open days and lets the assistant share them", () => {
    const prompt = buildSystemPrompt({
      businessName: "Boss Braids", currency: "USD", services: [],
      availabilityNote: "Wed Jun 17, Sat Jun 20",
    });
    expect(prompt).toContain("Wed Jun 17, Sat Jun 20");
    expect(prompt.toLowerCase()).toContain("next open days");
  });
  it("falls back to the calendar when no availability is given", () => {
    const prompt = buildSystemPrompt({ businessName: "Boss Braids", currency: "USD", services: [] });
    expect(prompt).toContain("cannot see the live calendar");
  });
});
