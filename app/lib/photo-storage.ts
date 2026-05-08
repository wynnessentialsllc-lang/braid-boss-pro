// Supabase Storage client for the private `photos` bucket.
//
// Path convention: `{user_id}/{photo_id}.jpg` and
//                  `{user_id}/{photo_id}-thumb.jpg`.
// RLS on storage.objects enforces that the leading folder match
// auth.uid(), so users can only read / write their own files.

import { getSupabase } from "./supabase";

const BUCKET = "photos";
const URL_TTL_SECONDS = 60 * 60 * 6; // 6 hours

const photoPath = (userId: string, photoId: string, kind: "full" | "thumb") => {
  const suffix = kind === "thumb" ? "-thumb" : "";
  return `${userId}/${photoId}${suffix}.jpg`;
};

// Convert a `data:image/jpeg;base64,...` string to a Blob. We use this
// to migrate existing localStorage photos (which historically stored
// dataUrls inline) into the bucket.
const dataUrlToBlob = (dataUrl: string): Blob | null => {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const mime = match[1];
  const bin = atob(match[2]);
  const len = bin.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = bin.charCodeAt(i);
  return new Blob([out], { type: mime });
};

const uploadOne = async (userId: string, photoId: string, kind: "full" | "thumb", body: Blob | File): Promise<string> => {
  const supabase = getSupabase();
  const path = photoPath(userId, photoId, kind);
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, {
    upsert: true,
    contentType: body.type || "image/jpeg",
    cacheControl: "3600",
  });
  if (error) throw error;
  return path;
};

export type CloudPhotoUploadResult = {
  storagePath: string;
  thumbnailPath: string;
};

// Primary upload entry point. Accepts either Blob (preferred) or
// dataUrl strings (for the localStorage migration path) for both the
// full image and the thumbnail.
export const uploadPhoto = async (
  userId: string,
  photoId: string,
  full: Blob | File | string,
  thumb: Blob | File | string,
): Promise<CloudPhotoUploadResult> => {
  if (!userId || !photoId) throw new Error("uploadPhoto requires userId + photoId");
  const fullBlob = typeof full === "string" ? dataUrlToBlob(full) : full;
  const thumbBlob = typeof thumb === "string" ? dataUrlToBlob(thumb) : thumb;
  if (!fullBlob || !thumbBlob) throw new Error("uploadPhoto: invalid image bodies");
  const [storagePath, thumbnailPath] = await Promise.all([
    uploadOne(userId, photoId, "full", fullBlob),
    uploadOne(userId, photoId, "thumb", thumbBlob),
  ]);
  return { storagePath, thumbnailPath };
};

export const deletePhoto = async (userId: string, photoId: string): Promise<void> => {
  if (!userId || !photoId) return;
  const supabase = getSupabase();
  await supabase.storage.from(BUCKET).remove([
    photoPath(userId, photoId, "full"),
    photoPath(userId, photoId, "thumb"),
  ]);
};

// Get a signed URL for a stored object. Bucket is private — caller
// must hold an authed Supabase session, and RLS enforces ownership.
export const getSignedUrl = async (path: string): Promise<string | null> => {
  if (!path) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, URL_TTL_SECONDS);
  if (error || !data) return null;
  return data.signedUrl;
};

// Resolve a viewable URL for a photo metadata record. Falls back to
// the inline dataUrl when present (legacy localStorage photos that
// haven't been migrated yet, or guest mode).
export const resolvePhotoUrl = async (photo: any, kind: "full" | "thumb" = "full"): Promise<string | null> => {
  if (!photo) return null;
  if (kind === "thumb" && photo.thumbnailPath) return getSignedUrl(photo.thumbnailPath);
  if (kind === "full" && photo.storagePath) return getSignedUrl(photo.storagePath);
  if (kind === "thumb" && photo.thumbnailDataUrl) return photo.thumbnailDataUrl;
  return photo.dataUrl || null;
};
