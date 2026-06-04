"use client";

// Read-only client appointment portal.
//
// Anonymous. The client opens this from a tokenized link
// (/client/appointment/<portal_token>). All data comes from the
// security-definer RPC `public_get_booking_portal_state` — the
// RLS-protected booking_requests table is never read directly. This
// is intentionally read-first: it surfaces everything the client
// needs to understand their appointment without texting the
// stylist, plus the cancel/reschedule links when still actionable.

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { getSupabase } from "../../../lib/supabase";
import { listPortalMessages, postPortalMessage, type PortalMessage } from "../../../lib/messages";

const C = {
  espresso: "#15111A", coffee: "#3D3447", paper: "#FFFFFF",
  ivory: "#F6F2EC", cream: "#FAF6EE",
  brandPrimary: "#7C3AED", brandDeep: "#5B21B6",
  gold: "#A8893F", muted: "#6F6477", hairline: "rgba(21, 17, 26, 0.12)",
  danger: "#9C3D2E", success: "#3F7D4F",
};
const FONT_DISPLAY = `"Cormorant Garamond", Georgia, serif`;
const FONT_BODY = `"DM Sans", "Inter", system-ui, sans-serif`;

type PortalState = {
  ok: true;
  request_id: string;
  studio_name: string;
  client_name: string | null;
  booked_for_name: string | null;
  service_name: string | null;
  approval_status: string;
  preferred_date: string | null;
  preferred_time: string | null;
  deposit_amount: number | null;
  deposit_paid: boolean | null;
  service_price: number | null;
  cancelled_at: string | null;
  reschedule_count: number | null;
  deposit_forfeited: boolean | null;
  deposit_rollover: boolean | null;
  selected_hair_color: string | null;
  selected_curl_pattern: string | null;
  client_style_notes: string | null;
  inspiration_photo_urls: string[] | null;
  selected_addons: Array<{ name?: string; price?: number }> | null;
  customization_summary: Record<string, any> | null;
  notes: string | null;
  service_meta: {
    hair_included?: boolean;
    included_hair_description?: string | null;
    included_details?: string | null;
    prep_instructions?: string | null;
  } | null;
  cancel_token: string | null;
  reschedule_token: string | null;
};

const fmtDate = (iso: string | null): string => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
};
const fmtTime = (hhmm: string | null): string => {
  if (!hhmm) return "";
  const [hStr, mStr] = hhmm.split(":");
  const h = Number(hStr); const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const period = h >= 12 ? "PM" : "AM";
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${String(m).padStart(2, "0")} ${period}`;
};
const money = (n: number | null | undefined) =>
  `$${(Number(n) || 0).toFixed(2)}`;

const STATUS_LABEL: Record<string, string> = {
  pending_review: "Awaiting review",
  approved_pending_deposit: "Approved · awaiting deposit",
  awaiting_deposit: "Awaiting deposit",
  deposit_paid_pending_approval: "Deposit paid · awaiting confirmation",
  approved: "Confirmed",
  confirmed: "Confirmed",
  denied: "Declined",
  declined: "Declined",
  cancelled: "Cancelled",
  expired: "Hold expired",
};

const Wrap = ({ children }: { children: React.ReactNode }) => (
  <div
    style={{
      minHeight: "100vh", background: C.ivory, color: C.espresso,
      fontFamily: FONT_BODY,
      padding: "32px 18px calc(40px + env(safe-area-inset-bottom, 0px))",
      paddingTop: "calc(28px + env(safe-area-inset-top, 0px))",
      WebkitFontSmoothing: "antialiased",
    }}
  >
    <style>{`@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=DM+Sans:wght@400;500;600;700;800&display=swap');`}</style>
    <div style={{ maxWidth: 520, margin: "0 auto" }}>{children}</div>
  </div>
);

const Card: React.FC<React.PropsWithChildren<{ pad?: number }>> = ({ children, pad = 20 }) => (
  <div style={{
    background: C.paper, borderRadius: 18, border: `1px solid ${C.hairline}`,
    padding: pad, boxShadow: "0 6px 22px -16px rgba(21,17,26,0.20)", marginBottom: 14,
  }}>
    {children}
  </div>
);

