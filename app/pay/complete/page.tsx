"use client";

// Client-facing landing after an in-person Boss Checkout card payment.
//
// This page is purely cosmetic: the stylist's app polls Stripe and records
// the sale, so there are NO side effects here. It just reassures the client
// that the card payment went through (or was cancelled). Reached via the
// success_url / cancel_url on /api/checkout-charge's Checkout Session.

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

const C = {
  espresso: "#15111A",
  coffee: "#3D3447",
  cream: "#FFFFFF",
  ivory: "#F6F2EC",
  gold: "#7C3AED",
  muted: "#6F6477",
  success: "#16A34A",
  hairline: "rgba(21, 17, 26, 0.12)",
};
const FONT_DISPLAY = `"Cormorant Garamond", Georgia, serif`;
const FONT_BODY = `"DM Sans", "Inter", system-ui, sans-serif`;

function CompleteInner() {
  const params = useSearchParams();
  const cancelled = params.get("cancelled") === "1";

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: C.ivory,
        fontFamily: FONT_BODY,
      }}
    >
      <div
        style={{
          maxWidth: 380,
          width: "100%",
          background: C.cream,
          borderRadius: 20,
          border: `1px solid ${C.hairline}`,
          padding: 32,
          textAlign: "center",
        }}
      >
        <div
          aria-hidden
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            margin: "0 auto 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: cancelled ? "rgba(156,61,46,0.12)" : "rgba(22,163,74,0.12)",
            color: cancelled ? "#9C3D2E" : C.success,
            fontSize: 28,
            fontWeight: 700,
          }}
        >
          {cancelled ? "×" : "✓"}
        </div>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 28, fontWeight: 600, color: C.espresso, margin: "0 0 8px" }}>
          {cancelled ? "Payment cancelled" : "Payment received"}
        </h1>
        <p style={{ fontSize: 14, color: C.muted, margin: 0, lineHeight: 1.5 }}>
          {cancelled
            ? "No charge was made. You can hand the phone back to your stylist to try again."
            : "Thank you! Your payment went through. You can hand the phone back to your stylist."}
        </p>
      </div>
    </main>
  );
}

export default function CheckoutPaymentCompletePage() {
  return (
    <Suspense fallback={null}>
      <CompleteInner />
    </Suspense>
  );
}
