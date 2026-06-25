"use client";

// Client quote-view — URL: /requests/<client_token>
//
// The anon client lands here after posting an Open Style Request (and from
// the "you got a quote" email). Resolves the request + its quotes via the
// public_get_request_quotes RPC; each quote links straight to that braider's
// booking page. The token is non-secret but non-guessable, and the RPC only
// exposes public-safe fields.

import { Suspense, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  getRequestQuotes,
  type RequestView,
} from "../../lib/style-request-post";
import { styleLabel } from "../../lib/marketplace";

const C = {
  cream: "#FFFFFF",
  ivory: "#F6F2EC",
  espresso: "#15111A",
  coffee: "#3D3447",
  gold: "#7C3AED",
  goldDeep: "#5B21B6",
  muted: "#6F6477",
  hairline: "rgba(21, 17, 26, 0.12)",
} as const;
const FONT_DISPLAY = "'Cormorant Garamond', 'Playfair Display', Georgia, serif";

const money = (n: number | null) => (n == null ? null : `$${Math.round(n)}`);

const Inner = () => {
  const params = useParams();
  const token = String((params?.token as string) || "");
  const [view, setView] = useState<RequestView | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seeds error/loaded state on mount, intentional
    if (!token) { setErr("This link is missing its token."); setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const v = await getRequestQuotes(token);
        if (!cancelled) {
          if (!v) setErr("We couldn't find this request.");
          setView(v);
        }
      } catch {
        if (!cancelled) setErr("Couldn't load your request right now.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const budget = view
    ? (view.budgetMin != null && view.budgetMax != null
        ? `${money(view.budgetMin)}–${money(view.budgetMax)}`
        : money(view.budgetMin) || money(view.budgetMax))
    : null;

  return (
    <div style={{
      minHeight: "100dvh", background: C.cream, color: C.espresso,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      paddingTop: "max(28px, env(safe-area-inset-top))",
      paddingBottom: "max(40px, calc(env(safe-area-inset-bottom) + 24px))",
      paddingLeft: 18, paddingRight: 18,
    }}>
      <div style={{ width: "100%", maxWidth: 480, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: "0.24em", textTransform: "uppercase", color: C.goldDeep }}>
            Braid Boss Pro
          </p>
          <h1 style={{ margin: "6px 0 0", fontFamily: FONT_DISPLAY, fontSize: 28, fontWeight: 600, color: C.espresso, lineHeight: 1.1 }}>
            Your style request
          </h1>
        </div>

        {loading ? (
          <p style={{ textAlign: "center", color: C.muted, fontSize: 13, padding: "40px 0" }}>Loading…</p>
        ) : err ? (
          <p style={{ textAlign: "center", color: "#9C3D2E", fontSize: 13, padding: "40px 0" }}>{err}</p>
        ) : view ? (
          <>
            {/* Request summary */}
            <div style={{ background: C.ivory, border: `1px solid ${C.hairline}`, borderRadius: 16, padding: 14, marginBottom: 18 }}>
              {view.styleTags.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {view.styleTags.map(t => (
                    <span key={t} style={{ fontSize: 11, fontWeight: 600, color: C.coffee, background: "#FFFFFF", border: `1px solid ${C.hairline}`, borderRadius: 999, padding: "3px 9px" }}>
                      {styleLabel(t)}
                    </span>
                  ))}
                </div>
              )}
              <p style={{ fontSize: 12, color: C.muted, margin: "10px 0 0" }}>
                {[view.city, budget ? `Budget ${budget}` : null].filter(Boolean).join(" · ") || "—"}
              </p>
              {view.notes && (
                <p style={{ fontSize: 13, color: C.coffee, margin: "8px 0 0", lineHeight: 1.5 }}>{view.notes}</p>
              )}
            </div>

            {/* Quotes */}
            {view.quotes.length > 0 ? (
              <>
                <p style={{ fontSize: 12, color: C.muted, margin: "0 0 10px" }}>
                  {view.quotes.length} quote{view.quotes.length === 1 ? "" : "s"} from braiders
                </p>
                {view.quotes.map((q, i) => (
                  <div key={i} style={{ background: "#FFFFFF", border: `1px solid ${C.hairline}`, borderRadius: 16, padding: 16, marginBottom: 12 }}>
                    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                      {q.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={q.logoUrl} alt="" style={{ width: 48, height: 48, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
                      ) : (
                        <div style={{ width: 48, height: 48, borderRadius: 10, background: C.ivory, display: "grid", placeItems: "center", fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 600, color: C.goldDeep, flexShrink: 0 }}>
                          {(q.businessName || "?").trim().charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <p style={{ margin: 0, fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600, color: C.espresso, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {q.businessName}
                        </p>
                        <p style={{ margin: "2px 0 0", fontSize: 15, fontWeight: 700, color: C.goldDeep }}>{money(q.price)}</p>
                      </div>
                    </div>
                    {q.message && (
                      <p style={{ fontSize: 13, color: C.coffee, margin: "10px 0 0", lineHeight: 1.5 }}>{q.message}</p>
                    )}
                    {q.slug && (
                      <a href={`/book/${encodeURIComponent(q.slug)}`} style={{
                        display: "block", textAlign: "center", marginTop: 12, padding: "11px 14px",
                        fontSize: 13, fontWeight: 700, color: "#FFFFFF", background: C.espresso,
                        borderRadius: 999, textDecoration: "none", letterSpacing: "0.03em",
                      }}>
                        Book with {q.businessName}
                      </a>
                    )}
                  </div>
                ))}
              </>
            ) : (
              <div style={{ textAlign: "center", padding: "40px 12px" }}>
                <p style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 600, color: C.espresso, margin: 0 }}>
                  No quotes yet
                </p>
                <p style={{ fontSize: 13, color: C.muted, margin: "8px 0 0", lineHeight: 1.5 }}>
                  Braiders who do your style will send quotes here. We&apos;ll email you when they do — check back soon.
                </p>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
};

export default function RequestQuotesPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "#6F6477" }}>Loading…</div>}>
      <Inner />
    </Suspense>
  );
}
