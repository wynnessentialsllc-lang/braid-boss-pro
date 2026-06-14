"use client";

// Customer order tracking page. URL: /orders/<customer_token>
// Resolves the order anonymously via the public_get_order RPC —
// the token is non-secret but non-guessable, and the page renders
// only public-safe fields. After checkout the customer is sent
// here directly from the Stripe success_url + the order
// confirmation email links here as well.

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { getSupabase } from "../../lib/supabase";

const C = {
  cream: "#FFFFFF",
  paper: "#FFFFFF",
  ink: "#15111A",
  muted: "#6F6477",
  mutedSoft: "#9F95A8",
  brandPrimary: "#7C3AED",
  brandSecondary: "#FF4D6D",
  brandBorder: "#ECE7F2",
  brandSuccess: "#22C55E",
  brandWarning: "#FBBF24",
  brandError: "#EF4444",
};
const GRADIENTS = {
  primary: "linear-gradient(135deg, #7C3AED 0%, #FF4D6D 100%)",
  hero: "linear-gradient(160deg, #7C3AED 0%, #B14BE0 45%, #FF4D6D 100%)",
};
const FONT_DISPLAY = `"Cormorant Garamond", Georgia, serif`;
const FONT_BODY = `"DM Sans", "Inter", system-ui, sans-serif`;
const SHADOWS = {
  card: "0 4px 14px rgba(21, 17, 26, 0.06)",
  cardLifted: "0 12px 32px -12px rgba(21, 17, 26, 0.18)",
};

const fmtMoney = (n: number | null, currency = "USD") => {
  if (n == null) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
};

const fmtDateTime = (iso: string | null): string => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
};

type OrderRow = {
  id: string;
  customer_token: string;
  status: string;
  fulfillment_status: string;
  amount_total: number;
  currency: string;
  customer_email: string | null;
  customer_name: string | null;
  shipping_required: boolean;
  shipping_address: any;
  line_items: Array<any>;
  tracking_carrier: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  shipping_notes: string | null;
  paid_at: string | null;
  fulfilled_at: string | null;
  shipped_at: string | null;
  created_at: string;
  stylist_business_name: string | null;
  stylist_logo_url: string | null;
  stylist_handle: string | null;
  subtotal: number | null;
  shipping_cost: number | null;
  fulfillment_method: string | null;
  tax_amount: number | null;
};

const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  pending: { label: "Awaiting payment", tone: C.brandWarning },
  paid: { label: "Paid", tone: C.brandSuccess },
  unfulfilled: { label: "Preparing", tone: "#B45309" },
  fulfilled: { label: "Ready", tone: C.brandSuccess },
  shipped: { label: "Shipped", tone: C.brandPrimary },
  refunded: { label: "Refunded", tone: C.muted },
  canceled: { label: "Canceled", tone: C.brandError },
  failed: { label: "Failed", tone: C.brandError },
};

