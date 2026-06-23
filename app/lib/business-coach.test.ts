import { describe, it, expect } from "vitest";
import {
  buildCoachSnapshot,
  cleanSnapshot,
  snapshotFacts,
  buildCoachSystem,
  coachTool,
  parseCoachBriefing,
  COACH_TOOL_NAME,
  type CoachSnapshot,
} from "./business-coach";

const TODAY = "2026-06-15";

const clients = [
  { id: "a", name: "Amara Jones" },
  { id: "b", name: "Keisha Bell" },
];

const appointments = [
  // Amara: completed knotless 75 days ago (rebook window 6wk) -> overdue, no future booking
  { id: "1", clientId: "a", date: "2026-04-01", style: "Knotless Box Braids", status: "completed", paymentStatus: "paid", totalPrice: 220, balanceDue: 0 },
  // Keisha: paid this month (revenue) ...
  { id: "2", clientId: "b", date: "2026-06-02", style: "Passion Twists", status: "completed", paymentStatus: "paid", totalPrice: 180, balanceDue: 0 },
  // ... and an upcoming appt today (so NOT a rebooking opportunity)
  { id: "3", clientId: "b", date: "2026-06-15", style: "Passion Twists", status: "scheduled", totalPrice: 180, balanceDue: 90 },
];

