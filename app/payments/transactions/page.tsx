"use client";

// /payments/transactions — Payments & Transactions.
//
// A mobile-first ledger that pulls together everything the stylist has
// collected, in the visual language of the Stripe app's payments
// screen: a row of revenue cards up top, a filter rail, then a dense,
// tappable transaction list. Tapping a row opens a full breakdown
// (deposit, balance, tip, Stripe fee, net payout, refund history).
//
// Data comes from three places, merged in app/lib/transactions.ts:
//   * appointments        — deposits + balance/final payments the
//                           stylist already tracks (links every payment
//                           to its booking).
//   * Stripe (connected)   — live charges/refunds with fee + net payout,
//                           pulled via /api/stripe-connect/transactions.
//   * manual ledger        — Cash / Zelle / Cash App / Venmo rows the
//                           stylist records here by hand.

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Download,
  FileSpreadsheet,
  Plus,
  RefreshCw,
  RotateCcw,
  X,
  ChevronRight,
  Search,
} from "lucide-react";
import { getSupabase, syncAppointments, syncPaymentTransactions } from "../../lib/supabase";
import { downloadCsv, downloadFile } from "../../lib/native-download";
import {
  FILTERS,
  TYPE_LABEL,
  METHOD_LABEL,
  formatMoney,
  deriveAppointmentTransactions,
  fromManualRecord,
  fromStripeRecord,
  mergeTransactions,
  reconcilePaidAppointments,
  filterTransactions,
  computeSummary,
  buildTransactionsCsv,
  buildTransactionsXls,
  type Transaction,
  type TxnFilter,
  type PaymentType,
  type PaymentMethod,
} from "../../lib/transactions";

const C = {
  espresso: "#15111A", coffee: "#3D3447", cream: "#FFFFFF",
  ivory: "#F6F2EC", paper: "#FFFFFF", gold: "#7C3AED", goldDeep: "#5B21B6",
  muted: "#6F6477", mutedSoft: "#9F95A8", hairline: "rgba(21, 17, 26, 0.10)",
  success: "#16A34A", warning: "#C9762B", danger: "#9C3D2E",
  bg: "#F5F3F8",
};
const GRADIENT = "linear-gradient(135deg, #7C3AED 0%, #FF4D6D 100%)";
const FONT_DISPLAY = `"Cormorant Garamond", Georgia, serif`;
const FONT_BODY = `"DM Sans", "Inter", system-ui, sans-serif`;

const uid = (): string =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// Initials avatar — mirrors the Stripe app's circular monogram.
const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || "")
    .join("") || "•";

const METHOD_TONE: Record<PaymentMethod, string> = {
  stripe: "#635BFF",
  card: "#635BFF",
  cash: "#16A34A",
  zelle: "#6D1ED4",
  cashapp: "#00C244",
  venmo: "#008CFF",
  other: C.muted,
};

const fmtRowDate = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    " · " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
};

const fmtFullDate = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  }) + " at " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
};

