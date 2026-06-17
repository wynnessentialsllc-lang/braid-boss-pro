// Business-coach — the AI "daily briefing". A pure aggregator
// (buildCoachSnapshot) turns the stylist's clients + appointments into a
// compact set of real numbers; the model (in /api/business-coach) just
// narrates those numbers into a plain-English summary + 2-3 concrete
// actions. The model never sees raw records and never invents figures —
// it only rephrases the snapshot we compute here.
//
// Everything in this file is pure and unit-tested.

import {
  calculateRevenueAnalytics,
  calculateClientAnalytics,
  calculateAppointmentAnalytics,
} from "./analytics";
import {
  computeRebookingOpportunities,
  summarizeOpportunities,
  type RebookingOpportunity,
} from "./rebooking/rebooking-intelligence";

const CANCELLED = new Set(["cancelled", "canceled", "no_show", "no-show", "noshow"]);
const isCancelled = (a: any): boolean => CANCELLED.has(String(a?.status || "").toLowerCase());

const addDaysIso = (iso: string, days: number): string => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const firstNameOf = (name: string | null | undefined): string => {
  const n = (name || "").trim().split(/\s+/)[0] || "";
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : "A client";
};

const toNum = (v: unknown): number => {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};

// Split unpaid balances by whether the service has actually been rendered.
// Mirrors the app's own `paymentStatusOf` rule: a balance only counts as
// "earned/overdue" once the appointment is in the past (or marked
// completed) — because that's when the stylist has done the work. Future
// appointments carry a balance that isn't owed yet (payment is collected
// at/after the service), so the coach must never treat it as money to chase.
const classifyBalances = (
  appts: any[],
  todayIso: string,
): { earnedUnpaid: number; dueToday: number; upcoming: number } => {
  let earnedUnpaid = 0;
  let dueToday = 0;
  let upcoming = 0;
  for (const a of appts) {
    if (!a || isCancelled(a) || a?.paymentStatus === "paid") continue;
    const bal = toNum(a?.balanceDue);
    if (!(bal > 0)) continue;
    const date = typeof a?.date === "string" ? a.date : "";
    const completed = a?.status === "completed";
    if (completed || (date && date < todayIso)) earnedUnpaid += bal;
    else if (date === todayIso) dueToday += bal;
    else if (date && date > todayIso) upcoming += bal;
    // No-date / orphaned rows carry no meaningful balance — skip them.
  }
  return { earnedUnpaid, dueToday, upcoming };
};

// ---- snapshot ----------------------------------------------------------

export interface CoachOpportunity {
  firstName: string;
  style: string | null;
  daysOverdue: number;
  value: number;
}

export interface CoachSnapshot {
  currency: string;
  revenue: {
    thisMonth: number;
    lastMonth: number;
    momChangePct: number | null;
    averageTicket: number;
    // Unpaid balances split by whether the service has been rendered yet.
    // This is a service business — money is earned when the service is
    // performed, so only `earnedUnpaid` (service already completed) is
    // truly owed. `dueToday` is expected at the chair today, and
    // `upcoming` is not yet earned (the appointment hasn't happened).
    balances: {
      earnedUnpaid: number;
      dueToday: number;
      upcoming: number;
    };
    topStyle: string | null;
  };
  appts: {
    todayCount: number;
    next7Count: number;
    busiestDay: string | null;
  };
  clients: {
    total: number;
    newThisMonth: number;
    repeatRatePct: number;
    vip: number;
    atRisk: number;
    inactive: number;
  };
  rebooking: {
    due: number;
    high: number;
    estimatedRevenue: number;
  };
  topOpportunities: CoachOpportunity[];
}

export const buildCoachSnapshot = (
  clients: any[],
  appointments: any[],
  todayIso: string,
  currency = "USD",
  vipThreshold = 800,
): CoachSnapshot => {
  const appts = Array.isArray(appointments) ? appointments : [];
  const rev = calculateRevenueAnalytics(appts, todayIso);
  const cli = calculateClientAnalytics(clients, appts, todayIso, vipThreshold);
  const appt = calculateAppointmentAnalytics(appts, todayIso);

  const weekEnd = addDaysIso(todayIso, 7);
  let todayCount = 0;
  let next7Count = 0;
  for (const a of appts) {
    const date = a?.date;
    if (!date || isCancelled(a) || a?.status === "completed") continue;
    if (date === todayIso) todayCount += 1;
    if (date >= todayIso && date < weekEnd) next7Count += 1;
  }

  const balances = classifyBalances(appts, todayIso);

  const ops = computeRebookingOpportunities(clients, appts, todayIso);
  const sum = summarizeOpportunities(ops);
  const topOpportunities: CoachOpportunity[] = ops.slice(0, 3).map((o: RebookingOpportunity) => ({
    firstName: firstNameOf(o.client_name),
    style: o.last_style || null,
    daysOverdue: o.days_overdue,
    value: o.estimated_value || 0,
  }));

  return {
    currency,
    revenue: {
      thisMonth: rev.thisMonth,
      lastMonth: rev.lastMonth,
      momChangePct: rev.momChangePct,
      averageTicket: rev.averageTicket,
      balances: {
        earnedUnpaid: Math.round((balances.earnedUnpaid + Number.EPSILON) * 100) / 100,
        dueToday: Math.round((balances.dueToday + Number.EPSILON) * 100) / 100,
        upcoming: Math.round((balances.upcoming + Number.EPSILON) * 100) / 100,
      },
      topStyle: rev.topStyle?.name || null,
    },
    appts: {
      todayCount,
      next7Count,
      busiestDay: appt.busiestDow?.name || null,
    },
    clients: {
      total: cli.total,
      newThisMonth: cli.newThisMonth,
      repeatRatePct: cli.repeatRatePct,
      vip: cli.vipCount,
      atRisk: cli.atRiskCount,
      inactive: cli.inactiveCount,
    },
    rebooking: {
      due: sum.total,
      high: sum.high,
      estimatedRevenue: sum.estimated_returning_revenue,
    },
    topOpportunities,
  };
};

