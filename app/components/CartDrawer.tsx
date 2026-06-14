"use client";

// Mobile-first slide-up cart drawer + floating cart badge. Both are
// mounted globally by app/layout.tsx via the CartProvider; pages
// don't need to render anything themselves.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useCart, type CartItem } from "../lib/cart";
import { useModalA11y } from "../lib/use-modal-a11y";
import { getSupabase } from "../lib/supabase";

type FulfillmentMethod = "shipping" | "delivery" | "pickup";
type ShopFulfillment = {
  pickup_enabled: boolean;
  delivery_enabled: boolean;
  shipping_enabled: boolean;
  shipping_mode: string;
  shipping_flat_rate: number | null;
  shipping_free_threshold: number | null;
  delivery_fee: number | null;
  delivery_radius_miles: number | null;
  turnaround_days_min: number | null;
  turnaround_days_max: number | null;
};

// Render the pickup turnaround as a buyer-friendly string. Mirrors
// formatPickupEta in app/lib/storefront.ts; duplicated here to keep the
// client bundle thin (no extra import needed for one helper).
const pickupEtaText = (cfg: ShopFulfillment): string | null => {
  const min = cfg.turnaround_days_min;
  const max = cfg.turnaround_days_max;
  const valid = (n: number | null): n is number =>
    n != null && Number.isFinite(n) && n > 0;
  if (!valid(min) && !valid(max)) return null;
  const dayWord = (n: number) => (n === 1 ? "day" : "days");
  if (valid(min) && valid(max)) {
    if (min === max) return `Usually ready in ${min} ${dayWord(min)}`;
    return `Usually ready in ${min}–${max} days`;
  }
  if (valid(min)) return `Usually ready in ${min} ${dayWord(min)}`;
  return `Usually ready in up to ${max} ${dayWord(max!)}`;
};

// One live carrier rate returned by /api/shipping-rates. Mirrors NormalizedRate
// from app/lib/shippo.ts; duplicated here so the client bundle doesn't pull
// the server-only Shippo module.
type CarrierRate = {
  id: string;
  carrier: string;
  service: string;
  amount_cents: number;
  currency: string;
  estimated_days: number | null;
};

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

