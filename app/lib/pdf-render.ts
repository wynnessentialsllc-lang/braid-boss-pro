// Client-side PDF rendering for receipts and invoices.
//
// jsPDF is loaded via dynamic import inside the function so the
// homepage bundle doesn't pay the (~100kb) cost for users who never
// tap "Generate". This module is browser-only — `await import("jspdf")`
// will throw on the server, which is fine because the only callers
// are click handlers.

import type { ReceiptRecord } from "./receipts";
import { receiptPaymentLines } from "./receipts";

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

// ---- Braid Boss Pro brand kit ----------------------------------------
//
// The app's aesthetic is a white paper with the purple → coral brand
// gradient (see the `C` / `GRADIENTS` tokens in app/page.tsx). These
// helpers let the PDF renderers speak that same language: solid brand
// swatches for body text and section labels, plus true multicolored
// wordmarks and rules built out of the gradient.

type RGB = readonly [number, number, number];

const hexToRgb = (hex: string): RGB => {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ] as const;
};

// Mirrors the brand tokens in app/page.tsx so the paper matches the screen.
const BRAND = {
  white: [255, 255, 255] as RGB,
  ink: hexToRgb("#15111A"),      // near-black body text (brandText)
  muted: hexToRgb("#6F6477"),    // secondary labels (brandMuted)
  mutedSoft: hexToRgb("#9F95A8"),
  purple: hexToRgb("#7C3AED"),   // brandPrimary
  purpleDeep: hexToRgb("#5B21B6"), // brandPrimaryDeep
  lavender: hexToRgb("#B14BE0"),
  coral: hexToRgb("#FF4D6D"),    // brandSecondary
  coralDeep: hexToRgb("#E0354F"),
  orange: hexToRgb("#FF7A45"),
  mint: hexToRgb("#22C55E"),     // brandSuccess
  hairline: hexToRgb("#ECE7F2"), // brandBorder — soft lavender rule
};

// The signature purple → lavender → coral wordmark gradient.
const BRAND_STOPS: readonly RGB[] = [BRAND.purple, BRAND.lavender, BRAND.coral];

// Sample a multi-stop gradient at t ∈ [0, 1] with linear interpolation.
const gradientColorAt = (stops: readonly RGB[], t: number): RGB => {
  const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t;
  if (clamped <= 0) return stops[0];
  if (clamped >= 1) return stops[stops.length - 1];
  const seg = 1 / (stops.length - 1);
  const idx = Math.min(stops.length - 2, Math.floor(clamped / seg));
  const local = (clamped - idx * seg) / seg;
  const a = stops[idx];
  const b = stops[idx + 1];
  return [
    a[0] + (b[0] - a[0]) * local,
    a[1] + (b[1] - a[1]) * local,
    a[2] + (b[2] - a[2]) * local,
  ] as const;
};

