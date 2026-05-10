"use client";

// /settings/payments — Stripe Connect Express management screen.
//
// URL contract:
//   ?stripe_return=true → Stripe sent the stylist back after onboarding.
//                         Sync charges_enabled / payouts_enabled /
//                         details_submitted from Stripe and update the
//                         UI to reflect the result.
//   ?refresh=true       → Stripe's onboarding link expired. Kick off
//                         a brand new accountLinks.create flow.
//   (legacy: ?connect=ok / ?connect=refresh are also honoured for any
//   onboarding links issued before the URL rename.)
//
// Mobile-first; matches the booking-page palette so the visual
// language carries over from the public side of the app.

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  STATUS_LABEL,
  STATUS_TONE,
  useStripeConnect,
  type ConnectStatus,
} from "../../lib/stripe-connect";
import { getSupabase } from "../../lib/supabase";

const C = {
  espresso: "#2A1810", coffee: "#4A2C1A", cream: "#FAF5EC",
  ivory: "#F5EBD9", paper: "#FFFBF2", gold: "#C9A961", goldDeep: "#A8893F",
  muted: "#8B7355", hairline: "rgba(74, 44, 26, 0.12)",
  success: "#5C7C4A", warning: "#B8860B", danger: "#9C3D2E",
};
const FONT_DISPLAY = `"Cormorant Garamond", Georgia, serif`;
const FONT_BODY = `"DM Sans", "Inter", system-ui, sans-serif`;

const toneColor = (tone: "neutral" | "gold" | "success" | "warning" | "danger") => {
  switch (tone) {
    case "success": return C.success;
    case "warning": return C.warning;
    case "danger":  return C.danger;
    case "gold":    return C.goldDeep;
    default:        return C.muted;
  }
};

export default function PaymentsPage() {
  return (
    <Suspense fallback={<Shell loading />}>
      <PaymentsInner />
    </Suspense>
  );
}

