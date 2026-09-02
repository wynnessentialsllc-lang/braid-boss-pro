// Braid Boss Pro — month in review.
//
// The stylist's own monthly recap, mailed on the first of the month
// covering the month that just closed. It is the monthly sibling of the
// end-of-day summary (notification_type = 'daily_sales_summary'): same
// aggregation vocabulary, a wider window, and the one thing a daily
// report can never show, which is whether this month beat the last one.
//
// Pure render module, like ./lifecycle-emails.ts: no Deno APIs, no env
// reads, no I/O. The Deno worker, the dev preview route, and the unit
// tests all call the same function, so what the preview shows is byte
// for byte what Resend sends.
//
// Numbers arrive in the currency's MAJOR unit (dollars), matching the
// shape process_monthly_review_reports() builds in SQL. That differs
// from email-kit's money(), which takes minor units for Stripe, so this
// module formats its own amounts and never calls that helper.
//
// Copy rules carried over from the lifecycle templates:
//   • no em dashes in stylist-facing copy
//   • never state a comparison, a best day, or a top seller unless the
//     caller actually supplied the data behind it. Every block below
//     drops out rather than rendering a zero or a placeholder.

import {
  C,
  FONT_BODY,
  FONT_DISPLAY,
  band,
  button,
  document_,
  esc,
  escUrl,
  eyebrow,
  footer,
  headline,
  masthead,
  normalizeBase,
  p,
  rule,
  textBody,
  textFooter,
  type RenderedEmail,
} from "./email-kit.ts";

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

export type MonthlyItem = {
  name: string;
  /** Units sold, or appointments served for a service. */
  count?: number | null;
  sales: number;
};

export type MonthlyWeekday = {
  /** Full weekday name, e.g. "Saturday". */
  weekday: string;
  /** Average taken on that weekday across the days it earned. */
  sales: number;
};

export type MonthlyHour = {
  /** 0-23, local to the stylist. */
  hour: number;
  sales: number;
};

export type MonthlyReviewArgs = {
  studioName?: string | null;
  /** e.g. "August 2026". Rendered verbatim as the report's title. */
  monthLabel: string;
  /** e.g. "July 2026". Only used to name the month being compared to. */
  prevMonthLabel?: string | null;
  currency?: string | null;

  /** Total collected across appointments and shop orders, in dollars. */
  revenue: number;
  /** Same figure for the month before. Omit when it is unknown. */
  prevRevenue?: number | null;
  salesCount: number;
  prevSalesCount?: number | null;

  customersServed: number;
  newCustomers: number;
  returningCustomers: number;

  /** Calendar days in the month that took at least one payment. */
  daysWithSales?: number | null;
  /** Strongest weekday by average, e.g. "Saturday". */
  bestWeekday?: string | null;
  bestWeekdayAvg?: number | null;
  /** Average across the days that earned, not across every calendar day. */
  avgDailySales?: number | null;
  byWeekday?: MonthlyWeekday[] | null;
  byHour?: MonthlyHour[] | null;

  /** Single biggest day of the month. */
  busiestDate?: string | null;
  busiestDateSales?: number | null;

  topServiceName?: string | null;
  topServiceSales?: number | null;
  items?: MonthlyItem[] | null;

  dashboardUrl?: string | null;
  /** Where the recipient turns this report off. */
  settingsUrl?: string | null;
  baseUrl?: string | null;
};

// ---------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Currency in MAJOR units.
 *
 * Cents appear only when there are cents. A month's figures are mostly
 * round, and ".00" on every second row of the top-sellers table reads
 * as noise beside the ones that need it.
 */
export const dollars = (value: unknown, currency = "USD"): string => {
  const n = num(value);
  const code = String(currency || "USD").toUpperCase();
  const digits = Number.isInteger(n) ? 0 : 2;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(n);
  } catch {
    return `$${n.toFixed(digits)}`;
  }
};

/** Thousands-separated whole number. */
const count = (v: unknown): string => {
  const n = Math.round(num(v));
  try {
    return new Intl.NumberFormat("en-US").format(n);
  } catch {
    return String(n);
  }
};

/**
 * "9 AM", "12 PM", "5 PM". Anything that is not an hour of the day
 * returns "", and the caller drops that bar.
 *
 * Deliberately NOT routed through num(), which folds a non-numeric
 * value to 0: that would turn a null or malformed hour into a
 * confident claim that the money came in at midnight.
 */