// ---- AI briefing -------------------------------------------------------

export interface CoachAction {
  title: string;
  detail: string;
}
export interface CoachBriefing {
  headline: string;
  summary: string;
  actions: CoachAction[];
  encouragement: string;
}

export interface CoachContext {
  businessName: string;
  ownerFirstName?: string | null;
}

const money = (n: number, currency: string): string => {
  const sym = currency === "USD" || currency === "CAD" || currency === "AUD" ? "$"
    : currency === "GBP" ? "£" : currency === "EUR" ? "€" : "";
  return `${sym}${Math.round(Number(n) || 0).toLocaleString("en-US")}`;
};

/** Defensively coerce a snapshot that arrived over the wire. */
export const cleanSnapshot = (raw: unknown): CoachSnapshot => {
  const o = (raw ?? {}) as any;
  const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const numOrNull = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const s = (v: unknown, max = 60): string | null =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
  return {
    currency: s(o.currency, 8) || "USD",
    revenue: {
      thisMonth: num(o?.revenue?.thisMonth),
      lastMonth: num(o?.revenue?.lastMonth),
      momChangePct: numOrNull(o?.revenue?.momChangePct),
      averageTicket: num(o?.revenue?.averageTicket),
      balances: {
        earnedUnpaid: num(o?.revenue?.balances?.earnedUnpaid),
        dueToday: num(o?.revenue?.balances?.dueToday),
        upcoming: num(o?.revenue?.balances?.upcoming),
      },
      topStyle: s(o?.revenue?.topStyle),
    },
    appts: {
      todayCount: num(o?.appts?.todayCount),
      next7Count: num(o?.appts?.next7Count),
      busiestDay: s(o?.appts?.busiestDay),
    },
    clients: {
      total: num(o?.clients?.total),
      newThisMonth: num(o?.clients?.newThisMonth),
      repeatRatePct: num(o?.clients?.repeatRatePct),
      vip: num(o?.clients?.vip),
      atRisk: num(o?.clients?.atRisk),
      inactive: num(o?.clients?.inactive),
    },
    rebooking: {
      due: num(o?.rebooking?.due),
      high: num(o?.rebooking?.high),
      estimatedRevenue: num(o?.rebooking?.estimatedRevenue),
    },
    topOpportunities: Array.isArray(o?.topOpportunities)
      ? o.topOpportunities.slice(0, 5).map((t: any) => ({
          firstName: s(t?.firstName, 40) || "A client",
          style: s(t?.style),
          daysOverdue: num(t?.daysOverdue),
          value: num(t?.value),
        }))
      : [],
  };
};

