"use client";

// Mobile-first slide-up cart drawer + floating cart badge. Both are
// mounted globally by app/layout.tsx via the CartProvider; pages
// don't need to render anything themselves.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useCart, type CartItem } from "../lib/cart";

const C = {
  cream: "#FFFFFF",
  paper: "#FFFFFF",
  ink: "#15111A",
  brandPrimary: "#7C3AED",
  brandSecondary: "#FF4D6D",
  brandBorder: "#ECE7F2",
  brandError: "#EF4444",
  muted: "#6F6477",
  mutedSoft: "#9F95A8",
  brandWarning: "#FBBF24",
};

const GRADIENTS = {
  primary: "linear-gradient(135deg, #7C3AED 0%, #FF4D6D 100%)",
};

const SHADOWS = {
  primaryGlow:
    "0 10px 28px -10px rgba(124, 58, 237, 0.45), 0 4px 12px -4px rgba(255, 77, 109, 0.30)",
  cardLifted: "0 12px 32px -12px rgba(21, 17, 26, 0.18)",
};

const FONT_DISPLAY = `"Cormorant Garamond", Georgia, serif`;

const fmt = (n: number, currency = "USD") => {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
};

// ---- Floating cart badge --------------------------------------------------

export const CartFloatingBadge = () => {
  const { totalQuantity, openCart, cart } = useCart();
  // Only render when there's at least one item AND a handle scope —
  // an empty / unbound cart shouldn't push a button on every page.
  if (totalQuantity === 0 || !cart.handle) return null;
  return (
    <button
      type="button"
      onClick={openCart}
      aria-label={`Open cart (${totalQuantity} item${totalQuantity === 1 ? "" : "s"})`}
      style={{
        position: "fixed",
        right: 18,
        bottom: "calc(18px + env(safe-area-inset-bottom, 0px))",
        zIndex: 60,
        background: GRADIENTS.primary,
        color: "#FFFFFF",
        border: 0,
        borderRadius: 999,
        height: 56,
        width: 56,
        boxShadow: SHADOWS.primaryGlow,
        display: "grid",
        placeItems: "center",
        cursor: "pointer",
      }}
      className="bbp-cart-fab"
    >
      <span style={{ position: "relative", display: "grid", placeItems: "center" }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
          <path d="M3 6h18" />
          <path d="M16 10a4 4 0 0 1-8 0" />
        </svg>
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: -7,
            right: -10,
            minWidth: 20,
            height: 20,
            padding: "0 6px",
            borderRadius: 999,
            background: "#FFFFFF",
            color: C.brandPrimary,
            fontSize: 11,
            fontWeight: 800,
            display: "grid",
            placeItems: "center",
            boxShadow: "0 2px 6px rgba(21,17,26,0.18)",
          }}
        >
          {totalQuantity}
        </span>
      </span>
      <style jsx>{`
        @keyframes bbpCartPop { 0% { transform: scale(0.6); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
        .bbp-cart-fab { animation: bbpCartPop 220ms cubic-bezier(.2,.8,.2,1) both; }
        @media (prefers-reduced-motion: reduce) { .bbp-cart-fab { animation: none; } }
      `}</style>
    </button>
  );
};

// ---- Cart drawer ---------------------------------------------------------

