// Booking-gallery photo upload helper. Public bucket
// `booking-gallery` with RLS pinning writes to {auth.uid()}/<file>;
// reads are open so the anonymous /book/<slug> page can render
// images without signed URLs.
//
// Constraints (enforced before upload so we never store oversized
// blobs in user-paid storage):
//   * Max 8 photos per stylist (gallery_photos jsonb is also CHECK
//     constrained to ≤ 8 in the DB so a buggy client can't bypass).
//   * Each upload is resized client-side to 1024px on the long edge
//     and re-encoded as JPEG @ q=0.82 — typical output 100-300 KB.
//   * Input file rejected over 12 MB before reading into memory.

import { getSupabase } from "./supabase";

const BUCKET = "booking-gallery";
const MAX_DIM = 1024;
const JPEG_QUALITY = 0.82;
const MAX_INPUT_MB = 12;
const MAX_PHOTOS = 8;

export const GALLERY_LIMITS = {
  maxPhotos: MAX_PHOTOS,
  maxInputMb: MAX_INPUT_MB,
  maxDimension: MAX_DIM,
};

export type GalleryPhoto = {
  url: string;
  path: string;
  sort: number;
};

const compress = (file: File): Promise<Blob> =>
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

const newPhotoId = (): string => {
  // ~52 bits of entropy — plenty for per-user file names.
  const r = () => Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}_${r()}`;
};

export type UploadGalleryPhotoResult = {
  url: string;
  path: string;
};

export const uploadGalleryPhoto = async (
  userId: string,
  file: File,
): Promise<UploadGalleryPhotoResult> => {
  if (!userId) throw new Error("Sign in required.");
  if (!file) throw new Error("No file selected.");
  if (!/^image\//.test(file.type)) throw new Error("Please choose an image file.");
  if (file.size > MAX_INPUT_MB * 1024 * 1024) {
    throw new Error(`Image is larger than ${MAX_INPUT_MB} MB.`);
  }

  const blob = await compress(file);
  const supabase = getSupabase();
  const path = `${userId}/${newPhotoId()}.jpg`;
  const { error: upErr } = await supabase
    .storage
    .from(BUCKET)
    .upload(path, blob, {
      upsert: false, // unique per-photo id so we never collide
      contentType: "image/jpeg",
      cacheControl: "31536000",
    });
  if (upErr) throw upErr;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const base = data?.publicUrl;
  if (!base) throw new Error("Couldn't resolve uploaded URL.");
  return { url: base, path };
};

export const removeGalleryPhoto = async (path: string): Promise<void> => {
  if (!path) return;
  const supabase = getSupabase();
  await supabase.storage.from(BUCKET).remove([path]);
};
