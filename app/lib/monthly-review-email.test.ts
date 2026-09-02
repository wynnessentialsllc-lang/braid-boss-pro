// Tests for the month in review report email.
//
// The renderer is a pure function, so these assert on the rendered
// markup and text directly. No network, no database, no mail.
//
// The theme running through them: a monthly report is a claim about the
// stylist's business, and every claim has to be backed by data the
// caller actually supplied. Most of what follows checks that a missing
// figure removes its section instead of rendering a zero, a placeholder,
// or a percentage divided by nothing.

import { describe, expect, it } from "vitest";

import {
  changePct,
  dollars,
  hourLabel,
  renderMonthlyReview,
  type MonthlyReviewArgs,
} from "../../supabase/functions/_shared/monthly-review-email.ts";
import { FIXTURES } from "../../supabase/functions/_shared/email-fixtures.ts";

const BASE: MonthlyReviewArgs = {
  studioName: "SBW Braiding",
  monthLabel: "August 2026",
  prevMonthLabel: "July 2026",
  currency: "USD",
  revenue: 6420,
  prevRevenue: 5480,
  salesCount: 27,
  prevSalesCount: 23,
  customersServed: 22,
  newCustomers: 8,
  returningCustomers: 14,
  daysWithSales: 13,
  bestWeekday: "Saturday",
  bestWeekdayAvg: 780,
  avgDailySales: 494,
  byWeekday: [
    { weekday: "Thursday", sales: 420 },
    { weekday: "Friday", sales: 610 },
    { weekday: "Saturday", sales: 780 },
  ],
  byHour: [
    { hour: 9, sales: 640 },
    { hour: 15, sales: 1860 },
  ],
  busiestDate: "2026-08-15",
  busiestDateSales: 1240,
  topServiceName: "Knotless Box Braids",
  topServiceSales: 2480,
  items: [
    { name: "Knotless Box Braids", count: 8, sales: 2480 },
    { name: "Edge Control 4oz", count: 14, sales: 336 },
  ],
};

const render = (over: Partial<MonthlyReviewArgs> = {}) =>
  renderMonthlyReview({ ...BASE, ...over });

// ---------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------

describe("formatting helpers", () => {
  it("shows cents only when there are cents", () => {
    // Every row of the top-sellers table has to format the same way, so
    // the rule keys off the value, not its size.
    expect(dollars(6420)).toBe("$6,420");
    expect(dollars(336)).toBe("$336");
    expect(dollars(215)).toBe("$215");
    expect(dollars(1240.5)).toBe("$1,240.50");
    expect(dollars(237.78)).toBe("$237.78");
  });

  it("survives a junk amount rather than rendering NaN", () => {
    expect(dollars(undefined)).toBe("$0");
    expect(dollars("not a number")).toBe("$0");
  });

  it("labels hours in 12-hour clock, with noon and midnight correct", () => {
    expect(hourLabel(0)).toBe("12 AM");
    expect(hourLabel(9)).toBe("9 AM");
    expect(hourLabel(12)).toBe("12 PM");
    expect(hourLabel(17)).toBe("5 PM");
  });

  it("returns nothing for an hour outside the clock", () => {
    expect(hourLabel(24)).toBe("");
    expect(hourLabel(-1)).toBe("");
    expect(hourLabel("evening")).toBe("");
    // Number(null) and Number("") are both 0, so these would otherwise
    // report a midnight sale that never happened.
    expect(hourLabel(null)).toBe("");
    expect(hourLabel(undefined)).toBe("");
    expect(hourLabel("")).toBe("");
  });

  it("drops an hour with no recorded time from the chart", () => {
    const { html } = renderMonthlyReview({
      ...BASE,
      byHour: [{ hour: null as unknown as number, sales: 900 }],
    });
    expect(html).not.toContain("When the money came in");
  });

  it("refuses to compute a percentage against a zero prior month", () => {
    // Dividing by a month that earned nothing is not growth, it is a
    // division by nothing. The report must say nothing instead.
    expect(changePct(500, 0)).toBeNull();
    expect(changePct(500, null)).toBeNull();
    expect(changePct(500, undefined)).toBeNull();
  });

  it("rounds a real comparison in both directions", () => {
    expect(changePct(6420, 5480)).toBe(17);
    expect(changePct(3120, 5480)).toBe(-43);
    expect(changePct(100, 100)).toBe(0);
  });
});

// ---------------------------------------------------------------------
// The report as a whole
// ---------------------------------------------------------------------

