"use client";

// Profit Timeline — live revenue / net-profit / ROI at each sales volume.
// A vertical list of rows so it never scrolls horizontally on mobile.

import { CalendarClock } from "lucide-react";
import type { TimelineRow } from "../../../lib/product-intel";
import { C, FONT_DISPLAY, labelStyle, cardStyle, fmt$, fmtPct } from "../theme";
import { Animated } from "../primitives";

export default function ProfitTimeline({ rows }: { rows: TimelineRow[] }) {
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ color: C.goldDeep }}><CalendarClock size={15} /></span>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: C.espresso }}>Profit Timeline</h2>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {rows.map((row) => {
          const netTone = row.netProfit >= 0 ? C.success : C.danger;
          return (
            <div
              key={row.units}
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr 1fr auto",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 12,
                background: C.ivory,
              }}
            >
              <span style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600, color: C.espresso, minWidth: 44 }}>
                {row.units}
                <span style={{ fontSize: 10, color: C.muted, fontFamily: "inherit", marginLeft: 3 }}>units</span>
              </span>
              <Col label="Revenue" value={<Animated value={row.revenue} format={fmt$} />} color={C.coffee} />
              <Col label="Net profit" value={<Animated value={row.netProfit} format={fmt$} />} color={netTone} />
              <Col label="ROI" value={row.roiPct == null ? "—" : fmtPct(row.roiPct)} color={C.goldDeep} align="right" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Col({
  label,
  value,
  color,
  align = "left",
}: {
  label: string;
  value: React.ReactNode;
  color: string;
  align?: "left" | "right";
}) {
  return (
    <div style={{ textAlign: align, minWidth: 0 }}>
      <p style={{ ...labelStyle, fontSize: 8.5 }}>{label}</p>
      <p style={{ fontSize: 13, fontWeight: 700, color, marginTop: 1 }}>{value}</p>
    </div>
  );
}
