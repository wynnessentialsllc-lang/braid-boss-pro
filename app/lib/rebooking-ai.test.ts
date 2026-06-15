import { describe, it, expect } from "vitest";
import {
  firstNameOf,
  toneForBrief,
  buildNudgeSystem,
  buildWinbackSystem,
  rebookTool,
  parseNudge,
  parseWinback,
  cleanBrief,
  cleanWinbackBrief,
  REBOOK_TOOL_NAME,
  SMS_MAX,
  type StudioContext,
  type RebookBrief,
} from "./rebooking-ai";

const ctx: StudioContext = { businessName: "Boss Braids", city: "Atlanta" };
const brief: RebookBrief = { firstName: "Amara", lastStyle: "Knotless Box Braids", daysOverdue: 12, isVip: false };

describe("firstNameOf", () => {
  it("takes and title-cases the first token; falls back to 'there'", () => {
    expect(firstNameOf("amara jones")).toBe("Amara");
    expect(firstNameOf("Keisha")).toBe("Keisha");
    expect(firstNameOf("")).toBe("there");
    expect(firstNameOf(null)).toBe("there");
  });
});

describe("toneForBrief", () => {
  it("honors an explicit override", () => {
    expect(toneForBrief(brief, "playful")).toBe("playful");
  });
  it("defaults VIPs to the vip tone and others to warm", () => {
    expect(toneForBrief({ ...brief, isVip: true })).toBe("vip");
    expect(toneForBrief(brief)).toBe("warm");
  });
  it("ignores an invalid override", () => {
    expect(toneForBrief(brief, "bogus" as any)).toBe("warm");
  });
});

describe("buildNudgeSystem", () => {
  it("includes business, client, style, and overdue context", () => {
    const p = buildNudgeSystem(ctx, brief, "sms", "warm", "");
    expect(p).toContain("Boss Braids");
    expect(p).toContain("Amara");
    expect(p).toContain("Knotless Box Braids");
    expect(p).toContain("12 days");
  });

  it("forbids inventing offers when none is supplied", () => {
    const p = buildNudgeSystem(ctx, brief, "sms", "warm", "");
    expect(p.toLowerCase()).toContain("do not invent");
  });

  it("passes a supplied offer through verbatim", () => {
    const p = buildNudgeSystem(ctx, brief, "email", "warm", "$20 off in June");
    expect(p).toContain("$20 off in June");
  });

  it("gives channel-appropriate length guidance", () => {
    expect(buildNudgeSystem(ctx, brief, "sms", "warm", "")).toMatch(/text message|under ~50 words/i);
    expect(buildNudgeSystem(ctx, brief, "email", "warm", "")).toMatch(/subject/i);
  });
});

describe("buildWinbackSystem", () => {
  it("describes the lapsed cohort and avoids single-person history", () => {
    const p = buildWinbackSystem(ctx, { lapsedDays: 90, count: 24, topStyles: ["box braids"] }, "warm", "");
    expect(p).toContain("90+ days");
    expect(p).toContain("about 24");
    expect(p).toContain("box braids");
    expect(p.toLowerCase()).toContain("don't reference a single person");
  });
});

describe("rebookTool", () => {
  it("returns the right tool per kind/channel", () => {
    expect(rebookTool("nudge", "sms").name).toBe(REBOOK_TOOL_NAME.nudge_sms);
    expect(rebookTool("nudge", "email").name).toBe(REBOOK_TOOL_NAME.nudge_email);
    expect(rebookTool("winback", "email").name).toBe(REBOOK_TOOL_NAME.winback);
  });
});

describe("parseNudge", () => {
  it("parses + clamps an sms message", () => {
    const long = "x".repeat(SMS_MAX + 50);
    const out = parseNudge({ message: `  ${long}  ` }, "sms");
    expect(out?.channel).toBe("sms");
    expect((out as any).message.length).toBe(SMS_MAX);
  });
  it("requires subject + body for email", () => {
    expect(parseNudge({ subject: "Hi" }, "email")).toBeNull();
    const ok = parseNudge({ subject: "Time for a refresh", body: "Come back in!" }, "email");
    expect(ok).toEqual({ channel: "email", subject: "Time for a refresh", body: "Come back in!" });
  });
  it("returns null for an empty sms", () => {
    expect(parseNudge({ message: "   " }, "sms")).toBeNull();
  });
});

describe("parseWinback", () => {
  it("fills a default name and requires subject + body", () => {
    expect(parseWinback({ subject: "x" })).toBeNull();
    const out = parseWinback({ subject: "We miss you", body: "Come back" });
    expect(out).toEqual({ name: "Win-back campaign", subject: "We miss you", body: "Come back" });
  });
});

describe("cleanBrief", () => {
  it("title-cases the name, coerces numbers, and defaults safely", () => {
    const b = cleanBrief({ firstName: "amara jones", lastStyle: " Passion Twists ", daysOverdue: "12", isVip: 1, visitCount: 4 });
    expect(b.firstName).toBe("Amara");
    expect(b.lastStyle).toBe("Passion Twists");
    expect(b.daysOverdue).toBe(12);
    expect(b.isVip).toBe(false); // only `true` counts as VIP
    expect(b.visitCount).toBe(4);
  });
  it("nulls a blank style and drops non-numeric fields", () => {
    const b = cleanBrief({ firstName: "Kim", lastStyle: "   ", daysOverdue: "abc" });
    expect(b.lastStyle).toBeNull();
    expect(b.daysOverdue).toBeUndefined();
  });
});

describe("cleanWinbackBrief", () => {
  it("clamps lapsedDays/count and trims styles", () => {
    const b = cleanWinbackBrief({ lapsedDays: -5, count: -10, topStyles: ["  box braids ", "", 7, "locs"] });
    expect(b.lapsedDays).toBe(1); // clamped to >= 1
    expect(b.count).toBe(0); // clamped to >= 0
    expect(b.topStyles).toEqual(["box braids", "locs"]);
  });
  it("defaults lapsedDays to 60 when missing", () => {
    expect(cleanWinbackBrief({}).lapsedDays).toBe(60);
  });
});
