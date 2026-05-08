// Edge Function: calendar-feed
//
// Public endpoint that returns a live ICS feed for one user's
// appointments, gated by an opaque token. Subscribe URL shape:
//
//     https://<project>.functions.supabase.co/calendar-feed?token=<token>
//
// Anonymous reads are allowed (the request itself isn't authed),
// but the function uses the service role to:
//   1. Look up the token in calendar_feed_tokens (must not be revoked)
//   2. Read that user's appointments
// Every other piece of the app is still RLS-locked.

// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PRODID = "-//Braid Boss Pro//Braid Boss Pro Calendar//EN";

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const escapeText = (s: string): string =>
  s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const foldLine = (line: string) => {
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
const fmtLocal = (date: string, time: string) => {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (time || "10:00").split(":").map(Number);
  return `${y}${pad(m)}${pad(d)}T${pad(hh)}${pad(mm)}00`;
};
const fmtUtc = (iso?: string) => {
  const d = iso ? new Date(iso) : new Date();
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
};
const addHours = (date: string, time: string, hours: number) => {
  const [y, mo, d] = date.split("-").map(Number);
  const [hh, mm] = (time || "10:00").split(":").map(Number);
  const dt = new Date(y, mo - 1, d, hh, mm);
  dt.setMinutes(dt.getMinutes() + Math.round(hours * 60));
  return { date: `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`, time: `${pad(dt.getHours())}:${pad(dt.getMinutes())}` };
};

serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) return new Response("token required", { status: 400 });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: row, error: tokenErr } = await supabase
    .from("calendar_feed_tokens")
    .select("user_id, revoked_at")
    .eq("token", token)
    .maybeSingle();
  if (tokenErr) return new Response("server error", { status: 500 });
  if (!row || row.revoked_at) return new Response("invalid or revoked token", { status: 404 });

  await supabase
    .from("calendar_feed_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("token", token);

  const [{ data: appts = [] }, { data: settings }] = await Promise.all([
    supabase
      .from("appointments")
      .select("*")
      .eq("user_id", row.user_id)
      .neq("status", "cancelled")
      .order("appt_date", { ascending: true }),
    supabase
      .from("settings")
      .select("business_name, data")
      .eq("user_id", row.user_id)
      .maybeSingle(),
  ]);

  const businessName = settings?.business_name || (settings?.data as any)?.business?.businessName || "Braid Boss Pro";

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(businessName)}`,
  ];
  for (const a of (appts || []) as any[]) {
    if (!a?.id || !a?.appt_date) continue;
    const time = a.appt_time || "10:00";
    const dur = Math.max(0.25, Number(a.duration_hours) || 1);
    const end = addHours(a.appt_date, time, dur);
    const summary = [a.style || "Appointment", a.client_name || ""].filter(Boolean).join(" · ");
    const desc: string[] = [];
    if (a.total_price != null) desc.push(`Total: ${a.total_price}`);
    if (a.deposit_paid != null) desc.push(`Deposit: ${a.deposit_paid}`);
    if (a.balance_due != null) desc.push(`Balance due: ${a.balance_due}`);
    if (a.payment_status) desc.push(`Payment status: ${a.payment_status}`);
    if (a.client_phone) desc.push(`Phone: ${a.client_phone}`);
    if (a.client_email) desc.push(`Email: ${a.client_email}`);
    if (a.notes) desc.push(a.notes);
    const status = a.status === "completed" ? "CONFIRMED"
      : a.status === "no_show" ? "CANCELLED"
      : "CONFIRMED";
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${a.id}@bbp`);
    lines.push(`DTSTAMP:${fmtUtc(a.updated_at || a.created_at)}`);
    lines.push(`DTSTART:${fmtLocal(a.appt_date, time)}`);
    lines.push(`DTEND:${fmtLocal(end.date, end.time)}`);
    lines.push(`SUMMARY:${escapeText(summary)}`);
    if (desc.length) lines.push(`DESCRIPTION:${escapeText(desc.join("\n"))}`);
    lines.push(`ORGANIZER;CN=${escapeText(businessName)}:invalid:nomail`);
    lines.push(`STATUS:${status}`);
    lines.push("TRANSP:OPAQUE");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");

  const body = lines.map(foldLine).join("\r\n");
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": "private, max-age=60",
      "x-content-type-options": "nosniff",
    },
  });
});
