import { describe, it, expect } from "vitest";
import {
  deriveAppointmentTransactions,
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
