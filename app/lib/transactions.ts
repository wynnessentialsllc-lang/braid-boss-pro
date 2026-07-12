// Payments & Transactions — pure data layer.
//
// One normalized `Transaction` shape that the Payments screen renders,
// regardless of where the money came from:
//
//   * appointment   — deposits + balance/final payments derived from
//                     the appointments the stylist already tracks.
//   * stripe        — live charges/refunds pulled from the connected
//                     Stripe account (fee + net payout included).
//   * manual         — Cash / Zelle / Cash App / Venmo rows the stylist
//                     records by hand (payment_transactions table).
//
// This module is side-effect free and has no React/DOM dependency so it
// can be imported by the page, the API route, and tests alike. Money is
// always in the currency's major unit (dollars), matching the rest of
// the app.

export type PaymentType = "deposit" | "final" | "full" | "refund";

export type PaymentMethod =
  | "stripe"
  | "cash"
  | "zelle"
  | "cashapp"
  | "venmo"
  | "card"
  | "other";

export type TransactionSource = "appointment" | "stripe" | "manual";

export type Refund = {
  id: string;
  amount: number;
  reason?: string;
  date: string; // ISO
};

export type Transaction = {
  id: string;
  source: TransactionSource;
  type: PaymentType;
  method: PaymentMethod;
  // Signed amount: positive for collections, negative for refunds.
  amount: number;
  tip: number;
  // Stripe processing fee + what actually lands in the bank. 0 when
  // unknown (manual / cash). net = amount - fee.
  fee: number;
  net: number;
  clientName: string;
  serviceName: string;
  // ISO timestamp the money moved.
  paidAt: string;
  // Linkage back to the booking, when known.
  appointmentId: string | null;
  clientId: string | null;
  // Per-transaction extras surfaced in the detail view.
  addOns: { name: string; amount: number }[];
  depositAmount: number;
  balancePaid: number;
  refunds: Refund[];
  stripeId: string | null;
  note: string;
};

export type TxnFilter =
  | "all"
  | "deposits"
  | "final"
  | "full"
  | "refunds"
  | "cash"
  | "stripe";

export const FILTERS: { key: TxnFilter; label: string }[] = [
  { key: "all", label: "All Transactions" },
  { key: "deposits", label: "Deposits" },
  { key: "final", label: "Final Payments" },
  { key: "full", label: "Paid In Full" },
  { key: "refunds", label: "Refunds" },
  { key: "cash", label: "Cash Payments" },
  { key: "stripe", label: "Stripe Payments" },
];

export const TYPE_LABEL: Record<PaymentType, string> = {
  deposit: "Deposit",
  final: "Final Payment",
  full: "Full Payment",
  refund: "Refund",
};

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  stripe: "Stripe",
  cash: "Cash",
  zelle: "Zelle",
  cashapp: "Cash App",
  venmo: "Venmo",
  card: "Card",
  other: "Other",
};

// =====================================================================
// Small money/format helpers (kept local so the module stays dep-free).
// =====================================================================

const parseMoney = (raw: unknown): number => {
  if (raw === null || raw === undefined || raw === "") return 0;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  const n = parseFloat(String(raw).replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const roundCents = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export const formatMoney = (n: number, currency = "USD"): string => {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
};

// Maps the app's free-form payment method strings onto our enum. Stripe
// flows store "stripe" / "card"; manual flows store the wallet name.
export const normalizeMethod = (raw: unknown): PaymentMethod => {
  const s = String(raw || "").toLowerCase().replace(/[\s_-]+/g, "");
  if (!s) return "other";
  if (s.includes("stripe")) return "stripe";
  if (s.includes("cashapp")) return "cashapp";
  if (s === "cash") return "cash";
  if (s.includes("zelle")) return "zelle";
  if (s.includes("venmo")) return "venmo";
  if (s.includes("card") || s.includes("credit") || s.includes("debit")) return "card";
  if (s.includes("cash")) return "cash";
  return "other";
};

// =====================================================================
// Derivation — appointments → transactions
// =====================================================================
//
// An appointment can yield up to two money movements: the deposit, and
// the balance/final payment. We collapse to a single "Full Payment" row
// when the whole ticket was settled in one go (no separate deposit), so
// the list reads like the stylist's mental model rather than the DB.

const apptServiceName = (a: any): string =>
  String(a?.serviceName || a?.style || a?.service || "Service").trim() || "Service";

const apptClientName = (a: any): string =>
  String(a?.clientName || a?.client_name || "Client").trim() || "Client";

const apptAddOns = (a: any): { name: string; amount: number }[] => {
  const raw = a?.addOns || a?.addons || a?.data?.addOns || a?.data?.addons;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x: any) => ({ name: String(x?.name || "Add-on"), amount: parseMoney(x?.amount) }))
    .filter((x: { name: string; amount: number }) => x.amount > 0 || x.name);
};

