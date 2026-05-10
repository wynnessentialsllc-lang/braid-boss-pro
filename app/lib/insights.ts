// Deterministic "AI-style" insights: rule-driven recommendations
// derived from already-computed app state. No AI API, no
// medical/financial/legal claims, no vague encouragements without
// data. Every insight points at a concrete action target.

export type InsightCategory =
  | "revenue"
  | "retention"
  | "schedule"
  | "client"
  | "balance"
  | "productivity";
export type InsightPriority = "low" | "medium" | "high";

export type Insight = {
  id: string;
  category: InsightCategory;
  title: string;
  body: string;
  why?: string;              // "why this matters" microcopy
  priority: InsightPriority;
  actionLabel?: string;
  actionTarget?: string;     // e.g. "tab:money", "client:abc", "appointment:xyz"
  createdAt: string;
};

const isFinite_ = Number.isFinite;
const num = (v: any): number => {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isFinite_(n) ? n : 0;
};
const safeArr = <T,>(v: T[] | null | undefined): T[] => Array.isArray(v) ? v : [];
const fmt = (n: number, currency: string = "USD"): string => {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n || 0); }
  catch { return `$${(n || 0).toFixed(2)}`; }
};

const PRIORITY_RANK: Record<InsightPriority, number> = { high: 0, medium: 1, low: 2 };

export type InsightInput = {
  clients: any[];
  appointments: any[];
  receipts?: any[];
  communications?: any[];
  settings?: { business?: any };
  today: string;
};

const collected = (a: any): number => {
  if (!a || a.status === "cancelled") return 0;
  const dep = num(a.depositPaid);
  if (dep > 0) return dep;
  if (num(a.balanceDue) === 0 && num(a.totalPrice) > 0) return num(a.totalPrice);
  return 0;
};

const monthBoundaries = (today: string) => {
  const [y, m] = today.split("-").map(Number);
  const cur = `${y}-${String(m).padStart(2, "0")}-01`;
  const prevD = new Date(y, (m || 1) - 2, 1);
  const prev = `${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, "0")}-01`;
  return { cur, prev };
};

