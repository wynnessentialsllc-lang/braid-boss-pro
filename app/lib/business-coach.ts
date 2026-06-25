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

// ---- calendar / wellbeing ---------------------------------------------
// Braiding is physically punishing and long-form — a stylist can quietly
// book themselves into weeks of back-to-back all-day sessions with no day
// off. The coach needs a day-by-day read of the calendar so it can speak
// to workload and rest, not just revenue.

const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const dowShort = (iso: string): string => {
  const d = new Date(iso + "T00:00:00");
  return DOW_SHORT[d.getDay()] || "";
};
const apptHours = (a: any): number => {
  const h = toNum(a?.durationHours ?? a?.duration_hours ?? a?.duration);
  return h > 0 ? h : 0;
};
// Personal events / blocked time live in the appointments array but aren't
// real bookings. A day with one of these (and no clients) is the stylist
// deliberately protecting time off.
const isRealBooking = (a: any): boolean => !a?.kind || a.kind === "appointment";
const isTimeOffEntry = (a: any): boolean => a?.kind === "personal" || a?.kind === "blocked";

export interface CoachDayLoad {
  date: string;
  dow: string;
  apptCount: number;
  hours: number;
  isOff: boolean;       // no client bookings that day
  hasTimeOff: boolean;  // a personal / blocked entry is on the calendar
}

export interface CoachWorkload {
  todayCount: number;
  todayHours: number;
  next7: CoachDayLoad[];
  daysOffNext7: number;
  longestStretch: number;        // longest run of back-to-back working days near today
  heaviestDayHours: number;
  timeOffScheduledNext7: boolean;
}

const computeWorkload = (appts: any[], todayIso: string): CoachWorkload => {
  const byDate: Record<string, { count: number; hours: number; timeOff: boolean }> = {};
  for (const a of appts) {
    if (!a || isCancelled(a)) continue;
    const date = typeof a?.date === "string" ? a.date : "";
    if (!date) continue;
    const slot = (byDate[date] ||= { count: 0, hours: 0, timeOff: false });
    if (isTimeOffEntry(a)) { slot.timeOff = true; continue; }
    if (!isRealBooking(a)) continue;
    slot.count += 1;
    slot.hours += apptHours(a);
  }

  const round1 = (n: number) => Math.round((n + Number.EPSILON) * 10) / 10;
  const next7: CoachDayLoad[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDaysIso(todayIso, i);
    const slot = byDate[date];
    next7.push({
      date,
      dow: dowShort(date),
      apptCount: slot?.count || 0,
      hours: round1(slot?.hours || 0),
      isOff: !slot || slot.count === 0,
      hasTimeOff: !!slot?.timeOff,
    });
  }

  // Longest run of consecutive working days in a window spanning the past
  // week through the next week — the real burnout signal is a long unbroken
  // stretch with no day off, which a single-week view can miss.
  let longestStretch = 0;
  let run = 0;
  for (let i = -7; i <= 7; i++) {
    const working = (byDate[addDaysIso(todayIso, i)]?.count || 0) > 0;
    if (working) { run += 1; longestStretch = Math.max(longestStretch, run); }
    else run = 0;
  }

  const todaySlot = byDate[todayIso];
  return {
    todayCount: todaySlot?.count || 0,
    todayHours: round1(todaySlot?.hours || 0),
    next7,
    daysOffNext7: next7.filter(d => d.isOff).length,
    longestStretch,
    heaviestDayHours: round1(next7.reduce((m, d) => Math.max(m, d.hours), 0)),
    timeOffScheduledNext7: next7.some(d => d.hasTimeOff),
  };
};

// ---- monthly goal + period --------------------------------------------

export interface CoachGoal {
  amount: number | null;        // saved monthly revenue goal (null = not set)
  revenueThisMonth: number;     // progress so far this month
  remaining: number;            // amount still to earn (0 if met / no goal)
  progressPct: number | null;   // 0-100, null when no goal is set
}

export interface CoachPeriod {
  isTopOfMonth: boolean;        // within the first days of the month
  monthLabel: string;           // e.g. "June"
  dayOfMonth: number;
  daysLeftInMonth: number;
}