export default function OrderTrackingPage() {
  const params = useParams();
  const token = useMemo(() => {
    const raw = params?.token;
    const v = Array.isArray(raw) ? raw[0] : raw || "";
    return decodeURIComponent(v);
  }, [params]);

  const [order, setOrder] = useState<OrderRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Live Shippo tracking history. Fetched after the order resolves
  // (we need its customer_token); the buyer never sees the stylist's
  // Shippo token — /api/order-tracking proxies the call server-side.
  const [tracking, setTracking] = useState<{
    events: { status: string; status_details: string; status_date: string | null; location_city: string | null; location_state: string | null }[];
    status: string | null;
    eta: string | null;
  } | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const supabase = getSupabase();
      const { data, error: err } = await supabase.rpc("public_get_order", { token_in: token });
      if (cancelled) return;
      if (err) {
        setError(err.message);
        setOrder(null);
      } else {
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) {
          setError("We couldn't find that order.");
          setOrder(null);
        } else {
          setError(null);
          setOrder(row as OrderRow);
          // Best-effort live tracking. We fire it after the order row
          // resolves so the buyer sees the static fields immediately;
          // the timeline can fill in a moment later. Silent on failure
          // — the static tracking_url link is the canonical fallback.
          if (row.tracking_number) {
            try {
              const tres = await fetch("/api/order-tracking", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ token }),
              });
              const tb = await tres.json().catch(() => null);
              if (!cancelled && tb && Array.isArray(tb.events) && tb.events.length > 0) {
                setTracking(tb);
              }
            } catch { /* silent — static link still works */ }
          }
        }
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: C.cream, display: "grid", placeItems: "center", color: C.muted, fontFamily: FONT_BODY }}>
        Loading order…
      </div>
    );
  }
  if (error || !order) {
    return (
      <div style={{ minHeight: "100vh", background: C.cream, padding: 24, fontFamily: FONT_BODY }}>
        <div style={{ maxWidth: 480, margin: "60px auto 0", textAlign: "center", color: C.ink }}>
          <p style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 700 }}>Order not found</p>
          <p style={{ color: C.muted, marginTop: 8, fontSize: 13 }}>
            {error || "The link may be out of date — check the order confirmation email."}
          </p>
        </div>
      </div>
    );
  }

  const status = order.fulfillment_status === "unfulfilled" && order.status === "pending"
    ? "pending"
    : order.fulfillment_status === "unfulfilled" && order.status === "paid"
    ? "unfulfilled"
    : order.fulfillment_status;
  const meta = STATUS_LABEL[status] || { label: status, tone: C.muted };

  const lineItems = Array.isArray(order.line_items) ? order.line_items : [];
  const totalUnits = lineItems.reduce((s: number, i: any) => s + (Number(i?.quantity) || 1), 0);

  return (
    <div style={{ minHeight: "100vh", background: C.cream, fontFamily: FONT_BODY, color: C.ink }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=DM+Sans:wght@400;500;600;700&display=swap');
      `}</style>

      <div
        style={{
          height: 156,
          background: GRADIENTS.hero,
          position: "relative",
        }}
      >
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.18) 100%)" }} />
        <p
          aria-hidden
          style={{
            position: "absolute",
            top: 46,
            left: 0,
            right: 0,
            textAlign: "center",
            color: "rgba(255, 255, 255, 0.96)",
            fontSize: 15,
            fontWeight: 800,
            letterSpacing: "0.34em",
            textTransform: "uppercase",
            textShadow: "0 1px 10px rgba(21, 17, 26, 0.20)",
            margin: 0,
          }}
        >
          Braid Boss Pro
        </p>
      </div>

      <div className="mx-auto" style={{ maxWidth: 560, padding: "0 20px", marginTop: -44, position: "relative" }}>
        <div
          style={{
            background: C.paper,
            borderRadius: 24,
            border: `1px solid ${C.brandBorder}`,
            boxShadow: SHADOWS.cardLifted,
            padding: 20,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 14,
                overflow: "hidden",
                background: GRADIENTS.primary,
                border: `3px solid ${C.cream}`,
                flexShrink: 0,
              }}
            >
              {order.stylist_logo_url && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={order.stylist_logo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: C.brandPrimary, letterSpacing: "0.18em", textTransform: "uppercase", margin: 0 }}>
                Order from
              </p>
              <p style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 700, color: C.ink, margin: "2px 0 0", lineHeight: 1.1 }}>
                {order.stylist_business_name || "Your stylist"}
              </p>
            </div>
          </div>
          <div
            style={{
              marginTop: 14,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "5px 12px",
              borderRadius: 999,
              background: `${meta.tone}1A`,
              color: meta.tone,
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: 999, background: meta.tone }} />
            {meta.label}
          </div>
        </div>

        <section style={{ marginTop: 20 }}>
          <h2 style={{ fontSize: 11, fontWeight: 800, color: C.muted, letterSpacing: "0.14em", textTransform: "uppercase", margin: 0 }}>
            Items
          </h2>
          <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0", display: "flex", flexDirection: "column", gap: 10 }}>
            {lineItems.map((i: any, idx: number) => (
              <li
                key={idx}
                style={{
                  display: "flex",
                  gap: 12,
                  padding: 12,
                  background: C.paper,
                  border: `1px solid ${C.brandBorder}`,
                  borderRadius: 16,
                }}
              >
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 12,
                    overflow: "hidden",
                    background: "#F6F2EC",
                    flexShrink: 0,
                  }}
                >
                  {i?.image_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={i.image_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <div style={{ width: "100%", height: "100%", background: GRADIENTS.primary }} />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 700, color: C.ink, margin: 0, lineHeight: 1.2 }}>
                    {i?.title || "Product"}
                  </p>
                  {i?.variant_name && (
                    <p style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                      {i?.variant_label || "Option"}:{" "}
                      <span style={{ color: C.ink, fontWeight: 600 }}>{i.variant_name}</span>
                    </p>
                  )}
                  <p style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
                    Qty {i?.quantity || 1} · {fmtMoney(Number(i?.unit_amount || 0), order.currency)}
                  </p>
                </div>
                <p style={{ fontSize: 14, fontWeight: 700, color: C.ink, margin: 0, alignSelf: "center" }}>
                  {fmtMoney(Number(i?.unit_amount || 0) * Number(i?.quantity || 1), order.currency)}
                </p>
              </li>
            ))}
          </ul>
          {order.subtotal != null && order.fulfillment_method && (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6, padding: "0 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, color: C.muted }}>Subtotal</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>
                  {fmtMoney(Number(order.subtotal || 0), order.currency)}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, color: C.muted }}>
                  {order.fulfillment_method === "pickup"
                    ? "Pickup"
                    : order.fulfillment_method === "delivery"
                      ? "Local delivery"
                      : "Shipping"}
                </span>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: Number(order.shipping_cost || 0) === 0 ? C.brandSuccess : C.ink,
                  }}
                >
                  {Number(order.shipping_cost || 0) === 0
                    ? "Free"
                    : fmtMoney(Number(order.shipping_cost || 0), order.currency)}
                </span>
              </div>
              {order.tax_amount != null && Number(order.tax_amount) > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, color: C.muted }}>Tax</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>
                    {fmtMoney(Number(order.tax_amount || 0), order.currency)}
                  </span>
                </div>
              )}
            </div>
          )}
          <div
            style={{
              marginTop: 14,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              padding: "12px 16px",
              borderRadius: 16,
              background: "#FBFAFD",
              border: `1px solid ${C.brandBorder}`,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 700, color: C.muted }}>Total · {totalUnits} item{totalUnits === 1 ? "" : "s"}</span>
            <span style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 700, color: C.ink }}>
              {fmtMoney(Number(order.amount_total || 0), order.currency)}
            </span>
          </div>
        </section>

        {(order.tracking_number || order.tracking_url) && (
          <section style={{ marginTop: 20 }}>
            <h2 style={{ fontSize: 11, fontWeight: 800, color: C.muted, letterSpacing: "0.14em", textTransform: "uppercase", margin: 0 }}>
              Tracking
            </h2>
            <div
              style={{
                marginTop: 12,
                padding: 16,
                background: C.paper,
                border: `1px solid ${C.brandBorder}`,
                borderRadius: 16,
              }}
            >
              {order.tracking_carrier && (
                <p style={{ fontSize: 12, color: C.muted, margin: 0, textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 700 }}>
                  {order.tracking_carrier}
                </p>
              )}
              {order.tracking_number && (
                <p style={{ fontSize: 14, fontWeight: 700, color: C.ink, margin: "4px 0 0" }}>
                  {order.tracking_number}
                </p>
              )}
              {order.tracking_url && (
                <a
                  href={order.tracking_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "inline-block",
                    marginTop: 10,
                    padding: "8px 14px",
                    background: GRADIENTS.primary,
                    color: "#FFFFFF",
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 800,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    textDecoration: "none",
                  }}
                >
                  Track shipment
                </a>
              )}
            </div>
          </section>
        )}

        {tracking && tracking.events.length > 0 && (
          <section style={{ marginTop: 20 }}>
            <h2 style={{ fontSize: 11, fontWeight: 800, color: C.muted, letterSpacing: "0.14em", textTransform: "uppercase", margin: 0 }}>
              Tracking history
            </h2>
            <ul style={{ marginTop: 12, padding: 0, listStyle: "none" }}>
              {tracking.events.slice(0, 12).map((e, i) => {
                const when = e.status_date
                  ? new Date(e.status_date).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })
                  : "";
                const place = [e.location_city, e.location_state].filter(Boolean).join(", ");
                const isFirst = i === 0;
                return (
                  <li
                    key={`${e.status_date || i}-${e.status}-${i}`}
                    style={{
                      position: "relative",
                      paddingLeft: 18,
                      paddingBottom: 12,
                      borderLeft: `2px solid ${isFirst ? "#7C3AED" : C.brandBorder}`,
                      marginLeft: 6,
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        position: "absolute",
                        left: -7,
                        top: 0,
                        width: 12,
                        height: 12,
                        borderRadius: 999,
                        background: isFirst ? "#7C3AED" : C.brandBorder,
                        border: `2px solid ${C.paper}`,
                      }}
                    />
                    <p style={{ fontSize: 13, fontWeight: 700, color: C.ink, margin: 0, lineHeight: 1.3 }}>
                      {e.status_details || e.status}
                    </p>
                    <p style={{ fontSize: 11, color: C.muted, margin: "2px 0 0" }}>
                      {[when, place].filter(Boolean).join(" · ")}
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {order.shipping_required && order.shipping_address && (
          <section style={{ marginTop: 20 }}>
            <h2 style={{ fontSize: 11, fontWeight: 800, color: C.muted, letterSpacing: "0.14em", textTransform: "uppercase", margin: 0 }}>
              Shipping to
            </h2>
            <div style={{ marginTop: 8, fontSize: 13, color: C.ink, lineHeight: 1.4 }}>
              {order.customer_name && <div style={{ fontWeight: 700 }}>{order.customer_name}</div>}
              {order.shipping_address?.line1 && <div>{order.shipping_address.line1}</div>}
              {order.shipping_address?.line2 && <div>{order.shipping_address.line2}</div>}
              {(order.shipping_address?.city || order.shipping_address?.state || order.shipping_address?.postal_code) && (
                <div>
                  {[order.shipping_address?.city, order.shipping_address?.state, order.shipping_address?.postal_code]
                    .filter(Boolean)
                    .join(", ")}
                </div>
              )}
            </div>
          </section>
        )}

        {order.shipping_notes && (
          <section style={{ marginTop: 20 }}>
            <h2 style={{ fontSize: 11, fontWeight: 800, color: C.muted, letterSpacing: "0.14em", textTransform: "uppercase", margin: 0 }}>
              Notes from your stylist
            </h2>
            <p style={{ fontSize: 13, color: C.ink, marginTop: 8, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
              {order.shipping_notes}
            </p>
          </section>
        )}

        <section style={{ marginTop: 20, marginBottom: 40 }}>
          <h2 style={{ fontSize: 11, fontWeight: 800, color: C.muted, letterSpacing: "0.14em", textTransform: "uppercase", margin: 0 }}>
            Order details
          </h2>
          <dl style={{ marginTop: 10, fontSize: 12, color: C.ink, display: "grid", gap: 6 }}>
            <Row k="Order placed" v={fmtDateTime(order.created_at)} />
            {order.paid_at && <Row k="Paid" v={fmtDateTime(order.paid_at)} />}
            {order.fulfilled_at && <Row k="Fulfilled" v={fmtDateTime(order.fulfilled_at)} />}
            {order.shipped_at && <Row k="Shipped" v={fmtDateTime(order.shipped_at)} />}
            <Row k="Order ref" v={order.customer_token} mono />
          </dl>
          {order.stylist_handle && (
            <p style={{ marginTop: 14, fontSize: 12, color: C.muted }}>
              Questions? Visit{" "}
              <a
                href={`/@${encodeURIComponent(order.stylist_handle)}`}
                style={{ color: C.brandPrimary, fontWeight: 700, textDecoration: "none" }}
              >
                @{order.stylist_handle}
              </a>
              .
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

const Row = ({ k, v, mono }: { k: string; v: string; mono?: boolean }) => (
  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
    <span style={{ color: C.muted }}>{k}</span>
    <span style={{ fontWeight: 600, fontFamily: mono ? "monospace" : undefined, wordBreak: "break-all" }}>
      {v}
    </span>
  </div>
);
