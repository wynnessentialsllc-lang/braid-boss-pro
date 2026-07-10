"use client";

// Product Health — an at-a-glance verdict on the current pricing.
// Colour is always paired with an icon and a label, never on its own.

import { CheckCircle2, AlertTriangle, AlertOctagon, CircleDashed } from "lucide-react";
import type { ProductHealth, HealthTone } from "../../../lib/product-intel";
import { C, FONT_DISPLAY, cardStyle, labelStyle, fmtPct } from "../theme";
import { Animated } from "../primitives";

const TONE: Record<HealthTone, { color: string; bg: string; Icon: typeof CheckCircle2 }> = {
  green: { color: C.success, bg: "rgba(92,124,74,0.10)", Icon: CheckCircle2 },
  orange: { color: C.warning, bg: "rgba(184,134,11,0.10)", Icon: AlertTriangle },
  red: { color: C.danger, bg: "rgba(156,61,46,0.10)", Icon: AlertOctagon },
  neutral: { color: C.muted, bg: C.ivory, Icon: CircleDashed },
};

export default function ProductHealthCard({ health }: { health: ProductHealth }) {
  const { color, bg, Icon } = TONE[health.tone];
  return (
    <div style={cardStyle}>
      <p style={{ ...labelStyle, marginBottom: 10 }}>Product Health</p>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          aria-hidden
          style={{ width: 44, height: 44, borderRadius: 999, background: bg, color, display: "grid", placeItems: "center", flexShrink: 0 }}
        >
          <Icon size={24} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 600, color, lineHeight: 1.15 }}>
            {health.label}
          </p>
          {health.roiPct != null && (
            <p style={{ fontSize: 11.5, color: C.muted, marginTop: 1 }}>
              <Animated value={health.roiPct} format={(n) => fmtPct(n)} /> ROI
            </p>
          )}
        </div>
      </div>
      <p style={{ fontSize: 13, color: C.coffee, lineHeight: 1.5, marginTop: 12 }}>
        {health.explanation}
      </p>
    </div>
  );
}
