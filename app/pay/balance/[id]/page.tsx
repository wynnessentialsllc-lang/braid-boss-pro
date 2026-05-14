"use client";

// Public-facing balance payment page.
//
// URL: /pay/balance/<appointment_id>
//
// Reads minimal display info via the public_get_balance_payment_info
// RPC (anon-callable, returns only the fields shown below — no
// notes, phone, email). On tap, POSTs to /api/balance-payment/checkout
// which creates a Stripe Checkout Session on the stylist's connected
// account and returns a URL; we redirect there.
//
// All branding matches the Braid Boss Pro cream/brown/gold language
// and the welcome / preview cards.

import { Suspense, use, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getSupabase } from "../../../lib/supabase";
import { formatAppointmentDate } from "../../../lib/utils/formatAppointmentDate";
import { trackEvent } from "../../../lib/track";

const C = {
  cream: "#FFFFFF",
  paper: "#FFFFFF",
  ivory: "#F6F2EC",
  espresso: "#2A1810",
  coffee: "#4A2C1A",
  gold: "#C9A961",
  goldDeep: "#A8893F",
  muted: "#8B7355",
  hairline: "rgba(74, 44, 26, 0.12)",
  success: "#5C7C4A",
  danger: "#9C3D2E",
} as const;
const FONT_DISPLAY = "'Cormorant Garamond', 'Playfair Display', Georgia, serif";

type PaymentInfo = {
  ok: true;
  id: string;
  stylist_name: string;
  studio_name: string;
  service_name: string | null;
  client_name: string | null;
  appt_date: string | null;
  appt_time: string | null;
  total_price: number | null;
  deposit_paid: number | null;
  balance_due: number | null;
  status: string | null;
  balance_paid: boolean;
  balance_paid_at: string | null;
  payment_status: string | null;
  is_cancelled: boolean;
} | { ok: false; reason: string };

const fmtMoney = (n: number | null | undefined): string => {
  const v = Number(n) || 0;
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const Shell = ({ children }: { children: React.ReactNode }) => (
  <div
    style={{
      minHeight: "100dvh",
      background: C.cream,
      color: C.espresso,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      paddingTop: "max(28px, env(safe-area-inset-top))",
      paddingBottom: "max(40px, calc(env(safe-area-inset-bottom) + 24px))",
      paddingLeft: 18,
      paddingRight: 18,
      display: "flex",
      flexDirection: "column",
      alignItems: "stretch",
    }}
  >
    <div style={{ width: "100%", maxWidth: 440, margin: "0 auto" }}>{children}</div>
  </div>
);

const Brand = ({ studio }: { studio?: string }) => {
  const cleanStudio = studio?.trim();
  return (
    <div style={{ textAlign: "center", marginBottom: 24 }}>
      {cleanStudio ? (
        <>
          <p style={{ margin: 0, fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 600, color: C.espresso, letterSpacing: "-0.005em", lineHeight: 1.1 }}>
            {cleanStudio}
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 9, fontWeight: 600, letterSpacing: "0.22em", textTransform: "uppercase", color: C.muted }}>
            powered by Braid Boss Pro
          </p>
        </>
      ) : (
        <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: "0.24em", textTransform: "uppercase", color: C.goldDeep }}>
          Braid Boss Pro
        </p>
      )}
    </div>
  );
};

