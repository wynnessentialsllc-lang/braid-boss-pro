import { describe, it, expect } from "vitest";
import {
  deriveAppointmentTransactions,
  fromManualRecord,
  fromStripeRecord,
  mergeTransactions,
} from "./transactions";

// Regression for the "unknown booking" duplicate: a Stripe deposit charge
// and the appointment-derived deposit row describe the same money and must
// collapse into one. Deposits don't stamp the payment_intent onto the
// appointment (it lives on the booking_request), so the de-dupe has to key
// on appointmentId + type — which works because the transactions API now
// resolves the booking_request to its real appointment id.

// Bailey Cooper booked Knotless Braids (Medium); a $25 deposit was paid on
// a card billed to "Alexia Trimble" (a friend paying on her behalf).
const baileyAppointment = {
  id: "appt_bailey1",
  clientName: "Bailey Cooper",
  style: "Knotless Braids (Medium)",
  totalPrice: 200,
  depositPaid: 25,
  balanceDue: 175,
  paymentMethod: "stripe",
  status: "scheduled",
};

// What /api/stripe-connect/transactions emits for the live deposit charge
// once it has resolved booking_request -> appointment_id + real names.
const baileyStripeDeposit = {
  id: "ch_bailey_deposit",
  amount: 25,
  fee: 1.03,
  net: 23.97,
  paid_at: "2026-05-22T14:55:00.000Z",
  client_name: "Bailey Cooper",
  service_name: "Knotless Braids (Medium)",
  payment_intent: "pi_bailey_deposit",
  charge: "ch_bailey_deposit",
  appointment_id: "appt_bailey1",
  payment_type: "deposit",
  type: "charge",
  refunds: [],
};

describe("mergeTransactions de-dupe", () => {
  it("collapses a live Stripe deposit into its appointment deposit row", () => {
    const apptTxns = deriveAppointmentTransactions([baileyAppointment]);
    const stripeTxns = [fromStripeRecord(baileyStripeDeposit)];

    const merged = mergeTransactions(apptTxns, stripeTxns, []);
    const deposits = merged.filter((t) => t.type === "deposit");

    expect(deposits).toHaveLength(1);
    // The surviving row is the appointment-derived one with real context.
    expect(deposits[0].source).toBe("appointment");
    expect(deposits[0].clientName).toBe("Bailey Cooper");
    expect(deposits[0].serviceName).toBe("Knotless Braids (Medium)");
    // ...but it inherits the live Stripe payment_intent + fee/net so the
    // Payments screen can issue a card refund against it.
    expect(deposits[0].stripeId).toBe("pi_bailey_deposit");
    expect(deposits[0].fee).toBe(1.03);
    expect(deposits[0].net).toBe(23.97);
  });

  it("carries Stripe refund history onto the appointment row it collapses into", () => {
    const apptTxns = deriveAppointmentTransactions([baileyAppointment]);
    const stripeTxns = [
      fromStripeRecord({
        ...baileyStripeDeposit,
        refunds: [
          { id: "re_1", amount: 10, reason: "requested_by_customer", date: "2026-06-01T00:00:00.000Z" },
        ],
      }),
    ];

    const merged = mergeTransactions(apptTxns, stripeTxns, []);
    const deposit = merged.find((t) => t.type === "deposit");
    expect(deposit?.refunds).toHaveLength(1);
    expect(deposit?.refunds[0].amount).toBe(10);
  });

  it("still de-dupes by payment_intent (balance payments)", () => {
    const appt = {
      id: "appt_x",
      clientName: "Dana",
      style: "Twists",
      totalPrice: 100,
      depositPaid: 0,
      balanceDue: 0,
      paymentStatus: "paid",
      balance_paid: true,
      balance_payment_intent_id: "pi_balance_x",
      paymentMethod: "stripe",
    };
    const apptTxns = deriveAppointmentTransactions([appt]);
    const stripeRow = fromStripeRecord({
      id: "ch_x",
      amount: 100,
      payment_intent: "pi_balance_x",
      appointment_id: null,
      payment_type: "full",
      type: "charge",
    });

    const merged = mergeTransactions(apptTxns, [stripeRow], []);
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe("appointment");
  });

  it("keeps an unrelated Stripe charge that matches no appointment", () => {
    const apptTxns = deriveAppointmentTransactions([baileyAppointment]);
    const orphan = fromStripeRecord({
      id: "ch_orphan",
      amount: 1,
      payment_intent: "pi_orphan",
      appointment_id: null,
      payment_type: "full",
      type: "charge",
    });

    const merged = mergeTransactions(apptTxns, [orphan], []);
    expect(merged.some((t) => t.id === "stripe-ch_orphan")).toBe(true);
  });
});

