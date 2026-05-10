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
  totalPrice?: number | string;
  depositPaid?: number | string;
  discountAmount?: number | string;
  durationHours?: number | string;
  clientId?: string | null;
  clientName?: string | null;
  style?: string | null;
};

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const isBillable = (a: AppointmentLike): boolean => {
  if (!a) return false;
  if (a.status === "cancelled" || a.status === "no_show") return false;
  if (a.kind && a.kind !== "appointment") return false;
  return true;
};

export const ticketTotal = (a: AppointmentLike): number => {
  return Math.max(0, num(a.totalPrice) - num(a.discountAmount));
};

export const ticketBalance = (a: AppointmentLike): number => {
  return Math.max(0, ticketTotal(a) - num(a.depositPaid));
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
};

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

  for (const a of list) {
    const d = a.date || "";
    const t = ticketTotal(a);
    const dep = num(a.depositPaid);
    if (d === today) todayRevenue += t;
    if (d >= weekStart && d <= today) {
      weekRevenue += t;
      weekDeposits += dep;
      weekAppointmentCount += 1;
    }
    if (d >= thirtyDaysAgo && d <= today) {
      last30Total += t;
      last30Count += 1;
    }
    pendingBalance += ticketBalance(a);
  }

  const averageTicket30d = last30Count > 0 ? last30Total / last30Count : 0;

  return {
    todayRevenue: round2(todayRevenue),
    weekRevenue: round2(weekRevenue),
    weekDeposits: round2(weekDeposits),
    pendingBalance: round2(pendingBalance),
    weekAppointmentCount,
    averageTicket30d: round2(averageTicket30d),
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
