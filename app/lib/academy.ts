// Braider Academy — public data layer for Classes + Video Lessons.
//
// Client-side fetchers that hit the SECURITY DEFINER RPCs so the
// anonymous /@handle/classes and /@handle/videos storefront pages can
// read a braider's published catalog through the canonical-slug
// resolver — plus thin wrappers that kick off the server checkout
// routes. Mirrors app/lib/storefront.ts.

import { getSupabase } from "./supabase";

// ============================================================
// Classes
// ============================================================

export type PublicClass = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  cover_image_url: string | null;
  format: "in_person" | "virtual";
  price: number;
  currency: string;
  capacity: number | null;
  seats_remaining: number | null; // null = unlimited
  starts_at: string | null;
  duration_minutes: number | null;
  timezone: string | null;
  is_featured: boolean;
};

export type PublicClassDetail = PublicClass & {
  user_id: string;
  stylist_account_id: string | null;
  stylist_charges_enabled: boolean;
};

const mapClass = (r: any): PublicClass => ({
  id: String(r.id),
  title: String(r.title || ""),
  slug: String(r.slug || ""),
  description: r.description ?? null,
  cover_image_url: r.cover_image_url ?? null,
  format: r.format === "virtual" ? "virtual" : "in_person",
  price: Number(r.price || 0),
  currency: String(r.currency || "usd"),
  capacity: r.capacity == null ? null : Number(r.capacity),
  seats_remaining: r.seats_remaining == null ? null : Number(r.seats_remaining),
  starts_at: r.starts_at ?? null,
  duration_minutes: r.duration_minutes == null ? null : Number(r.duration_minutes),
  timezone: r.timezone ?? null,
  is_featured: !!r.is_featured,
});

export const fetchPublicClasses = async (
  slug: string,
): Promise<{ ok: true; classes: PublicClass[] } | { ok: false; error: string }> => {
  if (!slug) return { ok: false, error: "Missing storefront." };
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("public_list_classes", { slug_in: slug });
  if (error) return { ok: false, error: error.message };
  return { ok: true, classes: ((data || []) as any[]).map(mapClass) };
};

export const fetchPublicClass = async (
  slug: string,
  classSlug: string,
): Promise<{ ok: true; klass: PublicClassDetail } | { ok: false; error: string }> => {
  if (!slug || !classSlug) return { ok: false, error: "Missing class." };
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("public_get_class", {
    slug_in: slug,
    class_slug_in: classSlug,
  });
  if (error) return { ok: false, error: error.message };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false, error: "That class isn't available." };
  return {
    ok: true,
    klass: {
      ...mapClass(row),
      user_id: String(row.user_id || ""),
      stylist_account_id: row.stylist_account_id ?? null,
      stylist_charges_enabled: !!row.stylist_charges_enabled,
    },
  };
};

export type ClassRegistration = {
  status: "pending" | "paid" | "refunded" | "cancelled" | "failed";
  class_title: string;
  format: "in_person" | "virtual";
  starts_at: string | null;
  duration_minutes: number | null;
  timezone: string | null;
  seats: number;
  student_name: string | null;
  location_text: string | null; // populated only when paid
  meeting_url: string | null; // populated only when paid
};

export const fetchClassRegistration = async (
  token: string,
): Promise<{ ok: true; registration: ClassRegistration } | { ok: false; error: string }> => {
  if (!token) return { ok: false, error: "Missing confirmation token." };
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("public_get_class_registration", { token_in: token });
  if (error) return { ok: false, error: error.message };
  const r = Array.isArray(data) ? data[0] : data;
  if (!r) return { ok: false, error: "We couldn't find that sign-up." };
  return {
    ok: true,
    registration: {
      status: r.status,
      class_title: String(r.class_title || ""),
      format: r.format === "virtual" ? "virtual" : "in_person",
      starts_at: r.starts_at ?? null,
      duration_minutes: r.duration_minutes == null ? null : Number(r.duration_minutes),
      timezone: r.timezone ?? null,
      seats: Number(r.seats || 1),
      student_name: r.student_name ?? null,
      location_text: r.location_text ?? null,
      meeting_url: r.meeting_url ?? null,
    },
  };
};

