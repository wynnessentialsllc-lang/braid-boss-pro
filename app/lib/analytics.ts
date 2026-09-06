// Pure analytics helpers. UI components only render the result —
// every calculation lives here. Defensive against missing / corrupt
// rows (Array.isArray, parseFloat that never NaNs, ISO date guards).

const isFinite_ = Number.isFinite;
const num = (v: any): number => {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isFinite_(n) ? n : 0;
};
const safeArr = <T,>(v: T[] | null | undefined): T[] => Array.isArray(v) ? v : [];
const isCanceledStatus = (status: unknown): boolean =>
  status === "cancelled" || status === "canceled";
const isCanceledAppointment = (a: any): boolean => isCanceledStatus(a?.status);
const collected = (a: any): number => {
  if (!a || isCanceledAppointment(a)) return 0;
  const total = num(a.totalPrice);
  // Paid in full (balance settled after a deposit, or a flat full
  // payment) takes priority over the deposit field — otherwise a
  // booking whose balance was later paid off keeps reading as only
  // its original deposit, undercounting collected revenue.
  if (a.balancePaid === true || a.balance_paid === true) return total;
  if (num(a.balanceDue) === 0 && total > 0) return total;
  const dep = num(a.depositPaid);
  if (dep > 0) return dep;
  return 0;
};
const isPaidLike = (a: any): boolean =>
  !!a && !isCanceledAppointment(a) && (a.status === "completed" || a.paymentStatus === "paid");

