// Deterministic "AI-style" insights: rule-driven recommendations
// derived from already-computed app state. No AI API, no
// medical/financial/legal claims, no vague encouragements without
// data. Every insight points at a concrete action target.

// 12-hour user-facing time, dropping ":00" on the hour
// ("14:00" → "2 PM", "14:30" → "2:30 PM"). Mirrors the canonical
// fmtTime in app/page.tsx; kept local so this lib has no app deps.
const fmtTime12 = (t: string | null | undefined): string => {
  if (!t) return "";
  const [hStr, mStr] = String(t).split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h)) return String(t);
  const period = h >= 12 ? "PM" : "AM";
  const hh = h % 12 || 12;
  const mins = Number.isFinite(m) ? m : 0;
  return mins === 0 ? `${hh} ${period}` : `${hh}:${String(mins).padStart(2, "0")} ${period}`;
};

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
const isCanceledStatus = (status: unknown): boolean =>
  status === "cancelled" || status === "canceled";
const isCanceledAppointment = (a: any): boolean => isCanceledStatus(a?.status);
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
  // Optional. When passed, generateBossInsights surfaces a low-stock
  // productivity insight that deep-links the stylist to Inventory.
  inventoryItems?: any[];
  settings?: { business?: any };
  today: string;
};

const collected = (a: any): number => {
  if (!a || isCanceledAppointment(a)) return 0;
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
  // Exclude cancelled rows AND non-real entries (personal blocks,
  // all-day Unavailable holds) so an off-day with only a "blocked"
  // event doesn't read as "1 appointment today".
  const appts = safeArr(input.appointments).filter(a => a && !isCanceledAppointment(a));
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
  // Must match the dashboard Pending Balances rule exactly, or the
  // count here ("N clients owe a balance") disagrees with the list
  // the stylist actually sees. Exclude cancelled, personal/blocked,
  // and dateless rows — same filters as lib/reports.ts
  // pendingBalanceAppts + the dashboard helpers.
  //
  // Scoped to the CURRENT MONTH so this count matches the Pending
  // Balances sheet the stylist actually sees from the dashboard.
  // Without the month gate, the insight rolled in future-month
  // bookings (e.g. June balances while it's still May) and the
  // "N clients owe a balance" headline disagreed with the list.
  const monthStartIso = today.slice(0, 8) + "01";
  const [yStr, mStr] = today.split("-");
  const yNum = Number(yStr);
  const mNum = Number(mStr);
  const nextMonthDate = new Date(yNum, mNum, 1);  // mNum is already next month (1-indexed -> 0-indexed)
  const nextMonthIso =
    `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, "0")}-01`;
  const owingAppts = appts.filter(a =>
    a &&
    !isCanceledAppointment(a) &&
    (!a.kind || a.kind === "appointment") &&
    !!a.date &&
    a.date >= monthStartIso &&
    a.date < nextMonthIso &&
    a.paymentStatus !== "paid" &&
    num(a.balanceDue) > 0
  );
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
        actionLabel: "View balances",
        actionTarget: "kpi:pending",
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
        actionLabel: "View balances",
        actionTarget: "kpi:pending",
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
        actionLabel: "View balances",
        actionTarget: "kpi:pending",
        createdAt: now,
      });
    }
  }

  // ---- BALANCE: low deposit collection rate ---------------------------
  // Same exclusions — a cancelled or personal/blocked entry isn't an
  // "upcoming booking" that should drag down the deposit rate.
  const upcoming = appts.filter(a =>
    a &&
    !isCanceledAppointment(a) &&
    (!a.kind || a.kind === "appointment") &&
    a.date && a.date >= today
  );
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
        actionLabel: "View deposits",
        actionTarget: "kpi:deposits",
        createdAt: now,
      });
    }
  }

  // ---- SCHEDULE: today's appointment list (high if any) ---------------
  // Exclude personal/blocked time and all-day Unavailable holds so an
  // off-day with only a "blocked" event doesn't read as "1 appointment
  // today". (The base `appts` filter intentionally keeps these so
  // other insights can reference them; the schedule headline is the
  // one place we strictly want real bookings.)
  const todayAppts = appts.filter(a =>
    a.date === today
    && (a.kind ?? "appointment") === "appointment"
    && a.is_all_day !== true
    && a.isAllDay !== true,
  );
  if (todayAppts.length > 0) {
    const first = todayAppts.sort((a, b) => (a.time || "").localeCompare(b.time || ""))[0];
    out.push({
      id: `today_${todayAppts.length}:${today}`,
      category: "schedule",
      priority: "high",
      title: `${todayAppts.length} appointment${todayAppts.length === 1 ? "" : "s"} today`,
      body: first?.clientName ? `Starts with ${first.clientName} at ${fmtTime12(first.time) || "—"}.` : "",
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
      const upcoming = mine.find(a => a.date >= today && !isCanceledAppointment(a) && a.status !== "completed");
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

  // ---- INVENTORY: low-stock heads-up ---------------------------------
  //
  // Only fires when the stylist actually uses inventory AND something
  // is at/below threshold. Items with threshold 0 are opted out by
  // design — that's the "don't alert me" signal from the editor.
  // Priority climbs with severity: any out-of-stock active item bumps
  // the insight to "high"; otherwise it stays "low" so the dashboard
  // doesn't shout about a normal restock cue.
  const inv = safeArr(input.inventoryItems);
  if (inv.length > 0) {
    const low = inv.filter((i: any) => {
      if (!i || i.archivedAt) return false;
      const t = num(i.lowStockThreshold);
      if (t <= 0) return false;
      return num(i.quantityOnHand) <= t;
    });
    if (low.length > 0) {
      low.sort((a: any, b: any) =>
        (num(a.lowStockThreshold) - num(a.quantityOnHand) >
         num(b.lowStockThreshold) - num(b.quantityOnHand) ? -1 : 1));
      const outOfStock = low.filter((i: any) => num(i.quantityOnHand) <= 0).length;
      const sample = low.slice(0, 3).map((i: any) => i.name).filter(Boolean).join(", ");
      const more = Math.max(0, low.length - 3);
      out.push({
        id: "inventory_low_stock",
        category: "productivity",
        title: outOfStock > 0
          ? `${outOfStock === 1 ? "1 item is" : `${outOfStock} items are`} out of stock`
          : `${low.length} ${low.length === 1 ? "item is" : "items are"} low on stock`,
        body: sample
          ? `${sample}${more > 0 ? ` and ${more} more` : ""} — restock before your next booking.`
          : "Some inventory dipped below your alert threshold.",
        priority: outOfStock > 0 ? "high" : "low",
        actionLabel: "View inventory",
        actionTarget: "tab:settings:inventory",
        createdAt: now,
      });
    }
  }

  return out
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
    .slice(0, 5);
};
