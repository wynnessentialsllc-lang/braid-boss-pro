"use client";

// Public availability calendar — month grid with per-day open /
// limited / booked / closed status. Lifted from the /book/[slug]
// booking page so the reschedule flow shows the exact same
// stylist-availability view a client sees when first booking.
//
// Self-contained: owns its palette + helpers so it can drop into
// any public page without pulling booking-page internals. Data is
// fed in via props (the caller owns the month cursor + the
// fetchPublicMonthAvailability call) so this stays a pure view.

import { useMemo } from "react";
import type { MonthDay, MonthDayStatus } from "../../lib/services";

const C = {
  espresso: "#15111A",
  coffee: "#3D3447",
  paper: "#FFFFFF",
  ivory: "#F6F2EC",
  cream: "#FAF6EE",
  gold: "#7C3AED",
  goldDeep: "#5B21B6",
  muted: "#6F6477",
  hairline: "rgba(21, 17, 26, 0.12)",
  brandPrimary: "#7C3AED",
  danger: "#9C3D2E",
};
const FONT_DISPLAY = `"Cormorant Garamond", Georgia, serif`;

const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"] as const;
const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const localDateISO = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayISO = (): string => localDateISO(new Date());

const ghostButtonStyle: React.CSSProperties = {
  padding: 10,
  borderRadius: 10,
  background: "transparent",
  color: C.coffee,
  border: `1px solid ${C.hairline}`,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  minHeight: 40,
};

export type AvailabilityCalendarProps = {
  monthCursor: { year: number; month: number };
  setMonthCursor: (next: { year: number; month: number }) => void;
  monthDays: MonthDay[];
  monthLoading: boolean;
  monthError: string | null;
  monthHasAnyAvailability: boolean;
  selectedDate: string;
  onSelectDate: (iso: string) => void;
};

