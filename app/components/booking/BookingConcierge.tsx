"use client";

// Booking concierge — client-facing chat assistant on the booking page.
//
// A collapsed launcher (matching BuildYourStyle) opens a small chat panel.
// Each turn posts the full transcript to /api/booking-concierge, which
// answers from the stylist's REAL catalog + policy. When the model
// highlights a service, we surface a "Book this" button that selects it in
// the form above (onPickService) and closes the chat.
//
// The endpoint is stateless, so the transcript lives here in component
// state and is re-sent every turn.

import { useEffect, useRef, useState } from "react";
import {
  CONCIERGE_MAX_CHARS,
  type ConciergeMessage,
} from "../../lib/concierge";

type Props = {
  slug: string;
  accent?: string;
  businessName?: string | null;
  /** Highlight/select a suggested catalog service in the form above. */
  onPickService?: (serviceId: string) => void;
};

type ChatTurn = ConciergeMessage & { suggestedServiceId?: string | null };

export default function BookingConcierge({
  slug,
  accent = "#7C3AED",
  businessName,
  onPickService,
}: Props) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const biz = (businessName || "the stylist").trim();

  // Keep the latest message in view as the conversation grows.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [turns, sending]);

  const send = async () => {
    const text = draft.trim().slice(0, CONCIERGE_MAX_CHARS);
    if (!text || sending) return;
    setError(null);
    setDraft("");

    const history: ConciergeMessage[] = [
      ...turns.map((t) => ({ role: t.role, content: t.content })),
      { role: "user", content: text },
    ];
    setTurns((prev) => [...prev, { role: "user", content: text }]);
    setSending(true);
    try {
      const res = await fetch("/api/booking-concierge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, messages: history }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || "Couldn't get a reply.");
        return;
      }
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          content: String(body.reply || ""),
          suggestedServiceId: body.suggestedServiceId ?? null,
        },
      ]);
    } catch {
      setError("Couldn't reach the assistant. You can still book below.");
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ width: "100%", padding: 16, borderRadius: 16, border: `1px dashed ${accent}`, background: "#fff", textAlign: "left", cursor: "pointer" }}
      >
        <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#15111A" }}>Have a question? 💬</p>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6F6477" }}>Ask about styles, prices, timing, or policies — get an instant answer.</p>
      </button>
    );
  }

  const bubble = (role: ConciergeRoleLocal): React.CSSProperties => ({
    maxWidth: "85%",
    alignSelf: role === "user" ? "flex-end" : "flex-start",
    background: role === "user" ? accent : "#F2EEF6",
    color: role === "user" ? "#fff" : "#15111A",
    borderRadius: 14,
    padding: "9px 12px",
    fontSize: 13.5,
    lineHeight: 1.45,
    whiteSpace: "pre-wrap",
  });

  const input: React.CSSProperties = {
    flex: 1,
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(21,17,26,0.15)",
    fontSize: 14,
    background: "#fff",
    color: "#15111A",
  };

  return (
    <div style={{ border: `1px solid ${accent}33`, background: "#fff", borderRadius: 16, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#15111A" }}>Ask {biz}</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close chat"
          style={{ border: "none", background: "transparent", color: "#9F95A8", fontSize: 20, lineHeight: 1, cursor: "pointer", padding: 4 }}
        >
          ×
        </button>
      </div>

      <div
        ref={scrollRef}
        style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 320, overflowY: "auto", marginBottom: 12 }}
      >
        {turns.length === 0 && (
          <p style={{ ...bubble("assistant"), alignSelf: "flex-start" }}>
            Hi! Ask me anything about {biz}&apos;s styles, pricing, timing, or booking. 💛
          </p>
        )}
        {turns.map((t, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: t.role === "user" ? "flex-end" : "flex-start", gap: 6 }}>
            <span style={bubble(t.role)}>{t.content}</span>
            {t.role === "assistant" && t.suggestedServiceId && onPickService && (
              <button
                type="button"
                onClick={() => {
                  onPickService(t.suggestedServiceId!);
                  setOpen(false);
                }}
                style={{ alignSelf: "flex-start", border: `1px solid ${accent}`, background: "#fff", color: accent, fontWeight: 700, fontSize: 12.5, borderRadius: 999, padding: "6px 14px", cursor: "pointer" }}
              >
                Book this →
              </button>
            )}
          </div>
        ))}
        {sending && (
          <span style={{ ...bubble("assistant"), color: "#9F95A8" }}>typing…</span>
        )}
      </div>

      {error && <p style={{ margin: "0 0 8px", fontSize: 12.5, color: "#9C3D2E" }}>{error}</p>}

      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type your question…"
          maxLength={CONCIERGE_MAX_CHARS}
          style={input}
        />
        <button
          type="button"
          onClick={send}
          disabled={sending || !draft.trim()}
          style={{ border: "none", background: accent, color: "#fff", fontWeight: 700, fontSize: 14, borderRadius: 10, padding: "0 16px", cursor: sending || !draft.trim() ? "default" : "pointer", opacity: sending || !draft.trim() ? 0.6 : 1 }}
        >
          Send
        </button>
      </div>
      <p style={{ margin: "8px 0 0", fontSize: 11, color: "#9F95A8", textAlign: "center" }}>
        Answers are a guide — the stylist confirms final pricing and availability.
      </p>
    </div>
  );
}

type ConciergeRoleLocal = "user" | "assistant";
