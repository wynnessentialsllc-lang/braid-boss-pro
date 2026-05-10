// Calendar preferences + color-coding helpers for the Schedule
// screen. Kept in a tiny helper module so the main page.tsx file
// doesn't accumulate another 200 lines of palette tables.
//
// Preferences are persisted in localStorage. SSR-safe (every read
// guards `typeof window === "undefined"`).

import { useEffect, useState } from "react";

export type CalendarView = "day" | "week" | "list" | "income";
export type ColorMode = "status" | "service" | "deposit" | "balance";

export type CalendarPrefs = {
  view: CalendarView;
  colorMode: ColorMode;
  showCanceled: boolean;
};

export const DEFAULT_CALENDAR_PREFS: CalendarPrefs = {
  view: "day",
  colorMode: "status",
  showCanceled: false,
};

const STORAGE_KEY = "bbp-calendar-prefs";

const readPrefs = (): CalendarPrefs => {
  if (typeof window === "undefined") return DEFAULT_CALENDAR_PREFS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CALENDAR_PREFS;
    const parsed = JSON.parse(raw);
    return {
      view: ["day", "week", "list", "income"].includes(parsed?.view) ? parsed.view : "day",
      colorMode: ["status", "service", "deposit", "balance"].includes(parsed?.colorMode) ? parsed.colorMode : "status",
      showCanceled: !!parsed?.showCanceled,
    };
  } catch {
    return DEFAULT_CALENDAR_PREFS;
  }
};

const writePrefs = (prefs: CalendarPrefs) => {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); }
  catch { /* quota / private mode */ }
};

export const useCalendarPrefs = (): [CalendarPrefs, (next: Partial<CalendarPrefs>) => void] => {
  // Start with defaults so SSR + first client render match. The real
  // stored values get hydrated in the first useEffect, then writes
  // round-trip.
  const [prefs, setPrefs] = useState<CalendarPrefs>(DEFAULT_CALENDAR_PREFS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setPrefs(readPrefs());
    setHydrated(true);
  }, []);

  const update = (next: Partial<CalendarPrefs>) => {
    setPrefs(prev => {
      const merged = { ...prev, ...next };
      if (hydrated) writePrefs(merged);
      return merged;
    });
  };

  return [prefs, update];
};

// ---- Color coding ------------------------------------------------------
//
// Returns a soft pill background + foreground so the timeline blocks
// stay readable on the cream surface and never fight the gold accent.
// Palette uses Braid Boss Pro tokens (espresso / coffee / gold etc.)
// with low-opacity tints for variety.

export type AppointmentColor = {
  background: string;
  border: string;
  foreground: string;
  accent: string;
  // Single-letter / short label used as a status pill on the block.
  label?: string;
};

// Soft palette derived from the existing brand tokens. Every entry
// stays in the warm cream / coffee / gold family; nothing neon.
const PALETTE = {
  scheduled: { bg: "rgba(201, 169, 97, 0.18)", border: "rgba(168, 137, 63, 0.55)", fg: "#4A2C1A", accent: "#A8893F" },
  confirmed: { bg: "rgba(168, 137, 63, 0.28)", border: "#A8893F", fg: "#2A1810", accent: "#A8893F" },
  completed: { bg: "rgba(92, 124, 74, 0.18)", border: "rgba(92, 124, 74, 0.55)", fg: "#2A1810", accent: "#5C7C4A" },
  cancelled: { bg: "rgba(139, 115, 85, 0.14)", border: "rgba(139, 115, 85, 0.4)",  fg: "#8B7355", accent: "#8B7355" },
  pending:   { bg: "rgba(201, 118, 43, 0.16)", border: "rgba(201, 118, 43, 0.5)",  fg: "#4A2C1A", accent: "#C9762B" },
  noShow:    { bg: "rgba(156, 61, 46, 0.14)", border: "rgba(156, 61, 46, 0.45)",  fg: "#9C3D2E", accent: "#9C3D2E" },

  paid:      { bg: "rgba(92, 124, 74, 0.16)", border: "rgba(92, 124, 74, 0.5)",  fg: "#2A1810", accent: "#5C7C4A" },
  partial:   { bg: "rgba(201, 169, 97, 0.16)", border: "rgba(168, 137, 63, 0.5)", fg: "#4A2C1A", accent: "#A8893F" },
  unpaid:    { bg: "rgba(201, 118, 43, 0.16)", border: "rgba(201, 118, 43, 0.5)", fg: "#4A2C1A", accent: "#C9762B" },

  noBalance: { bg: "rgba(92, 124, 74, 0.16)", border: "rgba(92, 124, 74, 0.5)",  fg: "#2A1810", accent: "#5C7C4A" },
  balanceDue:{ bg: "rgba(201, 118, 43, 0.16)", border: "rgba(201, 118, 43, 0.5)", fg: "#4A2C1A", accent: "#C9762B" },
  overdue:   { bg: "rgba(156, 61, 46, 0.16)", border: "rgba(156, 61, 46, 0.55)", fg: "#9C3D2E", accent: "#9C3D2E" },

  serviceA:  { bg: "rgba(74, 44, 26, 0.10)",  border: "rgba(74, 44, 26, 0.35)",  fg: "#2A1810", accent: "#4A2C1A" },
  serviceB:  { bg: "rgba(139, 90, 43, 0.16)", border: "rgba(139, 90, 43, 0.45)", fg: "#2A1810", accent: "#8B5A2B" },
  serviceC:  { bg: "rgba(201, 169, 97, 0.20)", border: "rgba(168, 137, 63, 0.55)", fg: "#2A1810", accent: "#A8893F" },
  serviceD:  { bg: "rgba(92, 124, 74, 0.18)", border: "rgba(92, 124, 74, 0.5)",  fg: "#2A1810", accent: "#5C7C4A" },
  serviceE:  { bg: "rgba(168, 137, 63, 0.18)", border: "#A8893F", fg: "#2A1810", accent: "#A8893F" },

  neutral:   { bg: "rgba(74, 44, 26, 0.08)",  border: "rgba(74, 44, 26, 0.20)",  fg: "#4A2C1A", accent: "#8B7355" },
};

