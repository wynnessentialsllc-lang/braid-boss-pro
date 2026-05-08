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
  totalPrice: number;
  depositPaid: number;
  balanceDue: number;
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

const fmtTime = (t: string): string => {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hh = h % 12 || 12;
  return `${hh}:${String(m).padStart(2, "0")} ${period}`;
};

// Stable, padded sequence — the visible suffix is just count, but
// uniqueness is guaranteed by the caller-supplied id (uid()) so two
// receipts created in the same millisecond don't collide on a row.
export const generateReceiptNumber = (type: "receipt" | "invoice", existingCount: number): string => {
  const year = new Date().getFullYear();
  const seq = String(existingCount + 1).padStart(4, "0");
  const prefix = type === "receipt" ? "R" : "INV";
  return `${prefix}-${year}-${seq}`;
};

export const buildReceiptFromAppointment = (
  a: any,
  type: "receipt" | "invoice",
  existingCount: number,
  newId: string,
  clientName?: string,
): ReceiptRecord => {
  const total = parseMoney(a.totalPrice);
  const deposit = parseMoney(a.depositPaid);
  const balance = parseMoney(a.balanceDue ?? Math.max(0, total - deposit));
  return {
    id: newId,
    type,
    receiptNumber: generateReceiptNumber(type, existingCount),
    appointmentId: a.id,
    clientId: a.clientId,
    clientName: clientName || a.clientName || "Client",
    service: a.style || "Service",
    serviceDate: a.date || "",
    serviceTime: a.time || "",
    totalPrice: total,
    depositPaid: deposit,
    balanceDue: balance,
    amountCollected: type === "receipt" ? (deposit > 0 ? deposit : (balance === 0 ? total : 0)) : 0,
    paymentStatus: a.paymentStatus || (balance === 0 && total > 0 ? "paid" : (deposit > 0 ? "partial" : "pending")),
    paymentMethod: a.paymentMethod || "",
    paymentDate: a.paymentDate || "",
    notes: a.paymentNotes || a.notes || "",
    status: "issued",
    createdAt: new Date().toISOString(),
  };
};

export const buildInvoiceFromQuote = (
  q: any,
  existingCount: number,
  newId: string,
  clientName?: string,
): ReceiptRecord => {
  const total = parseMoney(q.breakdown?.finalPrice ?? q.finalPrice ?? q.totalPrice);
  return {
    id: newId,
    type: "invoice",
    receiptNumber: generateReceiptNumber("invoice", existingCount),
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
    `Total: ${fmt(rcp.totalPrice)}`,
    `Deposit paid: ${fmt(rcp.depositPaid)}`,
    `Balance due: ${fmt(rcp.balanceDue)}`,
    rcp.type === "receipt" ? `Amount collected: ${fmt(rcp.amountCollected)}` : null,
    rcp.paymentMethod ? `Method: ${rcp.paymentMethod}` : null,
    rcp.paymentDate ? `Paid on: ${fmtDateLong(rcp.paymentDate)}` : null,
  ];
  return lines.filter(Boolean).join("\n");
};
