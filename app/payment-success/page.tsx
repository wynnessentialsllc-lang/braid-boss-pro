"use client";

// Payment success landing page. Stripe redirects here after a Payment
// Link checkout completes:
//
//   https://braidbosspro.app/payment-success?session_id={CHECKOUT_SESSION_ID}
//
// We do NOT trust the URL alone. The page POSTs the session_id to
// /api/verify-payment, which retrieves the Checkout Session from Stripe
// using the secret key, confirms it was paid, and only then writes
// profiles.lifetime_access via the service role.

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabase } from "../lib/supabase";
import { cacheLifetimeAccess } from "../lib/premium";

const C = {
  espresso: "#15111A",
  coffee: "#3D3447",
  caramel: "#6F6477",
  cream: "#FFFFFF",
  ivory: "#F6F2EC",
  paper: "#FFFFFF",
  gold: "#7C3AED",
  goldDeep: "#5B21B6",
  muted: "#6F6477",
  hairline: "rgba(21, 17, 26, 0.12)",
  danger: "#9C3D2E",
};

const FONT_DISPLAY = `"Cormorant Garamond", Georgia, serif`;
const FONT_BODY = `"DM Sans", "Inter", system-ui, sans-serif`;

type Status = "verifying" | "activated" | "error";

function PaymentSuccessInner() {
  const router = useRouter();
  const params = useSearchParams();
  const sessionId = params.get("session_id");

  // Missing session id is derivable from the redirect URL, so seed the
  // error at init rather than via a synchronous setState in the effect
  // (which triggers a cascading re-render).
  const [status, setStatus] = useState<Status>(() =>
    sessionId ? "verifying" : "error",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(() =>
    sessionId ? null : "Missing session id in the redirect URL.",
  );

  useEffect(() => {
    if (!sessionId) return; // error already seeded via initial state
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabase();
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;
        if (!accessToken) {
          if (!cancelled) {
            setStatus("error");
            setErrorMessage(
              "Sign in with the same account you used at checkout, then refresh this page.",
            );
          }
          return;
        }
        const res = await fetch("/api/verify-payment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId, access_token: accessToken }),
        });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || !json?.ok) {
          setStatus("error");
          setErrorMessage(json?.error || `Verification failed (${res.status}).`);
          return;
        }
        // Cache the unlock locally so the main app shows premium
        // instantly when the user navigates back, even before the
        // Supabase select round-trip completes.
        const userId = sessionData.session?.user?.id;
        if (userId) cacheLifetimeAccess(userId, true);
        setStatus("activated");
      } catch (e: any) {
        if (cancelled) return;
        setStatus("error");
        setErrorMessage(e?.message || "Network error verifying payment.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return (
    <div
      className="min-h-dvh w-full flex items-center justify-center px-5 py-10"
      style={{
        background: `linear-gradient(180deg, ${C.cream} 0%, ${C.ivory} 100%)`,
        fontFamily: FONT_BODY,
        color: C.espresso,
      }}
    >
      <div
        className="w-full max-w-md rounded-3xl p-8"
        style={{
          background: C.paper,
          border: `1px solid ${C.hairline}`,
          boxShadow:
            "0 1px 2px rgba(21, 17, 26, 0.06), 0 24px 48px -16px rgba(21, 17, 26, 0.18)",
        }}
      >
        {status === "verifying" && (
          <>
            <Crest />
            <h1
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: 30,
                fontWeight: 600,
                color: C.espresso,
                marginTop: 18,
              }}
            >
              Confirming your payment…
            </h1>
            <p style={{ color: C.muted, fontSize: 14, marginTop: 8 }}>
              Hang tight — Stripe is finalising the receipt. This usually
              takes a moment.
            </p>
            <div
              style={{
                marginTop: 22,
                height: 4,
                width: "100%",
                borderRadius: 999,
                background: C.ivory,
                overflow: "hidden",
                position: "relative",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "40%",
                  background: `linear-gradient(90deg, ${C.gold}, ${C.goldDeep})`,
                  borderRadius: 999,
                  animation: "bbpVerifySlide 1.4s ease-in-out infinite",
                }}
              />
              <style>{`@keyframes bbpVerifySlide{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}`}</style>
            </div>
          </>
        )}

        {status === "activated" && (
          <>
            <Crest gold />
            <p
              style={{
                color: C.goldDeep,
                fontSize: 11,
                letterSpacing: "0.18em",
                fontWeight: 700,
                marginTop: 14,
                textTransform: "uppercase",
              }}
            >
              Lifetime Access Activated
            </p>
            <h1
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: 34,
                fontWeight: 600,
                lineHeight: 1.1,
                color: C.espresso,
                marginTop: 8,
              }}
            >
              Welcome to Braid Boss Pro.
            </h1>
            <p style={{ color: C.muted, fontSize: 14, marginTop: 12 }}>
              Your unlock is permanent and tied to your account — sign
              in on any device and the studio is yours.
            </p>
            <button
              type="button"
              onClick={() => router.push("/")}
              className="mt-7 w-full rounded-2xl py-3.5 text-[15px] font-semibold active:scale-[0.99] transition"
              style={{
                background: `linear-gradient(180deg, ${C.gold}, ${C.goldDeep})`,
                color: C.paper,
                border: `1px solid ${C.goldDeep}`,
                boxShadow: "0 8px 20px -10px rgba(91, 33, 182, 0.6)",
              }}
            >
              Continue to Studio
            </button>
          </>
        )}

        {status === "error" && (
          <>
            <Crest />
            <p
              style={{
                color: C.danger,
                fontSize: 11,
                letterSpacing: "0.18em",
                fontWeight: 700,
                marginTop: 14,
                textTransform: "uppercase",
              }}
            >
              Couldn&rsquo;t confirm payment
            </p>
            <h1
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: 28,
                fontWeight: 600,
                color: C.espresso,
                marginTop: 8,
              }}
            >
              We need another moment.
            </h1>
            <p style={{ color: C.muted, fontSize: 14, marginTop: 12 }}>
              {errorMessage ||
                "We couldn't verify the receipt yet. If you completed checkout, try again in a few seconds."}
            </p>
            <div className="flex gap-3 mt-7">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="flex-1 rounded-2xl py-3.5 text-[14px] font-semibold active:scale-[0.99] transition"
                style={{
                  background: `linear-gradient(180deg, ${C.gold}, ${C.goldDeep})`,
                  color: C.paper,
                  border: `1px solid ${C.goldDeep}`,
                }}
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => router.push("/")}
                className="flex-1 rounded-2xl py-3.5 text-[14px] font-semibold active:scale-[0.99] transition"
                style={{
                  background: C.ivory,
                  color: C.coffee,
                  border: `1px solid ${C.hairline}`,
                }}
              >
                Back to app
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Crest({ gold = false }: { gold?: boolean }) {
  return (
    <div
      aria-hidden
      style={{
        width: 56,
        height: 56,
        borderRadius: 999,
        display: "grid",
        placeItems: "center",
        background: gold
          ? `linear-gradient(180deg, ${C.gold}, ${C.goldDeep})`
          : C.ivory,
        border: `1px solid ${gold ? C.goldDeep : C.hairline}`,
        boxShadow: gold
          ? "0 6px 18px -8px rgba(91, 33, 182, 0.55)"
          : "none",
        color: gold ? C.paper : C.caramel,
        fontFamily: FONT_DISPLAY,
        fontSize: 26,
        fontWeight: 600,
        letterSpacing: "0.02em",
      }}
    >
      BB
    </div>
  );
}

export default function PaymentSuccessPage() {
  return (
    <Suspense
      fallback={
        <div
          className="min-h-dvh w-full flex items-center justify-center"
          style={{ background: C.cream, color: C.muted, fontFamily: FONT_BODY }}
        >
          Loading…
        </div>
      }
    >
      <PaymentSuccessInner />
    </Suspense>
  );
}
