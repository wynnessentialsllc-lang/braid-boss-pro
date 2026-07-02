// Reports V1 — pure read-side aggregations over the existing local
// appointments / clients arrays. Same source of truth Dashboard reads,
// so the Reports screen can never disagree with the dashboard cards.
//
// All money helpers honour the discount_amount snapshot from PR #62
// (final ticket = totalPrice − discountAmount).
//
// Personal events and blocked time live in `appointments` but are
// filtered out of every aggregate so they can't poison revenue.

export type AppointmentLike = {
  id?: string;
  date?: string;            // YYYY-MM-DD
  time?: string;            // HH:mm
  status?: string;
  kind?: string;            // "appointment" | "personal" | "blocked"
  paymentStatus?: string | null;
  paymentDate?: string | null;   // YYYY-MM-DD — when payment was recorded
  totalPrice?: number | string;
  depositPaid?: number | string;
  discountAmount?: number | string;
  durationHours?: number | string;
  clientId?: string | null;
  clientName?: string | null;
  style?: string | null;
  // Deposit-by-source tracking. Manual appointments default to
  // depositRequired=false so they don't poison the "deposit due"
  // dashboard. Public-booking-link appointments inherit the service's
  // deposit_required setting at approval time.
  depositRequired?: boolean | null;
  source?: string | null;   // "public_booking" | "manual" | "owner_created" | ...
  cancelledAt?: string | null;
  cancelled_at?: string | null;
  canceledAt?: string | null;
  canceled_at?: string | null;
};

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const isCanceledStatus = (status: unknown): boolean => {
  const s = String(status || "").toLowerCase();
  return s === "cancelled" || s === "canceled";
};

const isCanceledAppointment = (a: AppointmentLike): boolean => {
  if (!a) return false;
  if (isCanceledStatus(a.status)) return true;
  // A cancellation timestamp from any source (server cancel route,
  // legacy migration, public-booking cancel) means the row is
  // cancelled even if the status field wasn't flipped cleanly. Without
  // this fallback, partially-updated rows kept inflating reports.
  if (a.cancelledAt || a.cancelled_at || a.canceledAt || a.canceled_at) return true;
  return false;
};

const isNoShowStatus = (status: unknown): boolean =>
  String(status || "").toLowerCase() === "no_show";

const isBillable = (a: AppointmentLike): boolean => {
  if (!a) return false;
  if (isCanceledAppointment(a) || isNoShowStatus(a.status)) return false;
  if (a.kind && a.kind !== "appointment") return false;
  return true;
};

export const ticketTotal = (a: AppointmentLike): number => {
  return Math.max(0, num(a.totalPrice) - num(a.discountAmount));
};

export const ticketBalance = (a: AppointmentLike): number => {
  return Math.max(0, ticketTotal(a) - num(a.depositPaid));
};

// CANONICAL "deposit actually collected" for an appointment.
// Every deposit display (Home card, deposit sheet total + rows,
// schedule card, edit sheet) must go through this so they can never
// disagree. Rules:
//   - refunded / denied deposits are NOT collected → 0
//   - cancelled-but-forfeited (not refunded) still counts
//   - never exceeds the ticket total (a full payment isn't a bigger
//     deposit), never the ticket total itself elsewhere
export const getDepositCollectedAmount = (a: AppointmentLike): number => {
  if (!a) return 0;
  const refunded =
    a.paymentStatus === "refunded" ||
    (a as any).depositDisposition === "refunded" ||
    (a as any).deposit_disposition === "refunded" ||
    num((a as any).refundAmount) > 0 ||
    num((a as any).deposit_refund_amount) > 0;
  if (refunded) return 0;
  const dep = num(a.depositPaid);
  if (dep <= 0) return 0;
  const ticket = ticketTotal(a);
  const v = ticket > 0 ? Math.min(dep, ticket) : dep;
  return Number(Math.max(0, v).toFixed(2));
};