const apptTip = (a: any): number =>
  roundCents(parseMoney(a?.tipAmount ?? a?.data?.tipAmount ?? a?.tip));

// Best-effort timestamp for an appointment-derived payment. Prefers the
// explicit payment date, then the balance-paid stamp, then the booking
// date, then created_at — always a valid ISO string.
const apptPaidAt = (a: any, fallbackToBalance: boolean): string => {
  const candidates = fallbackToBalance
    ? [a?.balance_paid_at, a?.paymentDate, a?.date, a?.createdAt, a?.created_at]
    : [a?.paymentDate, a?.date, a?.createdAt, a?.created_at];
  for (const c of candidates) {
    if (!c) continue;
    const s = String(c);
    const iso = s.length === 10 ? `${s}T12:00:00.000Z` : s;
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
};

const isCanceled = (a: any): boolean => {
  const s = String(a?.status || "").toLowerCase();
  return s === "canceled" || s === "cancelled" || s === "no_show" || s === "noshow";
};

export const deriveAppointmentTransactions = (appointments: any[]): Transaction[] => {
  const out: Transaction[] = [];
  for (const a of Array.isArray(appointments) ? appointments : []) {
    if (!a || isCanceled(a)) continue;
    const apptId = a.id ? String(a.id) : null;
    const totalPrice = roundCents(parseMoney(a.totalPrice));
    const discount = roundCents(parseMoney(a.discountAmount));
    const netTotal = Math.max(0, roundCents(totalPrice - discount));
    const deposit = roundCents(parseMoney(a.depositPaid));
    const balanceDue = roundCents(parseMoney(a.balanceDue));
    const balancePaidFlag =
      a.balance_paid === true || a.balancePaid === true || a.paymentStatus === "paid";
    const method = normalizeMethod(a.paymentMethod || (a.stripe_payment_intent_id ? "stripe" : "cash"));
    const tip = apptTip(a);
    const addOns = apptAddOns(a);
    const clientName = apptClientName(a);
    const serviceName = apptServiceName(a);
    const clientId = a.clientId ? String(a.clientId) : null;

    const balancePaidAmount = balancePaidFlag
      ? roundCents(Math.max(0, netTotal - deposit))
      : 0;

    // Stripe processing fee + true net payout, persisted on the appointment
    // when a card balance/full payment is reconciled. Lets the payout-vs-
    // gross split (e.g. $304.74 collected → $281.61 net) show on the ledger
    // and receipt without a live Stripe round-trip. Applied to the payment
    // row (full/final), never the deposit row.
    const stripeFee = roundCents(parseMoney(a.stripeFee));
    const stripeNet = roundCents(parseMoney(a.stripeNet));

    const base = {
      clientName,
      serviceName,
      appointmentId: apptId,
      clientId,
      addOns,
      depositAmount: deposit,
      balancePaid: balancePaidAmount,
      refunds: [],
      fee: 0,
      net: 0,
      note: "",
    };

    // Full payment in one shot — settled with no standalone deposit, or
    // the deposit equals the whole ticket.
    const settledInFull = balancePaidFlag && (deposit === 0 || deposit >= netTotal) && netTotal > 0;

    if (settledInFull) {
      const amount = netTotal;
      out.push({
        ...base,
        id: `appt-full-${apptId}`,
        source: "appointment",
        type: "full",
        method,
        amount,
        tip,
        fee: stripeFee,
        net: stripeNet > 0 ? stripeNet : roundCents(amount + tip - stripeFee),
        paidAt: apptPaidAt(a, true),
        stripeId: a.stripe_payment_intent_id || a.balance_payment_intent_id || null,
        depositAmount: 0,
        balancePaid: amount,
      });
      continue;
    }

    // Deposit row.
    if (deposit > 0) {
      out.push({
        ...base,
        id: `appt-deposit-${apptId}`,
        source: "appointment",
        type: "deposit",
        method,
        amount: deposit,
        tip: 0,
        net: deposit,
        paidAt: apptPaidAt(a, false),
        stripeId: a.stripe_payment_intent_id || null,
        balancePaid: 0,
      });
    }

    // Final/balance payment row — carries the Stripe fee/net, since the
    // balance is the card charge.
    if (balancePaidAmount > 0) {
      out.push({
        ...base,
        id: `appt-final-${apptId}`,
        source: "appointment",
        type: "final",
        method,
        amount: balancePaidAmount,
        tip,
        fee: stripeFee,
        net: stripeNet > 0 ? stripeNet : roundCents(balancePaidAmount + tip - stripeFee),
        paidAt: apptPaidAt(a, true),
        stripeId: a.balance_payment_intent_id || null,
        depositAmount: deposit,
      });
    }

    // Surface unpaid-but-quoted appointments as nothing — they have no
    // transaction yet; their outstanding balance shows in the summary.
    void balanceDue;
  }
  return out;
};

// =====================================================================
// Manual transactions (payment_transactions rows) → transactions
// =====================================================================

export const fromManualRecord = (r: any): Transaction => {
  const amount = roundCents(parseMoney(r.amount));
  const tip = roundCents(parseMoney(r.tip_amount ?? r.tipAmount));
  const type = (["deposit", "final", "full", "refund"].includes(r.payment_type)
    ? r.payment_type
    : r.paymentType || "full") as PaymentType;
  const signed = type === "refund" ? -Math.abs(amount) : amount;
  return {
    id: `manual-${String(r.id)}`,
    source: "manual",
    type,
    method: normalizeMethod(r.payment_method ?? r.paymentMethod),
    amount: signed,
    tip,
    fee: 0,
    net: roundCents(signed + tip),
    clientName: String(r.client_name || r.clientName || "Client"),
    serviceName: String(r.service_name || r.serviceName || "Manual payment"),
    paidAt: r.paid_at || r.paidAt || r.created_at || new Date().toISOString(),
    appointmentId: r.appointment_id || r.appointmentId || null,
    clientId: r.client_id || r.clientId || null,
    addOns: [],
    depositAmount: type === "deposit" ? Math.abs(amount) : 0,
    balancePaid: type === "final" || type === "full" ? Math.abs(amount) : 0,
    refunds: [],
    // The Stripe payment_intent this row corresponds to, so mergeTransactions
    // can collapse the matching live Stripe charge into it instead of listing
    // both. Two sources: a card refund recorded from the Payments screen
    // stamps it at the top level; a Boss Checkout sale paid by card (Tap to
    // Pay) carries it on data.stripePaymentIntentId (from buildSaleTransaction).
    stripeId:
      r.stripeId ??
      r.stripe_id ??
      r.data?.stripePaymentIntentId ??
      r.data?.stripe_payment_intent_id ??
      null,
    note: String(r.note || ""),
  };
};

// =====================================================================
// Stripe balance-transaction normalization
// =====================================================================
// Shape returned by /api/stripe-connect/transactions (already
// flattened server-side). We accept the raw Stripe-ish object and map
// it onto our Transaction so the route stays a thin proxy.

export const fromStripeRecord = (r: any): Transaction => {
  const rawAmount = roundCents(parseMoney(r.amount));
  const fee = roundCents(parseMoney(r.fee));
  const rawNet = roundCents(parseMoney(r.net ?? rawAmount - fee));
  const isRefund = r.type === "refund" || rawAmount < 0;
  // Refunds are money OUT: store them signed-negative (matching the
  // manual-refund path) so they read as "−$X" and reduce revenue on the
  // refund date instead of inflating it.
  const amount = isRefund ? -Math.abs(rawAmount) : rawAmount;
  const net = isRefund ? -Math.abs(rawNet) : rawNet;
  return {
    id: `stripe-${String(r.id)}`,
    source: "stripe",
    type: isRefund ? "refund" : (r.payment_type as PaymentType) || "full",
    method: "stripe",
    amount,
    tip: roundCents(parseMoney(r.tip)),
    fee,
    net,
    clientName: String(r.client_name || r.customer_name || "Stripe customer"),
    serviceName: String(r.service_name || r.description || "Stripe payment"),
    paidAt: r.paid_at || r.created || new Date().toISOString(),
    appointmentId: r.appointment_id || null,
    clientId: null,
    addOns: [],
    depositAmount: 0,
    balancePaid: 0,
    refunds: Array.isArray(r.refunds) ? r.refunds : [],
    stripeId: r.payment_intent || r.charge || String(r.id),
    note: "",
  };
};

// =====================================================================
// Merge + de-dupe
// =====================================================================
// Appointment-derived rows are canonical for the booking context;
// when a live Stripe charge represents the same money we'd otherwise
// double-count, so matching Stripe rows are dropped (the appointment
// row already has the client/service context the Stripe row lacks).
//
// Two keys are used because deposits and balance payments differ in
// what they carry:
//   • payment_intent — present on balance charges and any appointment
//     stamped with one.
//   • appointmentId + type — the reliable key for deposits, whose
//     payment_intent lives on the booking_request rather than the
//     appointment. The transactions API resolves the booking_request to
//     the real appointment id so this match fires.

export const mergeTransactions = (
  appointmentTxns: Transaction[],
  stripeTxns: Transaction[],
  manualTxns: Transaction[],
): Transaction[] => {
  const byIntent = new Map<string, Transaction>();
  const byApptKey = new Map<string, Transaction>();
  for (const t of appointmentTxns) {
    if (t.stripeId) byIntent.set(t.stripeId, t);
    if (t.appointmentId) byApptKey.set(`${t.appointmentId}:${t.type}`, t);
  }
  // A Boss Checkout sale paid by card (Tap to Pay) is recorded as a manual
  // ledger row AND surfaces again as the live Stripe charge for the same
  // payment_intent. Register the manual row by its intent so the matching
  // Stripe charge collapses into it — keeping the itemized ticket context
  // and folding in the real Stripe fee/net — instead of showing twice.
  // Refund rows are excluded: those collapse the other way (the Stripe
  // refund row is canonical), handled below.
  for (const t of manualTxns) {
    if (t.type !== "refund" && t.stripeId && !byIntent.has(t.stripeId)) {
      byIntent.set(t.stripeId, t);
    }
  }
  const dedupedStripe = stripeTxns.filter((s) => {
    const match =
      (s.stripeId && byIntent.get(s.stripeId)) ||
      (s.appointmentId && byApptKey.get(`${s.appointmentId}:${s.type}`)) ||
      null;
    if (!match) return true;
    // Same money — keep the appointment row (it has the real client +
    // service context), but enrich it with the live Stripe identifiers
    // and refund history the appointment row lacks. This is what lets
    // the Payments screen issue a card refund against an appointment-
    // derived deposit/balance row and show what's already been refunded.
    if (!match.stripeId && s.stripeId) match.stripeId = s.stripeId;
    if ((!match.refunds || match.refunds.length === 0) && s.refunds.length > 0) {
      match.refunds = s.refunds;
    }
    // The appointment row assumes no processing fee (net = gross). Once
    // Stripe reveals the real fee, its net is authoritative.
    if (!match.fee && s.fee) {
      match.fee = s.fee;
      if (s.net) match.net = s.net;
    }
    return false;
  });
  // A card refund issued from the Payments screen writes an optimistic
  // manual `refund` row so it shows the instant it's issued. Once Stripe
  // sync catches up, the now fully-refunded charge comes back as its own
  // refund row (same money, with the real fee/net), so the same refund
  // would list — and count in the summary — twice. Collapse the manual
  // duplicate into the Stripe row.
  //
  // Matching: newer manual refunds carry the charge's payment_intent, so
  // they match exactly. Older ones (recorded before that stamp existed)
  // have no intent, so a CARD refund also matches on amount + client + day
  // — which identifies the same refund in practice. Each Stripe refund
  // absorbs at most one manual row. Cash/Zelle/etc. refunds only match by
  // intent (which they never have), so a genuine offline refund is never
  // swallowed; a partial card refund keeps its manual row too, since a
  // partially-refunded charge never surfaces a Stripe refund row to match.
  const refundDayKey = (iso: string): string => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
  };
  const refundFuzzyKey = (t: Transaction): string =>
    `${Math.abs(roundCents(t.amount))}|${(t.clientName || "").trim().toLowerCase()}|${refundDayKey(t.paidAt)}`;
  const refundSlots = dedupedStripe
    .filter((s) => s.type === "refund")
    .map((s) => ({
      intent: s.stripeId ? String(s.stripeId) : null,
      fuzzy: refundFuzzyKey(s),
      used: false,
    }));
  const dedupedManual = manualTxns.filter((m) => {
    if (m.type !== "refund") return true;
    const viaCard = m.method === "stripe" || m.method === "card";
    const mFuzzy = refundFuzzyKey(m);
    const slot = refundSlots.find(
      (sl) =>
        !sl.used &&
        ((m.stripeId && sl.intent === String(m.stripeId)) || (viaCard && sl.fuzzy === mFuzzy)),
    );
    if (slot) {
      slot.used = true;
      return false;
    }
    return true;
  });
  const all = [...appointmentTxns, ...dedupedStripe, ...dedupedManual];
  all.sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime());
  return all;
};