export const startClassCheckout = async (input: {
  handle: string;
  classSlug: string;
  seats: number;
  studentName: string;
  studentEmail: string;
}): Promise<{ ok: true; url: string } | { ok: false; error: string }> => {
  try {
    const res = await fetch("/api/class-checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        handle: input.handle,
        class_slug: input.classSlug,
        seats: input.seats,
        student_name: input.studentName,
        student_email: input.studentEmail,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.url) {
      return { ok: false, error: body?.error || "Couldn't start checkout. Try again in a moment." };
    }
    return { ok: true, url: String(body.url) };
  } catch {
    return { ok: false, error: "Network error — check your connection and try again." };
  }
};

// ============================================================
// Video Lessons
// ============================================================

export type PublicVideo = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  cover_image_url: string | null;
  preview_url: string | null;
  price: number;
  currency: string;
  access_model: "buy" | "rent";
  rental_days: number | null;
  is_featured: boolean;
};

export type PublicVideoDetail = PublicVideo & {
  user_id: string;
  stylist_account_id: string | null;
  stylist_charges_enabled: boolean;
};

const mapVideo = (r: any): PublicVideo => ({
  id: String(r.id),
  title: String(r.title || ""),
  slug: String(r.slug || ""),
  description: r.description ?? null,
  cover_image_url: r.cover_image_url ?? null,
  preview_url: r.preview_url ?? null,
  price: Number(r.price || 0),
  currency: String(r.currency || "usd"),
  access_model: r.access_model === "rent" ? "rent" : "buy",
  rental_days: r.rental_days == null ? null : Number(r.rental_days),
  is_featured: !!r.is_featured,
});

export const fetchPublicVideos = async (
  slug: string,
): Promise<{ ok: true; videos: PublicVideo[] } | { ok: false; error: string }> => {
  if (!slug) return { ok: false, error: "Missing storefront." };
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("public_list_videos", { slug_in: slug });
  if (error) return { ok: false, error: error.message };
  return { ok: true, videos: ((data || []) as any[]).map(mapVideo) };
};

export const fetchPublicVideo = async (
  slug: string,
  videoSlug: string,
): Promise<{ ok: true; video: PublicVideoDetail } | { ok: false; error: string }> => {
  if (!slug || !videoSlug) return { ok: false, error: "Missing video." };
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("public_get_video", {
    slug_in: slug,
    video_slug_in: videoSlug,
  });
  if (error) return { ok: false, error: error.message };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false, error: "That video isn't available." };
  return {
    ok: true,
    video: {
      ...mapVideo(row),
      user_id: String(row.user_id || ""),
      stylist_account_id: row.stylist_account_id ?? null,
      stylist_charges_enabled: !!row.stylist_charges_enabled,
    },
  };
};

export type VideoAccess =
  | {
      ok: true;
      title: string;
      description: string | null;
      access_url: string | null;
      access_model: "buy" | "rent";
      access_expires_at: string | null;
      buyer_name: string | null;
    }
  | { ok: false; reason: string };

export const fetchVideoAccess = async (token: string): Promise<VideoAccess> => {
  if (!token) return { ok: false, reason: "invalid_token" };
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("public_get_video_access", { token_in: token });
  if (error) return { ok: false, reason: "error" };
  const r = Array.isArray(data) ? data[0] : data;
  if (!r) return { ok: false, reason: "not_found" };
  if (!r.ok) return { ok: false, reason: String(r.reason || "unavailable") };
  return {
    ok: true,
    title: String(r.title || ""),
    description: r.description ?? null,
    access_url: r.access_url ?? null,
    access_model: r.access_model === "rent" ? "rent" : "buy",
    access_expires_at: r.access_expires_at ?? null,
    buyer_name: r.buyer_name ?? null,
  };
};

