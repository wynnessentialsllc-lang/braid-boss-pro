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
  // Filename within the user's folder. Defaults to the booking logo;
  // the storefront passes "shop-logo.jpg" so a stylist can give their
  // shop its own logo without overwriting the booking-page one. The
  // bucket RLS pins writes to {auth.uid()}/<filename>, so any sibling
  // name under the user's folder is allowed — no new bucket needed.
  filename: string = "logo.jpg",
): Promise<UploadLogoResult> => {
  if (!userId) throw new Error("Sign in required.");
  if (!file) throw new Error("No file selected.");
  if (!/^image\//.test(file.type)) throw new Error("Please choose an image file.");
  if (file.size > 8 * 1024 * 1024) throw new Error("Image is larger than 8 MB.");

  const blob = await compressLogo(file);
  const supabase = getSupabase();
  // Stable filename so the upload upserts in place. Cache-bust handled
  // via the public URL query param below.
  const path = `${userId}/${filename}`;
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

export const removeBookingLogo = async (
  userId: string,
  filename: string = "logo.jpg",
): Promise<void> => {
  if (!userId) return;
  const supabase = getSupabase();
  await supabase.storage.from(BUCKET).remove([`${userId}/${filename}`]);
};

// ---- Banner (wide hero image) --------------------------------------
// Shares the booking-logos bucket — its RLS already pins writes to
// {auth.uid()}/<filename> and opens reads, so a sibling banner.jpg
// needs no new bucket or migration. Compressed to a wide hero size
// rather than the square logo cap.
const BANNER_MAX_W = 1600;
const BANNER_MAX_H = 900;
const BANNER_QUALITY = 0.82;

const compressBanner = (file: File): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode failed"));
      img.onload = () => {
        const ratio = Math.min(
          1,
          BANNER_MAX_W / img.width,
          BANNER_MAX_H / img.height,
        );
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
          BANNER_QUALITY,
        );
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });

export const uploadBookingBanner = async (
  userId: string,
  file: File,
  // Defaults to the booking banner; the storefront passes
  // "shop-banner.jpg" so the shop hero can differ from the booking one.
  filename: string = "banner.jpg",
): Promise<UploadLogoResult> => {
  if (!userId) throw new Error("Sign in required.");
  if (!file) throw new Error("No file selected.");
  if (!/^image\//.test(file.type)) throw new Error("Please choose an image file.");
  if (file.size > 12 * 1024 * 1024) throw new Error("Image is larger than 12 MB.");

  const blob = await compressBanner(file);
  const supabase = getSupabase();
  const path = `${userId}/${filename}`;
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
  return { publicUrl: `${base}?v=${Date.now()}`, path };
};

export const removeBookingBanner = async (
  userId: string,
  filename: string = "banner.jpg",
): Promise<void> => {
  if (!userId) return;
  const supabase = getSupabase();
  await supabase.storage.from(BUCKET).remove([`${userId}/${filename}`]);
};

// ---- Stylist portrait ("Meet your stylist" photo) ------------------
// A photo of the stylist herself, distinct from the studio logo. Shares
// the booking-logos bucket — its RLS already pins writes to
// {auth.uid()}/<filename> and opens reads, so a sibling
// stylist-photo.jpg needs no new bucket or migration. Compressed to a
// portrait-friendly cap (larger than the square logo) so it stays crisp
// in the hero card and the expanded About panel. The resulting public
// URL goes into booking_links.stylist_photo_url (20261010 migration).
const PORTRAIT_MAX_DIM = 768;
const PORTRAIT_QUALITY = 0.85;

const compressPortrait = (file: File): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode failed"));
      img.onload = () => {
        const ratio = img.width > img.height
          ? Math.min(1, PORTRAIT_MAX_DIM / img.width)
          : Math.min(1, PORTRAIT_MAX_DIM / img.height);
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
          PORTRAIT_QUALITY,
        );
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });

export const uploadStylistPhoto = async (
  userId: string,
  file: File,
  filename: string = "stylist-photo.jpg",
): Promise<UploadLogoResult> => {
  if (!userId) throw new Error("Sign in required.");
  if (!file) throw new Error("No file selected.");
  if (!/^image\//.test(file.type)) throw new Error("Please choose an image file.");
  if (file.size > 12 * 1024 * 1024) throw new Error("Image is larger than 12 MB.");

  const blob = await compressPortrait(file);
  const supabase = getSupabase();
  const path = `${userId}/${filename}`;
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
  return { publicUrl: `${base}?v=${Date.now()}`, path };
};

export const removeStylistPhoto = async (
  userId: string,
  filename: string = "stylist-photo.jpg",
): Promise<void> => {
  if (!userId) return;
  const supabase = getSupabase();
  await supabase.storage.from(BUCKET).remove([`${userId}/${filename}`]);
};