// =====================================================================
// Reconcile appointment paid-state from live Stripe payments
// =====================================================================
// A balance (or full) payment can succeed on the connected Stripe account
// — so it shows up in this ledger — while the appointment record still
// reads "balance due" because the balance webhook never landed (e.g. the
// endpoint secret isn't configured, or Stripe couldn't deliver the event).
// That leaves the schedule, the outstanding totals and the home cards
// billing money that's already been collected.
//
// Given the live Stripe rows, return updated copies of any appointment a
// linked, balance-covering Stripe payment proves is settled: balance_paid
// true, paymentStatus "paid", balanceDue 0, the tip and the Stripe fee/net
// preserved — and, crucially, the original deposit left intact so the
// deposit-vs-balance breakdown survives on the receipt and ledger.
// Appointments that already read paid, aren't matched, or whose payment
// doesn't cover the balance are left untouched. Pure so it can be
// unit-tested and reused; the caller persists + syncs the results.
export const reconcilePaidAppointments = (
  appointments: any[],
  stripeTxns: Transaction[],
  todayYMD: string,
): any[] => {
  const byId = new Map<string, any>();
  for (const a of Array.isArray(appointments) ? appointments : []) {
    if (a && a.id != null) byId.set(String(a.id), a);
  }
  const out: any[] = [];
  const seen = new Set<string>();
  for (const s of Array.isArray(stripeTxns) ? stripeTxns : []) {
    // Only trust a live Stripe charge that's explicitly a full/balance
    // payment linked to a specific appointment (the id our checkout route
    // stamps into the charge's metadata).
    if (s.source !== "stripe" || s.amount <= 0) continue;
    if (s.type !== "final" && s.type !== "full") continue;
    if (!s.appointmentId) continue;
    const key = String(s.appointmentId);
    if (seen.has(key)) continue;
    const a = byId.get(key);
    if (!a || isCanceled(a)) continue;
    if (a.paymentStatus === "paid" || a.balance_paid === true || a.balancePaid === true) continue;

    const total = Math.max(0, parseMoney(a.totalPrice));
    const discount = Math.max(0, parseMoney(a.discountAmount));
    const netTotal = roundCents(Math.max(0, total - discount));
    if (!(netTotal > 0)) continue;
    const deposit = Math.max(0, parseMoney(a.depositPaid));
    const balance =
      a.balanceDue == null
        ? roundCents(Math.max(0, netTotal - deposit))
        : Math.max(0, parseMoney(a.balanceDue));
    if (!(balance > 0)) continue;

    // The charge, net of tip, must cover the outstanding balance — so a
    // partial charge/refund can't flip a still-owed booking to paid.
    const collected = roundCents(s.amount - (s.tip > 0 ? s.tip : 0));
    if (collected + 0.01 < balance) continue;

    const pi = typeof s.stripeId === "string" && s.stripeId.startsWith("pi_") ? s.stripeId : null;
    seen.add(key);
    out.push({
      ...a,
      // Preserve the original deposit — do NOT collapse it into the total.
      // Marking balance_paid (rather than overwriting depositPaid) keeps the
      // deposit-vs-balance split intact for the receipt and the ledger;
      // calculateCollectedAmount counts the whole ticket for a paid
      // appointment, so revenue stays right without the flatten.
      balance_paid: true,
      balanceDue: 0,
      paymentStatus: "paid",
      paymentDate: a.paymentDate || todayYMD,
      status: a.status === "scheduled" || a.status === "confirmed" ? "completed" : a.status,
      tipAmount: a.tipAmount != null ? a.tipAmount : s.tip > 0 ? s.tip : 0,
      // Stamp the balance payment_intent so mergeTransactions collapses the
      // Stripe row into this appointment row (no duplicate ledger entry).
      balance_payment_intent_id: a.balance_payment_intent_id || pi || null,
      // Persist the Stripe processing fee + true net payout for this balance
      // charge, so the receipt and the net-of-fees totals reflect what
      // actually landed ($281.61), not the $304.74 gross — no live round-trip
      // needed.
      stripeFee: s.fee > 0 ? s.fee : parseMoney(a.stripeFee),
      stripeNet: s.net > 0 ? s.net : parseMoney(a.stripeNet),
    });
  }
  return out;
};