export const hourLabel = (hour: unknown): string => {
  // Number(null) and Number("") are both 0, which is the same midnight
  // trap by another route, so an absent hour is rejected before the cast.
  if (hour === null || hour === undefined) return "";
  if (typeof hour === "string" && hour.trim() === "") return "";
  const raw = Number(hour);
  if (!Number.isFinite(raw)) return "";
  const h = Math.trunc(raw);
  if (h < 0 || h > 23) return "";
  const suffix = h < 12 ? "AM" : "PM";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve} ${suffix}`;
};

/** "Saturday, August 16". Falls back to the raw string when unparseable. */
const longDay = (iso: unknown): string => {
  const s = String(iso ?? "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return s;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return s;
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    }).format(d);
  } catch {
    return s;
  }
};

/**
 * Percentage change against the prior month.
 *
 * Returns null when there is nothing honest to compare against: no
 * prior figure supplied, or a prior month of zero, where any percentage
 * would be a division by nothing dressed up as growth.
 */
export const changePct = (
  current: unknown,
  previous: unknown,
): number | null => {
  const prev = num(previous);
  if (!Number.isFinite(prev) || prev <= 0) return null;
  const pct = ((num(current) - prev) / prev) * 100;
  if (!Number.isFinite(pct)) return null;
  return Math.round(pct);
};

// ---------------------------------------------------------------------
// Report components
//
// Kept local rather than pushed into email-kit: they exist to draw one
// report, and the kit stays the vocabulary the auth and billing mail
// already shares.
// ---------------------------------------------------------------------

/** One labelled figure on a faint lavender card. */
const statTile = (opts: {
  label: string;
  value: string;
  color: string;
  first?: boolean;
}): string => `
  <td class="bbp-card" width="50%" valign="top" style="width:50%;padding:${
    opts.first ? "0 5px 10px 0" : "0 0 10px 5px"
  };">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
      <tr>
        <td bgcolor="${C.tintSoft}" style="background-color:${C.tintSoft};border:1px solid ${C.hairline};border-radius:12px;padding:16px 18px;">
          <p style="margin:0;font-family:${FONT_BODY};font-size:11px;line-height:15px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${C.muted};">${esc(
            opts.label,
          )}</p>
          <p style="margin:7px 0 0;font-family:${FONT_DISPLAY};font-size:28px;line-height:1;font-weight:700;color:${
            opts.color
          };">${esc(opts.value)}</p>
        </td>
      </tr>
    </table>
  </td>`;

/**
 * One horizontal bar. Widths are percentages inside a nested table,
 * which is the only bar geometry that survives Outlook, Gmail, and
 * Apple Mail alike. A zero row still draws a hairline stub so the
 * label stays aligned with the rows above it.
 */
const barRow = (opts: {
  label: string;
  value: string;
  pct: number;
  color: string;
  dim?: boolean;
}): string => {
  const filled = Math.max(0, Math.min(100, Math.round(opts.pct)));
  // 2% keeps an empty bar visible as a dot instead of collapsing the
  // cell, which some clients render as a full-width block.
  const drawn = filled > 0 ? Math.max(filled, 3) : 2;
  const rest = 100 - drawn;
  const color = opts.dim ? C.hairline : opts.color;
  return `
  <tr>
    <td width="74" valign="middle" style="width:74px;padding:5px 10px 5px 0;font-family:${FONT_BODY};font-size:12px;line-height:16px;font-weight:700;color:${
      opts.dim ? C.mutedSoft : C.body
    };white-space:nowrap;">${esc(opts.label)}</td>
    <td valign="middle" style="padding:5px 10px 5px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;table-layout:fixed;">
        <tr>
          <td width="${drawn}%" bgcolor="${color}" style="width:${drawn}%;height:12px;background-color:${color};border-radius:6px;font-size:0;line-height:0;">&nbsp;</td>
          <td width="${rest}%" style="width:${rest}%;font-size:0;line-height:0;">&nbsp;</td>
        </tr>
      </table>
    </td>
    <td width="84" valign="middle" align="right" style="width:84px;padding:5px 0;font-family:${FONT_BODY};font-size:13px;line-height:16px;font-weight:700;color:${
      opts.dim ? C.mutedSoft : C.ink
    };text-align:right;white-space:nowrap;">${esc(opts.value)}</td>
  </tr>`;
};

const barChart = (rows: string[]): string =>
  rows.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">${rows.join(
        "",
      )}</table>`
    : "";

