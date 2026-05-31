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
  return (
    <div
      style={{
        background: C.paper,
        border: `1px solid ${C.brandBorder}`,
        borderRadius: 18,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.5fr 1fr 1fr",
          background: C.brandSurface,
          padding: "14px 18px",
          borderBottom: `1px solid ${C.brandBorder}`,
          fontWeight: 800,
          fontSize: 12,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: C.coffee,
        }}
      >
        <div>Feature</div>
        <div>Braid Boss Pro</div>
        <div>{competitorName}</div>
      </div>
      {rows.map((row, i) => (
        <div
          key={row.feature}
          style={{
            display: "grid",
            gridTemplateColumns: "1.5fr 1fr 1fr",
            padding: "14px 18px",
            borderBottom: i === rows.length - 1 ? "none" : `1px solid ${C.brandBorder}`,
            alignItems: "center",
            background: i % 2 === 1 ? "#FBFAFD" : "transparent",
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 13, color: C.ink }}>{row.feature}</div>
          <Cell value={row.bbp} />
          <Cell value={row.them} />
        </div>
      ))}
    </div>
  );
};
