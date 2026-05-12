// Booking-logo upload helper. Public bucket "booking-logos" with
// RLS that pins writes to {auth.uid()}/<filename>; reads are open
// so the anonymous /book/<slug> page can render the image.
//
// Each user has at most one logo at any time — uploads write to a
// stable path and overwrite the previous file. The returned public
// URL carries a `?v=<timestamp>` cache-bust so a fresh upload shows
// immediately even if a CDN caches the old bytes.

import { getSupabase } from "./supabase";

const BUCKET = "booking-logos";
const MAX_DIM = 512;     // logos compress to 512px on the long side
const JPEG_QUALITY = 0.88;

// Resize + compress an image client-side so we never upload more than
// a few hundred KB. Returns a Blob ready to upload.
const compressLogo = (file: File): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode failed"));
      img.onload = () => {
        const ratio = img.width > img.height
          ? Math.min(1, MAX_DIM / img.width)
          : Math.min(1, MAX_DIM / img.height);
        const w = Math.max(1, Math.round(img.width * ratio));
        const h = Math.max(1, Math.round(img.height * ratio));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("canvas unavailable")); return; }
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          (blob) => blob ? resolve(blob) : reject(new Error("encode failed")),
          "image/jpeg",
          JPEG_QUALITY,
        );
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });

export type UploadLogoResult = {
  publicUrl: string;
  path: string;
};

export const uploadBookingLogo = async (
  userId: string,
  file: File,
): Promise<UploadLogoResult> => {
  if (!userId) throw new Error("Sign in required.");
  if (!file) throw new Error("No file selected.");
  if (!/^image\//.test(file.type)) throw new Error("Please choose an image file.");
  if (file.size > 8 * 1024 * 1024) throw new Error("Image is larger than 8 MB.");

  const blob = await compressLogo(file);
  const supabase = getSupabase();
  // Stable filename so the upload upserts in place. Cache-bust handled
  // via the public URL query param below.
  const path = `${userId}/logo.jpg`;
  const { error: upErr } = await supabase
    .storage
    .from(BUCKET)
    .upload(path, blob, {
      upsert: true,
      contentType: "image/jpeg",
      cacheControl: "3600",
    });
  if (upErr) throw upErr;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const base = data?.publicUrl;
  if (!base) throw new Error("Couldn't resolve uploaded URL.");
  // Append a version stamp so a re-upload doesn't show the cached
  // older file. The public page hits the CDN normally; this query
  // string just busts our own browser cache and most CDNs.
  return { publicUrl: `${base}?v=${Date.now()}`, path };
};

export const removeBookingLogo = async (userId: string): Promise<void> => {
  if (!userId) return;
  const supabase = getSupabase();
  await supabase.storage.from(BUCKET).remove([`${userId}/logo.jpg`]);
};
