"use client";

// Buy panel for a Braid Boss Pro Store product.
//
// Collects the buyer's email, POSTs to /api/store-checkout, and redirects
// the browser to the returned Stripe Checkout URL. For "coming soon" /
// not-yet-purchasable products it renders a disabled state instead of a
// buy button, so the product page is safe to ship before a product is
// fully configured.

import { useState } from "react";
import { Loader2, Lock, ShoppingBag } from "lucide-react";
import { C, GRADIENTS, SHADOWS } from "../../components/marketing/tokens";
import { formatPrice } from "../../lib/store-catalog";

type Props = {
  slug: string;
  priceCents: number;
  compareAtCents?: number;
  currency: string;
  purchasable: boolean;
  isDigital: boolean;
};

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

export default function BuyPanel({
  slug,
  priceCents,
  compareAtCents,
  currency,
  purchasable,
  isDigital,
}: Props) {
  const [email, setEmail] = useState("");
  const [name_, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startCheckout = async () => {
    setError(null);
    const clean = email.trim();
    if (!EMAIL_RE.test(clean)) {
      setError("Enter a valid email so we can send your download.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/store-checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, buyer_email: clean, buyer_name: name_.trim() || undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.error || "Couldn't start checkout. Please try again.");
        setLoading(false);
        return;
      }
      // Hand off to Stripe. Keep the spinner up through the redirect.
      window.location.href = data.url;
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  };

  const hasCompare = !!compareAtCents && compareAtCents > priceCents;

  return (
    <div
      style={{
        background: "#FFFFFF",
        border: `1px solid ${C.brandBorder}`,
        borderRadius: 22,
        padding: 22,
        boxShadow: SHADOWS.cardLifted,
      }}
    >
      {/* Price */}
      <div className="flex items-baseline" style={{ gap: 10, marginBottom: 4 }}>
        <span style={{ fontSize: 30, fontWeight: 800, color: C.ink, letterSpacing: "-0.01em" }}>
          {formatPrice(priceCents, currency)}
        </span>
        {hasCompare && (
          <span style={{ fontSize: 17, color: C.mutedSoft, textDecoration: "line-through" }}>
            {formatPrice(compareAtCents!, currency)}
          </span>
        )}
      </div>
      <p style={{ fontSize: 12.5, color: C.muted, margin: "0 0 16px" }}>
        {isDigital ? "Digital download · delivered instantly by email" : "One-time purchase"}
      </p>

      {!purchasable ? (
        <div
          style={{
            textAlign: "center",
            padding: "14px 16px",
            borderRadius: 14,
            background: GRADIENTS.softA,
            border: `1px solid ${C.brandBorder}`,
            color: C.brandPrimary,
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          Coming soon — check back shortly.
        </div>
      ) : (
        <>
          <label style={labelStyle} htmlFor="buy-email">
            Email <span style={{ color: C.brandSecondary }}>*</span>
          </label>
          <input
            id="buy-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") startCheckout();
            }}
            disabled={loading}
            style={inputStyle}
          />
          <label style={{ ...labelStyle, marginTop: 12 }} htmlFor="buy-name">
            Name <span style={{ color: C.mutedSoft, fontWeight: 500 }}>(optional)</span>
          </label>
          <input
            id="buy-name"
            type="text"
            autoComplete="name"
            placeholder="First name"
            value={name_}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") startCheckout();
            }}
            disabled={loading}
            style={inputStyle}
          />

          {error && (
            <p style={{ color: C.brandSecondaryDeep, fontSize: 12.5, margin: "10px 0 0" }}>{error}</p>
          )}

          <button
            type="button"
            onClick={startCheckout}
            disabled={loading}
            style={{
              width: "100%",
              marginTop: 16,
              padding: "15px 20px",
              borderRadius: 14,
              border: 0,
              background: GRADIENTS.primary,
              color: "#FFFFFF",
              fontSize: 14,
              fontWeight: 800,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              boxShadow: SHADOWS.primaryGlow,
              cursor: loading ? "default" : "pointer",
              opacity: loading ? 0.85 : 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Redirecting…
              </>
            ) : (
              <>
                <ShoppingBag size={16} /> Buy now — {formatPrice(priceCents, currency)}
              </>
            )}
          </button>

          <p
            className="flex items-center justify-center"
            style={{ gap: 6, fontSize: 11.5, color: C.mutedSoft, margin: "12px 0 0" }}
          >
            <Lock size={12} /> Secure checkout by Stripe
          </p>
        </>
      )}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 700,
  color: C.coffee,
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 12,
  border: `1px solid ${C.brandBorder}`,
  fontSize: 14,
  color: C.ink,
  outline: "none",
  background: "#FFFFFF",
};