// =====================================================================
// Filtering
// =====================================================================

export const filterTransactions = (txns: Transaction[], filter: TxnFilter): Transaction[] => {
  switch (filter) {
    case "deposits":
      return txns.filter((t) => t.type === "deposit");
    case "final":
      return txns.filter((t) => t.type === "final");
    case "full":
      return txns.filter((t) => t.type === "full");
    case "refunds":
      return txns.filter((t) => t.type === "refund" || t.amount < 0);
    case "cash":
      return txns.filter((t) => t.method === "cash");
    case "stripe":
      return txns.filter((t) => t.method === "stripe" || t.method === "card");
    case "all":
    default:
      return txns;
  }
};

// =====================================================================
// Summary cards
// =====================================================================

export type Summary = {
  todayRevenue: number;
  weekRevenue: number;
  monthRevenue: number;
  tips: number;
  deposits: number;
  outstanding: number;
  // Stripe processing fees for the month, and the true net that landed
  // after them (monthRevenue − monthFees) — what actually hits the bank.
  monthFees: number;
  monthNet: number;
};

// Local day boundaries so "today" matches the stylist's wall clock.
const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const startOfWeek = (d: Date): Date => {
  const s = startOfDay(d);
  s.setDate(s.getDate() - s.getDay()); // Sunday-anchored week
  return s;
};
const startOfMonth = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), 1);

