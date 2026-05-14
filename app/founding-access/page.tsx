"use client";

// Founding Stylist Access checkout entry page. Surfaced from every
// 'Claim founding access' / 'Claim my founding spot' CTA across the
// marketing pages.
//
// Behavior:
//   1. Visitor lands here, sees the offer summary card.
//   2. Tap 'Continue to checkout' → POSTs to /api/founding-checkout
//      which creates a Stripe Checkout Session and returns the URL.
//   3. Browser redirects to Stripe — Stripe collects email + card.
//   4. On success → /founding-success?session_id=… → 'Now create
//      your account with this email'.
//
// No client-side payment library needed; Stripe Checkout handles
// every payment-form concern itself.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Check,
  Crown,
  ShieldCheck,
  Sparkles,
  Zap,
  ArrowRight,
} from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, GRADIENTS, SHADOWS } from "../components/marketing/tokens";

const FOUNDING_PRICE_DOLLARS = 9.99;

const FEATURES = [
  "Lifetime platform access — no monthly bill, ever",
  "Branded booking link with your own /@handle",
  "Stripe Connect direct charges + deposits",
  "Retail storefront with variants + inventory",
  "Contracts, e-sign, pricing calculator",
  "Reminder + email automation",
  "Mobile dashboard + PWA install",
  "Every future platform upgrade included",
  "Priority access to new tools as they ship",
];