export const renderReceiptPdf = async (
  rcp: ReceiptRecord,
  business: any,
  policies?: any[],
  // Receipts are client-facing, so the stylist's processing costs (Stripe fee
  // and net payout) are hidden by default. Pass { includeNet: true } for an
  // internal copy that shows what actually landed.
  opts?: { includeNet?: boolean },
): Promise<{ blob: Blob; filename: string }> => {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 48;
  const ink = BRAND.ink;
  const muted = BRAND.muted;
  const purple = BRAND.purple;
  const purpleDeep = BRAND.purpleDeep;
  const hairline = BRAND.hairline;
  const currency = business?.currency || "USD";
  const fmt = (n: number) => formatCurrency(n, currency);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const isInvoice = rcp.type === "invoice";

  // Render text with a left→right gradient across its characters — the
  // "multicolored" Braid Boss Pro wordmark look. The font + size must be
  // set before calling, since character widths depend on them.
  const gradientText = (
    text: string,
    x: number,
    y: number,
    opts?: { align?: "left" | "right" | "center"; stops?: readonly RGB[] },
  ) => {
    const stops = opts?.stops ?? BRAND_STOPS;
    const chars = Array.from(text);
    const widths = chars.map((ch) => doc.getTextWidth(ch));
    const total = widths.reduce((s, w) => s + w, 0);
    let cx = x;
    if (opts?.align === "right") cx = x - total;
    else if (opts?.align === "center") cx = x - total / 2;
    const startX = cx;
    for (let i = 0; i < chars.length; i++) {
      const mid = total > 0 ? (cx - startX + widths[i] / 2) / total : 0;
      const [r, g, b] = gradientColorAt(stops, mid);
      doc.setTextColor(r, g, b);
      doc.text(chars[i], cx, y);
      cx += widths[i];
    }
  };

  // A thin horizontal gradient rule (purple → coral), drawn as abutting
  // short segments since jsPDF has no gradient stroke.
  const gradientRule = (x1: number, x2: number, yy: number, lineWidth: number) => {
    const segs = 64;
    doc.setLineWidth(lineWidth);
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs;
      const t1 = (i + 1) / segs;
      const [r, g, b] = gradientColorAt(BRAND_STOPS, (t0 + t1) / 2);
      doc.setDrawColor(r, g, b);
      doc.line(x1 + (x2 - x1) * t0, yy, x1 + (x2 - x1) * t1, yy);
    }
  };

  // Page background — clean white paper.
  doc.setFillColor(BRAND.white[0], BRAND.white[1], BRAND.white[2]);
  doc.rect(0, 0, W, H, "F");

  // Header — business name as a multicolored gradient wordmark.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  gradientText(business?.businessName || "Braid Boss Pro", M, 80);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(muted[0], muted[1], muted[2]);
  if (business?.ownerName) doc.text(business.ownerName, M, 96);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  gradientText(isInvoice ? "INVOICE" : "RECEIPT", W - M, 80, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(purpleDeep[0], purpleDeep[1], purpleDeep[2]);
  doc.text(`#${rcp.receiptNumber}`, W - M, 98, { align: "right" });
  doc.setTextColor(muted[0], muted[1], muted[2]);
  doc.text(`Issued ${fmtDate(rcp.createdAt.slice(0, 10))}`, W - M, 112, { align: "right" });

  // Brand gradient rule
  gradientRule(M, W - M, 132, 1.5);

  // Header blocks — client (left) and service (right) share a top edge.
  const blockTop = 162;

  // Bill-to block (left column)
  let leftY = blockTop;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(purple[0], purple[1], purple[2]);
  doc.text(isInvoice ? "BILL TO" : "RECEIVED FROM", M, leftY);
  leftY += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(13);
  doc.setTextColor(ink[0], ink[1], ink[2]);
  doc.text(rcp.clientName || "Client", M, leftY);
  leftY += 16;

  // Service block (right column). The service name can be long (service +
  // option + add-on), so wrap it to the column width instead of letting it
  // run off the right edge, and advance by however many lines it takes.
  const svcColW = 230;
  const svcX = W - M - svcColW;
  let rightY = blockTop;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(purple[0], purple[1], purple[2]);
  doc.text("SERVICE", svcX, rightY);
  rightY += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(13);
  doc.setTextColor(ink[0], ink[1], ink[2]);
  const svcLines = doc.splitTextToSize(rcp.service || "Service", svcColW);
  doc.text(svcLines, svcX, rightY);
  rightY += svcLines.length * 16;
  doc.setFontSize(10);
  doc.setTextColor(muted[0], muted[1], muted[2]);
  if (rcp.serviceDate) {
    const dateLine = `${fmtDateLong(rcp.serviceDate)}${rcp.serviceTime ? ` · ${fmtTime(rcp.serviceTime)}` : ""}`;
    doc.text(dateLine, svcX, rightY);
    rightY += 16;
  }

  // Amounts table — starts below the taller of the two header columns so a
  // wrapped service name can never overlap it.
  let y = Math.max(230, leftY, rightY) + 4;
  doc.setDrawColor(hairline[0], hairline[1], hairline[2]);
  doc.setLineWidth(0.5);
  doc.line(M, y, W - M, y);
  y += 24;

  const drawRow = (
    label: string,
    value: string,
    opts?: { bold?: boolean; muted?: boolean; color?: RGB },
  ) => {
    doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
    doc.setFontSize(opts?.bold ? 12 : 11);
    const c = opts?.color ?? (opts?.muted ? muted : ink);
    doc.setTextColor(c[0], c[1], c[2]);
    doc.text(label, M, y);
    doc.text(value, W - M, y, { align: "right" });
    y += 22;
  };
  const sectionLabel = (label: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(purple[0], purple[1], purple[2]);
    doc.text(label.toUpperCase(), M, y);
    y += 20;
  };

  // THE TICKET — the pricing record. No fees, so it always adds up.
  sectionLabel("The ticket");
  // Itemized lines first (base service + each add-on) so the receipt reads
  // what the client actually got. Add-ons are prefixed "+"; they sum to the
  // subtotal below.
  if (rcp.lineItems && rcp.lineItems.length > 0) {
    for (const li of rcp.lineItems) {
      drawRow(li.kind === "addon" ? `+ ${li.label}` : li.label, fmt(li.amount));
    }
  }
  if (rcp.discountAmount && rcp.subtotal) {
    drawRow("Subtotal", fmt(rcp.subtotal));
    drawRow(
      "Discount" + (rcp.discountName ? ` — ${rcp.discountName}` : ""),
      "- " + fmt(rcp.discountAmount),
    );
  }
  drawRow("Service total", fmt(rcp.totalPrice), { bold: true });
  // Deposit / balance / paid-in-full rows — a $0 deposit is hidden and a full
  // upfront payment reads "Paid in full" rather than the whole ticket as a
  // "deposit".
  for (const pl of receiptPaymentLines(rcp)) {
    drawRow(pl.label, fmt(pl.amount));
  }
  if (rcp.tip) drawRow("Tip", fmt(rcp.tip));
  drawRow("Total", fmt(r2(rcp.totalPrice + (rcp.tip || 0))), { bold: true, color: purpleDeep });

  // THE MONEY — what was collected and what actually landed. Hidden by default
  // because a receipt goes to the client, who shouldn't see the stylist's
  // Stripe fee / net payout; the app's Payments view shows it. Only rendered
  // for an explicit internal copy (opts.includeNet).
  if (!isInvoice && opts?.includeNet) {
    y += 8;
    sectionLabel("The money");
    const stripeCharge = r2((rcp.balancePaid || 0) + (rcp.tip || 0));
    if (rcp.depositPaid > 0) drawRow("Deposit", fmt(rcp.depositPaid));
    if (stripeCharge > 0) {
      drawRow(rcp.stripeFee ? "Balance + tip (Stripe)" : "Balance + tip", fmt(stripeCharge));
    }
    if (rcp.stripeFee) drawRow("Stripe fee", "- " + fmt(rcp.stripeFee), { muted: true });
    drawRow("In your bank", fmt(rcp.netPayout ?? rcp.amountCollected), { bold: true });
  }

  y += 8;
  doc.setDrawColor(hairline[0], hairline[1], hairline[2]);
  doc.setLineWidth(0.5);
  doc.line(M, y, W - M, y);
  y += 22;

  // Payment status pops in brand color — mint when paid, coral otherwise.
  if (rcp.paymentStatus) {
    const st = String(rcp.paymentStatus).toUpperCase();
    const statusColor = st === "PAID" ? BRAND.mint : BRAND.coralDeep;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(muted[0], muted[1], muted[2]);
    doc.text("Payment status", M, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(statusColor[0], statusColor[1], statusColor[2]);
    doc.text(st, W - M, y, { align: "right" });
    y += 22;
  }
  if (rcp.paymentMethod) drawRow("Payment method", rcp.paymentMethod);
  if (rcp.paymentDate) drawRow("Payment date", fmtDateLong(rcp.paymentDate));

  if (rcp.notes) {
    y += 12;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(purple[0], purple[1], purple[2]);
    doc.text("NOTES", M, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(ink[0], ink[1], ink[2]);
    const wrapped = doc.splitTextToSize(rcp.notes, W - 2 * M);
    doc.text(wrapped, M, y);
    y += wrapped.length * 14;
  }

  if (isInvoice && Array.isArray(policies) && policies.length > 0) {
    y += 16;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(purple[0], purple[1], purple[2]);
    doc.text("POLICIES", M, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(muted[0], muted[1], muted[2]);
    for (const p of policies.slice(0, 3)) {
      const heading = p.title || p.category || "Policy";
      const wrapped = doc.splitTextToSize(`${heading}: ${p.body || ""}`, W - 2 * M);
      doc.text(wrapped, M, y);
      y += wrapped.length * 11 + 4;
      if (y > H - 100) break;
    }
  }

  // Footer — brand gradient rule + a multicolored thank-you.
  gradientRule(M, W - M, H - 80, 1);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(11);
  gradientText(
    isInvoice ? "Thank you — payment due upon service." : "Thank you for your business.",
    W / 2,
    H - 60,
    { align: "center" },
  );

  const blob = doc.output("blob");
  const filename = `${isInvoice ? "invoice" : "receipt"}-${rcp.receiptNumber}.pdf`;
  return { blob, filename };
};

// ---- Tax-time pack — annual P&L + Schedule C category map ------------
//
// Renders the AnnualTaxSummary from lib/tax-pack.ts into a clean
// one-or-two-page P&L the stylist can hand (or email) to their
// accountant. Page-break aware: the Schedule C section can run long
// when a stylist uses many expense categories.
import type { AnnualTaxSummary } from "./tax-pack";

export const renderTaxPackPdf = async (
  summary: AnnualTaxSummary,
  business: any,
): Promise<{ blob: Blob; filename: string }> => {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 48;
  const espresso = BRAND.ink;
  const muted = BRAND.muted;
  const purple = BRAND.purple;
  const hairline = BRAND.hairline;
  const green = BRAND.mint;
  const red = BRAND.coralDeep;
  const currency = business?.currency || "USD";
  const fmt = (n: number) => formatCurrency(n, currency);

  // Multicolored gradient wordmark (see renderReceiptPdf for the rationale).
  const gradientText = (
    text: string,
    x: number,
    yy: number,
    opts?: { align?: "left" | "right" | "center"; stops?: readonly RGB[] },
  ) => {
    const stops = opts?.stops ?? BRAND_STOPS;
    const chars = Array.from(text);
    const widths = chars.map((ch) => doc.getTextWidth(ch));
    const total = widths.reduce((s, w) => s + w, 0);
    let cx = x;
    if (opts?.align === "right") cx = x - total;
    else if (opts?.align === "center") cx = x - total / 2;
    const startX = cx;
    for (let i = 0; i < chars.length; i++) {
      const mid = total > 0 ? (cx - startX + widths[i] / 2) / total : 0;
      const [r, g, b] = gradientColorAt(stops, mid);
      doc.setTextColor(r, g, b);
      doc.text(chars[i], cx, yy);
      cx += widths[i];
    }
  };
  const gradientRule = (x1: number, x2: number, yy: number, lineWidth: number) => {
    const segs = 64;
    doc.setLineWidth(lineWidth);
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs;
      const t1 = (i + 1) / segs;
      const [r, g, b] = gradientColorAt(BRAND_STOPS, (t0 + t1) / 2);
      doc.setDrawColor(r, g, b);
      doc.line(x1 + (x2 - x1) * t0, yy, x1 + (x2 - x1) * t1, yy);
    }
  };

  const paintBackground = () => {
    doc.setFillColor(BRAND.white[0], BRAND.white[1], BRAND.white[2]);
    doc.rect(0, 0, W, H, "F");
  };
  paintBackground();

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  gradientText(business?.businessName || "Braid Boss Pro", M, 80);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(muted[0], muted[1], muted[2]);
  if (business?.ownerName) doc.text(business.ownerName, M, 96);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(26);
  gradientText(`${summary.year} TAX PACK`, W - M, 80, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(muted[0], muted[1], muted[2]);
  doc.text("Profit & Loss · Schedule C map", W - M, 98, { align: "right" });

  gradientRule(M, W - M, 120, 1.5);

  let y = 156;
  const ensureRoom = (needed: number) => {
    if (y + needed > H - 96) {
      doc.addPage();
      paintBackground();
      y = 80;
    }
  };
  const sectionTitle = (label: string) => {
    ensureRoom(40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(purple[0], purple[1], purple[2]);
    doc.text(label.toUpperCase(), M, y);
    y += 18;
  };
  const row = (
    label: string,
    value: string,
    opts?: { bold?: boolean; indent?: number; color?: readonly number[]; size?: number },
  ) => {
    ensureRoom(22);
    doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
    doc.setFontSize(opts?.size ?? (opts?.bold ? 12 : 11));
    const c = opts?.color ?? espresso;
    doc.setTextColor(c[0], c[1], c[2]);
    doc.text(label, M + (opts?.indent ?? 0), y);
    doc.text(value, W - M, y, { align: "right" });
    y += 22;
  };
  const rule = () => {
    ensureRoom(14);
    doc.setDrawColor(hairline[0], hairline[1], hairline[2]);
    doc.setLineWidth(0.5);
    doc.line(M, y, W - M, y);
    y += 18;
  };

  // --- Income ---
  sectionTitle("Income");
  row("Service income (appointments)", fmt(summary.income.appointments));
  if (summary.income.storefront > 0) {
    row("Storefront / product sales", fmt(summary.income.storefront));
  }
  rule();
  row("Gross income", fmt(summary.income.total), { bold: true });
  y += 10;

  // --- Expenses by Schedule C line ---
  sectionTitle("Expenses — by Schedule C line");
  if (summary.expenses.byScheduleCLine.length === 0) {
    row("No expenses recorded for this year.", "", { color: muted });
  } else {
    for (const line of summary.expenses.byScheduleCLine) {
      ensureRoom(24 + line.categories.length * 18);
      // Line header
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(espresso[0], espresso[1], espresso[2]);
      doc.text(`Line ${line.line} — ${line.label}`, M, y);
      doc.text(fmt(line.total), W - M, y, { align: "right" });
      y += 18;
      // Categories that rolled into this line
      for (const cat of line.categories) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(muted[0], muted[1], muted[2]);
        doc.text(cat.category, M + 16, y);
        doc.text(fmt(cat.amount), W - M, y, { align: "right" });
        y += 16;
      }
      y += 4;
    }
  }
  rule();
  row("Total expenses", fmt(summary.expenses.total), { bold: true });
  y += 10;

  // --- Net ---
  sectionTitle("Net profit");
  const netColor = summary.netProfit >= 0 ? green : red;
  row(
    summary.netProfit >= 0 ? "Net profit" : "Net loss",
    fmt(summary.netProfit),
    { bold: true, color: netColor, size: 15 },
  );
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(muted[0], muted[1], muted[2]);
  doc.text(
    `Based on ${summary.counts.appointmentsCounted} paid appointment(s), `
    + `${summary.counts.ordersCounted} storefront order(s), `
    + `${summary.counts.expensesCounted} expense(s).`,
    M, y,
  );
  y += 24;

  // --- Disclaimer ---
  ensureRoom(70);
  doc.setDrawColor(hairline[0], hairline[1], hairline[2]);
  doc.setLineWidth(0.5);
  doc.line(M, y, W - M, y);
  y += 16;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8.5);
  doc.setTextColor(muted[0], muted[1], muted[2]);
  const disclaimer = doc.splitTextToSize(
    "Prepared on a cash basis from Braid Boss Pro records. Schedule C line "
    + "assignments are a starting point — confirm with your accountant. Hair "
    + "and products resold to clients may belong in Cost of Goods Sold "
    + "(Schedule C Part III) rather than Supplies. This is not tax advice.",
    W - 2 * M,
  );
  doc.text(disclaimer, M, y);

  const blob = doc.output("blob");
  const safeBiz = String(business?.businessName || "braid-boss")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const filename = `tax-pack-${safeBiz || "braid-boss"}-${summary.year}.pdf`;
  return { blob, filename };
};

