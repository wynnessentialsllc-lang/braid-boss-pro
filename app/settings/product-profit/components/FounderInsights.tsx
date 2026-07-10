"use client";

// Founder Insights — 2–4 dynamic, plain-English recommendations derived
// from the live numbers. Each line pairs a colour with an icon + label.

import { Lightbulb, TrendingUp, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { Insight, InsightTone } from "../../../lib/product-intel";
import { C, cardStyle } from "../theme";

const TONE: Record<InsightTone, { color: string; bg: string; Icon: typeof TrendingUp }> = {
  recommendation: { color: C.goldDeep, bg: "rgba(124,58,237,0.09)", Icon: TrendingUp },
  attention: { color: C.warning, bg: "rgba(184,134,11,0.10)", Icon: AlertTriangle },
  healthy: { color: C.success, bg: "rgba(92,124,74,0.10)", Icon: CheckCircle2 },
};

export default function FounderInsights({ insights }: { insights: Insight[] }) {
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ color: C.goldDeep }}><Lightbulb size={16} /></span>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: C.espresso }}>Founder Insights</h2>
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {insights.map((insight) => {
          const { color, bg, Icon } = TONE[insight.tone];
          return (
            <div key={insight.id} style={{ display: "flex", gap: 10, padding: "10px 12px", borderRadius: 12, background: bg }}>
              <span aria-hidden style={{ color, flexShrink: 0, marginTop: 1 }}><Icon size={17} /></span>
              <p style={{ fontSize: 12.5, color: C.coffee, lineHeight: 1.5 }}>{insight.text}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
