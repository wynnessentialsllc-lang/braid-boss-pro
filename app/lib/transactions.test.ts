import { describe, it, expect } from "vitest";
import {
  computeSummary,
  deriveAppointmentTransactions,
  fromManualRecord,
  fromStripeRecord,
  mergeTransactions,
  reconcilePaidAppointments,
} from "./transactions";

// Regression for "Stripe payment shows as Cash": an appointment whose
// balance was paid by card must read as a Stripe payment (so it lands in the
// Stripe filter, not Cash), even if paymentMethod still says "cash".
describe("deriveAppointmentTransactions — Stripe method detection", () => {
  it("labels a balance-paid-by-card appointment as Stripe despite a cash paymentMethod", () => {
    const [row] = deriveAppointmentTransactions([
      {
        id: "appt_claudia",
        clientName: "Claudia Vine",
        totalPrice: 304.74,
        depositPaid: 304.74, // legacy-flattened → single "full" row
        balanceDue: 0,
        balance_paid: true,
        paymentStatus: "paid",
        paymentMethod: "cash", // stale default
        tipAmount: 30,
        stripeFee: 18.85,
        stripeNet: 290.89,
        balance_payment_intent_id: "pi_claudia",
      },
    ]);
    expect(row.type).toBe("full");
    expect(row.method).toBe("stripe");
    expect(row.fee).toBe(18.85);
  });

  it("keeps a genuine cash payment as cash", () => {
    const [row] = deriveAppointmentTransactions([
      {
        id: "appt_cash",
        clientName: "Zee",
        totalPrice: 150,
        depositPaid: 150,
        balanceDue: 0,
        paymentStatus: "paid",
        paymentMethod: "cash",
      },
    ]);
    expect(row.method).toBe("cash");
  });
});

