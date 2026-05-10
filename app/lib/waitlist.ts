// Waitlist V1 — owner-side hook + types.
//
// Public booking-page visitors INSERT directly via the anon-insert
// policy on waitlist_requests. The owner reads / updates / deletes
// via the standard self-* RLS policies.

import { useEffect, useState } from "react";
import { getSupabase } from "./supabase";

export type WaitlistStatus = "waiting" | "contacted" | "booked" | "declined" | "archived";
export type WaitlistFlexibility = "anytime" | "morning" | "afternoon" | "evening" | "specific";

export type WaitlistRequest = {
  id: string;
  user_id: string;
  client_name: string;
  client_phone: string | null;
  client_email: string | null;
  service_id: string | null;
  service_name: string | null;
  preferred_date: string | null;
  preferred_time: string | null;
  flexibility: WaitlistFlexibility | null;
  notes: string | null;
  status: WaitlistStatus;
  // Future-proofing fields (Phase A delta migration).
  source: string | null;                       // "public_waitlist" | "manual" | "imported" | "referral"
  tags: string[];
  contacted_at: string | null;
  converted_appointment_id: string | null;
  timezone: string | null;
  locale: string | null;
  created_from_public: boolean;
  created_at: string;
  updated_at: string;
};

export type WaitlistInput = Pick<
  WaitlistRequest,
  | "client_name"
  | "client_phone"
  | "client_email"
  | "service_id"
  | "service_name"
  | "preferred_date"
  | "preferred_time"
  | "flexibility"
  | "notes"
>;

export const WAITLIST_STATUS_LABEL: Record<WaitlistStatus, string> = {
  waiting:   "Waiting",
  contacted: "Contacted",
  booked:    "Booked",
  declined:  "Declined",
  archived:  "Archived",
};

export const WAITLIST_FLEX_LABEL: Record<WaitlistFlexibility, string> = {
  anytime:   "Anytime that day",
  morning:   "Morning",
  afternoon: "Afternoon",
  evening:   "Evening",
  specific:  "Specific time below",
};

const sanitize = (v: string | null | undefined) => {
  if (!v) return null;
  const t = String(v).trim();
  return t.length === 0 ? null : t;
};

// ---- Owner-side hook -------------------------------------------------

