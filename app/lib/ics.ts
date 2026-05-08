// ICS (RFC 5545) generation for Braid Boss Pro appointments.
//
// V1 emits a self-contained VCALENDAR with one VEVENT per appointment.
// Times are written as "floating" local times (no TZID, no Z suffix)
// so calendar apps render them in the viewer's local timezone — the
// right behaviour for an in-salon appointment whose hours don't shift
// with the client's location.

export type IcsAppointment = {
  id: string;
  date: string;            // YYYY-MM-DD
  time?: string;           // HH:mm
  durationHours?: number | string;
  style?: string;
  clientName?: string;
  clientPhone?: string;
  clientEmail?: string;
  notes?: string;
  totalPrice?: number | string;
  depositPaid?: number | string;
  balanceDue?: number | string;
  paymentStatus?: string;
  status?: string;
  updatedAt?: string;
  createdAt?: string;
};

const PRODID = "-//Braid Boss Pro//Braid Boss Pro Calendar//EN";

const pad = (n: number, w: number = 2) => String(n).padStart(w, "0");

// Escape per RFC 5545 §3.3.11: backslash, comma, semicolon, newline.
const escapeText = (s: string): string =>
  s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");

// 75-octet line folding per §3.1. Continuation lines start with a
// single space. We measure characters, not bytes, which is fine for
// ASCII / common UTF-8 content; calendar consumers tolerate slightly
// longer lines, so this is a polite upper bound.
const foldLine = (line: string): string => {
  if (line.length <= 75) return line;
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    const chunk = line.slice(i, i + (i === 0 ? 75 : 74));
    out.push(i === 0 ? chunk : " " + chunk);
    i += i === 0 ? 75 : 74;
  }
  return out.join("\r\n");
};

const formatLocal = (date: string, time: string): string => {
  // YYYY-MM-DD + HH:mm  →  YYYYMMDDTHHMMSS  (floating local time)
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (time || "10:00").split(":").map(Number);
  return `${y}${pad(m)}${pad(d)}T${pad(hh)}${pad(mm)}00`;
};

const formatUtcStamp = (iso?: string): string => {
  const d = iso ? new Date(iso) : new Date();
  if (!Number.isFinite(d.getTime())) return formatUtcStamp(undefined);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const hh = d.getUTCHours();
  const mm = d.getUTCMinutes();
  const ss = d.getUTCSeconds();
  return `${y}${pad(m)}${pad(day)}T${pad(hh)}${pad(mm)}${pad(ss)}Z`;
};

const addHoursToLocal = (date: string, time: string, hours: number): { date: string; time: string } => {
  const [y, mo, d] = date.split("-").map(Number);
  const [hh, mm] = (time || "10:00").split(":").map(Number);
  const dt = new Date(y, mo - 1, d, hh, mm);
  dt.setMinutes(dt.getMinutes() + Math.round(hours * 60));
  return {
    date: `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`,
    time: `${pad(dt.getHours())}:${pad(dt.getMinutes())}`,
  };
};

export const buildVEvent = (appt: IcsAppointment, business?: { businessName?: string; currency?: string }): string => {
  const date = appt.date || "";
  const time = appt.time || "10:00";
  const durHours = Math.max(0.25, Number(appt.durationHours) || 1);
  const end = addHoursToLocal(date, time, durHours);
  const summaryParts = [appt.style || "Appointment", appt.clientName || ""].filter(Boolean);
  const summary = summaryParts.join(" · ");
  const lines: string[] = [];
  const descParts: string[] = [];
  if (appt.totalPrice != null) descParts.push(`Total: ${appt.totalPrice}`);
  if (appt.depositPaid != null) descParts.push(`Deposit: ${appt.depositPaid}`);
  if (appt.balanceDue != null) descParts.push(`Balance due: ${appt.balanceDue}`);
  if (appt.paymentStatus) descParts.push(`Payment status: ${appt.paymentStatus}`);
  if (appt.clientPhone) descParts.push(`Phone: ${appt.clientPhone}`);
  if (appt.clientEmail) descParts.push(`Email: ${appt.clientEmail}`);
  if (appt.notes) descParts.push(appt.notes);
  const description = descParts.join("\n");
  const status = appt.status === "completed" ? "CONFIRMED"
    : appt.status === "cancelled" ? "CANCELLED"
    : appt.status === "no_show" ? "CANCELLED"
    : "CONFIRMED";

  lines.push("BEGIN:VEVENT");
  lines.push(`UID:${appt.id}@bbp`);
  lines.push(`DTSTAMP:${formatUtcStamp(appt.updatedAt || appt.createdAt)}`);
  lines.push(`DTSTART:${formatLocal(date, time)}`);
  lines.push(`DTEND:${formatLocal(end.date, end.time)}`);
  lines.push(`SUMMARY:${escapeText(summary)}`);
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
  if (business?.businessName) lines.push(`ORGANIZER;CN=${escapeText(business.businessName)}:invalid:nomail`);
  lines.push(`STATUS:${status}`);
  lines.push("TRANSP:OPAQUE");
  lines.push("END:VEVENT");
  return lines.map(foldLine).join("\r\n");
};

export const buildVCalendar = (appts: IcsAppointment[], business?: { businessName?: string; currency?: string }): string => {
  const safe = (Array.isArray(appts) ? appts : []).filter(a => a && a.id && a.date);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  if (business?.businessName) {
    lines.push(`X-WR-CALNAME:${escapeText(business.businessName)}`);
  }
  for (const a of safe) lines.push(buildVEvent(a, business));
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
};

// Browser-side download helper. SSR-safe (no-op).
export const downloadIcs = (filename: string, body: string): void => {
  if (typeof window === "undefined") return;
  const blob = new Blob([body], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const sanitizeFilename = (s: string): string =>
  (s || "calendar").replace(/[^a-z0-9_\-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();
