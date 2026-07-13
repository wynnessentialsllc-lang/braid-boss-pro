// Receipts & invoices: pure data helpers shared by page.tsx and the
// PDF renderer. Persistence is handled by the existing safeStorage
// entity pipeline (`receipts:` prefix) and the cloud-sync layer in
// supabase.ts. This module is intentionally side-effect free and
// has no React or DOM dependency, so it can be imported anywhere.

// A single priced line on a receipt's ticket — the base service plus any
// add-ons the client got. Recorded so the receipt reads what was actually
// done ("Boho Knotless (Medium) $160 + Boho Max $50"), not just a lump sum.
// `amount` is the GROSS charge for that line (pre-discount); the discount
// still applies once to the whole ticket, below the line items.
export type ReceiptLineItem = {
  label: string;
  amount: number;
  kind: "service" | "addon";
};

export type ReceiptRecord = {
  id: string;
  type: "receipt" | "invoice";
  receiptNumber: string;
  appointmentId?: string;
  quoteId?: string;
  clientId?: string;
  clientName?: string;
  service?: string;
  serviceDate?: string;
  serviceTime?: string;
  // Itemized breakdown of the service dollars (base service + add-ons).
  // Present only when the appointment carried add-ons — a lone base line
  // would just restate "Service total", so it's omitted. The line amounts
  // sum to `subtotal` (or `totalPrice` when there's no discount).
  lineItems?: ReceiptLineItem[];
  // totalPrice is the NET total (post-discount). For receipts that
  // had a discount applied, subtotal + discount lines are surfaced
  // separately so the math reads honestly.
  totalPrice: number;
  subtotal?: number;
  discountAmount?: number;
  discountName?: string;
  depositPaid: number;
  balanceDue: number;
  // Balance actually collected (vs. still due) — set once the balance is
  // paid, so the receipt shows Deposit + Balance paid instead of collapsing
  // them. Tip, and the Stripe processing fee + net payout, are surfaced when
  // known so the receipt reads what the client paid and what actually landed.
  balancePaid?: number;
  tip?: number;
  stripeFee?: number;
  netPayout?: number;
  amountCollected: number;
  paymentStatus?: string;
  paymentMethod?: string;
  paymentDate?: string;
  notes?: string;
  status: "issued";
  createdAt: string;
};

