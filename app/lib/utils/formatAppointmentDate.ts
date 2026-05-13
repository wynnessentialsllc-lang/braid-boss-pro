// Appointment date/time formatters.
//
// Single source of truth for rendering booking dates and times across:
//   - transactional emails (booking confirmation, approval, deposit
//     received, expiration, contract invite)
//   - dashboard appointment cards, approvals queue, notifications
//   - public-facing booking success / status pages
//
// Design notes:
//
//   1. **Wall-clock semantics for date-only + time-only strings.**
//      booking_requests.preferred_date is a "YYYY-MM-DD" string and
//      preferred_time is "HH:MM"; both represent what the client typed
//      into the form in the stylist's locale. We render them exactly
//      as entered — no timezone shift — to match what the stylist
//      sees in their dashboard.
//
//   2. **Hydration-safe.** All Intl.DateTimeFormat calls explicitly
//      set `timeZone: "UTC"` and we always build the input Date via
//      Date.UTC(y, m, d, h, min). That makes the output deterministic
//      regardless of the host's TZ (server may be UTC, browser may be
//      anything). Hydration mismatches in Next 16 are avoided.
//
//   3. **Full ISO datetimes opt into a zone.** When the input is a
//      full ISO string, JS Date object, or epoch ms, pass the
//      `timeZone` option to render in that zone. Server-side, default
//      to the stylist's saved tz if you have it. Browser-side, omit
//      to use the user's local zone — but only when you don't also
//      render on the server. To avoid mismatches, pick one explicit
//      zone and use it everywhere for a given value.
//
//   4. **Graceful fallback.** Any unparseable input returns
//      `opts.fallback` (default ""). Never throws.

export type DateLike = string | Date | number | null | undefined;

export type FormatOptions = {
  /**
   * IANA timezone (e.g. "America/New_York"). Only consulted when the
   * input is a full ISO datetime / Date / epoch — date-only and
   * time-only strings are always treated as wall-clock and never
   * shifted. Defaults to "UTC" for determinism in SSR.
   */
  timeZone?: string;
  /** BCP-47 locale. Defaults to "en-US". */
  locale?: string;
  /** What to return when input can't be parsed. Defaults to "". */
  fallback?: string;
};

type WallClock = {
  year: number;
  month: number; // 1-12
  day: number;
  hour?: number; // 0-23
  minute?: number;
};

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_ONLY_RE = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;

const inRange = (n: number, lo: number, hi: number): boolean =>
  Number.isFinite(n) && n >= lo && n <= hi;