const Row = ({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) => (
  <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "8px 0", borderBottom: `1px solid ${C.hairline}` }}>
    <span style={{ fontSize: 13, color: C.muted }}>{label}</span>
    <span style={{ fontSize: 13, color: C.espresso, fontWeight: strong ? 700 : 500, textAlign: "right" }}>{value}</span>
  </div>
);

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: C.brandDeep, margin: "0 0 12px" }}>
    {children}
  </p>
);

const fmtMsgTime = (iso: string): string => {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
};

// In-app two-way thread between the client and their stylist. Reads +
// writes go through the anon SECURITY DEFINER RPCs keyed by the portal
// token — no auth, no Twilio. The stylist sees replies in their
// dashboard Inbox and gets a bell + push when the client sends one.
const MessageThread = ({ token, studioName }: { token: string; studioName: string }) => {
  const [messages, setMessages] = useState<PortalMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const load = async () => {
    const res = await listPortalMessages(token);
    if (res.ok) setMessages(res.messages);
    setLoaded(true);
  };

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => { if (!cancelled) await load(); })();
    const interval = window.setInterval(() => { void load(); }, 30_000);
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages.length]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    const ok = await postPortalMessage(token, body);
    setSending(false);
    if (ok) {
      setDraft("");
      // Optimistic append so the bubble shows immediately; reconciled
      // by the next poll.
      setMessages((prev) => [
        ...prev,
        { id: `local-${Date.now()}`, sender: "client", body, created_at: new Date().toISOString() },
      ]);
    }
  };

  return (
    <Card>
      <SectionTitle>Message {studioName}</SectionTitle>
      <div
        ref={listRef}
        style={{
          maxHeight: 280, overflowY: "auto", display: "flex", flexDirection: "column",
          gap: 8, marginBottom: 12, paddingRight: 2,
        }}
      >
        {!loaded && (
          <p style={{ margin: 0, fontSize: 13, color: C.muted, textAlign: "center", padding: "12px 0" }}>Loading…</p>
        )}
        {loaded && messages.length === 0 && (
          <p style={{ margin: 0, fontSize: 13, color: C.muted, textAlign: "center", lineHeight: 1.5, padding: "8px 0" }}>
            Have a question about your appointment? Send {studioName} a message — they&apos;ll see it right away.
          </p>
        )}
        {messages.map((m) => {
          const mine = m.sender === "client";
          return (
            <div key={m.id} style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start" }}>
              <div style={{ maxWidth: "82%" }}>
                <div style={{
                  background: mine ? C.brandPrimary : C.cream,
                  color: mine ? "#FFFFFF" : C.espresso,
                  borderRadius: 14, padding: "9px 13px", fontSize: 13.5, lineHeight: 1.45,
                  border: mine ? "none" : `1px solid ${C.hairline}`, whiteSpace: "pre-wrap", wordBreak: "break-word",
                }}>
                  {m.body}
                </div>
                <p style={{
                  margin: "3px 4px 0", fontSize: 10.5, color: C.muted, textAlign: mine ? "right" : "left",
                }}>
                  {mine ? "You" : studioName} · {fmtMsgTime(m.created_at)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
          }}
          placeholder="Write a message…"
          rows={2}
          style={{
            flex: 1, resize: "none", borderRadius: 12, border: `1px solid ${C.hairline}`,
            padding: "10px 12px", fontSize: 13.5, fontFamily: FONT_BODY, color: C.espresso,
            background: C.paper, outline: "none",
          }}
        />
        <button
          onClick={() => void send()}
          disabled={sending || !draft.trim()}
          style={{
            padding: "11px 16px", borderRadius: 12, border: "none",
            background: draft.trim() ? C.espresso : C.hairline,
            color: "#FFFFFF", fontSize: 13, fontWeight: 700, cursor: draft.trim() ? "pointer" : "default",
            whiteSpace: "nowrap",
          }}
        >
          {sending ? "…" : "Send"}
        </button>
      </div>
    </Card>
  );
};

export default function ClientAppointmentPortal() {
  const params = useParams();
  const token = useMemo(() => {
    const raw = params?.token;
    return Array.isArray(raw) ? raw[0] : raw || "";
  }, [params]);

  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<PortalState | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      const supabase = getSupabase();
      const { data, error } = await supabase.rpc("public_get_booking_portal_state", { token_in: token });
      if (cancelled) return;
      setLoading(false);
      if (error) { setErr("invalid"); return; }
      const res = data as any;
      if (!res?.ok) { setErr(res?.reason || "invalid"); return; }
      setState(res as PortalState);
    })();
    return () => { cancelled = true; };
  }, [token]);

  if (loading) {
    return <Wrap><Card><p style={{ margin: 0, textAlign: "center", color: C.muted }}>Loading your appointment…</p></Card></Wrap>;
  }
  if (err || !state) {
    return (
      <Wrap>
        <Card>
          <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 24, margin: "0 0 10px" }}>
            Link not found
          </h1>
          <p style={{ margin: 0, color: C.coffee, fontSize: 14, lineHeight: 1.55 }}>
            This appointment link is no longer valid. Reach out to your stylist directly.
          </p>
        </Card>
      </Wrap>
    );
  }

  const s = state;
  const meta = s.service_meta || {};
  const isCancelled = s.approval_status === "cancelled" || !!s.cancelled_at;
  const depositPaid = !!s.deposit_paid && Number(s.deposit_amount) > 0;
  const remaining = Number(s.service_price) > 0
    ? Math.max(0, Number(s.service_price) - (depositPaid ? Number(s.deposit_amount) : 0))
    : null;
  const cs = s.customization_summary || {};
  const hairColor = s.selected_hair_color || (cs.custom_hair_color ? `${cs.custom_hair_color} (custom)` : null);
  const curl = s.selected_curl_pattern || (cs.custom_curl_pattern ? `${cs.custom_curl_pattern} (custom)` : null);
  const addons = Array.isArray(s.selected_addons) ? s.selected_addons : [];
  const photos = Array.isArray(s.inspiration_photo_urls) ? s.inspiration_photo_urls : [];
  const base = typeof window !== "undefined" ? window.location.origin : "";
  const statusTone = isCancelled ? C.danger
    : (s.approval_status === "approved" || s.approval_status === "confirmed") ? C.success
    : C.gold;

  return (
    <Wrap>
      <div style={{ textAlign: "center", marginBottom: 18 }}>
        <p style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.22em", textTransform: "uppercase", color: C.brandPrimary, margin: 0 }}>
          {s.studio_name}
        </p>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 30, lineHeight: 1.1, margin: "8px 0 0", color: C.espresso }}>
          Your appointment
        </h1>
        <span style={{
          display: "inline-block", marginTop: 12, padding: "6px 14px", borderRadius: 999,
          background: statusTone, color: "#FFFFFF", fontSize: 12, fontWeight: 700,
          letterSpacing: "0.06em",
        }}>
          {STATUS_LABEL[s.approval_status] || s.approval_status}
        </span>
      </div>

      <Card>
        <SectionTitle>Appointment</SectionTitle>
        <Row label="Service" value={s.service_name || "—"} strong />
        {s.booked_for_name && <Row label="For" value={s.booked_for_name} />}
        <Row label="Date" value={fmtDate(s.preferred_date)} />
        <Row label="Time" value={s.preferred_time ? fmtTime(s.preferred_time) : "—"} />
        <Row label="Stylist" value={s.studio_name} />
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "8px 0" }}>
          <span style={{ fontSize: 13, color: C.muted }}>Client</span>
          <span style={{ fontSize: 13, color: C.espresso, fontWeight: 500 }}>{s.client_name || "—"}</span>
        </div>
      </Card>

      <Card>
        <SectionTitle>Payment</SectionTitle>
        <Row label="Deposit paid" value={depositPaid ? money(s.deposit_amount) : "$0.00"} />
        {remaining != null && (
          <Row label="Remaining balance" value={money(remaining)} strong />
        )}
        {s.deposit_forfeited && (
          <p style={{ margin: "10px 0 0", fontSize: 12, color: C.danger, lineHeight: 1.5 }}>
            Deposit forfeited per the stylist&apos;s cancellation policy.
          </p>
        )}
        {s.deposit_rollover && (
          <p style={{ margin: "10px 0 0", fontSize: 12, color: C.coffee, lineHeight: 1.5 }}>
            Your deposit rolled over to this appointment — no second charge.
          </p>
        )}
      </Card>

      {(meta.hair_included || hairColor || curl || s.client_style_notes || meta.included_details) && (
        <Card>
          <SectionTitle>Your booked style</SectionTitle>
          {meta.hair_included && (
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 10,
              padding: "6px 12px", borderRadius: 999,
              background: `linear-gradient(180deg, #C9A961, ${C.gold})`, color: "#FFFFFF",
              fontSize: 12, fontWeight: 700,
            }}>
              ✓ Hair included with this service
            </div>
          )}
          {meta.included_hair_description && (
            <p style={{ margin: "0 0 10px", fontSize: 13, color: C.coffee, lineHeight: 1.5 }}>
              {meta.included_hair_description}
            </p>
          )}
          {hairColor && <Row label="Hair color" value={hairColor} />}
          {curl && <Row label="Curl pattern" value={curl} />}
          {addons.length > 0 && (
            <Row label="Add-ons" value={addons.map(a => a?.name).filter(Boolean).join(", ") || "—"} />
          )}
          {s.client_style_notes && (
            <div style={{ paddingTop: 10 }}>
              <span style={{ fontSize: 12, color: C.muted }}>Style notes</span>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: C.espresso, lineHeight: 1.5 }}>{s.client_style_notes}</p>
            </div>
          )}
          {meta.included_details && (
            <div style={{ marginTop: 12, background: C.cream, borderRadius: 12, padding: 12 }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.coffee }}>What&apos;s included</span>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: C.coffee, lineHeight: 1.5 }}>{meta.included_details}</p>
            </div>
          )}
        </Card>
      )}

      {photos.length > 0 && (
        <Card>
          <SectionTitle>Inspiration photos</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            {photos.map((u, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={u} alt={`Inspiration ${i + 1}`}
                style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 12, border: `1px solid ${C.hairline}` }} />
            ))}
          </div>
        </Card>
      )}

      {meta.prep_instructions && (
        <Card>
          <SectionTitle>Prep instructions</SectionTitle>
          <p style={{ margin: 0, fontSize: 13, color: C.coffee, lineHeight: 1.6 }}>{meta.prep_instructions}</p>
        </Card>
      )}

      <MessageThread token={token} studioName={s.studio_name} />

      {!isCancelled && (s.cancel_token || s.reschedule_token) && (
        <Card>
          <SectionTitle>Need to make a change?</SectionTitle>
          {s.reschedule_token && (
            <a href={`${base}/booking-action/${s.reschedule_token}/reschedule`}
              style={{
                display: "block", textAlign: "center", padding: "13px 18px", borderRadius: 12,
                background: C.espresso, color: "#FFFFFF", textDecoration: "none",
                fontSize: 13, fontWeight: 700, letterSpacing: "0.04em", marginBottom: 10,
              }}>
              Reschedule appointment
            </a>
          )}
          {s.cancel_token && (
            <a href={`${base}/booking-action/${s.cancel_token}/cancel`}
              style={{
                display: "block", textAlign: "center", padding: "12px 18px", borderRadius: 12,
                background: "transparent", color: C.espresso, textDecoration: "none",
                fontSize: 13, fontWeight: 700, letterSpacing: "0.04em",
                border: `1.5px solid ${C.espresso}`,
              }}>
              Cancel appointment
            </a>
          )}
          <p style={{ margin: "12px 0 0", fontSize: 11, color: C.muted, textAlign: "center", lineHeight: 1.5 }}>
            Rescheduling keeps your deposit. Cancelling forfeits it per the stylist&apos;s policy.
          </p>
        </Card>
      )}

      <p style={{ textAlign: "center", fontSize: 11, color: C.muted, marginTop: 6 }}>
        Powered by Braid Boss Pro
      </p>
    </Wrap>
  );
}