// Tiny local copies of the money/format helpers used in this module so
// it stays import-free. The main app's parseMoney handles strings with
// currency symbols / commas; this matches that behavior.
const parseMoney = (raw: unknown): number => {
  if (raw === null || raw === undefined || raw === "") return 0;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  const cleaned = String(raw).replace(/[^\d.\-]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
};

const roundMoney = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const formatCurrency = (n: number, currency: string = "USD"): string => {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
};

const fmtDateLong = (iso: string): string => {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
};

// 12-hour time; drops ":00" on the hour ("14:00" → "2 PM").
// Matches the canonical formatter in app/page.tsx.
const fmtTime = (t: string): string => {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  if (!Number.isFinite(h)) return t;
  const period = h >= 12 ? "PM" : "AM";
  const hh = h % 12 || 12;
  const mins = Number.isFinite(m) ? m : 0;
  return mins === 0
    ? `${hh} ${period}`
    : `${hh}:${String(mins).padStart(2, "0")} ${period}`;
};

// Monotonic, padded sequence derived from the HIGHEST number already
// issued for this prefix+year — NOT the array length. Length-based
// numbering reused an already-issued number after any deletion and
// collided when two receipts were created before state settled; the
// row id (uid()) stays unique, but the human-visible R-2026-0007 could
// be duplicated. Scanning for max suffix keeps the visible number
// unique and never goes backwards.
export const generateReceiptNumber = (
  type: "receipt" | "invoice",
  existing: ReadonlyArray<{ receiptNumber?: string | null }>,
): string => {
  const year = new Date().getFullYear();
  const prefix = type === "receipt" ? "R" : "INV";
  const head = `${prefix}-${year}-`;
  let maxSeq = 0;
  for (const r of existing || []) {
    const n = r?.receiptNumber;
    if (typeof n === "string" && n.startsWith(head)) {
      const seqNum = parseInt(n.slice(head.length), 10);
      if (Number.isFinite(seqNum) && seqNum > maxSeq) maxSeq = seqNum;
    }
  }
  const seq = String(maxSeq + 1).padStart(4, "0");
  return `${head}${seq}`;
};

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Build the itemized ticket from an appointment's booked add-ons. Returns
// undefined when there's nothing to itemize (no add-ons) so callers can fall
// back to the single-line "Service total".
//
// The base service price is the gross subtotal minus the add-ons, so the
// lines always reconcile to the ticket even when the recalled numbers are
// fuzzy. The base label is the booked style with any " — Add-on" suffixes the
// booking flow appended stripped off, so an add-on isn't named twice.
const deriveReceiptLineItems = (
  a: any,
  grossSubtotal: number,
): ReceiptLineItem[] | undefined => {
  const raw = a?.addOns || a?.addons || a?.data?.addOns || a?.data?.addons;
  if (!Array.isArray(raw)) return undefined;
  const addOns = raw
    .map((x: any) => ({
      label: String(x?.name ?? "").trim(),
      // Appointment add-ons store `price`; some flows use `amount`/`cost`.
      amount: roundMoney(parseMoney(x?.price ?? x?.amount ?? x?.cost)),
    }))
    .filter((x: { label: string; amount: number }) => x.label !== "" || x.amount > 0);
  if (addOns.length === 0) return undefined;

  const addOnsTotal = addOns.reduce((s, x) => s + x.amount, 0);
  const baseAmount = roundMoney(grossSubtotal - addOnsTotal);

  let baseLabel = String(a?.style || a?.service || "Service").trim();
  for (const ad of addOns) {
    if (!ad.label) continue;
    // Strip a trailing " — Boho Max" / " - Boho Max" the booking snapshot
    // may have folded into the style string, so it isn't listed twice.
    baseLabel = baseLabel
      .replace(new RegExp(`\\s*[—–-]\\s*${escapeRegExp(ad.label)}\\s*$`, "i"), "")
      .trim();
  }

  const items: ReceiptLineItem[] = [];
  // Skip a zero/negative base (a ticket that's entirely add-ons) — the
  // add-on lines alone already tell the story and still sum to the total.
  if (baseAmount > 0.005) {
    items.push({ label: baseLabel || "Service", amount: baseAmount, kind: "service" });
  }
  for (const ad of addOns) {
    items.push({ label: ad.label || "Add-on", amount: ad.amount, kind: "addon" });
  }
  return items.length > 0 ? items : undefined;
};

export const buildReceiptFromAppointment = (
  a: any,
  type: "receipt" | "invoice",
  existing: ReadonlyArray<{ receiptNumber?: string | null }>,
  newId: string,
  clientName?: string,
): ReceiptRecord => {
  const subtotal = parseMoney(a.totalPrice);
  const discountAmount = parseMoney(a.discountAmount);
  // Receipt math uses the NET total. The form's "Total price" field
  // is the subtotal (gross) and the discount line subtracts from it,
  // so a paid-in-full receipt must reflect post-discount dollars or
  // the math reads as if the client overpaid by the discount amount.
  const total = Math.max(0, subtotal - discountAmount);
  const deposit = parseMoney(a.depositPaid);
  // Paid-in-full is now marked WITHOUT collapsing the deposit into the total,
  // so read it from the paid flags — not from "deposit >= total".
  const paidInFull =
    a.balance_paid === true ||
    a.balancePaid === true ||
    a.paymentStatus === "paid" ||
    (parseMoney(a.balanceDue) === 0 && total > 0);
  const balancePaid = paidInFull ? Math.max(0, roundMoney(total - deposit)) : 0;
  const balanceDue = paidInFull ? 0 : parseMoney(a.balanceDue ?? Math.max(0, total - deposit));
  const tip = roundMoney(parseMoney(a.tipAmount ?? a.data?.tipAmount ?? a.tip));
  const stripeFee = roundMoney(parseMoney(a.stripeFee ?? a.data?.stripeFee));
  // Service dollars collected (deposit + any balance paid), plus tip = the
  // full amount the client paid.
  const collectedService = paidInFull ? total : deposit > 0 ? deposit : 0;
  const amountCollected = type === "receipt" ? roundMoney(collectedService + tip) : 0;
  const netPayout =
    stripeFee > 0 ? roundMoney(Math.max(0, amountCollected - stripeFee)) : undefined;
  return {
    id: newId,
    type,
    receiptNumber: generateReceiptNumber(type, existing),
    appointmentId: a.id,
    clientId: a.clientId,
    clientName: clientName || a.clientName || "Client",
    service: a.style || "Service",
    lineItems: deriveReceiptLineItems(a, subtotal),
    serviceDate: a.date || "",
    serviceTime: a.time || "",
    totalPrice: total,
    subtotal: discountAmount > 0 ? subtotal : undefined,
    discountAmount: discountAmount > 0 ? discountAmount : undefined,
    discountName: discountAmount > 0 ? (a.discountName || undefined) : undefined,
    depositPaid: deposit,
    balanceDue,
    balancePaid: balancePaid > 0 ? balancePaid : undefined,
    tip: tip > 0 ? tip : undefined,
    stripeFee: stripeFee > 0 ? stripeFee : undefined,
    netPayout,
    amountCollected,
    paymentStatus: a.paymentStatus || (paidInFull ? "paid" : (deposit > 0 ? "partial" : "pending")),
    paymentMethod: a.paymentMethod || "",
    paymentDate: a.paymentDate || "",
    notes: a.paymentNotes || a.notes || "",
    status: "issued",
    createdAt: new Date().toISOString(),
  };
};

export const buildInvoiceFromQuote = (
  q: any,
  existing: ReadonlyArray<{ receiptNumber?: string | null }>,
  newId: string,
  clientName?: string,
): ReceiptRecord => {
  const total = parseMoney(q.breakdown?.finalPrice ?? q.finalPrice ?? q.totalPrice);
  return {
    id: newId,
    type: "invoice",
    receiptNumber: generateReceiptNumber("invoice", existing),
    quoteId: q.id,
    clientId: q.clientId,
    clientName: clientName || q.label || "Client",
    service: q.style || q.label || "Service",
    serviceDate: "",
    serviceTime: "",
    totalPrice: total,
    depositPaid: 0,
    balanceDue: total,
    amountCollected: 0,
    paymentStatus: "pending",
    paymentMethod: "",
    paymentDate: "",
    notes: "",
    status: "issued",
    createdAt: new Date().toISOString(),
  };
};

// A payment row on the receipt's ticket — what was collected and how it
// splits. `kind` lets renderers style specific rows (e.g. a still-owed balance).
export type ReceiptPaymentLine = {
  label: string;
  amount: number;
  kind: "deposit" | "balancePaid" | "balanceDue" | "paidInFull";
};

// Single source of truth for the deposit / balance / paid-in-full rows so the
// PDF, the in-app sheet, and the text summary all read the same. The rules:
//   • A deposit shows ONLY when one was actually taken (> 0) — a $0 deposit is
//     noise, and dumping a full payment into the deposit field was the old bug.
//   • When money was collected but there's no separate deposit, the row reads
//     "Amount paid", not "Balance paid" (there was no balance to begin with).
//   • When the whole ticket was paid in one shot (a payment, nothing
//     outstanding, no separate balance), it collapses to a single "Paid in
//     full" line instead of labeling the entire amount a "deposit".
export const receiptPaymentLines = (rcp: ReceiptRecord): ReceiptPaymentLine[] => {
  const deposit = roundMoney(parseMoney(rcp.depositPaid));
  const balancePaid = roundMoney(parseMoney(rcp.balancePaid));
  const balanceDue = roundMoney(parseMoney(rcp.balanceDue));

  // Paid in one shot: a payment landed, nothing is still due, and there's no
  // separate balance to itemize. Show it as one honest line.
  if (deposit > 0 && balancePaid <= 0 && balanceDue <= 0) {
    return [{ label: "Paid in full", amount: deposit, kind: "paidInFull" }];
  }

  const lines: ReceiptPaymentLine[] = [];
  if (deposit > 0) lines.push({ label: "Deposit paid", amount: deposit, kind: "deposit" });
  if (balancePaid > 0) {
    // No deposit was taken → this payment IS the whole thing, not a "balance".
    lines.push({
      label: deposit > 0 ? "Balance paid" : "Amount paid",
      amount: balancePaid,
      kind: "balancePaid",
    });
  }
  if (balanceDue > 0) lines.push({ label: "Balance due", amount: balanceDue, kind: "balanceDue" });
  return lines;
};

// Plain-text summary suitable for SMS / WhatsApp / clipboard fallback.
export const buildReceiptSummaryText = (
  rcp: ReceiptRecord,
  currency: string = "USD",
  // Client-facing by default: the stylist's Stripe fee / net payout are hidden.
  // Pass { includeNet: true } for an internal copy.
  opts?: { includeNet?: boolean },
): string => {
  const fmt = (n: number) => formatCurrency(n, currency);
  const lines: (string | null)[] = [
    `${rcp.type === "invoice" ? "Invoice" : "Receipt"} #${rcp.receiptNumber}`,
    `Client: ${rcp.clientName || "—"}`,
    `Service: ${rcp.service || "—"}`,
    rcp.serviceDate ? `Date: ${fmtDateLong(rcp.serviceDate)}${rcp.serviceTime ? ` ${fmtTime(rcp.serviceTime)}` : ""}` : null,
    // The ticket — pricing record. Itemized lines first (base + add-ons),
    // so the client can see what each charge was for.
    ...(rcp.lineItems && rcp.lineItems.length > 0
      ? rcp.lineItems.map((li) =>
          li.kind === "addon"
            ? `+ ${li.label}: ${fmt(li.amount)}`
            : `${li.label}: ${fmt(li.amount)}`,
        )
      : []),
    rcp.discountAmount && rcp.subtotal ? `Subtotal: ${fmt(rcp.subtotal)}` : null,
    rcp.discountAmount ? `Discount${rcp.discountName ? ` (${rcp.discountName})` : ""}: − ${fmt(rcp.discountAmount)}` : null,
    `Service total: ${fmt(rcp.totalPrice)}`,
    ...receiptPaymentLines(rcp).map((pl) => `${pl.label}: ${fmt(pl.amount)}`),
    rcp.tip ? `Tip: ${fmt(rcp.tip)}` : null,
    `Total: ${fmt(roundMoney(rcp.totalPrice + (rcp.tip || 0)))}`,
    // The money — what landed. Hidden on client-facing copies.
    opts?.includeNet && rcp.type === "receipt" && rcp.stripeFee ? `Stripe fee: − ${fmt(rcp.stripeFee)}` : null,
    opts?.includeNet && rcp.type === "receipt" ? `In your bank: ${fmt(rcp.netPayout ?? rcp.amountCollected)}` : null,
    rcp.paymentMethod ? `Method: ${rcp.paymentMethod}` : null,
    rcp.paymentDate ? `Paid on: ${fmtDateLong(rcp.paymentDate)}` : null,
  ];
  return lines.filter(Boolean).join("\n");
};