const buildGoal = (monthlyGoal: number | null, revenueThisMonth: number): CoachGoal => {
  const amount =
    monthlyGoal != null && Number.isFinite(monthlyGoal) && monthlyGoal > 0
      ? Math.round(monthlyGoal)
      : null;
  const rev = Math.round(revenueThisMonth);
  return {
    amount,
    revenueThisMonth: rev,
    remaining: amount != null ? Math.max(0, amount - rev) : 0,
    progressPct: amount != null && amount > 0 ? Math.round((rev / amount) * 100) : null,
  };
};

const buildPeriod = (todayIso: string): CoachPeriod => {
  const d = new Date(todayIso + "T00:00:00");
  const dayOfMonth = d.getDate();
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return {
    isTopOfMonth: dayOfMonth <= 5,
    monthLabel: MONTHS[d.getMonth()] || "",
    dayOfMonth,
    daysLeftInMonth: Math.max(0, daysInMonth - dayOfMonth),
  };
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
    // Forward-looking, MONTH-scoped pipeline: appointments still on the
    // books from today through the end of THIS calendar month, and their
    // expected net value (realized at the chair when each service
    // happens). Pairs with the monthly goal so the coach can talk about
    // the month without conflating it with the all-future balance total.
    bookedThisMonthCount: number;
    bookedThisMonthValue: number;
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
  workload: CoachWorkload;
  goal: CoachGoal;
  period: CoachPeriod;
}