export const AvailabilityCalendar = ({
  monthCursor, setMonthCursor, monthDays, monthLoading, monthError,
  monthHasAnyAvailability, selectedDate, onSelectDate,
}: AvailabilityCalendarProps) => {
  const dayMap = useMemo(() => {
    const m = new Map<string, MonthDay>();
    for (const d of monthDays) m.set(d.day, d);
    return m;
  }, [monthDays]);

  const cells = useMemo(() => {
    const first = new Date(monthCursor.year, monthCursor.month - 1, 1);
    const lead = first.getDay();
    const daysInMonth = new Date(monthCursor.year, monthCursor.month, 0).getDate();
    const out: ({ iso: string; day: number } | null)[] = [];
    for (let i = 0; i < lead; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${monthCursor.year}-${String(monthCursor.month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      out.push({ iso, day: d });
    }
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [monthCursor]);

  const today = todayISO();

  const goPrev = () => {
    const m = monthCursor.month - 1;
    if (m < 1) setMonthCursor({ year: monthCursor.year - 1, month: 12 });
    else setMonthCursor({ year: monthCursor.year, month: m });
  };
  const goNext = () => {
    const m = monthCursor.month + 1;
    if (m > 12) setMonthCursor({ year: monthCursor.year + 1, month: 1 });
    else setMonthCursor({ year: monthCursor.year, month: m });
  };

  const now = new Date();
  const atCurrentMonth =
    monthCursor.year === now.getFullYear() && monthCursor.month === now.getMonth() + 1;
  const headerLabel = `${MONTH_LABELS[monthCursor.month - 1]} ${monthCursor.year}`;

  return (
    <div style={{ padding: 14, borderRadius: 16, background: C.paper, border: `1px solid ${C.hairline}` }}>
      <style>{`
        @keyframes bbpShimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        @keyframes bbpFadeIn { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: none; } }
      `}</style>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <button
          type="button"
          onClick={goPrev}
          disabled={atCurrentMonth}
          aria-label="Previous month"
          style={{
            ...ghostButtonStyle,
            minHeight: 36, padding: "6px 10px",
            opacity: atCurrentMonth ? 0.4 : 1,
            cursor: atCurrentMonth ? "default" : "pointer",
          }}
        >
          ←
        </button>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 18, color: C.espresso }}>
          {headerLabel}
        </div>
        <button
          type="button"
          onClick={goNext}
          aria-label="Next month"
          style={{ ...ghostButtonStyle, minHeight: 36, padding: "6px 10px" }}
        >
          →
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4 }}>
        {WEEKDAY_LETTERS.map((w, i) => (
          <div
            key={`wk-${i}`}
            style={{
              fontSize: 10, fontWeight: 700, color: C.muted,
              textAlign: "center", textTransform: "uppercase", letterSpacing: "0.08em",
              padding: "4px 0",
            }}
          >
            {w}
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {cells.map((cell, idx) => {
          if (!cell) return <div key={`pad-${idx}`} style={{ minHeight: 44 }} />;
          const info = dayMap.get(cell.iso);
          const status: MonthDayStatus = info?.status ?? "off";
          const isPast = cell.iso < today;
          const isSelected = selectedDate === cell.iso;
          const disabled = isPast || status === "off" || status === "booked";
          return (
            <CalendarCell
              key={cell.iso}
              day={cell.day}
              status={status}
              loading={monthLoading && !info}
              disabled={disabled}
              selected={isSelected}
              onClick={() => { if (!disabled) onSelectDate(cell.iso); }}
            />
          );
        })}
      </div>

      <div style={{
        display: "flex", flexWrap: "wrap", gap: 10, marginTop: 12,
        fontSize: 10, color: C.muted, alignItems: "center",
      }}>
        <Legend swatch={C.brandPrimary} label="Open" />
        <Legend swatch="#FBBF24" label="Limited" />
        <Legend swatch={C.hairline} label="Booked" />
        <Legend swatch="transparent" border label="Closed" />
      </div>

      {monthError && (
        <p style={{ fontSize: 11, color: C.danger, marginTop: 10 }}>
          Couldn&apos;t load this month&apos;s availability. {monthError}
        </p>
      )}
      {!monthLoading && !monthError && monthDays.length > 0 && !monthHasAnyAvailability && (
        <div
          style={{
            marginTop: 12, padding: 12, borderRadius: 12,
            background: C.cream, border: `1px solid ${C.hairline}`, textAlign: "center",
          }}
        >
          <p style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 600, color: C.espresso }}>
            Stylist is updating availability
          </p>
          <p style={{ fontSize: 11, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>
            No openings this month yet. Try the next month.
          </p>
          <button type="button" onClick={goNext} style={{ ...ghostButtonStyle, marginTop: 10 }}>
            See next month
          </button>
        </div>
      )}
    </div>
  );
};

const Legend = ({ swatch, label, border }: { swatch: string; label: string; border?: boolean }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
    <span style={{
      display: "inline-block", width: 10, height: 10, borderRadius: 3,
      background: swatch, border: border ? `1px solid ${C.hairline}` : "none",
    }} />
    {label}
  </span>
);

type CellProps = {
  day: number;
  status: MonthDayStatus;
  loading: boolean;
  disabled: boolean;
  selected: boolean;
  onClick: () => void;
};

const CalendarCell = ({ day, status, loading, disabled, selected, onClick }: CellProps) => {
  let bg = C.paper;
  let fg = C.espresso;
  let border = `1px solid ${C.hairline}`;
  if (loading) {
    bg = `linear-gradient(90deg, ${C.paper}, ${C.ivory}, ${C.paper})`;
  } else if (selected) {
    bg = `linear-gradient(180deg, ${C.gold}, ${C.goldDeep})`;
    fg = C.paper;
    border = `1px solid ${C.goldDeep}`;
  } else if (status === "available") {
    bg = "rgba(124, 58, 237, 0.18)";
    border = `1px solid rgba(124, 58, 237, 0.35)`;
  } else if (status === "limited") {
    bg = "rgba(251, 191, 36, 0.22)";
    border = `1px solid rgba(251, 191, 36, 0.55)`;
  } else if (status === "booked") {
    bg = C.cream;
    fg = C.muted;
  } else if (status === "off") {
    bg = "transparent";
    fg = "rgba(21, 17, 26, 0.35)";
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      aria-label={`Day ${day}, ${status}`}
      style={{
        minHeight: 44, padding: 0,
        borderRadius: 10,
        background: bg as string,
        color: fg,
        border,
        fontSize: 13,
        fontWeight: selected ? 700 : 500,
        cursor: disabled ? "default" : "pointer",
        animation: loading ? "bbpShimmer 1.4s ease-in-out infinite" : "bbpFadeIn 180ms ease",
        backgroundSize: loading ? "200% 100%" : undefined,
        transition: "transform 120ms ease, background 120ms ease",
        transform: selected ? "scale(1.04)" : "scale(1)",
      }}
    >
      {day}
    </button>
  );
};