export const CartDrawer = () => {
  const router = useRouter();
  const { cart, isOpen, closeCart, subtotal, totalQuantity, setQuantity, removeItem, keyOf } =
    useCart();
  const [checkoutState, setCheckoutState] = useState<"idle" | "loading" | "error">("idle");
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  // Optional gift card code applied at checkout. The checkout API
  // validates it server-side and returns an error if it's invalid.
  const [giftCardCode, setGiftCardCode] = useState("");

  // Lock body scroll while the drawer is open so iOS Safari doesn't
  // bounce the page under the sheet.
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  // Esc-to-close for keyboard users.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeCart();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, closeCart]);

  const startCheckout = async () => {
    if (!cart.handle) {
      setCheckoutError("Cart isn't scoped to a stylist yet.");
      setCheckoutState("error");
      return;
    }
    if (cart.items.length === 0) return;
    setCheckoutState("loading");
    setCheckoutError(null);
    try {
      const res = await fetch("/api/product-checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          handle: cart.handle,
          items: cart.items.map((i) => ({
            product_slug: i.product_slug,
            quantity: i.quantity,
            variant_id: i.variant_id,
          })),
          gift_card_code: giftCardCode.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.url) {
        setCheckoutState("error");
        setCheckoutError(body?.error || "Couldn't start checkout. Try again in a moment.");
        return;
      }
      window.location.href = body.url;
    } catch (e: any) {
      setCheckoutState("error");
      setCheckoutError(e?.message || "Network error. Try again.");
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Cart"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(21,17,26,0.42)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) closeCart();
      }}
      className="bbp-cart-backdrop"
    >
      <section
        className="bbp-cart-sheet"
        style={{
          width: "100%",
          maxWidth: 520,
          background: C.paper,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: SHADOWS.cardLifted,
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        <header
          style={{
            padding: "18px 20px 12px",
            borderBottom: `1px solid ${C.brandBorder}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <p
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: 24,
                fontWeight: 700,
                color: C.brandPrimary,
                margin: 0,
                lineHeight: 1,
              }}
            >
              Your cart
            </p>
            <p
              style={{
                fontSize: 11,
                color: C.muted,
                marginTop: 4,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              {totalQuantity === 0 ? "Empty" : `${totalQuantity} item${totalQuantity === 1 ? "" : "s"}`}
            </p>
          </div>
          <button
            type="button"
            onClick={closeCart}
            aria-label="Close cart"
            style={{
              width: 36,
              height: 36,
              borderRadius: 999,
              background: "transparent",
              border: 0,
              fontSize: 20,
              color: C.muted,
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </header>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
          {cart.items.length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px 8px", color: C.muted }}>
              <p style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 600, color: C.ink, margin: 0 }}>
                Cart is empty
              </p>
              <p style={{ fontSize: 13, marginTop: 6 }}>
                Add a product from the shop to get started.
              </p>
            </div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 14 }}>
              {cart.items.map((i) => (
                <CartRow
                  key={keyOf(i)}
                  item={i}
                  onChange={(q) => setQuantity(keyOf(i), q)}
                  onRemove={() => removeItem(keyOf(i))}
                />
              ))}
            </ul>
          )}
        </div>

        {cart.items.length > 0 && (
          <footer
            style={{
              padding: "16px 20px 18px",
              borderTop: `1px solid ${C.brandBorder}`,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
              }}
            >
              <span style={{ fontSize: 13, color: C.muted, fontWeight: 600 }}>Subtotal</span>
              <span style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 700, color: C.ink }}>
                {fmt(subtotal)}
              </span>
            </div>
            <p style={{ fontSize: 11, color: C.muted, margin: 0 }}>
              Taxes + shipping calculated at checkout.
            </p>
            <input
              type="text"
              value={giftCardCode}
              onChange={(e) => setGiftCardCode(e.target.value.toUpperCase())}
              placeholder="Gift card code (optional)"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 12,
                border: `1px solid ${C.brandBorder}`,
                background: "#FFFFFF",
                color: C.ink,
                fontSize: 13,
                letterSpacing: "0.04em",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
            <button
              type="button"
              onClick={startCheckout}
              disabled={checkoutState === "loading"}
              style={{
                marginTop: 6,
                width: "100%",
                padding: "14px 16px",
                borderRadius: 16,
                background: GRADIENTS.primary,
                color: "#FFFFFF",
                border: 0,
                fontSize: 14,
                fontWeight: 800,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                boxShadow: SHADOWS.primaryGlow,
                cursor: checkoutState === "loading" ? "wait" : "pointer",
                opacity: checkoutState === "loading" ? 0.7 : 1,
              }}
            >
              {checkoutState === "loading" ? "Opening checkout…" : "Checkout"}
            </button>
            {checkoutError && (
              <p style={{ fontSize: 12, color: C.brandError, marginTop: 4, textAlign: "center" }}>
                {checkoutError}
              </p>
            )}
          </footer>
        )}
      </section>

      <style jsx>{`
        @keyframes bbpCartBackdrop { from { opacity: 0; } to { opacity: 1; } }
        @keyframes bbpCartSlide { from { transform: translateY(100%); } to { transform: translateY(0); } }
        .bbp-cart-backdrop { animation: bbpCartBackdrop 200ms ease both; }
        .bbp-cart-sheet { animation: bbpCartSlide 280ms cubic-bezier(.2,.8,.2,1) both; }
        @media (prefers-reduced-motion: reduce) {
          .bbp-cart-backdrop, .bbp-cart-sheet { animation: none; }
        }
      `}</style>
    </div>
  );
};

const CartRow = ({
  item,
  onChange,
  onRemove,
}: {
  item: CartItem;
  onChange: (q: number) => void;
  onRemove: () => void;
}) => {
  const lineTotal = item.quantity * item.unit_amount;
  const atMax = item.inventory_count != null && item.quantity >= item.inventory_count;
  return (
    <li
      style={{
        display: "flex",
        gap: 12,
        padding: 12,
        borderRadius: 16,
        background: "#FBFAFD",
        border: `1px solid ${C.brandBorder}`,
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: 12,
          overflow: "hidden",
          background: "#F6F2EC",
          flexShrink: 0,
        }}
      >
        {item.image_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={item.image_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div style={{ width: "100%", height: "100%", background: GRADIENTS.primary }} />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 14, fontWeight: 700, color: C.ink, margin: 0, lineHeight: 1.2 }}>
          {item.title}
        </p>
        {item.variant_name && (
          <p style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
            {item.variant_label || "Option"}: <span style={{ color: C.ink, fontWeight: 600 }}>{item.variant_name}</span>
          </p>
        )}
        <p style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{fmt(item.unit_amount)}</p>
        <div
          style={{
            marginTop: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              border: `1px solid ${C.brandBorder}`,
              borderRadius: 999,
              overflow: "hidden",
              background: "#FFFFFF",
            }}
          >
            <button
              type="button"
              onClick={() => onChange(item.quantity - 1)}
              aria-label="Decrease"
              style={{ padding: "6px 12px", background: "transparent", border: 0, color: C.ink, fontWeight: 700, cursor: "pointer" }}
            >
              −
            </button>
            <span style={{ minWidth: 24, textAlign: "center", fontSize: 13, fontWeight: 700, color: C.ink }}>
              {item.quantity}
            </span>
            <button
              type="button"
              onClick={() => onChange(item.quantity + 1)}
              aria-label="Increase"
              disabled={atMax}
              style={{
                padding: "6px 12px",
                background: "transparent",
                border: 0,
                color: atMax ? C.mutedSoft : C.ink,
                fontWeight: 700,
                cursor: atMax ? "not-allowed" : "pointer",
              }}
            >
              +
            </button>
          </div>
          <button
            type="button"
            onClick={onRemove}
            style={{
              background: "transparent",
              border: 0,
              color: C.muted,
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.10em",
              cursor: "pointer",
            }}
          >
            Remove
          </button>
        </div>
        {atMax && item.inventory_count != null && (
          <p style={{ fontSize: 10, color: "#B45309", marginTop: 4, fontWeight: 600 }}>
            Only {item.inventory_count} available
          </p>
        )}
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <p style={{ fontSize: 14, fontWeight: 700, color: C.ink, margin: 0 }}>{fmt(lineTotal)}</p>
      </div>
    </li>
  );
};