export const startVideoCheckout = async (input: {
  handle: string;
  videoSlug: string;
  buyerName: string;
  buyerEmail: string;
}): Promise<{ ok: true; url: string } | { ok: false; error: string }> => {
  try {
    const res = await fetch("/api/video-checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        handle: input.handle,
        video_slug: input.videoSlug,
        buyer_name: input.buyerName,
        buyer_email: input.buyerEmail,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.url) {
      return { ok: false, error: body?.error || "Couldn't start checkout. Try again in a moment." };
    }
    return { ok: true, url: String(body.url) };
  } catch {
    return { ok: false, error: "Network error — check your connection and try again." };
  }
};

// ============================================================
// Shared helpers
// ============================================================

// Human "when" for a class start, in the braider's timezone when set.
export const formatClassWhen = (startsAt: string | null, tz: string | null): string => {
  if (!startsAt) return "Date to be announced";
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: tz || undefined,
    }).format(new Date(startsAt));
  } catch {
    return new Date(startsAt).toLocaleString();
  }
};

export const videoAccessLabel = (model: "buy" | "rent", rentalDays: number | null): string =>
  model === "rent" && rentalDays
    ? `${rentalDays}-day access`
    : "Lifetime access";

// ============================================================
// Owner-side management (braider dashboard, Phase 2)
// ============================================================
//
// These talk directly to the RLS'd tables via the authenticated
// Supabase client: class_offerings / video_lessons carry an owner-all
// policy (the braider CRUDs their own catalog), and class_registrations
// / video_purchases carry an owner-select policy (the braider reads
// their own rosters + sales). Mirrors app/lib/storefront.ts useProducts.

import { useEffect, useState } from "react";

// Slugify a title the same shape the storefront uses, then de-dupe
// against slugs already in the caller's list so a new row never
// collides with the (user_id, slug) unique index.
const slugify = (s: string): string =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "item";

const uniqueSlug = (title: string, taken: Set<string>): string => {
  const base = slugify(title);
  if (!taken.has(base)) return base;
  for (let i = 2; i < 500; i++) {
    const candidate = `${base}-${i}`.slice(0, 63);
    if (!taken.has(candidate)) return candidate;
  }
  // Astronomically unlikely fallback — keep it deterministic-ish by
  // length so we never loop forever.
  return `${base}-${taken.size + 1}`;
};

export type MyClass = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  cover_image_url: string | null;
  format: "in_person" | "virtual";
  price: number;
  currency: string;
  capacity: number | null;
  starts_at: string | null;
  duration_minutes: number | null;
  timezone: string | null;
  location_text: string | null;
  meeting_url: string | null;
  status: "draft" | "published" | "canceled";
  is_featured: boolean;
  sort_order: number;
};

// price is non-null on a saved row, but the editor holds `null` for an
// empty field until save (upsert coerces null → 0).
export type MyClassDraft = Partial<Omit<MyClass, "id" | "price">> & { id?: string; price?: number | null };

