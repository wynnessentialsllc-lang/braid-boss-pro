import { describe, it, expect } from "vitest";
import {
  cleanHashtags,
  studioSummary,
  buildSystemPrompt,
  socialAiTool,
  parseCaption,
  parseTemplate,
  parsePhoto,
  parsePlan,
  buildAiTemplate,
  SOCIAL_AI_KINDS,
  MAX_HASHTAGS,
  type StudioContext,
} from "./social-ai";
import { SOCIAL_THEME_KEYS } from "./social-templates";

const ctx: StudioContext = {
  businessName: "Boss Braids",
  services: [
    { name: "Knotless Box Braids", price: 220 },
    { name: "Passion Twists", price: 180 },
  ],
  city: "Atlanta",
};

describe("cleanHashtags", () => {
  it("adds #, strips spaces/punctuation, dedupes, and caps the count", () => {
    const out = cleanHashtags([
      "braids",
      "#KnotlessBraids",
      "knotless braids", // collapses into #KnotlessBraids (case-insensitive dedupe)
      "#braids", // dupe of first (case-insensitive)
      "with-dashes!",
      123,
      "",
    ]);
    expect(out).toContain("#braids");
    expect(out).toContain("#KnotlessBraids");
    expect(out).toContain("#withdashes");
    // first "braids" and later "#braids" collapse to one
    expect(out.filter((t) => t.toLowerCase() === "#braids")).toHaveLength(1);
    // "#KnotlessBraids" and "knotless braids" collapse to one (kept the first)
    expect(out.filter((t) => t.toLowerCase() === "#knotlessbraids")).toHaveLength(1);
  });

  it("never exceeds MAX_HASHTAGS", () => {
    const many = Array.from({ length: 40 }, (_, i) => `tag${i}`);
    expect(cleanHashtags(many).length).toBe(MAX_HASHTAGS);
  });

  it("returns [] for non-arrays", () => {
    expect(cleanHashtags("nope")).toEqual([]);
    expect(cleanHashtags(null)).toEqual([]);
  });
});

describe("studioSummary + prompts", () => {
  it("summarizes business, city, and services", () => {
    const s = studioSummary(ctx);
    expect(s).toContain("Boss Braids");
    expect(s).toContain("Atlanta");
    expect(s).toContain("Knotless Box Braids ($220)");
  });

  it("builds a non-empty system prompt for every kind", () => {
    for (const kind of SOCIAL_AI_KINDS) {
      const p = buildSystemPrompt(kind, ctx);
      expect(p.length).toBeGreaterThan(40);
      expect(p).toContain("Boss Braids");
    }
  });

  it("plan prompt mentions slow days when provided", () => {
    const p = buildSystemPrompt("plan", { ...ctx, slowDays: ["Tuesday", "Wednesday"] });
    expect(p).toContain("Tuesday");
  });
});

describe("socialAiTool", () => {
  it("returns a distinct tool name + schema per kind", () => {
    const names = SOCIAL_AI_KINDS.map((k) => socialAiTool(k).name);
    expect(new Set(names).size).toBe(SOCIAL_AI_KINDS.length);
  });
});

describe("parseCaption", () => {
  it("cleans the result", () => {
    const out = parseCaption({ caption: "  Fresh knotless ✨  ", hashtags: ["braids"], bestTime: "Thu 6pm" });
    expect(out).toEqual({ caption: "Fresh knotless ✨", hashtags: ["#braids"], bestTime: "Thu 6pm" });
  });
  it("returns null without a caption", () => {
    expect(parseCaption({ hashtags: ["x"] })).toBeNull();
  });
});

describe("parseTemplate", () => {
  it("fills defaults and clamps category/theme to known values", () => {
    const out = parseTemplate({
      headline: "Friday Flash Sale",
      subhead: "20% off all twists",
      category: "bogus",
      themeKey: "bogus",
    });
    expect(out?.headline).toBe("Friday Flash Sale");
    expect(out?.cta).toBe("Book now"); // default
    expect(out?.emoji).toBe("✨"); // default
    expect(["gift_card", "now_booking", "new_style", "seasonal"]).toContain(out?.category);
    expect(SOCIAL_THEME_KEYS).toContain(out?.themeKey as any);
  });
  it("returns null without a headline", () => {
    expect(parseTemplate({ subhead: "x" })).toBeNull();
  });
});

describe("parsePhoto", () => {
  it("requires both template fields and a caption", () => {
    expect(parsePhoto({ headline: "x" })).toBeNull(); // no caption
    const ok = parsePhoto({ headline: "Boho Knotless", caption: "Loving this", hashtags: ["boho"] });
    expect(ok?.headline).toBe("Boho Knotless");
    expect(ok?.caption).toBe("Loving this");
    expect(ok?.hashtags).toEqual(["#boho"]);
  });
});

describe("parsePlan", () => {
  it("keeps valid posts and caps at 7", () => {
    const raw = Array.from({ length: 10 }, (_, i) => ({ day: `D${i}`, idea: `idea ${i}`, category: "now_booking" }));
    const out = parsePlan({ posts: raw });
    expect(out?.posts.length).toBe(7);
  });
  it("returns null when there are no usable posts", () => {
    expect(parsePlan({ posts: [{ day: "Mon" }] })).toBeNull();
    expect(parsePlan({})).toBeNull();
  });
});

describe("buildAiTemplate", () => {
  it("assembles a renderable SocialTemplate with a resolved theme", () => {
    const fields = parseTemplate({ headline: "Now Booking", subhead: "Reserve today", themeKey: "plum", category: "now_booking" })!;
    const tpl = buildAiTemplate(fields, "ai-fixed");
    expect(tpl.id).toBe("ai-fixed");
    expect(tpl.headline).toBe("Now Booking");
    // theme resolved to an object with the expected palette shape
    expect(typeof tpl.theme.bgFrom).toBe("string");
    expect(typeof tpl.theme.eyebrow).toBe("string");
  });
});
