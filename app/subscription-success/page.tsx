"use client";

// Landing page after a successful subscription checkout. Stripe
// redirects here with ?session_id=… The subscription itself is
// activated server-side by /api/subscribe/webhook (checkout.session.completed),
// so this page is purely a confirmation + a way back into the app.
// Access flips on automatically once the webhook stamps the profile;
// the in-app premium hooks re-check on focus.

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

const C = {
  espresso: "#1F140A",
  coffee: "#4A2C1A",
  cream: "#FAF6EE",
  paper: "#FFFFFF",
  hairline: "#E9DFC8",
  muted: "#9A8B72",
  gold: "#C9A961",
  goldDeep: "#A8893F",
  success: "#5C7C4A",
};

function SubscriptionSuccessInner() {
  const params = useSearchParams();
  const sessionId = params.get("session_id") || "";

  return (
    <div style={{ minHeight: "100dvh", background: C.cream, color: C.espresso, fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" }}>
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "48px 22px" }}>
        <p style={{ textAlign: "center", letterSpacing: "0.22em", textTransform: "uppercase", fontSize: 10, fontWeight: 700, color: C.goldDeep }}>
          Braid Boss Pro
        </p>

        <div
          style={{
            marginTop: 20,
            padding: 28,
            borderRadius: 18,
            background: C.paper,
            border: `1px solid ${C.hairline}`,
            boxShadow: "0 1px 4px rgba(31,20,10,0.04)",
            textAlign: "center",
          }}
        >
          <div
            aria-hidden
            style={{
              width: 56, height: 56, borderRadius: 999, margin: "0 auto 14px",
              display: "grid", placeItems: "center",
              background: "rgba(92,124,74,0.12)", color: C.success, fontSize: 28,
            }}
          >
            ✓
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: C.espresso }}>
            Your free trial is on.
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.55, color: C.coffee, marginTop: 10 }}>
            Every feature is unlocked. You won&apos;t be charged for 14 days — then
            it&apos;s just <strong>$14.99/month</strong>. You can cancel anytime from
            <strong> Settings → Subscription</strong>.
          </p>

          <Link
            href="/"
            style={{
              display: "inline-block", marginTop: 22, padding: "14px 26px",
              borderRadius: 999, background: C.espresso, color: C.cream,
              textDecoration: "none", fontWeight: 600, fontSize: 14, letterSpacing: "0.04em",
            }}
          >
            Open Braid Boss Pro
          </Link>

          {sessionId && (
            <p style={{ fontSize: 11, color: C.muted, marginTop: 18, wordBreak: "break-all" }}>
              Receipt reference: {sessionId}
            </p>
          )}
        </div>

        <p style={{ fontSize: 12, color: C.muted, textAlign: "center", marginTop: 16, lineHeight: 1.5 }}>
          If your access doesn&apos;t show right away, pull the app back into focus —
          it re-checks automatically.
        </p>
      </div>
    </div>
  );
}

export default function SubscriptionSuccessPage() {
  return (
    <Suspense fallback={null}>
      <SubscriptionSuccessInner />
    </Suspense>
  );
}
