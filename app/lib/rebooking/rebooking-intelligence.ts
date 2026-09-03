// Rebooking + Retention Intelligence
//
// Pure module — no React, no Supabase imports. Takes the same client +
// appointment shapes the rest of the app already uses (clients in
// `store.clients`, appointments in `store.appointments`) and returns a
// scored list of rebooking opportunities.
//
// Why per-style windows instead of average cadence:
//   The cadence-based detector that lived inline in app/page.tsx fired
//   based on each client's own historical gap between visits — fine for
//   regulars, but it never flags a one-time client. Style-aware windows
//   let us notice that a knotless client from 7 weeks ago is overdue
//   even if she's only been in once. This module is now the single
//   source of truth for rebooking across the app — the Rebooking
//   opportunities card, the "Rebook due" retention tile, the client
//   profile's insight card, and the notification bell all read from it.
//   (An older cadence-based `getRebookingCandidates` detector in
//   page.tsx was retired once every surface moved here.)
//
// Two window sources, one precedence rule:
//   A stylist can set services.rebook_after_weeks (Settings → Services)
//   — the same field process_rebook_nudges() reads to auto-send the
//   client-facing "time to refresh" email. Callers pass the live
//   `services` array in and resolveRebookWeeks() prefers a service's
//   configured window over the hardcoded STYLE_PATTERNS table below,
//   so this card and that email can't recommend two different dates
//   for the same style. A service with no configured window (or an
//   appointment with no service link — a walk-in, an older record)
//   falls back to matching the style name against STYLE_PATTERNS.

// Match against the lower-cased trimmed style string. Order matters:
// more specific phrases ("loc maintenance") must be tested before
// generic ones ("locs").
const STYLE_PATTERNS: { match: RegExp; weeks: number; label: string }[] = [
  { match: /knotless/i,                               weeks: 6, label: "Knotless braids" },
  { match: /\bbox\s*braids?\b/i,                      weeks: 6, label: "Box braids" },
  { match: /fulani/i,                                 weeks: 5, label: "Fulani braids" },
  { match: /cornrow/i,                                weeks: 3, label: "Cornrows" },
  { match: /feed[\s-]?in/i,                           weeks: 3, label: "Feed-in braids" },
  { match: /stitch/i,                                 weeks: 3, label: "Stitch braids" },
  { match: /twist/i,                                  weeks: 6, label: "Twists" },
  { match: /loc\s*maintenance|retwist|loc[s]?\s*re/i, weeks: 4, label: "Loc maintenance" },
  { match: /sew[\s-]?in/i,                            weeks: 6, label: "Sew-in" },
  { match: /wig\s*install|wig\b/i,                    weeks: 3, label: "Wig install" },
];

const DEFAULT_REBOOK_WEEKS = 5;

/**
 * Recommended weeks until next appointment for a given style string.
 * Returns DEFAULT_REBOOK_WEEKS for empty/unknown styles. Pure — safe
 * to call inside render.
 */
export const recommendedRebookWeeks = (style: string | null | undefined): number => {
  if (!style) return DEFAULT_REBOOK_WEEKS;
  const trimmed = String(style).trim();
  if (!trimmed) return DEFAULT_REBOOK_WEEKS;
  for (const p of STYLE_PATTERNS) {
    if (p.match.test(trimmed)) return p.weeks;
  }
  return DEFAULT_REBOOK_WEEKS;
};

/**
 * Same question as recommendedRebookWeeks, but a stylist-configured
 * rebook_after_weeks on the appointment's service wins when it's set —
 * the exact number the automated email nudge (process_rebook_nudges)
 * already sends on. Without that, this is identical to
 * recommendedRebookWeeks(style). Keeping both means every surface that
 * shows a rebooking window (this in-app card, the client insight card,
 * the notification bell, and the automated email) can agree once a
 * stylist configures a service, while still working out of the box
 * from style names for services nobody has configured yet.
 */
const resolveRebookWeeks = (
  style: string | null | undefined,
  serviceId: string | null | undefined,
  servicesById: Map<string, ServiceLike>,
): number => {
  if (serviceId) {
    const weeks = servicesById.get(String(serviceId))?.rebook_after_weeks;
    if (typeof weeks === "number" && weeks > 0) return weeks;
  }
  return recommendedRebookWeeks(style);
};

