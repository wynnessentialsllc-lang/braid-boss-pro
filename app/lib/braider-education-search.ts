// Braider Education Hub — search + highlight helpers.
//
// Pure, dependency-free scoring over the static lesson content in
// `braider-education-content.ts`. No network, no AI, no business-logic
// coupling — the hub screen calls `searchEducation(query)` and renders
// what comes back.
//
// Why hand-rolled instead of a search library: the corpus is ~90 short
// lessons, so an in-memory scan is instant, and braiders search with
// their own words ("no show", "insta", "cash out") rather than the
// wording in the copy. The synonym table below is what makes those
// searches land, and it's the one thing worth growing over time.
//
// Adding a lesson still costs nothing here — the index is derived from
// EDUCATION_CATEGORIES on first use.

import {
  EDUCATION_CATEGORIES,
  type EducationLesson,
} from "./braider-education-content";

// One word the query matches on. `prefix` is true only for a word we
// don't recognize — i.e. one the braider may still be typing.
export type EducationMatcher = { word: string; prefix: boolean };

export type EducationSearchHit = {
  lesson: EducationLesson;
  categoryId: string;
  categoryName: string;
  score: number;
  // Body excerpt around the first match, falling back to the lesson's
  // opening line when the match was in the title only.
  snippet: string | null;
};

export type EducationSearchResult = {
  hits: EducationSearchHit[];
  // Normalized, deduped words parsed out of the raw query.
  terms: string[];
  // Every word the query expanded to (terms + synonyms), with the
  // rule used to match each — what the UI highlights.
  matchers: EducationMatcher[];
  // True when no lesson matched *every* term, so `hits` are the
  // closest partial matches rather than exact ones. The UI says so.
  loose: boolean;
};

// Shortest query we'll act on. One character matches half the hub and
// just makes the screen flash.
export const EDUCATION_MIN_QUERY = 2;

// Suggested searches shown as tappable chips before the braider types.
// Picked for the questions that actually come up, not for coverage.
export const EDUCATION_QUICK_SEARCHES: string[] = [
  "deposits",
  "no-shows",
  "raise prices",
  "cancellations",
  "get paid",
  "taxes",
  "instagram",
  "reminders",
  "shipping",
  "slow season",
];

/**
 * Lowercase, strip accents and punctuation, collapse whitespace.
 * Apostrophes are dropped rather than split so "client's" → "clients".
 */
export const normalizeEducationText = (raw: string): string =>
  (raw || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const words = (raw: string): string[] => {
  const n = normalizeEducationText(raw);
  return n ? n.split(" ") : [];
};

// Hyphenated compounds are indexed both ways: "no-shows" is searchable
// as "no", "shows" and "noshows", because braiders type it all three
// ways ("no show", "noshow", "no-shows").
const HYPHENATED = /[a-z0-9]+(?:-[a-z0-9]+)+/g;

const tokens = (raw: string): string[] => {
  const list = words(raw);
  const lower = (raw || "").toLowerCase();
  const joins = lower.match(HYPHENATED);
  if (joins) for (const j of joins) list.push(j.replace(/-/g, ""));
  return list;
};

// Words that carry no signal in a hub this small — dropped from the
// query so "how to raise my prices" searches on "raise" + "prices".
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "do", "does",
  "for", "from", "get", "has", "have", "how", "i", "if", "in", "is", "it",
  "its", "me", "my", "of", "on", "or", "should", "so", "that", "the", "their",
  "them", "then", "there", "these", "they", "this", "to", "up", "use", "was",
  "what", "when", "where", "which", "who", "why", "will", "with", "you",
  "your",
]);