export const computeSummary = (
  txns: Transaction[],
  appointments: any[],
  now: Date = new Date(),
): Summary => {
  const dayStart = startOfDay(now).getTime();
  const weekStart = startOfWeek(now).getTime();
  const monthStart = startOfMonth(now).getTime();

  let today = 0;
  let week = 0;
  let month = 0;
  let tips = 0;
  let deposits = 0;
  let monthFees = 0;

  for (const t of txns) {
    const ts = new Date(t.paidAt).getTime();
    if (Number.isNaN(ts)) continue;
    // Revenue = collected money (refunds reduce it via signed amount).
    const gross = t.amount + (t.amount > 0 ? t.tip : 0);
    if (ts >= dayStart) today += gross;
    if (ts >= weekStart) week += gross;
    if (ts >= monthStart) month += gross;
    if (t.amount > 0) tips += t.tip;
    if (t.type === "deposit" && t.amount > 0) deposits += t.amount;
    // Stripe processing fees on collected (positive) money this month —
    // what Stripe skims before the payout reaches the bank.
    if (ts >= monthStart && t.amount > 0) monthFees += t.fee || 0;
  }

  // Outstanding = sum of balance still due on non-cancelled, unpaid
  // appointments. Derived straight from the bookings so it can't drift
  // from what the calendar shows.
  let outstanding = 0;
  for (const a of Array.isArray(appointments) ? appointments : []) {
    if (!a || isCanceled(a)) continue;
    const paid = a.balance_paid === true || a.balancePaid === true || a.paymentStatus === "paid";
    if (paid) continue;
    outstanding += Math.max(0, roundCents(parseMoney(a.balanceDue)));
  }

  return {
    todayRevenue: roundCents(today),
    weekRevenue: roundCents(week),
    monthRevenue: roundCents(month),
    tips: roundCents(tips),
    deposits: roundCents(deposits),
    outstanding: roundCents(outstanding),
    monthFees: roundCents(monthFees),
    monthNet: roundCents(month - monthFees),
  };
};

