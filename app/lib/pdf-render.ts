// Client-side PDF rendering for receipts and invoices.
//
// jsPDF is loaded via dynamic import inside the function so the
// homepage bundle doesn't pay the (~100kb) cost for users who never
// tap "Generate". This module is browser-only — `await import("jspdf")`
// will throw on the server, which is fine because the only callers
// are click handlers.

import type { ReceiptRecord } from "./receipts";

const fmtDateLong = (iso: string): string => {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
};

const fmtDate = (iso: string): string => {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
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

const formatCurrency = (n: number, currency: string = "USD"): string => {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
};

export const renderReceiptPdf = async (
  rcp: ReceiptRecord,
  business: any,
  policies?: any[],
): Promise<{ blob: Blob; filename: string }> => {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 48;
  const cream = [250, 245, 236] as const;
  const espresso = [42, 24, 16] as const;
  const coffee = [74, 44, 26] as const;
  const muted = [139, 115, 85] as const;
  const goldDeep = [168, 137, 63] as const;
  const hairline = [220, 205, 180] as const;
  const currency = business?.currency || "USD";
  const fmt = (n: number) => formatCurrency(n, currency);
  const isInvoice = rcp.type === "invoice";

  // Page background
  doc.setFillColor(cream[0], cream[1], cream[2]);
  doc.rect(0, 0, W, H, "F");

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(espresso[0], espresso[1], espresso[2]);
  doc.text(business?.businessName || "Braid Boss Pro", M, 80);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(muted[0], muted[1], muted[2]);
  if (business?.ownerName) doc.text(business.ownerName, M, 96);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  doc.setTextColor(goldDeep[0], goldDeep[1], goldDeep[2]);
  doc.text(isInvoice ? "INVOICE" : "RECEIPT", W - M, 80, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(coffee[0], coffee[1], coffee[2]);
  doc.text(`#${rcp.receiptNumber}`, W - M, 98, { align: "right" });
  doc.text(`Issued ${fmtDate(rcp.createdAt.slice(0, 10))}`, W - M, 112, { align: "right" });

  // Gold rule
  doc.setDrawColor(goldDeep[0], goldDeep[1], goldDeep[2]);
  doc.setLineWidth(1.5);
  doc.line(M, 132, W - M, 132);

  // Bill-to block
  let y = 162;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(muted[0], muted[1], muted[2]);
  doc.text(isInvoice ? "BILL TO" : "RECEIVED FROM", M, y);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(13);
  doc.setTextColor(espresso[0], espresso[1], espresso[2]);
  doc.text(rcp.clientName || "Client", M, y);

  // Service block (right column)
  y = 162;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(muted[0], muted[1], muted[2]);
  doc.text("SERVICE", W - M - 200, y);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(13);
  doc.setTextColor(espresso[0], espresso[1], espresso[2]);
  doc.text(rcp.service || "Service", W - M - 200, y);
  y += 16;
  doc.setFontSize(10);
  doc.setTextColor(coffee[0], coffee[1], coffee[2]);
  if (rcp.serviceDate) {
    const dateLine = `${fmtDateLong(rcp.serviceDate)}${rcp.serviceTime ? ` · ${fmtTime(rcp.serviceTime)}` : ""}`;
    doc.text(dateLine, W - M - 200, y);
  }

  // Amounts table
  y = 230;
  doc.setDrawColor(hairline[0], hairline[1], hairline[2]);
  doc.setLineWidth(0.5);
  doc.line(M, y, W - M, y);
  y += 24;

  const drawRow = (label: string, value: string, opts?: { bold?: boolean; muted?: boolean }) => {
    doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
    doc.setFontSize(opts?.bold ? 12 : 11);
    if (opts?.muted) doc.setTextColor(muted[0], muted[1], muted[2]);
    else doc.setTextColor(espresso[0], espresso[1], espresso[2]);
    doc.text(label, M, y);
    doc.text(value, W - M, y, { align: "right" });
    y += 22;
  };

  drawRow("Total price", fmt(rcp.totalPrice));
  drawRow("Deposit paid", fmt(rcp.depositPaid), { muted: rcp.depositPaid === 0 });
  drawRow("Balance due", fmt(rcp.balanceDue), { muted: rcp.balanceDue === 0 });
  if (!isInvoice) drawRow("Amount collected", fmt(rcp.amountCollected), { bold: true });

  y += 8;
  doc.line(M, y, W - M, y);
  y += 22;

  if (rcp.paymentStatus) drawRow("Payment status", String(rcp.paymentStatus).toUpperCase(), { muted: true });
  if (rcp.paymentMethod) drawRow("Payment method", rcp.paymentMethod);
  if (rcp.paymentDate) drawRow("Payment date", fmtDateLong(rcp.paymentDate));

  if (rcp.notes) {
    y += 12;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(muted[0], muted[1], muted[2]);
    doc.text("NOTES", M, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(espresso[0], espresso[1], espresso[2]);
    const wrapped = doc.splitTextToSize(rcp.notes, W - 2 * M);
    doc.text(wrapped, M, y);
    y += wrapped.length * 14;
  }

  if (isInvoice && Array.isArray(policies) && policies.length > 0) {
    y += 16;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(muted[0], muted[1], muted[2]);
    doc.text("POLICIES", M, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(coffee[0], coffee[1], coffee[2]);
    for (const p of policies.slice(0, 3)) {
      const heading = p.title || p.category || "Policy";
      const wrapped = doc.splitTextToSize(`${heading}: ${p.body || ""}`, W - 2 * M);
      doc.text(wrapped, M, y);
      y += wrapped.length * 11 + 4;
      if (y > H - 100) break;
    }
  }

  // Footer
  doc.setDrawColor(goldDeep[0], goldDeep[1], goldDeep[2]);
  doc.setLineWidth(1);
  doc.line(M, H - 80, W - M, H - 80);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(11);
  doc.setTextColor(goldDeep[0], goldDeep[1], goldDeep[2]);
  doc.text(
    isInvoice ? "Thank you — payment due upon service." : "Thank you for your business.",
    W / 2,
    H - 60,
    { align: "center" },
  );

  const blob = doc.output("blob");
  const filename = `${isInvoice ? "invoice" : "receipt"}-${rcp.receiptNumber}.pdf`;
  return { blob, filename };
};
