import { describe, it, expect } from "vitest";
import {
  DEFAULT_CARE_GUIDE_CONTENT,
  blankCareGuideSettings,
  normalizeCareGuideContent,
  normalizeCareGuideSettings,
  personalizeCareGuideText,
  CARE_GUIDE_DEFAULT_DELAY,
} from "./care-guide";

describe("blankCareGuideSettings", () => {
  it("is off by default with the default delay and content", () => {
    const s = blankCareGuideSettings();
    expect(s.enabled).toBe(false);
    expect(s.delayDays).toBe(CARE_GUIDE_DEFAULT_DELAY);
    expect(s.content.sections.length).toBeGreaterThan(0);
  });
});

describe("normalizeCareGuideSettings", () => {
  it("defaults a null/garbage blob to off + default content", () => {
    const s = normalizeCareGuideSettings(null);
    expect(s.enabled).toBe(false);
    expect(s.delayDays).toBe(CARE_GUIDE_DEFAULT_DELAY);
    expect(s.content.intro).toBe(DEFAULT_CARE_GUIDE_CONTENT.intro);
  });

  it("clamps the delay into range", () => {
    expect(normalizeCareGuideSettings({ delayDays: 999 }).delayDays).toBe(30);
    expect(normalizeCareGuideSettings({ delayDays: 0 }).delayDays).toBe(1);
    expect(normalizeCareGuideSettings({ delayDays: 7 }).delayDays).toBe(7);
  });

  it("only enables on an explicit true", () => {
    expect(normalizeCareGuideSettings({ enabled: "yes" }).enabled).toBe(false);
    expect(normalizeCareGuideSettings({ enabled: true }).enabled).toBe(true);
  });
});

describe("normalizeCareGuideContent", () => {
  it("keeps a braider's custom sections and drops empty items", () => {
    const c = normalizeCareGuideContent({
      intro: "Custom intro",
      sections: [
        { id: "a", title: "My section", items: ["  keep me  ", "", "   "] },
        { title: "", items: ["no title -> dropped"] },
        { title: "no items", items: [] },
      ],
      myths: [{ myth: "m", truth: "t" }, { myth: "", truth: "x" }],
      reachOut: ["watch this", ""],
    });
    expect(c.intro).toBe("Custom intro");
    expect(c.sections).toHaveLength(1);
    expect(c.sections[0].items).toEqual(["keep me"]);
    expect(c.myths).toEqual([{ myth: "m", truth: "t" }]);
    expect(c.reachOut).toEqual(["watch this"]);
  });

  it("falls back to default sections when all were removed", () => {
    const c = normalizeCareGuideContent({ sections: [] });
    expect(c.sections).toEqual(DEFAULT_CARE_GUIDE_CONTENT.sections);
  });

  it("allows an empty myths list (section simply hides)", () => {
    expect(normalizeCareGuideContent({ myths: [] }).myths).toEqual([]);
  });
});

describe("personalizeCareGuideText", () => {
  it("substitutes client/style/studio tokens", () => {
    expect(
      personalizeCareGuideText("Hi {client}, your {style} from {studio}!", {
        client: "Danielle", style: "Boho Knotless", studio: "SBW Braiding",
      }),
    ).toBe("Hi Danielle, your Boho Knotless from SBW Braiding!");
  });

  it("uses friendly fallbacks for missing values", () => {
    expect(personalizeCareGuideText("Hi {client} — {style}", {})).toBe("Hi there — your braids");
  });
});