// =====================================================================
// Export — CSV + Excel
// =====================================================================

const EXPORT_COLUMNS: { key: string; header: string }[] = [
  { key: "paidAt", header: "Date" },
  { key: "clientName", header: "Client" },
  { key: "serviceName", header: "Service" },
  { key: "type", header: "Type" },
  { key: "method", header: "Method" },
  { key: "amount", header: "Amount" },
  { key: "tip", header: "Tip" },
  { key: "fee", header: "Stripe Fee" },
  { key: "net", header: "Net" },
  { key: "source", header: "Source" },
];

const exportRow = (t: Transaction): Record<string, string> => ({
  paidAt: new Date(t.paidAt).toISOString().slice(0, 19).replace("T", " "),
  clientName: t.clientName,
  serviceName: t.serviceName,
  type: TYPE_LABEL[t.type],
  method: METHOD_LABEL[t.method],
  amount: t.amount.toFixed(2),
  tip: t.tip.toFixed(2),
  fee: t.fee.toFixed(2),
  net: t.net.toFixed(2),
  source: t.source,
});

const csvEscape = (v: string): string =>
  /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

export const buildTransactionsCsv = (txns: Transaction[]): string => {
  const lines = [EXPORT_COLUMNS.map((c) => csvEscape(c.header)).join(",")];
  for (const t of txns) {
    const row = exportRow(t);
    lines.push(EXPORT_COLUMNS.map((c) => csvEscape(row[c.key] ?? "")).join(","));
  }
  return lines.join("\r\n");
};