describe("fromStripeRecord refund signing", () => {
  it("signs a refund negative (money out) and keeps the refund-dated timestamp", () => {
    // What the route now emits for a fully-refunded deposit charge:
    // type 'refund', positive charge amount, paid_at = the refund's date.
    const t = fromStripeRecord({
      id: "ch_refunded",
      amount: 25,
      net: 23.97,
      type: "refund",
      payment_type: "deposit",
      paid_at: "2026-06-07T21:00:00.000Z",
      refunds: [{ id: "re_1", amount: 25, date: "2026-06-07T21:00:00.000Z" }],
    });
    expect(t.type).toBe("refund");
    expect(t.amount).toBe(-25);   // reads as -$25 and reduces revenue
    expect(t.net).toBe(-23.97);
    expect(t.paidAt).toBe("2026-06-07T21:00:00.000Z");
  });

  it("leaves a normal charge positive", () => {
    const t = fromStripeRecord({
      id: "ch_ok",
      amount: 100,
      net: 96.8,
      type: "charge",
      payment_type: "full",
    });
    expect(t.amount).toBe(100);
    expect(t.net).toBe(96.8);
  });
});

// Regression for the "refund shows twice" report: issuing a full card
// refund from the Payments screen writes an optimistic manual `refund`
// row AND the Stripe sync surfaces the now fully-refunded charge as its
// own refund row. Both describe the same money and must collapse to one —
// otherwise the refund is listed twice and double-counted in the summary.
describe("mergeTransactions refund de-dupe", () => {
  const stripeRefund = () =>
    fromStripeRecord({
      id: "ch_claudia",
      amount: 309.74,
      net: 300,
      type: "refund",
      payment_type: "full",
      payment_intent: "pi_claudia",
      paid_at: "2026-07-11T23:04:00.000Z",
      client_name: "Claudia Vine",
      service_name: "Stripe payment",
      refunds: [{ id: "re_claudia", amount: 309.74, date: "2026-07-11T23:04:00.000Z" }],
    });

  const manualRefund = (overrides: Record<string, unknown> = {}) =>
    fromManualRecord({
      id: "m1",
      clientName: "Claudia Vine",
      serviceName: "Stripe payment",
      amount: 309.74,
      paymentType: "refund",
      paymentMethod: "stripe",
      stripeId: "pi_claudia",
      paidAt: "2026-07-11T23:04:05.000Z",
      ...overrides,
    });

  it("collapses the optimistic manual refund into the Stripe-surfaced refund", () => {
    const merged = mergeTransactions([], [stripeRefund()], [manualRefund()]);
    const refunds = merged.filter((t) => t.type === "refund");
    expect(refunds).toHaveLength(1);
    // The surviving row is the Stripe one — it carries the real fee/net.
    expect(refunds[0].source).toBe("stripe");
    // And the summed refund amount is the single −$309.74, not −$619.48.
    const refundTotal = merged
      .filter((t) => t.amount < 0)
      .reduce((s, t) => s + t.amount, 0);
    expect(refundTotal).toBe(-309.74);
  });

  it("keeps a manual card refund until the Stripe refund row arrives", () => {
    // Before Stripe sync catches up there's no Stripe refund row yet — the
    // optimistic manual row is all we have and must still show.
    const merged = mergeTransactions([], [], [manualRefund()]);
    expect(merged.filter((t) => t.type === "refund")).toHaveLength(1);
  });

  it("keeps a partial card refund's manual row (charge stays a positive row)", () => {
    // A partial refund leaves the charge positive, so Stripe never emits a
    // refund row for it; the manual row is the only ledger entry.
    const positiveCharge = fromStripeRecord({
      id: "ch_claudia",
      amount: 309.74,
      type: "charge",
      payment_type: "full",
      payment_intent: "pi_claudia",
    });
    const merged = mergeTransactions([], [positiveCharge], [manualRefund({ amount: 50 })]);
    expect(merged.filter((t) => t.type === "refund")).toHaveLength(1);
  });

  it("keeps a cash refund (no stripeId) untouched", () => {
    const merged = mergeTransactions(
      [],
      [stripeRefund()],
      [manualRefund({ id: "m2", paymentMethod: "cash", stripeId: null })],
    );
    // The cash refund isn't tied to the Stripe charge, so both survive.
    expect(merged.filter((t) => t.type === "refund")).toHaveLength(2);
  });
});
