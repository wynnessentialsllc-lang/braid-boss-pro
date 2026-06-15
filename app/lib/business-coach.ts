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
    pendingBalance: number;
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
      pendingBalance: rev.pendingBalance,
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
      pendingBalance: num(o?.revenue?.pendingBalance),
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
  if (r.pendingBalance > 0) lines.push(`Outstanding/unpaid balances: ${money(r.pendingBalance, c)}.`);
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
    "Today's numbers:",
    snapshotFacts(snap),
    "",
    "Write a short daily briefing:",
    "- headline: one upbeat, specific line about how things stand.",
    "- summary: 2-3 sentences interpreting the numbers in plain English.",
    "- actions: 2-3 concrete, high-leverage things to do today/this week, each tied to a number above (e.g. rebooking overdue clients, collecting outstanding balances, filling a quiet day). Name specific clients only if they appear in the briefing.",
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