function PaymentsInner() {
  const router = useRouter();
  const params = useSearchParams();
  // URL contract: Stripe returns the stylist here with either
  // ?stripe_return=true (onboarding completed) or ?refresh=true
  // (link expired, needs a fresh one). The legacy ?connect=ok /
  // ?connect=refresh values are accepted as fallbacks so any in-
  // flight links issued before the URL rename still work.
  const stripeReturn = !!(
    params?.get("stripe_return") === "true" ||
    params?.get("connect") === "ok"
  );
  const stripeRefresh = !!(
    params?.get("refresh") === "true" ||
    params?.get("connect") === "refresh"
  );
  const [userId, setUserId] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

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

  const connect = useStripeConnect(userId);
  const status: ConnectStatus = connect.profile.stripe_connect_status;
  const tone = STATUS_TONE[status];

  // On return from Stripe onboarding, pull the latest account state
  // (charges_enabled / payouts_enabled / details_submitted) and
  // mirror it into profiles so the UI flips to "Active" without
  // waiting for the next manual refresh.
  useEffect(() => {
    if (!userId) return;
    if (!stripeReturn) return;
    void connect.syncFromStripe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, stripeReturn]);

  // If Stripe sent us back via the refresh_url (link expired), kick
  // off a brand-new onboarding flow immediately.
  useEffect(() => {
    if (!userId) return;
    if (!stripeRefresh) return;
    void (async () => {
      const url = await connect.startOnboarding();
      if (url && typeof window !== "undefined") {
        window.location.assign(url);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, stripeRefresh]);

  const [launching, setLaunching] = useState(false);

  // Detect the platform-side blocker: Stripe refuses to create
  // connected accounts until the platform owner accepts the Connect
  // responsibilities in the Stripe dashboard. We surface a friendly
  // "we're finalizing setup" message to the stylist — the actual
  // platform-profile URL belongs to the platform owner and is NOT
  // shown to stylists.
  const platformSetupIncomplete = useMemo(() => {
    const msg = (connect.error || "").toLowerCase();
    if (!msg) return false;
    return msg.includes("platform-profile")
      || msg.includes("responsibilities")
      || msg.includes("review the responsibilities");
  }, [connect.error]);

  const handleStartOnboarding = useCallback(async () => {
    if (launching || platformSetupIncomplete) return;
    setLaunching(true);
    const url = await connect.startOnboarding();
    if (url && typeof window !== "undefined") {
      window.location.assign(url);
      return;
    }
    setLaunching(false);
  }, [connect, launching, platformSetupIncomplete]);

  const buttonLabel = useMemo(() => {
    if (launching) return "Opening Stripe…";
    if (status === "not_connected") return "Connect Stripe";
    if (status === "onboarding") return "Continue onboarding";
    if (status === "restricted") return "Resolve in Stripe";
    if (status === "disabled") return "Reconnect Stripe";
    return "Open Stripe onboarding";
  }, [status, launching]);

  if (!authChecked) {
    return <Shell loading />;
  }
  if (!userId) {
    return (
      <Shell>
        <p style={{ fontSize: 14, color: C.coffee, textAlign: "center" }}>
          Sign in to manage Stripe Connect.
        </p>
        <button
          type="button"
          onClick={() => router.push("/")}
          style={primaryButtonStyle}
        >
          Back to app
        </button>
      </Shell>
    );
  }

  return (
    <Shell>
      <div
        style={{
          padding: 16,
          borderRadius: 14,
          background: C.cream,
          border: `1px solid ${C.hairline}`,
        }}
      >
        <p
          style={{
            fontSize: 10, fontWeight: 700, textTransform: "uppercase",
            letterSpacing: "0.12em", color: toneColor(tone),
          }}
        >
          {STATUS_LABEL[status]}
        </p>
        <p style={{ fontSize: 14, color: C.coffee, marginTop: 6, lineHeight: 1.5 }}>
          {status === "active"
            ? "Deposits flow straight into your Stripe account. Clients see your studio name on their card statement."
            : status === "onboarding"
            ? "Finish a few quick Stripe steps to start collecting deposits."
            : status === "restricted"
            ? "Stripe needs a little more info before they can release payouts. Tap below to finish."
            : status === "disabled"
            ? "Your Stripe account was disconnected. Reconnect to start collecting deposits again."
            : "Connect your own Stripe account so deposits land directly with you."}
        </p>

        {status === "active" && (
          <div style={{ marginTop: 12, display: "grid", gap: 4, fontSize: 12, color: C.muted }}>
            <CheckRow ok>Card payments enabled</CheckRow>
            <CheckRow ok={connect.profile.stripe_connect_payouts_enabled}>
              Payouts {connect.profile.stripe_connect_payouts_enabled ? "enabled" : "pending"}
            </CheckRow>
          </div>
        )}
      </div>

      {/* Primary CTA — disabled while the platform side is incomplete
          so the stylist can't bash their head against an opaque
          Stripe error. The warning block below tells them what to do. */}
      <button
        type="button"
        onClick={handleStartOnboarding}
        disabled={launching || status === "active" || platformSetupIncomplete}
        style={{
          ...primaryButtonStyle,
          opacity: status === "active" || launching || platformSetupIncomplete ? 0.55 : 1,
          cursor: status === "active" || launching || platformSetupIncomplete ? "default" : "pointer",
        }}
      >
        {buttonLabel}
      </button>

      {platformSetupIncomplete && (
        <p
          style={{
            margin: "-4px 0 0",
            textAlign: "center",
            fontSize: 11,
            fontWeight: 600,
            color: C.warning,
            letterSpacing: "0.04em",
          }}
        >
          Platform setup incomplete
        </p>
      )}

      <button
        type="button"
        onClick={() => void connect.syncFromStripe()}
        style={ghostButtonStyle}
      >
        Refresh status
      </button>

      {platformSetupIncomplete ? (
        <div
          style={{
            padding: 14,
            borderRadius: 14,
            background: "rgba(184, 134, 11, 0.08)",
            border: `1px solid rgba(184, 134, 11, 0.35)`,
            display: "grid",
            gap: 8,
          }}
        >
          <p style={{ fontSize: 13, color: C.coffee, lineHeight: 1.5 }}>
            Stripe Connect is being finalized for Braid Boss Pro. We&apos;ll
            notify you the moment onboarding is ready — usually within a
            business day.
          </p>
          <p style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>
            Already finished onboarding on a different device? Tap
            <strong> Refresh status </strong>
            above to pick up the change.
          </p>
        </div>
      ) : connect.error ? (
        <p style={{ fontSize: 12, color: C.danger }}>{connect.error}</p>
      ) : null}

      <p style={{ fontSize: 11, color: C.muted, textAlign: "center", lineHeight: 1.5 }}>
        Stripe collects deposits as direct charges on your account.
        {process.env.NEXT_PUBLIC_PLATFORM_FEE_NOTE
          ? ` ${process.env.NEXT_PUBLIC_PLATFORM_FEE_NOTE}`
          : ""}
      </p>

      <button type="button" onClick={() => router.push("/")} style={subtleButtonStyle}>
        Back to app
      </button>
    </Shell>
  );
}

function Shell({ children, loading }: { children?: React.ReactNode; loading?: boolean }) {
  return (
    <div style={{ minHeight: "100dvh", background: C.cream, fontFamily: FONT_BODY, color: C.espresso }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=DM+Sans:wght@400;500;600;700&display=swap');
        body { margin: 0; }
      `}</style>
      <div className="mx-auto" style={{ maxWidth: 480, padding: "32px 20px", paddingBottom: "calc(40px + env(safe-area-inset-bottom, 0px))" }}>
        <p style={{ textAlign: "center", letterSpacing: "0.22em", textTransform: "uppercase", fontSize: 10, fontWeight: 700, color: C.gold }}>
          Payments
        </p>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 32, fontWeight: 600, color: C.espresso, textAlign: "center", lineHeight: 1.1, marginTop: 8 }}>
          Stripe Connect
        </h1>
        <p style={{ fontSize: 13, color: C.muted, textAlign: "center", marginTop: 6, lineHeight: 1.5 }}>
          Take deposits directly into your own Stripe account.
        </p>
        <div style={{ marginTop: 28, display: "grid", gap: 12 }}>
          {loading ? (
            <p style={{ fontSize: 13, color: C.muted, textAlign: "center" }}>Loading…</p>
          ) : children}
        </div>
      </div>
    </div>
  );
}

const primaryButtonStyle: React.CSSProperties = {
  padding: "14px 16px",
  borderRadius: 14,
  background: `linear-gradient(180deg, ${C.gold}, ${C.goldDeep})`,
  color: C.paper,
  border: `1px solid ${C.goldDeep}`,
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
  minHeight: 48,
};

const ghostButtonStyle: React.CSSProperties = {
  padding: "12px 16px",
  borderRadius: 12,
  background: C.paper,
  color: C.coffee,
  border: `1px solid ${C.hairline}`,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  minHeight: 44,
};

const subtleButtonStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  background: "transparent",
  color: C.muted,
  border: 0,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

function CheckRow({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span
        aria-hidden
        style={{
          width: 14, height: 14, borderRadius: 999,
          background: ok ? C.success : C.hairline,
          display: "inline-block",
        }}
      />
      <span style={{ color: ok ? C.coffee : C.muted }}>{children}</span>
    </span>
  );
}