// Single source of truth for "a (partial) deposit was collected
// within [weekStart..reference]". Shared by the Home "Deposits
// (week)" card AND the deposit detail sheet so the two can never
// show different numbers. Same-day deposits count; a payment that
// equals the full ticket is a full payment, not a deposit.
export const isDepositCollectedInRange = (
  a: AppointmentLike,
  weekStart: string,
  reference: string,
): boolean => {
  if (!isBillable(a)) return false;
  if (getDepositCollectedAmount(a) <= 0) return false;
  if (!a.paymentDate || !a.date) return false;
  if (a.paymentDate > a.date) return false;
  if (a.paymentDate < weekStart || a.paymentDate > reference) return false;
  const ticket = ticketTotal(a);
  const dep = num(a.depositPaid);
  return ticket <= 0 || dep < ticket; // partial → deposit, not full pay
};

// ---- Date helpers (local, no UTC drift) -------------------------------

const localDateISO = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const todayISO = (): string => localDateISO(new Date());

const startOfWeekISO = (iso: string): string => {
  const d = new Date(iso + "T00:00:00");
  const dow = d.getDay();
  d.setDate(d.getDate() - dow);
  return localDateISO(d);
};

const startOfMonthISO = (iso: string): string => {
  const d = new Date(iso + "T00:00:00");
  return localDateISO(new Date(d.getFullYear(), d.getMonth(), 1));
};

const addDaysISO = (iso: string, days: number): string => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return localDateISO(d);
};

const subDaysISO = (iso: string, days: number): string => addDaysISO(iso, -days);

// ---- Dashboard card aggregates ----------------------------------------

export type DashboardRevenue = {
  todayRevenue: number;
  weekRevenue: number;
  weekDeposits: number;
  pendingBalance: number;
  weekAppointmentCount: number;
  averageTicket30d: number;
  // Phase 1.x — added so the Home KPI grid can fill its empty cells.
  // monthExpected: every non-cancelled / non-no-show appointment in
  // the calendar month at its full ticket value (paid or not). It's
  // the studio's *projected* revenue for the month.
  // yearMade: only completed/paid appointments in the calendar year.
  // Counted at ticketTotal (post-discount), never deposit + balance
  // separately, so a paid booking can't double-count.
  monthExpected: number;
  // monthEarned: only completed/paid appointments in the calendar
  // month (month-to-date actual earnings). Same isPaidish rule as
  // yearMade, just month-bounded.
  monthEarned: number;
  yearMade: number;
  // yearHourlyRate: effective (blended) hourly rate over the calendar
  // year — total earned ÷ total hours worked, across completed/paid
  // appointments that have a recorded duration. Only bookings with
  // durationHours > 0 contribute to BOTH sides of the ratio, so a paid
  // booking with a missing duration can't inflate the rate. This is a
  // true weighted average (a long expensive style counts more than a
  // quick cheap one), which reflects real earning power better than
  // averaging each booking's rate equally.
  yearHourlyRate: number;
  // Supporting totals so the card / detail sheet can show the math
  // ("$X ÷ Y hrs") without recomputing.
  yearHoursWorked: number;
  yearRateEarnings: number;
};

// Filter helpers for the new month/year aggregates.
const monthBoundary = (iso: string): { start: string; end: string } => {
  const d = new Date(iso + "T00:00:00");
  const y = d.getFullYear();
  const m = d.getMonth();
  const start = localDateISO(new Date(y, m, 1));
  // First day of the next month — comparison uses < end, so this
  // covers every day of the current month inclusively.
  const end = localDateISO(new Date(y, m + 1, 1));
  return { start, end };
};

const yearBoundary = (iso: string): { start: string; end: string } => {
  const d = new Date(iso + "T00:00:00");
  const y = d.getFullYear();
  const start = localDateISO(new Date(y, 0, 1));
  const end = localDateISO(new Date(y + 1, 0, 1));
  return { start, end };
};

const isPaidish = (a: AppointmentLike): boolean =>
  a?.status === "completed" || a?.paymentStatus === "paid";

