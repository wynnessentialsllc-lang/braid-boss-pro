// Product-image upload helper for the storefront commerce admin.
//
// Public bucket "product-images" with the same RLS shape as
// booking-logos: writes pinned to {auth.uid()}/<filename>, reads
// open so anonymous /@handle/shop visitors can render the photos.
//
// Unlike booking-logos (one logo per user, stable filename), each
// product upload writes to a unique randomized filename so a single
// stylist can have many product photos coexisting. Removal is by
// path, exposed for the gallery "remove this photo" action.

import { getSupabase } from "./supabase";

const BUCKET = "product-images";
const MAX_DIM = 1600;         // long-side cap; large enough for the storefront detail page
const JPEG_QUALITY = 0.85;
const MAX_BYTES = 12 * 1024 * 1024;

// Resize + recompress to JPEG client-side so we never round-trip a
// 10MB phone photo through Supabase Storage. Output is a Blob ready
// to upload.
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

// Short random id for unique filenames. Doesn't need to be globally
// unique — RLS already scopes paths to the stylist's user_id folder
// — but collisions inside one stylist's folder are still annoying so
// we use 12 chars of randomness plus a timestamp.
const randomId = (): string => {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${ts}-${rand}`;
};

export type UploadProductImageResult = {
  publicUrl: string;
  path: string;
};

export const uploadProductImage = async (
  userId: string,
  file: File,
): Promise<UploadProductImageResult> => {
  if (!userId) throw new Error("Sign in required.");
  if (!file) throw new Error("No file selected.");
  if (!/^image\//.test(file.type)) throw new Error("Please choose an image file.");
  if (file.size > MAX_BYTES) throw new Error("Image is larger than 12 MB.");

  const blob = await compress(file);
  const supabase = getSupabase();
  // Folder name matches the RLS pin: storage.foldername(name)[1] must
  // equal auth.uid()::text. The filename itself is a random id.
  const path = `${userId}/${randomId()}.jpg`;
  const { error: upErr } = await supabase
    .storage
    .from(BUCKET)
    .upload(path, blob, {
      upsert: false,
      contentType: "image/jpeg",
      cacheControl: "31536000",
    });
  if (upErr) throw upErr;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const publicUrl = data?.publicUrl;
  if (!publicUrl) throw new Error("Couldn't resolve uploaded URL.");
  return { publicUrl, path };
};

// Best-effort delete by the original storage path. Falls back to
// extracting the path from a public URL when only the URL is around
// (e.g. when the stylist removes a gallery image we previously
// rendered from product_images.gallery_images).
export const removeProductImage = async (
  pathOrUrl: string,
): Promise<void> => {
  if (!pathOrUrl) return;
  const supabase = getSupabase();
  const path = pathOrUrl.includes("/object/public/")
    // Public URL shape: https://<host>/storage/v1/object/public/product-images/<userId>/<file>.jpg
    ? pathOrUrl.split(`/object/public/${BUCKET}/`)[1]?.split("?")[0]
    : pathOrUrl;
  if (!path) return;
  // Failures are non-fatal — the row update is the source of truth;
  // an orphan object only costs a few KB and can be cleaned up later.
  try {
    await supabase.storage.from(BUCKET).remove([path]);
  } catch {
    /* ignore */
  }
};