export const useMyClasses = (userId: string | null) => {
  const [classes, setClasses] = useState<MyClass[]>([]);
  const [loading, setLoading] = useState<boolean>(!!userId);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (!userId) {
      setClasses([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const supabase = getSupabase();
    const { data, error: err } = await supabase
      .from("class_offerings")
      .select("*")
      .eq("user_id", userId)
      .order("starts_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setClasses((data || []) as MyClass[]);
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await refresh();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const upsert = async (draft: MyClassDraft): Promise<MyClass | null> => {
    if (!userId) return null;
    const supabase = getSupabase();
    // Normalize the payload columns from the draft.
    const payload: Record<string, unknown> = {
      title: (draft.title || "").trim(),
      description: draft.description?.trim() || null,
      cover_image_url: draft.cover_image_url || null,
      format: draft.format === "virtual" ? "virtual" : "in_person",
      price: Number(draft.price || 0),
      capacity:
        draft.capacity == null || draft.capacity === ("" as unknown)
          ? null
          : Math.max(0, Math.floor(Number(draft.capacity))),
      starts_at: draft.starts_at || null,
      duration_minutes:
        draft.duration_minutes == null || draft.duration_minutes === ("" as unknown)
          ? null
          : Math.max(1, Math.floor(Number(draft.duration_minutes))),
      timezone: draft.timezone || null,
      location_text: draft.location_text?.trim() || null,
      meeting_url: draft.meeting_url?.trim() || null,
      status: draft.status || "draft",
      is_featured: !!draft.is_featured,
    };
    if (!payload.title) {
      setError("Give your class a title.");
      return null;
    }
    if (draft.id) {
      const { data, error: err } = await supabase
        .from("class_offerings")
        .update(payload)
        .eq("id", draft.id)
        .eq("user_id", userId)
        .select("*")
        .maybeSingle();
      if (err || !data) {
        setError(err?.message || "Couldn't save.");
        return null;
      }
      await refresh();
      return data as MyClass;
    }
    const taken = new Set(classes.map((c) => c.slug));
    payload.user_id = userId;
    payload.slug = uniqueSlug(String(payload.title), taken);
    const { data, error: err } = await supabase
      .from("class_offerings")
      .insert(payload)
      .select("*")
      .maybeSingle();
    if (err || !data) {
      setError(err?.message || "Couldn't create the class.");
      return null;
    }
    await refresh();
    return data as MyClass;
  };

  const remove = async (id: string): Promise<boolean> => {
    if (!userId) return false;
    const supabase = getSupabase();
    const { error: err } = await supabase
      .from("class_offerings")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);
    if (err) {
      setError(err.message);
      return false;
    }
    setClasses((prev) => prev.filter((c) => c.id !== id));
    return true;
  };

  return { classes, loading, error, refresh, upsert, remove };
};

export type ClassRosterEntry = {
  id: string;
  student_name: string | null;
  student_email: string | null;
  seats: number;
  amount_total: number;
  status: string;
  paid_at: string | null;
  created_at: string;
};

export const fetchClassRoster = async (
  userId: string,
  classId: string,
): Promise<{ ok: true; roster: ClassRosterEntry[] } | { ok: false; error: string }> => {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("class_registrations")
    .select("id, student_name, student_email, seats, amount_total, status, paid_at, created_at")
    .eq("user_id", userId)
    .eq("class_id", classId)
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, roster: (data || []) as ClassRosterEntry[] };
};

export type MyVideo = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  cover_image_url: string | null;
  preview_url: string | null;
  access_url: string | null;
  price: number;
  currency: string;
  access_model: "buy" | "rent";
  rental_days: number | null;
  status: "draft" | "published";
  is_featured: boolean;
  sort_order: number;
};

export type MyVideoDraft = Partial<Omit<MyVideo, "id" | "price">> & { id?: string; price?: number | null };

export const useMyVideos = (userId: string | null) => {
  const [videos, setVideos] = useState<MyVideo[]>([]);
  const [loading, setLoading] = useState<boolean>(!!userId);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (!userId) {
      setVideos([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const supabase = getSupabase();
    const { data, error: err } = await supabase
      .from("video_lessons")
      .select("*")
      .eq("user_id", userId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setVideos((data || []) as MyVideo[]);
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await refresh();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const upsert = async (draft: MyVideoDraft): Promise<MyVideo | null> => {
    if (!userId) return null;
    const supabase = getSupabase();
    const model = draft.access_model === "rent" ? "rent" : "buy";
    const rentalDays =
      model === "rent"
        ? Math.max(1, Math.floor(Number(draft.rental_days || 30)))
        : null;
    const payload: Record<string, unknown> = {
      title: (draft.title || "").trim(),
      description: draft.description?.trim() || null,
      cover_image_url: draft.cover_image_url || null,
      preview_url: draft.preview_url?.trim() || null,
      access_url: draft.access_url?.trim() || null,
      price: Number(draft.price || 0),
      access_model: model,
      rental_days: rentalDays,
      status: draft.status || "draft",
      is_featured: !!draft.is_featured,
    };
    if (!payload.title) {
      setError("Give your video a title.");
      return null;
    }
    if (draft.id) {
      const { data, error: err } = await supabase
        .from("video_lessons")
        .update(payload)
        .eq("id", draft.id)
        .eq("user_id", userId)
        .select("*")
        .maybeSingle();
      if (err || !data) {
        setError(err?.message || "Couldn't save.");
        return null;
      }
      await refresh();
      return data as MyVideo;
    }
    const taken = new Set(videos.map((v) => v.slug));
    payload.user_id = userId;
    payload.slug = uniqueSlug(String(payload.title), taken);
    const { data, error: err } = await supabase
      .from("video_lessons")
      .insert(payload)
      .select("*")
      .maybeSingle();
    if (err || !data) {
      setError(err?.message || "Couldn't create the video.");
      return null;
    }
    await refresh();
    return data as MyVideo;
  };

  const remove = async (id: string): Promise<boolean> => {
    if (!userId) return false;
    const supabase = getSupabase();
    const { error: err } = await supabase
      .from("video_lessons")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);
    if (err) {
      setError(err.message);
      return false;
    }
    setVideos((prev) => prev.filter((v) => v.id !== id));
    return true;
  };

  return { videos, loading, error, refresh, upsert, remove };
};

export type VideoSaleEntry = {
  id: string;
  buyer_name: string | null;
  buyer_email: string | null;
  amount_total: number;
  status: string;
  access_expires_at: string | null;
  paid_at: string | null;
  created_at: string;
};

export const fetchVideoSales = async (
  userId: string,
  videoId: string,
): Promise<{ ok: true; sales: VideoSaleEntry[] } | { ok: false; error: string }> => {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("video_purchases")
    .select("id, buyer_name, buyer_email, amount_total, status, access_expires_at, paid_at, created_at")
    .eq("user_id", userId)
    .eq("video_id", videoId)
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, sales: (data || []) as VideoSaleEntry[] };
};

// datetime-local <-> ISO helpers for the class start-time field.
// The <input type="datetime-local"> value is wall-clock in the
// braider's own timezone; we round-trip through the Date constructor
// so what they pick is what gets stored (as an absolute instant).
export const isoToLocalInput = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
};

export const localInputToIso = (local: string): string | null => {
  if (!local) return null;
  const d = new Date(local);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
};

// ============================================================
// Class waitlist (Phase 3)
// ============================================================

// Public: join a full class's waitlist. Resolves + inserts via the
// SECURITY DEFINER RPC; a repeat email for the same class is a no-op.
export const joinClassWaitlist = async (input: {
  handle: string;
  classSlug: string;
  name: string;
  email: string;
}): Promise<{ ok: true } | { ok: false; error: string }> => {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("public_join_class_waitlist", {
    slug_in: input.handle,
    class_slug_in: input.classSlug,
    name_in: input.name || null,
    email_in: input.email,
  });
  if (error) return { ok: false, error: error.message };
  if (data === false) return { ok: false, error: "Couldn't join the waitlist. Check your email and try again." };
  return { ok: true };
};

export type ClassWaitlistEntry = {
  id: string;
  name: string | null;
  email: string;
  created_at: string;
  notified_at: string | null;
};

// Owner: read a class's waitlist (RLS scopes to the braider's rows).
export const fetchClassWaitlist = async (
  userId: string,
  classId: string,
): Promise<{ ok: true; waitlist: ClassWaitlistEntry[] } | { ok: false; error: string }> => {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("class_waitlist")
    .select("id, name, email, created_at, notified_at")
    .eq("user_id", userId)
    .eq("class_id", classId)
    .order("created_at", { ascending: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true, waitlist: (data || []) as ClassWaitlistEntry[] };
};

// ============================================================
// Refunds (Phase 3)
// ============================================================

// Owner: refund a paid class registration or video purchase. The API
// route re-checks ownership from the Bearer token before touching
// Stripe, so this just needs the current session's access token.
export const refundSale = async (
  kind: "class" | "video",
  id: string,
): Promise<{ ok: true; refunded: number } | { ok: false; error: string }> => {
  const supabase = getSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return { ok: false, error: "You need to be signed in to issue a refund." };
  try {
    const res = await fetch("/api/academy/refund", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ kind, id }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.ok) {
      return { ok: false, error: body?.error || "Couldn't issue the refund." };
    }
    return { ok: true, refunded: Number(body.refunded || 0) };
  } catch {
    return { ok: false, error: "Network error — try again in a moment." };
  }
};
