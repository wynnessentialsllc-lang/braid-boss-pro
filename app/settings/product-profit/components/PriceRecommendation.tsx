"use client";

// Recommended Retail Price — the optimal price the tool suggests, with a
// one-tap way to adopt it in the simulator.

import { Sparkles, Check } from "lucide-react";
import type { PriceRecommendation as Rec } from "../../../lib/product-intel";
import { C, FONT_DISPLAY, cardStyle, labelStyle, fmt$, fmtPct } from "../theme";
import { Animated } from "../primitives";

export default function PriceRecommendation({
  rec,
  current,
  onApply,
}: {
  rec: Rec;
  current: number;
  onApply: () => void;
}) {
  const applied = rec.price > 0 && Math.abs(current - rec.price) < 0.005;
  return (
    <div style={{ ...cardStyle, background: "rgba(124,58,237,0.05)", border: `1px solid rgba(124,58,237,0.22)` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ color: C.goldDeep }}><Sparkles size={15} /></span>
        <p style={labelStyle}>Recommended Retail Price</p>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <p style={{ fontFamily: FONT_DISPLAY, fontSize: 40, fontWeight: 600, color: C.goldDeep, lineHeight: 1 }}>
          <Animated value={rec.price} format={(n) => fmt$(n)} />
        </p>
        {rec.roiPct != null && (
          <span style={{ fontSize: 12, fontWeight: 700, color: C.success }}>
            {fmtPct(rec.roiPct)} ROI
          </span>
        )}
      </div>
      <p style={{ fontSize: 12.5, color: C.coffee, lineHeight: 1.5, marginTop: 8 }}>{rec.reason}</p>
      {rec.price > 0 && (
        <button
          type="button"
          onClick={onApply}
          disabled={applied}
          style={{
            marginTop: 12,
            width: "100%",
            minHeight: 44,
            borderRadius: 12,
            border: `1px solid ${C.goldDeep}`,
            background: applied ? C.paper : `linear-gradient(180deg, ${C.gold}, ${C.goldDeep})`,
            color: applied ? C.goldDeep : "#fff",
            fontSize: 13,
            fontWeight: 700,
            cursor: applied ? "default" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
          }}
        >
          {applied ? <><Check size={15} /> Using recommended price</> : "Use recommended price"}
        </button>
      )}
    </div>
  );
}
