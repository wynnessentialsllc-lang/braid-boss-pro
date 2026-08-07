// Digital-product file upload helper for the storefront commerce admin.
//
// Uploads to the PRIVATE `product-files` bucket, pinned to the
// {auth.uid()}/<file> folder the storage RLS policy requires. A buyer
// never touches this object directly — after a paid order they get a
// short-lived signed URL from /api/product-download. The bucket has no
// public-read policy, so the file can't be fetched without a fresh
// server-minted signed URL.
//
// Uploads are capped client-side to match the bucket's 100 MB server
// limit. Common ebook / document container types only.

import { getSupabase } from "./supabase";

const BUCKET = "product-files";
// Keep in sync with the bucket file_size_limit in the migration.
const MAX_BYTES = 100 * 1024 * 1024; // 100 MB

// mime → extension, for building a stable object name. Some ebook types
// (epub/mobi) arrive with an empty file.type on many browsers, so we
// fall back to the original filename's extension.
const EXT_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "application/epub+zip": "epub",
  "application/x-mobipocket-ebook": "mobi",
  "application/zip": "zip",
};
const ALLOWED_EXT = new Set(["pdf", "epub", "mobi", "zip"]);

const extFor = (file: File): string => {
  const fromName = file.name.includes(".")
    ? (file.name.split(".").pop() || "").toLowerCase()
    : "";
  if (fromName && ALLOWED_EXT.has(fromName)) return fromName;
  return EXT_BY_MIME[file.type] || "pdf";
};

const randomId = (): string => {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${ts}-${rand}`;
};

export const DIGITAL_FILE_MAX_MB = 100;

export type UploadProductFileResult =
  | { ok: true; path: string; fileName: string }
  | { ok: false; error: string };

// Validate before upload so the picker surfaces a clear error instead of
// a raw Storage rejection. Type check is lenient (empty type is allowed
// as long as the extension is one we accept) because epub/mobi often
// report no mime type in the browser.
export const validateProductFile = (file: File): string | null => {
  if (!file) return "No file selected.";
  const ext = file.name.includes(".")
    ? (file.name.split(".").pop() || "").toLowerCase()
    : "";
  const typeOk = !file.type || file.type in EXT_BY_MIME || file.type === "application/octet-stream";
  const extOk = ALLOWED_EXT.has(ext);
  if (!typeOk && !extOk) {
    return "Unsupported file. Upload a PDF, EPUB, MOBI, or ZIP.";
  }
  if (file.size > MAX_BYTES) {
    return `That file is over ${DIGITAL_FILE_MAX_MB} MB. Compress it or split it into parts.`;
  }
  return null;
};

export const uploadProductFile = async (
  userId: string | null,
  file: File,
): Promise<UploadProductFileResult> => {
  if (!userId) return { ok: false, error: "You need to be signed in to upload." };
  const validation = validateProductFile(file);
  if (validation) return { ok: false, error: validation };

  // Folder name matches the RLS pin: storage.foldername(name)[1] must
  // equal auth.uid()::text. The filename itself is a random id.
  const path = `${userId}/${randomId()}.${extFor(file)}`;
  try {
    const supabase = getSupabase();
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
      cacheControl: "3600",
    });
    if (error) return { ok: false, error: error.message || "Upload failed." };
    // Keep the buyer-facing filename readable but bounded.
    const fileName = (file.name || `download.${extFor(file)}`).slice(0, 180);
    return { ok: true, path, fileName };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Upload failed — check your connection and try again." };
  }
};

// Best-effort delete of a previously uploaded object (e.g. replacing the
// file, or turning a product back into a physical-only item). Never
// throws — the row update is the source of truth; an orphaned object
// only costs a little storage.
export const removeProductFile = async (path: string | null): Promise<void> => {
  if (!path) return;
  try {
    await getSupabase().storage.from(BUCKET).remove([path]);
  } catch {
    /* best-effort */
  }
};