// Equivalence groups: searching any word in a group also matches the
// others. Groups are merged, so a word can safely appear in two of them
// (e.g. "payment" bridges money and card-processing language).
const SYNONYM_GROUPS: string[][] = [
  ["price", "pricing", "prices", "priced", "charge", "charging", "rate", "rates", "cost", "costs", "quote", "quotes", "quoting", "menu"],
  ["money", "income", "earnings", "earning", "profit", "revenue", "paid", "pay", "payment", "payments", "cash"],
  ["tax", "taxes", "irs", "1099", "deduction", "deductions", "writeoff", "writeoffs", "bookkeeping"],
  ["deposit", "deposits", "retainer", "retainers"],
  ["noshow", "noshows", "flake", "flakes", "flaky", "flaking", "ghost", "ghosted", "missed"],
  ["cancel", "cancels", "canceled", "cancelled", "canceling", "cancelling", "cancelation", "cancellation", "cancellations"],
  ["reschedule", "reschedules", "rescheduled", "rescheduling"],
  ["late", "lateness", "tardy", "grace"],
  ["client", "clients", "customer", "customers", "guest", "guests"],
  ["kid", "kids", "child", "children", "family", "teen", "teens"],
  ["instagram", "ig", "insta"],
  ["social", "socials", "tiktok", "reels", "facebook", "post", "posts", "posting", "content", "caption", "captions"],
  ["marketing", "market", "promote", "promoting", "promotion", "promotions", "ad", "ads", "advertise", "advertising"],
  ["email", "emails", "campaign", "campaigns", "newsletter", "blast"],
  ["booking", "bookings", "book", "booked", "appointment", "appointments", "appt", "schedule", "scheduled", "scheduling", "calendar"],
  ["availability", "available", "hours", "openings", "timeblock", "timeblocks", "daysoff"],
  ["policy", "policies", "rule", "rules", "boundary", "boundaries", "terms"],
  ["contract", "contracts", "waiver", "waivers", "agreement", "agreements", "esign", "sign", "signature"],
  ["refund", "refunds", "refunded", "chargeback", "chargebacks"],
  ["stripe", "payout", "payouts", "bank", "cashout", "connect"],
  ["card", "cards", "tap", "terminal", "swipe", "checkout", "pos"],
  ["bnpl", "afterpay", "klarna", "affirm", "installment", "installments", "financing"],
  ["shop", "store", "retail", "product", "products", "inventory", "stock", "merch"],
  ["ship", "shipping", "shipment", "shipments", "usps", "ups", "label", "labels", "delivery", "tracking", "pickup", "order", "orders"],
  ["review", "reviews", "testimonial", "testimonials", "rating", "ratings", "google", "reputation"],
  ["discount", "discounts", "promo", "promos", "coupon", "coupons", "sale", "sales"],
  ["loyalty", "points", "reward", "rewards", "referral", "referrals", "refer"],
  ["giftcard", "giftcards", "gift", "voucher", "vouchers"],
  ["reminder", "reminders", "sms", "text", "texts", "texting", "notification", "notifications", "alert", "alerts"],
  ["waitlist", "waiting", "queue", "cancellation"],
  ["class", "classes", "teach", "teaching", "student", "students", "tutorial", "tutorials", "course", "courses", "workshop", "workshops", "video", "videos", "zoom", "virtual"],
  ["mobile", "travel", "traveling", "onsite", "house", "housecall"],
  ["consultation", "consultations", "consult", "intake", "form", "forms", "questionnaire"],
  ["addon", "addons", "extra", "extras", "upsell", "upsells", "service", "services", "style", "styles"],
  ["link", "url", "page", "site", "website", "profile", "slug", "handle"],
  ["expense", "expenses", "spending", "supplies", "receipt", "receipts"],
  ["report", "reports", "analytics", "insights", "numbers", "stats", "metrics", "data"],
  ["message", "messages", "messaging", "inbox", "dm", "dms", "chat", "communication", "followup"],
  ["marketplace", "discover", "discovery", "seo", "found", "listing"],
  ["package", "packages", "credit", "credits", "prepaid", "bundle", "bundles"],
  ["timer", "timing", "duration", "howlong", "speed", "faster"],
  ["rebook", "rebooking", "repeat", "retention", "returning", "vip", "regular", "regulars"],
  ["support", "help", "bug", "problem", "issue", "issues", "broken"],
  ["slow", "slowseason", "offseason", "dry", "empty", "quiet"],
  ["holiday", "holidays", "christmas", "newyear", "winter", "glam"],
  ["summer", "vacation", "vacations", "beach"],
  ["school", "backtoschool", "fall"],
  ["prom", "spring", "graduation", "wedding"],
  ["hair", "extensions", "braid", "braids", "braiding", "knotless", "protective", "curl", "color"],
  ["balance", "balances", "owed", "remaining", "final"],
  ["raise", "raising", "increase", "increasing", "higher", "more"],
  ["premium", "luxury", "highend", "highticket", "upscale"],
  ["prep", "preparation", "instructions", "expectations", "expectation"],
  ["new", "start", "starting", "setup", "set", "beginner", "first"],
];

