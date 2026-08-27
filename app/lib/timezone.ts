// Timezone helpers for running the notification rules off-device.
//
// Why this exists:
//   notification-rules.ts builds appointment start times with
//   `new Date(y, m - 1, d, hh, mm)` — the PROCESS's local timezone. In the
//   browser that is the stylist's own phone, so the wall-clock time they
//   booked ("2 PM") is interpreted correctly. On the server the process runs
//   in UTC, so the same booking is read as 2 PM UTC — 9 AM for an Eastern
//   stylist. A "starts soon" push would fire ~5 hours early.
//
//   Rather than fork the rule generators (they are shared with the client and
//   must not drift), we keep them untouched and feed them a SHIFTED clock:
//
//     delta = startLocalInterpretation - (now + userOffset)
//
//   which is algebraically the same as comparing the true instant to now.
//   `nowMsForTz` produces that shifted clock and `todayIsoInTz` produces the
//   matching calendar date, so every generator lands on the stylist's day.
//
// No dependencies — Intl handles DST correctly, including the offset actually
// in effect at the given instant rather than a fixed standard-time offset.

// Milliseconds to add to a UTC instant to express it as wall-clock time in
// `timeZone`. Eastern Daylight Time → -14_400_000 (UTC-4).
//
// Works by formatting the instant in the target zone, reassembling those
// parts as if they were UTC, and taking the difference. Returns 0 for an
// unknown or malformed zone so a bad value degrades to UTC instead of
// throwing mid-sweep.
export const tzOffsetMs = (timeZone: string, at: Date = new Date()): number => {
  if (!timeZone) return 0;
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts: Record<string, string> = {};
    for (const { type, value } of dtf.formatToParts(at)) parts[type] = value;
    const asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      // Intl can emit "24" for midnight under hour12:false.
      Number(parts.hour) % 24,
      Number(parts.minute),
      Number(parts.second),
    );
    if (!Number.isFinite(asUtc)) return 0;
    // Drop sub-second precision on both sides so the difference is a clean
    // offset rather than offset-plus-milliseconds.
    return asUtc - Math.floor(at.getTime() / 1000) * 1000;
  } catch {
    return 0;
  }
};

// True when Intl recognises the zone. Used to reject junk before it reaches
// the rule sweep — an unrecognised zone would silently mean UTC, and firing
// reminders at the wrong hour is worse than not firing them at all.
export const isValidTimeZone = (timeZone: unknown): timeZone is string => {
  if (typeof timeZone !== "string" || !timeZone.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
};

// Calendar date (YYYY-MM-DD) in `timeZone` at the given instant. This is the
// `todayIso` the balance / retention / insight generators key off.
export const todayIsoInTz = (timeZone: string, at: Date = new Date()): string => {
  try {
    // en-CA formats as YYYY-MM-DD, which is exactly the shape the rules use.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
};

// The shifted "now" to hand the rule generators so their local-time date
// construction lines up with the stylist's wall clock. See the module note.
export const nowMsForTz = (timeZone: string, at: Date = new Date()): number =>
  at.getTime() + tzOffsetMs(timeZone, at);

// The stylist's own zone, for persisting from the browser. Returns null when
// the runtime can't report one, so callers can skip the write rather than
// storing a guess.
export const detectBrowserTimeZone = (): string | null => {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimeZone(tz) ? tz : null;
  } catch {
    return null;
  }
};

// Zones offered when the runtime can't enumerate them itself. Deliberately
// the US zones plus UTC rather than a token world list: an incomplete
// "everywhere" list reads as a bug to anyone it omits, whereas an explicitly
// short list plus whatever auto-detect found is honest. `listTimeZones`
// always folds the detected and currently-saved zones in, so a stylist
// outside these is never stranded on an old browser.
const FALLBACK_TIME_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "UTC",
];

// Every zone the picker should offer, sorted. Prefers the runtime's own
// catalogue (Intl.supportedValuesOf, ~400 zones, iOS 15.4+) and falls back to
// the short list above. `include` pins values that must appear whatever the
// source — the detected zone and the one already saved — so the picker can
// never silently drop the stylist's current setting.
export const listTimeZones = (include: (string | null | undefined)[] = []): string[] => {
  let base: string[] = [];
  try {
    const supported = (Intl as unknown as {
      supportedValuesOf?: (k: string) => string[];
    }).supportedValuesOf;
    if (typeof supported === "function") base = supported("timeZone") || [];
  } catch { /* fall through to the short list */ }
  if (base.length === 0) base = [...FALLBACK_TIME_ZONES];

  const out = new Set(base);
  for (const tz of include) {
    if (isValidTimeZone(tz)) out.add(tz);
  }
  return Array.from(out).sort((a, b) => a.localeCompare(b));
};

// Human label for a zone, e.g. "America/Los_Angeles (UTC-7)". The offset is
// the one in effect NOW, so it tracks daylight saving rather than claiming a
// standard-time offset the stylist isn't currently on.
export const formatTimeZoneLabel = (timeZone: string, at: Date = new Date()): string => {
  if (!isValidTimeZone(timeZone)) return String(timeZone || "");
  const offsetMin = Math.round(tzOffsetMs(timeZone, at) / 60000);
  const sign = offsetMin < 0 ? "-" : "+";
  const abs = Math.abs(offsetMin);
  const hh = Math.floor(abs / 60);
  const mm = abs % 60;
  const offset = mm === 0 ? `UTC${sign}${hh}` : `UTC${sign}${hh}:${String(mm).padStart(2, "0")}`;
  return `${timeZone.replace(/_/g, " ")} (${offset})`;
};
