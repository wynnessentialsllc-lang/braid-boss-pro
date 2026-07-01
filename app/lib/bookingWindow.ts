// Calendar Reveal — Braid Boss Pro's booking-window engine.
//
// This is the JS twin of the SQL compute_booking_window() helper (see
// migration 20261126000000_booking_window_calendar_reveal.sql). The
// database is the source of truth for *enforcement*; this module powers
// the stylist's settings preview and bounds the public calendar so the
// two always agree. Keep the month math here in lockstep with the SQL.
//
// Three shapes, matching how braiders actually run their books:
//   rolling          — the next N days are always open; the horizon
//                      slides forward on its own every day.
//   fixed            — a hard cutoff date; nothing bookable after it.
//   monthly_release  — books "drop" on a set day each month for the
//                      next month(s); the reveal happens automatically.

import { getSupabase } from "./supabase";

export type BookingWindowMode = "rolling" | "fixed" | "monthly_release";

// Config as stored on booking_policies.
export type BookingWindowConfig = {
  mode: BookingWindowMode;
  windowDays: number;         // rolling horizon in days
  until: string | null;       // fixed cutoff, "YYYY-MM-DD"
  minNoticeHours: number;     // minimum lead time before an appointment
  releaseDay: number | null;  // monthly_release: day of month (1–28)
  releaseMonths: number;      // monthly_release: months opened per drop
};

// Resolved window the calendar can consume directly.
export type BookingWindow = {
  mode: BookingWindowMode;
  minDate: string;                   // earliest bookable, inclusive
  maxDate: string | null;            // latest bookable, inclusive; null = uncapped
  windowDays: number;
  releaseDay: number | null;
  releaseMonths: number;
  nextReleaseDate: string | null;    // monthly_release: when the next drop lands
  nextReleaseMaxDate: string | null; // monthly_release: horizon after that drop
};

// Square-style quick presets the settings UI surfaces as chips.
export const ROLLING_PRESETS = [30, 60, 90, 120, 180] as const;

export const DEFAULT_WINDOW_CONFIG: BookingWindowConfig = {
  mode: "rolling",
  windowDays: 60,
  until: null,
  minNoticeHours: 0,
  releaseDay: 1,
  releaseMonths: 1,
};

// ---- date helpers (local-date arithmetic, no external deps) ----------

const pad = (n: number): string => String(n).padStart(2, "0");

const toISO = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const startOfDay = (d: Date): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());

const addDays = (d: Date, n: number): Date => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
};

const firstOfMonth = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), 1);

// End of the month that sits `months` after the given first-of-month.
// e.g. first = Jul 1, months = 1 → Aug 31.
const endOfMonthAfter = (first: Date, months: number): Date =>
  addDays(new Date(first.getFullYear(), first.getMonth() + months + 1, 1), -1);

const clampInt = (n: unknown, lo: number, hi: number, fallback: number): number => {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, v));
};

// ---- the engine ------------------------------------------------------

