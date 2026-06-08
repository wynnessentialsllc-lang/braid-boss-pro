"use client";

// Shared, on-brand error UI used by every route-level error boundary.
//
// Next.js App Router calls a segment's error.tsx with { error, reset }
// whenever a render/effect throws below it that wasn't otherwise caught.
// These boundaries are pure defense-in-depth: the public pages already
// handle their own expected failures with try/catch, but an unexpected
// throw previously white-screened the whole route. Now the visitor gets
// a friendly card and a working "Try again" (reset) button instead.
//
// Self-contained inline styles (no Tailwind/class dependencies) so it
// renders correctly even if the failure happened before styles applied,
// and works in both the SSR web build and the native static export.

import { useEffect } from "react";

const C = {
  espresso: "#15111A",
  muted: "#6F6477",
  paper: "#FFFFFF",
  ivory: "#F6F2EC",
  gold: "#7C3AED",
  goldDeep: "#5B21B6",
  hairline: "rgba(21, 17, 26, 0.12)",
};

export default function RouteError({
  error,
  reset,
  title = "Something went wrong.",
  message = "We hit an unexpected snag loading this page. Please try again.",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
  message?: string;
}) {
  useEffect(() => {
    // Surface for debugging / log drains. A real error tracker (e.g.
    // Sentry) would capture `error` here.
    console.error("[route-error]", error?.message, error?.digest || "");
  }, [error]);

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "max(24px, env(safe-area-inset-top)) 18px max(24px, env(safe-area-inset-bottom))",
        background: `linear-gradient(180deg, ${C.paper} 0%, ${C.ivory} 100%)`,
        color: C.espresso,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <div
        role="alert"
        style={{
          width: "100%",
          maxWidth: 420,
          background: C.paper,
          border: `1px solid ${C.hairline}`,
          borderRadius: 24,
          padding: 28,
          textAlign: "center",
          boxShadow: "0 1px 2px rgba(21,17,26,0.06), 0 24px 48px -16px rgba(21,17,26,0.18)",
        }}
      >
        <div
          aria-hidden
          style={{
            width: 56,
            height: 56,
            borderRadius: 99,
            margin: "0 auto 14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(124,58,237,0.10)",
            color: C.goldDeep,
            fontSize: 26,
            fontWeight: 700,
          }}
        >
          !
        </div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em" }}>
          {title}
        </h1>
        <p style={{ margin: "10px 0 20px", fontSize: 14, lineHeight: 1.5, color: C.muted }}>
          {message}
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            appearance: "none",
            WebkitAppearance: "none",
            border: "none",
            width: "100%",
            minHeight: 48,
            borderRadius: 14,
            background: `linear-gradient(135deg, ${C.gold} 0%, ${C.goldDeep} 100%)`,
            color: "#fff",
            fontSize: 15,
            fontWeight: 600,
            cursor: "pointer",
            font: "inherit",
          }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
