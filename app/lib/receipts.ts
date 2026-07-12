// Receipts & invoices: pure data helpers shared by page.tsx and the
// PDF renderer. Persistence is handled by the existing safeStorage
// entity pipeline (`receipts:` prefix) and the cloud-sync layer in
// supabase.ts. This module is intentionally side-effect free and
// has no React or DOM dependency, so it can be imported anywhere.

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

// Plain-text summary suitable for SMS / WhatsApp / clipboard fallback.
export const buildReceiptSummaryText = (rcp: ReceiptRecord, currency: string = "USD"): string => {
  const fmt = (n: number) => formatCurrency(n, currency);
  const lines: (string | null)[] = [
    `${rcp.type === "invoice" ? "Invoice" : "Receipt"} #${rcp.receiptNumber}`,
    `Client: ${rcp.clientName || "—"}`,
    `Service: ${rcp.service || "—"}`,
    rcp.serviceDate ? `Date: ${fmtDateLong(rcp.serviceDate)}${rcp.serviceTime ? ` ${fmtTime(rcp.serviceTime)}` : ""}` : null,
    // The ticket — pricing record.
    rcp.discountAmount && rcp.subtotal ? `Subtotal: ${fmt(rcp.subtotal)}` : null,
    rcp.discountAmount ? `Discount${rcp.discountName ? ` (${rcp.discountName})` : ""}: − ${fmt(rcp.discountAmount)}` : null,
    `Service total: ${fmt(rcp.totalPrice)}`,
    `Deposit paid: ${fmt(rcp.depositPaid)}`,
    rcp.balancePaid ? `Balance: ${fmt(rcp.balancePaid)}` : null,
    rcp.balanceDue > 0 ? `Balance due: ${fmt(rcp.balanceDue)}` : null,
    rcp.tip ? `Tip: ${fmt(rcp.tip)}` : null,
    `Total: ${fmt(roundMoney(rcp.totalPrice + (rcp.tip || 0)))}`,
    // The money — what landed.
    rcp.type === "receipt" && rcp.stripeFee ? `Stripe fee: − ${fmt(rcp.stripeFee)}` : null,
    rcp.type === "receipt" ? `In your bank: ${fmt(rcp.netPayout ?? rcp.amountCollected)}` : null,
    rcp.paymentMethod ? `Method: ${rcp.paymentMethod}` : null,
    rcp.paymentDate ? `Paid on: ${fmtDateLong(rcp.paymentDate)}` : null,
  ];
  return lines.filter(Boolean).join("\n");
};
