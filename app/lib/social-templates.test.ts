import { describe, it, expect } from "vitest";
import {
  SOCIAL_TEMPLATES,
  SOCIAL_CATEGORY_LABELS,
  templatesByCategory,
  socialTemplateFilename,
  type SocialTemplateCategory,
} from "./social-templates";

describe("social templates config", () => {
  it("ships at least one template per category", () => {
    const cats = Object.keys(SOCIAL_CATEGORY_LABELS) as SocialTemplateCategory[];
    for (const cat of cats) {
      const count = SOCIAL_TEMPLATES.filter((t) => t.category === cat).length;
      expect(count, `category ${cat}`).toBeGreaterThan(0);
    }
  });

  it("has unique template ids", () => {
    const ids = SOCIAL_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every template has the copy a graphic needs", () => {
    for (const t of SOCIAL_TEMPLATES) {
      expect(t.headline.trim()).not.toBe("");
      expect(t.subhead.trim()).not.toBe("");
      expect(t.cta.trim()).not.toBe("");
      expect(t.eyebrow.trim()).not.toBe("");
      expect(t.emoji.trim()).not.toBe("");
      expect(SOCIAL_CATEGORY_LABELS[t.category]).toBeTruthy();
    }
  });

  it("groups all templates by category without dropping any", () => {
    const grouped = templatesByCategory();
    const total = grouped.reduce((n, g) => n + g.templates.length, 0);
    expect(total).toBe(SOCIAL_TEMPLATES.length);
  });
});

describe("socialTemplateFilename", () => {
  it("slugifies the business name and ends in .png", () => {
    expect(socialTemplateFilename({ id: "now-booking" }, "Curls by Sheree")).toBe(
      "curls-by-sheree-now-booking.png",
    );
  });

  it("falls back to the template id when no business name", () => {
    expect(socialTemplateFilename({ id: "gift-cards-here" }, "")).toBe(
      "gift-cards-here.png",
    );
    expect(socialTemplateFilename({ id: "gift-cards-here" }, null)).toBe(
      "gift-cards-here.png",
    );
  });

  it("strips punctuation and collapses separators", () => {
    expect(socialTemplateFilename({ id: "summer-ready" }, "Z & Co.!!")).toBe(
      "z-co-summer-ready.png",
    );
  });
});