describe("month in review", () => {
  it("names the month and the studio in the subject", () => {
    const { subject } = render();
    expect(subject).toBe("August 2026 in review: SBW Braiding");
  });

  it("drops the studio from the subject when there is no name on file", () => {
    expect(render({ studioName: null }).subject).toBe("August 2026 in review");
  });

  it("leads with the total collected", () => {
    const { html, preheader } = render();
    expect(html).toContain("Total collected");
    expect(html).toContain("$6,420");
    expect(preheader).toBe("$6,420 collected across 27 sales.");
  });

  it("renders a complete HTML document pinned to light mode", () => {
    const { html } = render();
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<meta name="color-scheme" content="light only" />');
    // The brand shell: white card, purple accent, coral rule.
    expect(html).toContain("#FFFFFF");
    expect(html).toContain("#7C3AED");
    expect(html).toContain("#FF4D6D");
  });

  it("states the month-over-month change when there is a month to compare", () => {
    const { html, text } = render();
    expect(html).toContain("17% up from July 2026");
    expect(text).toContain("17% up on July 2026");
  });

  it("flips the comparison to down on a slower month", () => {
    const { html } = render({ revenue: 3120, prevRevenue: 5480 });
    expect(html).toContain("43% down from July 2026");
    // Coral, the brand's warning hue, not the success green.
    expect(html).toContain("#E0354F");
  });

  it("says nothing about growth in a first month with sales", () => {
    const { html, text } = render({ prevRevenue: 0, prevSalesCount: 0 });
    expect(html).not.toContain("from July 2026");
    expect(html).not.toContain("up from");
    expect(text).not.toContain("up on");
  });

  it("counts new and returning clients as a share of everyone served", () => {
    const { html } = render();
    // 8 of 22 new, 14 of 22 returning. The separator must reach the
    // inbox as a character, not as an escaped "&amp;middot;".
    expect(html).toContain("8 \u00b7 36%");
    expect(html).toContain("14 \u00b7 64%");
    expect(html).not.toContain("&amp;middot;");
    expect(html).toContain("64% of the clients you served last month had been to you before.");
  });

  it("reframes a month of only first timers as a rebooking prompt", () => {
    const { html } = render({ customersServed: 5, newCustomers: 5, returningCustomers: 0 });
    expect(html).toContain("Every client last month was a first timer.");
  });

  it("drops the client section entirely when nobody was served", () => {
    const { html } = render({ customersServed: 0, newCustomers: 0, returningCustomers: 0 });
    expect(html).not.toContain("Your clients");
  });

  it("names the best weekday and compares it with a typical working day", () => {
    const { html } = render();
    expect(html).toContain("Best day of the week");
    expect(html).toContain(">Saturday<");
    expect(html).toContain("A Saturday averaged $780 against $494 on a typical working day.");
  });

  it("drops the best-day section when only one day earned", () => {
    // With a single working day there is no weekly pattern to report,
    // and naming that day the best of the week overstates the data.
    const { html } = render({
      daysWithSales: 1,
      byWeekday: [{ weekday: "Saturday", sales: 215 }],
    });
    expect(html).not.toContain("Best day of the week");
  });

  it("skips the comparison line when the best day equals the average", () => {
    const { html } = render({
      daysWithSales: 4,
      bestWeekdayAvg: 500,
      avgDailySales: 500,
    });
    expect(html).toContain("Best day of the week");
    expect(html).not.toContain("on a typical working day");
  });

  it("orders the weekday chart by the calendar, not by size", () => {
    const { html } = render({
      byWeekday: [
        { weekday: "Saturday", sales: 780 },
        { weekday: "Thursday", sales: 420 },
        { weekday: "Friday", sales: 610 },
      ],
    });
    const thu = html.indexOf(">Thu<");
    const fri = html.indexOf(">Fri<");
    const sat = html.indexOf(">Sat<");
    expect(thu).toBeGreaterThan(-1);
    expect(thu).toBeLessThan(fri);
    expect(fri).toBeLessThan(sat);
  });

  it("ignores a weekday value that is not a weekday", () => {
    const { html } = render({
      byWeekday: [
        { weekday: "Saturday", sales: 780 },
        { weekday: "Someday", sales: 999 },
      ],
    });
    expect(html).not.toContain("Som");
    expect(html).not.toContain("$999");
  });

  it("shows the hours that earned and points at the busiest one", () => {
    const { html } = render();
    expect(html).toContain("When the money came in");
    expect(html).toContain("9 AM");
    expect(html).toContain("3 PM");
    expect(html).toContain("Your 3 PM hour brought in the most.");
  });

  it("drops the hour chart when no appointment recorded a time", () => {
    // appt_time is nullable, and a stylist who books by phone often
    // leaves it empty. Better no chart than a chart of one bar at
    // whatever hour we guessed.
    const { html } = render({ byHour: [] });
    expect(html).not.toContain("When the money came in");
  });

  it("drops an hour with no sales rather than drawing an empty bar", () => {
    const { html } = render({
      byHour: [
        { hour: 9, sales: 640 },
        { hour: 22, sales: 0 },
      ],
    });
    expect(html).toContain("9 AM");
    expect(html).not.toContain("10 PM");
  });

  it("names the biggest day in full", () => {
    const { html } = render();
    expect(html).toContain("Biggest day");
    expect(html).toContain("Saturday, August 15");
    expect(html).toContain("$1,240");
  });

  it("drops the biggest-day card when there is no day to name", () => {
    expect(render({ busiestDate: null }).html).not.toContain("Biggest day");
    expect(render({ busiestDateSales: 0 }).html).not.toContain("Biggest day");
  });

  it("lists top sellers with their counts", () => {
    const { html } = render();
    expect(html).toContain("Top sellers");
    expect(html).toContain("Knotless Box Braids");
    expect(html).toContain("Edge Control 4oz");
    expect(html).toContain("&times; 14");
  });

  it("caps the item list so one busy month cannot run to three screens", () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      name: `Service ${i}`,
      count: 1,
      sales: 100 - i,
    }));
    const { html } = render({ items });
    expect(html).toContain("Service 7");
    expect(html).not.toContain("Service 8");
  });

  it("drops the whole sellers section when nothing is known about items", () => {
    const { html } = render({ items: [], topServiceName: null });
    expect(html).not.toContain("Top sellers");
  });

  it("always offers the dashboard and a way to turn the report off", () => {
    const { html } = render({
      dashboardUrl: "https://braidbosspro.app",
      settingsUrl: "https://braidbosspro.app/settings",
    });
    expect(html).toContain('href="https://braidbosspro.app"');
    expect(html).toContain('href="https://braidbosspro.app/settings"');
    expect(html).toContain("Turn this report off");
  });

  it("refuses a non-http link rather than rendering it", () => {
    const { html } = render({ settingsUrl: "javascript:alert(1)" });
    expect(html).not.toContain("javascript:alert");
  });

  it("escapes a studio name that contains markup", () => {
    const { html } = render({ studioName: `<script>alert("x")</script>` });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes an item name that contains markup", () => {
    const { html } = render({
      items: [{ name: `<img src=x onerror=alert(1)>`, count: 1, sales: 10 }],
    });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });

  it("still renders when every optional field is absent", () => {
    // The floor case: the aggregator guarantees revenue, and nothing else.
    const { html, subject, text } = renderMonthlyReview({
      monthLabel: "August 2026",
      revenue: 215,
      salesCount: 1,
      customersServed: 1,
      newCustomers: 1,
      returningCustomers: 0,
    });
    expect(subject).toBe("August 2026 in review");
    expect(html).toContain("$215");
    expect(html).toContain("Open your dashboard");
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
    expect(text).toContain("Total collected: $215");
  });

  it("writes a plain text alternative that carries the same numbers", () => {
    const { text } = render();
    expect(text).toContain("August 2026 in review for SBW Braiding");
    expect(text).toContain("Total collected: $6,420");
    expect(text).toContain("Clients served: 22");
    expect(text).toContain("New clients: 8");
    expect(text).toContain("Returning clients: 14");
    expect(text).toContain("Best day of the week: Saturday");
    expect(text).toContain("Top seller: Knotless Box Braids");
    expect(text).not.toContain("<");
  });

  it("keeps the singular reading when the month held one sale", () => {
    const { preheader } = render({ salesCount: 1 });
    expect(preheader).toContain("1 sale.");
  });
});

// ---------------------------------------------------------------------
// Preview fixtures
// ---------------------------------------------------------------------

describe("month in review fixtures", () => {
  const monthly = FIXTURES.filter((f) => f.group === "7. Month in review");

  it("are registered for the dev preview route", () => {
    expect(monthly.length).toBeGreaterThanOrEqual(4);
  });

  it("every fixture renders a complete document with a subject and text part", () => {
    for (const f of monthly) {
      const r = f.render();
      expect(r.subject, f.id).not.toBe("");
      expect(r.html.startsWith("<!doctype html>"), f.id).toBe(true);
      expect(r.html.trimEnd().endsWith("</html>"), f.id).toBe(true);
      expect(r.text.length, f.id).toBeGreaterThan(0);
      // A template hole shows up as a literal "undefined" or "NaN" long
      // before anyone reads the numbers, so fail on either.
      expect(r.html, f.id).not.toContain("undefined");
      expect(r.html, f.id).not.toContain("NaN");
      expect(r.text, f.id).not.toContain("undefined");
      expect(r.text, f.id).not.toContain("NaN");
    }
  });

  it("keeps fixture ids unique across the whole preview index", () => {
    const ids = FIXTURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
