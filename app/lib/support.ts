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
export const APP_VERSION = "2.4.0";
export const BUILD_NUMBER = "2026.05.30";

export const SUPPORT_EMAIL = "support@braidbosspro.app";

export const ONBOARDING_STEPS: { id: string; label: string }[] = [
  { id: "business_info",   label: "Add business information" },
  { id: "first_service",   label: "Create your first service" },
  { id: "availability",    label: "Set your availability" },
  { id: "deposits",        label: "Configure deposits" },
  { id: "policies",        label: "Add booking policies" },
  { id: "first_client",    label: "Create your first client" },
  { id: "first_booking",   label: "Complete your first booking" },
];

export type BugPriority = "low" | "medium" | "high";

export const FEATURE_CATEGORIES: { id: string; label: string }[] = [
  { id: "bookings",   label: "Bookings" },
  { id: "clients",    label: "Clients" },
  { id: "calendar",   label: "Calendar" },
  { id: "money",      label: "Money" },
  { id: "marketing",  label: "Marketing" },
  { id: "automation", label: "Automation" },
  { id: "reports",    label: "Reports" },
  { id: "other",      label: "Other" },
];

export type HelpArticle = {
  slug: string;
  title: string;
  category: string;
  body: string;
  keywords: string[];
  sort_order: number;
};

export type WalkthroughStep = { title: string; body: string };

export type Walkthrough = {
  slug: string;
  title: string;
  est_minutes: number;
  steps: WalkthroughStep[];
  success_message: string | null;
  sort_order: number;
};

const SCREENSHOT_BUCKET = "support-screenshots";

export type BugReportInput = {
  title: string;
  description?: string;
  device?: string;
  browser?: string;
  screenshotUrl?: string | null;
  priority?: BugPriority;
  page?: string;
};

export type FeatureRequestInput = {
  title: string;
  description?: string;
  category?: string;
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

// Upload an optional screenshot to the (private) support bucket. Returns
// the object PATH, or null on any failure (the report still submits).
//
// The bucket is private — support screenshots can contain client PII
// visible on-screen, so they must not be world-readable by URL. Nothing
// in the app renders this value; the support team views the object via
// the Supabase dashboard (full access) or a future signed-URL admin
// view, so storing the path (re-signable anytime) rather than a public
// URL is both safer and more useful.
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
    return path;
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
      priority: input.priority || "medium",
      page: (input.page || "").slice(0, 200) || null,
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
      category: input.category || "other",
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

// All published help articles, sorted.
export const useHelpArticles = (): { articles: HelpArticle[]; loading: boolean } => {
  const [articles, setArticles] = useState<HelpArticle[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabase();
        const { data } = await supabase
          .from("support_help_articles")
          .select("slug, title, category, body, keywords, sort_order")
          .eq("is_published", true)
          .order("sort_order", { ascending: true });
        if (cancelled) return;
        setArticles((data || []).map((r: any) => ({
          slug: String(r.slug),
          title: String(r.title),
          category: String(r.category || "general"),
          body: String(r.body || ""),
          keywords: Array.isArray(r.keywords) ? r.keywords.map((k: any) => String(k)) : [],
          sort_order: Number(r.sort_order || 0),
        })));
      } catch { /* leave empty */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);
  return { articles, loading };
};

// Score an article against a free-text query. Higher is better; 0 = no match.
export const scoreHelpArticle = (article: HelpArticle, query: string): number => {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const tokens = q.split(/\s+/).filter(Boolean);
  let score = 0;
  const title = article.title.toLowerCase();
  const body = article.body.toLowerCase();
  const keywords = article.keywords.map(k => k.toLowerCase());
  for (const t of tokens) {
    if (title.includes(t)) score += 5;
    if (keywords.some(k => k.includes(t))) score += 3;
    if (body.includes(t)) score += 1;
  }
  return score;
};

// All published walkthroughs, sorted.
export const useWalkthroughs = (): { walkthroughs: Walkthrough[]; loading: boolean } => {
  const [walkthroughs, setWalkthroughs] = useState<Walkthrough[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabase();
        const { data } = await supabase
          .from("support_walkthroughs")
          .select("slug, title, est_minutes, steps, success_message, sort_order")
          .eq("is_published", true)
          .order("sort_order", { ascending: true });
        if (cancelled) return;
        setWalkthroughs((data || []).map((r: any) => ({
          slug: String(r.slug),
          title: String(r.title),
          est_minutes: Number(r.est_minutes || 2),
          steps: Array.isArray(r.steps)
            ? r.steps.map((s: any) => ({
                title: String(s?.title || ""),
                body: String(s?.body || ""),
              }))
            : [],
          success_message: r.success_message ?? null,
          sort_order: Number(r.sort_order || 0),
        })));
      } catch { /* leave empty */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);
  return { walkthroughs, loading };
};

// Per-user onboarding checklist. Falls back to localStorage for guest
// mode so guests still see progress until they sign in.
const LOCAL_ONBOARDING_KEY = "bbp.onboarding.v1";

const readLocalProgress = (): Set<string> => {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(LOCAL_ONBOARDING_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch { return new Set(); }
};

const writeLocalProgress = (set: Set<string>) => {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(LOCAL_ONBOARDING_KEY, JSON.stringify(Array.from(set))); }
  catch { /* ignore */ }
};

export const useOnboardingProgress = (
  userId: string | null,
): {
  done: Set<string>;
  loading: boolean;
  toggle: (stepId: string, completed: boolean) => Promise<void>;
  percent: number;
} => {
  const [done, setDone] = useState<Set<string>>(() => readLocalProgress());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!userId) {
        if (!cancelled) { setDone(readLocalProgress()); setLoading(false); }
        return;
      }
      try {
        const supabase = getSupabase();
        const { data } = await supabase
          .from("support_onboarding_progress")
          .select("step_id")
          .eq("user_id", userId);
        if (cancelled) return;
        const remote = new Set<string>((data || []).map((r: any) => String(r.step_id)));
        // Merge any local guest progress on first sign-in.
        const local = readLocalProgress();
        for (const id of local) remote.add(id);
        setDone(remote);
      } catch { /* leave local */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const toggle = async (stepId: string, completed: boolean) => {
    setDone(prev => {
      const next = new Set(prev);
      if (completed) next.add(stepId); else next.delete(stepId);
      writeLocalProgress(next);
      return next;
    });
    if (!userId) return;
    try {
      const supabase = getSupabase();
      if (completed) {
        await supabase
          .from("support_onboarding_progress")
          .upsert({ user_id: userId, step_id: stepId }, { onConflict: "user_id,step_id" });
      } else {
        await supabase
          .from("support_onboarding_progress")
          .delete()
          .eq("user_id", userId)
          .eq("step_id", stepId);
      }
    } catch { /* best effort */ }
  };

  const total = ONBOARDING_STEPS.length || 1;
  const completed = ONBOARDING_STEPS.filter(s => done.has(s.id)).length;
  const percent = Math.round((completed / total) * 100);
  return { done, loading, toggle, percent };
};
