"use client";

// Post-checkout page for the Braid Boss Pro Store.
//
// Stripe redirects here with ?token=<customer_token>&session_id=... after
// payment. We POST to /api/store-order which — if the webhook hasn't
// landed yet — confirms the session with Stripe directly and fulfills the
// order, then returns the order + ready-to-use download links. So the
// buyer can download the instant they arrive, and the same page (linked
// from the confirmation email) works later with just ?token=.

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Download, Loader2, CheckCircle2, Mail } from "lucide-react";

const C = {
  paper: "#FFFFFF",
  ink: "#15111A",
  coffee: "#3D3447",
  muted: "#6F6477",
  mutedSoft: "#9F95A8",
  brandPrimary: "#7C3AED",
  brandBorder: "#ECE7F2",
  brandSurface: "#FBFAFD",
  brandSuccess: "#22C55E",
};
const FONT_DISPLAY = `"Cormorant Garamond", Georgia, serif`;
const GRADIENT = "linear-gradient(135deg, #7C3AED 0%, #FF4D6D 100%)";
const GLOW = "0 10px 28px -10px rgba(124, 58, 237, 0.45), 0 4px 12px -4px rgba(255, 77, 109, 0.30)";

type OrderItem = {
  slug: string;
  name: string;
  quantity: number;
  unitAmount: number | null;
  isDigital: boolean;
  downloadUrl: string | null;
};
type Order = {
  status: string;
  currency: string;
  amountTotal: number | null;
  buyerEmail: string | null;
  items: OrderItem[];
};

function SuccessInner() {
  const params = useSearchParams();
  const token = params?.get("token") || "";
  const sessionId = params?.get("session_id") || "";

  // Initial state derives from the token (available at first render), so a
  // missing token lands on "error" without a setState-in-effect.
  const [state, setState] = useState<"loading" | "ready" | "pending" | "error">(
    token ? "loading" : "error",
  );
  const [order, setOrder] = useState<Order | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    let tries = 0;

    const load = async () => {
      try {
        const res = await fetch("/api/store-order", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token, session_id: sessionId || undefined }),
        });
        const data = (await res.json().catch(() => ({}))) as { order?: Order; error?: string };
        if (cancelled) return;
        if (!res.ok || !data.order) {
          setState("error");
          return;
        }
        setOrder(data.order);
        if (data.order.status === "paid") {
          setState("ready");
        } else {
          // Payment may still be settling — retry a few times, backing off.
          setState("pending");
          tries += 1;
          if (tries <= 4) {
            setTimeout(load, 2000 * tries);
          }
        }
      } catch {
        if (!cancelled) setState("error");
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [token, sessionId]);

  const digital = (order?.items || []).filter((i) => i.isDigital);

  return (
    <div style={{ minHeight: "100dvh", background: C.brandSurface, display: "grid", placeItems: "center", padding: 24 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=DM+Sans:wght@400;500;600;700;800&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        .bbp-spin { animation: spin 0.9s linear infinite; }
      `}</style>

      <div
        className="w-full"
        style={{
          maxWidth: 460,
          background: C.paper,
          border: `1px solid ${C.brandBorder}`,
          borderRadius: 24,
          padding: 28,
          textAlign: "center",
          fontFamily: `"DM Sans", system-ui, sans-serif`,
          boxShadow: "0 2px 6px rgba(21,17,26,0.05), 0 22px 48px -22px rgba(21,17,26,0.24)",
        }}
      >
        {state === "loading" || state === "pending" ? (
          <>
            <div
              aria-hidden
              style={{
                width: 60,
                height: 60,
                borderRadius: 999,
                background: GRADIENT,
                display: "grid",
                placeItems: "center",
                margin: "0 auto 16px",
                boxShadow: GLOW,
              }}
            >
              <Loader2 size={28} color="#FFFFFF" className="bbp-spin" />
            </div>
            <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 600, color: C.ink, margin: 0 }}>
              {state === "pending" ? "Confirming your payment…" : "Loading your order…"}
            </h1>
            <p style={{ color: C.muted, fontSize: 14, marginTop: 8 }}>
              {state === "pending"
                ? "This only takes a moment. Your download will appear here as soon as it clears."
                : "One second."}
            </p>
          </>
        ) : state === "error" ? (
          <>
            <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 600, color: C.ink, margin: 0 }}>
              We couldn&apos;t find that order
            </h1>
            <p style={{ color: C.muted, fontSize: 14, marginTop: 8 }}>
              If you just paid, check your email for your receipt and download link. Need help? Email{" "}
              <a href="mailto:hello@braidbosspro.app" style={{ color: C.brandPrimary }}>
                hello@braidbosspro.app
              </a>
              .
            </p>
            <Link href="/store" style={backBtn}>
              Back to the store
            </Link>
          </>
        ) : (
          <>
            <div
              aria-hidden
              style={{
                width: 60,
                height: 60,
                borderRadius: 999,
                background: GRADIENT,
                display: "grid",
                placeItems: "center",
                margin: "0 auto 16px",
                boxShadow: GLOW,
                color: "#FFFFFF",
              }}
            >
              <CheckCircle2 size={30} />
            </div>
            <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 28, fontWeight: 600, color: C.ink, margin: 0, lineHeight: 1.1 }}>
              You&apos;re all set!
            </h1>
            <p style={{ color: C.muted, fontSize: 14, marginTop: 8 }}>
              Payment received. {digital.length > 0 ? "Your download is ready below" : "Your order is confirmed"}
              {order?.buyerEmail ? (
                <>
                  {" "}
                  — a copy is on its way to <strong style={{ color: C.coffee }}>{order.buyerEmail}</strong>.
                </>
              ) : (
                "."
              )}
            </p>

            {digital.length > 0 && (
              <div style={{ marginTop: 20, display: "grid", gap: 10 }}>
                {digital.map((item) =>
                  item.downloadUrl ? (
                    <a
                      key={item.slug}
                      href={item.downloadUrl}
                      className="inline-flex items-center justify-center"
                      style={{
                        gap: 8,
                        padding: "15px 20px",
                        borderRadius: 14,
                        background: GRADIENT,
                        color: "#FFFFFF",
                        fontSize: 14,
                        fontWeight: 800,
                        letterSpacing: "0.04em",
                        textDecoration: "none",
                        boxShadow: GLOW,
                      }}
                    >
                      <Download size={17} /> Download {item.name}
                    </a>
                  ) : null,
                )}
              </div>
            )}

            <p
              className="inline-flex items-center justify-center"
              style={{ gap: 6, fontSize: 12, color: C.mutedSoft, marginTop: 16 }}
            >
              <Mail size={13} /> We also emailed your receipt and download link.
            </p>

            <div style={{ height: 1, background: C.brandBorder, margin: "20px 0" }} />
            <Link href="/store" style={{ ...backBtn, background: "transparent", color: C.brandPrimary, border: `1.5px solid ${C.brandPrimary}`, boxShadow: "none" }}>
              Keep shopping
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

const backBtn: React.CSSProperties = {
  display: "inline-block",
  marginTop: 20,
  padding: "13px 22px",
  borderRadius: 14,
  background: GRADIENT,
  color: "#FFFFFF",
  fontSize: 13,
  fontWeight: 800,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  textDecoration: "none",
  boxShadow: GLOW,
};

export default function StoreSuccessPage() {
  return (
    <Suspense
      fallback={
        <div style={{ minHeight: "100dvh", background: "#FBFAFD", display: "grid", placeItems: "center", color: "#6F6477" }}>
          Loading…
        </div>
      }
    >
      <SuccessInner />
    </Suspense>
  );
}
