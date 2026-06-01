"use client";

// Founding Stylist Access — post-checkout success page.
//
// Stripe redirects here from the /api/founding-checkout success_url
// with ?session_id=…. We don't fetch the order details (Stripe
// dashboard is the source of truth for the MVP) — instead we
// confirm receipt and route the customer to create their account
// with the same email they used at checkout. A follow-up PR will
// wire the auto-claim webhook so the account is granted founding
// access on sign-up without manual reconciliation.

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, ArrowRight, Sparkles } from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, GRADIENTS, SHADOWS } from "../components/marketing/tokens";

function FoundingSuccessInner() {
  const router = useRouter();
  const params = useSearchParams();
  const sessionId = params?.get("session_id") || null;

  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    document.title = "Welcome, Founding Stylist · Braid Boss Pro";
    const id = setTimeout(() => setRevealed(true), 50);
    return () => clearTimeout(id);
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: C.paper,
        color: C.ink,
        fontFamily: FONT_BODY,
        WebkitFontSmoothing: "antialiased",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=DM+Sans:wght@400;500;600;700;800&display=swap');
      `}</style>

      <section
        style={{
          flex: 1,
          display: "grid",
          placeItems: "center",
          padding: "48px 20px",
        }}
      >
        <div
          className="max-w-[520px] w-full text-center"
          style={{
            background: C.paper,
            borderRadius: 28,
            border: `1px solid ${C.brandBorder}`,
            boxShadow: SHADOWS.cardLifted,
            padding: "40px 28px",
            opacity: revealed ? 1 : 0,
            transform: revealed ? "translateY(0)" : "translateY(10px)",
            transition: "opacity 360ms ease, transform 360ms ease",
          }}
        >
          <div
            aria-hidden
            style={{
              width: 64,
              height: 64,
              borderRadius: 9999,
              background: GRADIENTS.primary,
              color: "#FFFFFF",
              display: "grid",
              placeItems: "center",
              margin: "0 auto 18px",
              boxShadow: SHADOWS.primaryGlow,
            }}
          >
            <Check size={28} strokeWidth={3} />
          </div>

          <p
            style={{
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: C.brandPrimary,
              margin: 0,
            }}
          >
            Founding access · confirmed
          </p>
          <h1
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 700,
              fontSize: 32,
              color: C.ink,
              margin: "10px 0 6px",
              lineHeight: 1.1,
              letterSpacing: "-0.01em",
            }}
          >
            Welcome to Braid Boss Pro.
          </h1>
          <p style={{ color: "#3D3447", fontSize: 15, lineHeight: 1.6, marginTop: 8 }}>
            Your one-time payment is in. The last step is creating your
            account with the same email you used at checkout — that&apos;s how
            your founding access lands on your stylist profile.
          </p>

          <ol
            style={{
              listStyle: "none",
              padding: 0,
              margin: "24px 0 0",
              display: "flex",
              flexDirection: "column",
              gap: 12,
              textAlign: "left",
            }}
          >
            <NextStep
              n={1}
              title="Create your account"
              body="Use the same email you just paid with so we can attach your founding access."
            />
            <NextStep
              n={2}
              title="Connect Stripe"
              body="Settings → Payments → Connect Stripe. Direct charges land in your own account."
            />
            <NextStep
              n={3}
              title="Share your /@handle"
              body="Set a branded handle in the customize sheet and drop your link in your bios."
            />
          </ol>

          <Link
            href="/?signup=1"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              width: "100%",
              marginTop: 24,
              padding: "15px 22px",
              borderRadius: 16,
              background: GRADIENTS.primary,
              color: "#FFFFFF",
              fontSize: 14,
              fontWeight: 800,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              textDecoration: "none",
              boxShadow: SHADOWS.primaryGlow,
            }}
          >
            Create my account <ArrowRight size={16} aria-hidden />
          </Link>

          {sessionId && (
            <p
              style={{
                marginTop: 18,
                fontSize: 11,
                color: C.mutedSoft,
                wordBreak: "break-all",
              }}
            >
              Receipt ref: {sessionId}
            </p>
          )}
          <p style={{ marginTop: 6, fontSize: 11, color: C.mutedSoft, lineHeight: 1.5 }}>
            A Stripe receipt also landed in your inbox. Questions?{" "}
            <a
              href="mailto:hello@braidbosspro.app"
              style={{ color: C.brandPrimary, fontWeight: 700, textDecoration: "none" }}
            >
              hello@braidbosspro.app
            </a>
          </p>
        </div>
      </section>
    </div>
  );
}

const NextStep = ({ n, title, body }: { n: number; title: string; body: string }) => (
  <li
    style={{
      display: "flex",
      gap: 12,
      alignItems: "flex-start",
      padding: 14,
      borderRadius: 14,
      background: "#FBFAFD",
      border: `1px solid ${C.brandBorder}`,
    }}
  >
    <span
      aria-hidden
      style={{
        flexShrink: 0,
        width: 28,
        height: 28,
        borderRadius: 8,
        background: GRADIENTS.primary,
        color: "#FFFFFF",
        display: "grid",
        placeItems: "center",
        fontFamily: FONT_DISPLAY,
        fontSize: 14,
        fontWeight: 700,
        boxShadow: SHADOWS.primaryGlow,
      }}
    >
      {String(n).padStart(2, "0")}
    </span>
    <div style={{ flex: 1, minWidth: 0 }}>
      <p style={{ fontSize: 14, fontWeight: 700, color: C.ink, margin: 0, lineHeight: 1.2 }}>
        {title}
      </p>
      <p style={{ fontSize: 13, color: "#3D3447", marginTop: 3, lineHeight: 1.5 }}>{body}</p>
    </div>
  </li>
);

export default function FoundingSuccessPage() {
  // useSearchParams must live inside a Suspense boundary on the
  // app router. Outer wrapper provides the fallback for the
  // pre-hydration paint.
  return (
    <Suspense
      fallback={
        <div
          style={{
            minHeight: "100vh",
            background: C.paper,
            display: "grid",
            placeItems: "center",
            color: C.muted,
            fontFamily: FONT_BODY,
          }}
        >
          Confirming…
        </div>
      }
    >
      <FoundingSuccessInner />
    </Suspense>
  );
}
