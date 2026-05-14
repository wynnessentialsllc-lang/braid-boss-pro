"use client";

// /contract/[token] — legacy alias for public agreement signing page.
// Canonical route: /sign/contract/[token].
//
// Anonymous, mobile-first. Reads the contract via the security
// definer RPC `get_public_contract_by_token` (which auto-marks the
// row as viewed on first load) and lets the client sign or decline
// via the matching RPCs. Never reads the booking_contracts table
// directly — the token-scoped RPC is the only public surface.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { getSupabase } from "../../lib/supabase";

const C = {
  espresso: "#15111A", coffee: "#3D3447", cream: "#FFFFFF",
  ivory: "#F6F2EC", paper: "#FFFFFF",
  gold: "#7C3AED", goldDeep: "#5B21B6",
  muted: "#6F6477", hairline: "rgba(21, 17, 26, 0.12)",
  success: "#5C7C4A", danger: "#9C3D2E",
};
const FONT_DISPLAY = `"Cormorant Garamond", Georgia, serif`;
const FONT_BODY = `"DM Sans", "Inter", system-ui, sans-serif`;

type PublicContract = {
  id: string;
  title: string;
  body_snapshot: string;
  status: "sent" | "pending_signature" | "pending" | "viewed" | "signed" | "declined" | "expired" | "voided";
  client_name: string | null;
  client_email: string | null;
  signed_at: string | null;
  signed_date: string | null;
  viewed_at: string | null;
  expires_at: string | null;
  require_signature: boolean;
  require_initials: boolean;
  business_name: string | null;
  service_name: string | null;
  preferred_date: string | null;
  preferred_time: string | null;
};

const fmtDate = (iso: string | null): string => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
};

