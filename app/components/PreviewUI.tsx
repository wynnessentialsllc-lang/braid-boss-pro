"use client";

// Shared "preview-style" UI primitives — used to dress real app
// screens in the same softer, editorial language as the
// onboarding/welcome preview cards.
//
// All components are pure presentation (no state, no fetching). They
// use the project's brown / cream / gold palette and a thin gold-tinted
// border so they sit comfortably on the existing app surfaces.

import type { CSSProperties, ReactNode } from "react";

// Mirrors the project's `C` tokens in app/page.tsx so a component
// lifted into a different file stays on-brand.
const P = {
  cream: "#FFFFFF",
  ivory: "#F6F2EC",
  paper: "#FFFFFF",
  espresso: "#15111A",
  coffee: "#3D3447",
  gold: "#7C3AED",
  goldDeep: "#5B21B6",
  goldSoft: "#F1EBFD",
  muted: "#6F6477",
  mutedSoft: "#9F95A8",
  hairline: "rgba(21, 17, 26, 0.12)",
  hairlineSoft: "rgba(21, 17, 26, 0.06)",
  success: "#5C7C4A",
  successSoft: "rgba(92, 124, 74, 0.12)",
  warning: "#C9762B",
  warningSoft: "rgba(201, 118, 43, 0.12)",
  danger: "#9C3D2E",
  dangerSoft: "rgba(156, 61, 46, 0.10)",
} as const;

const FONT_DISPLAY =
  "'Cormorant Garamond', 'Playfair Display', Georgia, serif";

// ===== PreviewStyleCard ===============================================
// Premium rounded panel with a soft warm shadow. The default
// background is `paper` for a hint more contrast against the cream
// app shell. Use `tone="muted"` for a quieter card.

export type PreviewStyleCardProps = {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  tone?: "default" | "muted" | "highlight";
  padding?: number | string;
};

export const PreviewStyleCard = ({
  children,
  className,
  style,
  tone = "default",
  padding = 18,
}: PreviewStyleCardProps) => {
  const bg = tone === "muted"
    ? P.cream
    : tone === "highlight"
      ? P.goldSoft
      : P.paper;
  return (
    <div
      className={className}
      style={{
        background: bg,
        // Softer hairline + layered elevation (tight contact edge + a
        // wide, deep ambient) so the panel reads as floating glass,
        // matching the app's 2026 SHADOWS language.
        border: `1px solid rgba(21, 17, 26, 0.06)`,
        borderRadius: 22,
        padding,
        boxShadow:
          "0 2px 6px rgba(21, 17, 26, 0.05), 0 22px 48px -22px rgba(21, 17, 26, 0.24)",
        ...style,
      }}
    >
      {children}
    </div>
  );
};

// ===== SectionEyebrow =================================================
// Small uppercase brown/gold label above a serif heading. Pairs with
// any of the existing h1/h2 patterns; doesn't include its own
// heading so each call site keeps its semantics.

export type SectionEyebrowProps = {
  children: ReactNode;
  tone?: "gold" | "muted";
  className?: string;
};

export const SectionEyebrow = ({
  children,
  tone = "gold",
  className,
}: SectionEyebrowProps) => (
  <p
    className={className}
    style={{
      margin: 0,
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: "0.22em",
      textTransform: "uppercase",
      color: tone === "gold" ? P.goldDeep : P.muted,
    }}
  >
    {children}
  </p>
);

// ===== StatusPill =====================================================
// Tinted capsule that shares the visual language of the booking
// preview chips. Tones map onto the existing project palette.

export type StatusPillTone =
  | "gold"
  | "success"
  | "neutral"
  | "warning"
  | "danger"
  | "info";

export type StatusPillProps = {
  children: ReactNode;
  tone?: StatusPillTone;
  size?: "sm" | "md";
};

const PILL_TONE: Record<StatusPillTone, { bg: string; fg: string }> = {
  gold: { bg: P.goldSoft, fg: P.goldDeep },
  success: { bg: P.successSoft, fg: P.success },
  neutral: { bg: "rgba(21, 17, 26,0.06)", fg: P.coffee },
  warning: { bg: P.warningSoft, fg: P.warning },
  danger: { bg: P.dangerSoft, fg: P.danger },
  info: { bg: "rgba(21, 17, 26,0.06)", fg: P.muted },
};

