// Address detection + map deep links.
//
// Contract bodies are free-form text the stylist writes, so the service
// address lives inside `body_snapshot` rather than in its own column.
// Clients kept having to retype it into their maps app by hand. These
// helpers find address-like spans in that text so the signing page can
// render them as tappable "get directions" links (and offer a copy
// button, since long-pressing a link on mobile doesn't select text).
//
// Pure functions only — no React, no DOM, no network.

export type AddressSegment =
  | { type: "text"; value: string }
  | { type: "address"; value: string };

export type DetectedAddress = { start: number; end: number; value: string };

// A line that names the address outright: "Address: 123 Main St",
// "Service location — 123 Main St", "Where: ...". The optional qualifier
// covers the phrasings braiders actually type.
const LABEL_RE =
  /^[\s>*_-]*(?:the\s+)?(?:service|studio|shop|salon|appointment|session|business|braiding)?\s*(?:address|location|where)\b\s*[:\-–—]\s*(.*)$/i;

// An unlabeled US street address: house number, street name, and a
// street-type suffix, optionally followed by a unit, city, state and ZIP.
// The suffix requirement is what keeps prices, dates and phone numbers
// from matching.
const STREET_SUFFIX =
  "street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|court|ct|circle|cir|way|place|pl|terrace|ter|parkway|pkwy|highway|hwy|trail|trl|square|sq|loop|route|rte|plaza|plz";

const STREET_RE = new RegExp(
  String.raw`\d{1,6}\s+(?:[A-Za-z0-9.'#&-]+\s+){0,4}(?:${STREET_SUFFIX})\b\.?` +
    String.raw`(?:\s*,?\s*(?:#|apt\.?|apartment|suite|ste\.?|unit|bldg\.?|building|floor|fl\.?)\s*[\w-]+)?` +
    String.raw`(?:\s*,\s*[A-Za-z][A-Za-z .'-]{1,30})?` +
    // State: only after a comma, or bare when a ZIP follows. The `i` flag
    // makes [A-Z] any letter, so without this a following word ("Please
    // park…") would get swallowed as a state code.
    String.raw`(?:\s*,\s*[A-Z]{2}\b|\s+[A-Z]{2}\b(?=\s*\d{5}))?` +
    String.raw`(?:\s*,?\s*\d{5}(?:-\d{4})?\b)?`,
  "gi",
);