export const computeDashboardRevenue = (
  appointments: AppointmentLike[] | null | undefined,
  reference: string = todayISO(),
): DashboardRevenue => {
  const list = (appointments || []).filter(isBillable);
  const today = reference;
  const weekStart = startOfWeekISO(today);
  const thirtyDaysAgo = subDaysISO(today, 30);

  let todayRevenue = 0;
  let weekRevenue = 0;
  let weekDeposits = 0;
  let pendingBalance = 0;
  let weekAppointmentCount = 0;
  let last30Total = 0;
  let last30Count = 0;
  let monthExpected = 0;
  let monthEarned = 0;
  let yearMade = 0;
  let yearHoursWorked = 0;
  let yearRateEarnings = 0;

  const month = monthBoundary(today);
  const year = yearBoundary(today);

  for (const a of list) {
    const d = a.date || "";
    const t = ticketTotal(a);
    if (d === today) todayRevenue += t;
    if (d >= weekStart && d <= today) {
      weekRevenue += t;
      weekAppointmentCount += 1;
    }
    // Deposits = money collected at booking time (before the
    // appointment happens). Definition:
    //   1. paymentDate must be set, and
    //   2. paymentDate < appointment date (paid in advance), and
    //   3. paymentDate falls in this week (Sun..today).
    // Deposits collected this week — uses the SAME canonical
    // predicate + amount as the deposit detail sheet, so the Home
    // card and the sheet can never disagree.
    if (isDepositCollectedInRange(a, weekStart, today)) {
      weekDeposits += getDepositCollectedAmount(a);
    }
    if (d >= thirtyDaysAgo && d <= today) {
      last30Total += t;
      last30Count += 1;
    }
    pendingBalance += ticketBalance(a);
    // Month Expected — every non-cancelled / non-no-show booking in
    // the current calendar month, paid or not. isBillable() already
    // excludes cancelled and no_show (and personal/blocked kinds).
    if (d >= month.start && d < month.end) monthExpected += t;
    // Month Earned — completed/paid bookings in the current calendar
    // month (month-to-date actual earnings). Same isPaidish rule as
    // Year Made, just month-bounded.
    if (d >= month.start && d < month.end && isPaidish(a)) monthEarned += t;
    // Year Made — only completed or paid bookings in the current
    // calendar year. ticketTotal (not deposit + balance) so paid
    // bookings can't double-count.
    if (d >= year.start && d < year.end && isPaidish(a)) yearMade += t;
    // Average hourly rate (year) — only completed/paid bookings in the
    // calendar year that carry a real duration contribute. Numerator
    // and denominator are kept in lock-step (same appointments) so the
    // ratio is a genuine effective hourly rate.
    if (d >= year.start && d < year.end && isPaidish(a)) {
      const hrs = num(a.durationHours);
      if (hrs > 0) {
        yearHoursWorked += hrs;
        yearRateEarnings += t;
      }
    }
  }

  const averageTicket30d = last30Count > 0 ? last30Total / last30Count : 0;
  const yearHourlyRate = yearHoursWorked > 0 ? yearRateEarnings / yearHoursWorked : 0;

  return {
    todayRevenue: round2(todayRevenue),
    weekRevenue: round2(weekRevenue),
    weekDeposits: round2(weekDeposits),
    pendingBalance: round2(pendingBalance),
    weekAppointmentCount,
    averageTicket30d: round2(averageTicket30d),
    monthExpected: round2(monthExpected),
    monthEarned: round2(monthEarned),
    yearMade: round2(yearMade),
    yearHourlyRate: round2(yearHourlyRate),
    yearHoursWorked: round2(yearHoursWorked),
    yearRateEarnings: round2(yearRateEarnings),
  };
};

// ---- Reports screen aggregates ----------------------------------------

export type RevenuePoint = {
  label: string;
  iso: string;     // bucket key (week start or month start)
  revenue: number;
  appointmentCount: number;
};

export type RevenueGranularity = "week" | "month";

export const revenueByPeriod = (
  appointments: AppointmentLike[] | null | undefined,
  granularity: RevenueGranularity,
  reference: string = todayISO(),
  bucketCount: number = 8,
): RevenuePoint[] => {
  const list = (appointments || []).filter(isBillable);
  const buckets = new Map<string, { revenue: number; count: number }>();
  const today = reference;

  // Build the bucket keys we want to chart (most recent N), so empty
  // buckets still show a zero column instead of a gap.
  const keys: string[] = [];
  if (granularity === "week") {
    const startThisWeek = startOfWeekISO(today);
    for (let i = bucketCount - 1; i >= 0; i -= 1) {
      keys.push(addDaysISO(startThisWeek, -7 * i));
    }
  } else {
    const startThisMonth = startOfMonthISO(today);
    const d = new Date(startThisMonth + "T00:00:00");
    for (let i = bucketCount - 1; i >= 0; i -= 1) {
      const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
      keys.push(localDateISO(m));
    }
  }
  for (const k of keys) buckets.set(k, { revenue: 0, count: 0 });

  for (const a of list) {
    const d = a.date || "";
    if (!d) continue;
    const k = granularity === "week" ? startOfWeekISO(d) : startOfMonthISO(d);
    const b = buckets.get(k);
    if (!b) continue; // older than the chart window
    b.revenue += ticketTotal(a);
    b.count += 1;
  }

  return keys.map(k => {
    const b = buckets.get(k)!;
    return {
      iso: k,
      label: granularity === "week" ? formatWeekLabel(k) : formatMonthLabel(k),
      revenue: round2(b.revenue),
      appointmentCount: b.count,
    };
  });
};

