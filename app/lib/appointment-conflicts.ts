// Double-booking detection for the appointment sheet.
//
// Nothing in the app prevents two appointments sharing a slot, and that
// is deliberate — braiders overlap on purpose (one client under the
// dryer while the next gets parted), and the day view draws overlapping
// bookings side by side rather than treating them as an error. So this
// module exists to *inform*, never to block a save.
//
// It earns its place because duration is no longer changed only by hand:
// adding a service or an add-on to a booked appointment extends the
// ticket, so an appointment can grow into the next client without
// anyone touching the time field.
//
// Deliberately dependency-free (no React, no Supabase) so it can be unit
// tested — the rules about what counts as a clash are the part worth
// pinning down, not the markup that renders them.

export type ConflictCandidate = {
  id?: string | number | null;
  date?: string | null;
  time?: string | null;
  durationHours?: number | string | null;
  isAllDay?: boolean | null;
  status?: string | null;
  /** false = kept on the calendar for reference but doesn't hold the slot. */
  blocksAvailability?: boolean | null;
  kind?: string | null;
  clientName?: string | null;
  style?: string | null;
  eventTitle?: string | null;
  event_title?: string | null;
};

export type Conflict = {
  id: string;
  label: string;
  startMinute: number;
  endMinute: number;
};

/**
 * An entry with no duration still occupies its start time. Treating it
 * as a minimum slot rather than a zero-width instant means a missing
 * duration can't hide a genuine clash.
 */
export const MIN_SLOT_MINUTES = 15;

/** Fallback length when durationHours is absent or unparseable. */
export const DEFAULT_SLOT_MINUTES = 60;

/** Minutes past midnight for a "HH:MM" value; null when unparseable —
 *  which is how a half-typed time field reads. */
export const startMinuteOf = (time: unknown): number | null => {
  const parts = String(time ?? "").split(":");
  const hh = Number(parts[0]);
  const mm = Number(parts[1]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
};

export const slotLengthMinutes = (durationHours: unknown): number => {
  const mins = Math.round((Number(durationHours) || 0) * 60);
  return Math.max(MIN_SLOT_MINUTES, mins || DEFAULT_SLOT_MINUTES);
};

const normalizedStatus = (s: unknown): string => String(s ?? "").trim().toLowerCase();

/** Cancelled work doesn't hold a slot, so it can't be double-booked against. */
export const holdsItsSlot = (a: ConflictCandidate | null | undefined): boolean => {
  if (!a) return false;
  if (a.isAllDay) return false;
  if (a.blocksAvailability === false) return false;
  const s = normalizedStatus(a.status);
  return s !== "cancelled" && s !== "canceled" && s !== "no_show" && s !== "noshow";
};

/** What to call the thing being clashed with, in the stylist's terms. */
export const conflictLabel = (a: ConflictCandidate): string => {
  const kind = String(a.kind || "appointment");
  const title = String(a.eventTitle || a.event_title || "").trim();
  if (kind === "blocked") return title || "Unavailable";
  if (kind === "personal") return title || "Personal event";
  return String(a.clientName || "").trim() || String(a.style || "").trim() || "Appointment";
};

/**
 * Everything on `subject`'s day whose time range overlaps it.
 *
 * Ranges are half-open: an appointment ending at 2:00 and the next
 * starting at 2:00 are back-to-back, not a clash. Returns [] whenever
 * the subject itself can't hold a slot (cancelled, all-day, no parseable
 * time) — there's nothing to warn about in those cases.
 */
export const findAppointmentConflicts = (
  subject: ConflictCandidate | null | undefined,
  all: ConflictCandidate[] | null | undefined,
): Conflict[] => {
  if (!subject?.date || !holdsItsSlot(subject)) return [];
  const start = startMinuteOf(subject.time);
  if (start == null) return [];
  const end = start + slotLengthMinutes(subject.durationHours);
  const subjectId = subject.id == null ? null : String(subject.id);

  const out: Conflict[] = [];
  for (const a of Array.isArray(all) ? all : []) {
    if (!a) continue;
    // Never clash with yourself. A draft with no id can't match anything
    // by id, which is correct — it isn't in the list yet.
    if (subjectId != null && a.id != null && String(a.id) === subjectId) continue;
    if ((a.date || "") !== subject.date) continue;
    if (!holdsItsSlot(a)) continue;
    const otherStart = startMinuteOf(a.time);
    if (otherStart == null) continue;
    const otherEnd = otherStart + slotLengthMinutes(a.durationHours);
    if (start >= otherEnd || otherStart >= end) continue;
    out.push({
      id: a.id == null ? "" : String(a.id),
      label: conflictLabel(a),
      startMinute: otherStart,
      endMinute: otherEnd,
    });
  }
  return out.sort((x, y) => x.startMinute - y.startMinute);
};
