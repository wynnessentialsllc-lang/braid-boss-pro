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
