import { describe, it, expect } from "vitest";
import {
  EDUCATION_MIN_QUERY,
  EDUCATION_QUICK_SEARCHES,
  allEducationLessons,
  educationTopicKeys,
  normalizeEducationText,
  parseEducationQuery,
  searchEducation,
  splitEducationHighlight,
} from "./braider-education-search";
import { EDUCATION_CATEGORIES, EDUCATION_TOTAL_LESSONS } from "./braider-education-content";

const titles = (q: string) => searchEducation(q).hits.map(h => h.lesson.title);
const top = (q: string) => searchEducation(q).hits[0]?.lesson.title ?? "";

describe("normalizeEducationText", () => {
  it("lowercases, drops punctuation, and keeps apostrophe words whole", () => {
    expect(normalizeEducationText("Client's No-Show Policy!")).toBe("clients no show policy");
  });

  it("is safe on empty input", () => {
    expect(normalizeEducationText("")).toBe("");
  });
});

describe("parseEducationQuery", () => {
  it("drops filler words", () => {
    expect(parseEducationQuery("how do i raise my prices")).toEqual(["raise", "prices"]);
  });

  it("keeps filler words when that's all there is", () => {
    expect(parseEducationQuery("how to")).toEqual(["how", "to"]);
  });

  it("joins two-word phrases that are really one term", () => {
    expect(parseEducationQuery("no show")).toEqual(["noshow"]);
    expect(parseEducationQuery("cash out")).toEqual(["cashout"]);
    expect(parseEducationQuery("gift card")).toEqual(["giftcard"]);
  });

  it("dedupes repeated words", () => {
    expect(parseEducationQuery("deposit deposit")).toEqual(["deposit"]);
  });
});

