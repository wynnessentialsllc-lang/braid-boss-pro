"use client";

// One-time, non-blocking privacy notice. Braid Boss Pro uses only
// first-party analytics + local storage (no ad / cross-site tracking
// cookies), so this is a disclosure — not a consent gate. Dismissal is
// remembered in local storage so it shows at most once per device.

import { useEffect, useState } from "react";

const KEY = "bbp-privacy-notice-v1";

export default function PrivacyNotice() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Defer to a task so we never setState synchronously inside the
    // effect, and so the banner fades in just after first paint.
    const id = window.setTimeout(() => {
      try {
        if (!window.localStorage.getItem(KEY)) setShow(true);
      } catch {
        /* storage blocked — don't nag */
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  if (!show) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(KEY, new Date().toISOString());
    } catch {
      /* ignore */
    }
    setShow(false);
  };

  return (
    <div
      role="region"
      aria-label="Privacy notice"
      style={{
        position: "fixed",
        left: "50%",
        transform: "translateX(-50%)",
        bottom: "calc(12px + env(safe-area-inset-bottom, 0px))",
        zIndex: 2147483000,
        width: "calc(100% - 24px)",
        maxWidth: 460,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        borderRadius: 14,
        background: "#15111A",
        color: "#F6F2EC",
        boxShadow: "0 12px 32px -10px rgba(0,0,0,0.5)",
        fontFamily: `"DM Sans", "Inter", system-ui, sans-serif`,
      }}
    >
      <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.45, flex: 1 }}>
        We use first-party analytics and local storage to run the app — no ad or
        cross-site trackers.{" "}
        <a
          href="/privacy"
          style={{ color: "#C9A8FF", textDecoration: "underline", whiteSpace: "nowrap" }}
        >
          Privacy Policy
        </a>
        .
      </p>
      <button
        type="button"
        onClick={dismiss}
        style={{
          flexShrink: 0,
          padding: "8px 14px",
          borderRadius: 999,
          border: 0,
          background: "#F6F2EC",
          color: "#15111A",
          fontSize: 13,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        Got it
      </button>
    </div>
  );
}
