"use client";

// Interactive Pricing Simulator — drag the retail price and watch every
// downstream number move. Replaces the old static margin→price table.

import { SlidersHorizontal } from "lucide-react";
import type { UnitEconomics } from "../../../lib/product-intel";
import { C, FONT_DISPLAY, cardStyle, labelStyle, fmt$, fmtPct } from "../theme";
import { Animated, Stat } from "../primitives";

export default function PricingSimulator({
  value,
  min,
  max,
  recommended,
  maxProfit,
  economics,
  breakEven,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  recommended: number;
  maxProfit: number;
  economics: UnitEconomics;
  breakEven: number | null;
  onChange: (v: number) => void;
}) {
  const clamped = Math.min(Math.max(value, min), max);
  const netTone = economics.netProfit >= 0 ? "success" : "danger";
  const roiTone =
    economics.roiPct == null ? undefined
    : economics.roiPct >= 30 ? "success"
    : economics.roiPct >= 15 ? "warning"
    : "danger";

  return (
    <div style={cardStyle}>
      <style>{`
        .bbp-price-slider { -webkit-appearance: none; appearance: none; width: 100%; height: 8px; border-radius: 999px; outline: none; margin: 0; touch-action: none; }
        .bbp-price-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 30px; height: 30px; border-radius: 999px; background: ${C.goldDeep}; border: 3px solid #fff; box-shadow: 0 2px 6px rgba(21,17,26,0.28); cursor: pointer; }
        .bbp-price-slider::-moz-range-thumb { width: 30px; height: 30px; border-radius: 999px; background: ${C.goldDeep}; border: 3px solid #fff; box-shadow: 0 2px 6px rgba(21,17,26,0.28); cursor: pointer; }
        .bbp-price-slider:focus-visible { box-shadow: 0 0 0 3px rgba(124,58,237,0.35); }
      `}</style>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ color: C.goldDeep }}><SlidersHorizontal size={15} /></span>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: C.espresso }}>Pricing Simulator</h2>
      </div>

      <div style={{ textAlign: "center", marginBottom: 4 }}>
        <p style={labelStyle}>Retail price</p>
        <p style={{ fontFamily: FONT_DISPLAY, fontSize: 44, fontWeight: 600, color: C.goldDeep, lineHeight: 1.05 }}>
          <Animated value={clamped} format={(n) => fmt$(n)} duration={200} />
        </p>
      </div>

      <input
        className="bbp-price-slider"
        type="range"
        min={min}
        max={max}
        step={0.5}
        value={clamped}
        aria-label="Retail price"
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{
          background: `linear-gradient(90deg, ${C.gold} 0%, ${C.goldDeep} ${
            ((clamped - min) / Math.max(0.01, max - min)) * 100
          }%, ${C.ivory} ${((clamped - min) / Math.max(0.01, max - min)) * 100}%, ${C.ivory} 100%)`,
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10.5, color: C.muted }}>
        <span>{fmt$(min)}</span>
        <span>{fmt$(max)}</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 14 }}>
        <Stat small label="Gross profit" value={<Animated value={economics.grossProfit} format={fmt$} />} tone="success" />
        <Stat small label="Net profit" value={<Animated value={economics.netProfit} format={fmt$} />} tone={netTone} />
        <Stat small label="ROI" value={economics.roiPct == null ? "—" : <Animated value={economics.roiPct} format={fmtPct} />} tone={roiTone} />
        <Stat small label="Profit / unit" value={<Animated value={economics.netProfit} format={fmt$} />} tone={netTone} />
        <Stat small label="Break-even" value={breakEven == null ? "—" : `${breakEven}`} />
        <Stat small label="Cost / unit" value={fmt$(economics.costPerUnit)} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 14 }}>
        <PriceChip label="Current" value={fmt$(clamped)} tone={C.espresso} />
        <PriceChip label="Recommended" value={fmt$(recommended)} tone={C.goldDeep} />
        <PriceChip label="Max profit" value={fmt$(maxProfit)} tone={C.success} />
      </div>
    </div>
  );
}

function PriceChip({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div style={{ textAlign: "center", padding: "8px 6px", borderRadius: 12, background: C.ivory }}>
      <p style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.muted }}>{label}</p>
      <p style={{ fontFamily: FONT_DISPLAY, fontSize: 17, fontWeight: 600, color: tone, marginTop: 1 }}>{value}</p>
    </div>
  );
}