export default function ContractSigningPage() {
  const params = useParams();
  const token = useMemo(() => {
    const raw = params?.token;
    return Array.isArray(raw) ? raw[0] : raw || "";
  }, [params]);

  const [loading, setLoading] = useState(true);
  const [contract, setContract] = useState<PublicContract | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [signedName, setSignedName] = useState("");
  const [signature, setSignature] = useState("");
  const [initials, setInitials] = useState("");
  const [signedDate, setSignedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [agreeChecked, setAgreeChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<"signed" | "declined" | null>(null);
  const [showDecline, setShowDecline] = useState(false);
  const [declineReason, setDeclineReason] = useState("");

  const reload = useCallback(async () => {
    if (!token) { setLoadError("Missing signing token."); setLoading(false); return; }
    setLoading(true);
    setLoadError(null);
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc(
      "get_public_contract_by_token",
      { token_in: token },
    );
    if (error) { setLoadError(error.message); setLoading(false); return; }
    const row = Array.isArray(data) && data.length > 0 ? (data[0] as PublicContract) : null;
    setContract(row);
    if (row) {
      setSignedName(row.client_name || "");
    }
    setLoading(false);
  }, [token]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch on mount; same pattern as other pages
  useEffect(() => { void reload(); }, [reload]);

  const handleSign = async () => {
    if (!contract || submitting) return;
    setSubmitError(null);
    if (!agreeChecked) { setSubmitError("Please check the agreement box first."); return; }
    if (!signedName.trim()) { setSubmitError("Please type your full legal name."); return; }
    if (!signature.trim()) { setSubmitError("Please type your signature to confirm."); return; }
    if (contract.require_initials && !initials.trim()) {
      setSubmitError("This agreement requires your initials.");
      return;
    }
    setSubmitting(true);
    const supabase = getSupabase();
    const { error } = await supabase.rpc("sign_public_contract", {
      token_in: token,
      signed_name_in: signedName.trim(),
      signature_text_in: signature.trim(),
      initials_in: initials.trim() || null,
      signed_date_in: signedDate || new Date().toISOString().slice(0, 10),
      ip_address_in: null,
      user_agent_in: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 256) : null,
    });
    setSubmitting(false);
    if (error) { setSubmitError(error.message); return; }
    setOutcome("signed");
  };

  const handleDecline = async () => {
    if (!contract || submitting) return;
    setSubmitting(true);
    const supabase = getSupabase();
    const { error } = await supabase.rpc("decline_public_contract", {
      token_in: token,
      reason_in: declineReason.trim() || null,
      ip_address_in: null,
      user_agent_in: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 256) : null,
    });
    setSubmitting(false);
    if (error) { setSubmitError(error.message); return; }
    setOutcome("declined");
  };

  // Already-terminal states get the confirmation screen straight away.
  const terminalState =
    outcome === "signed" ||
    outcome === "declined" ||
    contract?.status === "signed" ||
    contract?.status === "declined" ||
    contract?.status === "voided" ||
    contract?.status === "expired";

  const apptLine = contract ? [
    contract.service_name,
    contract.preferred_date ? fmtDate(contract.preferred_date) : null,
    contract.preferred_time,
  ].filter(Boolean).join(" · ") : "";

  return (
    <div style={{ minHeight: "100dvh", background: C.cream, fontFamily: FONT_BODY, color: C.espresso }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=DM+Sans:wght@400;500;600;700&display=swap');
        * { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
        body { margin: 0; }
        input, textarea, select, button { font-family: inherit; }
      `}</style>

      <div
        className="mx-auto"
        style={{
          maxWidth: 480,
          padding: "32px 20px",
          paddingBottom: "calc(160px + env(safe-area-inset-bottom, 0px))",
        }}
      >
        <p style={{ textAlign: "center", letterSpacing: "0.22em", textTransform: "uppercase", fontSize: 10, fontWeight: 700, color: C.gold }}>
          Protected booking
        </p>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 32, fontWeight: 600, color: C.espresso, textAlign: "center", lineHeight: 1.1, marginTop: 8 }}>
          {contract?.title || "Appointment agreement"}
        </h1>
        {contract?.business_name && (
          <p style={{ fontSize: 13, color: C.muted, textAlign: "center", marginTop: 6 }}>
            from {contract.business_name}
          </p>
        )}

        {loading && (
          <p style={{ textAlign: "center", marginTop: 32, color: C.muted, fontSize: 13 }}>Loading agreement…</p>
        )}

        {!loading && (loadError || !contract) && (
          <div
            style={{
              marginTop: 32,
              padding: 20,
              borderRadius: 16,
              background: C.paper,
              border: `1px solid ${C.hairline}`,
              textAlign: "center",
            }}
          >
            <p style={{ fontFamily: FONT_DISPLAY, fontSize: 22, color: C.espresso, fontWeight: 600 }}>
              We couldn&apos;t open this agreement
            </p>
            <p style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>
              {loadError || "This signing link isn't valid. Ask your stylist to resend it."}
            </p>
          </div>
        )}

        {!loading && contract && terminalState && (
          <div
            style={{
              marginTop: 28,
              padding: 24,
              borderRadius: 16,
              background:
                outcome === "declined" || contract.status === "declined"
                  ? "rgba(156, 61, 46, 0.08)"
                  : "rgba(92, 124, 74, 0.08)",
              border: `1px solid ${outcome === "declined" || contract.status === "declined" ? "rgba(156, 61, 46, 0.35)" : "rgba(92, 124, 74, 0.35)"}`,
              textAlign: "center",
            }}
          >
            <p style={{ fontFamily: FONT_DISPLAY, fontSize: 24, fontWeight: 600, color: C.espresso }}>
              {outcome === "signed" || contract.status === "signed"
                ? "Signed and secured"
                : outcome === "declined" || contract.status === "declined"
                ? "Agreement declined"
                : contract.status === "expired"
                ? "Agreement expired"
                : "Agreement voided"}
            </p>
            <p style={{ fontSize: 13, color: C.coffee, marginTop: 8, lineHeight: 1.5 }}>
              {outcome === "signed" || contract.status === "signed"
                ? "Thank you. Your stylist has been notified and your appointment is on track."
                : "Your stylist has been notified. Reach out directly if you'd like to reschedule."}
            </p>
            {apptLine && (
              <p style={{ marginTop: 12, fontSize: 12, color: C.muted }}>{apptLine}</p>
            )}
          </div>
        )}

        {!loading && contract && !terminalState && (
          <>
            {apptLine && (
              <div
                style={{
                  marginTop: 18,
                  padding: 12,
                  borderRadius: 12,
                  background: C.paper,
                  border: `1px solid ${C.hairline}`,
                  textAlign: "center",
                  fontSize: 12,
                  color: C.coffee,
                }}
              >
                {apptLine}
              </div>
            )}

            <div
              style={{
                marginTop: 18,
                padding: 18,
                borderRadius: 16,
                background: C.paper,
                border: `1px solid ${C.hairline}`,
                whiteSpace: "pre-wrap",
                lineHeight: 1.55,
                fontSize: 14,
                color: C.coffee,
              }}
            >
              {contract.body_snapshot}
            </div>

            <label
              style={{
                marginTop: 18,
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
                fontSize: 14,
                lineHeight: 1.5,
                color: C.espresso,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={agreeChecked}
                onChange={e => setAgreeChecked(e.target.checked)}
                style={{ marginTop: 4, width: 18, height: 18, accentColor: C.goldDeep }}
              />
              <span>I have read and agree to this agreement.</span>
            </label>

            <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
              <Field label="Full legal name">
                <Input
                  value={signedName}
                  onChange={e => setSignedName(e.target.value)}
                  placeholder="e.g. Jasmine Carter"
                  autoComplete="name"
                />
              </Field>
              <Field label="Type your signature">
                <Input
                  value={signature}
                  onChange={e => setSignature(e.target.value)}
                  placeholder="Type your name to sign"
                  style={{
                    fontFamily: FONT_DISPLAY,
                    fontSize: 22,
                    fontStyle: "italic",
                    letterSpacing: "0.02em",
                  }}
                />
              </Field>
              {contract.require_initials && (
                <Field label="Initials">
                  <Input
                    value={initials}
                    onChange={e => setInitials(e.target.value.toUpperCase().slice(0, 4))}
                    placeholder="e.g. JC"
                    style={{
                      fontFamily: FONT_DISPLAY,
                      fontSize: 18,
                      letterSpacing: "0.16em",
                      textTransform: "uppercase",
                      maxWidth: 140,
                    }}
                  />
                </Field>
              )}
              <Field label="Date signed">
                <Input
                  type="date"
                  value={signedDate}
                  onChange={e => setSignedDate(e.target.value)}
                />
              </Field>
            </div>

            {showDecline && (
              <div style={{ marginTop: 16, padding: 12, borderRadius: 12, background: C.ivory, border: `1px solid ${C.hairline}` }}>
                <p style={{ fontSize: 12, color: C.coffee, marginBottom: 6 }}>
                  Optional note for your stylist:
                </p>
                <textarea
                  value={declineReason}
                  onChange={e => setDeclineReason(e.target.value)}
                  rows={2}
                  placeholder="Anything you'd like them to know"
                  style={{ ...inputStyle, padding: 10, resize: "none", lineHeight: 1.5 }}
                />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
                  <button
                    type="button"
                    onClick={() => setShowDecline(false)}
                    disabled={submitting}
                    style={ghostButtonStyle}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleDecline}
                    disabled={submitting}
                    style={{ ...primaryButtonStyle, background: C.danger, color: "#FFFFFF", border: `1px solid ${C.danger}` }}
                  >
                    {submitting ? "Sending…" : "Confirm decline"}
                  </button>
                </div>
              </div>
            )}

            {submitError && (
              <p style={{ fontSize: 12, color: C.danger, marginTop: 12 }}>{submitError}</p>
            )}
          </>
        )}
      </div>

      {/* Sticky bottom action — only shows in the active signing
          state. Avoids covering body content with a tall safe-area
          buffer on iPhones. */}
      {!loading && contract && !terminalState && !showDecline && (
        <div
          style={{
            position: "fixed",
            left: 0, right: 0, bottom: 0,
            padding: "14px 16px calc(14px + env(safe-area-inset-bottom, 0px))",
            background: `linear-gradient(180deg, rgba(250,245,236,0) 0%, ${C.cream} 30%)`,
            zIndex: 5,
          }}
        >
          <div className="mx-auto" style={{ maxWidth: 480, display: "grid", gap: 8 }}>
            <button
              type="button"
              onClick={handleSign}
              disabled={submitting}
              style={{ ...primaryButtonStyle, opacity: submitting ? 0.7 : 1 }}
            >
              {submitting ? "Signing…" : "Sign agreement"}
            </button>
            <button
              type="button"
              onClick={() => setShowDecline(true)}
              disabled={submitting}
              style={subtleButtonStyle}
            >
              Decline
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 12,
  border: `1px solid ${C.hairline}`,
  background: C.paper,
  color: C.espresso,
  fontSize: 15,
  outline: "none",
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label style={{ display: "block" }}>
    <span style={{ display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.coffee, marginBottom: 6 }}>{label}</span>
    {children}
  </label>
);

const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => {
  const { style, ...rest } = props;
  return <input {...rest} style={{ ...inputStyle, ...style }} />;
};

const primaryButtonStyle: React.CSSProperties = {
  padding: "14px 16px",
  borderRadius: 14,
  background: `linear-gradient(180deg, ${C.gold}, ${C.goldDeep})`,
  color: C.paper,
  border: `1px solid ${C.goldDeep}`,
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
  minHeight: 48,
};

const ghostButtonStyle: React.CSSProperties = {
  padding: "12px 16px",
  borderRadius: 12,
  background: C.paper,
  color: C.coffee,
  border: `1px solid ${C.hairline}`,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  minHeight: 44,
};

const subtleButtonStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  background: "transparent",
  color: C.muted,
  border: 0,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};
