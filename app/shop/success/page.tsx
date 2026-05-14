"use client";

// Post-checkout return page for storefront product purchases.
// Stripe redirects here with ?session_id=... after a successful
// payment. We render a confirmation card and a CTA back to the
// stylist's shop so the visitor can keep browsing.

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const C = {
  cream: "#FFFFFF",
  brandText: "#15111A",
  brandPrimary: "#7C3AED",
  brandPrimaryDeep: "#5B21B6",
  brandSecondary: "#FF4D6D",
  brandBorder: "#ECE7F2",
  brandSuccess: "#22C55E",
  muted: "#6F6477",
};

const FONT_DISPLAY = `"Cormorant Garamond", Georgia, serif`;

const GRADIENTS = {
  primary: "linear-gradient(135deg, #7C3AED 0%, #FF4D6D 100%)",
};

const SHADOWS = {
  primaryGlow:
    "0 10px 28px -10px rgba(124, 58, 237, 0.45), 0 4px 12px -4px rgba(255, 77, 109, 0.30)",
  card: "0 4px 14px rgba(21, 17, 26, 0.06)",
};

function ShopSuccessInner() {
  const router = useRouter();
  const params = useSearchParams();
  const sessionId = params?.get("session_id") || null;
  const handle = useMemo(() => {
    const raw = params?.get("handle") || "";
    return raw.replace(/^@/, "");
  }, [params]);

  // We don't fetch the order here — RLS would require auth and this
  // is the customer's browser, not the stylist's. The session_id is
  // shown for support purposes and the success message is rendered
  // optimistically; the webhook is the source of truth and runs
  // independently.
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setRevealed(true), 50);
    return () => clearTimeout(id);
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: C.cream,
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
    >
      <div
        className="max-w-[420px] w-full rounded-3xl p-7 text-center"
        style={{
          background: "#FFFFFF",
          border: `1px solid ${C.brandBorder}`,
          boxShadow: SHADOWS.card,
          opacity: revealed ? 1 : 0,
          transform: revealed ? "translateY(0)" : "translateY(8px)",
          transition: "opacity 320ms ease, transform 320ms ease",
        }}
      >
        <div
          aria-hidden
          style={{
            width: 64,
            height: 64,
            borderRadius: 9999,
            background: GRADIENTS.primary,
            display: "grid",
            placeItems: "center",
            margin: "0 auto 16px",
            boxShadow: SHADOWS.primaryGlow,
            color: "#FFFFFF",
            fontSize: 30,
            fontWeight: 700,
          }}
        >
          ✓
        </div>
        <h1
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 28,
            fontWeight: 600,
            color: C.brandText,
            lineHeight: 1.1,
          }}
        >
          Thank you for your order!
        </h1>
        <p className="mt-2" style={{ color: C.muted, fontSize: 14 }}>
          Your payment was received. The stylist will follow up with shipping
          or pickup details by email.
        </p>
        {sessionId && (
          <p
            className="mt-3 text-[11px]"
            style={{ color: C.muted, wordBreak: "break-all" }}
          >
            Order ref: {sessionId}
          </p>
        )}
        <div className="mt-5 flex flex-col gap-2">
          {handle && (
            <button
              type="button"
              onClick={() => router.push(`/@${encodeURIComponent(handle)}/shop`)}
              className="rounded-2xl px-4 py-3 text-[13px] font-bold uppercase tracking-widest active:scale-[0.98] transition"
              style={{
                background: GRADIENTS.primary,
                color: "#FFFFFF",
                boxShadow: SHADOWS.primaryGlow,
                letterSpacing: "0.12em",
                border: 0,
              }}
            >
              Keep shopping
            </button>
          )}
          {handle && (
            <button
              type="button"
              onClick={() => router.push(`/@${encodeURIComponent(handle)}`)}
              className="rounded-2xl px-4 py-2.5 text-[12px] font-bold uppercase tracking-widest"
              style={{
                background: "transparent",
                color: C.brandPrimary,
                border: `1.5px solid ${C.brandPrimary}`,
                letterSpacing: "0.12em",
              }}
            >
              Back to profile
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ShopSuccessPage() {
  // useSearchParams requires a Suspense boundary in the app router
  // when used inside a client component. Wrap so the build succeeds.
  return (
    <Suspense
      fallback={
        <div
          style={{
            minHeight: "100vh",
            background: C.cream,
            display: "grid",
            placeItems: "center",
            color: C.muted,
          }}
        >
          Loading…
        </div>
      }
    >
      <ShopSuccessInner />
    </Suspense>
  );
}