export const useWaitlist = (
  userId: string | null,
): {
  requests: WaitlistRequest[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setStatus: (id: string, status: WaitlistStatus) => Promise<boolean>;
  linkConvertedAppointment: (id: string, appointmentId: string) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  upsert: (draft: WaitlistInput & { id?: string }) => Promise<WaitlistRequest | null>;
  unreadCount: number;
} => {
  const [requests, setRequests] = useState<WaitlistRequest[]>([]);
  const [loading, setLoading] = useState<boolean>(!!userId);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (!userId) { setRequests([]); return; }
    setLoading(true);
    setError(null);
    const supabase = getSupabase();
    const { data, error: err } = await supabase
      .from("waitlist_requests")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setRequests((data || []) as WaitlistRequest[]);
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => { if (!cancelled) await refresh(); })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const setStatus: ReturnType<typeof useWaitlist>["setStatus"] = async (id, status) => {
    if (!userId) return false;
    const supabase = getSupabase();
    // Auto-stamp contacted_at on the first transition into
    // 'contacted' so the dashboards can later answer "average time
    // to contact" without a separate write.
    const patch: Record<string, any> = { status };
    if (status === "contacted") patch.contacted_at = new Date().toISOString();
    const { error: err } = await supabase
      .from("waitlist_requests")
      .update(patch)
      .eq("id", id)
      .eq("user_id", userId);
    if (err) { setError(err.message); return false; }
    setRequests(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
    return true;
  };

  // Stamp the linked appointment id when a request is converted.
  // Separated from setStatus because the caller needs the new
  // appointment id from upsertAppointment first.
  const linkConvertedAppointment = async (id: string, appointmentId: string) => {
    if (!userId) return false;
    const supabase = getSupabase();
    const { error: err } = await supabase
      .from("waitlist_requests")
      .update({ status: "booked", converted_appointment_id: appointmentId })
      .eq("id", id)
      .eq("user_id", userId);
    if (err) { setError(err.message); return false; }
    setRequests(prev => prev.map(r => r.id === id
      ? { ...r, status: "booked" as WaitlistStatus, converted_appointment_id: appointmentId }
      : r));
    return true;
  };

  const remove: ReturnType<typeof useWaitlist>["remove"] = async (id) => {
    if (!userId) return false;
    const supabase = getSupabase();
    const { error: err } = await supabase
      .from("waitlist_requests")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);
    if (err) { setError(err.message); return false; }
    setRequests(prev => prev.filter(r => r.id !== id));
    return true;
  };

  const upsert: ReturnType<typeof useWaitlist>["upsert"] = async (draft) => {
    if (!userId) return null;
    const name = sanitize(draft.client_name);
    if (!name) { setError("Name is required."); return null; }
    const supabase = getSupabase();
    const payload: Record<string, any> = {
      user_id: userId,
      client_name: name,
      client_phone: sanitize(draft.client_phone),
      client_email: sanitize(draft.client_email),
      service_id: draft.service_id || null,
      service_name: sanitize(draft.service_name),
      preferred_date: draft.preferred_date || null,
      preferred_time: sanitize(draft.preferred_time),
      flexibility: draft.flexibility || null,
      notes: sanitize(draft.notes),
    };
    const { data, error: err } = draft.id
      ? await supabase.from("waitlist_requests").update(payload).eq("id", draft.id).eq("user_id", userId).select("*").maybeSingle()
      : await supabase.from("waitlist_requests").insert(payload).select("*").maybeSingle();
    if (err || !data) { setError(err?.message || "Could not save."); return null; }
    setError(null);
    await refresh();
    return data as WaitlistRequest;
  };

  const unreadCount = requests.filter(r => r.status === "waiting").length;

  return { requests, loading, error, refresh, setStatus, linkConvertedAppointment, remove, upsert, unreadCount };
};

// ---- Anon-side insert (public booking page) --------------------------
// Single-use insert; reads user_id from the slug-resolved owner record
// passed in by the caller (the public page already does that lookup
// when it loads the booking link).
// Light-touch fingerprint of the browser session a public submission
// came from. Pure best-effort: every getter is wrapped so a hostile
// or stripped-down browser can't error the submit. Used by both
// waitlist + booking-request public flows.
export const collectPublicContext = (): { timezone: string | null; locale: string | null } => {
  if (typeof window === "undefined") return { timezone: null, locale: null };
  let timezone: string | null = null;
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { /* no-op */ }
  let locale: string | null = null;
  try { locale = (navigator?.language || (navigator as any)?.userLanguage || null); } catch { /* no-op */ }
  return { timezone, locale };
};

export const submitPublicWaitlistRequest = async (params: {
  ownerUserId: string;
  client_name: string;
  client_phone?: string | null;
  client_email?: string | null;
  service_id?: string | null;
  service_name?: string | null;
  preferred_date?: string | null;
  preferred_time?: string | null;
  flexibility?: WaitlistFlexibility | null;
  notes?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> => {
  const name = sanitize(params.client_name);
  if (!name) return { ok: false, error: "Name is required." };
  if (!params.ownerUserId) return { ok: false, error: "Booking link is misconfigured." };
  const ctx = collectPublicContext();
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("waitlist_requests")
    .insert({
      user_id: params.ownerUserId,
      client_name: name,
      client_phone: sanitize(params.client_phone),
      client_email: sanitize(params.client_email),
      service_id: params.service_id || null,
      service_name: sanitize(params.service_name),
      preferred_date: params.preferred_date || null,
      preferred_time: sanitize(params.preferred_time),
      flexibility: params.flexibility || null,
      notes: sanitize(params.notes),
      // Future-proofing — see migration 20260514100000:
      source: "public_waitlist",
      timezone: ctx.timezone,
      locale: ctx.locale,
      created_from_public: true,
    })
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: error?.message || "Could not submit your request." };
  return { ok: true, id: (data as any).id };
};