export const generateBossInsights = (input: InsightInput): Insight[] => {
  const today = input.today || new Date().toISOString().slice(0, 10);
  const business = input.settings?.business || {};
  const currency = business?.currency || "USD";
  const appts = safeArr(input.appointments).filter(a => a && a.status !== "cancelled");
  const clients = safeArr(input.clients);
  const out: Insight[] = [];
  const now = new Date().toISOString();

  // ---- BALANCE: signal-bearing alerts only ----------------------------
  //
  // The Dashboard already shows pending balance as a KPI total *and*
  // as an actionable Pending Balances list. Repeating "$X in pending
  // balances" here adds no new information, so the BALANCE insight
  // only fires when there's genuine signal:
  //
  //   1. Overdue — any appointment dated before today still owes
  //   2. Balance due today
  //   3. Multiple clients owe (>= 2 distinct)
  //   4. Low deposit collection — < 50% of upcoming bookings have a
  //      deposit on file (sample size >= 3)
  //
  // We surface ONE balance insight at most (the highest-priority one
  // that triggers) so the card list stays focused.
  const owingAppts = appts.filter(a => a.paymentStatus !== "paid" && num(a.balanceDue) > 0);
  if (owingAppts.length > 0) {
    const overdue = owingAppts.filter(a => a.date && a.date < today);
    const dueToday = owingAppts.filter(a => a.date === today);
    const distinctClients = new Set(owingAppts.map(a => a.clientId).filter(Boolean));

    if (overdue.length > 0) {
      const overdueTotal = overdue.reduce((s, a) => s + num(a.balanceDue), 0);
      out.push({
        id: `pending_overdue:${today}`,
        category: "balance",
        priority: "high",
        title: `${overdue.length} overdue ${overdue.length === 1 ? "balance" : "balances"} · ${fmt(overdueTotal, currency)}`,
        body: "Past-due balances on appointments that already happened.",
        why: "Overdue collections compound quietly. A short message today usually closes them.",
        actionLabel: "View schedule",
        actionTarget: "tab:schedule",
        createdAt: now,
      });
    } else if (dueToday.length > 0) {
      const dueTodayTotal = dueToday.reduce((s, a) => s + num(a.balanceDue), 0);
      const first = dueToday[0];
      out.push({
        id: `pending_today:${today}`,
        category: "balance",
        priority: "high",
        title: `Balance due today · ${fmt(dueTodayTotal, currency)}`,
        body: dueToday.length === 1 && first?.clientName
          ? `Collect from ${first.clientName} after the chair clears.`
          : `Across ${dueToday.length} appointment${dueToday.length === 1 ? "" : "s"} on the books for today.`,
        actionLabel: "View schedule",
        actionTarget: "tab:schedule",
        createdAt: now,
      });
    } else if (distinctClients.size >= 2) {
      out.push({
        id: `pending_multi:${today}`,
        category: "balance",
        priority: "medium",
        title: `${distinctClients.size} clients owe a balance`,
        body: "Outstanding totals are spread across more than one client.",
        why: "Sending personal nudges in the same window keeps follow-ups easy and consistent.",
        actionLabel: "View schedule",
        actionTarget: "tab:schedule",
        createdAt: now,
      });
    }
  }

  // ---- BALANCE: low deposit collection rate ---------------------------
  const upcoming = appts.filter(a => a.date && a.date >= today);
  if (upcoming.length >= 3) {
    const withDeposit = upcoming.filter(a => num(a.depositPaid) > 0).length;
    const rate = withDeposit / upcoming.length;
    if (rate < 0.5) {
      const pct = Math.round(rate * 100);
      out.push({
        id: `deposit_rate:${today}`,
        category: "balance",
        priority: "medium",
        title: `Only ${pct}% of upcoming bookings have a deposit`,
        body: `${withDeposit} of ${upcoming.length} upcoming appointments have a deposit on file.`,
        why: "Locking in deposits up front reduces no-shows and makes the chair more predictable.",
        actionLabel: "View schedule",
        actionTarget: "tab:schedule",
        createdAt: now,
      });
    }
  }

  // ---- SCHEDULE: today's appointment list (high if any) ---------------
  const todayAppts = appts.filter(a => a.date === today);
  if (todayAppts.length > 0) {
    const first = todayAppts.sort((a, b) => (a.time || "").localeCompare(b.time || ""))[0];
    out.push({
      id: `today_${todayAppts.length}:${today}`,
      category: "schedule",
      priority: "high",
      title: `${todayAppts.length} appointment${todayAppts.length === 1 ? "" : "s"} today`,
      body: first?.clientName ? `Starts with ${first.clientName} at ${first.time || "—"}.` : "",
      why: "Knowing who's coming first helps you prep the chair and order your day.",
      actionLabel: "View schedule",
      actionTarget: "tab:schedule",
      createdAt: now,
    });
  }

  // ---- RETENTION: top inactive client (high if VIP) -------------------
  const apptsByClient: Record<string, any[]> = {};
  for (const a of appts) if (a.clientId) (apptsByClient[a.clientId] ||= []).push(a);
  const inactiveCandidate = clients
    .map(c => {
      const mine = apptsByClient[c.id] || [];
      const completed = mine.filter(a => a.status === "completed" || a.paymentStatus === "paid");
      const ltv = completed.reduce((s, a) => s + collected(a), 0);
      const upcoming = mine.find(a => a.date >= today && a.status !== "cancelled" && a.status !== "completed");
      if (upcoming) return null;
      const lastDate = completed.map(a => a.date).filter(Boolean).sort().pop();
      if (!lastDate) return null;
      const days = Math.round((new Date(today + "T00:00:00").getTime() - new Date(lastDate + "T00:00:00").getTime()) / 86400_000);
      return { client: c, days, ltv, completed: completed.length };
    })
    .filter((x): x is { client: any; days: number; ltv: number; completed: number } => !!x && x.days >= 30)
    .sort((a, b) => (b.ltv - a.ltv) || (b.days - a.days))[0];
  if (inactiveCandidate) {
    const isVip = inactiveCandidate.ltv >= 800 && inactiveCandidate.completed >= 3;
    out.push({
      id: `inactive_top:${inactiveCandidate.client.id}`,
      category: "retention",
      priority: isVip ? "high" : "medium",
      title: isVip
        ? `VIP client inactive: ${inactiveCandidate.client.name}`
        : `Send a rebooking reminder to ${inactiveCandidate.client.name}`,
      body: `${inactiveCandidate.days} days since their last visit${isVip ? " — and they're a top spender." : "."}`,
      why: "Repeat clients are 3-5x cheaper to retain than new clients are to attract. A short personal message goes a long way.",
      actionLabel: "Send reminder",
      actionTarget: `client:${inactiveCandidate.client.id}`,
      createdAt: now,
    });
  }

  // ---- REVENUE: highest earning style this month ----------------------
  const { cur: monthStart, prev: prevMonthStart } = monthBoundaries(today);
  const styleTotals: Record<string, { total: number; count: number; durSum: number; durN: number }> = {};
  for (const a of appts) {
    if ((a.status !== "completed" && a.paymentStatus !== "paid") || a.date < monthStart) continue;
    const k = (a.style || "").trim();
    if (!k) continue;
    (styleTotals[k] ||= { total: 0, count: 0, durSum: 0, durN: 0 });
    styleTotals[k].total += collected(a);
    styleTotals[k].count += 1;
    if (num(a.durationHours) > 0) {
      styleTotals[k].durSum += num(a.durationHours);
      styleTotals[k].durN += 1;
    }
  }
  const topStyle = Object.entries(styleTotals).sort(([, a], [, b]) => b.total - a.total)[0];
  if (topStyle && topStyle[1].total > 0) {
    out.push({
      id: `top_style:${monthStart}:${topStyle[0]}`,
      category: "revenue",
      priority: "medium",
      title: `Top-earning style this month: ${topStyle[0]}`,
      body: `${fmt(topStyle[1].total, currency)} across ${topStyle[1].count} booking${topStyle[1].count === 1 ? "" : "s"}.`,
      why: "Knowing which style pays best helps you prioritize what to book and what to promote.",
      actionLabel: "View money",
      actionTarget: "tab:money",
      createdAt: now,
    });
  }

  // ---- REVENUE: month-over-month change -------------------------------
  const monthRevenue = (start: string, end?: string) => appts
    .filter(a => (a.status === "completed" || a.paymentStatus === "paid") && a.date >= start && (!end || a.date < end))
    .reduce((s, a) => s + collected(a), 0);
  const thisMonth = monthRevenue(monthStart);
  const lastMonth = monthRevenue(prevMonthStart, monthStart);
  if (lastMonth > 0) {
    const pct = Math.round(((thisMonth - lastMonth) / lastMonth) * 100);
    if (Math.abs(pct) >= 10) {
      out.push({
        id: `mom:${monthStart}`,
        category: "revenue",
        priority: "low",
        title: pct > 0 ? `Revenue is up ${pct}% vs last month` : `Revenue is down ${Math.abs(pct)}% vs last month`,
        body: `${fmt(thisMonth, currency)} this month vs ${fmt(lastMonth, currency)} last month.`,
        actionLabel: "View money",
        actionTarget: "tab:money",
        createdAt: now,
      });
    }
  }

  // ---- PRODUCTIVITY: average duration of most-booked style ------------
  const mostBooked = Object.entries(styleTotals).sort(([, a], [, b]) => b.count - a.count)[0];
  if (mostBooked && mostBooked[1].durN > 0) {
    const avg = mostBooked[1].durSum / mostBooked[1].durN;
    out.push({
      id: `avg_duration:${monthStart}:${mostBooked[0]}`,
      category: "productivity",
      priority: "low",
      title: `${mostBooked[0]} averages ${avg.toFixed(1)}h`,
      body: `Use this when quoting future ${mostBooked[0]} bookings.`,
      actionLabel: "Open calculator",
      actionTarget: "tab:calculator",
      createdAt: now,
    });
  }

  // ---- SCHEDULE: busiest day of week ----------------------------------
  const dowCounts = [0, 0, 0, 0, 0, 0, 0];
  const dowNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (const a of appts) {
    if (a.status !== "completed" && a.paymentStatus !== "paid") continue;
    if (!a.date || a.date < prevMonthStart) continue;
    const d = new Date(a.date + "T00:00:00");
    if (!isFinite_(d.getTime())) continue;
    dowCounts[d.getDay()] += 1;
  }
  const dowMax = dowCounts.indexOf(Math.max(...dowCounts));
  if (dowCounts[dowMax] >= 3) {
    out.push({
      id: `dow:${dowMax}:${monthStart}`,
      category: "schedule",
      priority: "low",
      title: `${dowNames[dowMax]} is your busiest day`,
      body: `${dowCounts[dowMax]} completed appointment${dowCounts[dowMax] === 1 ? "" : "s"} in the last 60 days.`,
      actionLabel: "View schedule",
      actionTarget: "tab:schedule",
      createdAt: now,
    });
  }

  // (Average ticket is now surfaced as its own Dashboard KPI card.
  // We deliberately do NOT emit a generic "Average ticket: $X"
  // insight here — Boss Insights is for interpretation, not a second
  // print of the same number.)

  // ---- CLIENT: repeat client rate -------------------------------------
  const withHistory = clients
    .map(c => (apptsByClient[c.id] || []).filter(a => a.status === "completed" || a.paymentStatus === "paid").length)
    .filter(n => n > 0);
  if (withHistory.length >= 3) {
    const repeats = withHistory.filter(n => n >= 2).length;
    const pct = Math.round((repeats / withHistory.length) * 100);
    out.push({
      id: `repeat_pct:${monthStart}`,
      category: "retention",
      priority: pct >= 50 ? "low" : "medium",
      title: `Repeat client rate: ${pct}%`,
      body: pct >= 50
        ? "Strong retention — keep nurturing rebookings."
        : "Below half of clients have rebooked. A retention campaign could help.",
      actionLabel: "View clients",
      actionTarget: "tab:clients",
      createdAt: now,
    });
  }

  return out
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
    .slice(0, 5);
};