export const buildCoachSnapshot = (
  clients: any[],
  appointments: any[],
  todayIso: string,
  currency = "USD",
  vipThreshold = 800,
  monthlyGoal: number | null = null,
  shopSalesThisMonth = 0,
): CoachSnapshot => {
  const appts = Array.isArray(appointments) ? appointments : [];
  const rev = calculateRevenueAnalytics(appts, todayIso);
  const cli = calculateClientAnalytics(clients, appts, todayIso, vipThreshold);
  const appt = calculateAppointmentAnalytics(appts, todayIso);

  const weekEnd = addDaysIso(todayIso, 7);
  // Last calendar day of the current month (e.g. "2026-06-30").
  const [gy, gm] = todayIso.split("-").map(Number);
  const monthEndIso = `${gy}-${String(gm).padStart(2, "0")}-${String(
    new Date(gy, gm, 0).getDate(),
  ).padStart(2, "0")}`;
  let todayCount = 0;
  let next7Count = 0;
  let bookedThisMonthCount = 0;
  let bookedThisMonthValue = 0;
  for (const a of appts) {
    const date = a?.date;
    if (!date || isCancelled(a) || a?.status === "completed") continue;
    if (date === todayIso) todayCount += 1;
    if (date >= todayIso && date < weekEnd) next7Count += 1;
    // Month-scoped pipeline: real bookings still to come this month that
    // haven't been collected yet. Net of any discount; excludes
    // personal/blocked time and already-paid rows (those are earned).
    if (
      isRealBooking(a) &&
      a?.paymentStatus !== "paid" &&
      date >= todayIso &&
      date <= monthEndIso
    ) {
      bookedThisMonthCount += 1;
      bookedThisMonthValue += Math.max(
        0,
        toNum(a?.totalPrice) - toNum(a?.discountAmount),
      );
    }
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
      bookedThisMonthCount,
      bookedThisMonthValue: Math.round((bookedThisMonthValue + Number.EPSILON) * 100) / 100,
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
    workload: computeWorkload(appts, todayIso),
    // Goal progress counts total business income (service + shop sales),
    // matching the Monthly Goal card on the dashboard so the briefing and
    // the card can never disagree.
    goal: buildGoal(monthlyGoal, rev.thisMonth + (Number.isFinite(shopSalesThisMonth) ? shopSalesThisMonth : 0)),
    period: buildPeriod(todayIso),
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
  wellbeing: string;
  monthlyCheckIn: string;
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
      bookedThisMonthCount: num(o?.appts?.bookedThisMonthCount),
      bookedThisMonthValue: num(o?.appts?.bookedThisMonthValue),
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
    workload: {
      todayCount: num(o?.workload?.todayCount),
      todayHours: num(o?.workload?.todayHours),
      next7: Array.isArray(o?.workload?.next7)
        ? o.workload.next7.slice(0, 7).map((d: any) => ({
            date: s(d?.date, 10) || "",
            dow: s(d?.dow, 3) || "",
            apptCount: num(d?.apptCount),
            hours: num(d?.hours),
            isOff: !!d?.isOff,
            hasTimeOff: !!d?.hasTimeOff,
          }))
        : [],
      daysOffNext7: num(o?.workload?.daysOffNext7),
      longestStretch: num(o?.workload?.longestStretch),
      heaviestDayHours: num(o?.workload?.heaviestDayHours),
      timeOffScheduledNext7: !!o?.workload?.timeOffScheduledNext7,
    },
    goal: {
      // Preserve an unset goal as null — numOrNull would coerce JSON null to
      // 0 (Number(null) === 0), which would look like a real $0 goal.
      amount: o?.goal?.amount == null ? null : numOrNull(o.goal.amount),
      revenueThisMonth: num(o?.goal?.revenueThisMonth),
      remaining: num(o?.goal?.remaining),
      progressPct: o?.goal?.progressPct == null ? null : numOrNull(o.goal.progressPct),
    },
    period: {
      isTopOfMonth: !!o?.period?.isTopOfMonth,
      monthLabel: s(o?.period?.monthLabel, 12) || "",
      dayOfMonth: num(o?.period?.dayOfMonth),
      daysLeftInMonth: num(o?.period?.daysLeftInMonth),
    },
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
      `Upcoming balances across ALL future appointments combined (every future date, NOT just this week or this month; NOT yet earned — paid at the time of service, nothing to chase): ${money(r.balances.upcoming, c)}. Do NOT describe this total as a weekly or monthly figure.`,
    );
  }
  if (r.topStyle) lines.push(`Top-earning style this month: ${r.topStyle}.`);
  lines.push(`Appointments today: ${snap.appts.todayCount}; next 7 days: ${snap.appts.next7Count}.`);
  // Month-scoped pipeline — the correct number to cite when talking about
  // "this month". Distinct from the all-future upcoming-balances total.
  if (snap.appts.bookedThisMonthCount > 0) {
    lines.push(
      `Still booked THIS month (today through end of ${snap.period.monthLabel}): ${snap.appts.bookedThisMonthCount} appointment${snap.appts.bookedThisMonthCount === 1 ? "" : "s"}, expected value ~${money(snap.appts.bookedThisMonthValue, c)} (realized at the chair as each service happens). This — not the all-future upcoming-balances total — is the figure to use for what's coming THIS month.`,
    );
  } else {
    lines.push(`Still booked THIS month (today through end of ${snap.period.monthLabel}): none on the books yet.`);
  }
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

  // ---- Calendar / wellbeing (day-by-day load over the next 7 days) ----
  const w = snap.workload;
  const dayBits = w.next7.map((d) => {
    if (d.isOff) return `${d.dow}: OFF${d.hasTimeOff ? " (time blocked)" : ""}`;
    const hrs = d.hours > 0 ? `, ~${d.hours}h` : "";
    return `${d.dow}: ${d.apptCount} appt${d.apptCount === 1 ? "" : "s"}${hrs}`;
  });
  lines.push(`Calendar next 7 days — ${dayBits.join(" | ")}.`);
  lines.push(
    `Workload: ${w.todayCount} appointment${w.todayCount === 1 ? "" : "s"} today${
      w.todayHours > 0 ? ` (~${w.todayHours}h)` : ""
    }; ${w.daysOffNext7} day${w.daysOffNext7 === 1 ? "" : "s"} off in the next 7; longest back-to-back working stretch around now: ${w.longestStretch} day${w.longestStretch === 1 ? "" : "s"}; heaviest upcoming day ~${w.heaviestDayHours}h.${
      w.timeOffScheduledNext7 ? " Personal time off is on the calendar this week." : ""
    }${w.daysOffNext7 === 0 ? " NO full day off is scheduled in the next 7 days." : ""}`,
  );

  // ---- Monthly goal + progress ----
  const g = snap.goal;
  const p = snap.period;
  if (g.amount != null) {
    lines.push(
      `Monthly revenue goal: ${money(g.amount, c)}. Earned so far this month: ${money(g.revenueThisMonth, c)} (${g.progressPct}% of goal). Still to go: ${money(g.remaining, c)} with ${p.daysLeftInMonth} day${p.daysLeftInMonth === 1 ? "" : "s"} left in ${p.monthLabel}.`,
    );
  } else {
    lines.push(`Monthly revenue goal: not set yet for ${p.monthLabel}.`);
  }
  lines.push(
    `Date context: day ${p.dayOfMonth} of ${p.monthLabel}, ${p.daysLeftInMonth} days left.${
      p.isTopOfMonth ? " It is the TOP OF THE MONTH — time for the monthly goal check-in." : ""
    }`,
  );

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
    "- Timeframes must match: whenever you attach a money figure to a period (today / this week / this month), use a figure the briefing scopes to that SAME period. The 'upcoming balances across all future appointments' total spans every future date — NEVER present it as a weekly or monthly amount, and never glue it to a count like 'X appointments this week/month'. For what's coming this month, use the 'Still booked THIS month' value.",
    "",
    "Care about the person, not just the numbers. Braiding is long, physical work and stylists burn out fast — mentally, physically, and emotionally. Read the day-by-day calendar and speak to their wellbeing:",
    "- If they are working many days back-to-back (long stretch) or have NO day off scheduled in the next 7 days, gently name it and encourage them to protect a rest day or a break. Do not guilt them; be warm and protective.",
    "- If a day is especially heavy (long hours / many appointments), suggest practical recovery: hydration, stretching, a real lunch, spacing future bookings.",
    "- If they already have time off or a day off scheduled, affirm it — that's healthy.",
    "- Speak to mental and emotional wellbeing too, not only physical. A sustainable pace protects the business.",
    "",
    "Growing the book matters: when bookings are light, the calendar has gaps, or new clients this month are few, give at least one concrete strategy to attract NEW clientele — not just rebooking existing clients. Be specific and realistic for a solo braider (e.g. post a before/after of the top style on social with a booking link, a limited new-client offer, asking happy clients for a referral or a tagged photo, partnering with a local business, showing fresh availability). Tie it to a number above when you can.",
    "",
    "Monthly goal:",
    "- If a monthly revenue goal is set, hold them to it kindly: state progress, what's left, and a concrete pace to get there (e.g. how many bookings at their average ticket), using the days left in the month.",
    "- If it is the TOP OF THE MONTH (flagged in the facts), make the monthly check-in the centerpiece: reflect briefly on last month, and either celebrate/adjust the goal or — if no goal is set — warmly prompt them to set one and suggest a realistic target based on last month and their average ticket. Put this in the monthlyCheckIn field.",
    "- If it is NOT the top of the month, leave monthlyCheckIn empty.",
    "",
    "Today's numbers:",
    snapshotFacts(snap),
    "",
    "Write a short daily briefing:",
    "- headline: one upbeat, specific line about how things stand.",
    "- summary: 2-3 sentences interpreting the numbers in plain English.",
    "- actions: 2-3 concrete, high-leverage things to do today/this week, each tied to a number above (e.g. rebooking overdue clients, following up on already-earned unpaid balances, collecting today's balances at the chair, filling a quiet day, a new-client outreach move). Name specific clients only if they appear in the briefing.",
    "- wellbeing: one or two sentences on workload and rest, grounded in the calendar facts above. Always provide this.",
    "- monthlyCheckIn: ONLY at the top of the month — the goal reflection + advice described above. Otherwise leave it empty.",
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
    required: ["headline", "summary", "actions", "wellbeing", "monthlyCheckIn", "encouragement"],
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
      wellbeing: {
        type: "string",
        description:
          "1-2 sentences on workload and rest, grounded in the calendar facts (back-to-back stretch, days off, heavy days). Warm and protective, never guilt-inducing. Always provide this.",
      },
      monthlyCheckIn: {
        type: "string",
        description:
          "ONLY at the top of the month: reflect on last month and set/adjust or prompt the monthly revenue goal with concrete advice. Empty string otherwise.",
      },
      encouragement: { type: "string", description: "One warm closing line." },
    },
  },
});

// Normalize a model-supplied string to a length cap. When the text is
// longer than `max`, truncate on a word boundary and append an ellipsis
// so the UI never renders a half-word like "recharge you menta". Falls
// back to a hard cut only when there's no nearby space to break on.
const str = (v: unknown, max: number): string => {
  const s = (typeof v === "string" ? v : "").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return base.replace(/[\s,;:.!?\-—–]+$/, "") + "…";
};

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
    wellbeing: str(o.wellbeing, 600),
    monthlyCheckIn: str(o.monthlyCheckIn, 600),
    encouragement: str(o.encouragement, 200),
  };
};