// computeSummary reports revenue NET of Stripe fees — what actually lands.
describe("computeSummary net of Stripe fees", () => {
  it("subtracts the Stripe fee from the period revenue", () => {
    const now = new Date("2026-07-15T12:00:00.000Z");
    const paid = fromStripeRecord({
      id: "ch_1",
      amount: 304.74,
      fee: 18.85,
      net: 285.89,
      type: "charge",
      payment_type: "full",
      payment_intent: "pi_1",
      paid_at: "2026-07-15T10:00:00.000Z",
    });
    const s = computeSummary([paid], [], now);
    // $304.74 collected − $18.85 fee = $285.89 net.
    expect(s.monthGross).toBe(304.74);
    expect(s.monthFees).toBe(18.85);
    expect(s.todayRevenue).toBe(285.89);
    expect(s.monthRevenue).toBe(285.89);
  });

  it("a paid → refunded → paid-again nets to the successful payment; the refunded charge's fee stays a loss", () => {
    const now = new Date("2026-07-11T23:30:00.000Z");
    // The route emits, per charge, a +charge row and a separate −refund row.
    // A full refund reverses the charge's amount and tip, but NOT the Stripe
    // fee — Stripe keeps its fee on a refund, so it stays a real loss on the
    // original charge (the refund row carries fee 0).
    const charge1 = fromStripeRecord({
      id: "ch1", amount: 279.74, tip: 30, fee: 18.85, net: 290.89, type: "charge",
      payment_type: "final", payment_intent: "pi_1", appointment_id: "appt_c",
      paid_at: "2026-07-11T10:00:00.000Z", client_name: "Claudia Vine",
    });
    const refund1 = fromStripeRecord({
      id: "ch1_re", amount: 279.74, tip: 30, fee: 18.85, type: "refund",
      payment_type: "refund", payment_intent: "pi_1", appointment_id: "appt_c",
      paid_at: "2026-07-11T11:00:00.000Z", client_name: "Claudia Vine",
    });
    const charge2 = fromStripeRecord({
      id: "ch2", amount: 279.74, tip: 30, fee: 18.85, net: 290.89, type: "charge",
      payment_type: "final", payment_intent: "pi_2", appointment_id: "appt_c",
      paid_at: "2026-07-11T12:00:00.000Z", client_name: "Claudia Vine",
    });
    // The appointment, paid, linked to the successful re-payment (pi_2).
    const appt = {
      id: "appt_c", clientName: "Claudia Vine", totalPrice: 304.74, depositPaid: 304.74,
      balanceDue: 0, balance_paid: true, paymentStatus: "paid", tipAmount: 30,
      stripeFee: 18.85, balance_payment_intent_id: "pi_2",
    };
    const merged = mergeTransactions(deriveAppointmentTransactions([appt]), [charge1, refund1, charge2], []);
    const s = computeSummary(merged, [appt], now);
    // charge1's revenue and tip cancel against its refund; charge2 folds into
    // the appointment ($334.74 incl. $30 tip). Only the successful payment's
    // revenue survives.
    expect(s.monthGross).toBe(334.74);
    // Net = $334.74 − BOTH Stripe fees ($18.85 each): the surviving charge's
    // fee and the refunded charge's fee, which Stripe keeps as a real loss.
    expect(s.monthRevenue).toBe(297.04);
    // One real $30 tip — the refunded charge's tip is reversed, not stacked.
    expect(s.tips).toBe(30);
  });

  it("leaves cash revenue (no fee) unchanged", () => {
    const now = new Date("2026-07-15T12:00:00.000Z");
    const cash = fromManualRecord({
      id: "m1",
      clientName: "Zee",
      amount: 150,
      paymentType: "full",
      paymentMethod: "cash",
      paidAt: "2026-07-15T10:00:00.000Z",
    });
    const s = computeSummary([cash], [], now);
    expect(s.monthFees).toBe(0);
    expect(s.todayRevenue).toBe(150);
  });

  it("a cash full payment stands while a separate refunded Stripe charge cancels itself", () => {
    // Mirrors the reported screenshot: Claudia has three rows on the same day
    //   • Full Payment · Cash  $334.74  +$30 tip   (the payment that stands)
    //   • Final Payment · Stripe  $309.74  +$30 tip (refunded)
    //   • Refund · Stripe  −$309.74                  (reverses the Stripe charge)
    const now = new Date("2026-07-11T23:30:00.000Z");
    const cashFull = fromManualRecord({
      id: "m_cash", clientName: "Claudia Vine", serviceName: "Boho Knotless Braids",
      amount: 334.74, tipAmount: 30, paymentType: "full", paymentMethod: "cash",
      paidAt: "2026-07-11T17:00:00.000Z",
    });
    const stripeCharge = fromStripeRecord({
      id: "ch_s", amount: 309.74, tip: 30, fee: 9.28, net: 330.46, type: "charge",
      payment_type: "final", payment_intent: "pi_s",
      paid_at: "2026-07-11T22:47:00.000Z", client_name: "Claudia Vine",
    });
    const stripeRefund = fromStripeRecord({
      id: "ch_s_re", amount: 309.74, tip: 30, fee: 9.28, type: "refund",
      payment_type: "refund", payment_intent: "pi_s",
      paid_at: "2026-07-11T23:04:00.000Z", client_name: "Claudia Vine",
    });
    const s = computeSummary([cashFull, stripeCharge, stripeRefund], [], now);
    // The Stripe charge's revenue + tip cancel against its refund, leaving the
    // cash payment ($334.74 + $30 tip) MINUS the $9.28 fee Stripe kept on the
    // refunded charge — a real, non-recovered loss: 364.74 − 9.28 = 355.46.
    expect(s.todayRevenue).toBe(355.46);
    // The refunded charge's fee is not recovered, so it still counts.
    expect(s.monthFees).toBe(9.28);
    // One real tip survives — not $60.
    expect(s.tips).toBe(30);
  });
});

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

  it("marks paid while preserving the deposit/balance split and Stripe fee/net", () => {
    const [fixed] = reconcilePaidAppointments([claudiaAppt()], [claudiaBalanceCharge()], "2026-07-11");
    expect(fixed).toBeTruthy();
    expect(fixed.paymentStatus).toBe("paid");
    expect(fixed.balance_paid).toBe(true);
    expect(fixed.balanceDue).toBe(0);
    expect(fixed.status).toBe("completed");
    // The original $25 deposit is NOT collapsed into the total — the
    // deposit-vs-balance breakdown survives for the receipt and ledger.
    expect(fixed.depositPaid).toBe(25);
    // Tip preserved, balance intent stamped for ledger de-dupe.
    expect(fixed.tipAmount).toBe(30);
    expect(fixed.balance_payment_intent_id).toBe("pi_claudia_balance");
    // Stripe fee + true net payout persisted so totals show what landed.
    expect(fixed.stripeFee).toBe(18.85);
    expect(fixed.stripeNet).toBe(290.89);
  });

  it("derives the deposit + balance rows (with fee/net) and de-dupes the Stripe charge", () => {
    const [fixed] = reconcilePaidAppointments([claudiaAppt()], [claudiaBalanceCharge()], "2026-07-11");
    const merged = mergeTransactions(
      deriveAppointmentTransactions([fixed]),
      [claudiaBalanceCharge()],
      [],
    );
    const claudiaRows = merged.filter((t) => t.clientName === "Claudia Vine");
    // Two appointment rows — the $25 deposit and the $279.74 balance — and
    // the live Stripe charge collapses into the balance row (no third entry).
    expect(claudiaRows).toHaveLength(2);
    expect(claudiaRows.every((r) => r.source === "appointment")).toBe(true);
    const deposit = claudiaRows.find((r) => r.type === "deposit");
    const balance = claudiaRows.find((r) => r.type === "final");
    expect(deposit?.amount).toBe(25);
    expect(balance?.amount).toBe(279.74);
    // The balance row carries the Stripe fee + net payout.
    expect(balance?.fee).toBe(18.85);
    expect(balance?.net).toBe(290.89);
    expect(balance?.stripeId).toBe("pi_claudia_balance");
    // Full collected still sums to the whole ticket.
    const collected = claudiaRows.reduce((s, r) => s + r.amount, 0);
    expect(Math.round(collected * 100) / 100).toBe(304.74);
  });

  it("leaves an already-paid appointment that already has its fee alone (idempotent)", () => {
    const paid = {
      ...claudiaAppt(),
      paymentStatus: "paid",
      balance_paid: true,
      balanceDue: 0,
      stripeFee: 18.85,
      stripeNet: 290.89,
    };
    expect(reconcilePaidAppointments([paid], [claudiaBalanceCharge()], "2026-07-11")).toHaveLength(0);
  });

  it("back-fills the Stripe fee on an appointment the webhook paid without it", () => {
    // The balance webhook marks it paid but doesn't know the Stripe fee, so
    // the record has no fee and the net-of-fees totals would be wrong. The
    // live charge supplies it on the next reconcile.
    const paidNoFee = { ...claudiaAppt(), paymentStatus: "paid", balance_paid: true, balanceDue: 0 };
    const [fixed] = reconcilePaidAppointments([paidNoFee], [claudiaBalanceCharge()], "2026-07-11");
    expect(fixed).toBeTruthy();
    expect(fixed.stripeFee).toBe(18.85);
    expect(fixed.stripeNet).toBe(290.89);
    // It doesn't disturb the existing paid state.
    expect(fixed.paymentStatus).toBe("paid");
    expect(fixed.depositPaid).toBe(25);
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