// sessionStorage helpers for cart-drawer state we want to survive a
// same-tab refresh (rate-picker ZIP / state / fetched quote / picked id).
// SSR-safe — return empty/null on the server, write only in the browser.
// All writes are best-effort; private-mode + over-quota throws are swallowed.
const readSessionString = (key: string): string => {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(key) || "";
  } catch {
    return "";
  }
};
const writeSessionString = (key: string, value: string): void => {
  if (typeof window === "undefined") return;
  try {
    if (value) window.sessionStorage.setItem(key, value);
    else window.sessionStorage.removeItem(key);
  } catch { /* non-fatal */ }
};
const readSessionJSON = <T,>(key: string): T | null => {
  const raw = readSessionString(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};
const writeSessionJSON = (key: string, value: unknown): void => {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch { /* non-fatal */ }
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
  // The shop's enabled fulfillment methods + the buyer's choice. Null = the
  // shop hasn't configured any, so checkout behaves exactly as before.
  const [ful, setFul] = useState<ShopFulfillment | null>(null);
  const [method, setMethod] = useState<FulfillmentMethod | null>(null);
  // Local-delivery radius check.
  const [deliveryZip, setDeliveryZip] = useState("");
  const [deliveryCheck, setDeliveryCheck] = useState<
    { status: "idle" | "checking" | "ok" | "out" | "error"; miles?: number; radius?: number }
  >({ status: "idle" });

  // Live carrier shipping (Shippo) — buyer enters a ZIP + state, we fetch
  // rates from the stylist's Shippo account, the buyer picks one. The picked
  // rate id flows to checkout, where it's re-fetched + charged.
  //
  // Persisted to sessionStorage so a same-tab refresh mid-purchase doesn't
  // wipe the buyer's ZIP / state / fetched rates / picked rate. The
  // CartProvider also restores isOpen, so refresh keeps them on the
  // rate-picker screen instead of bouncing them back to the product page.
  const [shipZip, setShipZip] = useState(() => readSessionString("bbp-cart-ship-zip"));
  const [shipState, setShipState] = useState(() => readSessionString("bbp-cart-ship-state"));
  // The cart snapshot the most-recent rate quote was for; if the live cart
  // has drifted (quantity bump, item add/remove) we treat the quote as stale.
  const [rateState, setRateState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "ok"; rates: CarrierRate[]; snapshot: string }
    | { status: "error"; message: string }
  >(() => {
    const stored = readSessionJSON<{ rates: CarrierRate[]; snapshot: string }>("bbp-cart-rate-quote");
    return stored ? { status: "ok", rates: stored.rates, snapshot: stored.snapshot } : { status: "idle" };
  });
  const [pickedRateId, setPickedRateId] = useState<string | null>(() =>
    readSessionString("bbp-cart-picked-rate-id") || null,
  );

  // Write-through to sessionStorage on every change. Strings + the picked
  // rate id stay in sync; only "ok" rate quotes are persisted (loading /
  // error states have no value to restore).
  useEffect(() => { writeSessionString("bbp-cart-ship-zip", shipZip); }, [shipZip]);
  useEffect(() => { writeSessionString("bbp-cart-ship-state", shipState); }, [shipState]);
  useEffect(() => { writeSessionString("bbp-cart-picked-rate-id", pickedRateId ?? ""); }, [pickedRateId]);
  useEffect(() => {
    if (rateState.status === "ok") {
      writeSessionJSON("bbp-cart-rate-quote", { rates: rateState.rates, snapshot: rateState.snapshot });
    } else if (rateState.status === "idle") {
      writeSessionString("bbp-cart-rate-quote", "");
    }
  }, [rateState]);

  // Fingerprint of inputs that affect carrier rates (cart contents + method).
  // Derived so React Compiler is happy — no effect-driven setState dance.
  const rateSnapshot = `${method ?? ""}:${cart.items
    .map((i) => `${i.product_slug}@${i.variant_id ?? ""}x${i.quantity}`)
    .join("|")}`;
  const rateStale = rateState.status === "ok" && rateState.snapshot !== rateSnapshot;

  const deliveryLimited = !!(ful && method === "delivery" && Number(ful.delivery_radius_miles) > 0);
  const carrierShipping = !!(ful && method === "shipping" && ful.shipping_mode === "carrier");
  const pickedRate =
    rateState.status === "ok" && !rateStale
      ? rateState.rates.find((r) => r.id === pickedRateId) || null
      : null;

  const runDeliveryCheck = async (zip: string) => {
    if (!cart.handle || zip.trim().length < 5) return;
    setDeliveryCheck({ status: "checking" });
    try {
      const res = await fetch("/api/delivery-check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: cart.handle, zip: zip.trim() }),
      });
      const b = await res.json().catch(() => ({}));
      if (!res.ok || !b?.ok) {
        setDeliveryCheck({ status: "error" });
        return;
      }
      if (b.limited === false || b.within) {
        setDeliveryCheck({ status: "ok", miles: b.miles, radius: b.radius });
      } else {
        setDeliveryCheck({ status: "out", miles: b.miles, radius: b.radius });
      }
    } catch {
      setDeliveryCheck({ status: "error" });
    }
  };

  // Block checkout when delivery is radius-limited and the ZIP isn't confirmed
  // in-area. Other methods are unaffected.
  const deliveryBlocked = deliveryLimited && deliveryCheck.status !== "ok";
  // Block carrier-shipping checkout until the buyer has picked a rate. The
  // server rejects a carrier-mode checkout without a rate id, so this is
  // primarily a UX guard so the button text explains what's missing.
  const carrierBlocked = carrierShipping && (!pickedRate || rateStale);

  const fetchCarrierRates = async () => {
    if (!cart.handle) return;
    const zip = shipZip.trim();
    if (!/^\d{5}$/.test(zip)) {
      setRateState({ status: "error", message: "Enter a 5-digit ZIP." });
      return;
    }
    setRateState({ status: "loading" });
    setPickedRateId(null);
    try {
      const res = await fetch("/api/shipping-rates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          handle: cart.handle,
          items: cart.items.map((i) => ({
            product_slug: i.product_slug,
            quantity: i.quantity,
            variant_id: i.variant_id,
          })),
          ship_to: { zip, state: shipState.trim().toUpperCase() || null, country: "US" },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(body?.rates) || body.rates.length === 0) {
        setRateState({
          status: "error",
          message: body?.error || "Couldn't fetch rates. Try again.",
        });
        return;
      }
      setRateState({
        status: "ok",
        rates: body.rates as CarrierRate[],
        snapshot: rateSnapshot,
      });
      // Auto-select the cheapest rate (already sorted) so the buyer doesn't
      // have to tap before they see a Total they trust.
      setPickedRateId(body.rates[0].id);
    } catch (e: any) {
      setRateState({ status: "error", message: e?.message || "Network error." });
    }
  };

  // Load the shop's fulfillment config when the drawer opens. Anon RPC —
  // exposes only the non-sensitive shipping/delivery/pickup config.
  useEffect(() => {
    if (!isOpen || !cart.handle) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await getSupabase().rpc("public_get_shop_fulfillment", {
          slug_in: cart.handle,
        });
        const row = (Array.isArray(data) ? data[0] : data) as ShopFulfillment | undefined;
        if (cancelled) return;
        if (row && (row.pickup_enabled || row.delivery_enabled || row.shipping_enabled)) {
          setFul(row);
          setMethod((m) =>
            m ?? (row.shipping_enabled ? "shipping" : row.delivery_enabled ? "delivery" : "pickup"),
          );
        } else {
          setFul(null);
        }
      } catch {
        /* ignore — falls back to legacy checkout */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, cart.handle]);

  // Resolved fee for the selected method (mirrors the server's math so the
  // buyer sees the same number Stripe will charge).
  const shippingFee = (() => {
    if (!ful || !method) return 0;
    if (method === "pickup") return 0;
    if (method === "delivery") return Math.max(0, Number(ful.delivery_fee) || 0);
    if (ful.shipping_mode === "carrier") {
      // Live carrier rate: the buyer's pick drives the total. Until they pick,
      // the total shows merch only — the rate panel + "Pick a rate" CTA make
      // it clear shipping is still owed.
      return pickedRate ? pickedRate.amount_cents / 100 : 0;
    }
    const thr = Number(ful.shipping_free_threshold);
    if (Number.isFinite(thr) && thr > 0 && subtotal >= thr) return 0;
    return Math.max(0, Number(ful.shipping_flat_rate) || 0);
  })();

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

  // Focus management only — Esc and scroll-lock are already handled above,
  // so opt out of those to avoid double-binding. This moves focus into the
  // drawer on open, traps Tab inside it, and restores focus on close.
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(isOpen, closeCart, dialogRef, { onEscape: false, lockScroll: false });

  const startCheckout = async () => {
    if (!cart.handle) {
      setCheckoutError("Cart isn't scoped to a stylist yet.");
      setCheckoutState("error");
      return;
    }
    if (cart.items.length === 0) return;
    if (deliveryBlocked) {
      setCheckoutState("error");
      setCheckoutError("Enter a ZIP within the local delivery area, or choose another option.");
      return;
    }
    if (carrierBlocked) {
      setCheckoutState("error");
      setCheckoutError("Choose a shipping option before continuing.");
      return;
    }
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
          fulfillment_method: ful ? method : null,
          delivery_zip: method === "delivery" ? deliveryZip.trim() || null : null,
          shipping_rate_id: carrierShipping ? pickedRateId : null,
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
      ref={dialogRef}
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
              width: 44,
              height: 44,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
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
          {ful && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span
                style={{
                  fontSize: 11,
                  color: C.muted,
                  fontWeight: 700,
                  letterSpacing: "0.10em",
                  textTransform: "uppercase",
                }}
              >
                How would you like your order?
              </span>
              {(["shipping", "delivery", "pickup"] as const)
                .filter((m) =>
                  m === "shipping"
                    ? ful.shipping_enabled
                    : m === "delivery"
                      ? ful.delivery_enabled
                      : ful.pickup_enabled,
                )
                .map((m) => {
                  const selected = method === m;
                  const label =
                    m === "shipping" ? "Shipping" : m === "delivery" ? "Local delivery" : "Pickup";
                  // For live-rate shipping the row never shows a flat $ — the
                  // real number comes from the rate picker below.
                  const carrierShippingRow =
                    m === "shipping" && ful.shipping_mode === "carrier";
                  const fee =
                    m === "pickup"
                      ? 0
                      : m === "delivery"
                        ? Math.max(0, Number(ful.delivery_fee) || 0)
                        : carrierShippingRow
                          ? 0
                          : (() => {
                              const thr = Number(ful.shipping_free_threshold);
                              if (Number.isFinite(thr) && thr > 0 && subtotal >= thr) return 0;
                              return Math.max(0, Number(ful.shipping_flat_rate) || 0);
                            })();
                  const feeLabel = carrierShippingRow
                    ? "Real-time rates"
                    : fee === 0
                      ? "Free"
                      : fmt(fee);
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMethod(m)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                        width: "100%",
                        padding: "12px 14px",
                        borderRadius: 12,
                        border: `1.5px solid ${selected ? C.brandPrimary : C.brandBorder}`,
                        background: selected ? "rgba(124,58,237,0.06)" : "#FFFFFF",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                        <span
                          aria-hidden
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 999,
                            border: `2px solid ${selected ? C.brandPrimary : C.mutedSoft}`,
                            display: "grid",
                            placeItems: "center",
                            flexShrink: 0,
                          }}
                        >
                          {selected && (
                            <span style={{ width: 9, height: 9, borderRadius: 999, background: C.brandPrimary }} />
                          )}
                        </span>
                        <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                          <span style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>{label}</span>
                          {carrierShippingRow && (
                            <span style={{ fontSize: 11, color: C.muted, lineHeight: 1.3 }}>
                              Rates are calculated based on your delivery address.
                            </span>
                          )}
                          {m === "pickup" && (() => {
                            const eta = pickupEtaText(ful);
                            return eta ? (
                              <span style={{ fontSize: 11, color: C.muted, lineHeight: 1.3 }}>
                                {eta}. We&apos;ll email you when it&apos;s ready.
                              </span>
                            ) : null;
                          })()}
                        </span>
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: fee === 0 ? C.brandPrimary : C.ink }}>
                        {feeLabel}
                      </span>
                    </button>
                  );
                })}
              {deliveryLimited && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={deliveryZip}
                    onChange={(e) => {
                      const z = e.target.value.replace(/[^0-9]/g, "").slice(0, 5);
                      setDeliveryZip(z);
                      setDeliveryCheck({ status: "idle" });
                    }}
                    onBlur={() => runDeliveryCheck(deliveryZip)}
                    placeholder="Delivery ZIP code"
                    style={{
                      width: "100%",
                      padding: "11px 14px",
                      borderRadius: 12,
                      border: `1px solid ${
                        deliveryCheck.status === "out" ? C.brandError : C.brandBorder
                      }`,
                      background: "#FFFFFF",
                      color: C.ink,
                      fontSize: 13,
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                  {deliveryCheck.status === "checking" && (
                    <span style={{ fontSize: 11, color: C.muted }}>Checking your area…</span>
                  )}
                  {deliveryCheck.status === "ok" && deliveryCheck.miles != null && (
                    <span style={{ fontSize: 11, color: C.brandPrimary, fontWeight: 600 }}>
                      ✓ In delivery area ({deliveryCheck.miles} mi)
                    </span>
                  )}
                  {deliveryCheck.status === "out" && (
                    <span style={{ fontSize: 11, color: C.brandError, fontWeight: 600 }}>
                      {deliveryCheck.miles != null ? `~${deliveryCheck.miles} mi away — ` : ""}outside the
                      {deliveryCheck.radius ? ` ${deliveryCheck.radius} mi` : ""} delivery area. Choose pickup or shipping.
                    </span>
                  )}
                  {deliveryCheck.status === "error" && (
                    <span style={{ fontSize: 11, color: C.muted }}>Couldn&apos;t check that ZIP — try again.</span>
                  )}
                </div>
              )}
              {carrierShipping && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={shipZip}
                        onChange={(e) => {
                          const z = e.target.value.replace(/[^0-9]/g, "").slice(0, 5);
                          setShipZip(z);
                        }}
                        placeholder="ZIP code"
                        style={{
                          flex: 2,
                          padding: "11px 14px",
                          borderRadius: 12,
                          border: `1px solid ${C.brandBorder}`,
                          background: "#FFFFFF",
                          color: C.ink,
                          fontSize: 13,
                          outline: "none",
                          boxSizing: "border-box",
                        }}
                      />
                      <input
                        type="text"
                        value={shipState}
                        onChange={(e) => {
                          const s = e.target.value
                            .replace(/[^a-zA-Z]/g, "")
                            .slice(0, 2)
                            .toUpperCase();
                          setShipState(s);
                        }}
                        placeholder="State"
                        style={{
                          flex: 1,
                          padding: "11px 14px",
                          borderRadius: 12,
                          border: `1px solid ${C.brandBorder}`,
                          background: "#FFFFFF",
                          color: C.ink,
                          fontSize: 13,
                          outline: "none",
                          boxSizing: "border-box",
                          textTransform: "uppercase",
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={fetchCarrierRates}
                      disabled={rateState.status === "loading" || shipZip.length !== 5}
                      style={{
                        width: "100%",
                        padding: "11px 14px",
                        borderRadius: 12,
                        border: `1px solid ${C.brandPrimary}`,
                        background: rateState.status === "loading" ? "rgba(124,58,237,0.05)" : "#FFFFFF",
                        color: C.brandPrimary,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor:
                          rateState.status === "loading" || shipZip.length !== 5
                            ? "not-allowed"
                            : "pointer",
                        letterSpacing: "0.04em",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {rateState.status === "loading" ? "Loading…" : "Get shipping options"}
                    </button>
                  </div>
                  {rateState.status === "error" && (
                    <span style={{ fontSize: 11, color: C.brandError, fontWeight: 600 }}>
                      {rateState.message}
                    </span>
                  )}
                  {rateState.status === "ok" && rateStale && (
                    <span style={{ fontSize: 11, color: C.brandWarning, fontWeight: 600 }}>
                      Cart changed — get shipping options again.
                    </span>
                  )}
                  {rateState.status === "ok" && !rateStale && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {rateState.rates.map((r) => {
                        const selected = pickedRateId === r.id;
                        return (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => setPickedRateId(r.id)}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 10,
                              width: "100%",
                              padding: "10px 12px",
                              borderRadius: 10,
                              border: `1.5px solid ${selected ? C.brandPrimary : C.brandBorder}`,
                              background: selected ? "rgba(124,58,237,0.06)" : "#FFFFFF",
                              cursor: "pointer",
                              textAlign: "left",
                            }}
                          >
                            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                              <span style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>
                                {r.carrier} {r.service}
                              </span>
                              {r.estimated_days != null && (
                                <span style={{ fontSize: 11, color: C.muted }}>
                                  {r.estimated_days === 0
                                    ? "Same day"
                                    : `${r.estimated_days} business day${r.estimated_days === 1 ? "" : "s"}`}
                                </span>
                              )}
                            </span>
                            <span style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>
                              {fmt(r.amount_cents / 100)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {rateState.status === "idle" && (
                    <span style={{ fontSize: 11, color: C.muted }}>
                      Enter your ZIP code to see available shipping options.
                    </span>
                  )}
                </div>
              )}
            </div>
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
              <span style={{ fontSize: 13, color: C.muted, fontWeight: 600 }}>
                {ful ? "Total" : "Subtotal"}
              </span>
              <span style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 700, color: C.ink }}>
                {fmt(subtotal + shippingFee)}
              </span>
            </div>
            <p style={{ fontSize: 11, color: C.muted, margin: 0 }}>
              {ful ? "Tax calculated at checkout." : "Taxes + shipping calculated at checkout."}
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
              disabled={checkoutState === "loading" || deliveryBlocked || carrierBlocked}
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
                cursor:
                  checkoutState === "loading"
                    ? "wait"
                    : deliveryBlocked || carrierBlocked
                      ? "not-allowed"
                      : "pointer",
                opacity:
                  checkoutState === "loading" || deliveryBlocked || carrierBlocked ? 0.6 : 1,
              }}
            >
              {checkoutState === "loading"
                ? "Opening checkout…"
                : deliveryBlocked
                  ? "Confirm delivery ZIP"
                  : carrierBlocked
                    ? "Get shipping options"
                    : carrierShipping
                      ? "Continue to checkout"
                      : "Checkout"}
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
          <img src={item.image_url} alt={item.title || "Product"} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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
              aria-label="Decrease quantity"
              style={{ minWidth: 44, minHeight: 44, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 12px", background: "transparent", border: 0, color: C.ink, fontWeight: 700, cursor: "pointer" }}
            >
              −
            </button>
            <span style={{ minWidth: 24, textAlign: "center", fontSize: 13, fontWeight: 700, color: C.ink }}>
              {item.quantity}
            </span>
            <button
              type="button"
              onClick={() => onChange(item.quantity + 1)}
              aria-label="Increase quantity"
              disabled={atMax}
              style={{
                minWidth: 44,
                minHeight: 44,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "0 12px",
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