/** Render the snapshot as the factual block the model must work from. */
export const snapshotFacts = (snap: CoachSnapshot): string => {
  const c = snap.currency;
  const r = snap.revenue;
  const lines: string[] = [];
  lines.push(
    `Revenue this month: ${money(r.thisMonth, c)} (last month: ${money(r.lastMonth, c)}${
      r.momChangePct != null ? `, ${r.momChangePct >= 0 ? "+" : ""}${r.momChangePct}% MoM` : ""
    }).`,
  );
  lines.push(`Average ticket: ${money(r.averageTicket, c)}.`);
  // Balances are split by whether the work is done. Only earnedUnpaid is
  // genuinely owed; dueToday/upcoming have not been earned yet.
  if (r.balances.earnedUnpaid > 0) {
    lines.push(
      `Already-earned unpaid balances (service ALREADY completed, money genuinely owed): ${money(r.balances.earnedUnpaid, c)}.`,
    );
  }
  if (r.balances.dueToday > 0) {
    lines.push(
      `Balance expected at today's appointments (collect at the chair today): ${money(r.balances.dueToday, c)}.`,
    );
  }
  if (r.balances.upcoming > 0) {
    lines.push(
      `Upcoming balances on future appointments (NOT yet earned — paid at the time of service, nothing to chase): ${money(r.balances.upcoming, c)}.`,
    );
  }
  if (r.topStyle) lines.push(`Top-earning style this month: ${r.topStyle}.`);
  lines.push(`Appointments today: ${snap.appts.todayCount}; next 7 days: ${snap.appts.next7Count}.`);
  if (snap.appts.busiestDay) lines.push(`Busiest day of week: ${snap.appts.busiestDay}.`);
  lines.push(
    `Clients: ${snap.clients.total} total, ${snap.clients.newThisMonth} new this month, ${snap.clients.repeatRatePct}% repeat rate, ${snap.clients.vip} VIP.`,
  );
  if (snap.clients.atRisk > 0) lines.push(`At-risk (60-90 days since last visit): ${snap.clients.atRisk}.`);
  if (snap.clients.inactive > 0) lines.push(`Inactive (90+ days): ${snap.clients.inactive}.`);
  lines.push(
    `Rebooking: ${snap.rebooking.due} clients due/overdue (${snap.rebooking.high} high urgency), ~${money(snap.rebooking.estimatedRevenue, c)} if they all return.`,
  );
  if (snap.topOpportunities.length) {
    lines.push(
      "Top clients to win back: " +
        snap.topOpportunities
          .map((t) => `${t.firstName}${t.style ? ` (${t.style})` : ""}, ${t.daysOverdue}d overdue, ~${money(t.value, c)}`)
          .join("; ") +
        ".",
    );
  }
  return lines.join("\n");
};

export const buildCoachSystem = (snap: CoachSnapshot, ctx: CoachContext): string => {
  const who = ctx.ownerFirstName?.trim() ? ` The owner's name is ${ctx.ownerFirstName.trim()}.` : "";
  return [
    `You are a sharp, encouraging business coach for ${ctx.businessName || "a hair-braiding business"}.${who}`,
    "Use ONLY the numbers in the briefing below — never invent figures, clients, or trends not present.",
    "",
    "This is a service business: clients pay in exchange for services rendered, and payment is usually collected at or after the appointment — rarely before. Respect this when talking about money:",
    "- ONLY 'already-earned unpaid balances' (service already completed) are genuinely owed. These are the only balances you may tell the owner to follow up on or collect.",
    "- 'Balance expected at today's appointments' is collected at the chair today — you may remind the owner to collect it when the client is in the seat, but it is not a debt to chase.",
    "- 'Upcoming balances on future appointments' are NOT earned yet because the service hasn't happened. NEVER describe these as money owed, already-earned, or revenue waiting to be collected, and never tell the owner to chase clients for them.",
    "- If there are no already-earned unpaid balances, do not invent a 'collect your outstanding balances' action.",
    "",
    "Today's numbers:",
    snapshotFacts(snap),
    "",
    "Write a short daily briefing:",
    "- headline: one upbeat, specific line about how things stand.",
    "- summary: 2-3 sentences interpreting the numbers in plain English.",
    "- actions: 2-3 concrete, high-leverage things to do today/this week, each tied to a number above (e.g. rebooking overdue clients, following up on already-earned unpaid balances, collecting today's balances at the chair, filling a quiet day). Name specific clients only if they appear in the briefing.",
    "- encouragement: one warm closing line.",
    "Be concrete and motivating, not generic. No fake statistics.",
  ].join("\n");
};

export const COACH_TOOL_NAME = "daily_briefing";

export const coachTool = () => ({
  name: COACH_TOOL_NAME,
  description: "Return the stylist's daily business briefing.",
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    required: ["headline", "summary", "actions", "encouragement"],
    properties: {
      headline: { type: "string", description: "One upbeat, specific line." },
      summary: { type: "string", description: "2-3 sentences interpreting the numbers." },
      actions: {
        type: "array",
        description: "2-3 concrete actions.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "detail"],
          properties: {
            title: { type: "string", description: "Short action label." },
            detail: { type: "string", description: "One sentence on why / how, tied to a number." },
          },
        },
      },
      encouragement: { type: "string", description: "One warm closing line." },
    },
  },
});

const str = (v: unknown, max: number): string => (typeof v === "string" ? v : "").trim().slice(0, max);

export const parseCoachBriefing = (input: unknown): CoachBriefing | null => {
  const o = (input ?? {}) as Record<string, unknown>;
  const headline = str(o.headline, 160);
  const summary = str(o.summary, 600);
  if (!headline && !summary) return null;
  const rawActions = Array.isArray(o.actions) ? o.actions : [];
  const actions: CoachAction[] = [];
  for (const a of rawActions) {
    const obj = (a ?? {}) as Record<string, unknown>;
    const title = str(obj.title, 80);
    if (!title) continue;
    actions.push({ title, detail: str(obj.detail, 240) });
    if (actions.length >= 4) break;
  }
  return {
    headline: headline || "Here's your day at a glance",
    summary,
    actions,
    encouragement: str(o.encouragement, 200),
  };
};