const BalancePayInner = ({ id }: { id: string }) => {
  const params = useSearchParams();
  const [info, setInfo] = useState<PaymentInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isPaidQuery = params?.get("paid") === "1";
  const isCancelledQuery = params?.get("cancelled") === "1";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase.rpc("public_get_balance_payment_info", { appt_id_in: id });
        if (cancelled) return;
        if (error) { setErr(error.message); return; }
        setInfo(data as PaymentInfo);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Couldn't load this page.");
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // Show a success card if Stripe redirected here with ?paid=1 OR
  // if the server already says balance_paid. Server is the source of
  // truth — Stripe redirect is a hint, not authority.
  const showSuccess = info && info.ok && (info.balance_paid || isPaidQuery);

  const startCheckout = async () => {
    if (!info || !info.ok || busy) return;
    setBusy(true);
    setErr(null);
    try {
      trackEvent("balance_payment_started", { category: "feature", metadata: { id } });
      const res = await fetch("/api/balance-payment/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appointment_id: id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.url) {
        trackEvent("balance_payment_failed", { category: "error", metadata: { status: res.status } });
        setErr(body?.error || "Couldn't start checkout. Please try again.");
        setBusy(false);
        return;
      }
      window.location.assign(body.url);
    } catch (e: any) {
      trackEvent("balance_payment_failed", { category: "error", metadata: { reason: "network" } });
      setErr(e?.message || "Couldn't start checkout. Please try again.");
      setBusy(false);
    }
  };

  if (!info && !err) {
    return (
      <Shell>
        <Brand studio={info && (info as any).ok ? (info as any).studio_name : undefined} />
        <p style={{ textAlign: "center", color: C.muted, fontSize: 13 }}>Loading…</p>
      </Shell>
    );
  }

  if (err || (info && !info.ok)) {
    const reason = info && !info.ok ? info.reason : err;
    return (
      <Shell>
        <Brand studio={info && (info as any).ok ? (info as any).studio_name : undefined} />
        <div style={card}>
          <h1 style={{ ...h1, color: C.danger }}>We couldn&apos;t load this page.</h1>
          <p style={muted}>
            {reason === "not_found"
              ? "This payment link doesn't match an active appointment. Double-check with your stylist."
              : "Please refresh and try again, or contact your stylist."}
          </p>
        </div>
      </Shell>
    );
  }

  if (!info || !info.ok) return null;

  const when = formatAppointmentDate(info.appt_date, info.appt_time);
  const studio = info.studio_name || info.stylist_name || "your stylist";

  // ---- Success state ----
  if (showSuccess) {
    return (
      <Shell>
        <Brand studio={info && (info as any).ok ? (info as any).studio_name : undefined} />
        <div style={card}>
          <div style={{ textAlign: "center", marginBottom: 14 }}>
            <div style={{
              width: 64, height: 64, borderRadius: 99, margin: "0 auto 10px",
              background: "radial-gradient(circle, rgba(92,124,74,0.22) 0%, rgba(92,124,74,0) 70%)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: C.success, fontSize: 28,
            }}>✓</div>
            <h1 style={{ ...h1, color: C.espresso }}>Balance paid.</h1>
            <p style={muted}>
              You&apos;re all set with {studio}. A receipt is on the way.
            </p>
          </div>
          <Row label="Service" value={info.service_name || "—"} />
          {when && <Row label="Appointment" value={when} />}
          <Row label="Amount" value={fmtMoney((info.total_price || 0) - 0)} accent />
        </div>
      </Shell>
    );
  }

  // ---- Cancelled state (Stripe back-button) ----
  if (isCancelledQuery) {
    return (
      <Shell>
        <Brand studio={info && (info as any).ok ? (info as any).studio_name : undefined} />
        <div style={card}>
          <h1 style={h1}>Payment cancelled.</h1>
          <p style={muted}>No charge made. Tap below to try again.</p>
          <button type="button" style={primaryBtn} onClick={startCheckout} disabled={busy}>
            {busy ? "Working…" : `Pay ${fmtMoney(info.balance_due)} balance`}
          </button>
        </div>
      </Shell>
    );
  }

  // ---- Cancelled appointment ----
  if (info.is_cancelled) {
    return (
      <Shell>
        <Brand studio={info && (info as any).ok ? (info as any).studio_name : undefined} />
        <div style={card}>
          <h1 style={h1}>This appointment was cancelled.</h1>
          <p style={muted}>Reach out to {studio} if you think that&apos;s a mistake.</p>
        </div>
      </Shell>
    );
  }

  // ---- Nothing to collect ----
  const balance = Number(info.balance_due) || 0;
  if (balance <= 0) {
    return (
      <Shell>
        <Brand studio={info && (info as any).ok ? (info as any).studio_name : undefined} />
        <div style={card}>
          <h1 style={h1}>No balance to pay.</h1>
          <p style={muted}>Your appointment with {studio} is already settled.</p>
        </div>
      </Shell>
    );
  }

  // ---- Main pay state ----
  return (
    <Shell>
      <Brand studio={info && (info as any).ok ? (info as any).studio_name : undefined} />
      <div style={card}>
        <p style={eyebrow}>Balance due</p>
        <h1 style={{ ...h1, fontSize: 40, color: C.goldDeep }}>{fmtMoney(balance)}</h1>
        <p style={muted}>Pay your remaining balance with {studio}.</p>

        <div style={{ marginTop: 16, borderTop: `1px solid ${C.hairline}`, paddingTop: 12 }}>
          <Row label="Service" value={info.service_name || "Appointment"} />
          {when && <Row label="Appointment" value={when} />}
          {info.total_price ? <Row label="Total" value={fmtMoney(info.total_price)} /> : null}
          {info.deposit_paid ? <Row label="Deposit paid" value={`− ${fmtMoney(info.deposit_paid)}`} /> : null}
          <Row label="Balance due" value={fmtMoney(balance)} accent emphasis />
        </div>

        {err && <p style={{ color: C.danger, fontSize: 12, marginTop: 12 }}>{err}</p>}

        <button type="button" style={primaryBtn} onClick={startCheckout} disabled={busy}>
          {busy ? "Working…" : `Pay ${fmtMoney(balance)} balance`}
        </button>
        <p style={{ ...muted, fontSize: 11, textAlign: "center", marginTop: 10 }}>
          Secured by Stripe · Your card details never touch our servers.
        </p>
      </div>
    </Shell>
  );
};