// Mirror of SQL compute_booking_window(). `today` defaults to now and is
// injectable so tests are deterministic.
export const computeBookingWindow = (
  config: Partial<BookingWindowConfig> | null | undefined,
  today: Date = new Date(),
): BookingWindow => {
  const cfg: BookingWindowConfig = { ...DEFAULT_WINDOW_CONFIG, ...(config || {}) };
  const mode: BookingWindowMode =
    cfg.mode === "fixed" || cfg.mode === "monthly_release" ? cfg.mode : "rolling";

  const todayStart = startOfDay(today);

  // Earliest bookable date honours the minimum-notice lead time.
  const noticeHours = Math.max(0, Number(cfg.minNoticeHours) || 0);
  const noticeStart = startOfDay(new Date(today.getTime() + noticeHours * 3_600_000));
  const minDate = noticeStart < todayStart ? todayStart : noticeStart;

  let maxDate: Date | null = null;
  let nextReleaseDate: Date | null = null;
  let nextReleaseMaxDate: Date | null = null;
  const releaseDay = cfg.releaseDay == null ? null : clampInt(cfg.releaseDay, 1, 28, 1);
  const releaseMonths = clampInt(cfg.releaseMonths, 1, 12, 1);

  if (mode === "fixed") {
    maxDate = cfg.until ? startOfDay(new Date(`${cfg.until}T00:00:00`)) : null;
  } else if (mode === "monthly_release") {
    const rday = releaseDay ?? 1;
    let lastReleaseFirst: Date;
    let nextReleaseFirst: Date;
    if (today.getDate() >= rday) {
      lastReleaseFirst = firstOfMonth(today);
      nextReleaseFirst = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    } else {
      lastReleaseFirst = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      nextReleaseFirst = firstOfMonth(today);
    }
    maxDate = endOfMonthAfter(lastReleaseFirst, releaseMonths);
    nextReleaseDate = new Date(nextReleaseFirst.getFullYear(), nextReleaseFirst.getMonth(), rday);
    nextReleaseMaxDate = endOfMonthAfter(nextReleaseFirst, releaseMonths);
  } else {
    // rolling
    maxDate = addDays(todayStart, Math.max(1, clampInt(cfg.windowDays, 1, 730, 60)));
  }

  return {
    mode,
    minDate: toISO(minDate),
    maxDate: maxDate ? toISO(maxDate) : null,
    windowDays: clampInt(cfg.windowDays, 1, 730, 60),
    releaseDay,
    releaseMonths,
    nextReleaseDate: nextReleaseDate ? toISO(nextReleaseDate) : null,
    nextReleaseMaxDate: nextReleaseMaxDate ? toISO(nextReleaseMaxDate) : null,
  };
};

// True when a "YYYY-MM-DD" date sits inside the open window.
export const isDateBookable = (win: BookingWindow, iso: string): boolean => {
  if (!iso) return false;
  if (iso < win.minDate) return false;
  if (win.maxDate !== null && iso > win.maxDate) return false;
  return true;
};

// True when the whole month (year, month 1–12) is entirely past the
// horizon — used to stop the calendar's "next month" navigation.
export const isMonthBeyondWindow = (
  win: BookingWindow,
  year: number,
  month: number,
): boolean => {
  if (win.maxDate === null) return false;
  const firstOfThisMonth = `${year}-${pad(month)}-01`;
  return firstOfThisMonth > win.maxDate;
};

// ---- friendly copy ---------------------------------------------------

const prettyDate = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.valueOf())) return "";
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric" });
};

const ordinal = (n: number): string => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

// One-line summary for the settings preview and booking-page banner.
export const describeBookingWindow = (config: Partial<BookingWindowConfig>): string => {
  const cfg = { ...DEFAULT_WINDOW_CONFIG, ...config };
  if (cfg.mode === "fixed") {
    return cfg.until
      ? `Clients can book through ${prettyDate(cfg.until)}.`
      : "Clients can book with no end date set.";
  }
  if (cfg.mode === "monthly_release") {
    const day = ordinal(clampInt(cfg.releaseDay ?? 1, 1, 28, 1));
    const months = clampInt(cfg.releaseMonths, 1, 12, 1);
    const reach = months === 1 ? "the next month" : `the next ${months} months`;
    return `Your books drop on the ${day} of each month, opening ${reach}.`;
  }
  return `Clients can book the next ${clampInt(cfg.windowDays, 1, 730, 60)} days.`;
};

// ---- public (anon) fetch --------------------------------------------

// Reads the resolved window for a booking slug. Returns null on any
// error so the booking page can fall back to its default behaviour.
export const fetchPublicBookingWindow = async (
  slug: string,
): Promise<BookingWindow | null> => {
  if (!slug) return null;
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc("public_get_booking_window", { slug_in: slug });
    if (error) return null;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    const mode = ["rolling", "fixed", "monthly_release"].includes(String(row.mode))
      ? (String(row.mode) as BookingWindowMode)
      : "rolling";
    const asISO = (v: any): string | null =>
      v ? String(v).slice(0, 10) : null;
    return {
      mode,
      minDate: asISO(row.min_date) || toISO(new Date()),
      maxDate: asISO(row.max_date),
      windowDays: Number(row.window_days) || 60,
      releaseDay: row.release_day == null ? null : Number(row.release_day),
      releaseMonths: Number(row.release_months) || 1,
      nextReleaseDate: asISO(row.next_release_date),
      nextReleaseMaxDate: asISO(row.next_release_max_date),
    };
  } catch {
    return null;
  }
};