// Hash a free-text style name into one of the soft service swatches.
const SERVICE_SWATCHES = ["serviceA", "serviceB", "serviceC", "serviceD", "serviceE"] as const;
const swatchForString = (s: string | null | undefined): keyof typeof PALETTE => {
  const t = (s || "").trim();
  if (!t) return "neutral";
  let h = 0;
  for (let i = 0; i < t.length; i += 1) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return SERVICE_SWATCHES[h % SERVICE_SWATCHES.length];
};

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled: "Canceled",
  no_show: "No-show",
};

export const colorForAppointment = (
  appt: any,
  mode: ColorMode,
  todayIso: string,
): AppointmentColor => {
  const totalPrice = Number(appt?.totalPrice) || 0;
  const deposit = Number(appt?.depositPaid) || 0;
  const discount = Number(appt?.discountAmount) || 0;
  const net = Math.max(0, totalPrice - discount);
  const balance = Math.max(0, net - deposit);
  const status = (appt?.status || "scheduled") as keyof typeof PALETTE;

  let key: keyof typeof PALETTE = "neutral";
  let label: string | undefined;

  if (mode === "status") {
    if (status === "scheduled" || status === "confirmed" || status === "completed" || status === "cancelled") {
      key = status;
    } else if (appt?.status === "no_show") {
      key = "noShow";
    } else {
      key = "pending";
    }
    label = STATUS_LABELS[appt?.status] || "Scheduled";
  } else if (mode === "service") {
    key = swatchForString(appt?.style);
    label = appt?.style || undefined;
  } else if (mode === "deposit") {
    if (deposit <= 0) { key = "unpaid"; label = "Deposit due"; }
    else if (deposit < net) { key = "partial"; label = "Partial deposit"; }
    else { key = "paid"; label = "Deposit paid"; }
  } else if (mode === "balance") {
    if (balance <= 0) { key = "noBalance"; label = "No balance"; }
    else if (appt?.date && appt.date < todayIso) { key = "overdue"; label = "Overdue"; }
    else { key = "balanceDue"; label = "Balance due"; }
  }

  const swatch = PALETTE[key];
  return {
    background: swatch.bg,
    border: swatch.border,
    foreground: swatch.fg,
    accent: swatch.accent,
    label,
  };
};

// ---- All-day status helper --------------------------------------------
//
// Quick read-only summary for the strip above the Day timeline.
// "Off" is intentionally not auto-derived in V1 — the working-hours
// editor that would set off-days isn't built yet, so we only surface
// states we can compute from data we already have.

export type DayStatus = "off" | "fully_booked" | "openings_available" | "deposit_due" | "empty";

export const computeDayStatus = (
  apptsForDay: any[],
  opts: { workingDayHours?: number } = {},
): { status: DayStatus; label: string } => {
  const list = apptsForDay.filter(a => a?.status !== "cancelled");
  if (list.length === 0) return { status: "empty", label: "No bookings" };
  const totalHours = list.reduce((s, a) => s + (Number(a?.durationHours) || 0), 0);
  const cap = opts.workingDayHours ?? 8;
  const anyDepositDue = list.some(a => (Number(a?.depositPaid) || 0) <= 0);
  if (totalHours >= cap) return { status: "fully_booked", label: "Fully booked" };
  if (anyDepositDue) return { status: "deposit_due", label: "Deposit due" };
  return { status: "openings_available", label: "Openings available" };
};
