"use client";

// Small presentational primitives shared by the calculator page and its
// intelligence cards. Kept dumb (styling only) so calculation logic stays
// in lib/product-profit.ts and lib/product-intel.ts.

import { useEffect, useRef, useState } from "react";
import { C, FONT_DISPLAY, cardStyle, labelStyle } from "./theme";

export function Section({
  title,
  icon,
  right,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {icon && <span style={{ color: C.goldDeep }}>{icon}</span>}
          <h2 style={{ fontSize: 14, fontWeight: 700, color: C.espresso }}>{title}</h2>
        </div>
        {right}
      </div>
      <div style={{ display: "grid", gap: 10 }}>{children}</div>
    </div>
  );
}

export function Kpi({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "success" | "gold" | "warning" | "danger";
  hint?: string;
}) {
  const color =
    tone === "success" ? C.success
    : tone === "gold" ? C.goldDeep
    : tone === "warning" ? C.warning
    : tone === "danger" ? C.danger
    : C.espresso;
  return (
    <div style={{ ...cardStyle, padding: 14, boxShadow: "none", border: `1px solid ${C.hairline}` }}>
      <p style={labelStyle}>{label}</p>
      <p style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 600, color, lineHeight: 1.1, marginTop: 2 }}>{value}</p>
      {hint && <p style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{hint}</p>}
    </div>
  );
}

export function Stat({
  label,
  value,
  tone,
  small,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "gold" | "success" | "warning" | "danger";
  small?: boolean;
}) {
  const color =
    tone === "success" ? C.success
    : tone === "gold" ? C.goldDeep
    : tone === "warning" ? C.warning
    : tone === "danger" ? C.danger
    : C.espresso;
  return (
    <div>
      <p style={{ ...labelStyle, fontSize: 9 }}>{label}</p>
      <p style={{ fontFamily: FONT_DISPLAY, fontSize: small ? 17 : 22, fontWeight: 600, color, lineHeight: 1.1, marginTop: 1 }}>{value}</p>
    </div>
  );
}

export function CalloutRow({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", borderRadius: 12, background: C.ivory }}>
      <div>
        <p style={{ fontSize: 12.5, fontWeight: 600, color: C.coffee }}>{label}</p>
        {hint && <p style={{ fontSize: 10.5, color: C.muted }}>{hint}</p>}
      </div>
      <p style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 600, color: C.goldDeep }}>{value}</p>
    </div>
  );
}

// ---- Animated numbers --------------------------------------------------

/**
 * Eases a number toward its target so KPI values "count" when pricing or
 * costs change, rather than jumping. Honors prefers-reduced-motion and
 * degrades to the raw value during SSR.
 */
export function useAnimatedNumber(value: number, duration = 420): number {
  const [display, setDisplay] = useState(value);
  const displayRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    displayRef.current = display;
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR fallback, intentional
      setDisplay(value);
      return;
    }
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const from = displayRef.current;
    if (reduce || !Number.isFinite(value) || !Number.isFinite(from) || from === value) {
      setDisplay(value);
      return;
    }
    let start: number | null = null;
    const tick = (t: number) => {
      if (start == null) start = t;
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (value - from) * eased);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value, duration]);

  return display;
}

/** Renders an animated numeric value through a format function. */
export function Animated({
  value,
  format,
  duration,
}: {
  value: number;
  format: (n: number) => string;
  duration?: number;
}) {
  const shown = useAnimatedNumber(value, duration);
  return <>{format(shown)}</>;
}