describe("buildCoachSnapshot", () => {
  const snap = buildCoachSnapshot(clients, appointments, TODAY, "USD");

  it("counts today's non-completed appointments", () => {
    expect(snap.appts.todayCount).toBe(1);
    expect(snap.appts.next7Count).toBeGreaterThanOrEqual(1);
  });

  it("sums this-month revenue from paid appts", () => {
    expect(snap.revenue.thisMonth).toBe(180); // Keisha's June appt; Amara's was April
  });

  it("classifies an unpaid balance on today's appointment as due-today, not earned", () => {
    // Appt #3 is today (2026-06-15), scheduled, $90 balance -> service not
    // rendered yet, so it is collected at the chair, NOT already earned.
    expect(snap.revenue.balances.dueToday).toBe(90);
    expect(snap.revenue.balances.earnedUnpaid).toBe(0);
    expect(snap.revenue.balances.upcoming).toBe(0);
  });

  it("treats a past unpaid appointment as already-earned, and a future one as upcoming", () => {
    const snap2 = buildCoachSnapshot(
      clients,
      [
        // Past, unpaid -> service rendered, genuinely owed.
        { id: "p", clientId: "a", date: "2026-06-10", status: "scheduled", totalPrice: 200, balanceDue: 200 },
        // Future, unpaid -> not earned yet.
        { id: "f", clientId: "b", date: "2026-06-20", status: "scheduled", totalPrice: 150, balanceDue: 150 },
      ],
      TODAY,
      "USD",
    );
    expect(snap2.revenue.balances.earnedUnpaid).toBe(200);
    expect(snap2.revenue.balances.upcoming).toBe(150);
    expect(snap2.revenue.balances.dueToday).toBe(0);
  });

  it("scopes the month pipeline to today→end-of-month, net of discounts, and excludes already-paid/out-of-month rows", () => {
    const snap2 = buildCoachSnapshot(
      clients,
      [
        // In month, still to come, $200 net (250 - 50 discount) -> counts.
        { id: "m1", clientId: "a", date: "2026-06-20", status: "scheduled", totalPrice: 250, discountAmount: 50, balanceDue: 250 },
        // Today, scheduled, not paid -> counts ($120).
        { id: "m2", clientId: "b", date: "2026-06-15", status: "scheduled", totalPrice: 120, balanceDue: 120 },
        // Next month -> excluded.
        { id: "m3", clientId: "a", date: "2026-07-02", status: "scheduled", totalPrice: 300, balanceDue: 300 },
        // Already paid this month -> excluded (earned, not pipeline).
        { id: "m4", clientId: "b", date: "2026-06-22", status: "scheduled", paymentStatus: "paid", totalPrice: 200, balanceDue: 0 },
        // Personal/blocked time -> excluded.
        { id: "m5", date: "2026-06-18", kind: "blocked" },
      ],
      TODAY,
      "USD",
    );
    expect(snap2.appts.bookedThisMonthCount).toBe(2);
    expect(snap2.appts.bookedThisMonthValue).toBe(320); // 200 + 120
  });

  it("surfaces overdue clients as rebooking opportunities, newest-overdue first", () => {
    expect(snap.rebooking.due).toBeGreaterThanOrEqual(1);
    expect(snap.topOpportunities[0]?.firstName).toBe("Amara");
    // the rebooking engine normalizes the raw style to a display label
    expect(snap.topOpportunities[0]?.style?.toLowerCase()).toContain("knotless");
    expect(snap.topOpportunities[0]?.daysOverdue).toBeGreaterThan(0);
  });

  it("reports client totals", () => {
    expect(snap.clients.total).toBe(2);
  });

  it("builds a 7-day workload read and flags missing days off", () => {
    expect(snap.workload.next7).toHaveLength(7);
    // Only appt #3 is in the next 7 days (today), so 6 of 7 days are off.
    expect(snap.workload.daysOffNext7).toBe(6);
    expect(snap.workload.todayCount).toBe(1);
  });

  it("detects a long back-to-back stretch with no day off", () => {
    // Five consecutive days each carrying a booking, starting today.
    const back2back = Array.from({ length: 5 }, (_, i) => {
      const d = new Date("2026-06-15T00:00:00");
      d.setDate(d.getDate() + i);
      return {
        id: `b${i}`, clientId: "a", date: d.toISOString().slice(0, 10),
        status: "scheduled", totalPrice: 200, balanceDue: 0, durationHours: 6,
      };
    });
    const s = buildCoachSnapshot(clients, back2back, TODAY, "USD");
    expect(s.workload.longestStretch).toBeGreaterThanOrEqual(5);
    expect(s.workload.daysOffNext7).toBe(2); // 5 worked of 7
    expect(s.workload.todayHours).toBe(6);
  });

  it("treats a personal/blocked entry as time off, not a booking", () => {
    const s = buildCoachSnapshot(
      clients,
      [{ id: "off", date: "2026-06-16", kind: "personal", eventTitle: "Rest day" }],
      TODAY,
      "USD",
    );
    const tomorrow = s.workload.next7.find((d) => d.date === "2026-06-16");
    expect(tomorrow?.isOff).toBe(true);
    expect(tomorrow?.hasTimeOff).toBe(true);
    expect(s.workload.timeOffScheduledNext7).toBe(true);
  });

  it("computes monthly goal progress when a goal is provided", () => {
    // thisMonth revenue is 180; goal 600 -> 30%, 420 to go.
    const s = buildCoachSnapshot(clients, appointments, TODAY, "USD", 800, 600);
    expect(s.goal.amount).toBe(600);
    expect(s.goal.revenueThisMonth).toBe(180);
    expect(s.goal.progressPct).toBe(30);
    expect(s.goal.remaining).toBe(420);
  });

  it("folds shop sales into monthly goal progress", () => {
    // service thisMonth revenue is 180; + 120 shop sales = 300 of a 600 goal
    // -> 50%, 300 to go.
    const s = buildCoachSnapshot(clients, appointments, TODAY, "USD", 800, 600, 120);
    expect(s.goal.revenueThisMonth).toBe(300);
    expect(s.goal.progressPct).toBe(50);
    expect(s.goal.remaining).toBe(300);
  });

  it("leaves the goal null when none is set", () => {
    expect(snap.goal.amount).toBeNull();
    expect(snap.goal.progressPct).toBeNull();
  });

  it("flags the top of the month only in the first days", () => {
    expect(buildCoachSnapshot(clients, [], "2026-06-02").period.isTopOfMonth).toBe(true);
    expect(buildCoachSnapshot(clients, [], "2026-06-15").period.isTopOfMonth).toBe(false);
    expect(buildCoachSnapshot(clients, [], "2026-06-02").period.monthLabel).toBe("June");
  });

  it("does not throw on empty / garbage input", () => {
    expect(() => buildCoachSnapshot([], [], TODAY)).not.toThrow();
    expect(() => buildCoachSnapshot(null as any, null as any, TODAY)).not.toThrow();
  });
});

describe("snapshotFacts", () => {
  const snap = buildCoachSnapshot(clients, appointments, TODAY, "USD");
  it("renders the key numbers as text", () => {
    const facts = snapshotFacts(snap);
    expect(facts).toContain("Revenue this month: $180");
    expect(facts).toContain("Appointments today: 1");
    expect(facts).toContain("Amara");
  });

  it("labels today's balance as collect-at-the-chair, not already earned", () => {
    const facts = snapshotFacts(snap);
    expect(facts).toContain("today's appointments");
    // The $90 today balance must NOT be framed as already-earned/owed.
    expect(facts).not.toContain("Already-earned unpaid balances");
  });

  it("labels future balances as not-yet-earned", () => {
    const snapFuture = buildCoachSnapshot(
      clients,
      [{ id: "f", clientId: "b", date: "2026-06-25", status: "scheduled", totalPrice: 150, balanceDue: 150 }],
      TODAY,
      "USD",
    );
    const facts = snapshotFacts(snapFuture);
    expect(facts).toContain("NOT yet earned");
  });
});