// term -> every word it should also match (including itself).
const SYNONYMS: Map<string, string[]> = (() => {
  const buckets = new Map<string, Set<string>>();
  for (const group of SYNONYM_GROUPS) {
    for (const word of group) {
      let set = buckets.get(word);
      if (!set) { set = new Set<string>([word]); buckets.set(word, set); }
      for (const other of group) set.add(other);
    }
  }
  const out = new Map<string, string[]>();
  for (const [word, set] of buckets) out.set(word, [...set]);
  return out;
})();

/**
 * Split a raw query into the words we search on: normalized, deduped,
 * stop-words dropped. A query made only of stop-words keeps them, so
 * searching "how to" still does something sensible.
 */
export const parseEducationQuery = (raw: string): string[] => {
  const all = words(raw);
  const kept = all.filter(w => !STOP_WORDS.has(w));
  const use = kept.length ? kept : all;
  const out = [...new Set(use)];

  // "no show" / "cash out" / "gift card" typed as two words: if the
  // pair joins into a word we know, search that instead of the halves,
  // which are individually meaningless.
  for (let i = 0; i < all.length - 1; i++) {
    const joined = all[i] + all[i + 1];
    if (!SYNONYMS.has(joined) || out.includes(joined)) continue;
    out.push(joined);
    for (const half of [all[i], all[i + 1]]) {
      const at = out.indexOf(half);
      if (at >= 0) out.splice(at, 1);
    }
  }
  return out;
};

/**
 * A term's own word first, then its synonyms — order matters because
 * the typed word scores higher than a synonym match.
 *
 * A word we know is treated as complete, so it matches whole words
 * only. An unknown word may be half-typed ("cancell", "shipp"), so it
 * matches as a prefix too. That's what keeps "insta" on Instagram
 * instead of dragging in "instantly".
 */
const variantsFor = (term: string): EducationMatcher[] => {
  const syn = SYNONYMS.get(term);
  if (!syn) return [{ word: term, prefix: true }];
  return [
    { word: term, prefix: false },
    ...syn.filter(s => s !== term).map(word => ({ word, prefix: false })),
  ];
};

const wordHit = (word: string, m: EducationMatcher): "exact" | "prefix" | null => {
  if (word === m.word) return "exact";
  if (m.prefix && m.word.length >= 3 && word.length > m.word.length && word.startsWith(m.word)) return "prefix";
  return null;
};