export const StatusPill = ({
  children,
  tone = "neutral",
  size = "sm",
}: StatusPillProps) => {
  const { bg, fg } = PILL_TONE[tone];
  return (
    <span
      style={{
        display: "inline-block",
        padding: size === "sm" ? "2px 8px" : "4px 11px",
        borderRadius: 99,
        background: bg,
        color: fg,
        fontSize: size === "sm" ? 9.5 : 11,
        fontWeight: 700,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
};

// ===== MetricRow ======================================================
// Two-column label / value row sized for breakdown cards. Value is
// rendered in mono so prices align. Pass `accent` to render the
// value in gold (used for totals and Net).

export type MetricRowProps = {
  label: ReactNode;
  value: ReactNode;
  accent?: boolean;
  emphasis?: "default" | "strong";
};

export const MetricRow = ({
  label,
  value,
  accent = false,
  emphasis = "default",
}: MetricRowProps) => (
  <div
    style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "baseline",
      padding: "5px 0",
      fontSize: emphasis === "strong" ? 13 : 12.5,
      color: P.coffee,
    }}
  >
    <span style={{ fontWeight: emphasis === "strong" ? 600 : 500 }}>
      {label}
    </span>
    <span
      style={{
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        color: accent ? P.goldDeep : P.espresso,
        fontWeight: emphasis === "strong" ? 700 : 600,
      }}
    >
      {value}
    </span>
  </div>
);

// ===== MiniBarChart ===================================================
// Compact 7-ish bar chart. The last bar pops in the brand violet to
// indicate "now"; resting bars are a muted violet tint. Using a
// translucent violet (rather than a solid cream) keeps the resting
// bars legible on both white cards and the light-violet "highlight"
// card — a solid ivory fill vanishes against that surface. Heights
// are auto-scaled to the max value so the chart reads even with a
// single dominant day.
//
// Optional labelling makes the sparkline self-explanatory instead of a
// row of anonymous bars: pass `labels` (one per bar, e.g. a formatted
// date) and `valueFormat` to get a per-bar hover/readout tooltip and a
// floating value label over the peak day, plus `startLabel`/`endLabel`
// to caption the date range under the axis.

export type MiniBarChartProps = {
  data: number[];
  height?: number;
  highlightIndex?: number | "last";
  ariaLabel?: string;
  /** Per-bar caption (e.g. a formatted date) — surfaced on hover/focus. */
  labels?: string[];
  /** Formats a bar value for the tooltip and the peak label. */
  valueFormat?: (n: number) => string;
  /** Small captions under the axis marking the range ends. */
  startLabel?: ReactNode;
  endLabel?: ReactNode;
};

export const MiniBarChart = ({
  data,
  height = 64,
  highlightIndex = "last",
  ariaLabel,
  labels,
  valueFormat,
  startLabel,
  endLabel,
}: MiniBarChartProps) => {
  const max = Math.max(1, ...data);
  const hl = highlightIndex === "last" ? data.length - 1 : highlightIndex;
  // The tallest day carries the floating value readout. Ties resolve to
  // the earliest so the label sits over the first visible spike.
  const peak = data.reduce((best, v, i) => (v > data[best] ? i : best), 0);
  const showPeak = valueFormat != null && data.length > 0 && data[peak] > 0;
  // Anchor the peak label so it never clips off the chart's edges.
  const peakPct = data.length > 1 ? (peak + 0.5) / data.length : 0.5;
  const peakAnchor =
    peakPct < 0.15 ? "left" : peakPct > 0.85 ? "right" : "center";
  const hasAxis = startLabel != null || endLabel != null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {/* Reserve headroom for the floating peak label above the bars. */}
      <div style={{ position: "relative", paddingTop: showPeak ? 16 : 0 }}>
        {showPeak && (
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: 0,
              left: peakAnchor === "center" ? `${peakPct * 100}%` : undefined,
              right: peakAnchor === "right" ? 0 : undefined,
              ...(peakAnchor === "left" ? { left: 0 } : null),
              transform:
                peakAnchor === "center" ? "translateX(-50%)" : undefined,
              fontSize: 11,
              fontWeight: 700,
              lineHeight: 1,
              color: P.goldDeep,
              whiteSpace: "nowrap",
            }}
          >
            {valueFormat!(data[peak])}
          </span>
        )}
        <div
          aria-label={ariaLabel}
          role={ariaLabel ? "img" : undefined}
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 6,
            height,
          }}
        >
          {data.map((v, i) => {
            const isHl = i === hl;
            // Minimum visible nub of 6px so empty days don't disappear.
            const h = Math.max(6, Math.round((v / max) * height));
            const label = labels?.[i];
            const valueText = valueFormat ? valueFormat(v) : String(v);
            const title = label ? `${label} · ${valueText}` : valueText;
            return (
              <div
                key={i}
                title={title}
                style={{
                  flex: 1,
                  height: h,
                  borderRadius: 4,
                  background: isHl
                    ? `linear-gradient(180deg, ${P.gold} 0%, ${P.goldDeep} 100%)`
                    : "rgba(124, 58, 237, 0.22)",
                  border: isHl ? "none" : "1px solid rgba(124, 58, 237, 0.32)",
                }}
              />
            );
          })}
        </div>
      </div>
      {hasAxis && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 10.5,
            fontWeight: 600,
            letterSpacing: "0.02em",
            color: P.muted,
          }}
        >
          <span>{startLabel}</span>
          <span>{endLabel}</span>
        </div>
      )}
    </div>
  );
};

// ===== EmptyState =====================================================
// Polished empty state — soft gold halo behind the icon, serif
// headline, muted body. Wraps the existing inline icon (not opinionated
// about which icon library so caller picks).

export type EmptyStateProps = {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
};

export const EmptyState = ({
  icon,
  title,
  body,
  action,
  compact = false,
}: EmptyStateProps) => (
  <div
    style={{
      textAlign: "center",
      padding: compact ? "20px 16px" : "32px 20px",
    }}
  >
    {icon && (
      <div
        aria-hidden
        style={{
          width: 56,
          height: 56,
          borderRadius: 99,
          margin: "0 auto 12px",
          background:
            "radial-gradient(circle, rgba(201,169,97,0.18) 0%, rgba(201,169,97,0) 70%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: P.goldDeep,
        }}
      >
        {icon}
      </div>
    )}
    <p
      style={{
        margin: 0,
        fontFamily: FONT_DISPLAY,
        fontSize: compact ? 18 : 20,
        fontWeight: 600,
        color: P.espresso,
        lineHeight: 1.2,
      }}
    >
      {title}
    </p>
    {body && (
      <p
        style={{
          margin: "6px auto 0",
          maxWidth: 280,
          fontSize: 12.5,
          color: P.muted,
          lineHeight: 1.55,
        }}
      >
        {body}
      </p>
    )}
    {action && <div style={{ marginTop: 14 }}>{action}</div>}
  </div>
);

// Re-export the palette so app screens that want the same tokens
// don't have to redefine them.
export { P as PREVIEW_PALETTE };
