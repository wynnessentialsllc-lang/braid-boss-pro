import { describe, it, expect } from "vitest";
import {
  deriveAppointmentTransactions,
  fromManualRecord,
  fromStripeRecord,
  mergeTransactions,
  reconcilePaidAppointments,
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

  it("collapses a legacy manual refund with no payment_intent (amount+client+day)", () => {
    // The duplicate a stylist actually hit: the manual refund row was
    // recorded before refunds carried a payment_intent, so it can only be
    // matched to the Stripe refund by amount + client + day.
    const legacyManual = manualRefund({ id: "legacy", stripeId: null });
    const merged = mergeTransactions([], [stripeRefund()], [legacyManual]);
    const refunds = merged.filter((t) => t.type === "refund");
    expect(refunds).toHaveLength(1);
    expect(refunds[0].source).toBe("stripe");
    // Today's summary reads one −$309.74, not −$619.48.
    const refundTotal = merged.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);
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

// Regression for the Tap-to-Pay checkout double: a Boss Checkout sale paid
// by card is recorded as a manual ledger row (with the ticket context) AND
// re-appears as the live Stripe charge for the same payment_intent. The two
// must collapse into one row so the sale isn't listed (or counted) twice.
describe("mergeTransactions Boss Checkout card-sale de-dupe", () => {
  // What buildSaleTransaction persists for a Tap-to-Pay ticket: the
  // payment_intent lives on data.stripePaymentIntentId.
  const checkoutSale = () =>
    fromManualRecord({
      id: "sale_1",
      clientName: "Walk-in",
      serviceName: "Edge control ×2 + 1 more",
      amount: 150,
      paymentType: "full",
      paymentMethod: "stripe",
      data: { source: "boss_checkout", tender: "tap_to_pay", stripePaymentIntentId: "pi_ttp_1" },
    });

  // The same sale as it comes back from the connected account's charges.
  const stripeCharge = () =>
    fromStripeRecord({
      id: "ch_ttp_1",
      amount: 150,
      fee: 4.5,
      net: 145.5,
      type: "charge",
      payment_type: "full",
      payment_intent: "pi_ttp_1",
      appointment_id: null,
      service_name: "Stripe payment",
    });

  it("collapses the Stripe charge into the checkout row (one entry, ticket kept)", () => {
    const merged = mergeTransactions([], [stripeCharge()], [checkoutSale()]);
    const sales = merged.filter((t) => t.amount > 0);
    expect(sales).toHaveLength(1);
    // The surviving row is the Boss Checkout one — it has the itemized
    // ticket label, not the generic "Stripe payment" description.
    expect(sales[0].source).toBe("manual");
    expect(sales[0].serviceName).toBe("Edge control ×2 + 1 more");
    // ...enriched with the live Stripe fee/net it otherwise wouldn't have.
    expect(sales[0].fee).toBe(4.5);
    expect(sales[0].net).toBe(145.5);
  });

  it("leaves a cash checkout sale (no payment_intent) and unrelated Stripe charge alone", () => {
    const cashSale = fromManualRecord({
      id: "sale_cash",
      clientName: "Walk-in",
      serviceName: "Bundle",
      amount: 60,
      paymentType: "full",
      paymentMethod: "cash",
      data: { source: "boss_checkout", tender: "cash" },
    });
    const merged = mergeTransactions([], [stripeCharge()], [cashSale]);
    // No shared payment_intent — the cash sale and the card charge are
    // different money, so both stay.
    expect(merged.filter((t) => t.amount > 0)).toHaveLength(2);
  });
});

// Regression for "Claudia paid but the schedule still shows a balance due":
// the balance charge succeeds on Stripe (it's in the ledger) but the balance
// webhook never marked the appointment paid, so the booking stays "due".
describe("reconcilePaidAppointments", () => {
  // Claudia's booking: $304.74 ticket, $25 deposit already down, $279.74 due.
  const claudiaAppt = () => ({
    id: "appt_claudia",
    clientName: "Claudia Vine",
    style: "Boho Knotless Braids (Small/Medium)",
    totalPrice: 304.74,
    depositPaid: 25,
    balanceDue: 279.74,
    status: "scheduled",
    paymentStatus: "",
  });

  // The live balance charge: $309.74 = $279.74 balance + $30 tip.
  const claudiaBalanceCharge = () =>
    fromStripeRecord({
      id: "ch_claudia_balance",
      amount: 309.74,
      tip: 30,
      net: 290.89,
      fee: 18.85,
      type: "charge",
      payment_type: "final",
      payment_intent: "pi_claudia_balance",
      appointment_id: "appt_claudia",
      client_name: "Claudia Vine",
    });

  it("marks the appointment paid in full when a linked balance charge covers it", () => {
    const [fixed] = reconcilePaidAppointments([claudiaAppt()], [claudiaBalanceCharge()], "2026-07-11");
    expect(fixed).toBeTruthy();
    expect(fixed.paymentStatus).toBe("paid");
    expect(fixed.balanceDue).toBe(0);
    // depositPaid is bumped to the net ticket so collected-revenue math is
    // right (the whole $304.74, not just the original $25 deposit).
    expect(fixed.depositPaid).toBe(304.74);
    expect(fixed.status).toBe("completed");
    // Tip is preserved and the balance intent stamped for ledger de-dupe.
    expect(fixed.tipAmount).toBe(30);
    expect(fixed.balance_payment_intent_id).toBe("pi_claudia_balance");
  });

  it("the reconciled appointment de-dupes the Stripe balance row (no double entry)", () => {
    const [fixed] = reconcilePaidAppointments([claudiaAppt()], [claudiaBalanceCharge()], "2026-07-11");
    const merged = mergeTransactions(
      deriveAppointmentTransactions([fixed]),
      [claudiaBalanceCharge()],
      [],
    );
    // One row for Claudia's payment, sourced from the appointment, carrying
    // the live Stripe fee/net that merge folds in.
    const claudiaRows = merged.filter((t) => t.clientName === "Claudia Vine");
    expect(claudiaRows).toHaveLength(1);
    expect(claudiaRows[0].source).toBe("appointment");
    expect(claudiaRows[0].stripeId).toBe("pi_claudia_balance");
  });

  it("leaves an already-paid appointment alone (idempotent)", () => {
    const paid = { ...claudiaAppt(), paymentStatus: "paid", depositPaid: 304.74, balanceDue: 0 };
    expect(reconcilePaidAppointments([paid], [claudiaBalanceCharge()], "2026-07-11")).toHaveLength(0);
  });

  it("does not flip a booking when the charge only partially covers the balance", () => {
    const partial = fromStripeRecord({
      id: "ch_partial",
      amount: 100,
      type: "charge",
      payment_type: "final",
      payment_intent: "pi_partial",
      appointment_id: "appt_claudia",
    });
    expect(reconcilePaidAppointments([claudiaAppt()], [partial], "2026-07-11")).toHaveLength(0);
  });

  it("ignores a Stripe charge that isn't linked to any known appointment", () => {
    const orphan = fromStripeRecord({
      id: "ch_orphan",
      amount: 500,
      type: "charge",
      payment_type: "full",
      payment_intent: "pi_orphan",
      appointment_id: "appt_missing",
    });
    expect(reconcilePaidAppointments([claudiaAppt()], [orphan], "2026-07-11")).toHaveLength(0);
  });
});
