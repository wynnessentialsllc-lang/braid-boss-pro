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

// ---- Last-minute opening broadcast -----------------------------------
//
// Emails active waitlist clients about a freed/last-minute opening so
// someone can grab it. Email-only (no SMS). First come, first served —
// the email links straight to the public booking page. Each recipient
// gets a uniquely-keyed queue row so re-broadcasting a later opening
// isn't deduped away.

export type OpeningDetails = {
  date: string;
  time?: string | null;
  serviceName?: string | null;
  note?: string | null;
};

export const broadcastWaitlistOpening = async (
  userId: string,
  opening: OpeningDetails,
  recipients: WaitlistRequest[],
): Promise<{ sent: number; total: number }> => {
  if (!userId) return { sent: 0, total: 0 };
  const targets = recipients.filter(
    (r) => r.client_email && (r.status === "waiting" || r.status === "contacted"),
  );
  if (targets.length === 0) return { sent: 0, total: 0 };

  const supabase = getSupabase();
  const origin = typeof window !== "undefined" ? window.location.origin : "https://braidbosspro.app";

  // Resolve the studio name + public booking URL for the email CTA.
  const { data: bl } = await supabase
    .from("booking_links")
    .select("slug, business_name")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const slug = (bl as any)?.slug as string | undefined;
  const bookUrl = slug ? `${origin}/book/${slug}` : origin;
  let studioName = ((bl as any)?.business_name as string | undefined) || "your stylist";
  try {
    const { data: studio } = await supabase.rpc("public_get_studio_name", { user_id_in: userId });
    if (typeof studio === "string" && studio.trim()) studioName = studio.trim();
  } catch { /* fall back to business_name */ }

  const stamp = Date.now();
  const whenBits = [opening.date, opening.time].filter(Boolean).join(" · ");
  let sent = 0;
  for (const r of targets) {
    try {
      const { error } = await supabase.rpc("queue_notification", {
        user_id_in: userId,
        channel_in: "email",
        notification_type_in: "waitlist_opening",
        body_in: `A last-minute opening just came up${whenBits ? ` (${whenBits})` : ""}. First to book it gets it: ${bookUrl}`,
        subject_in: `${studioName}: a last-minute opening just came up`,
        recipient_email_in: r.client_email,
        recipient_name_in: r.client_name || null,
        payload_in: {
          clientName: r.client_name || "there",
          studioName,
          date: opening.date || null,
          time: opening.time || null,
          serviceName: opening.serviceName || null,
          note: opening.note || null,
          bookUrl,
        },
        dedupe_key_in: `waitlist_opening:${r.id}:${stamp}`,
      });
      if (!error) sent += 1;
    } catch { /* skip this recipient */ }
  }
  return { sent, total: targets.length };
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
  //
  // converted_appointment_id is `text` to match the app's text-typed
  // appointment ids (`appt_<uid>`). The migration declares it as
  // text; if a previous deploy applied it as uuid, run:
  //   alter table public.waitlist_requests
  //   alter column converted_appointment_id type text
  //   using converted_appointment_id::text;
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
      // Owner-created entries are stamped source:"manual" so analytics can
      // tell them apart from public_waitlist self-joins. created_from_public
      // stays false (its column default).
      : await supabase.from("waitlist_requests").insert({ ...payload, source: "manual" }).select("*").maybeSingle();
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

// Best-effort booking-source detection for public links. Reads UTM
// params first (utm_source / source / ref), then falls back to the
// referrer hostname. Returns a normalized source key the app already
// understands (instagram / tiktok / facebook / google / yelp /
// direct_link), or null when nothing recognizable is present — callers
// then fall back to the generic "Booking link" bucket.
//
// Tip for stylists: append ?utm_source=instagram (or tiktok, etc.) to
// the link you drop in each bio to get exact attribution even when the
// referrer is stripped (which in-app browsers usually do).
const SOURCE_UTM_MAP: Record<string, string> = {
  ig: "instagram", insta: "instagram", instagram: "instagram",
  tiktok: "tiktok", tt: "tiktok",
  fb: "facebook", facebook: "facebook", meta: "facebook",
  google: "google", googleads: "google", adwords: "google", gmb: "google",
  yelp: "yelp",
  linkinbio: "direct_link", linktree: "direct_link", bio: "direct_link", link: "direct_link",
};
const KNOWN_SOURCES = ["instagram", "tiktok", "facebook", "google", "yelp", "direct_link"];

export const detectBookingSource = (): string | null => {
  if (typeof window === "undefined") return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const utm = (params.get("utm_source") || params.get("source") || params.get("ref") || "")
      .trim().toLowerCase();
    if (utm) {
      if (SOURCE_UTM_MAP[utm]) return SOURCE_UTM_MAP[utm];
      if (KNOWN_SOURCES.includes(utm)) return utm;
    }
    const ref = (typeof document !== "undefined" ? document.referrer : "").toLowerCase();
    if (ref) {
      if (ref.includes("instagram")) return "instagram";
      if (ref.includes("tiktok")) return "tiktok";
      if (ref.includes("facebook") || ref.includes("//fb.") || ref.includes(".fb.")) return "facebook";
      if (ref.includes("google")) return "google";
      if (ref.includes("yelp")) return "yelp";
    }
    return null;
  } catch {
    return null;
  }
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
  // Submit through the server route (rate-limited + owner-validated) rather
  // than inserting directly with the anon key. See app/api/waitlist-join.
  try {
    const res = await fetch("/api/waitlist-join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
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
        timezone: ctx.timezone,
        locale: ctx.locale,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      return { ok: false, error: (data as any)?.error || "Could not submit your request." };
    }
    return { ok: true, id: String((data as any).id) };
  } catch {
    return { ok: false, error: "Could not reach the server. Please try again." };
  }
};