// Values that mean "no address yet" — never worth linking.
const PLACEHOLDER_RE =
  /^(?:tba|tbd|n\/?a|none|mobile|virtual|online|your\s+(?:home|place|address)|client(?:'s)?\s+(?:home|place|address)|to\s+be\s+(?:determined|announced|shared|provided|confirmed|sent))\b/i;

const normalizeWhitespace = (raw: string): string => raw.replace(/\s+/g, " ").trim();

/**
 * Narrow [start, end) to the address itself: skip leading whitespace and
 * drop trailing punctuation the stylist typed after it. An abbreviation
 * period stays ("123 Main St." keeps its dot); a sentence period goes.
 * Index-based so the span always slices the source back out verbatim.
 */
const trimSpan = (src: string, start: number, end: number): [number, number] => {
  let s = start;
  let e = end;
  while (s < e && /\s/.test(src[s])) s += 1;
  while (e > s) {
    const ch = src[e - 1];
    if (/[\s,;:]/.test(ch)) { e -= 1; continue; }
    // Only strip a period that doesn't belong to an abbreviation.
    if (ch === "." && !/\b[A-Za-z]{2,4}$/.test(src.slice(s, e - 1))) { e -= 1; continue; }
    // A trailing note — "123 Main St (ring the buzzer)" — isn't mappable.
    if (ch === ")") {
      const open = src.slice(s, e).lastIndexOf("(");
      if (open > 0) { e = s + open; continue; }
    }
    break;
  }
  return [s, e];
};

/** True when a candidate string looks like a real, mappable address. */
export const isLikelyAddress = (value: string): boolean => {
  const v = normalizeWhitespace(value);
  if (v.length < 6 || v.length > 200) return false;
  if (PLACEHOLDER_RE.test(v)) return false;
  // Needs a street number or a "City, ST"-shaped fragment to be mappable.
  if (/\d/.test(v)) return true;
  return /,\s*[A-Za-z][A-Za-z .'-]+(?:,\s*[A-Z]{2})?\s*$/.test(v);
};

/**
 * Find address-like spans in free text, in document order and without
 * overlaps. Labeled lines win; a bare street address is picked up too.
 */
export const findAddresses = (text: string): DetectedAddress[] => {
  const src = typeof text === "string" ? text : "";
  if (!src.trim()) return [];

  const found: DetectedAddress[] = [];
  const push = (rawStart: number, rawEnd: number) => {
    const [start, end] = trimSpan(src, rawStart, rawEnd);
    if (end <= start) return;
    const value = src.slice(start, end);
    if (!isLikelyAddress(value)) return;
    if (found.some((f) => start < f.end && end > f.start)) return;
    found.push({ start, end, value });
  };

  // Pass 1 — labeled lines. When the label's own line has no value
  // ("Address:" alone), the address is on the next non-empty line.
  const lines = src.split("\n");
  const lineStarts: number[] = [];
  let cursor = 0;
  for (const line of lines) {
    lineStarts.push(cursor);
    cursor += line.length + 1;
  }
  for (let i = 0; i < lines.length; i += 1) {
    const match = LABEL_RE.exec(lines[i]);
    if (!match) continue;
    const remainder = match[1] || "";
    if (remainder.trim()) {
      const offset = match[0].length - remainder.length;
      // "Address: 123 Main St. Park in the rear." — keep the address, drop
      // the sentence after it. Falls back to the whole line for a named
      // venue ("Address: The Braid Loft, Cincinnati, OH").
      const inner = new RegExp(STREET_RE.source, "i").exec(remainder);
      if (inner) {
        push(
          lineStarts[i] + offset + inner.index,
          lineStarts[i] + offset + inner.index + inner[0].length,
        );
      } else {
        push(lineStarts[i] + offset, lineStarts[i] + lines[i].length);
      }
      continue;
    }
    const next = lines.findIndex((l, j) => j > i && l.trim() !== "");
    if (next === -1 || LABEL_RE.test(lines[next])) continue;
    push(lineStarts[next], lineStarts[next] + lines[next].length);
  }

  // Pass 2 — bare street addresses outside the spans already claimed.
  STREET_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STREET_RE.exec(src)) !== null) {
    push(m.index, m.index + m[0].length);
  }

  found.sort((a, b) => a.start - b.start);
  // Belt and braces: drop anything still overlapping after the sort.
  return found.filter((f, i, all) => i === 0 || f.start >= all[i - 1].end);
};

/**
 * The address to show a client for a studio-based appointment.
 *
 * Precedence, most specific first:
 *   1. A configured studio location that is a real street address —
 *      the stylist set it deliberately, so it wins outright.
 *   2. A street address the stylist wrote into the agreement body.
 *      Studios whose only saved location is "City, ST" still get a
 *      usable address this way, with nothing to re-enter.
 *   3. The configured location as-is (typically "City, ST"). Not enough
 *      to navigate by, but better than leaving the client with nothing.
 *
 * Returns "" when there's nothing worth showing — including when the
 * configured value is a placeholder ("TBD", "mobile"), which should
 * never render as a destination.
 */
export const resolveServiceAddress = (
  configured: string | null | undefined,
  contractBody: string | null | undefined,
): string => {
  const set = normalizeWhitespace(String(configured ?? ""));
  if (set && findAddresses(set).length > 0) return set;
  const fromContract = findAddresses(String(contractBody ?? ""))[0]?.value ?? "";
  if (fromContract) return fromContract;
  return isLikelyAddress(set) ? set : "";
};

/** Collapse a multi-line address into a single map-query string. */
export const normalizeAddressQuery = (address: string): string =>
  String(address || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(", ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();

const isAppleDevice = (userAgent?: string | null): boolean =>
  /iphone|ipad|ipod|macintosh|mac os x/i.test(String(userAgent || ""));

/**
 * A directions URL for the given address. Apple devices get Apple Maps
 * (which opens the native app straight into directions); everything else
 * gets the Google Maps universal link, which opens the Google Maps app
 * when installed and the web map otherwise. Returns "" for empty input
 * so callers can skip rendering the link.
 */
export const mapsDirectionsUrl = (
  address: string,
  userAgent?: string | null,
): string => {
  const q = normalizeAddressQuery(address);
  if (!q) return "";
  const enc = encodeURIComponent(q);
  return isAppleDevice(userAgent)
    ? `https://maps.apple.com/?daddr=${enc}`
    : `https://www.google.com/maps/dir/?api=1&destination=${enc}`;
};

/**
 * Split text into plain and address segments for rendering. Segments
 * concatenate back to the original string, so nothing in the agreement
 * body is dropped or reordered.
 */
export const splitByAddresses = (text: string): AddressSegment[] => {
  const src = typeof text === "string" ? text : "";
  const hits = findAddresses(src);
  if (hits.length === 0) return src ? [{ type: "text", value: src }] : [];
  const out: AddressSegment[] = [];
  let at = 0;
  for (const hit of hits) {
    if (hit.start > at) out.push({ type: "text", value: src.slice(at, hit.start) });
    out.push({ type: "address", value: src.slice(hit.start, hit.end) });
    at = hit.end;
  }
  if (at < src.length) out.push({ type: "text", value: src.slice(at) });
  return out;
};