export type StyleCount = {
  style: string;
  count: number;
  revenue: number;
};

export const topBookedStyles = (
  appointments: AppointmentLike[] | null | undefined,
  limit: number = 8,
): StyleCount[] => {
  const map = new Map<string, { count: number; revenue: number }>();
  for (const a of (appointments || [])) {
    if (!isBillable(a)) continue;
    const style = (a.style || "").trim();
    if (!style) continue;
    const cur = map.get(style) || { count: 0, revenue: 0 };
    cur.count += 1;
    cur.revenue += ticketTotal(a);
    map.set(style, cur);
  }
  return Array.from(map.entries())
    .map(([style, v]) => ({ style, count: v.count, revenue: round2(v.revenue) }))
    .sort((a, b) => b.count - a.count || b.revenue - a.revenue)
    .slice(0, limit);
};

export type RepeatClientStats = {
  totalClients: number;
  repeatClients: number;
  repeatRate: number;        // 0..1
  topClients: { clientId: string; clientName: string; count: number; revenue: number }[];
};

export const repeatClientStats = (
  appointments: AppointmentLike[] | null | undefined,
  limit: number = 5,
): RepeatClientStats => {
  const byClient = new Map<string, { name: string; count: number; revenue: number }>();
  for (const a of (appointments || [])) {
    if (!isBillable(a)) continue;
    const id = a.clientId || "";
    if (!id) continue;
    const cur = byClient.get(id) || { name: a.clientName || "Client", count: 0, revenue: 0 };
    cur.count += 1;
    cur.revenue += ticketTotal(a);
    if (a.clientName && cur.name !== a.clientName) cur.name = a.clientName;
    byClient.set(id, cur);
  }
  const totalClients = byClient.size;
  let repeatClients = 0;
  for (const v of byClient.values()) if (v.count >= 2) repeatClients += 1;
  const repeatRate = totalClients > 0 ? repeatClients / totalClients : 0;
  const topClients = Array.from(byClient.entries())
    .map(([clientId, v]) => ({ clientId, clientName: v.name, count: v.count, revenue: round2(v.revenue) }))
    .sort((a, b) => b.count - a.count || b.revenue - a.revenue)
    .slice(0, limit);
  return { totalClients, repeatClients, repeatRate, topClients };
};

// ---- Per-client autofill: most recent style + duration ----------------

export const lastBookingForClient = (
  appointments: AppointmentLike[] | null | undefined,
  clientId: string,
): AppointmentLike | null => {
  let best: AppointmentLike | null = null;
  let bestKey = "";
  for (const a of (appointments || [])) {
    if (a.clientId !== clientId) continue;
    if (a.kind && a.kind !== "appointment") continue;
    const k = (a.date || "") + (a.time || "");
    if (k > bestKey) { best = a; bestKey = k; }
  }
  return best;
};

// ---- internals --------------------------------------------------------

const round2 = (n: number) => Number(n.toFixed(2));

