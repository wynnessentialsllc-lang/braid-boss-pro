"use client";

// Stripe success landing. Reached via Checkout Session's success_url:
//   https://braidbosspro.app/unlocked?session_id={CHECKOUT_SESSION_ID}
//
// Flow on mount:
//   1. Read session_id from the URL.
//   2. Wait for the auth session to hydrate (Supabase persists across
//      the Stripe redirect because we use the same domain).
//   3. Call verify-checkout-session — this asks Stripe directly if
//      paid, and as a side-effect backfills profiles.is_pro_user if
//      the webhook hasn't yet.
//   4. Poll profiles.is_pro_user every 1.5s until true OR 12s elapse.
//   5. On success: show the celebration UI, then redirect home.
//   6. On timeout: show the graceful "still syncing" state with a
//      Try again button + a link to dashboard.

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabase } from "../lib/supabase";
import { fetchProStatus, verifyCheckoutSession } from "../lib/pro-status";

type Phase = "verifying" | "syncing" | "success" | "syncing_failed" | "no_session";

const C = {
  espresso: "#2A1810", coffee: "#4A2C1A",
  cream: "#FAF5EC", ivory: "#F5EBD9", paper: "#FFFBF2",
  gold: "#C9A961", goldDeep: "#A8893F",
  muted: "#8B7355", hairline: "rgba(74, 44, 26, 0.12)",
  success: "#5C7C4A", danger: "#9C3D2E",
};
const FONT_DISPLAY = `"Cormorant Garamond", Georgia, serif`;

const POLL_INTERVAL_MS = 1500;
const TIMEOUT_MS = 12_000;
const SUCCESS_REDIRECT_DELAY_MS = 2200;

export default function UnlockedPage() {
  return (
    <Suspense fallback={<UnlockedShell><SyncingView /></UnlockedShell>}>
      <UnlockedInner />
    </Suspense>
  );
}