describe("buildCoachSystem", () => {
  const snap = buildCoachSnapshot(clients, appointments, TODAY, "USD");
  it("includes the business name and forbids inventing figures", () => {
    const sys = buildCoachSystem(snap, { businessName: "Boss Braids", ownerFirstName: "Nia" });
    expect(sys).toContain("Boss Braids");
    expect(sys).toContain("Nia");
    expect(sys.toLowerCase()).toContain("never invent");
  });

  it("reminds the coach this is a service business and future balances aren't owed", () => {
    const sys = buildCoachSystem(snap, { businessName: "Boss Braids" });
    expect(sys.toLowerCase()).toContain("service business");
    expect(sys.toLowerCase()).toContain("not earned yet");
  });

  it("instructs the coach on wellbeing, new-client growth, and the monthly goal", () => {
    const sys = buildCoachSystem(snap, { businessName: "Boss Braids" });
    expect(sys.toLowerCase()).toContain("burn out");
    expect(sys.toLowerCase()).toContain("day off");
    expect(sys.toLowerCase()).toContain("new clientele");
    expect(sys.toLowerCase()).toContain("monthlycheckin");
  });
});

describe("coachTool", () => {
  it("declares the briefing tool with required fields", () => {
    const t = coachTool();
    expect(t.name).toBe(COACH_TOOL_NAME);
    expect(t.input_schema.required).toContain("actions");
  });
});

describe("cleanSnapshot", () => {
  it("coerces wire data and clamps arrays", () => {
    const dirty = {
      currency: "GBP",
      revenue: { thisMonth: "500", momChangePct: "abc" },
      appts: { todayCount: 2 },
      topOpportunities: Array.from({ length: 9 }, (_, i) => ({ firstName: `c${i}`, daysOverdue: `${i}`, value: 100 })),
    };
    const snap = cleanSnapshot(dirty);
    expect(snap.currency).toBe("GBP");
    expect(snap.revenue.thisMonth).toBe(500);
    expect(snap.revenue.momChangePct).toBeNull(); // "abc" -> null
    expect(snap.appts.todayCount).toBe(2);
    expect(snap.topOpportunities.length).toBe(5); // clamped
  });

  it("fills safe defaults from empty input", () => {
    const snap = cleanSnapshot({});
    expect(snap.currency).toBe("USD");
    expect(snap.revenue.thisMonth).toBe(0);
    expect(snap.topOpportunities).toEqual([]);
  });
});

describe("parseCoachBriefing", () => {
  it("keeps valid actions and clamps to 4, filling defaults", () => {
    const out = parseCoachBriefing({
      headline: "Strong week!",
      summary: "Revenue is up.",
      actions: [
        { title: "Rebook Amara", detail: "She's 33 days overdue." },
        { title: "" }, // dropped (no title)
        { title: "Collect balances", detail: "$90 outstanding." },
      ],
      encouragement: "Keep going!",
    });
    expect(out?.headline).toBe("Strong week!");
    expect(out?.actions).toHaveLength(2);
    expect(out?.actions[0].title).toBe("Rebook Amara");
  });

  it("keeps wellbeing and monthlyCheckIn fields, defaulting to empty strings", () => {
    const withWell = parseCoachBriefing({
      headline: "Hi", summary: "s",
      wellbeing: "Take Sunday off — you've worked 6 days straight.",
      monthlyCheckIn: "New month: aim for $1,800.",
    });
    expect(withWell?.wellbeing).toContain("Sunday");
    expect(withWell?.monthlyCheckIn).toContain("1,800");
    const without = parseCoachBriefing({ headline: "Hi", summary: "s" });
    expect(without?.wellbeing).toBe("");
    expect(without?.monthlyCheckIn).toBe("");
  });

  it("returns null when there's no headline or summary", () => {
    expect(parseCoachBriefing({ actions: [] })).toBeNull();
  });

  it("supplies a fallback headline when only a summary is present", () => {
    const out = parseCoachBriefing({ summary: "Quiet day ahead." });
    expect(out?.headline).toBeTruthy();
    expect(out?.summary).toBe("Quiet day ahead.");
  });
});

// Type-level sanity: the snapshot shape is stable.
const _typecheck: CoachSnapshot = buildCoachSnapshot([], [], TODAY);
void _typecheck;
