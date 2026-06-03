// Client messaging — in-app threads between a stylist and their
// clients. Mirrors the waitlist.ts shape: types + an owner-side hook +
// a couple of anon helpers for the public client portal.
//
// A thread is anchored to a booking_request (the row that backs the
// client appointment portal). The stylist reads/writes the
// client_messages table directly under RLS; the anonymous portal goes
// through the public_list_client_messages / public_post_client_message
// SECURITY DEFINER RPCs keyed by portal_token.
//
// No Twilio / SMS — delivery is in-app (portal thread) plus an in-app
// bell + web push for the stylist (handled in SQL on insert).

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabase } from "./supabase";

export type MessageSender = "client" | "stylist";

export type ClientMessage = {
  id: string;
  booking_request_id: string;
  sender: MessageSender;
  body: string;
  read_by_owner: boolean;
  read_by_client: boolean;
  created_at: string;
};

// One conversation, grouped from the flat message rows + the
// booking_request metadata that gives it a human label.
export type MessageThread = {
  bookingRequestId: string;
  clientName: string;
  serviceName: string | null;
  preferredDate: string | null;
  messages: ClientMessage[];
  lastMessageAt: string;
  lastMessageBody: string;
  lastSender: MessageSender;
  unread: number; // client messages not yet read by the owner
};

// ---- Anon portal helpers (client side of /client/appointment/<token>)

export type PortalMessage = {
  id: string;
  sender: MessageSender;
  body: string;
  created_at: string;
};

export const listPortalMessages = async (
  token: string,
): Promise<{ ok: boolean; studioName: string; messages: PortalMessage[] }> => {
  const fallback = { ok: false, studioName: "your stylist", messages: [] as PortalMessage[] };
  if (!token) return fallback;
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc("public_list_client_messages", { token_in: token });
    if (error || !data || (data as any).ok !== true) return fallback;
    const v = data as any;
    return {
      ok: true,
      studioName: String(v.studio_name || "your stylist"),
      messages: Array.isArray(v.messages) ? (v.messages as PortalMessage[]) : [],
    };
  } catch {
    return fallback;
  }
};

export const postPortalMessage = async (
  token: string,
  body: string,
): Promise<boolean> => {
  const trimmed = (body || "").trim();
  if (!token || !trimmed) return false;
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc("public_post_client_message", {
      token_in: token,
      body_in: trimmed,
    });
    return !error && !!data && (data as any).ok === true;
  } catch {
    return false;
  }
};

// ---- Owner-side hook -------------------------------------------------

export const useClientMessages = (
  userId: string | null,
): {
  threads: MessageThread[];
  loading: boolean;
  error: string | null;
  unreadCount: number;
  refresh: () => Promise<void>;
  send: (bookingRequestId: string, body: string) => Promise<boolean>;
  markThreadRead: (bookingRequestId: string) => Promise<void>;
} => {
  const [messages, setMessages] = useState<ClientMessage[]>([]);
  const [meta, setMeta] = useState<
    Record<string, { clientName: string; serviceName: string | null; preferredDate: string | null }>
  >({});
  const [loading, setLoading] = useState<boolean>(!!userId);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) {
      setMessages([]);
      setMeta({});
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const supabase = getSupabase();
      const { data, error: msgErr } = await supabase
        .from("client_messages")
        .select("id, booking_request_id, sender, body, read_by_owner, read_by_client, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: true });
      if (msgErr) throw msgErr;
      const rows = (data || []) as ClientMessage[];
      setMessages(rows);

      // Pull the human label for each thread from booking_requests.
      const ids = Array.from(new Set(rows.map((r) => r.booking_request_id)));
      if (ids.length > 0) {
        const { data: brData } = await supabase
          .from("booking_requests")
          .select("id, client_name, service_name, preferred_date")
          .in("id", ids);
        const next: Record<string, { clientName: string; serviceName: string | null; preferredDate: string | null }> = {};
        for (const r of (brData || []) as any[]) {
          next[String(r.id)] = {
            clientName: String(r.client_name || "Client"),
            serviceName: r.service_name ? String(r.service_name) : null,
            preferredDate: r.preferred_date ? String(r.preferred_date) : null,
          };
        }
        setMeta(next);
      } else {
        setMeta({});
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load_failed");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    (async () => { if (!cancelled) await refresh(); })();
    if (!userId) return () => { cancelled = true; };
    // Light polling so a client reply shows up without a manual reload.
    const interval = window.setInterval(() => { void refresh(); }, 45_000);
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [userId, refresh]);

  const threads = useMemo<MessageThread[]>(() => {
    const byThread = new Map<string, ClientMessage[]>();
    for (const m of messages) {
      const list = byThread.get(m.booking_request_id) || [];
      list.push(m);
      byThread.set(m.booking_request_id, list);
    }
    const out: MessageThread[] = [];
    for (const [id, list] of byThread) {
      const sorted = [...list].sort((a, b) => a.created_at.localeCompare(b.created_at));
      const last = sorted[sorted.length - 1];
      const info = meta[id];
      out.push({
        bookingRequestId: id,
        clientName: info?.clientName || "Client",
        serviceName: info?.serviceName || null,
        preferredDate: info?.preferredDate || null,
        messages: sorted,
        lastMessageAt: last.created_at,
        lastMessageBody: last.body,
        lastSender: last.sender,
        unread: sorted.filter((m) => m.sender === "client" && !m.read_by_owner).length,
      });
    }
    // Most recent conversation first.
    out.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
    return out;
  }, [messages, meta]);

  const unreadCount = useMemo(
    () => threads.reduce((sum, t) => sum + t.unread, 0),
    [threads],
  );

  const send = useCallback(
    async (bookingRequestId: string, body: string): Promise<boolean> => {
      const trimmed = (body || "").trim();
      if (!userId || !bookingRequestId || !trimmed) return false;
      try {
        const supabase = getSupabase();
        const { data, error: insErr } = await supabase
          .from("client_messages")
          .insert({
            user_id: userId,
            booking_request_id: bookingRequestId,
            sender: "stylist",
            body: trimmed.slice(0, 4000),
            read_by_owner: true,
            read_by_client: false,
          })
          .select("id, booking_request_id, sender, body, read_by_owner, read_by_client, created_at")
          .single();
        if (insErr || !data) return false;
        setMessages((prev) => [...prev, data as ClientMessage]);
        return true;
      } catch {
        return false;
      }
    },
    [userId],
  );

  const markThreadRead = useCallback(
    async (bookingRequestId: string): Promise<void> => {
      if (!userId || !bookingRequestId) return;
      // Optimistic local update first.
      setMessages((prev) =>
        prev.map((m) =>
          m.booking_request_id === bookingRequestId && m.sender === "client" && !m.read_by_owner
            ? { ...m, read_by_owner: true }
            : m,
        ),
      );
      try {
        const supabase = getSupabase();
        await supabase
          .from("client_messages")
          .update({ read_by_owner: true })
          .eq("user_id", userId)
          .eq("booking_request_id", bookingRequestId)
          .eq("sender", "client")
          .eq("read_by_owner", false);
      } catch {
        /* best-effort; optimistic state already applied */
      }
    },
    [userId],
  );

  return { threads, loading, error, unreadCount, refresh, send, markThreadRead };
};
