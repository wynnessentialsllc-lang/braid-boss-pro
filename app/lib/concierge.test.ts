import { describe, it, expect } from "vitest";
import {
  sanitizeHistory,
  buildSystemPrompt,
  parseConciergeReply,
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