function UnlockedInner() {
  const router = useRouter();
  const params = useSearchParams();
  const sessionId = params?.get("session_id") || null;

  const [phase, setPhase] = useState<Phase>(sessionId ? "verifying" : "no_session");
  const [attempts, setAttempts] = useState(0);
  const stopRef = useRef(false);

  const runVerification = async () => {
    if (!sessionId) return;
    stopRef.current = false;
    setPhase("verifying");
    setAttempts((n) => n + 1);

    // 1. Wait for the auth session.
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      // The redirect should preserve the session via cookie. If not,
      // fall through to "syncing" — verify-checkout-session needs a
      // bearer token, but the user can also tap Back to dashboard
      // and the Restore access button there will pick them up.
      setPhase("syncing_failed");
      return;
    }

    // 2. Defense-in-depth: ask Stripe whether this session is paid.
    //    The verify endpoint also backfills profiles if the webhook
    //    hasn't fired yet.
    try {
      await verifyCheckoutSession(sessionId);
    } catch {
      // Verification failure is non-fatal — the webhook may still
      // land it. Move on to polling.
    }

    // 3. Poll until is_pro_user flips, or timeout.
    setPhase("syncing");
    const start = Date.now();
    while (!stopRef.current && Date.now() - start < TIMEOUT_MS) {
      const status = await fetchProStatus(user.id);
      if (status.isPro) {
        setPhase("success");
        return;
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    if (!stopRef.current) setPhase("syncing_failed");
  };

  useEffect(() => {
    void runVerification();
    return () => { stopRef.current = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // After success, redirect home.
  useEffect(() => {
    if (phase !== "success") return;
    const t = setTimeout(() => router.push("/"), SUCCESS_REDIRECT_DELAY_MS);
    return () => clearTimeout(t);
  }, [phase, router]);

  return (
    <UnlockedShell>
      {phase === "verifying" || phase === "syncing" ? (
        <SyncingView />
      ) : phase === "success" ? (
        <SuccessView />
      ) : phase === "syncing_failed" ? (
        <SyncFailView onRetry={runVerification} />
      ) : (
        <NoSessionView />
      )}
    </UnlockedShell>
  );
}

const UnlockedShell = ({ children }: { children: React.ReactNode }) => (
  <div style={{
    minHeight: "100dvh",
    background: `radial-gradient(1200px 600px at 50% 0%, rgba(201,169,97,0.18) 0%, ${C.cream} 60%, ${C.ivory} 100%)`,
    fontFamily: "'DM Sans', system-ui, sans-serif",
    color: C.espresso,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "calc(env(safe-area-inset-top, 0px) + 32px) 20px 32px",
  }}>
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=DM+Sans:wght@400;500;600;700&display=swap');
      @keyframes bbpHaloPulse {
        0%, 100% { transform: scale(1); opacity: 0.55; }
        50% { transform: scale(1.07); opacity: 0.85; }
      }
      @keyframes bbpFadeUp {
        from { opacity: 0; transform: translateY(8px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      @keyframes bbpSpin { to { transform: rotate(360deg); } }
      .bbp-fade { animation: bbpFadeUp 0.6s cubic-bezier(.2,.8,.2,1) both; }
    `}</style>
    <main className="bbp-fade" style={{ maxWidth: 460, width: "100%", textAlign: "center" }}>
      {children}
    </main>
  </div>
);

// ---------------------------------------------------------------------

const Halo = ({ children }: { children: React.ReactNode }) => (
  <div style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
    <div style={{
      position: "absolute",
      width: 180,
      height: 180,
      borderRadius: "50%",
      background: `radial-gradient(circle, rgba(201,169,97,0.55) 0%, rgba(201,169,97,0) 70%)`,
      animation: "bbpHaloPulse 2.4s ease-in-out infinite",
      pointerEvents: "none",
    }} />
    <div style={{
      width: 96,
      height: 96,
      borderRadius: "50%",
      background: `linear-gradient(135deg, ${C.paper} 0%, ${C.ivory} 60%, rgba(201,169,97,0.35) 100%)`,
      border: `1px solid ${C.hairline}`,
      boxShadow: "0 14px 40px -14px rgba(168,137,63,0.45)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 40,
      position: "relative",
    }}>
      {children}
    </div>
  </div>
);

const KickerLabel = ({ tone, children }: { tone: string; children: React.ReactNode }) => (
  <p style={{
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.22em",
    textTransform: "uppercase",
    color: tone,
    marginBottom: 12,
  }}>
    {children}
  </p>
);

const SyncingView = () => (
  <>
    <Halo>
      <div style={{
        width: 38, height: 38, borderRadius: "50%",
        border: `3px solid ${C.hairline}`,
        borderTopColor: C.goldDeep,
        animation: "bbpSpin 1.1s linear infinite",
      }} />
    </Halo>
    <KickerLabel tone={C.goldDeep}><span style={{ marginTop: 28, display: "inline-block" }}>Lifetime · $9.99</span></KickerLabel>
    <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 36, fontWeight: 600, lineHeight: 1.1, margin: "0 0 12px" }}>
      Confirming your unlock
    </h1>
    <p style={{ color: C.coffee, fontSize: 14, lineHeight: 1.5, maxWidth: 360, margin: "0 auto" }}>
      Securely verifying your payment with Stripe and lighting up the rest of your studio. This usually takes a few seconds.
    </p>
  </>
);

const SuccessView = () => (
  <>
    <Halo>
      <span style={{ filter: "drop-shadow(0 4px 8px rgba(168,137,63,0.4))" }}>✨</span>
    </Halo>
    <div style={{ marginTop: 28 }}>
      <KickerLabel tone={C.success}>Lifetime · Active</KickerLabel>
    </div>
    <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 40, fontWeight: 600, lineHeight: 1.05, margin: "0 0 14px" }}>
      You&apos;re unlocked
    </h1>
    <p style={{ color: C.coffee, fontSize: 15, lineHeight: 1.5, maxWidth: 380, margin: "0 auto 24px" }}>
      Lifetime access is active. Unlimited clients, appointments, quotes, cloud sync, reminders — and every future upgrade.
    </p>
    <a
      href="/"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "12px 20px",
        borderRadius: 14,
        background: C.espresso,
        color: C.cream,
        textDecoration: "none",
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        boxShadow: "0 8px 24px -10px rgba(42,24,16,0.4)",
      }}>
      Open the studio →
    </a>
    <p style={{ marginTop: 18, fontSize: 11, color: C.muted, letterSpacing: "0.04em" }}>
      Returning you home in a moment…
    </p>
  </>
);

const SyncFailView = ({ onRetry }: { onRetry: () => void }) => (
  <>
    <Halo>
      <span>⏳</span>
    </Halo>
    <div style={{ marginTop: 28 }}>
      <KickerLabel tone={C.goldDeep}>Lifetime · $9.99</KickerLabel>
    </div>
    <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 32, fontWeight: 600, lineHeight: 1.1, margin: "0 0 12px" }}>
      Payment received, access is still syncing
    </h1>
    <p style={{ color: C.coffee, fontSize: 14, lineHeight: 1.55, maxWidth: 380, margin: "0 auto 24px" }}>
      Stripe confirmed your payment, but our backend hasn&apos;t finished registering it yet. This sometimes takes a few extra seconds. Try again, or open the dashboard and use Settings → Restore access.
    </p>
    <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
      <button
        type="button"
        onClick={onRetry}
        style={{
          padding: "12px 20px",
          borderRadius: 14,
          background: C.espresso,
          color: C.cream,
          border: 0,
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          cursor: "pointer",
        }}>
        Try again
      </button>
      <a href="/" style={{ color: C.coffee, fontSize: 13, fontWeight: 600, textDecoration: "none" }}>
        Take me to the dashboard
      </a>
      <p style={{ fontSize: 11, color: C.muted, marginTop: 12 }}>
        Still stuck? Email <a href="mailto:hello@hairwellnessslab.com" style={{ color: C.goldDeep }}>hello@hairwellnessslab.com</a> with your receipt.
      </p>
    </div>
  </>
);

const NoSessionView = () => (
  <>
    <Halo><span>🔒</span></Halo>
    <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 32, fontWeight: 600, lineHeight: 1.1, margin: "28px 0 12px" }}>
      No checkout session in this URL
    </h1>
    <p style={{ color: C.coffee, fontSize: 14, lineHeight: 1.5, maxWidth: 360, margin: "0 auto 20px" }}>
      You probably arrived here by mistake. Open the dashboard and tap any locked feature to start a checkout.
    </p>
    <a
      href="/"
      style={{
        display: "inline-flex",
        padding: "12px 20px",
        borderRadius: 14,
        background: C.espresso,
        color: C.cream,
        textDecoration: "none",
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
      }}>
      Open the dashboard
    </a>
  </>
);
