"use client";

// Reusable comparison table for /compare/<competitor> pages. Keeps
// all comparison pages visually consistent and lets each page just
// supply rows + verdict instead of redeclaring layout.

import { Check, X, Minus } from "lucide-react";
import { C } from "./tokens";

export type ComparisonValue =
  | { mark: "yes"; note?: string }
  | { mark: "no"; note?: string }
  | { mark: "partial"; note?: string }
  | { mark: "text"; note: string };

export type ComparisonRow = {
  feature: string;
  bbp: ComparisonValue;
  them: ComparisonValue;
};

const Cell = ({ value }: { value: ComparisonValue }) => {
  const icon =
    value.mark === "yes" ? <Check size={16} aria-label="Included" />
    : value.mark === "no" ? <X size={16} aria-label="Not included" />
    : value.mark === "partial" ? <Minus size={16} aria-label="Partial" />
    : null;
  const tone =
    value.mark === "yes" ? C.brandSuccess
    : value.mark === "no" ? "#9F95A8"
    : value.mark === "partial" ? C.brandWarning
    : C.coffee;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, color: tone, fontWeight: 600, fontSize: 13 }}>
      {icon}
      {value.note && (
        <span style={{ color: C.coffee, fontWeight: 500, fontSize: 12.5, lineHeight: 1.4 }}>
          {value.note}
        </span>
      )}
    </div>
  );
};

export const ComparisonTable = ({
  competitorName,
  rows,
}: {
  competitorName: string;
  rows: ComparisonRow[];
}) => {
  // Rendered as a real <table> (th scope="col"/"row") so crawlers and
  // assistive tech parse it as tabular data. The wrapper scrolls
  // horizontally on narrow screens instead of overflowing the page.
  const th: React.CSSProperties = {
    textAlign: "left",
    padding: "14px 18px",
    fontWeight: 800,
    fontSize: 12,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: C.coffee,
  };
  const cell: React.CSSProperties = { padding: "14px 18px", verticalAlign: "middle" };
  return (
    <div
      style={{
        background: C.paper,
        border: `1px solid ${C.brandBorder}`,
        borderRadius: 18,
        overflowX: "auto",
      }}
    >
      <table
        style={{ width: "100%", minWidth: 520, borderCollapse: "collapse", tableLayout: "fixed" }}
        aria-label={`Braid Boss Pro compared with ${competitorName}`}
      >
        <colgroup>
          <col style={{ width: "42%" }} />
          <col style={{ width: "29%" }} />
          <col style={{ width: "29%" }} />
        </colgroup>
        <thead>
          <tr style={{ background: C.brandSurface, borderBottom: `1px solid ${C.brandBorder}` }}>
            <th scope="col" style={th}>Feature</th>
            <th scope="col" style={{ ...th, color: C.brandPrimary }}>Braid Boss Pro</th>
            <th scope="col" style={th}>{competitorName}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.feature}
              style={{
                borderBottom: i === rows.length - 1 ? "none" : `1px solid ${C.brandBorder}`,
                background: i % 2 === 1 ? "#FBFAFD" : "transparent",
              }}
            >
              <th scope="row" style={{ ...cell, fontWeight: 600, fontSize: 13, color: C.ink, textAlign: "left" }}>
                {row.feature}
              </th>
              <td style={cell}><Cell value={row.bbp} /></td>
              <td style={cell}><Cell value={row.them} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
