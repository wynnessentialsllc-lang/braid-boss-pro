// Supabase Storage client for the private `receipts` bucket used by
// Money → Expenses. Path convention: `{user_id}/{expense_id}.<ext>`.
// RLS on storage.objects enforces that the leading folder match
// auth.uid(), so users can only read/write their own receipts.

import { getSupabase } from "./supabase";

const BUCKET = "receipts";
const URL_TTL_SECONDS = 60 * 60 * 6;

const extFor = (mime: string): string => {
  if (!mime) return "jpg";
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("heic")) return "heic";
  if (mime.includes("pdf")) return "pdf";
  return "jpg";
};

export const uploadReceipt = async (
  userId: string,
  expenseId: string,
  body: Blob | File,
): Promise<string> => {
  if (!userId || !expenseId) throw new Error("uploadReceipt requires userId + expenseId");
  if (!body || (body as any).size === 0) throw new Error("uploadReceipt: empty body");
  const supabase = getSupabase();
  const path = `${userId}/${expenseId}.${extFor(body.type || "")}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, {
    upsert: true,
    contentType: body.type || "image/jpeg",
    cacheControl: "3600",
  });
  if (error) throw error;
  return path;
};

export const deleteReceipt = async (path: string | null | undefined): Promise<void> => {
  if (!path) return;
  const supabase = getSupabase();
  await supabase.storage.from(BUCKET).remove([path]);
};

export const getReceiptUrl = async (path: string | null | undefined): Promise<string | null> => {
  if (!path) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, URL_TTL_SECONDS);
  if (error || !data) return null;
  return data.signedUrl;
};
