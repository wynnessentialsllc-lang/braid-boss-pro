"use client";

// A "Where" card for the client-facing surfaces — the agreement signing
// page and the appointment portal.
//
// Shared rather than per-page because both need identical behavior: the
// address stays selectable TEXT (long-pressing a link on mobile offers
// "copy link", not the address), with an explicit copy button beside
// directions. Colors are the neutral base both pages already share, so
// this renders the same on either one.

import { useState } from "react";
import { mapsDirectionsUrl } from "../lib/address-link";

const C = {
  espresso: "#15111A",
  coffee: "#3D3447",
  paper: "#FFFFFF",
  hairline: "rgba(21, 17, 26, 0.12)",
  accent: "#7C3AED",
  accentText: "#FFFFFF",
};

export const DirectionsCard = ({
  address,
  style,
}: {
  address: string;
  style?: React.CSSProperties;
}) => {
  const [copied, setCopied] = useState(false);
  const href = mapsDirectionsUrl(
    address,
    typeof navigator !== "undefined" ? navigator.userAgent : null,
  );
  if (!href) return null;

  const copy = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(address);
      } else if (typeof document !== "undefined") {
        const el = document.createElement("textarea");
        el.value = address;
        el.setAttribute("readonly", "");
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — the address is selectable above either way */
    }
  };

  return (
    <div
      style={{
        marginTop: 18,
        padding: 16,
        borderRadius: 16,
        background: C.paper,
        border: `1px solid ${C.hairline}`,
        ...style,
      }}
    >
      <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.coffee }}>
        Where
      </p>
      <p
        style={{
          fontSize: 15,
          color: C.espresso,
          marginTop: 6,
          lineHeight: 1.45,
          whiteSpace: "pre-wrap",
          WebkitUserSelect: "text",
          userSelect: "text",
        }}
      >
        {address}
      </p>
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            flex: "1 1 140px",
            textAlign: "center",
            padding: "11px 14px",
            borderRadius: 999,
            background: C.accent,
            color: C.accentText,
            fontSize: 13,
            fontWeight: 700,
            textDecoration: "none",
          }}
        >
          Get directions
        </a>
        <button
          type="button"
          onClick={() => { void copy(); }}
          style={{
            flex: "1 1 110px",
            padding: "11px 14px",
            borderRadius: 999,
            background: "transparent",
            color: C.coffee,
            border: `1px solid ${C.hairline}`,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {copied ? "Copied" : "Copy address"}
        </button>
      </div>
    </div>
  );
};

export default DirectionsCard;
