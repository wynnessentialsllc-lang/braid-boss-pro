"use client";

// Pricing-page savings calculator.
//
// Models what a braider pays competing platforms for the same chair
// they'd pay $9.99 one-time on Braid Boss Pro. Numbers are kept
// conservative and labeled as estimates — real bills vary by plan and
// promo. The point is to make the apples-to-apples math visible
// instead of leaving it as a hand-wave on the landing page.

import { useMemo, useState } from "react";
import { C, GRADIENTS, SHADOWS, FONT_DISPLAY } from "./tokens";

// Conservative public-facing estimates as of 2026. Stylists can
// always quote their own numbers — these are defaults to anchor the
// calculator at a realistic starting point.
type Plan = {
  key: string;
  name: string;
  // Flat monthly subscription, in dollars.
  monthly: number;
  // Per-new-client fee as a fraction of ticket (0.20 = 20%).
  newClientFee: number;
  // Per-booking flat fee in dollars (Booksy charges a small fee on
  // top of the % cut for new-client bookings — averaged in).
  perBookingFee: number;
  // Marketing copy under the totals.
  note: string;
};

const PLANS: Plan[] = [
  { key: "booksy",     name: "Booksy",        monthly: 29.99, newClientFee: 0.20, perBookingFee: 0,   note: "$29.99/mo Pro plan + 20% on every new-client booking from the Booksy marketplace." },
  { key: "styleseat",  name: "StyleSeat",     monthly: 35,    newClientFee: 0.30, perBookingFee: 0,   note: "$35/mo Premium + 30% New Client Booking Fee on first-time clients booked through StyleSeat." },
  { key: "glossgenius",name: "GlossGenius",   monthly: 48,    newClientFee: 0,    perBookingFee: 0,   note: "$48/mo Essential plan. No per-booking cut, but the monthly bill never stops." },
  { key: "vagaro",     name: "Vagaro",        monthly: 30,    newClientFee: 0,    perBookingFee: 1,   note: "$30/mo single-user + $1 marketplace booking fees on top." },
];

const BBP_ONE_TIME = 9.99;