// Local YYYY-MM-DD (never UTC). toISOString() returns the UTC date, which
// rolls forward to tomorrow after ~4–8pm Pacific — wrong for a default
// "today" date or an export stamp on the stylist's wall clock.
const localDateStr = (d: Date = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function PaymentsTransactionsPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [manualRecords, setManualRecords] = useState<any[]>([]);
  const [stripeTxns, setStripeTxns] = useState<Transaction[]>([]);
  const [stripeConnected, setStripeConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState<TxnFilter>("all");
  const [period, setPeriod] = useState<"all" | "today" | "week" | "month">("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const currency = "USD";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = getSupabase();
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      setUserId(data?.session?.user?.id || null);
      setAuthChecked(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const loadLocal = useCallback(async (uid_: string) => {
    const [appts, manual] = await Promise.all([
      syncAppointments.pull(uid_).catch(() => [] as any[]),
      syncPaymentTransactions.pull(uid_).catch(() => [] as any[]),
    ]);
    setAppointments(appts);
    setManualRecords(manual);
  }, []);

  const pullStripe = useCallback(async () => {
    const supabase = getSupabase();
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return;
    setSyncing(true);
    try {
      const res = await fetch("/api/stripe-connect/transactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ access_token: token }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(body?.transactions)) {
        setStripeTxns(body.transactions.map(fromStripeRecord));
        setStripeConnected(!!body.connected);
      }
    } catch {
      /* Stripe sync is best-effort; appointment data still renders. */
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    if (!authChecked) return;
    let cancelled = false;
    (async () => {
      if (!userId) {
        if (!cancelled) setLoading(false);
        return;
      }
      await loadLocal(userId);
      if (cancelled) return;
      setLoading(false);
      void pullStripe();
    })();
    return () => { cancelled = true; };
  }, [authChecked, userId, loadLocal, pullStripe]);

  const appointmentTxns = useMemo(
    () => deriveAppointmentTransactions(appointments),
    [appointments],
  );
  const manualTxns = useMemo(
    () => manualRecords.map(fromManualRecord),
    [manualRecords],
  );
  const allTxns = useMemo(
    () => mergeTransactions(appointmentTxns, stripeTxns, manualTxns),
    [appointmentTxns, stripeTxns, manualTxns],
  );

  // Self-heal a stuck "balance due": when a live Stripe payment in this
  // ledger proves an appointment's balance was collected but the record
  // still reads unpaid (the balance webhook never landed), mark it paid and
  // sync it — so the schedule, outstanding totals and home cards stop
  // billing money that's already in. Re-runs harmlessly: once an
  // appointment reads paid, reconcilePaidAppointments returns nothing for it.
  useEffect(() => {
    if (!userId) return;
    const repaired = reconcilePaidAppointments(appointments, stripeTxns, localDateStr());
    if (repaired.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const r of repaired) {
        try {
          await syncAppointments.upsert(userId, r);
        } catch {
          /* offline — re-syncs when the connection returns */
        }
      }
      if (cancelled) return;
      // Reflect the repair locally so this list de-dupes the Stripe row and
      // shows the booking as paid without waiting for a re-pull.
      setAppointments((prev) => {
        const m = new Map(prev.map((a) => [String(a.id), a]));
        for (const r of repaired) m.set(String(r.id), r);
        return Array.from(m.values());
      });
    })();
    return () => { cancelled = true; };
  }, [userId, appointments, stripeTxns]);

  const summary = useMemo(
    () => computeSummary(allTxns, appointments),
    [allTxns, appointments],
  );

  const visible = useMemo(() => {
    let list = filterTransactions(allTxns, filter);
    if (period !== "all") {
      // Same period boundaries computeSummary uses, so tapping a card shows
      // exactly the transactions behind that figure (local wall clock;
      // Sunday-anchored week).
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      let start = startOfDay;
      if (period === "week") {
        start = new Date(startOfDay);
        start.setDate(start.getDate() - start.getDay());
      } else if (period === "month") {
        start = new Date(now.getFullYear(), now.getMonth(), 1);
      }
      const startMs = start.getTime();
      list = list.filter((t) => {
        const ts = new Date(t.paidAt).getTime();
        return !Number.isNaN(ts) && ts >= startMs;
      });
    }
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (t) =>
          t.clientName.toLowerCase().includes(q) ||
          t.serviceName.toLowerCase().includes(q),
      );
    }
    return list;
  }, [allTxns, filter, period, query]);

  const togglePeriod = useCallback(
    (p: "today" | "week" | "month") => setPeriod((cur) => (cur === p ? "all" : p)),
    [],
  );

  // Gross / fees / net of exactly the rows currently shown — so a filtered
  // view can reconcile the card (net) against the transaction rows (gross)
  // and the −Stripe-fee gap doesn't read as a math error.
  const visibleTotals = useMemo(() => {
    let gross = 0;
    let fees = 0;
    for (const t of visible) {
      // Refunds carry signed-negative amount + tip, reversing their charge's
      // revenue and tip. The fee is not recovered on a refund (Stripe keeps
      // it), so only positive charges add to fees — keeping this banner in
      // step with the summary cards.
      const isRefund = t.type === "refund";
      gross += t.amount + (isRefund || t.amount > 0 ? t.tip : 0);
      if (t.amount > 0) fees += t.fee || 0;
    }
    const r = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    return { gross: r(gross), fees: r(fees), net: r(gross - fees) };
  }, [visible]);

  const periodLabel =
    period === "today" ? "Today" : period === "week" ? "This week" : period === "month" ? "This month" : "";

  const flashToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }, []);

  const handleExportCsv = useCallback(async () => {
    const csv = buildTransactionsCsv(visible);
    const stamp = localDateStr();
    const r = await downloadCsv(`transactions-${stamp}.csv`, csv);
    flashToast(r.ok ? "CSV exported" : "Export failed");
  }, [visible, flashToast]);

  const handleExportXls = useCallback(async () => {
    const xls = buildTransactionsXls(visible);
    const stamp = localDateStr();
    const r = await downloadFile({
      filename: `transactions-${stamp}.xls`,
      mimeType: "application/vnd.ms-excel",
      data: xls,
      shareTitle: "Transactions",
    });
    flashToast(r.ok ? "Excel exported" : "Export failed");
  }, [visible, flashToast]);

  const handleSaveManual = useCallback(
    async (rec: ManualDraft) => {
      if (!userId) return;
      const record = {
        id: uid(),
        appointmentId: rec.appointmentId || null,
        clientName: rec.clientName || "Client",
        serviceName: rec.serviceName || "Manual payment",
        amount: rec.amount,
        tipAmount: rec.tip,
        paymentType: rec.type,
        paymentMethod: rec.method,
        paidAt: rec.paidAt,
        note: rec.note,
        createdAt: new Date().toISOString(),
      };
      setManualRecords((prev) => [record, ...prev]);
      setShowAdd(false);
      try {
        await syncPaymentTransactions.upsert(userId, record);
        flashToast("Payment recorded");
      } catch {
        flashToast("Saved locally — will sync");
      }
    },
    [userId, flashToast],
  );

  // Issue (or record) a refund for a transaction. Card payments taken
  // through Stripe are refunded to the client's card via the connected
  // account; cash/Zelle/Cash App/Venmo can only be *recorded* (the money
  // was handed back offline) — same split the Square app makes.
  //
  // Either way we write a `refund` row to the ledger so it shows in the
  // list, the Refunds filter, the summary and exports. Stripe refunds are
  // otherwise nested inside their charge and would never appear as a row.
  const handleRefund = useCallback(
    async (
      txn: Transaction,
      refundAmount: number,
      reason: string,
    ): Promise<{ ok: boolean; message: string }> => {
      if (!userId) return { ok: false, message: "Sign in required" };
      const amt = Math.round(refundAmount * 100) / 100;
      if (!(amt > 0)) return { ok: false, message: "Enter a refund amount" };
      const viaStripe = (txn.method === "stripe" || txn.method === "card") && !!txn.stripeId;

      if (viaStripe) {
        const supabase = getSupabase();
        const { data } = await supabase.auth.getSession();
        const tok = data?.session?.access_token;
        if (!tok) return { ok: false, message: "Sign in required" };
        const sid = String(txn.stripeId);
        const isIntent = sid.startsWith("pi_");
        try {
          const res = await fetch("/api/stripe-connect/refund", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${tok}` },
            body: JSON.stringify({
              [isIntent ? "payment_intent" : "charge"]: sid,
              amount: amt,
              reason: reason || undefined,
              client_name: txn.clientName,
              service_name: txn.serviceName,
            }),
          });
          const b = await res.json().catch(() => ({}));
          if (!res.ok) return { ok: false, message: b?.error || "Stripe refund failed" };
        } catch (e: any) {
          return { ok: false, message: e?.message || "Stripe refund failed" };
        }
      }

      // Reverse the share of the original tip this refund covers, so "Tips
      // Collected" drops the moment the refund is issued (a full refund
      // reverses the whole tip) instead of waiting for Stripe sync. A row's
      // `amount` already excludes the tip, so it's the service figure the
      // refund is measured against.
      const service = Math.max(0, Math.round(txn.amount * 100) / 100);
      const frac = service > 0 ? Math.min(1, amt / service) : txn.tip > 0 ? 1 : 0;
      const tipReversed = Math.round((txn.tip || 0) * frac * 100) / 100;

      const record = {
        id: uid(),
        appointmentId: txn.appointmentId || null,
        clientName: txn.clientName,
        serviceName: txn.serviceName,
        amount: amt,
        tipAmount: tipReversed,
        paymentType: "refund" as PaymentType,
        paymentMethod: txn.method,
        // Tie a card refund back to its original charge's
        // payment_intent/charge. Once Stripe sync surfaces the same refund
        // as its own row, mergeTransactions collapses the two so the refund
        // never shows (or counts) twice. Cash/Zelle/etc. leave this null.
        stripeId: viaStripe && txn.stripeId ? String(txn.stripeId) : null,
        paidAt: new Date().toISOString(),
        note: reason
          ? `Refund · ${reason}`
          : viaStripe
            ? "Refunded via Stripe"
            : "Refund recorded",
        createdAt: new Date().toISOString(),
      };
      setManualRecords((prev) => [record, ...prev]);
      try {
        await syncPaymentTransactions.upsert(userId, record);
      } catch {
        /* saved locally — will sync on next connection */
      }
      if (viaStripe) void pullStripe();

      return {
        ok: true,
        message: viaStripe
          ? `Refunded ${formatMoney(amt, currency)} to card`
          : `Refund of ${formatMoney(amt, currency)} recorded`,
      };
    },
    [userId, pullStripe, currency],
  );

  if (!authChecked || loading) return <LoadingShell />;

  if (!userId) {
    return (
      <Shell onBack={() => router.push("/")}>
        <div style={{ textAlign: "center", padding: "40px 0", color: C.coffee }}>
          <p style={{ fontSize: 14 }}>Sign in to view your payments.</p>
          <button type="button" onClick={() => router.push("/")} style={primaryBtn}>
            Back to app
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell
      onBack={() => router.push("/")}
      onRefresh={() => void pullStripe()}
      syncing={syncing}
    >
      {/* Summary cards — horizontal scroll, Stripe-app style. */}
      <div
        style={{
          display: "flex", gap: 12, overflowX: "auto", padding: "4px 0 8px",
          scrollbarWidth: "none", WebkitOverflowScrolling: "touch",
        }}
      >
        {/* Revenue cards are NET of Stripe fees — what actually lands. Tap to
            filter the list to that period. */}
        <SummaryCard label="Today (net)" value={formatMoney(summary.todayRevenue, currency)} lead
          onClick={() => togglePeriod("today")} active={period === "today"} />
        <SummaryCard label="This Week (net)" value={formatMoney(summary.weekRevenue, currency)}
          onClick={() => togglePeriod("week")} active={period === "week"} />
        <SummaryCard label="This Month (net)" value={formatMoney(summary.monthRevenue, currency)}
          onClick={() => togglePeriod("month")} active={period === "month"} />
        {/* Fee breakdown only appears once a card payment has been taken, so
            cash-only stylists don't see empty fee cards. */}
        {summary.monthFees > 0 && (
          <SummaryCard label="Gross (mo)" value={formatMoney(summary.monthGross, currency)} />
        )}
        {summary.monthFees > 0 && (
          <SummaryCard label="Stripe Fees (mo)" value={`− ${formatMoney(summary.monthFees, currency)}`} />
        )}
        {/* Unlike the period cards above, these three are all-time / live
            snapshots — not scoped to today/week/month. The labels say so, so
            they don't read as period figures. */}
        <SummaryCard label="Tips (all-time)" value={formatMoney(summary.tips, currency)} />
        <SummaryCard label="Deposits (all-time)" value={formatMoney(summary.deposits, currency)} />
        <SummaryCard
          label="Outstanding (total owed)"
          value={formatMoney(summary.outstanding, currency)}
          tone={summary.outstanding > 0 ? "warning" : undefined}
        />
      </div>

      {/* Search + actions */}
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <div
          style={{
            flex: 1, display: "flex", alignItems: "center", gap: 8,
            background: C.paper, border: `1px solid ${C.hairline}`,
            borderRadius: 12, padding: "0 12px", minHeight: 44,
          }}
        >
          <Search size={16} style={{ color: C.muted, flexShrink: 0 }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search client or service"
            style={{
              flex: 1, border: 0, outline: "none", background: "transparent",
              fontSize: 14, color: C.espresso, fontFamily: FONT_BODY, minWidth: 0,
            }}
          />
        </div>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          aria-label="Record payment"
          style={{
            ...iconBtn, background: GRADIENT, color: "#fff", border: 0,
          }}
        >
          <Plus size={20} />
        </button>
      </div>

      {/* Filter rail */}
      <div
        style={{
          display: "flex", gap: 8, overflowX: "auto", padding: "12px 0 4px",
          scrollbarWidth: "none",
        }}
      >
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              style={{
                flexShrink: 0, padding: "8px 14px", borderRadius: 999,
                fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
                cursor: "pointer", fontFamily: FONT_BODY,
                background: active ? C.espresso : C.paper,
                color: active ? "#fff" : C.coffee,
                border: `1px solid ${active ? C.espresso : C.hairline}`,
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Export row */}
      <div style={{ display: "flex", gap: 8, margin: "8px 0 4px" }}>
        <button type="button" onClick={handleExportCsv} style={exportBtn}>
          <Download size={14} /> CSV
        </button>
        <button type="button" onClick={handleExportXls} style={exportBtn}>
          <FileSpreadsheet size={14} /> Excel
        </button>
        <span style={{ marginLeft: "auto", alignSelf: "center", fontSize: 12, color: C.muted }}>
          {visible.length} transaction{visible.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* When a period is active, reconcile the rows (gross) to the card
          (net) so the −Stripe-fee gap is explained, not confusing. */}
      {period !== "all" && (
        <div
          style={{
            display: "flex", alignItems: "center", flexWrap: "wrap", gap: "4px 10px",
            padding: "10px 14px", marginTop: 4, borderRadius: 12,
            background: C.ivory, border: `1px solid ${C.hairline}`,
            fontSize: 12, color: C.coffee,
          }}
        >
          <strong style={{ color: C.espresso }}>{periodLabel}</strong>
          <span>Collected {formatMoney(visibleTotals.gross, currency)}</span>
          {visibleTotals.fees > 0 && (
            <span style={{ color: C.muted }}>− Stripe fees {formatMoney(visibleTotals.fees, currency)}</span>
          )}
          <span style={{ fontWeight: 700, color: C.espresso }}>= Net {formatMoney(visibleTotals.net, currency)}</span>
          <button
            type="button"
            onClick={() => setPeriod("all")}
            style={{
              marginLeft: "auto", background: "transparent", border: 0,
              color: C.gold, fontWeight: 600, fontSize: 12, cursor: "pointer",
              fontFamily: FONT_BODY,
            }}
          >
            Clear
          </button>
        </div>
      )}

      {/* Transaction list */}
      <div
        style={{
          marginTop: 8, background: C.paper, borderRadius: 16,
          border: `1px solid ${C.hairline}`, overflow: "hidden",
        }}
      >
        {visible.length === 0 ? (
          <div style={{ padding: "44px 20px", textAlign: "center" }}>
            <p style={{ fontSize: 14, color: C.coffee, fontWeight: 600 }}>No transactions yet</p>
            <p style={{ fontSize: 12, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
              {stripeConnected
                ? "Payments will appear here as clients pay deposits and balances."
                : "Connect Stripe in Settings → Payments, or record a manual payment with the + button."}
            </p>
          </div>
        ) : (
          visible.map((t, i) => (
            <TxnRow
              key={t.id}
              txn={t}
              currency={currency}
              first={i === 0}
              onClick={() => setSelected(t)}
            />
          ))
        )}
      </div>

      <p style={{ fontSize: 11, color: C.mutedSoft, textAlign: "center", marginTop: 16, lineHeight: 1.5 }}>
        Stripe payments sync automatically from your connected account.
        Cash, Zelle, Cash App & Venmo are recorded by hand.
      </p>

      {selected && (
        <DetailSheet
          txn={selected}
          currency={currency}
          appointment={
            selected.appointmentId
              ? appointments.find((a) => String(a.id) === selected.appointmentId)
              : undefined
          }
          onClose={() => setSelected(null)}
          onRefund={handleRefund}
          onToast={flashToast}
        />
      )}
      {showAdd && (
        <ManualSheet
          appointments={appointments}
          onClose={() => setShowAdd(false)}
          onSave={handleSaveManual}
        />
      )}
      {toast && (
        <div
          style={{
            position: "fixed", left: "50%", transform: "translateX(-50%)",
            bottom: "calc(24px + env(safe-area-inset-bottom, 0px))",
            background: C.espresso, color: "#fff", padding: "10px 18px",
            borderRadius: 999, fontSize: 13, fontWeight: 600, zIndex: 60,
            boxShadow: "0 8px 24px -8px rgba(0,0,0,0.4)",
          }}
        >
          {toast}
        </div>
      )}
    </Shell>
  );
}

// ---- Transaction row ----------------------------------------------------

function TxnRow({
  txn, currency, first, onClick,
}: { txn: Transaction; currency: string; first: boolean; onClick: () => void }) {
  const isRefund = txn.type === "refund" || txn.amount < 0;
  const tone = METHOD_TONE[txn.method];
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 12,
        padding: "14px 16px", background: "transparent", cursor: "pointer",
        border: 0, borderTop: first ? 0 : `1px solid ${C.hairline}`,
        textAlign: "left", fontFamily: FONT_BODY,
      }}
    >
      <div
        aria-hidden
        style={{
          width: 40, height: 40, borderRadius: 999, flexShrink: 0,
          display: "grid", placeItems: "center", fontSize: 13, fontWeight: 700,
          background: `${tone}1A`, color: tone,
        }}
      >
        {initials(txn.clientName)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            fontSize: 14, fontWeight: 600, color: C.espresso,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}
        >
          {txn.clientName}
        </p>
        <p
          style={{
            fontSize: 12, color: C.muted, marginTop: 2,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}
        >
          {txn.serviceName}
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
          <Badge type={txn.type} />
          <span style={{ fontSize: 11, color: C.mutedSoft }}>
            {METHOD_LABEL[txn.method]} · {fmtRowDate(txn.paidAt)}
          </span>
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <p
          style={{
            fontSize: 15, fontWeight: 700,
            color: isRefund ? C.danger : C.espresso,
          }}
        >
          {isRefund ? "−" : ""}{formatMoney(Math.abs(txn.amount + (txn.amount > 0 ? txn.tip : 0)), currency)}
        </p>
        {txn.tip > 0 && txn.amount > 0 && (
          <p style={{ fontSize: 11, color: C.success, marginTop: 2 }}>
            +{formatMoney(txn.tip, currency)} tip
          </p>
        )}
      </div>
      <ChevronRight size={16} style={{ color: C.mutedSoft, flexShrink: 0 }} />
    </button>
  );
}

function Badge({ type }: { type: PaymentType }) {
  const map: Record<PaymentType, { bg: string; fg: string }> = {
    deposit: { bg: "rgba(124,58,237,0.12)", fg: C.goldDeep },
    final: { bg: "rgba(74,138,138,0.14)", fg: "#356B6B" },
    full: { bg: "rgba(22,163,74,0.14)", fg: C.success },
    refund: { bg: "rgba(156,61,46,0.12)", fg: C.danger },
  };
  const s = map[type];
  return (
    <span
      style={{
        fontSize: 10, fontWeight: 700, letterSpacing: "0.03em",
        textTransform: "uppercase", padding: "2px 7px", borderRadius: 6,
        background: s.bg, color: s.fg,
      }}
    >
      {TYPE_LABEL[type]}
    </span>
  );
}

// ---- Summary card -------------------------------------------------------

function SummaryCard({
  label, value, lead, tone, onClick, active,
}: { label: string; value: string; lead?: boolean; tone?: "warning"; onClick?: () => void; active?: boolean }) {
  const tappable = !!onClick;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!tappable}
      style={{
        flexShrink: 0, minWidth: 132, padding: "14px 16px", borderRadius: 16,
        textAlign: "left", fontFamily: FONT_BODY, cursor: tappable ? "pointer" : "default",
        background: lead ? GRADIENT : C.paper,
        border: active ? `2px solid ${C.gold}` : lead ? 0 : `1px solid ${C.hairline}`,
        boxShadow: lead ? "0 10px 28px -12px rgba(124,58,237,0.5)" : "none",
        WebkitAppearance: "none", appearance: "none",
      }}
    >
      <p
        style={{
          fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: lead ? "rgba(255,255,255,0.85)" : C.muted,
        }}
      >
        {label}{tappable ? (active ? " ×" : " ›") : ""}
      </p>
      <p
        style={{
          fontSize: 22, fontWeight: 700, marginTop: 6, fontFamily: FONT_DISPLAY,
          color: lead ? "#fff" : tone === "warning" ? C.warning : C.espresso,
        }}
      >
        {value}
      </p>
    </button>
  );
}

// ---- Detail sheet -------------------------------------------------------

function DetailSheet({
  txn, currency, appointment, onClose, onRefund, onToast,
}: {
  txn: Transaction;
  currency: string;
  // The booking behind this payment, when we have it — supplies the pricing
  // record (base service, add-ons, discount, deposit) the transaction row
  // alone doesn't carry.
  appointment?: any;
  onClose: () => void;
  onRefund: (txn: Transaction, amount: number, reason: string) => Promise<{ ok: boolean; message: string }>;
  onToast: (msg: string) => void;
}) {
  const isRefund = txn.type === "refund" || txn.amount < 0;
  const money = (n: number) => Math.round(n * 100) / 100;
  const num = (v: any): number => {
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    const n = parseFloat(String(v ?? "").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  };

  // Two separate stories so neither has to reconcile against the other:
  //   • THE TICKET — the pricing record (base + add-ons − discount, deposit,
  //     balance, tip). No fees here, so it always adds up.
  //   • THE MONEY — what she paid and what actually landed. Only the balance +
  //     tip run through Stripe (the deposit is collected on its own, e.g. by
  //     Zelle), so the fee applies to that charge alone.
  const addOnsTotal = money((txn.addOns || []).reduce((s, a) => s + num(a.amount), 0));
  const subtotal = money(num(appointment?.totalPrice)); // base service + add-ons, pre-discount
  const discount = money(num(appointment?.discountAmount));
  const baseService = money(Math.max(0, subtotal - addOnsTotal));
  // Net service after discount. Falls back to the row's own amounts when there
  // is no linked appointment (a manual/standalone Stripe row).
  const serviceTotal = subtotal > 0
    ? money(Math.max(0, subtotal - discount))
    : money((txn.balancePaid > 0 ? txn.balancePaid : Math.max(0, txn.amount)) + txn.depositAmount);
  const deposit = money(Math.max(0, num(appointment?.depositPaid) || txn.depositAmount));
  // Prefer the appointment's tip/fee so the appointment-wide totals read the
  // same whichever of its rows (deposit or balance) is open — tip and fee sit
  // on the balance row, not the deposit.
  const tip = money(num(appointment?.tipAmount ?? appointment?.tip) || txn.tip);
  const ticketTotal = money(serviceTotal + tip);

  // Is the balance actually settled? Only then does it count as money in.
  const paidInFull = appointment
    ? (appointment.balance_paid === true ||
       appointment.balancePaid === true ||
       appointment.paymentStatus === "paid" ||
       (subtotal > 0 && num(appointment.balanceDue) === 0))
    : txn.type !== "deposit";
  const balancePaid = paidInFull ? money(Math.max(0, serviceTotal - deposit)) : 0;
  const balanceDue = money(Math.max(0, serviceTotal - deposit - balancePaid));

  // Money side. The deposit is collected separately (no Stripe fee); the
  // balance + tip is the Stripe charge the fee comes off. "In your bank" is
  // every dollar collected minus that fee — deposits included, since they're
  // income too.
  const fee = money(num(appointment?.stripeFee) || num(txn.fee));
  const stripeCharge = money(balancePaid + tip);
  const collected = money(deposit + stripeCharge);
  const inBank = money(collected - fee);

  // How much is still refundable: the (positive) charge minus anything
  // already refunded. Stripe charges carry their refund history; other
  // rows start from zero.
  const alreadyRefunded = txn.refunds.reduce((s, r) => s + Math.abs(r.amount), 0);
  const grossAmount = Math.abs(txn.amount);
  const maxRefund = Math.max(0, Math.round((grossAmount - alreadyRefunded) * 100) / 100);
  const refundable = !isRefund && txn.amount > 0 && maxRefund > 0.005;
  const viaStripe = (txn.method === "stripe" || txn.method === "card") && !!txn.stripeId;

  const [mode, setMode] = useState<"view" | "refund">("view");
  const [refundStr, setRefundStr] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const openRefund = () => {
    setRefundStr(maxRefund.toFixed(2));
    setReason("");
    setErr(null);
    setMode("refund");
  };

  const submitRefund = async () => {
    const amt = parseFloat(refundStr) || 0;
    if (!(amt > 0)) { setErr("Enter a refund amount."); return; }
    if (amt > maxRefund + 0.001) {
      setErr(`Can't refund more than ${formatMoney(maxRefund, currency)}.`);
      return;
    }
    setBusy(true);
    setErr(null);
    const r = await onRefund(txn, amt, reason.trim());
    setBusy(false);
    if (r.ok) { onToast(r.message); onClose(); }
    else setErr(r.message);
  };

  return (
    <Overlay onClose={busy ? () => {} : onClose}>
      <div style={sheetStyle}>
        <SheetHeader title={mode === "refund" ? "Issue refund" : "Transaction"} onClose={onClose} />
        {mode === "refund" ? (
          <div style={{ padding: "8px 20px 28px", overflowY: "auto", display: "grid", gap: 16 }}>
            <div style={{ textAlign: "center", padding: "4px 0 6px" }}>
              <p style={{ fontSize: 12, color: C.muted }}>Refunding</p>
              <p style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>
                {txn.clientName}
                <span style={{ color: C.muted, fontWeight: 500 }}> · {txn.serviceName}</span>
              </p>
            </div>

            <p style={{ fontSize: 13, color: C.coffee, lineHeight: 1.5, margin: 0 }}>
              {viaStripe
                ? "This refunds the client's card through Stripe. It can take 5–10 business days to land on their statement, and they'll get an email confirmation."
                : `${METHOD_LABEL[txn.method]} payments can't be refunded automatically — hand the money back ${txn.method === "cash" ? "in person" : `in ${METHOD_LABEL[txn.method]}`}, then record it here to keep your books straight.`}
            </p>

            <Field label="Refund amount">
              <input
                value={refundStr}
                onChange={(e) => setRefundStr(e.target.value.replace(/[^\d.]/g, ""))}
                inputMode="decimal"
                placeholder="0.00"
                style={inputStyle}
              />
            </Field>
            <div style={{ display: "flex", gap: 8, marginTop: -8 }}>
              <button
                type="button"
                onClick={() => setRefundStr(maxRefund.toFixed(2))}
                style={{
                  ...exportBtn, fontSize: 12,
                }}
              >
                Refund full {formatMoney(maxRefund, currency)}
              </button>
            </div>

            <Field label="Reason (optional)">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Client cancelled"
                style={inputStyle}
              />
            </Field>

            {err && (
              <p style={{ fontSize: 13, color: C.danger, margin: 0 }}>{err}</p>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              <button
                type="button"
                onClick={() => setMode("view")}
                disabled={busy}
                style={{
                  ...exportBtn, flex: 1, justifyContent: "center", minHeight: 50,
                  fontSize: 15, opacity: busy ? 0.5 : 1,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitRefund}
                disabled={busy}
                style={{
                  ...primaryBtn, flex: 1.4, width: "auto",
                  background: viaStripe ? C.danger : GRADIENT,
                  opacity: busy ? 0.6 : 1, cursor: busy ? "default" : "pointer",
                  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
                }}
              >
                {busy ? (
                  <RefreshCw size={18} style={{ animation: "bbp-spin 0.8s linear infinite" }} />
                ) : (
                  <RotateCcw size={18} />
                )}
                {viaStripe ? "Refund to card" : "Record refund"}
              </button>
            </div>
          </div>
        ) : (
        <div style={{ padding: "8px 20px 28px", overflowY: "auto" }}>
          {/* Hero amount */}
          <div style={{ textAlign: "center", padding: "8px 0 18px" }}>
            <p
              style={{
                fontSize: 38, fontWeight: 700, fontFamily: FONT_DISPLAY,
                color: isRefund ? C.danger : C.espresso,
              }}
            >
              {isRefund ? "−" : ""}{formatMoney(Math.abs(txn.amount), currency)}
            </p>
            <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 6 }}>
              <Badge type={txn.type} />
              <span style={{ fontSize: 12, color: C.muted }}>{METHOD_LABEL[txn.method]}</span>
            </div>
            <p style={{ fontSize: 12, color: C.mutedSoft, marginTop: 8 }}>
              {fmtFullDate(txn.paidAt)}
            </p>
          </div>

          <Section title="Client">
            <Row label="Name" value={txn.clientName} />
          </Section>

          <Section title="Appointment">
            <Row label="Service booked" value={txn.serviceName} />
            {txn.appointmentId
              ? <Row label="Linked booking" value={`#${txn.appointmentId.slice(0, 8)}`} />
              : <Row label="Linked booking" value="Not linked" muted />}
          </Section>

          {isRefund ? (
            // A refund is money going back out — show it plainly, no ticket.
            <Section title="Refund">
              <Row
                label="Refunded to client"
                value={`− ${formatMoney(Math.abs(txn.amount), currency)}`}
                strong
              />
              {Math.abs(txn.tip) > 0 && (
                <Row label="Tip reversed" value={`− ${formatMoney(Math.abs(txn.tip), currency)}`} />
              )}
            </Section>
          ) : (
            <>
              {/* THE TICKET — the pricing record. No fees, so it always adds up. */}
              <Section title="The ticket">
                {baseService > 0 && (
                  <Row label={txn.serviceName} value={formatMoney(baseService, currency)} />
                )}
                {(txn.addOns || []).map((a, i) => (
                  <Row key={i} label={`+ ${a.name}`} value={formatMoney(num(a.amount), currency)} />
                ))}
                {discount > 0 && (
                  <Row label="Discount" value={`− ${formatMoney(discount, currency)}`} />
                )}
                <Row label="Service total" value={formatMoney(serviceTotal, currency)} strong />
                {deposit > 0 && (
                  <Row label="Deposit paid" value={formatMoney(deposit, currency)} />
                )}
                {balancePaid > 0 && (
                  <Row label="Balance" value={formatMoney(balancePaid, currency)} />
                )}
                {balanceDue > 0 && (
                  <Row label="Balance due" value={formatMoney(balanceDue, currency)} />
                )}
                {tip > 0 && <Row label="Tip" value={`+ ${formatMoney(tip, currency)}`} />}
                <Row label="Total" value={formatMoney(ticketTotal, currency)} strong />
              </Section>

              {/* THE MONEY — what she paid and what landed, fee included. Every
                  line is visible so the total reconciles on its face. */}
              <Section title="The money">
                {deposit > 0 && (
                  <Row label="Deposit" value={formatMoney(deposit, currency)} />
                )}
                {stripeCharge > 0 && (
                  <Row
                    label={
                      fee > 0
                        ? (tip > 0 ? "Balance + tip (Stripe)" : "Balance (Stripe)")
                        : (tip > 0 ? "Balance + tip" : "Balance")
                    }
                    value={formatMoney(stripeCharge, currency)}
                  />
                )}
                {fee > 0 && (
                  <Row label="Stripe fee" value={`− ${formatMoney(fee, currency)}`} />
                )}
                <Row label="In your bank" value={formatMoney(inBank, currency)} strong />
              </Section>

              {txn.refunds.length > 0 && (
                <Section title="Refund history">
                  {txn.refunds.map((r) => (
                    <Row
                      key={r.id}
                      label={`${fmtRowDate(r.date)}${r.reason ? ` · ${r.reason}` : ""}`}
                      value={`− ${formatMoney(r.amount, currency)}`}
                    />
                  ))}
                </Section>
              )}
            </>
          )}

          {txn.note && (
            <Section title="Note">
              <p style={{ fontSize: 13, color: C.coffee, lineHeight: 1.5 }}>{txn.note}</p>
            </Section>
          )}

          {refundable && (
            <button
              type="button"
              onClick={openRefund}
              style={{
                ...primaryBtn, marginTop: 22,
                background: "transparent", color: C.danger,
                border: `1.5px solid ${C.danger}`,
                display: "inline-flex", alignItems: "center",
                justifyContent: "center", gap: 8,
              }}
            >
              <RotateCcw size={18} />
              Issue refund
            </button>
          )}
        </div>
        )}
      </div>
    </Overlay>
  );
}

// ---- Manual entry sheet -------------------------------------------------

type ManualDraft = {
  clientName: string;
  serviceName: string;
  amount: number;
  tip: number;
  type: PaymentType;
  method: PaymentMethod;
  paidAt: string;
  appointmentId: string | null;
  note: string;
};

const MANUAL_METHODS: { key: PaymentMethod; label: string }[] = [
  { key: "cash", label: "Cash" },
  { key: "zelle", label: "Zelle" },
  { key: "cashapp", label: "Cash App" },
  { key: "venmo", label: "Venmo" },
  { key: "other", label: "Other" },
];

const MANUAL_TYPES: { key: PaymentType; label: string }[] = [
  { key: "deposit", label: "Deposit" },
  { key: "final", label: "Final Payment" },
  { key: "full", label: "Full Payment" },
  { key: "refund", label: "Refund" },
];

function ManualSheet({
  appointments, onClose, onSave,
}: {
  appointments: any[];
  onClose: () => void;
  onSave: (d: ManualDraft) => void;
}) {
  const [clientName, setClientName] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [tipStr, setTipStr] = useState("");
  const [type, setType] = useState<PaymentType>("full");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [apptId, setApptId] = useState<string>("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(() => localDateStr());

  // Picking an appointment auto-fills client + service so a manual cash
  // payment links cleanly to the booking.
  const linkOptions = useMemo(
    () =>
      (Array.isArray(appointments) ? appointments : [])
        .filter((a) => String(a?.status || "").toLowerCase() !== "canceled")
        .slice(0, 60)
        .map((a) => ({
          id: String(a.id),
          label: `${a.clientName || "Client"} · ${a.style || a.serviceName || "Service"}`,
          clientName: a.clientName || "",
          serviceName: a.style || a.serviceName || "",
        })),
    [appointments],
  );

  const amount = parseFloat(amountStr) || 0;
  const valid = amount > 0 && clientName.trim().length > 0;

  const submit = () => {
    if (!valid) return;
    onSave({
      clientName: clientName.trim(),
      serviceName: serviceName.trim() || "Manual payment",
      amount,
      tip: parseFloat(tipStr) || 0,
      type,
      method,
      paidAt: new Date(`${date}T12:00:00`).toISOString(),
      appointmentId: apptId || null,
      note: note.trim(),
    });
  };

  return (
    <Overlay onClose={onClose}>
      <div style={sheetStyle}>
        <SheetHeader title="Record payment" onClose={onClose} />
        <div style={{ padding: "8px 20px 28px", overflowY: "auto", display: "grid", gap: 16 }}>
          <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.5, margin: 0 }}>
            Log a Cash, Zelle, Cash App or Venmo payment. Link it to a booking to
            keep your appointment records in sync.
          </p>

          <Field label="Link to appointment (optional)">
            <select
              value={apptId}
              onChange={(e) => {
                const id = e.target.value;
                setApptId(id);
                const opt = linkOptions.find((o) => o.id === id);
                if (opt) {
                  if (!clientName) setClientName(opt.clientName);
                  if (!serviceName) setServiceName(opt.serviceName);
                }
              }}
              style={inputStyle}
            >
              <option value="">Not linked</option>
              {linkOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </Field>

          <Field label="Client name">
            <input
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Client name"
              style={inputStyle}
            />
          </Field>

          <Field label="Service">
            <input
              value={serviceName}
              onChange={(e) => setServiceName(e.target.value)}
              placeholder="e.g. Knotless braids"
              style={inputStyle}
            />
          </Field>

          <div style={{ display: "flex", gap: 12 }}>
            <Field label="Amount" style={{ flex: 1 }}>
              <input
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value.replace(/[^\d.]/g, ""))}
                inputMode="decimal"
                placeholder="0.00"
                style={inputStyle}
              />
            </Field>
            <Field label="Tip (optional)" style={{ flex: 1 }}>
              <input
                value={tipStr}
                onChange={(e) => setTipStr(e.target.value.replace(/[^\d.]/g, ""))}
                inputMode="decimal"
                placeholder="0.00"
                style={inputStyle}
              />
            </Field>
          </div>

          <Field label="Payment type">
            <ChipGroup
              options={MANUAL_TYPES}
              value={type}
              onChange={(v) => setType(v as PaymentType)}
            />
          </Field>

          <Field label="Payment method">
            <ChipGroup
              options={MANUAL_METHODS}
              value={method}
              onChange={(v) => setMethod(v as PaymentMethod)}
            />
          </Field>

          <Field label="Date">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={inputStyle}
            />
          </Field>

          <Field label="Note (optional)">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Anything to remember"
              style={inputStyle}
            />
          </Field>

          <button
            type="button"
            onClick={submit}
            disabled={!valid}
            style={{
              ...primaryBtn, marginTop: 4,
              opacity: valid ? 1 : 0.5, cursor: valid ? "pointer" : "default",
            }}
          >
            Record payment
          </button>
        </div>
      </div>
    </Overlay>
  );
}

function ChipGroup({
  options, value, onChange,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            style={{
              padding: "8px 14px", borderRadius: 999, fontSize: 13, fontWeight: 600,
              cursor: "pointer", fontFamily: FONT_BODY,
              background: active ? C.espresso : C.paper,
              color: active ? "#fff" : C.coffee,
              border: `1px solid ${active ? C.espresso : C.hairline}`,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ---- Shared chrome ------------------------------------------------------

function Shell({
  children, onBack, onRefresh, syncing,
}: {
  children: React.ReactNode;
  onBack: () => void;
  onRefresh?: () => void;
  syncing?: boolean;
}) {
  return (
    <div style={{ minHeight: "100dvh", background: C.bg, fontFamily: FONT_BODY, color: C.espresso }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=DM+Sans:wght@400;500;600;700&display=swap');
        body { margin: 0; }
        *::-webkit-scrollbar { display: none; }
        @keyframes bbp-spin { to { transform: rotate(360deg); } }
      `}</style>
      <div
        style={{
          position: "sticky", top: 0, zIndex: 20, background: C.bg,
          paddingTop: "env(safe-area-inset-top, 0px)",
          borderBottom: `1px solid ${C.hairline}`,
        }}
      >
        <div
          className="mx-auto"
          style={{
            maxWidth: 520, padding: "12px 16px", display: "flex",
            alignItems: "center", gap: 8,
          }}
        >
          <button type="button" onClick={onBack} aria-label="Back" style={iconBtnGhost}>
            <ArrowLeft size={20} />
          </button>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0, fontFamily: FONT_DISPLAY }}>
              Payments &amp; Transactions
            </h1>
          </div>
          {onRefresh && (
            <button type="button" onClick={onRefresh} aria-label="Sync Stripe" style={iconBtnGhost}>
              <RefreshCw
                size={18}
                style={{ animation: syncing ? "bbp-spin 0.8s linear infinite" : undefined }}
              />
            </button>
          )}
        </div>
      </div>
      <div
        className="mx-auto"
        style={{
          maxWidth: 520, padding: "16px",
          paddingBottom: "calc(40px + env(safe-area-inset-bottom, 0px))",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function LoadingShell() {
  return (
    <div
      style={{
        minHeight: "100dvh", background: C.bg, display: "grid",
        placeItems: "center", fontFamily: FONT_BODY, color: C.muted,
      }}
    >
      <style>{`@keyframes bbp-spin { to { transform: rotate(360deg); } }`}</style>
      <RefreshCw size={22} style={{ animation: "bbp-spin 0.8s linear infinite" }} />
    </div>
  );
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        background: "rgba(21,17,26,0.45)", display: "flex", alignItems: "flex-end",
        justifyContent: "center",
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 520 }}>
        {children}
      </div>
    </div>
  );
}

function SheetHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "16px 20px 8px", position: "sticky", top: 0, background: C.cream,
        zIndex: 2,
      }}
    >
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, fontFamily: FONT_DISPLAY }}>{title}</h2>
      <button type="button" onClick={onClose} aria-label="Close" style={iconBtnGhost}>
        <X size={20} />
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 18 }}>
      <p
        style={{
          fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
          textTransform: "uppercase", color: C.muted, marginBottom: 8,
        }}
      >
        {title}
      </p>
      <div
        style={{
          background: C.paper, borderRadius: 12, border: `1px solid ${C.hairline}`,
          padding: "4px 14px",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Row({
  label, value, strong, muted,
}: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div
      style={{
        display: "flex", justifyContent: "space-between", gap: 12,
        padding: "10px 0", borderBottom: `1px solid ${C.hairline}`,
      }}
    >
      <span style={{ fontSize: 13, color: C.muted, flexShrink: 0 }}>{label}</span>
      <span
        style={{
          fontSize: 13, textAlign: "right",
          fontWeight: strong ? 700 : 500,
          color: muted ? C.mutedSoft : strong ? C.espresso : C.coffee,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function Field({
  label, children, style,
}: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <label style={{ display: "block", ...style }}>
      <span
        style={{
          fontSize: 12, fontWeight: 600, color: C.coffee, display: "block",
          marginBottom: 6,
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

const sheetStyle: React.CSSProperties = {
  background: C.cream,
  borderTopLeftRadius: 22,
  borderTopRightRadius: 22,
  maxHeight: "90dvh",
  display: "flex",
  flexDirection: "column",
  paddingBottom: "env(safe-area-inset-bottom, 0px)",
  boxShadow: "0 -8px 40px -12px rgba(0,0,0,0.3)",
};

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "12px 14px", borderRadius: 12,
  border: `1px solid ${C.hairline}`, background: C.paper, fontSize: 15,
  color: C.espresso, fontFamily: FONT_BODY, outline: "none",
  minHeight: 46, WebkitAppearance: "none", appearance: "none",
};

const primaryBtn: React.CSSProperties = {
  padding: "14px 16px", borderRadius: 14, background: GRADIENT,
  color: "#fff", border: 0, fontSize: 15, fontWeight: 700, cursor: "pointer",
  minHeight: 50, width: "100%", fontFamily: FONT_BODY,
};

const iconBtn: React.CSSProperties = {
  width: 44, height: 44, borderRadius: 12, display: "grid", placeItems: "center",
  cursor: "pointer", flexShrink: 0,
};

const iconBtnGhost: React.CSSProperties = {
  ...iconBtn, background: "transparent", border: 0, color: C.coffee,
};

const exportBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px",
  borderRadius: 10, background: C.paper, border: `1px solid ${C.hairline}`,
  fontSize: 13, fontWeight: 600, color: C.coffee, cursor: "pointer",
  fontFamily: FONT_BODY,
};