describe("searchEducation", () => {
  it("ignores queries below the minimum length", () => {
    expect(searchEducation("d").hits).toHaveLength(0);
    expect(searchEducation("   ").hits).toHaveLength(0);
    expect(EDUCATION_MIN_QUERY).toBe(2);
  });

  it("ranks the lesson whose title is about the query first", () => {
    expect(top("deposits")).toBe("How deposits protect your time");
    expect(top("raise prices")).toBe("How to know when it's time to raise your prices");
    expect(top("tax pack")).toBe("How to generate your tax pack for tax season");
  });

  it("finds no-shows however the braider types it", () => {
    for (const q of ["no-shows", "no show", "noshow", "no shows"]) {
      expect(titles(q)).toContain("How to reduce no-shows");
    }
  });

  it("matches on the braider's words, not just the copy's", () => {
    // Synonyms: none of these words appear in the matched titles.
    expect(titles("insta")).toContain("How to send email campaigns and create social posts");
    expect(titles("cash out")).toContain("How to cash out your Stripe balance instantly");
    expect(titles("write offs")).toContain("Saving for taxes");
    expect(titles("flaky clients")).toContain("How to reduce no-shows");
  });

  it("matches while the word is still being typed", () => {
    expect(titles("cancell")).toContain("Writing a cancellation policy");
    expect(titles("shipp")).toContain("How to buy and print a shipping label for an order");
  });

  it("requires every term when something matches them all", () => {
    const r = searchEducation("cancellation policy");
    expect(r.mode).toBe("exact");
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.hits[0].lesson.title).toBe("Writing a cancellation policy");
  });

  it("ignores a word no lesson uses instead of losing the good ones", () => {
    const r = searchEducation("zzzzq deposits");
    expect(r.mode).toBe("partial");
    expect(r.hits[0].lesson.title).toBe("How deposits protect your time");
  });

  it("answers a full question by dropping the filler around it", () => {
    const r = searchEducation("how do i stop clients from cancelling");
    expect(r.hits.map(h => h.lesson.title)).toContain("Writing a cancellation policy");
  });

  it("falls back to closest matches instead of an empty screen", () => {
    // Both words are in the hub, but no single lesson covers both.
    const r = searchEducation("zoom taxes");
    expect(r.mode).toBe("loose");
    expect(r.hits.length).toBeGreaterThan(0);
  });

  it("returns nothing when nothing is close", () => {
    const r = searchEducation("zzzzq qqqqz");
    expect(r.hits).toHaveLength(0);
    expect(r.mode).toBe("empty");
  });

  it("reports empty for a query too short to run", () => {
    expect(searchEducation("d").mode).toBe("empty");
  });

  it("carries the category and a body snippet for each hit", () => {
    const hit = searchEducation("deposits").hits[0];
    expect(hit.categoryId).toBe("pricing");
    expect(hit.categoryName).toBe("Pricing & Profit");
    expect(hit.snippet).toBeTruthy();
    expect((hit.snippet as string).length).toBeLessThanOrEqual(200);
    expect(hit.snippet).toMatch(/deposit/i);
  });

  it("never returns a lesson twice or one that isn't in the hub", () => {
    const ids = searchEducation("client").hits.map(h => h.lesson.id);
    expect(new Set(ids).size).toBe(ids.length);
    const known = new Set(EDUCATION_CATEGORIES.flatMap(c => c.lessons.map(l => l.id)));
    for (const id of ids) expect(known.has(id)).toBe(true);
  });

  it("returns hits in descending score order", () => {
    const scores = searchEducation("price increase").hits.map(h => h.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("every suggested search returns something", () => {
    for (const q of EDUCATION_QUICK_SEARCHES) {
      const r = searchEducation(q);
      expect(r.hits.length, `"${q}" found nothing`).toBeGreaterThan(0);
      expect(r.mode, `"${q}" did not match cleanly`).toBe("exact");
    }
  });
});

describe("educationTopicKeys", () => {
  it("reports one canonical key however the topic was worded", () => {
    for (const q of ["insta", "ig", "instagram"]) {
      expect(searchEducation(q).topics).toEqual(["instagram"]);
    }
    expect(searchEducation("no show").topics).toEqual(["noshow"]);
    expect(searchEducation("write offs").topics).toEqual(["tax"]);
  });

  it("never reports a word that isn't in the synonym table", () => {
    // The only words that can be logged are table keys, so a query
    // can't be reassembled from what analytics receives.
    const r = searchEducation("zzzzq deposits mrsjohnson");
    expect(r.topics).toEqual(["deposit"]);
    expect(educationTopicKeys(["zzzzq", "mrsjohnson"])).toEqual([]);
  });

  it("dedupes topics that share a group", () => {
    // "pay" and "money" are the same topic; one key comes back.
    expect(educationTopicKeys(["pay", "money"])).toEqual(["money"]);
  });

  it("is empty for a query with no recognized topic", () => {
    expect(searchEducation("zzzzq qqqqz").topics).toEqual([]);
  });
});

describe("allEducationLessons", () => {
  it("flattens every lesson with its category", () => {
    const all = allEducationLessons();
    expect(all).toHaveLength(EDUCATION_TOTAL_LESSONS);
    expect(all.every(h => h.categoryId && h.categoryName)).toBe(true);
  });
});

describe("splitEducationHighlight", () => {
  it("marks matched words and keeps the text intact", () => {
    const parts = splitEducationHighlight("How deposits protect your time", [{ word: "deposits", prefix: false }]);
    expect(parts.map(p => p.text).join("")).toBe("How deposits protect your time");
    expect(parts.filter(p => p.hit).map(p => p.text)).toEqual(["deposits"]);
  });

  it("highlights hyphenated compounds typed as one word", () => {
    const parts = splitEducationHighlight("How to reduce no-shows", [{ word: "noshows", prefix: false }]);
    expect(parts.filter(p => p.hit).map(p => p.text)).toEqual(["no-shows"]);
  });

  it("passes text through untouched when there is no query", () => {
    expect(splitEducationHighlight("Anything", [])).toEqual([{ text: "Anything", hit: false }]);
    expect(splitEducationHighlight("", [{ word: "x", prefix: false }])).toEqual([]);
  });
});
