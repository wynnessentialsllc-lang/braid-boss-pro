// Support Center data layer — bug reports, feature requests, release
// notes, and screenshot upload. Backs Settings → Support.
//
// All writes are RLS-scoped to the signed-in user; release notes are
// world-readable when published. Everything is best-effort so a
// Supabase hiccup surfaces an inline error rather than throwing.

import { useEffect, useState } from "react";
import { getSupabase } from "./supabase";

// Marketing version shown in About + as a fallback for "What's New".
// Bump on each release; the DB release-notes table is the source of
// truth for the changelog list.
export const APP_VERSION = "2.3.0";
export const BUILD_NUMBER = "2026.05.30";

const SCREENSHOT_BUCKET = "support-screenshots";

export type BugReportInput = {
  title: string;
  description?: string;
  device?: string;
  browser?: string;
  screenshotUrl?: string | null;
};

export type FeatureRequestInput = {
  title: string;
  description?: string;
};

export type ReleaseNote = {
  id: string;
  version: string;
  title: string | null;
  items: string[];
  published_at: string;
};

export type SubmitResult = { ok: true } | { ok: false; error: string };

// Best-effort device + browser sniff from the UA string so bug reports
// carry useful context without asking the user to type it.
export const detectClientInfo = (): { device: string; browser: string } => {
  if (typeof navigator === "undefined") return { device: "", browser: "" };
  const ua = navigator.userAgent || "";
  let device = "Desktop";
  if (/iPad/.test(ua)) device = "iPad";
  else if (/iPhone/.test(ua)) device = "iPhone";
  else if (/Android/.test(ua)) device = /Mobile/.test(ua) ? "Android phone" : "Android tablet";
  else if (/Macintosh/.test(ua)) device = "Mac";
  else if (/Windows/.test(ua)) device = "Windows PC";

  let browser = "Unknown browser";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\//.test(ua) || /Opera/.test(ua)) browser = "Opera";
  else if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) browser = "Chrome";
  else if (/CriOS\//.test(ua)) browser = "Chrome (iOS)";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua)) browser = "Safari";

  const platform = (navigator as any).platform;
  return {
    device: platform ? `${device} · ${platform}` : device,
    browser,
  };
};

// Upload an optional screenshot to the public support bucket. Returns
// the public URL, or null on any failure (the report still submits).
export const uploadSupportScreenshot = async (
  userId: string,
  file: File,
): Promise<string | null> => {
  if (!userId || !file) return null;
  try {
    const supabase = getSupabase();
    const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
    const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from(SCREENSHOT_BUCKET).upload(path, file, {
      upsert: false,
      contentType: file.type || "image/png",
      cacheControl: "3600",
    });
    if (error) return null;
    const { data } = supabase.storage.from(SCREENSHOT_BUCKET).getPublicUrl(path);
    return data?.publicUrl || null;
  } catch {
    return null;
  }
};

export const submitBugReport = async (
  userId: string,
  input: BugReportInput,
): Promise<SubmitResult> => {
  if (!userId) return { ok: false, error: "Sign in to report a bug." };
  if (!input.title?.trim()) return { ok: false, error: "Add a short title." };
  try {
    const supabase = getSupabase();
    const { error } = await supabase.from("support_bug_reports").insert({
      user_id: userId,
      title: input.title.trim().slice(0, 200),
      description: (input.description || "").trim().slice(0, 4000) || null,
      device: (input.device || "").slice(0, 200) || null,
      browser: (input.browser || "").slice(0, 200) || null,
      screenshot_url: input.screenshotUrl || null,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Couldn't submit. Try again." };
  }
};

export const submitFeatureRequest = async (
  userId: string,
  input: FeatureRequestInput,
): Promise<SubmitResult> => {
  if (!userId) return { ok: false, error: "Sign in to request a feature." };
  if (!input.title?.trim()) return { ok: false, error: "Add a short title." };
  try {
    const supabase = getSupabase();
    const { error } = await supabase.from("support_feature_requests").insert({
      user_id: userId,
      title: input.title.trim().slice(0, 200),
      description: (input.description || "").trim().slice(0, 4000) || null,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Couldn't submit. Try again." };
  }
};

// Published release notes, newest first.
export const useReleaseNotes = (): { notes: ReleaseNote[]; loading: boolean } => {
  const [notes, setNotes] = useState<ReleaseNote[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabase();
        const { data } = await supabase
          .from("support_release_notes")
          .select("id, version, title, items, published_at")
          .eq("is_published", true)
          .order("sort_order", { ascending: false })
          .order("published_at", { ascending: false })
          .limit(20);
        if (cancelled) return;
        const rows = (data || []).map((r: any) => ({
          id: String(r.id),
          version: String(r.version || ""),
          title: r.title ?? null,
          items: Array.isArray(r.items) ? r.items.map((x: any) => String(x)) : [],
          published_at: r.published_at,
        }));
        setNotes(rows);
      } catch {
        /* leave empty */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return { notes, loading };
};

// Account "member since" — the auth user's creation date.
export const useMemberSince = (): string | null => {
  const [since, setSince] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabase();
        const { data } = await supabase.auth.getUser();
        if (cancelled) return;
        setSince(data?.user?.created_at ?? null);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);
  return since;
};
