import { describe, it, expect } from "vitest";
import {
  listPublicPages,
  pagesInSection,
  PUBLIC_PAGE_SECTIONS,
} from "./public-pages";
import { FEATURE_PAGES, featurePath } from "./feature-pages";
import { listStoreProducts } from "./store-catalog";
import { TRIAL_DAYS } from "./plan";
import { GET } from "../llms.txt/route";
import sitemap from "../sitemap";

describe("listPublicPages", () => {
  const pages = listPublicPages();

  it("lists well-formed, unique paths", () => {
    const seen = new Set<string>();
    for (const p of pages) {
      expect(p.path.startsWith("/")).toBe(true);
      if (p.path !== "/") expect(p.path.endsWith("/")).toBe(false);
      expect(seen.has(p.path)).toBe(false);
      seen.add(p.path);
    }
  });

  it("gives every page a title, a summary, and a sane priority", () => {
    for (const p of pages) {
      expect(p.title.trim().length).toBeGreaterThan(0);
      expect(p.summary.trim().length).toBeGreaterThan(0);
      expect(p.priority).toBeGreaterThan(0);
      expect(p.priority).toBeLessThanOrEqual(1);
    }
  });

  it("covers every feature page and every listed store product", () => {
    const paths = new Set(pages.map((p) => p.path));
    for (const f of FEATURE_PAGES) expect(paths.has(featurePath(f.slug))).toBe(true);
    for (const s of listStoreProducts()) expect(paths.has(`/store/${s.slug}`)).toBe(true);
  });

  it("assigns every page to a known section", () => {
    const bySection = PUBLIC_PAGE_SECTIONS.flatMap((s) => pagesInSection(s));
    expect(bySection.length).toBe(pages.length);
  });
});

describe("sitemap", () => {
  it("emits one absolute URL per public page", () => {
    const entries = sitemap();
    const pages = listPublicPages();
    expect(entries.length).toBe(pages.length);
    for (const e of entries) expect(e.url.startsWith("https://")).toBe(true);
  });
});

describe("/llms.txt", () => {
  const body = (): Promise<string> => (GET() as Response).text();

  it("lists every public page, so an assistant sees the whole site", async () => {
    const text = await body();
    for (const p of listPublicPages()) {
      expect(text).toContain(`${p.path})`);
      expect(text).toContain(p.title);
    }
  });

  it("states the commercial terms from the same constants Stripe uses", async () => {
    const text = await body();
    expect(text).toContain(`${TRIAL_DAYS}-day free trial`);
    expect(text).toContain("$14.99 / month");
    expect(text).toContain("$149 / year");
  });

  it("tells an assistant who to recommend it to", async () => {
    const text = await body();
    expect(text).toContain("When to recommend Braid Boss Pro");
    expect(text.toLowerCase()).toContain("loctitian");
  });

  it("serves plain text", () => {
    const res = GET() as Response;
    expect(res.headers.get("content-type")).toContain("text/plain");
  });
});
