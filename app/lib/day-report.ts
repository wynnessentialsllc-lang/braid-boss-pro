// Day report — the Boss Checkout "Z report" / end-of-day cash-out.
//
// Square calls it Reports; a register calls it the Z report. Given the
// day's transactions (already normalised by lib/transactions.ts into one
// Transaction shape across appointments + manual sales + Stripe), this
// rolls them into the numbers a stylist reconciles at close: how much
// came in, split by how it was taken (cash vs Tap to Pay vs Zelle…),
// tips, refunds, and the net that should be in the drawer / on the card.
//
// Pure module: no React, no Supabase, no DOM. Money is in the currency's
// major unit (dollars). Unit-tested in day-report.test.ts.

import type { Transaction, PaymentMethod } from "./transactions";
import { METHOD_LABEL } from "./transactions";

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

// Local calendar day (YYYY-MM-DD) for an ISO timestamp, so "today" lines
// up with the stylist's wall clock rather than UTC.
export const localDayKey = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export type TenderTotal = {
  method: PaymentMethod;
  label: string;
  count: number;
  /** Net for this tender: collections + tips − refunds. */
  amount: number;
};

export type DayReport = {
  dateISO: string;
  /** Number of money-in transactions (refunds excluded). */
  count: number;
  /** Sum of positive amounts (goods/services collected, tip excluded). */
  grossCollected: number;
  tips: number;
  /** Absolute total refunded on the day. */
  refunds: number;
  /** grossCollected + tips − refunds — what nets out for the day. */
  net: number;
  /** Of the collections, how much was deposits. */
  deposits: number;
  /** Per-tender breakdown, biggest first. */
  byTender: TenderTotal[];
  /** The day's transactions, newest first, for the detail list. */
  txns: Transaction[];
};

export const buildDayReport = (
  allTxns: Transaction[] | null | undefined,
  dateISO: string,
): DayReport => {
  const txns = (Array.isArray(allTxns) ? allTxns : [])
    .filter((t) => localDayKey(t.paidAt) === dateISO)
    .sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime());

  let grossCollected = 0;
  let tips = 0;
  let refunds = 0;
  let deposits = 0;
  let count = 0;
  const tenderMap = new Map<PaymentMethod, { count: number; amount: number }>();

  for (const t of txns) {
    const isRefund = t.amount < 0 || t.type === "refund";
    const tender = tenderMap.get(t.method) || { count: 0, amount: 0 };
    if (isRefund) {
      refunds += Math.abs(t.amount);
      tender.amount += t.amount; // negative — reduces the tender's net
    } else {
      grossCollected += t.amount;
      tips += t.tip;
      count += 1;
      tender.count += 1;
      tender.amount += t.amount + t.tip;
      if (t.type === "deposit") deposits += t.amount;
    }
    tenderMap.set(t.method, tender);
  }

  const byTender: TenderTotal[] = Array.from(tenderMap.entries())
    .map(([method, v]) => ({ method, label: METHOD_LABEL[method] || method, count: v.count, amount: round2(v.amount) }))
    .sort((a, b) => b.amount - a.amount);

  return {
    dateISO,
    count,
    grossCollected: round2(grossCollected),
    tips: round2(tips),
    refunds: round2(refunds),
    net: round2(grossCollected + tips - refunds),
    deposits: round2(deposits),
    byTender,
    txns,
  };
};
