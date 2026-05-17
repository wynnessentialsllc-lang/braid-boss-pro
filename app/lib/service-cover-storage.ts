// Service cover-image upload helper. Reuses the public "booking-logos"
// bucket (storage.objects RLS only pins the first path segment to
// {auth.uid()}, so any filename under that folder is owner-writable
// and world-readable). Covers render on the public /book/<slug> page
// to anonymous visitors, so a public bucket is required.
//
// Each service gets its own stable path so re-uploading replaces the
// previous cover in place. The returned URL carries a `?v=<timestamp>`
// cache-bust so a fresh upload shows immediately.

import { getSupabase } from "./supabase";

const BUCKET = "booking-logos";
const MAX_DIM = 1280;    // covers are a 16:9 hero — keep more detail than logos
const JPEG_QUALITY = 0.82;

const compressCover = (file: File): Promise<Blob> =>
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

export type UploadCoverResult = {
  publicUrl: string;
  path: string;
};

// `coverKey` is the service id when editing an existing service, or a
// freshly generated id for a brand-new (unsaved) service. Either way
// it just needs to be stable for the lifetime of the editor session.
export const uploadServiceCover = async (
  userId: string,
  coverKey: string,
  file: File,
): Promise<UploadCoverResult> => {
  if (!userId) throw new Error("Sign in required.");
  if (!coverKey) throw new Error("Missing service reference.");
  if (!file) throw new Error("No file selected.");
  if (!/^image\//.test(file.type)) throw new Error("Please choose an image file.");
  if (file.size > 12 * 1024 * 1024) throw new Error("Image is larger than 12 MB.");

  const blob = await compressCover(file);
  const supabase = getSupabase();
  const path = `${userId}/service-cover-${coverKey}.jpg`;
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
