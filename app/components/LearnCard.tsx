"use client";

// Dashboard welcome / onboarding card that surfaces the new marketing
// pages directly in the app. Quietly self-hides when the stylist has
// dismissed it; saves the dismissal in localStorage so it doesn't
// nag on every session. The three CTAs map to:
//   • Explore Features  → /features
//   • Getting Started   → /getting-started
//   • Install App       → PWA install prompt when available,
//                         else navigates to /getting-started#install
//
// Built to drop in directly under <DashboardHero/> on app/page.tsx.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Sparkles, ArrowRight, Download, ChevronRight, X } from "lucide-react";

const C = {
  ink: "#15111A",
  coffee: "#3D3447",
  paper: "#FFFFFF",
  muted: "#6F6477",
  brandPrimary: "#7C3AED",
  brandSecondary: "#FF4D6D",
  brandBorder: "#ECE7F2",
};
const GRADIENTS = {
  primary: "linear-gradient(135deg, #7C3AED 0%, #FF4D6D 100%)",
  softA: "linear-gradient(135deg, rgba(124, 58, 237, 0.10), rgba(255, 77, 109, 0.10))",
};
const SHADOWS = {
  primaryGlow:
    "0 10px 28px -10px rgba(124, 58, 237, 0.45), 0 4px 12px -4px rgba(255, 77, 109, 0.30)",
  card: "0 4px 14px rgba(21, 17, 26, 0.06)",
};
const FONT_DISPLAY = `"Cormorant Garamond", Georgia, serif`;

const STORAGE_KEY = "bbp-learn-card-dismissed-v1";

// Module-level cache for the captured beforeinstallprompt event so
// Install-App buttons in multiple places (dashboard card + header)
// share one prompt source.
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export const LearnCard = () => {
  const [dismissed, setDismissed] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);

  // Hydrate the dismissed flag client-side (avoids SSR/CSR mismatch).
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      setDismissed(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      /* private mode — keep visible */
    }
  }, []);

  // Capture the PWA install prompt when Chrome / Edge / Android-WebView
  // fires it. iOS Safari doesn't emit this event — those users get the
  // /getting-started#install fallback below.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* private mode — non-fatal */
    }
  };

  const triggerInstall = async () => {
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") setInstallPrompt(null);
      return;
    }
    // Fallback: iOS Safari + browsers that haven't fired the prompt
    // get routed to the install instructions on the getting-started
    // page (Step 6 — Install on your phone).
    window.location.href = "/getting-started#install";
  };

  if (dismissed) return null;

  return (
    <section
      aria-label="Welcome to Braid Boss Pro"
      style={{
        position: "relative",
        overflow: "hidden",
        background: C.paper,
        border: `1px solid ${C.brandBorder}`,
        borderRadius: 24,
        padding: 22,
        boxShadow: SHADOWS.card,
      }}
    >
      {/* Decorative gradient halo top-right */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: -60,
          right: -40,
          width: 240,
          height: 240,
          borderRadius: 999,
          background:
            "conic-gradient(from 200deg, rgba(124, 58, 237, 0.18), rgba(255, 77, 109, 0.18), rgba(124, 58, 237, 0.18))",
          filter: "blur(40px)",
          opacity: 0.7,
          pointerEvents: "none",
        }}
      />

      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss welcome card"
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          width: 28,
          height: 28,
          borderRadius: 999,
          background: "transparent",
          border: 0,
          color: C.muted,
          display: "grid",
          placeItems: "center",
          cursor: "pointer",
        }}
      >
        <X size={14} />
      </button>

      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span
          aria-hidden
          style={{
            width: 36,
            height: 36,
            borderRadius: 12,
            display: "grid",
            placeItems: "center",
            background: GRADIENTS.primary,
            color: "#FFFFFF",
            boxShadow: SHADOWS.primaryGlow,
          }}
        >
          <Sparkles size={18} />
        </span>
        <p
          style={{
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: C.brandPrimary,
            margin: 0,
          }}
        >
          New here?
        </p>
      </div>

      <h2
        style={{
          fontFamily: FONT_DISPLAY,
          fontWeight: 700,
          fontSize: 26,
          color: C.ink,
          margin: "4px 0 8px",
          lineHeight: 1.1,
          letterSpacing: "-0.005em",
          position: "relative",
        }}
      >
        Welcome to Braid Boss Pro
      </h2>
      <p style={{ position: "relative", color: C.coffee, fontSize: 14, lineHeight: 1.55, margin: 0 }}>
        Learn how to set up bookings, pricing, deposits, storefronts, and install
        the app experience.
      </p>

      <div
        style={{
          position: "relative",
          marginTop: 16,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 10,
        }}
      >
        <Link href="/features" style={primaryCta}>
          Explore features
          <ArrowRight size={14} style={{ marginLeft: 6 }} />
        </Link>
        <Link href="/getting-started" style={outlineCta}>
          Getting started
          <ChevronRight size={14} style={{ marginLeft: 4 }} />
        </Link>
        <button type="button" onClick={triggerInstall} style={outlineCta}>
          <Download size={14} style={{ marginRight: 6 }} />
          Install app
        </button>
      </div>
    </section>
  );
};

const primaryCta: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "12px 14px",
  borderRadius: 14,
  background: GRADIENTS.primary,
  color: "#FFFFFF",
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  textDecoration: "none",
  boxShadow: SHADOWS.primaryGlow,
  border: 0,
  cursor: "pointer",
};

const outlineCta: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "12px 14px",
  borderRadius: 14,
  background: "transparent",
  color: C.brandPrimary,
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  textDecoration: "none",
  border: `1.5px solid ${C.brandPrimary}`,
  cursor: "pointer",
};

// Small standalone Install-App button for the dashboard header.
// Honors the same module-level prompt cache + iOS fallback.
export const InstallAppHeaderButton = () => {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(false);
  // Treat 'app already installed' (standalone display mode) as the
  // signal to hide the button. Listening for the appinstalled event
  // also flips it off after install.
  const checkedRef = useRef(false);

  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;
    if (typeof window === "undefined") return;
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true;
    if (standalone) setHidden(true);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as InstallPromptEvent);
    };
    const onInstalled = () => setHidden(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (hidden) return null;

  const onClick = async () => {
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") setHidden(true);
      return;
    }
    window.location.href = "/getting-started#install";
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Install app"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 12px",
        borderRadius: 999,
        background: GRADIENTS.softA,
        color: C.brandPrimary,
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        border: `1px solid ${C.brandBorder}`,
        cursor: "pointer",
      }}
    >
      <Download size={14} />
      Install
    </button>
  );
};