const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function SavingsCalculator() {
  const [bookingsPerMonth, setBookings] = useState<number>(20);
  const [newClientShare, setNewClientShare] = useState<number>(35); // %
  const [avgTicket, setAvgTicket] = useState<number>(220);

  const annual = useMemo(() => {
    return PLANS.map(p => {
      const monthlyBase = p.monthly * 12;
      const newClientBookings = bookingsPerMonth * (newClientShare / 100) * 12;
      const variable = newClientBookings * (avgTicket * p.newClientFee + p.perBookingFee);
      const total = monthlyBase + variable;
      return { plan: p, monthlyBase, variable, total };
    });
  }, [bookingsPerMonth, newClientShare, avgTicket]);

  const maxTotal = Math.max(...annual.map(a => a.total), 1);

  return (
    <div
      style={{
        background: C.paper,
        border: `1px solid ${C.brandBorder}`,
        borderRadius: 24,
        padding: 26,
        boxShadow: SHADOWS.cardLifted,
        display: "grid",
        gap: 20,
      }}
    >
      <div>
        <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: C.brandPrimaryDeep }}>
          Savings calculator
        </p>
        <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 30, fontWeight: 700, color: C.ink, margin: "6px 0 0", lineHeight: 1.1 }}>
          What you&apos;d pay everywhere else.
        </h3>
        <p style={{ color: C.coffee, fontSize: 14, lineHeight: 1.55, marginTop: 8 }}>
          Drag the inputs to your chair. We&apos;ll show the annual cost on each major platform vs. Braid Boss Pro&apos;s one-time founding payment.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
        <NumberField
          label="Bookings / month"
          value={bookingsPerMonth}
          min={1} max={120}
          onChange={setBookings}
          help="Total appointments per month"
        />
        <NumberField
          label="% from new clients"
          value={newClientShare}
          min={0} max={100} suffix="%"
          onChange={setNewClientShare}
          help="Share that come from a marketplace"
        />
        <NumberField
          label="Avg ticket"
          value={avgTicket}
          min={20} max={1000} prefix="$"
          onChange={setAvgTicket}
          help="Your average appointment total"
        />
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {annual.map(({ plan, total, monthlyBase, variable }) => {
          const widthPct = Math.max(8, Math.round((total / maxTotal) * 100));
          return (
            <div key={plan.key}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontWeight: 700, color: C.ink, fontSize: 14 }}>{plan.name}</span>
                <span style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 700, color: C.ink }}>
                  {fmt(total)}<span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}> /yr</span>
                </span>
              </div>
              <div style={{ marginTop: 6, height: 10, borderRadius: 99, background: C.brandSurface, overflow: "hidden" }}>
                <div style={{ width: `${widthPct}%`, height: "100%", background: GRADIENTS.primary, transition: "width 200ms ease" }} />
              </div>
              <p style={{ margin: "6px 0 0", fontSize: 11.5, color: C.muted }}>
                {fmt(monthlyBase)} subscription + {fmt(variable)} marketplace fees
              </p>
            </div>
          );
        })}
      </div>

      <div
        style={{
          padding: "20px 22px",
          borderRadius: 18,
          background: GRADIENTS.primary,
          color: "#fff",
          display: "grid",
          gap: 6,
          boxShadow: SHADOWS.primaryGlow,
        }}
      >
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", opacity: 0.85 }}>
          Braid Boss Pro · founding
        </span>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontFamily: FONT_DISPLAY, fontSize: 40, fontWeight: 700, lineHeight: 1 }}>
            {fmt(BBP_ONE_TIME)}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, opacity: 0.9 }}>one-time · lifetime access</span>
        </div>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, opacity: 0.95 }}>
          That&apos;s about <strong>{fmt(Math.max(0, annual[0].total - BBP_ONE_TIME))}</strong> kept in your pocket
          year one vs. Booksy on the same chair.
        </p>
      </div>

      <details style={{ fontSize: 12, color: C.muted, lineHeight: 1.55 }}>
        <summary style={{ cursor: "pointer", color: C.brandPrimaryDeep, fontWeight: 600 }}>
          How the math works
        </summary>
        <ul style={{ margin: "10px 0 0", paddingLeft: 18 }}>
          {PLANS.map(p => <li key={p.key}><strong>{p.name}.</strong> {p.note}</li>)}
          <li><strong>Braid Boss Pro.</strong> One $9.99 founding payment. No monthly bill, no marketplace cut, ever. Stripe processing fees (~2.9% + 30¢) apply on any platform that takes card payments.</li>
        </ul>
        <p style={{ marginTop: 10 }}>
          Numbers above are public-plan estimates for comparison — always check current pricing on each platform.
        </p>
      </details>
    </div>
  );
}

const NumberField = ({
  label, value, min, max, onChange, prefix, suffix, help,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  prefix?: string;
  suffix?: string;
  help?: string;
}) => (
  <label style={{ display: "grid", gap: 4 }}>
    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: C.muted }}>
      {label}
    </span>
    <div style={{
      display: "flex", alignItems: "center", gap: 4,
      border: `1px solid ${C.brandBorder}`, borderRadius: 12, padding: "10px 12px",
      background: C.brandSurface,
    }}>
      {prefix && <span style={{ color: C.muted, fontSize: 14 }}>{prefix}</span>}
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)));
        }}
        style={{
          flex: 1, minWidth: 0, border: 0, background: "transparent",
          fontSize: 18, fontWeight: 700, color: C.ink, outline: "none",
        }}
      />
      {suffix && <span style={{ color: C.muted, fontSize: 14 }}>{suffix}</span>}
    </div>
    {help && <span style={{ fontSize: 11, color: C.muted }}>{help}</span>}
  </label>
);
