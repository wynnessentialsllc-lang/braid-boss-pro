// Derived per-client insights — pure presentation helpers, no DB
// changes. All data comes from existing client + appointment records.
//
// Insights are kept short and conversational so they sit naturally in
// a client profile card: "Books knotless every 8 weeks",
// "Usually books Saturdays". Empty arrays are perfectly fine — a
// brand-new client with one visit will just show fewer lines.

const DAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday",
];

const isCanceledStatus = (status: unknown): boolean =>
  status === "cancelled" || status === "canceled";

const isCompleted = (a: any): boolean =>
  a && !isCanceledStatus(a.status) && (
    a.status === "completed" || a.paymentStatus === "paid"
  );

const isCancelled = (a: any): boolean => isCanceledStatus(a?.status);
const isNoShow = (a: any): boolean => a?.status === "no_show";

const parseISODate = (iso?: string | null): Date | null => {
  if (!iso || typeof iso !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
};

const daysBetweenISO = (a: string, b: string): number | null => {
  const da = parseISODate(a);
  const db = parseISODate(b);
  if (!da || !db) return null;
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
};

const collectedAmount = (a: any): number => {
  const total = Number(a?.totalPrice) || 0;
  const dep = Number(a?.depositPaid) || 0;
  const bal = Number(a?.balanceDue) || 0;
  // Treat fully paid as total; partially paid as deposit.
  if (a?.status === "completed" || a?.paymentStatus === "paid") {
    return total > 0 ? total - Math.max(0, bal) : dep;
  }
  return 0;
};

const mode = <T extends string | number>(values: T[]): T | null => {
  if (values.length === 0) return null;
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  let best: T | null = null;
  let bestN = 0;
  for (const [k, n] of counts) {
    if (n > bestN) { best = k; bestN = n; }
  }
  return best;
};

export type ClientInsights = {
  // Headline facts
  visitCount: number;
  lifetimeSpend: number;
  averageTicket: number;
  cancellationCount: number;
  noShowCount: number;
  // Last visit context
  lastBookedDate: string | null;
  lastBookedStyle: string | null;
  lastBookedDaysAgo: number | null;
  // Booking patterns
  mostBookedService: string | null;
  preferredDayOfWeek: number | null;
  averageGapDays: number | null;
  // Badges (the dashboard / sheet can render these as Pills)
  isRepeat: boolean;
  isVip: boolean;
  // Conversational lines — surface these straight into the profile
  insights: string[];
};

export const deriveClientInsights = (
  client: any,
  allAppointments: any[],
  todayISO: string,
): ClientInsights => {
  const appts = (Array.isArray(allAppointments) ? allAppointments : [])
    .filter((a: any) => a && a.clientId === client?.id);

  const completed = appts.filter(isCompleted);
  const visitCount = completed.length;
  const cancellationCount = appts.filter(isCancelled).length;
  const noShowCount = appts.filter(isNoShow).length;

  const lifetimeSpend = completed.reduce((s, a) => s + collectedAmount(a), 0);
  const averageTicket = visitCount > 0 ? lifetimeSpend / visitCount : 0;

  // Past visits, oldest → newest, used for cadence + last-booked.
  const pastVisits = appts
    .filter((a: any) => !isCancelled(a) && a?.date && a.date <= todayISO)
    .sort((x: any, y: any) => (x.date || "").localeCompare(y.date || ""));
  const last = pastVisits[pastVisits.length - 1];
  const lastBookedDate = last?.date || null;
  const lastBookedStyle = last?.style || null;
  const lastBookedDaysAgo = lastBookedDate
    ? daysBetweenISO(lastBookedDate, todayISO)
    : null;

  // Most booked service across all (cancelled excluded).
  const styles = appts
    .filter((a: any) => !isCancelled(a) && typeof a?.style === "string" && a.style.trim())
    .map((a: any) => a.style.trim());
  const mostBookedService = mode(styles);

  // Preferred day = mode of date.getUTCDay() across past + future
  // non-cancelled appointments.
  const dows: number[] = [];
  for (const a of appts) {
    if (isCancelled(a)) continue;
    const d = parseISODate(a?.date);
    if (d) dows.push(d.getUTCDay());
  }
  const preferredDayOfWeek = mode(dows);

  // Average gap between consecutive past visits (in days).
  let averageGapDays: number | null = null;
  if (pastVisits.length >= 2) {
    const gaps: number[] = [];
    for (let i = 1; i < pastVisits.length; i++) {
      const g = daysBetweenISO(pastVisits[i - 1].date, pastVisits[i].date);
      if (g !== null && g > 0) gaps.push(g);
    }
    if (gaps.length > 0) {
      averageGapDays = Math.round(gaps.reduce((s, n) => s + n, 0) / gaps.length);
    }
  }

  const isRepeat = visitCount >= 2;
  // Heuristic: top quartile-ish spend + repeat. The dashboard / sheet
  // can override this later by computing across the whole book.
  const isVip = isRepeat && lifetimeSpend >= 800;

  // Conversational insight strings — short, calm, single-line.
  const insights: string[] = [];
  if (mostBookedService && averageGapDays !== null) {
    const weeks = Math.max(1, Math.round(averageGapDays / 7));
    insights.push(`Books ${mostBookedService.toLowerCase()} every ${weeks} week${weeks === 1 ? "" : "s"}`);
  } else if (mostBookedService && visitCount >= 2) {
    insights.push(`Favorite: ${mostBookedService}`);
  }
  if (preferredDayOfWeek !== null && visitCount >= 2) {
    insights.push(`Usually books ${DAY_NAMES[preferredDayOfWeek]}s`);
  }
  if (isVip) {
    insights.push("High-value repeat client");
  } else if (isRepeat) {
    insights.push("Repeat client");
  }
  if (cancellationCount >= 2) {
    insights.push(`${cancellationCount} cancellations on record`);
  }
  if (noShowCount >= 1) {
    insights.push(`${noShowCount} no-show${noShowCount === 1 ? "" : "s"} on record`);
  }

  return {
    visitCount,
    lifetimeSpend,
    averageTicket,
    cancellationCount,
    noShowCount,
    lastBookedDate,
    lastBookedStyle,
    lastBookedDaysAgo,
    mostBookedService,
    preferredDayOfWeek,
    averageGapDays,
    isRepeat,
    isVip,
    insights,
  };
};

// Short "Last booked: Boho Knotless · 7 weeks ago" line for the
// booking-assist hint. Returns null when there's no prior visit.
export const formatLastBookedHint = (i: ClientInsights): string | null => {
  if (!i.lastBookedDate || i.lastBookedDaysAgo === null) return null;
  const style = i.lastBookedStyle || "appointment";
  const d = i.lastBookedDaysAgo;
  let timePhrase: string;
  if (d <= 1) timePhrase = "yesterday";
  else if (d < 14) timePhrase = `${d} days ago`;
  else if (d < 60) timePhrase = `${Math.round(d / 7)} weeks ago`;
  else if (d < 540) timePhrase = `${Math.round(d / 30)} months ago`;
  else timePhrase = `${Math.round(d / 365)} years ago`;
  return `Last booked: ${style} · ${timePhrase}`;
};