const parseDateOnly = (
  s: string,
): { y: number; m: number; d: number } | null => {
  const match = DATE_ONLY_RE.exec(s.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (!inRange(m, 1, 12) || !inRange(d, 1, 31)) return null;
  return { y, m, d };
};

const parseTimeOnly = (
  s: string,
): { h: number; min: number } | null => {
  const match = TIME_ONLY_RE.exec(s.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const min = Number(match[2]);
  if (!inRange(h, 0, 23) || !inRange(min, 0, 59)) return null;
  return { h, min };
};

// Extract wall-clock parts from a Date in the given timezone via Intl.
const dateToWallClock = (d: Date, timeZone: string): WallClock | null => {
  if (Number.isNaN(d.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const map: Record<string, string> = {};
    for (const p of parts) map[p.type] = p.value;
    const year = Number(map.year);
    const month = Number(map.month);
    const day = Number(map.day);
    let hour = Number(map.hour);
    const minute = Number(map.minute);
    // Some runtimes emit "24" for midnight — normalize.
    if (hour === 24) hour = 0;
    if (
      !inRange(year, 1, 9999) ||
      !inRange(month, 1, 12) ||
      !inRange(day, 1, 31) ||
      !inRange(hour, 0, 23) ||
      !inRange(minute, 0, 59)
    ) {
      return null;
    }
    return { year, month, day, hour, minute };
  } catch {
    return null;
  }
};

const resolveWallClock = (
  date: DateLike,
  time?: DateLike,
  opts?: FormatOptions,
): WallClock | null => {
  if (date === null || date === undefined || date === "") return null;
  const tz = opts?.timeZone ?? "UTC";

  if (typeof date === "string") {
    const trimmed = date.trim();
    // Date-only string — wall-clock, no zone shift.
    const dOnly = parseDateOnly(trimmed);
    if (dOnly) {
      let hour: number | undefined;
      let minute: number | undefined;
      if (typeof time === "string" && time) {
        const t = parseTimeOnly(time);
        if (t) {
          hour = t.h;
          minute = t.min;
        }
      }
      return { year: dOnly.y, month: dOnly.m, day: dOnly.d, hour, minute };
    }
    // Full ISO / parseable datetime.
    return dateToWallClock(new Date(trimmed), tz);
  }

  if (typeof date === "number") return dateToWallClock(new Date(date), tz);
  if (date instanceof Date) return dateToWallClock(date, tz);
  return null;
};

const buildUtcDate = (w: WallClock): Date =>
  new Date(
    Date.UTC(w.year, w.month - 1, w.day, w.hour ?? 12, w.minute ?? 0),
  );

const formatTimePart = (w: WallClock, locale: string): string => {
  if (w.hour === undefined || w.minute === undefined) return "";
  // Conversational 12-hour time. Drops ":00" on the hour so a
  // top-of-the-hour booking reads "9 AM" instead of "9:00 AM".
  // Off-the-hour bookings keep their minutes ("9:30 AM").
  const onTheHour = w.minute === 0;
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    ...(onTheHour ? {} : { minute: "2-digit" }),
    hour12: true,
    timeZone: "UTC",
  }).format(buildUtcDate(w));
};

/**
 * Long-form appointment date.
 * @example
 *   formatAppointmentDate("2026-05-31", "09:00")
 *   // → "Sunday, May 31 at 9 AM"
 *
 *   formatAppointmentDate("2026-06-02")
 *   // → "Tuesday, June 2"
 */
export const formatAppointmentDate = (
  date: DateLike,
  time?: DateLike,
  opts: FormatOptions = {},
): string => {
  const w = resolveWallClock(date, time, opts);
  if (!w) return opts.fallback ?? "";
  const locale = opts.locale ?? "en-US";
  const head = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(buildUtcDate(w));
  const tail = formatTimePart(w, locale);
  return tail ? `${head} at ${tail}` : head;
};

/**
 * Compact appointment date (no weekday).
 * @example
 *   formatAppointmentDateShort("2026-05-31", "09:00")
 *   // → "May 31, 9 AM"
 */
export const formatAppointmentDateShort = (
  date: DateLike,
  time?: DateLike,
  opts: FormatOptions = {},
): string => {
  const w = resolveWallClock(date, time, opts);
  if (!w) return opts.fallback ?? "";
  const locale = opts.locale ?? "en-US";
  const head = new Intl.DateTimeFormat(locale, {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(buildUtcDate(w));
  const tail = formatTimePart(w, locale);
  return tail ? `${head}, ${tail}` : head;
};

/**
 * 12-hour clock time only.
 * @example
 *   formatAppointmentTime("09:00")   // → "9 AM"
 *   formatAppointmentTime("14:30")   // → "2:30 PM"
 */
export const formatAppointmentTime = (
  time: DateLike,
  opts: FormatOptions = {},
): string => {
  if (time === null || time === undefined || time === "") {
    return opts.fallback ?? "";
  }
  const locale = opts.locale ?? "en-US";
  const tz = opts.timeZone ?? "UTC";

  if (typeof time === "string") {
    const t = parseTimeOnly(time);
    if (t) {
      const w: WallClock = {
        year: 2000,
        month: 1,
        day: 1,
        hour: t.h,
        minute: t.min,
      };
      return formatTimePart(w, locale);
    }
    const w = dateToWallClock(new Date(time.trim()), tz);
    return w ? formatTimePart(w, locale) : (opts.fallback ?? "");
  }
  if (typeof time === "number") {
    const w = dateToWallClock(new Date(time), tz);
    return w ? formatTimePart(w, locale) : (opts.fallback ?? "");
  }
  if (time instanceof Date) {
    const w = dateToWallClock(time, tz);
    return w ? formatTimePart(w, locale) : (opts.fallback ?? "");
  }
  return opts.fallback ?? "";
};