export default function FoundingAccessPage() {
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  // Personalize the document title — this page is dynamic, not part
  // of the marketing-shell static set, so we set the title manually.
  useEffect(() => {
    document.title = "Founding Stylist Access · Braid Boss Pro";
  }, []);

  const startCheckout = async () => {
    if (status === "loading") return;
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch("/api/founding-checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.url) {
        setStatus("error");
        setError(body?.error || "Couldn't start checkout. Try again in a moment.");
        return;
      }
      window.location.href = body.url;
    } catch (e: any) {
      setStatus("error");
      setError(e?.message || "Network error. Try again.");
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: C.paper,
        color: C.ink,
        fontFamily: FONT_BODY,
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=DM+Sans:wght@400;500;600;700;800&display=swap');
      `}</style>

      {/* Minimal header — just the brand mark + back-to-pricing link
          so the visitor focuses on the offer card. */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 30,
          background: "rgba(255, 255, 255, 0.85)",
          backdropFilter: "saturate(180%) blur(12px)",
          WebkitBackdropFilter: "saturate(180%) blur(12px)",
          borderBottom: `1px solid ${C.brandBorder}`,
          paddingTop: "calc(env(safe-area-inset-top, 0px))",
        }}
      >
        <div
          className="max-w-[820px] mx-auto flex items-center justify-between"
          style={{ padding: "14px 20px" }}
        >
          <Link href="/" style={{ textDecoration: "none" }}>
            <span
              style={{
                fontSize: 14,
                fontWeight: 800,
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                color: C.brandPrimary,
              }}
            >
              Braid Boss Pro
            </span>
          </Link>
          <Link
            href="/pricing"
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#3D3447",
              textDecoration: "none",
            }}
          >
            ← Pricing
          </Link>
        </div>
      </header>

      <section
        style={{
          position: "relative",
          overflow: "hidden",
          padding: "56px 20px 24px",
        }}
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: -160,
            left: "50%",
            transform: "translateX(-50%)",
            width: 720,
            height: 720,
            borderRadius: 999,
            background:
              "conic-gradient(from 220deg, rgba(124, 58, 237, 0.18), rgba(255, 77, 109, 0.18), rgba(177, 75, 224, 0.18), rgba(124, 58, 237, 0.18))",
            filter: "blur(80px)",
            pointerEvents: "none",
          }}
        />
        <div className="max-w-[560px] mx-auto text-center" style={{ position: "relative" }}>
          <p
            style={{
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: C.brandPrimary,
              margin: 0,
            }}
          >
            Founding Stylist Access · First 100 Users
          </p>
          <h1
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 700,
              fontSize: "clamp(34px, 6vw, 52px)",
              lineHeight: 1.05,
              color: C.ink,
              margin: "16px 0 0",
              letterSpacing: "-0.015em",
            }}
          >
            One-time payment.{" "}
            <em
              style={{
                fontStyle: "italic",
                background: "linear-gradient(135deg, #7C3AED 0%, #FF4D6D 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              Lifetime access.
            </em>
          </h1>
          <p
            style={{
              color: "#3D3447",
              fontSize: 15,
              lineHeight: 1.6,
              marginTop: 16,
            }}
          >
            Lock in lifetime access to Braid Boss Pro — the business operating
            system for braiders — before the platform transitions to monthly
            membership pricing.
          </p>
        </div>
      </section>

      {/* Offer card */}
      <section style={{ padding: "8px 20px 40px" }}>
        <article
          className="max-w-[560px] mx-auto"
          style={{
            position: "relative",
            overflow: "hidden",
            borderRadius: 28,
            padding: 32,
            background: C.paper,
            border: "2px solid transparent",
            backgroundImage: `linear-gradient(${C.paper}, ${C.paper}), ${GRADIENTS.primary}`,
            backgroundOrigin: "border-box",
            backgroundClip: "padding-box, border-box",
            boxShadow: SHADOWS.cardLifted,
          }}
        >
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: -120,
              right: -60,
              width: 240,
              height: 240,
              borderRadius: 999,
              background:
                "conic-gradient(from 200deg, rgba(124, 58, 237, 0.20), rgba(255, 77, 109, 0.20))",
              filter: "blur(40px)",
              pointerEvents: "none",
            }}
          />

          <div
            style={{
              position: "relative",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 12px",
              borderRadius: 999,
              background: GRADIENTS.primary,
              color: "#FFFFFF",
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              boxShadow: SHADOWS.primaryGlow,
            }}
          >
            <Crown size={12} aria-hidden />
            First 100 Users
          </div>

          <h2
            style={{
              position: "relative",
              fontFamily: FONT_DISPLAY,
              fontWeight: 700,
              fontSize: 30,
              color: C.ink,
              margin: "14px 0 4px",
              lineHeight: 1.1,
            }}
          >
            Founding Stylist Access
          </h2>
          <p
            style={{
              position: "relative",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: C.brandPrimary,
              margin: 0,
            }}
          >
            One-Time Payment · Lifetime Access
          </p>

          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              marginTop: 16,
            }}
          >
            <span
              style={{
                fontFamily: FONT_DISPLAY,
                fontWeight: 700,
                fontSize: 56,
                color: C.ink,
                lineHeight: 1,
                letterSpacing: "-0.025em",
              }}
            >
              ${FOUNDING_PRICE_DOLLARS.toFixed(2)}
            </span>
            <span style={{ color: C.muted, fontSize: 14, fontWeight: 600 }}>
              one-time · charged via Stripe
            </span>
          </div>

          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: "20px 0 0",
              display: "flex",
              flexDirection: "column",
              gap: 9,
              position: "relative",
            }}
          >
            {FEATURES.map((f) => (
              <li
                key={f}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  color: "#3D3447",
                  fontSize: 14,
                  lineHeight: 1.5,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 20,
                    height: 20,
                    flexShrink: 0,
                    borderRadius: 999,
                    background: GRADIENTS.primary,
                    color: "#FFFFFF",
                    display: "grid",
                    placeItems: "center",
                    marginTop: 1,
                  }}
                >
                  <Check size={12} />
                </span>
                {f}
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={startCheckout}
            disabled={status === "loading"}
            style={{
              position: "relative",
              width: "100%",
              marginTop: 24,
              padding: "16px 18px",
              borderRadius: 16,
              background: GRADIENTS.primary,
              color: "#FFFFFF",
              fontSize: 14,
              fontWeight: 800,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              border: 0,
              boxShadow: SHADOWS.primaryGlow,
              cursor: status === "loading" ? "wait" : "pointer",
              opacity: status === "loading" ? 0.7 : 1,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            {status === "loading" ? "Opening checkout…" : "Continue to checkout"}
            {status !== "loading" && <ArrowRight size={16} aria-hidden />}
          </button>

          {error && (
            <p
              style={{
                position: "relative",
                marginTop: 12,
                fontSize: 12,
                color: "#EF4444",
                textAlign: "center",
              }}
            >
              {error}
            </p>
          )}

          <p
            style={{
              position: "relative",
              marginTop: 14,
              fontSize: 11,
              color: C.mutedSoft,
              textAlign: "center",
              lineHeight: 1.55,
            }}
          >
            Charged once. No subscription. No auto-renewal.
            Secure payment by Stripe.
          </p>
        </article>
      </section>

      {/* Why Founding Access */}
      <section style={{ padding: "8px 20px 64px" }}>
        <div
          className="max-w-[820px] mx-auto"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 14,
          }}
        >
          <Benefit
            icon={<Crown size={18} />}
            title="Early-access pricing"
            body="A single payment unlocks the full platform — locked in forever."
          />
          <Benefit
            icon={<Zap size={18} />}
            title="Priority roadmap access"
            body="Founding feedback ships first. New tools land on your dashboard ahead of subscribers."
          />
          <Benefit
            icon={<ShieldCheck size={18} />}
            title="Grandfathered forever"
            body="When monthly pricing turns on for new stylists, your founding rate stays locked."
          />
          <Benefit
            icon={<Sparkles size={18} />}
            title="Braid-specific by design"
            body="Variations, deposits, storefronts — built for how braiders work, not generic salon software."
          />
        </div>
      </section>
    </div>
  );
}

const Benefit = ({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) => (
  <article
    style={{
      background: C.paper,
      border: `1px solid ${C.brandBorder}`,
      borderRadius: 18,
      padding: 16,
      boxShadow: SHADOWS.card,
    }}
  >
    <span
      aria-hidden
      style={{
        width: 32,
        height: 32,
        borderRadius: 10,
        display: "grid",
        placeItems: "center",
        background: GRADIENTS.primary,
        color: "#FFFFFF",
        boxShadow: SHADOWS.primaryGlow,
        marginBottom: 10,
      }}
    >
      {icon}
    </span>
    <h3
      style={{
        fontFamily: FONT_DISPLAY,
        fontWeight: 700,
        fontSize: 17,
        color: C.ink,
        margin: 0,
        lineHeight: 1.15,
      }}
    >
      {title}
    </h3>
    <p style={{ color: "#3D3447", fontSize: 13, lineHeight: 1.55, marginTop: 5 }}>
      {body}
    </p>
  </article>
);