const formatWeekLabel = (iso: string): string => {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const formatMonthLabel = (iso: string): string => {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
};

// ---- KPI drill-down aggregates ----------------------------------------
//
// Each helper returns the rows that back a specific Dashboard KPI card,
// so the KpiDetailSheet can never disagree with the headline number.
// Filters reuse `isBillable` (drops cancelled / no_show / personal /
// blocked) and the existing month/year/week boundary helpers.

export const todayCompletedAppts = (
  appointments: AppointmentLike[] | null | undefined,
  reference: string = todayISO(),
): AppointmentLike[] => {
  return (appointments || [])
    .filter(isBillable)
    .filter(a => a.date === reference)
    .filter(a => a.status === "completed" || a.paymentStatus === "paid")
    .sort((a, b) => (a.time || "").localeCompare(b.time || ""));
};

export const weekRevenueAppts = (
  appointments: AppointmentLike[] | null | undefined,
  reference: string = todayISO(),
): AppointmentLike[] => {
  const ws = startOfWeekISO(reference);
  return (appointments || [])
    .filter(isBillable)
    .filter(a => a.date && a.date >= ws && a.date <= reference)
    .sort((a, b) => ((a.date || "") + (a.time || "")).localeCompare((b.date || "") + (b.time || "")));
};

export type WeekClientRow = {
  clientId: string;
  clientName: string;
  visitCount: number;
  totalSpend: number;
  appointments: AppointmentLike[];
};

export const weekClientRows = (
  appointments: AppointmentLike[] | null | undefined,
  reference: string = todayISO(),
): WeekClientRow[] => {
  // Full Sun–Sat window so already-booked appointments later in the
  // week (e.g. a Saturday on the books since Tuesday) count toward
  // the "clients this week" tile right away, not only after that day
  // arrives.
  const ws = startOfWeekISO(reference);
  const we = addDaysISO(ws, 6);
  const list = (appointments || [])
    .filter(isBillable)
    .filter(a => a.date && a.date >= ws && a.date <= we)
    .sort((a, b) => ((a.date || "") + (a.time || "")).localeCompare((b.date || "") + (b.time || "")));
  const byClient = new Map<string, WeekClientRow>();
  for (const a of list) {
    const id = a.clientId || "_unknown";
    const cur = byClient.get(id) || {
      clientId: id,
      clientName: a.clientName || "Walk-in",
      visitCount: 0,
      totalSpend: 0,
      appointments: [],
    };
    cur.visitCount += 1;
    cur.totalSpend += ticketTotal(a);
    cur.appointments.push(a);
    if (a.clientName && cur.clientName !== a.clientName) cur.clientName = a.clientName;
    byClient.set(id, cur);
  }
  return Array.from(byClient.values())
    .map(r => ({ ...r, totalSpend: round2(r.totalSpend) }))
    .sort((a, b) => b.visitCount - a.visitCount || a.clientName.localeCompare(b.clientName));
};

// Distinct billable clients booked within a calendar-prefix window
// ("YYYY-MM" for a month, "YYYY" for a year), with visit count + ticket
// spend. Same shape + grouping as weekClientRows so the KPI tile and its
// detail sheet can never disagree (the tile is just rows.length).
export const clientRowsForPrefix = (
  appointments: AppointmentLike[] | null | undefined,
  datePrefix: string,
): WeekClientRow[] => {
  const list = (appointments || [])
    .filter(isBillable)
    .filter(a => (a.date || "").startsWith(datePrefix))
    .sort((a, b) => ((a.date || "") + (a.time || "")).localeCompare((b.date || "") + (b.time || "")));
  const byClient = new Map<string, WeekClientRow>();
  for (const a of list) {
    const id = a.clientId || "_unknown";
    const cur = byClient.get(id) || {
      clientId: id,
      clientName: a.clientName || "Walk-in",
      visitCount: 0,
      totalSpend: 0,
      appointments: [],
    };
    cur.visitCount += 1;
    cur.totalSpend += ticketTotal(a);
    cur.appointments.push(a);
    if (a.clientName && cur.clientName !== a.clientName) cur.clientName = a.clientName;
    byClient.set(id, cur);
  }
  return Array.from(byClient.values())
    .map(r => ({ ...r, totalSpend: round2(r.totalSpend) }))
    .sort((a, b) => b.visitCount - a.visitCount || a.clientName.localeCompare(b.clientName));
};

export type AvgTicketBreakdown = {
  appointments: AppointmentLike[];
  total: number;
  count: number;
  average: number;
};

export const avgTicket30dBreakdown = (
  appointments: AppointmentLike[] | null | undefined,
  reference: string = todayISO(),
): AvgTicketBreakdown => {
  const cutoff = subDaysISO(reference, 30);
  const list = (appointments || [])
    .filter(isBillable)
    .filter(a => a.date && a.date >= cutoff && a.date <= reference)
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const total = list.reduce((s, a) => s + ticketTotal(a), 0);
  return {
    appointments: list,
    total: round2(total),
    count: list.length,
    average: list.length > 0 ? round2(total / list.length) : 0,
  };
};

// ---- Average hourly rate (year) ---------------------------------------

export type HourlyRateRow = {
  appointment: AppointmentLike;
  hours: number;
  earned: number;
  rate: number;   // earned ÷ hours for this single booking
};

export type HourlyRateBreakdown = {
  rows: HourlyRateRow[];
  hours: number;      // total hours across contributing bookings
  earned: number;     // total earned across contributing bookings
  rate: number;       // blended rate = earned ÷ hours
  skipped: number;    // paid bookings this year with no duration recorded
};

// Effective hourly rate for the calendar year. Mirrors the accumulation
// in computeDashboardRevenue so the card headline and this detail view
// can never disagree: completed/paid bookings in the year with a
// recorded duration, blended (total earned ÷ total hours). Bookings
// with no duration are counted in `skipped` so the sheet can nudge the
// stylist to fill durations in for a more accurate number.
export const yearHourlyRateBreakdown = (
  appointments: AppointmentLike[] | null | undefined,
  reference: string = todayISO(),
): HourlyRateBreakdown => {
  const year = yearBoundary(reference);
  const rows: HourlyRateRow[] = [];
  let hours = 0;
  let earned = 0;
  let skipped = 0;
  for (const a of (appointments || [])) {
    if (!isBillable(a)) continue;
    const d = a.date || "";
    if (!(d >= year.start && d < year.end)) continue;
    if (!isPaidish(a)) continue;
    const hrs = num(a.durationHours);
    const t = ticketTotal(a);
    if (hrs <= 0) { skipped += 1; continue; }
    hours += hrs;
    earned += t;
    rows.push({ appointment: a, hours: hrs, earned: round2(t), rate: round2(t / hrs) });
  }
  rows.sort((a, b) => b.rate - a.rate);
  return {
    rows,
    hours: round2(hours),
    earned: round2(earned),
    rate: hours > 0 ? round2(earned / hours) : 0,
    skipped,
  };
};

export type DepositBucket = {
  appointments: AppointmentLike[];
  total: number;
};

export type WeekDepositBuckets = {
  collected: DepositBucket;
  due: DepositBucket;        // upcoming this week with no deposit yet
  missing: DepositBucket;    // past this week, still no deposit
};

export const weekDepositBuckets = (
  appointments: AppointmentLike[] | null | undefined,
  reference: string = todayISO(),
): WeekDepositBuckets => {
  const ws = startOfWeekISO(reference);
  const we = addDaysISO(ws, 6);
  const collected: AppointmentLike[] = [];
  const due: AppointmentLike[] = [];
  const missing: AppointmentLike[] = [];
  for (const a of (appointments || [])) {
    if (!isBillable(a)) continue;
    const dep = num(a.depositPaid);

    // Collected — same canonical predicate the Home "Deposits
    // (week)" card uses, so the two surfaces can never disagree.
    if (isDepositCollectedInRange(a, ws, reference)) {
      collected.push(a);
      continue;
    }

    // Due / Missing — forward-looking buckets keyed to appointments
    // scheduled within this week's range (ws..we). Only count rows
    // that actually require a deposit; manual appointments with no
    // deposit set up are excluded so the dashboard doesn't surface
    // them as "missing" money the stylist never asked for.
    if (!a.date || a.date < ws || a.date > we) continue;
    if (dep > 0) continue; // already collected (paid earlier than this week)
    if (a.depositRequired !== true) continue;
    if (a.date < reference) missing.push(a);
    else                    due.push(a);
  }
  const sumDeposits = (xs: AppointmentLike[]) =>
    xs.reduce((s, a) => s + getDepositCollectedAmount(a), 0);
  return {
    collected: { appointments: collected, total: round2(sumDeposits(collected)) },
    due:       { appointments: due,       total: 0 },
    missing:   { appointments: missing,   total: 0 },
  };
};

export const pendingBalanceAppts = (
  appointments: AppointmentLike[] | null | undefined,
): AppointmentLike[] => {
  return (appointments || [])
    .filter(isBillable)
    // A pending balance with no date is meaningless — it's almost
    // always an orphaned/aborted booking. Excluding dateless rows
    // keeps junk out of the Home pending list and lets every card
    // deep-link to a real calendar day.
    .filter(a => !!a.date)
    .filter(a => ticketBalance(a) > 0)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
};

export const monthExpectedAppts = (
  appointments: AppointmentLike[] | null | undefined,
  reference: string = todayISO(),
): AppointmentLike[] => {
  // Match computeDashboardRevenue.monthExpected: every billable
  // appointment in the calendar month, paid or not.
  // Local-date string comparison is timezone-safe.
  const d = new Date(reference + "T00:00:00");
  const y = d.getFullYear();
  const m = d.getMonth();
  const start = `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const next = new Date(y, m + 1, 1);
  const end = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-01`;
  return (appointments || [])
    .filter(isBillable)
    .filter(a => a.date && a.date >= start && a.date < end)
    .sort((a, b) => ((a.date || "") + (a.time || "")).localeCompare((b.date || "") + (b.time || "")));
};

export const monthEarnedAppts = (
  appointments: AppointmentLike[] | null | undefined,
  reference: string = todayISO(),
): AppointmentLike[] =>
  // Match computeDashboardRevenue.monthEarned: completed/paid
  // appointments in the calendar month (month-to-date earnings).
  monthExpectedAppts(appointments, reference).filter(isPaidish);

// Every billable appointment in the *following* calendar month — the
// forward-looking "what's expected next month" preview on the
// dashboard. Same billable filter as monthExpectedAppts, just shifted
// one month ahead. Local-date string comparison is timezone-safe.
export const nextMonthAppts = (
  appointments: AppointmentLike[] | null | undefined,
  reference: string = todayISO(),
): AppointmentLike[] => {
  const d = new Date(reference + "T00:00:00");
  const startD = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  const endD = new Date(d.getFullYear(), d.getMonth() + 2, 1);
  const start = `${startD.getFullYear()}-${String(startD.getMonth() + 1).padStart(2, "0")}-01`;
  const end = `${endD.getFullYear()}-${String(endD.getMonth() + 1).padStart(2, "0")}-01`;
  return (appointments || [])
    .filter(isBillable)
    .filter(a => a.date && a.date >= start && a.date < end)
    .sort((a, b) => ((a.date || "") + (a.time || "")).localeCompare((b.date || "") + (b.time || "")));
};

// Expected revenue + unique-client count for the following calendar
// month. Powers the dashboard "Next month" preview and its drill-down.
export const nextMonthSummary = (
  appointments: AppointmentLike[] | null | undefined,
  reference: string = todayISO(),
): { appointments: AppointmentLike[]; revenue: number; clientCount: number } => {
  const list = nextMonthAppts(appointments, reference);
  const revenue = round2(list.reduce((s, a) => s + ticketTotal(a), 0));
  const clientCount = new Set(
    list.map(a => a.clientId).filter((id): id is string => !!id),
  ).size;
  return { appointments: list, revenue, clientCount };
};

export type MonthProfitBreakdown = {
  appointments: AppointmentLike[];
  revenue: number;
  discounts: number;
  estimatedCosts: number;
  estimatedProfit: number;
};

// Profit = collected revenue − estimated costs − discount value.
// Costs aren't tracked yet in the appointment record, so the helper
// returns 0 for now (display will say "—") until a Phase 4 cost
// field lands. Discount and revenue come straight from the
// appointment snapshot.
export const monthProfitBreakdown = (
  appointments: AppointmentLike[] | null | undefined,
  reference: string = todayISO(),
): MonthProfitBreakdown => {
  const month = monthExpectedAppts(appointments, reference)
    .filter(a => a.status === "completed" || a.paymentStatus === "paid");
  const revenue = month.reduce((s, a) => s + ticketTotal(a), 0);
  const discounts = month.reduce((s, a) => s + num(a.discountAmount), 0);
  const estimatedCosts = 0;
  const estimatedProfit = revenue - estimatedCosts;
  return {
    appointments: month,
    revenue: round2(revenue),
    discounts: round2(discounts),
    estimatedCosts: round2(estimatedCosts),
    estimatedProfit: round2(estimatedProfit),
  };
};