export type RebookingUrgency = "low" | "medium" | "high";

export type RebookingOpportunity = {
  client_id: string;
  client_name: string;
  client_phone: string | null;
  client_email: string | null;
  last_style: string | null;
  last_appointment_date: string;        // ISO yyyy-mm-dd
  recommended_rebook_date: string;      // ISO yyyy-mm-dd
  days_overdue: number;                 // negative when due-soon, 0 = today, positive = overdue
  estimated_value: number | null;
  reason: string;
  urgency: RebookingUrgency;
};

// Minimal shapes we read from. Both `appointments` and `clients` have
// a lot of other fields in storage; we only need these.
type ApptLike = {
  id?: string;
  clientId?: string;
  date?: string;            // yyyy-mm-dd
  status?: string;
  paymentStatus?: string;
  style?: string;
  totalPrice?: number | string;
  serviceId?: string | null;
};

// A stylist-configured rebook window (Settings → Services), the same
// field the automated rebook_after_weeks email nudge already reads
// (see process_rebook_nudges in supabase/migrations). Optional — most
// callers pass the live `services` array; tests and any caller with no
// services handy simply fall back to the style-name table below.
type ServiceLike = {
  id?: string;
  rebook_after_weeks?: number | null;
};

const buildServicesById = (services: ServiceLike[]): Map<string, ServiceLike> => {
  const map = new Map<string, ServiceLike>();
  for (const s of services) {
    if (s && s.id != null) map.set(String(s.id), s);
  }
  return map;
};

type ClientLike = {
  id?: string;
  name?: string;
  phone?: string;
  email?: string;
  // Rebooking reminder controls, stored on the client record:
  //   - rebookingOptOut: stop reminders indefinitely (a client on an
  //     open-ended break, or a test/junk record).
  //   - rebookingSnoozedUntil: hide until this date (yyyy-mm-dd), then the
  //     client flows back into the list automatically.
  // Both are cleared by resuming reminders from the client's profile.
  rebookingOptOut?: boolean;
  rebookingSnoozedUntil?: string | null;
};

const isCompleted = (a: ApptLike): boolean =>
  a.status === "completed" || a.paymentStatus === "paid";

/**
 * Is this client currently muted from rebooking reminders? True when
 * they've opted out, or when an active snooze hasn't elapsed yet.
 */
export const isRebookingMuted = (
  client: { rebookingOptOut?: boolean; rebookingSnoozedUntil?: string | null } | null | undefined,
  todayIso: string,
): boolean => {
  if (!client) return false;
  if (client.rebookingOptOut === true) return true;
  const until = client.rebookingSnoozedUntil;
  return typeof until === "string" && until.length > 0 && until > todayIso;
};

/** The snooze-until date N weeks from today (yyyy-mm-dd). */
export const rebookingSnoozeUntil = (todayIso: string, weeks: number): string =>
  addDaysISO(todayIso, Math.max(1, Math.round(weeks)) * 7);

