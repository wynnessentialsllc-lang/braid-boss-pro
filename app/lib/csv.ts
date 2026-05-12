// CSV utilities — tiny, no deps. Handles the cases that actually
// matter for spreadsheet round-tripping:
//   * commas, quotes, and newlines inside cells (RFC 4180 quoting)
//   * BOM-prefixed files exported from Excel
//   * Numbers + booleans formatted predictably
//
// NOT a general-purpose CSV parser — no streaming, no escape modes
// other than double-quote. Sufficient for clients / services /
// appointments which are O(thousands) rows max.

export type CsvCell = string | number | boolean | null | undefined;
export type CsvRow = Record<string, CsvCell>;

// =====================================================================
// Build
// =====================================================================

const escapeCell = (v: CsvCell): string => {
  if (v === null || v === undefined) return "";
  let s: string;
  if (typeof v === "number") {
    s = Number.isFinite(v) ? String(v) : "";
  } else if (typeof v === "boolean") {
    s = v ? "true" : "false";
  } else {
    s = String(v);
  }
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

/**
 * Build a CSV string from an array of rows. Columns are inferred
 * from the union of keys across all rows, in first-seen order.
 */
export const buildCsv = (rows: CsvRow[], columns?: string[]): string => {
  const cols: string[] = columns && columns.length
    ? columns
    : (() => {
        const seen = new Set<string>();
        for (const r of rows) {
          for (const k of Object.keys(r)) {
            if (!seen.has(k)) seen.add(k);
          }
        }
        return Array.from(seen);
      })();
  const lines: string[] = [cols.map(escapeCell).join(",")];
  for (const r of rows) {
    lines.push(cols.map((c) => escapeCell(r[c])).join(","));
  }
  return lines.join("\r\n");
};

// =====================================================================
// Parse
// =====================================================================
// Single-pass tokenizer that respects RFC 4180 quoting.

const stripBom = (s: string): string =>
  s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;

const tokenize = (input: string): string[][] => {
  const text = stripBom(input);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  let inQuotes = false;
  const len = text.length;

  while (i < len) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        cell += c;
        i++;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
        i++;
      } else if (c === ",") {
        row.push(cell);
        cell = "";
        i++;
      } else if (c === "\r") {
        // Possible \r\n — swallow the \n too.
        row.push(cell);
        cell = "";
        rows.push(row);
        row = [];
        i++;
        if (text[i] === "\n") i++;
      } else if (c === "\n") {
        row.push(cell);
        cell = "";
        rows.push(row);
        row = [];
        i++;
      } else {
        cell += c;
        i++;
      }
    }
  }
  // Trailing cell / row.
  row.push(cell);
  // Drop a trailing empty row that comes from files ending in newline.
  if (!(row.length === 1 && row[0] === "")) rows.push(row);
  return rows;
};

/**
 * Parse a CSV string to an array of header-keyed objects. The first
 * non-empty row is treated as the header. Returns null on completely
 * empty input.
 */
export const parseCsv = (input: string): {
  headers: string[];
  rows: Record<string, string>[];
} => {
  const tokens = tokenize(input).filter((r) => r.some((c) => c.length > 0));
  if (tokens.length === 0) return { headers: [], rows: [] };
  const headers = tokens[0].map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < tokens.length; i++) {
    const r = tokens[i];
    const obj: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = (r[j] ?? "").trim();
    }
    rows.push(obj);
  }
  return { headers, rows };
};

/**
 * Look up a value by trying multiple header aliases (case-insensitive,
 * space/underscore tolerant). Returns the first non-empty hit.
 */
export const pickField = (
  row: Record<string, string>,
  aliases: string[],
): string => {
  const normRow: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    normRow[k.toLowerCase().replace(/[\s_-]+/g, "")] = v;
  }
  for (const a of aliases) {
    const key = a.toLowerCase().replace(/[\s_-]+/g, "");
    const v = normRow[key];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return "";
};
