// Native video upload helper for Braider Academy lessons.
//
// Uploads to the PRIVATE `academy-videos` bucket, pinned to the
// {auth.uid()}/<file> folder the storage RLS policy requires. Playback
// never touches this file directly — a paid buyer gets a short-lived
// signed URL from /api/academy/watch. Uploads are capped client-side to
// match the bucket's 500 MB server limit; longer videos should use an
// external link instead (recommended for large files).

import { getSupabase } from "./supabase";

const BUCKET = "academy-videos";
// Keep in sync with the bucket file_size_limit in the migration.
const MAX_BYTES = 500 * 1024 * 1024; // 500 MB
const ALLOWED = new Set(["video/mp4", "video/quicktime", "video/webm", "video/x-m4v"]);

const extFor = (file: File): string => {
  const fromName = file.name.includes(".") ? file.name.split(".").pop() || "" : "";
  if (fromName && fromName.length <= 5) return fromName.toLowerCase();
  // Fall back from the mime type.
  const map: Record<string, string> = {
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
    "video/x-m4v": "m4v",
  };
  return map[file.type] || "mp4";
};

const randomId = (): string => {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${ts}-${rand}`;
};

export type UploadResult =
  | { ok: true; path: string }
  | { ok: false; error: string };

export const validateVideoFile = (file: File): string | null => {
  if (!file) return "No file selected.";
  if (file.type && !ALLOWED.has(file.type)) {
    return "Unsupported format. Upload an MP4, MOV, WebM, or M4V — or paste a link instead.";
  }
  if (file.size > MAX_BYTES) {
    return "That video is over 500 MB. Trim it, export smaller, or paste a link instead.";
  }
  return null;
};

export const uploadAcademyVideo = async (
  userId: string | null,
  file: File,
): Promise<UploadResult> => {
  if (!userId) return { ok: false, error: "You need to be signed in to upload." };
  const validation = validateVideoFile(file);
  if (validation) return { ok: false, error: validation };

  const path = `${userId}/${randomId()}.${extFor(file)}`;
  try {
    const supabase = getSupabase();
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType: file.type || "video/mp4",
      upsert: false,
      cacheControl: "3600",
    });
    if (error) return { ok: false, error: error.message || "Upload failed." };
    return { ok: true, path };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Upload failed — check your connection and try again." };
  }
};

// Best-effort delete of a previously uploaded object (e.g. replacing a
// file, or deleting a lesson). Never throws — cleanup is non-critical.
export const removeAcademyVideo = async (path: string | null): Promise<void> => {
  if (!path) return;
  try {
    await getSupabase().storage.from(BUCKET).remove([path]);
  } catch {
    /* best-effort */
  }
};

export const VIDEO_MAX_MB = 500;