const monthBoundaries = (today: string) => {
  const [y, m] = today.split("-").map(Number);
  const cur = `${y}-${String(m).padStart(2, "0")}-01`;
  const prevD = new Date(y, (m || 1) - 2, 1);
  const prev = `${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, "0")}-01`;
  return { cur, prev };
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// ---- Revenue ------------------------------------------------------------

export type RevenueAnalytics = {
  thisMonth: number;
  lastMonth: number;
  momChangePct: number | null;
  averageTicket: number;
  topStyle: { name: string; revenue: number } | null;
  pendingBalance: number;
  completedThisMonth: number;
};

export const calculateRevenueAnalytics = (
  appointments: any[],
  today: string,
): RevenueAnalytics => {
  const appts = safeArr(appointments);
  const { cur: monthStart, prev: prevStart } = monthBoundaries(today);
  const thisMonth = appts
    .filter(a => isPaidLike(a) && a.date >= monthStart)
    .reduce((s, a) => s + collected(a), 0);
  const lastMonth = appts
    .filter(a => isPaidLike(a) && a.date >= prevStart && a.date < monthStart)
    .reduce((s, a) => s + collected(a), 0);
  const completedThisMonth = appts.filter(a => isPaidLike(a) && a.date >= monthStart).length;
  const completedAll = appts.filter(isPaidLike);
  const totalCollected = completedAll.reduce((s, a) => s + collected(a), 0);
  const averageTicket = completedAll.length > 0 ? totalCollected / completedAll.length : 0;
  const styleTotals: Record<string, number> = {};
  for (const a of appts) {
    if (!isPaidLike(a) || a.date < monthStart) continue;
    const k = (a.style || "").trim();
    if (!k) continue;
    styleTotals[k] = (styleTotals[k] || 0) + collected(a);
  }
  const topStyleEntry = Object.entries(styleTotals).sort(([, a], [, b]) => b - a)[0];
  const pendingBalance = appts
    .filter(a => !isCanceledAppointment(a) && a?.paymentStatus !== "paid")
    .reduce((s, a) => s + num(a.balanceDue), 0);
  return {
    thisMonth: round2(thisMonth),
    lastMonth: round2(lastMonth),
    momChangePct: lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : null,
    averageTicket: round2(averageTicket),
    topStyle: topStyleEntry ? { name: topStyleEntry[0], revenue: round2(topStyleEntry[1]) } : null,
    pendingBalance: round2(pendingBalance),
    completedThisMonth,
  };
};

// ---- Clients ------------------------------------------------------------

export type ClientAnalytics = {
  total: number;
  newThisMonth: number;
  repeatRatePct: number;
  vipCount: number;
  inactiveCount: number;
  atRiskCount: number;
};

export const calculateClientAnalytics = (
  clients: any[],
  appointments: any[],
  today: string,
  vipThreshold: number = 800,
): ClientAnalytics => {
  const cs = safeArr(clients);
  const appts = safeArr(appointments);
  const { cur: monthStart } = monthBoundaries(today);
  const todayMs = new Date(today + "T00:00:00").getTime();

  const apptsByClient: Record<string, any[]> = {};
  for (const a of appts) if (a?.clientId) (apptsByClient[a.clientId] ||= []).push(a);

  let newThisMonth = 0;
  let repeatable = 0;
  let repeats = 0;
  let vip = 0;
  let inactive = 0;
  let atRisk = 0;

  for (const c of cs) {
    const mine = apptsByClient[c.id] || [];
    const completed = mine.filter(isPaidLike);
    if (completed.length > 0) {
      repeatable += 1;
      if (completed.length >= 2) repeats += 1;
    }
    const lastDate = completed.map(a => a.date).filter(Boolean).sort().pop();
    const days = lastDate
      ? Math.round((todayMs - new Date(lastDate + "T00:00:00").getTime()) / 86400_000)
      : null;
    const ltv = completed.reduce((s, a) => s + collected(a), 0);
    const upcoming = mine.find(a => a.date >= today && !isCanceledAppointment(a) && a.status !== "completed");
    if (ltv >= vipThreshold && completed.length >= 3) vip += 1;
    if (days !== null && days > 90 && !upcoming) inactive += 1;
    if (days !== null && days >= 60 && days <= 90 && !upcoming && completed.length >= 2) atRisk += 1;
    // "New this month" = a client whose FIRST actual visit (a completed /
    // paid appointment) happened this month. Using completed appts — not
    // every booking — keeps this consistent with revenue and the rest of
    // these metrics: a client who only has a future, not-yet-serviced
    // booking hasn't "come in" yet, so they don't count as new until the
    // service is rendered.
    const firstServiced = completed.map(a => a.date).filter(Boolean).sort()[0];
    if (firstServiced && firstServiced >= monthStart) newThisMonth += 1;
  }

  return {
    total: cs.length,
    newThisMonth,
    repeatRatePct: repeatable > 0 ? Math.round((repeats / repeatable) * 100) : 0,
    vipCount: vip,
    inactiveCount: inactive,
    atRiskCount: atRisk,
  };
};

// ---- Appointments -------------------------------------------------------

export type AppointmentAnalytics = {
  thisMonthTotal: number;
  completed: number;
  cancelled: number;
  noShow: number;
  busiestDow: { name: string; count: number } | null;
  averageDurationHours: number;
};

const DOW_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const calculateAppointmentAnalytics = (
  appointments: any[],
  today: string,
): AppointmentAnalytics => {
  const { cur: monthStart, prev: prevStart } = monthBoundaries(today);
  const appts = safeArr(appointments);
  const inMonth = appts.filter(a => a?.date && a.date >= monthStart);
  const activeInMonth = inMonth.filter(a => !isCanceledAppointment(a));
  const completed = inMonth.filter(a => a.status === "completed" || a.paymentStatus === "paid").length;
  const cancelled = inMonth.filter(isCanceledAppointment).length;
  const noShow = inMonth.filter(a => a.status === "no_show").length;

  const dowCounts = [0, 0, 0, 0, 0, 0, 0];
  for (const a of appts) {
    if (a.status !== "completed" && a.paymentStatus !== "paid") continue;
    if (!a.date || a.date < prevStart) continue;
    const d = new Date(a.date + "T00:00:00");
    if (!isFinite_(d.getTime())) continue;
    dowCounts[d.getDay()] += 1;
  }
  const max = Math.max(...dowCounts);
  const busiestDow = max > 0
    ? { name: DOW_NAMES[dowCounts.indexOf(max)], count: max }
    : null;

  let durSum = 0;
  let durN = 0;
  for (const a of appts) {
    if (a.status !== "completed" && a.paymentStatus !== "paid") continue;
    const h = num(a.durationHours);
    if (h > 0) { durSum += h; durN += 1; }
  }
  return {
    thisMonthTotal: activeInMonth.length,
    completed,
    cancelled,
    noShow,
    busiestDow,
    averageDurationHours: durN > 0 ? round2(durSum / durN) : 0,
  };
};

// ---- Style performance --------------------------------------------------

export type StylePerformanceRow = {
  style: string;
  count: number;
  revenue: number;
  averagePrice: number;
  averageDuration: number;
  repeatBookingRatePct: number;
};

export const calculateStylePerformance = (appointments: any[]): StylePerformanceRow[] => {
  const appts = safeArr(appointments);
  const byStyle: Record<string, { count: number; revenue: number; durSum: number; durN: number; clientIds: Set<string>; repeats: number }> = {};
  for (const a of appts) {
    if (!isPaidLike(a)) continue;
    const k = (a.style || "").trim();
    if (!k) continue;
    const e = byStyle[k] ||= { count: 0, revenue: 0, durSum: 0, durN: 0, clientIds: new Set(), repeats: 0 };
    e.count += 1;
    e.revenue += collected(a);
    if (num(a.durationHours) > 0) { e.durSum += num(a.durationHours); e.durN += 1; }
    if (a.clientId) {
      if (e.clientIds.has(a.clientId)) e.repeats += 1;
      else e.clientIds.add(a.clientId);
    }
  }
  return Object.entries(byStyle)
    .map(([style, e]) => ({
      style,
      count: e.count,
      revenue: round2(e.revenue),
      averagePrice: e.count > 0 ? round2(e.revenue / e.count) : 0,
      averageDuration: e.durN > 0 ? round2(e.durSum / e.durN) : 0,
      repeatBookingRatePct: e.count > 0 ? Math.round((e.repeats / e.count) * 100) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);
};

// ---- Retention ----------------------------------------------------------

export type RetentionAnalytics = {
  rebookingCandidates: number;
  averageDaysBetween: number | null;
  overdueCount: number;
  repeatBookingRatePct: number;
};

export const calculateRetentionAnalytics = (
  clients: any[],
  appointments: any[],
  today: string,
): RetentionAnalytics => {
  const cs = safeArr(clients);
  const appts = safeArr(appointments);
  const apptsByClient: Record<string, any[]> = {};
  for (const a of appts) if (a?.clientId) (apptsByClient[a.clientId] ||= []).push(a);
  const todayMs = new Date(today + "T00:00:00").getTime();

  const gaps: number[] = [];
  let candidates = 0;
  let overdue = 0;
  let repeatable = 0;
  let repeats = 0;

  for (const c of cs) {
    const mine = apptsByClient[c.id] || [];
    const completed = mine.filter(isPaidLike).map(a => a.date).filter(Boolean).sort();
    if (completed.length === 0) continue;
    repeatable += 1;
    if (completed.length >= 2) repeats += 1;
    for (let i = 1; i < completed.length; i++) {
      const da = new Date(completed[i - 1] + "T00:00:00").getTime();
      const db = new Date(completed[i] + "T00:00:00").getTime();
      if (isFinite_(da) && isFinite_(db)) gaps.push(Math.round((db - da) / 86400_000));
    }
    const last = completed[completed.length - 1];
    const upcoming = mine.find(a => a.date >= today && !isCanceledAppointment(a) && a.status !== "completed");
    if (upcoming) continue;
    const days = Math.round((todayMs - new Date(last + "T00:00:00").getTime()) / 86400_000);
    if (days >= 42) candidates += 1;
    if (days >= 90) overdue += 1;
  }
  return {
    rebookingCandidates: candidates,
    averageDaysBetween: gaps.length > 0 ? Math.round(gaps.reduce((s, n) => s + n, 0) / gaps.length) : null,
    overdueCount: overdue,
    repeatBookingRatePct: repeatable > 0 ? Math.round((repeats / repeatable) * 100) : 0,
  };
};

// ---- Communications -----------------------------------------------------

export type CommunicationAnalytics = {
  total: number;
  sent: number;
  shared: number;
  copied: number;
  byTemplate: { template: string; count: number }[];
  remindersSent: number;
  rebookingNudgesSent: number;
  balanceRemindersSent: number;
};

export const calculateCommunicationAnalytics = (commLog: any[]): CommunicationAnalytics => {
  const log = safeArr(commLog);
  let sent = 0, shared = 0, copied = 0;
  const byTemplate: Record<string, number> = {};
  for (const e of log) {
    if (!e) continue;
    if (e.action === "sent") sent += 1;
    else if (e.action === "shared") shared += 1;
    else if (e.action === "copied") copied += 1;
    const k = (e.type || "other") as string;
    byTemplate[k] = (byTemplate[k] || 0) + 1;
  }
  const reminders = (byTemplate["appointment_reminder"] || 0);
  const rebookingNudges = (byTemplate["rebooking_nudge"] || 0);
  const balanceReminders = (byTemplate["balance_due"] || 0);
  return {
    total: log.length,
    sent,
    shared,
    copied,
    remindersSent: reminders,
    rebookingNudgesSent: rebookingNudges,
    balanceRemindersSent: balanceReminders,
    byTemplate: Object.entries(byTemplate).map(([template, count]) => ({ template, count })).sort((a, b) => b.count - a.count),
  };
};
