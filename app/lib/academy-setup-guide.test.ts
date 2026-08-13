import { describe, it, expect } from "vitest";
import {
  ACADEMY_SETUP_GUIDES,
  academyGuideStorageKey,
  type AcademyGuideTopic,
} from "./academy-setup-guide";

const TOPICS: AcademyGuideTopic[] = ["classes", "videos"];

describe("ACADEMY_SETUP_GUIDES", () => {
  it("covers both academy topics", () => {
    expect(Object.keys(ACADEMY_SETUP_GUIDES).sort()).toEqual(TOPICS);
  });

  for (const topic of TOPICS) {
    const guide = ACADEMY_SETUP_GUIDES[topic];

    describe(topic, () => {
      it("reports its own topic", () => {
        expect(guide.topic).toBe(topic);
      });

      it("has a title, subtitle, and CTA", () => {
        expect(guide.title.length).toBeGreaterThan(0);
        expect(guide.subtitle.length).toBeGreaterThan(0);
        expect(guide.cta.length).toBeGreaterThan(0);
      });

      it("has enough slides to be a carousel, but not a novel", () => {
        expect(guide.slides.length).toBeGreaterThanOrEqual(3);
        expect(guide.slides.length).toBeLessThanOrEqual(10);
      });

      // Slide keys are React list keys and the dot buttons' keys.
      it("uses unique slide keys", () => {
        const keys = guide.slides.map(s => s.key);
        expect(new Set(keys).size).toBe(keys.length);
      });

      it("fills in every slide field it declares", () => {
        for (const s of guide.slides) {
          expect(s.eyebrow.trim().length, `${s.key} eyebrow`).toBeGreaterThan(0);
          expect(s.title.trim().length, `${s.key} title`).toBeGreaterThan(0);
          expect(s.body.trim().length, `${s.key} body`).toBeGreaterThan(0);
          for (const tip of s.tips ?? []) {
            expect(tip.trim().length, `${s.key} tip`).toBeGreaterThan(0);
          }
        }
      });

      // Copy is read on a phone inside a card — long slides scroll the
      // guide instead of the screen, which reads as broken.
      it("keeps slide copy short enough for a phone card", () => {
        for (const s of guide.slides) {
          expect(s.title.length, `${s.key} title`).toBeLessThanOrEqual(60);
          expect(s.body.length, `${s.key} body`).toBeLessThanOrEqual(320);
          expect((s.tips ?? []).length, `${s.key} tips`).toBeLessThanOrEqual(3);
        }
      });

      it("opens on payouts — nothing sells until Stripe is connected", () => {
        expect(guide.slides[0].icon).toBe("payouts");
      });
    });
  }
});

describe("academyGuideStorageKey", () => {
  it("is namespaced and versioned per topic", () => {
    expect(academyGuideStorageKey("classes")).toBe("bbp-academy-guide-classes-v1");
    expect(academyGuideStorageKey("videos")).toBe("bbp-academy-guide-videos-v1");
  });

  it("never collides across topics", () => {
    const keys = TOPICS.map(academyGuideStorageKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