const xmlEscape = (v: string): string =>
  v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// SpreadsheetML 2003 (.xls) — a single-file XML format Excel, Numbers
// and Google Sheets all open natively, with no zip/dependency needed.
// Numbers are typed so totals stay summable in the spreadsheet.
export const buildTransactionsXls = (txns: Transaction[]): string => {
  const numericKeys = new Set(["amount", "tip", "fee", "net"]);
  const cell = (key: string, value: string): string => {
    if (numericKeys.has(key)) {
      return `<Cell><Data ss:Type="Number">${xmlEscape(value || "0")}</Data></Cell>`;
    }
    return `<Cell><Data ss:Type="String">${xmlEscape(value)}</Data></Cell>`;
  };
  const header = `<Row>${EXPORT_COLUMNS.map(
    (c) => `<Cell><Data ss:Type="String">${xmlEscape(c.header)}</Data></Cell>`,
  ).join("")}</Row>`;
  const body = txns
    .map((t) => {
      const row = exportRow(t);
      return `<Row>${EXPORT_COLUMNS.map((c) => cell(c.key, row[c.key] ?? "")).join("")}</Row>`;
    })
    .join("");
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Transactions">
  <Table>
   ${header}
   ${body}
  </Table>
 </Worksheet>
</Workbook>`;
};