const parsePrice = (v: unknown): number => {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const addDaysISO = (iso: string, days: number): string => {
  const d = new Date(iso + "T00:00:00");
  if (!Number.isFinite(d.getTime())) return iso;
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const daysBetweenISO = (a: string, b: string): number => {
  if (!a || !b) return 0;
  const da = new Date(a + "T00:00:00").getTime();
  const db = new Date(b + "T00:00:00").getTime();
  if (!Number.isFinite(da) || !Number.isFinite(db)) return 0;
  return Math.round((db - da) / 86400000);
};

const urgencyFor = (daysOverdue: number): RebookingUrgency => {
  // daysOverdue < 0  → due in the future (within window)
  // daysOverdue 0..7 → due/just overdue
  // daysOverdue 8..21 → medium
  // daysOverdue >= 22 → high
  if (daysOverdue >= 22) return "high";
  if (daysOverdue >= 8) return "medium";
  return "low"; // catches the "due within 7 days OR 1-7 days overdue" band
};

const reasonFor = (
  daysOverdue: number,
  styleLabel: string | null,
): string => {
  const styleBit = styleLabel ? ` ${styleLabel.toLowerCase()}` : "";
  if (daysOverdue >= 22) return `Significantly overdue for${styleBit || " a refresh"}`;
  if (daysOverdue >= 8) return `Overdue for${styleBit || " a refresh"}`;
  if (daysOverdue >= 1) return `Just past due for${styleBit || " a refresh"}`;
  if (daysOverdue === 0) return `Due today for${styleBit || " a refresh"}`;
  return `Due in ${Math.abs(daysOverdue)} day${Math.abs(daysOverdue) === 1 ? "" : "s"}`;
};

const styleDisplayLabel = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  for (const p of STYLE_PATTERNS) {
    if (p.match.test(trimmed)) return p.label;
  }
  return trimmed;
};

/**
 * Compute rebooking opportunities for a given roster of clients +
 * their appointment history.
 *
 * Inclusion rules:
 *   - client has at least one completed appointment
 *   - client does NOT have a future appointment that's not cancelled
 *   - now >= (last_completed_date + recommended_window) - 7 days
 *     (we surface "due within 7 days" too, marked low urgency)
 *
 * Returns sorted by urgency (high first), then days_overdue desc,
 * then last_appointment_date asc.
 */
export const computeRebookingOpportunities = (
  clients: ClientLike[] = [],
  appointments: ApptLike[] = [],
  todayIso: string,
  services: ServiceLike[] = [],
): RebookingOpportunity[] => {
  if (!Array.isArray(clients) || !Array.isArray(appointments)) return [];
  const servicesById = buildServicesById(services);

  // Index appointments by clientId once. O(N) instead of O(N×M).
  const byClient = new Map<string, ApptLike[]>();
  for (const a of appointments) {
    if (!a || typeof a.date !== "string" || !a.clientId) continue;
    const arr = byClient.get(a.clientId);
    if (arr) arr.push(a);
    else byClient.set(a.clientId, [a]);
  }

  const out: RebookingOpportunity[] = [];

  for (const c of clients) {
    if (!c || !c.id) continue;
    // Snoozed or opted-out clients are hidden from the reminder list.
    if (isRebookingMuted(c, todayIso)) continue;
    const mine = byClient.get(c.id);
    if (!mine || mine.length === 0) continue;

    // Future non-cancelled appointment? Skip — already on the books.
    const hasFuture = mine.some(a =>
      typeof a.date === "string" &&
      a.date >= todayIso &&
      a.status !== "cancelled" &&
      a.status !== "canceled" &&
      a.status !== "completed",
    );
    if (hasFuture) continue;

    // Most recent completed appointment.
    const completed = mine
      .filter(isCompleted)
      .filter(a => typeof a.date === "string" && a.date <= todayIso);
    if (completed.length === 0) continue;
    completed.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const last = completed[0];
    const lastDate = last.date as string;

    const weeks = resolveRebookWeeks(last.style, last.serviceId, servicesById);
    const windowDays = weeks * 7;
    const recommendedRebookDate = addDaysISO(lastDate, windowDays);
    const daysOverdue = daysBetweenISO(recommendedRebookDate, todayIso);

    // Surface starting 7 days before the recommended date so stylists
    // can give early heads-up. Anything earlier than that isn't
    // actionable yet.
    if (daysOverdue < -7) continue;

    // Estimated value: most recent completed appointment's totalPrice,
    // falling back to the average across this client's completed
    // appointments. null if neither is available.
    let estimated_value: number | null = null;
    const lastPrice = parsePrice(last.totalPrice);
    if (lastPrice > 0) {
      estimated_value = Math.round(lastPrice * 100) / 100;
    } else {
      const prices = completed.map(a => parsePrice(a.totalPrice)).filter(n => n > 0);
      if (prices.length > 0) {
        const avg = prices.reduce((s, n) => s + n, 0) / prices.length;
        estimated_value = Math.round(avg * 100) / 100;
      }
    }

    const styleLabel = styleDisplayLabel(last.style);

    out.push({
      client_id: c.id,
      client_name: c.name || "Client",
      client_phone: c.phone || null,
      client_email: c.email || null,
      last_style: styleLabel,
      last_appointment_date: lastDate,
      recommended_rebook_date: recommendedRebookDate,
      days_overdue: daysOverdue,
      estimated_value,
      reason: reasonFor(daysOverdue, styleLabel),
      urgency: urgencyFor(daysOverdue),
    });
  }

  const urgencyRank: Record<RebookingUrgency, number> = { high: 0, medium: 1, low: 2 };
  out.sort((a, b) => {
    const u = urgencyRank[a.urgency] - urgencyRank[b.urgency];
    if (u !== 0) return u;
    if (a.days_overdue !== b.days_overdue) return b.days_overdue - a.days_overdue;
    return a.last_appointment_date.localeCompare(b.last_appointment_date);
  });

  return out;
};

/**
 * SMS/DM-friendly rebooking outreach. Used by the "Copy message"
 * button. Static template by request — no client-specific tone or
 * promotions; salons can edit before sending.
 */
export const buildRebookingMessage = (op: RebookingOpportunity): string => {
  const firstName = (op.client_name || "there").split(" ")[0] || op.client_name;
  const styleBit = op.last_style ? op.last_style.toLowerCase() : "your style";
  return `Hi ${firstName}, it’s time to refresh your ${styleBit}. I have availability coming up if you’d like to book your next appointment.`;
};

// Aggregate roll-up used by the dashboard card and the full page header.
export type RebookingSummary = {
  total: number;
  high: number;
  medium: number;
  low: number;
  estimated_returning_revenue: number;
};

export const summarizeOpportunities = (ops: RebookingOpportunity[]): RebookingSummary => {
  let high = 0, medium = 0, low = 0, revenue = 0;
  for (const o of ops) {
    if (o.urgency === "high") high += 1;
    else if (o.urgency === "medium") medium += 1;
    else low += 1;
    if (o.estimated_value) revenue += o.estimated_value;
  }
  return {
    total: ops.length,
    high,
    medium,
    low,
    estimated_returning_revenue: Math.round(revenue * 100) / 100,
  };
};

/**
 * Per-client status used by the small insight card on the client
 * profile. Returns null when the client has no completed appointment
 * history yet (so the card hides itself).
 */
export type ClientRebookingInsight = {
  last_appointment_date: string;
  last_style: string | null;
  recommended_rebook_date: string;
  status: "not_due" | "due_soon" | "overdue";
  days_overdue: number;
  estimated_value: number | null;
};

export const computeClientRebookingInsight = (
  clientId: string,
  appointments: ApptLike[],
  todayIso: string,
  services: ServiceLike[] = [],
): ClientRebookingInsight | null => {
  if (!clientId || !Array.isArray(appointments)) return null;

  const mine = appointments.filter(a => a && a.clientId === clientId);
  if (mine.length === 0) return null;

  const completed = mine
    .filter(isCompleted)
    .filter(a => typeof a.date === "string" && a.date <= todayIso);
  if (completed.length === 0) return null;
  completed.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const last = completed[0];
  const lastDate = last.date as string;

  const weeks = resolveRebookWeeks(last.style, last.serviceId, buildServicesById(services));
  const recommended = addDaysISO(lastDate, weeks * 7);
  const overdue = daysBetweenISO(recommended, todayIso);

  let status: ClientRebookingInsight["status"] = "not_due";
  if (overdue >= 8) status = "overdue";
  else if (overdue >= -7) status = "due_soon";

  let estimated_value: number | null = null;
  const lastPrice = parsePrice(last.totalPrice);
  if (lastPrice > 0) estimated_value = Math.round(lastPrice * 100) / 100;
  else {
    const prices = completed.map(a => parsePrice(a.totalPrice)).filter(n => n > 0);
    if (prices.length > 0) {
      const avg = prices.reduce((s, n) => s + n, 0) / prices.length;
      estimated_value = Math.round(avg * 100) / 100;
    }
  }

  return {
    last_appointment_date: lastDate,
    last_style: styleDisplayLabel(last.style),
    recommended_rebook_date: recommended,
    status,
    days_overdue: overdue,
    estimated_value,
  };
};