// =====================================================================
// Inline style helpers (kept at bottom for readability).
// =====================================================================
const card: React.CSSProperties = {
  background: C.paper,
  border: `1px solid ${C.hairline}`,
  borderRadius: 22,
  padding: 22,
  boxShadow: "0 20px 40px -28px rgba(42,24,16,0.28), 0 2px 4px rgba(42,24,16,0.04)",
};
const h1: React.CSSProperties = {
  margin: "8px 0 4px",
  fontFamily: FONT_DISPLAY,
  fontSize: 30,
  fontWeight: 600,
  lineHeight: 1.1,
  letterSpacing: "-0.01em",
};
const eyebrow: React.CSSProperties = {
  margin: 0,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.22em",
  textTransform: "uppercase",
  color: C.goldDeep,
};
const muted: React.CSSProperties = {
  margin: "4px 0 0",
  fontSize: 13,
  color: C.muted,
  lineHeight: 1.55,
};
const primaryBtn: React.CSSProperties = {
  marginTop: 18,
  width: "100%",
  appearance: "none",
  WebkitAppearance: "none",
  border: "none",
  borderRadius: 999,
  padding: "16px 22px",
  background: C.espresso,
  color: C.cream,
  fontSize: 15,
  fontWeight: 600,
  letterSpacing: "0.02em",
  cursor: "pointer",
  minHeight: 52,
  boxShadow: "0 10px 22px rgba(42,24,16,0.18)",
  font: "inherit",
};

const Row = ({ label, value, accent, emphasis }: { label: string; value: React.ReactNode; accent?: boolean; emphasis?: boolean }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "5px 0", fontSize: emphasis ? 14 : 12.5, color: C.coffee }}>
    <span style={{ fontWeight: emphasis ? 700 : 500 }}>{label}</span>
    <span style={{
      fontFamily: emphasis ? FONT_DISPLAY : "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: emphasis ? 20 : 13,
      fontWeight: 600,
      color: accent ? C.goldDeep : C.espresso,
    }}>{value}</span>
  </div>
);

export default function BalancePayPage({ params }: { params: Promise<{ id: string }> }) {
  // Next 16 passes route params as a Promise — `use()` is the
  // canonical way to unwrap them in a Client Component.
  const { id } = use(params);
  return (
    <Suspense fallback={null}>
      <BalancePayInner id={id} />
    </Suspense>
  );
}
