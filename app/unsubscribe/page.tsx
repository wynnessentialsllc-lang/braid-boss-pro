"use client";

// Marketing-email unsubscribe — anon-callable, token-gated.
//
// The cron-enqueued rebook_nudge email puts a link here with
// ?token=<opaque>. The page calls public_unsubscribe_marketing(token)
// which flips clients.marketing_emails_enabled = false and returns
// enough context for a personalized confirmation. We never reveal
// whether a token is valid vs already-unsubscribed — both surface
// the same success card to avoid token-enumeration.
//
// No auth required. CAN-SPAM compliance lives here.

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getSupabase } from "../lib/supabase";

const C = {
  cream: "#FFFFFF",
  ivory: "#F6F2EC",
  espresso: "#15111A",
  coffee: "#3D3447",
  muted: "#6F6477",
  hairline: "rgba(21, 17, 26, 0.12)",
  success: "#5C7C4A",
  danger: "#9C3D2E",
} as const;
const FONT_DISPLAY = "'Cormorant Garamond', 'Playfair Display', Georgia, serif";

type State =
  | { kind: "loading" }
  | { kind: "ok"; clientName: string | null; studioName: string | null }
  | { kind: "error"; message: string };

const Inner = () => {
  const params = useSearchParams();
  const token = params?.get("token")?.trim() || "";
  // Missing-token is derivable from the URL, so seed it at init rather
  // than via a synchronous setState in the effect (which triggers a
  // cascading re-render).
  const [state, setState] = useState<State>(() =>
    token
      ? { kind: "loading" }
      : { kind: "error", message: "This unsubscribe link is missing its token." },
  );

  useEffect(() => {
    if (!token) return; // error already seeded via initial state
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase.rpc("public_unsubscribe_marketing", { token_in: token });
        if (cancelled) return;
        if (error) { setState({ kind: "error", message: error.message }); return; }
        // RPC returns a single-row table — pick row 0. ok=false means
        // the token didn't match any client at all.
        const row = Array.isArray(data) ? data[0] : data;
        if (!row || row.ok === false) {
          setState({ kind: "error", message: "This unsubscribe link doesn't match any record." });
          return;
        }
        setState({
          kind: "ok",
          clientName: row.client_name || null,
          studioName: row.studio_name || null,
        });
      } catch (e: any) {
        if (!cancelled) setState({ kind: "error", message: e?.message || "Couldn't process the request." });
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  return (
    <div style={{
      minHeight: "100dvh",
      background: C.cream,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 20,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      color: C.espresso,
    }}>
      <div style={{
        width: "100%",
        maxWidth: 440,
        background: "#FFFFFF",
        border: `1px solid ${C.hairline}`,
        borderRadius: 18,
        padding: 28,
        boxShadow: "0 8px 22px -10px rgba(21,17,26,0.18)",
      }}>
        {state.kind === "loading" && (
          <p style={{ textAlign: "center", color: C.muted, fontSize: 13 }}>One moment…</p>
        )}
        {state.kind === "ok" && (
          <>
            <div style={{
              width: 56, height: 56, borderRadius: 999, margin: "0 auto 14px",
              display: "grid", placeItems: "center",
              background: "rgba(92,124,74,0.10)",
            }}>
              <span style={{ color: C.success, fontSize: 26 }}>✓</span>
            </div>
            <h1 style={{
              fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 600,
              textAlign: "center", margin: "0 0 10px", lineHeight: 1.15,
            }}>
              You're unsubscribed
              {state.clientName ? `, ${state.clientName}` : ""}.
            </h1>
            <p style={{ textAlign: "center", fontSize: 14, color: C.coffee, lineHeight: 1.5, margin: "0 0 18px" }}>
              {state.studioName
                ? `You won't receive any more marketing emails from ${state.studioName}.`
                : "You won't receive any more marketing emails."}
            </p>
            <p style={{ textAlign: "center", fontSize: 12, color: C.muted, lineHeight: 1.5, margin: 0 }}>
              You'll still get transactional emails for any appointments you book (confirmations, balance receipts, etc.).
            </p>
          </>
        )}
        {state.kind === "error" && (
          <>
            <h1 style={{
              fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 600,
              textAlign: "center", margin: "0 0 10px", color: C.danger, lineHeight: 1.2,
            }}>
              We couldn&apos;t process this link.
            </h1>
            <p style={{ textAlign: "center", fontSize: 13, color: C.coffee, lineHeight: 1.5 }}>
              {state.message}
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default function UnsubscribePage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "#6F6477" }}>Loading…</div>}>
      <Inner />
    </Suspense>
  );
}
