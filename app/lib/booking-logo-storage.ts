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

// Resolve the CURRENT auth session's user id. The bucket's INSERT/UPDATE
// policies require (storage.foldername(name))[1] = auth.uid()::text, so
// the upload path MUST be built from the live session uid — not a uid the
// caller cached earlier. If they drift (a stale prop, a switched account,
// an expired session), Storage rejects the write with the opaque "new row
// violates row-level security policy". We read the truth here so the path
// can't drift, and surface a clear error when the session is really gone.
const resolveSessionUid = async (fallbackUserId?: string): Promise<string> => {
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.getUser();
  const sessionUid = data?.user?.id;
  if (error || !sessionUid) {
    throw new Error("Your session expired — please sign in again, then retry.");
  }
  if (fallbackUserId && fallbackUserId !== sessionUid && typeof console !== "undefined") {
    console.warn("[booking-logo-storage] userId mismatch — using session uid", {
      passed: fallbackUserId,
      session: sessionUid,
    });
  }
  return sessionUid;
};

// Rewrite Storage's opaque RLS rejection into something a stylist can act
// on; pass every other error through verbatim (file-too-large, network…).
const throwUploadError = (upErr: unknown): never => {
  const msg = String((upErr as any)?.message || "");
  if (msg.toLowerCase().includes("row-level security")) {
    throw new Error("Upload was rejected. Please sign out and sign back in, then try again.");
  }
  throw upErr as Error;
};

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
  if (!file) throw new Error("No file selected.");
  if (!/^image\//.test(file.type)) throw new Error("Please choose an image file.");
  if (file.size > 8 * 1024 * 1024) throw new Error("Image is larger than 8 MB.");

  const blob = await compressLogo(file);
  const supabase = getSupabase();
  // Build the path from the live session uid so it always matches the
  // bucket's owner-folder RLS check (see resolveSessionUid).
  const sessionUid = await resolveSessionUid(userId);
  // Stable filename so the upload upserts in place. Cache-bust handled
  // via the public URL query param below.
  const path = `${sessionUid}/${filename}`;
  const { error: upErr } = await supabase
    .storage
    .from(BUCKET)
    .upload(path, blob, {
      upsert: true,
      contentType: "image/jpeg",
      cacheControl: "3600",
    });
  if (upErr) throwUploadError(upErr);

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
  if (!file) throw new Error("No file selected.");
  if (!/^image\//.test(file.type)) throw new Error("Please choose an image file.");
  if (file.size > 12 * 1024 * 1024) throw new Error("Image is larger than 12 MB.");

  const blob = await compressBanner(file);
  const supabase = getSupabase();
  // Path from the live session uid so it satisfies the bucket's owner-
  // folder RLS check even if the caller's userId prop has gone stale.
  const sessionUid = await resolveSessionUid(userId);
  const path = `${sessionUid}/${filename}`;
  const { error: upErr } = await supabase
    .storage
    .from(BUCKET)
    .upload(path, blob, {
      upsert: true,
      contentType: "image/jpeg",
      cacheControl: "3600",
    });
  if (upErr) throwUploadError(upErr);

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
  if (!file) throw new Error("No file selected.");
  if (!/^image\//.test(file.type)) throw new Error("Please choose an image file.");
  if (file.size > 12 * 1024 * 1024) throw new Error("Image is larger than 12 MB.");

  const supabase = getSupabase();
  // The bucket's INSERT policy requires (storage.foldername(name))[1]
  // = auth.uid()::text. If the caller passes a stale userId (signed in
  // on another tab, switched accounts, etc.) the upload is rejected
  // with "new row violates row-level security policy" — opaque to the
  // user. Read the session uid here, surface a clearer error, and
  // build the path from the truth so it can't drift.
  const { data: sessionData, error: sessionErr } = await supabase.auth.getUser();
  if (sessionErr || !sessionData?.user?.id) {
    throw new Error("Your session expired — please sign in again, then retry.");
  }
  const sessionUid = sessionData.user.id;
  if (userId && userId !== sessionUid) {
    // Don't fail loudly here — the on-disk path lives under the signed-
    // in user's folder regardless; just warn so dev mode catches it.
    if (typeof console !== "undefined") console.warn(
      "[uploadStylistPhoto] userId mismatch — using session uid",
      { passed: userId, session: sessionUid },
    );
  }

  const blob = await compressPortrait(file);
  const path = `${sessionUid}/${filename}`;
  const { error: upErr } = await supabase
    .storage
    .from(BUCKET)
    .upload(path, blob, {
      upsert: true,
      contentType: "image/jpeg",
      cacheControl: "3600",
    });
  if (upErr) {
    // Pass through the original Supabase message verbatim when it's
    // already specific (file-too-large, etc.), and rewrite the
    // generic RLS rejection into something the stylist can act on.
    const msg = String((upErr as any)?.message || "");
    if (msg.toLowerCase().includes("row-level security")) {
      throw new Error(
        "Upload was rejected. Please sign out and sign back in, then try again.",
      );
    }
    throw upErr;
  }

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
