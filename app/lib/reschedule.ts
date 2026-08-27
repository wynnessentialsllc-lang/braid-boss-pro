// Rescheduling an existing appointment — pure helpers.
//
// Moving an appointment must never disturb the money already on it.
// The deposit, how it was paid, and when it was paid all belong to the
// booking, not to the slot, so they follow the appointment to its new
// date and time; only the balance is recomputed (from the same deposit)
// so the arithmetic stays consistent.
//
// Pure functions only — no React, no Supabase, no DOM.

export type ReschedulableAppointment = {
  date?: string | null;
  time?: string | null;
  totalPrice?: number | string | null;
  discountAmount?: number | string | null;
  creditApplied?: number | string | null;
  depositPaid?: number | string | null;
  balanceDue?: number | string | null;
  paymentStatus?: string | null;
  paymentDate?: string | null;
  paymentMethod?: string | null;
  paymentNotes?: string | null;
  balance_paid?: boolean;
  balancePaid?: boolean;
  [key: string]: unknown;
};

export type NewSlot = { date: string; time: string };

const num = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/** True when the slot actually moved — a no-op save shouldn't resync. */
export const scheduleChanged = (
  appt: ReschedulableAppointment,
  slot: Partial<NewSlot>,
): boolean => {
  const sameDate = String(appt?.date ?? "") === String(slot?.date ?? "");
  const sameTime = String(appt?.time ?? "") === String(slot?.time ?? "");
  return !(sameDate && sameTime);
};

/**
 * What the client has already put down and what they still owe, after
 * discount and any store credit. Used for the balance the reschedule
 * email quotes, so a moved appointment never reads as unpaid.
 */
export const depositCarryover = (
  appt: ReschedulableAppointment,
): { depositPaid: number; remainingBalance: number; paidInFull: boolean } => {
  const gross = Math.max(0, round2(num(appt?.totalPrice)));
  const discount = Math.max(0, round2(num(appt?.discountAmount)));
  const credit = Math.max(0, round2(num(appt?.creditApplied)));
  const net = Math.max(0, round2(gross - discount));
  // Clamp the same way the appointment normalizer does, so the email and
  // the record can't disagree about an over-large deposit.
  let deposit = Math.max(0, round2(num(appt?.depositPaid)));
  if (net > 0 && deposit > net) deposit = net;
  const paidInFull =
    appt?.balance_paid === true ||
    appt?.balancePaid === true ||
    (net > 0 && round2(deposit + credit) >= net);
  const remainingBalance = paidInFull
    ? 0
    : Math.max(0, round2(net - deposit - credit));
  return { depositPaid: deposit, remainingBalance, paidInFull };
};

/**
 * Move an appointment to a new date/time, carrying the deposit and its
 * payment provenance forward untouched and recomputing only the
 * balance. Returns a new object — the input is never mutated.
 *
 * Every other field is passed through, so this is safe to use on a
 * record that has been through the edit form (which holds money as
 * display strings) as well as on a stored appointment.
 */
export const moveAppointment = <T extends ReschedulableAppointment>(
  appt: T,
  slot: NewSlot,
): T => {
  const { depositPaid, remainingBalance } = depositCarryover(appt);
  return {
    ...appt,
    date: slot.date,
    time: slot.time,
    // The money below is deliberately re-stated rather than left to the
    // spread: it documents that a move carries it, and it keeps the
    // deposit from being dropped if the caller passes a partial record.
    depositPaid,
    balanceDue: remainingBalance,
    paymentStatus: appt?.paymentStatus ?? "",
    paymentDate: appt?.paymentDate ?? "",
    paymentMethod: appt?.paymentMethod ?? "",
    paymentNotes: appt?.paymentNotes ?? "",
  };
};