// Word-runs used when scanning original (un-normalized) copy for
// snippets and highlighting — keeps hyphenated compounds together.
const WORD_RUN = /[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g;

// Does one run of original text match any variant? Tested both split
// ("no", "shows") and joined ("noshows"), same as the index.
const runMatches = (run: string, matchers: EducationMatcher[]): boolean => {
  const parts = words(run);
  if (parts.length > 1) parts.push(parts.join(""));
  return parts.some(p => matchers.some(m => wordHit(p, m)));
};

// Same word from two terms: keep the more permissive rule.
const dedupeMatchers = (list: EducationMatcher[]): EducationMatcher[] => {
  const byWord = new Map<string, EducationMatcher>();
  for (const m of list) {
    const seen = byWord.get(m.word);
    if (!seen) byWord.set(m.word, m);
    else if (m.prefix) seen.prefix = true;
  }
  return [...byWord.values()];
};

type IndexedLesson = {
  lesson: EducationLesson;
  categoryId: string;
  categoryName: string;
  order: number;
  fields: {
    title: string[];
    category: string[];
    tryThisWeek: string[];
    body: string[];
    tool: string[];
  };
  // Normalized whole-string forms, for phrase bonuses.
  titleText: string;
  bodyText: string;
};

// Field weight, and how much a synonym (rather than the typed word)
// is worth in it. Title matches dominate; category matches are weak so
// a broad word like "money" doesn't rank every lesson in one category
// above a lesson that's actually about it.
const FIELDS: { key: keyof IndexedLesson["fields"]; weight: number }[] = [
  { key: "title", weight: 10 },
  { key: "tryThisWeek", weight: 5 },
  { key: "tool", weight: 4 },
  { key: "category", weight: 3.5 },
  { key: "body", weight: 3 },
];

const PREFIX_FACTOR = 0.7;
const SYNONYM_FACTOR = 0.55;

let INDEX: IndexedLesson[] | null = null;

const buildIndex = (): IndexedLesson[] => {
  const out: IndexedLesson[] = [];
  let order = 0;
  for (const cat of EDUCATION_CATEGORIES) {
    for (const lesson of cat.lessons) {
      const bodyText = normalizeEducationText(lesson.body.join(" "));
      out.push({
        lesson,
        categoryId: cat.id,
        categoryName: cat.name,
        order: order++,
        fields: {
          title: tokens(lesson.title),
          category: [...tokens(cat.name), ...tokens(cat.blurb)],
          tryThisWeek: tokens(lesson.tryThisWeek),
          body: tokens(lesson.body.join(" ")),
          tool: tokens(lesson.relatedTool || ""),
        },
        titleText: normalizeEducationText(lesson.title),
        bodyText,
      });
    }
  }
  return out;
};

const getIndex = (): IndexedLesson[] => {
  if (!INDEX) INDEX = buildIndex();
  return INDEX;
};

/** Every lesson, flattened, in authoring order. Used for browsing. */
export const allEducationLessons = (): EducationSearchHit[] =>
  getIndex().map(e => ({
    lesson: e.lesson,
    categoryId: e.categoryId,
    categoryName: e.categoryName,
    score: 0,
    snippet: null,
  }));

// Score one term against one lesson. Returns 0 when the term is absent.
const scoreTerm = (entry: IndexedLesson, term: string): number => {
  const variants = variantsFor(term);
  let total = 0;
  for (const { key, weight } of FIELDS) {
    const list = entry.fields[key];
    if (!list.length) continue;
    let best = 0;
    for (let v = 0; v < variants.length; v++) {
      const synFactor = v === 0 ? 1 : SYNONYM_FACTOR;
      for (const word of list) {
        const hit = wordHit(word, variants[v]);
        if (!hit) continue;
        const value = weight * synFactor * (hit === "exact" ? 1 : PREFIX_FACTOR);
        if (value > best) best = value;
      }
    }
    total += best;
  }
  return total;
};

/**
 * Pick the body paragraph with the most matches and return a short
 * excerpt around the first one, in the original casing. With no match
 * in the body (the query hit the title only), the lesson's opening
 * line is used so every result still previews something.
 */
const snippetFor = (lesson: EducationLesson, matchers: EducationMatcher[]): string | null => {
  let bestPara: string | null = null;
  let bestHits = 0;
  for (const para of lesson.body) {
    let hits = 0;
    for (const run of para.match(WORD_RUN) || []) {
      if (runMatches(run, matchers)) hits++;
    }
    if (hits > bestHits) { bestHits = hits; bestPara = para; }
  }
  if (!bestPara) bestPara = lesson.body[0] || null;
  if (!bestPara) return null;

  // Locate the first matching word in the original text so the excerpt
  // opens on the part the braider searched for.
  let at = 0;
  const re = new RegExp(WORD_RUN.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(bestPara)) !== null) {
    if (runMatches(m[0], matchers)) { at = m.index; break; }
  }

  const WINDOW = 190;
  let start = Math.max(0, at - 70);
  if (start > 0) {
    const space = bestPara.indexOf(" ", start);
    start = space === -1 ? start : space + 1;
  }
  let end = Math.min(bestPara.length, start + WINDOW);
  if (end < bestPara.length) {
    const space = bestPara.lastIndexOf(" ", end);
    if (space > start) end = space;
  }
  const text = bestPara.slice(start, end).trim();
  return `${start > 0 ? "…" : ""}${text}${end < bestPara.length ? "…" : ""}`;
};