/** Section label inside the report body. */
const sectionLabel = (text: string, color: string = C.purple): string =>
  `<p style="margin:0 0 12px;font-family:${FONT_BODY};font-size:11px;line-height:16px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:${color};">${esc(
    text,
  )}</p>`;

/**
 * The month-over-month pill under the headline figure. Green for up,
 * coral for down, and nothing at all when there is no prior month to
 * measure against.
 */
const deltaPill = (pct: number | null, prevMonthLabel: string): string => {
  if (pct === null) return "";
  const up = pct >= 0;
  // Solid white, not a translucent tint: this pill sits on the purple
  // hero band, and a colour blended with that purple leaves the text
  // barely readable.
  const bg = C.white;
  const fg = up ? "#0F7A38" : C.coralDeep;
  const arrow = up ? "&#9650;" : "&#9660;";
  const label = `${Math.abs(pct)}% ${up ? "up" : "down"}${
    prevMonthLabel ? ` from ${prevMonthLabel}` : " from last month"
  }`;
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="border-collapse:collapse;margin:14px auto 0;">
    <tr>
      <td bgcolor="${bg}" style="background-color:${bg};border-radius:999px;padding:7px 16px;font-family:${FONT_BODY};font-size:13px;line-height:16px;font-weight:700;color:${fg};">
        <span style="color:${fg};">${arrow}</span>&nbsp;${esc(label)}
      </td>
    </tr>
  </table>`;
};

// ---------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------

/**
 * Render the month in review.
 *
 * The caller only enqueues this when the month actually took money (see
 * process_monthly_review_reports), so the hero figure is always real.
 * Everything below it is optional and self-hiding, which is what lets a
 * stylist with two appointments and no shop orders still receive a
 * report that reads as finished rather than broken.
 */
export const renderMonthlyReview = (args: MonthlyReviewArgs): RenderedEmail => {
  const base = normalizeBase(args.baseUrl);
  const studio = String(args.studioName ?? "").trim();
  const monthLabel = String(args.monthLabel ?? "").trim() || "Last month";
  const prevMonthLabel = String(args.prevMonthLabel ?? "").trim();
  const currency = String(args.currency ?? "USD");
  const fmt = (v: unknown) => dollars(v, currency);

  const revenue = num(args.revenue);
  const salesCount = Math.round(num(args.salesCount));
  const customers = Math.round(num(args.customersServed));
  const newCustomers = Math.round(num(args.newCustomers));
  const returning = Math.round(num(args.returningCustomers));
  const daysWithSales = Math.round(num(args.daysWithSales));
  const revenueDelta = changePct(revenue, args.prevRevenue);
  const salesDelta = changePct(salesCount, args.prevSalesCount);
  const avgTicket = salesCount > 0 ? revenue / salesCount : 0;

  const dashboardUrl = String(args.dashboardUrl ?? "").trim() || base;
  const settingsUrl = String(args.settingsUrl ?? "").trim() || `${base}/settings`;

  const subject = `${monthLabel} in review${studio ? `: ${studio}` : ""}`;
  const preheader = `${fmt(revenue)} collected across ${count(salesCount)} sale${
    salesCount === 1 ? "" : "s"
  }.`;

  // ---- hero ---------------------------------------------------------
  const heroBand = band({
    bg: C.white,
    padding: "32px 32px 8px",
    content: [
      eyebrow("Month in review", C.purple),
      headline(monthLabel, { size: 36 }),
      p(
        studio
          ? `Here is how <strong style="color:${C.ink};">${esc(
              studio,
            )}</strong> did last month.`
          : "Here is how last month went.",
        { margin: "14px 0 0" },
      ),
      rule(C.coral),
    ].join(""),
  });

  // ---- headline figure ----------------------------------------------
  const revenueBand = band({
    bg: C.purple,
    padding: "34px 32px 36px",
    align: "center",
    content: [
      `<p style="margin:0;font-family:${FONT_BODY};font-size:11px;line-height:16px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:rgba(255,255,255,0.78);">Total collected</p>`,
      `<p style="margin:10px 0 0;font-family:${FONT_DISPLAY};font-size:46px;line-height:1.02;font-weight:700;color:${C.white};">${esc(
        fmt(revenue),
      )}</p>`,
      deltaPill(revenueDelta, prevMonthLabel),
    ].join(""),
  });

  // ---- the four counts ----------------------------------------------
  const salesSubLabel = salesDelta === null
    ? ""
    : `<p style="margin:10px 0 0;font-family:${FONT_BODY};font-size:13px;line-height:19px;color:${C.muted};">
         ${esc(
           `${count(salesCount)} sale${salesCount === 1 ? "" : "s"} this month, ${
             salesDelta >= 0 ? "up" : "down"
           } ${Math.abs(salesDelta)}% on ${prevMonthLabel || "the month before"}.`,
         )}
       </p>`;

  const statsBand = band({
    bg: C.white,
    padding: "28px 32px 20px",
    content: [
      sectionLabel("By the numbers"),
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;border-spacing:0;">
        <tr>
          ${statTile({ label: "Sales", value: count(salesCount), color: C.ink, first: true })}
          ${statTile({ label: "Clients served", value: count(customers), color: C.purpleDeep })}
        </tr>
        <tr>
          ${statTile({ label: "New clients", value: count(newCustomers), color: C.lavender, first: true })}
          ${statTile({ label: "Returning", value: count(returning), color: C.coralDeep })}
        </tr>
        ${
          salesCount > 0
            ? `<tr>${statTile({
                label: "Average sale",
                value: fmt(avgTicket),
                color: C.ink,
                first: true,
              })}${
                daysWithSales > 0
                  ? statTile({
                      label: "Days with sales",
                      value: count(daysWithSales),
                      color: C.purpleDeep,
                    })
                  : `<td width="50%" style="width:50%;">&nbsp;</td>`
              }</tr>`
            : ""
        }
      </table>`,
      salesSubLabel,
    ].join(""),
  });

  // ---- new vs returning ---------------------------------------------
  // Square's report shows this split as its own chart, and for a
  // braider it is the one number that says whether the book is
  // filling with strangers or regulars.
  const retentionBand = (() => {
    if (customers <= 0) return "";
    const newPct = Math.round((newCustomers / customers) * 100);
    const returnPct = Math.round((returning / customers) * 100);
    const rows = [
      // barRow escapes its value, so the separator is the character
      // itself. An "&middot;" would reach the inbox as literal text.
      barRow({
        label: "New",
        value: `${count(newCustomers)} \u00b7 ${newPct}%`,
        pct: newPct,
        color: C.lavender,
        dim: newCustomers === 0,
      }),
      barRow({
        label: "Returning",
        value: `${count(returning)} \u00b7 ${returnPct}%`,
        pct: returnPct,
        color: C.purple,
        dim: returning === 0,
      }),
    ];
    const readout = returning > 0 && customers > 0
      ? `${returnPct}% of the clients you served last month had been to you before.`
      : "Every client last month was a first timer. Rebooking them before they leave the chair is how a month like this compounds.";
    return band({
      bg: C.tintSoft,
      padding: "26px 32px 28px",
      content: [
        sectionLabel("Your clients", C.purpleDeep),
        barChart(rows),
        p(esc(readout), { margin: "16px 0 0", size: 14 }),
      ].join(""),
    });
  })();

  // ---- best day of the week ------------------------------------------
  const weekdayBand = (() => {
    const rows = (args.byWeekday || []).filter(
      (r) => r && WEEKDAYS.includes(String(r.weekday) as (typeof WEEKDAYS)[number]),
    );
    const best = String(args.bestWeekday ?? "").trim();
    if (!best && rows.length === 0) return "";
    // One working day is not a pattern. Calling that day the best of the
    // week is a claim the month cannot support, so the section is
    // dropped rather than dressed up.
    if (daysWithSales === 1) return "";

    const peak = rows.reduce((m, r) => Math.max(m, num(r.sales)), 0);
    // Order Sunday first, the way a calendar reads, rather than by size.
    const ordered = WEEKDAYS.map((day) =>
      rows.find((r) => String(r.weekday) === day),
    ).filter((r): r is MonthlyWeekday => Boolean(r));

    const bars = ordered.map((r) => {
      const value = num(r.sales);
      const isBest = best !== "" && String(r.weekday) === best;
      return barRow({
        label: String(r.weekday).slice(0, 3),
        value: fmt(value),
        pct: peak > 0 ? (value / peak) * 100 : 0,
        color: isBest ? C.coral : C.purple,
        dim: value <= 0,
      });
    });

    const bestAvg = num(args.bestWeekdayAvg);
    const dailyAvg = num(args.avgDailySales);
    // Comparing the best day with the average is only worth saying when
    // the two differ. On a month worked in a single weekday they are the
    // same number, and the sentence reads as a bug.
    const compare = best && bestAvg > 0 && dailyAvg > 0 && bestAvg !== dailyAvg
      ? `A ${best} averaged ${dollars(bestAvg, currency)} against ${dollars(
          dailyAvg,
          currency,
        )} on a typical working day.`
      : "";

    return band({
      bg: C.white,
      padding: "28px 32px 24px",
      content: [
        sectionLabel("Best day of the week", C.coralDeep),
        best
          ? `<p style="margin:0 0 16px;font-family:${FONT_DISPLAY};font-size:30px;line-height:1.1;font-weight:700;color:${C.coralDeep};">${esc(
              best,
            )}</p>`
          : "",
        barChart(bars),
        compare ? p(esc(compare), { margin: "16px 0 0", size: 14 }) : "",
      ].join(""),
    });
  })();

  // ---- when the money came in ----------------------------------------
  const hourBand = (() => {
    const rows = (args.byHour || [])
      .filter((r) => r && num(r.sales) > 0 && hourLabel(r.hour) !== "")
      .sort((a, b) => num(a.hour) - num(b.hour));
    if (rows.length === 0) return "";
    const peak = rows.reduce((m, r) => Math.max(m, num(r.sales)), 0);
    const busiest = rows.reduce((m, r) => (num(r.sales) > num(m.sales) ? r : m), rows[0]);

    const bars = rows.map((r) =>
      barRow({
        label: hourLabel(r.hour),
        value: fmt(r.sales),
        pct: peak > 0 ? (num(r.sales) / peak) * 100 : 0,
        color: num(r.hour) === num(busiest.hour) ? C.coral : C.lavender,
      }),
    );

    return band({
      bg: C.tintSoft,
      padding: "26px 32px 28px",
      content: [
        sectionLabel("When the money came in", C.purpleDeep),
        barChart(bars),
        p(
          esc(
            `Your ${hourLabel(
              busiest.hour,
            )} hour brought in the most. Open those slots first when you release next month's book.`,
          ),
          { margin: "16px 0 0", size: 14 },
        ),
      ].join(""),
    });
  })();

  // ---- biggest single day ---------------------------------------------
  const bigDayBand = (() => {
    const label = longDay(args.busiestDate);
    const amount = num(args.busiestDateSales);
    if (!label || amount <= 0) return "";
    return band({
      bg: C.white,
      padding: "24px 32px 4px",
      content: `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
          <tr>
            <td bgcolor="${C.tintSoft}" style="background-color:${C.tintSoft};border:1px solid ${C.hairline};border-radius:12px;padding:18px 20px;">
              <p style="margin:0;font-family:${FONT_BODY};font-size:11px;line-height:15px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${C.muted};">Biggest day</p>
              <p style="margin:8px 0 0;font-family:${FONT_BODY};font-size:16px;line-height:22px;font-weight:700;color:${C.ink};">${esc(
                label,
              )}</p>
              <p style="margin:4px 0 0;font-family:${FONT_DISPLAY};font-size:26px;line-height:1.1;font-weight:700;color:${C.purpleDeep};">${esc(
                fmt(amount),
              )}</p>
            </td>
          </tr>
        </table>`,
    });
  })();

  // ---- top sellers -----------------------------------------------------
  const itemsBand = (() => {
    const items = (args.items || [])
      .filter((it) => it && String(it.name ?? "").trim() !== "")
      .slice(0, 8);
    const topName = String(args.topServiceName ?? "").trim();
    if (items.length === 0 && !topName) return "";

    const rows = items
      .map((it, i) => {
        const qty = Math.round(num(it.count));
        return `<tr>
        <td style="padding:${i === 0 ? "0" : "10px"} 12px 10px 0;border-bottom:1px solid ${C.hairline};font-family:${FONT_BODY};font-size:14px;line-height:20px;color:${C.ink};word-break:break-word;">${esc(
          it.name,
        )}${
          qty > 0
            ? ` <span style="color:${C.mutedSoft};white-space:nowrap;">&times; ${esc(count(qty))}</span>`
            : ""
        }</td>
        <td align="right" style="padding:${i === 0 ? "0" : "10px"} 0 10px;border-bottom:1px solid ${C.hairline};font-family:${FONT_BODY};font-size:14px;line-height:20px;font-weight:700;color:${C.coralDeep};text-align:right;white-space:nowrap;">${esc(
          fmt(it.sales),
        )}</td>
      </tr>`;
      })
      .join("");

    return band({
      bg: C.white,
      padding: "26px 32px 8px",
      content: [
        sectionLabel("Top sellers", C.coralDeep),
        topName
          ? p(
              `Your best seller was <strong style="color:${C.ink};">${esc(topName)}</strong>${
                num(args.topServiceSales) > 0
                  ? ` at <strong style="color:${C.coralDeep};">${esc(
                      fmt(args.topServiceSales),
                    )}</strong>`
                  : ""
              }.`,
              { margin: "0 0 16px", size: 15 },
            )
          : "",
        rows
          ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">${rows}</table>`
          : "",
      ].join(""),
    });
  })();

  // ---- close ------------------------------------------------------------
  const ctaBand = band({
    bg: C.white,
    padding: "24px 32px 36px",
    content: [
      button({
        label: "Open your dashboard",
        url: dashboardUrl,
        align: "center",
        marginTop: 6,
      }),
      p(
        `Your full history, client list, and reports live in the app. <a href="${escUrl(
          settingsUrl,
        )}" style="color:${C.muted};text-decoration:underline;">Turn this report off</a> any time in Settings.`,
        { margin: "18px 0 0", size: 12, color: C.muted, align: "center" },
      ),
    ].join(""),
  });

  const html = document_({
    title: subject,
    preheader,
    bands: [
      masthead(base),
      heroBand,
      revenueBand,
      statsBand,
      retentionBand,
      weekdayBand,
      hourBand,
      bigDayBand,
      itemsBand,
      ctaBand,
      footer({
        base,
        reason:
          "You received this because month in review is on for your Braid Boss Pro account. You can turn it off in Settings.",
      }),
    ].join(""),
  });

  const text = textBody([
    `${monthLabel} in review${studio ? ` for ${studio}` : ""}`,
    "",
    `Total collected: ${fmt(revenue)}`,
    revenueDelta === null
      ? ""
      : `${Math.abs(revenueDelta)}% ${revenueDelta >= 0 ? "up" : "down"} on ${
          prevMonthLabel || "the month before"
        }`,
    "",
    `Sales: ${count(salesCount)}`,
    `Clients served: ${count(customers)}`,
    `New clients: ${count(newCustomers)}`,
    `Returning clients: ${count(returning)}`,
    salesCount > 0 ? `Average sale: ${fmt(avgTicket)}` : "",
    daysWithSales > 0 ? `Days with sales: ${count(daysWithSales)}` : "",
    "",
    args.bestWeekday ? `Best day of the week: ${args.bestWeekday}` : "",
    num(args.bestWeekdayAvg) > 0
      ? `Average on that day: ${fmt(args.bestWeekdayAvg)}`
      : "",
    num(args.avgDailySales) > 0
      ? `Average working day: ${fmt(args.avgDailySales)}`
      : "",
    longDay(args.busiestDate) && num(args.busiestDateSales) > 0
      ? `Biggest day: ${longDay(args.busiestDate)}, ${fmt(args.busiestDateSales)}`
      : "",
    "",
    args.topServiceName
      ? `Top seller: ${args.topServiceName}${
          num(args.topServiceSales) > 0 ? ` (${fmt(args.topServiceSales)})` : ""
        }`
      : "",
    ...(args.items || [])
      .filter((it) => it && String(it.name ?? "").trim() !== "")
      .slice(0, 8)
      .map((it) => `  ${it.name}: ${fmt(it.sales)}`),
    "",
    `Open your dashboard: ${dashboardUrl}`,
    textFooter(
      "You received this because month in review is on for your Braid Boss Pro account. You can turn it off in Settings.",
    ),
  ]);

  return { subject, preheader, html, text };
};
