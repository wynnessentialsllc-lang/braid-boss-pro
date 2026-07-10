"use client";

// Batch Snapshot — a quick overview of the current production batch.

import { Boxes } from "lucide-react";
import type { BatchSnapshot as Snapshot } from "../../../lib/product-intel";
import { C, FONT_DISPLAY, labelStyle, cardStyle, fmt$, fmtPct } from "../theme";

export default function BatchSnapshot({ snapshot }: { snapshot: Snapshot }) {
  const cells: Array<{ label: string; value: string; tone?: string }> = [
    { label: "Units produced", value: String(snapshot.unitsProduced) },
    { label: "Cost to produce batch", value: fmt$(snapshot.batchCost) },
    { label: "Retail value", value: fmt$(snapshot.retailValue), tone: C.goldDeep },
    { label: "Gross profit", value: fmt$(snapshot.grossProfit), tone: C.success },
    { label: "Net profit", value: fmt$(snapshot.netProfit), tone: snapshot.netProfit >= 0 ? C.success : C.danger },
    { label: "Profit per unit", value: fmt$(snapshot.profitPerUnit), tone: snapshot.profitPerUnit >= 0 ? C.success : C.danger },
    { label: "ROI", value: fmtPct(snapshot.roiPct) },
    { label: "Break-even units", value: snapshot.breakEvenUnits == null ? "—" : `${snapshot.breakEvenUnits}` },
  ];
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ color: C.goldDeep }}><Boxes size={15} /></span>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: C.espresso }}>Batch Snapshot</h2>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {cells.map((c) => (
          <div key={c.label} style={{ padding: "10px 12px", borderRadius: 12, background: C.ivory }}>
            <p style={{ ...labelStyle, fontSize: 9 }}>{c.label}</p>
            <p style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 600, color: c.tone ?? C.espresso, marginTop: 2 }}>
              {c.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