/**
 * Rank every lesson against a free-text query.
 *
 * Lessons matching all terms win; if nothing matches all of them the
 * partial matches are returned with `loose: true` so the screen can
 * label them "closest matches" instead of pretending they're exact.
 */
export const searchEducation = (rawQuery: string): EducationSearchResult => {
  // Cap the term count so a pasted paragraph can't turn into a scan
  // of the whole hub per word.
  const terms = parseEducationQuery(rawQuery).slice(0, 8);
  const matchers = dedupeMatchers(terms.flatMap(variantsFor));
  if (!terms.length || normalizeEducationText(rawQuery).length < EDUCATION_MIN_QUERY) {
    return { hits: [], terms, matchers, loose: false };
  }

  const phrase = normalizeEducationText(rawQuery);
  const scored: { entry: IndexedLesson; score: number; matched: number[] }[] = [];
  // Terms that match at least one lesson anywhere. A term that matches
  // nothing ("stop" in "how do i stop cancellations") is dropped rather
  // than allowed to force every result into the loose bucket.
  const findable = new Set<number>();

  for (const entry of getIndex()) {
    let score = 0;
    const matched: number[] = [];
    for (let i = 0; i < terms.length; i++) {
      const s = scoreTerm(entry, terms[i]);
      if (s > 0) { score += s; matched.push(i); findable.add(i); }
    }
    if (!matched.length) continue;
    // Phrase bonuses — an exact run of words beats scattered hits.
    if (terms.length > 1) {
      if (entry.titleText.includes(phrase)) score += 20;
      else if (entry.bodyText.includes(phrase)) score += 8;
    }
    scored.push({ entry, score, matched });
  }

  const complete = scored.filter(s => s.matched.length === findable.size);
  const loose = complete.length === 0 && scored.length > 0;
  const use = loose ? scored : complete;

  // Exact results rank on score; loose ones rank on how much of the
  // query they covered first, so "closest" means closest.
  use.sort((a, b) =>
    (loose ? b.matched.length - a.matched.length : 0) ||
    b.score - a.score ||
    b.matched.length - a.matched.length ||
    a.entry.order - b.entry.order,
  );

  return {
    hits: use.map(({ entry, score }) => ({
      lesson: entry.lesson,
      categoryId: entry.categoryId,
      categoryName: entry.categoryName,
      score,
      snippet: snippetFor(entry.lesson, matchers),
    })),
    terms,
    matchers,
    loose,
  };
};

/**
 * Split text into runs for highlighting. Words that matched the query
 * come back with `hit: true`; everything else is passed through so the
 * caller can render it plain.
 *
 * Deliberately no regex lookbehind — older iOS WebViews throw on it.
 */
export const splitEducationHighlight = (
  text: string,
  matchers: EducationMatcher[],
): { text: string; hit: boolean }[] => {
  if (!text) return [];
  if (!matchers.length) return [{ text, hit: false }];

  const out: { text: string; hit: boolean }[] = [];
  const push = (chunk: string, hit: boolean) => {
    if (!chunk) return;
    const last = out[out.length - 1];
    if (last && last.hit === hit) last.text += chunk;
    else out.push({ text: chunk, hit });
  };

  const re = new RegExp(WORD_RUN.source, "g");
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (!runMatches(m[0], matchers)) continue;
    push(text.slice(cursor, m.index), false);
    push(m[0], true);
    cursor = m.index + m[0].length;
  }
  push(text.slice(cursor), false);
  return out;
};
