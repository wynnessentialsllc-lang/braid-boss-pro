"use client";

// Profit Per Unit — net take-home each time a single unit sells.

import { Coins } from "lucide-react";
import { C, FONT_DISPLAY, cardStyle, labelStyle, fmt$ } from "../theme";
import { Animated } from "../primitives";

export default function ProfitPerUnitCard({ value }: { value: number }) {
  const tone = value >= 0 ? C.success : C.danger;
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ color: C.goldDeep }}><Coins size={15} /></span>
        <p style={labelStyle}>Profit Per Unit</p>
      </div>
      <p style={{ fontFamily: FONT_DISPLAY, fontSize: 40, fontWeight: 600, color: tone, lineHeight: 1.05 }}>
        <Animated value={value} format={(n) => fmt$(n)} />
      </p>
      <p style={{ fontSize: 12.5, color: C.muted, marginTop: 4 }}>
        Earned every time one unit sells.
      </p>
    </div>
  );
}
