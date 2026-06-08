// Profit & per-hour math for the pricing calculator (stylist side).
//
// The calculator's computePricing() builds a CLIENT-facing price by
// summing hair + labor + travel + add-ons + overhead + a flat
// "profit margin" markup. That tells the client what to pay, but it
// never tells the stylist the two numbers that actually run a braid
// business:
//
//   1. Take-home  — what's left after the real out-of-pocket cost of
//      doing the style (hair + supplies/overhead). Labor is the
//      stylist's own time, so it counts as earnings, not cost.
//   2. $/hour     — take-home divided by hours in the chair. An
//      8-hour install that nets $178 ($22/hr) is a very different
//      business decision than a 2-hour style that nets $120 ($60/hr),
//      even though the bigger number looks better on the booking page.
//
// We also surface "profit above wage": what's left after the stylist
// pays themselves their own hourly rate. Negative means the price
// doesn't even cover the time at the rate they set — a real signal.
//
// Pure module: no React, no Supabase. Unit-tested in
// pricing-profit.test.ts and reused by the AI consultation prefill.

const round2 = (n: number): number => Math.round(n * 100) / 100;

export type ProfitInputs = {
  /** Out-of-pocket hair + product cost for this style. */
  hairCost: number;
  /** Supplies, utilities, and other per-appointment overhead. */
  overhead: number;
  /** Stylist's own time, valued at hourlyRate × hours. */
  labor: number;
  /** Hours in the chair for this style. */
  hours: number;
  /** Service revenue AFTER any discount, BEFORE tip. */
  subtotal: number;
  /** Tip amount (pass-through to the stylist; excluded from margin). */
  tipAmount: number;
};

export type ProfitBreakdown = {
  /** hair + overhead — the real money spent to do the style. */
  materialCost: number;
  /** Service revenue used for margin (subtotal, tip excluded). */
  revenue: number;
  /** revenue − materialCost. What the stylist keeps for the job. */
  takeHome: number;
  /** takeHome + tip — total cash in pocket including the tip. */
  takeHomeWithTip: number;
  /** takeHome ÷ hours, or null when hours is 0/unknown. */
  takeHomePerHour: number | null;
  /** revenue − materialCost − labor. Profit above the stylist's wage. */
  profitAboveWage: number;
  /** takeHome ÷ revenue × 100, or null when revenue is 0. */
  marginPct: number | null;
};

export const computeProfit = (input: ProfitInputs): ProfitBreakdown => {
  const hairCost = Number(input.hairCost) || 0;
  const overhead = Number(input.overhead) || 0;
  const labor = Number(input.labor) || 0;
  const hours = Number(input.hours) || 0;
  const revenue = Number(input.subtotal) || 0;
  const tipAmount = Number(input.tipAmount) || 0;

  const materialCost = hairCost + overhead;
  const takeHome = revenue - materialCost;
  const takeHomeWithTip = takeHome + tipAmount;
  const takeHomePerHour = hours > 0 ? takeHome / hours : null;
  const profitAboveWage = revenue - materialCost - labor;
  const marginPct = revenue > 0 ? (takeHome / revenue) * 100 : null;

  return {
    materialCost: round2(materialCost),
    revenue: round2(revenue),
    takeHome: round2(takeHome),
    takeHomeWithTip: round2(takeHomeWithTip),
    takeHomePerHour: takeHomePerHour == null ? null : round2(takeHomePerHour),
    profitAboveWage: round2(profitAboveWage),
    marginPct: marginPct == null ? null : round2(marginPct),
  };
};
