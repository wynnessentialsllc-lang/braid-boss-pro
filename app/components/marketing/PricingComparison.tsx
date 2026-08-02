"use client";

// At-a-glance pricing/feature comparison for the /pricing page: Braid
// Boss Pro vs the three tools braiders most often evaluate. Built as a
// real semantic <table> (th scope="col"/"row") so it's parseable by
// crawlers and assistive tech — unlike the CSS-grid ComparisonTable used
// on the /compare/* pages.
//
// Competitor values reflect commonly published plans and mirror the
// claims already made across the site's /compare pages; they can change,
// hence the footnote. Only qualitative, defensible statements are used.

import { Check, X } from "lucide-react";
import { C } from "./tokens";

type Mark = { kind: "yes" } | { kind: "no" } | { kind: "text"; text: string };

const yes: Mark = { kind: "yes" };
const no: Mark = { kind: "no" };
const t = (text: string): Mark => ({ kind: "text", text });

const COLUMNS = ["Braid Boss Pro", "StyleSeat", "Vagaro", "Square Appts"];

const ROWS: Array<{ feature: string; cells: [Mark, Mark, Mark, Mark] }> = [
  { feature: "Monthly price", cells: [t("$14.99 flat"), t("$35+"), t("$24–$48"), t("Add-ons + fees")] },
  { feature: "Annual option", cells: [t("$149/yr"), no, t("Varies"), no] },
  { feature: "Per-new-client fee", cells: [t("None"), t("$1+ / client"), no, no] },
  { feature: "Per-staff fees", cells: [t("None"), no, t("Yes"), t("Per-employee")] },
  { feature: "Payouts to your own Stripe (same-day)", cells: [yes, t("Holds payouts"), t("Vagaro Pay"), t("Square only")] },
  { feature: "Deposits + digital contracts included", cells: [yes, t("Partial"), t("Add-on"), t("Partial")] },
  { feature: "Retail storefront included", cells: [yes, no, t("Add-on"), yes] },
  { feature: "Built specifically for braiders", cells: [yes, no, no, no] },
  { feature: "Installs as an app — no app store", cells: [yes, no, no, no] },
];

const MarkCell = ({ mark, highlight }: { mark: Mark; highlight?: boolean }) => {
  if (mark.kind === "yes") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: C.brandSuccess, fontWeight: 700, fontSize: 13 }}>
        <Check size={16} aria-hidden />
        <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Yes</span>
      </span>
    );
  }
  if (mark.kind === "no") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#9F95A8", fontWeight: 600, fontSize: 13 }}>
        <X size={16} aria-hidden />
        <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>No</span>
      </span>
    );
  }
  return (
    <span style={{ color: highlight ? C.brandPrimary : C.coffee, fontWeight: highlight ? 700 : 500, fontSize: 12.5, lineHeight: 1.4 }}>
      {mark.text}
    </span>
  );
};

export function PricingComparison() {
  const cell: React.CSSProperties = { padding: "13px 16px", textAlign: "left", verticalAlign: "middle", borderBottom: `1px solid ${C.brandBorder}` };
  return (
    <div className="bbp-reveal">
      <div style={{ overflowX: "auto", borderRadius: 18, border: `1px solid ${C.brandBorder}`, background: C.paper }}>
        <table
          style={{ width: "100%", minWidth: 640, borderCollapse: "collapse", fontSize: 13 }}
          aria-label="Braid Boss Pro compared with StyleSeat, Vagaro, and Square Appointments"
        >
          <caption style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
            Pricing and feature comparison of Braid Boss Pro versus StyleSeat, Vagaro, and Square Appointments.
          </caption>
          <thead>
            <tr style={{ background: C.brandSurface }}>
              <th
                scope="col"
                style={{ ...cell, fontWeight: 800, fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase", color: C.coffee }}
              >
                Feature
              </th>
              {COLUMNS.map((c, i) => (
                <th
                  key={c}
                  scope="col"
                  style={{
                    ...cell,
                    fontWeight: 800,
                    fontSize: 12,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    color: i === 0 ? C.brandPrimary : C.coffee,
                    whiteSpace: "nowrap",
                  }}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row, ri) => (
              <tr key={row.feature} style={{ background: ri % 2 === 1 ? "#FBFAFD" : "transparent" }}>
                <th scope="row" style={{ ...cell, fontWeight: 600, color: C.ink }}>
                  {row.feature}
                </th>
                {row.cells.map((mark, ci) => (
                  <td
                    key={ci}
                    style={{ ...cell, background: ci === 0 ? "rgba(124, 58, 237, 0.05)" : undefined }}
                  >
                    <MarkCell mark={mark} highlight={ci === 0} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: 12, fontSize: 11.5, color: C.mutedSoft, lineHeight: 1.5, textAlign: "center" }}>
        Competitor pricing and features reflect commonly published plans and can change — confirm
        current terms on each provider&apos;s site. Braid Boss Pro is $14.99/mo or $149/yr, every
        feature included.
      </p>
    </div>
  );
}
