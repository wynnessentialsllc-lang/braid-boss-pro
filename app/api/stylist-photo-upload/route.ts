// POST /api/stylist-photo-upload — server-side upload for the
// "Meet your stylist" portrait.
//
// Why server-side: the storage RLS policy on booking-logos requires
// the path's first folder segment to equal auth.uid(). When the
// client-side Supabase JS storage upload misroutes the auth token
// (stale session, sb_publishable key edge cases, refresh races, etc.),
// the policy rejects with a raw "new row violates row-level security
// policy" message the stylist can't act on. Routing the upload through
// here uses the service role to bypass storage RLS — but we still
// validate the user's auth bearer first and pin the path to the
// authenticated user's folder, so we keep the same ownership model the
// RLS policy enforced.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { rateLimit, clientIp } from "../../lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ~9 MB after base64 inflation. Generous so a phone portrait fits.
const MAX_IMAGE_B64_CHARS = 12_500_000;
const ALLOWED_MEDIA = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif",
]);
const BUCKET = "booking-logos";

const fail = (status: number, message: string) =>
  NextResponse.json({ error: message }, { status });

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};

type Body = {
  image_base64?: string | null;
  media_type?: string | null;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid JSON body.");
  }

  if (!body.image_base64 || typeof body.image_base64 !== "string") {
    return fail(400, "Missing image.");
  }
  if (body.image_base64.length > MAX_IMAGE_B64_CHARS) {
    return fail(413, "That photo is too large. Please use an image under ~9 MB.");
  }
  const media = body.media_type && ALLOWED_MEDIA.has(body.media_type)
    ? body.media_type
    : null;
  if (!media) return fail(400, "Unsupported image type.");

  const ip = clientIp(req);
  const ipGate = rateLimit("stylist-photo:ip", ip, 20, 60_000);
  if (!ipGate.ok) {
    return NextResponse.json(
      { error: "Too many uploads — please wait a moment." },
      { status: 429, headers: { "retry-after": String(ipGate.retryAfter) } },
    );
  }

  let supabaseUrl: string;
  let anonKey: string;
  let serviceKey: string;
  try {
    supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || env("SUPABASE_URL");
    anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env("SUPABASE_ANON_KEY");
    serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  } catch (e: any) {
    return fail(500, e?.message || "Server is not configured.");
  }

  // Validate the caller via their bearer token. We use the anon client
  // to call getUser() because that's the supported path for verifying
  // a JWT — the result tells us WHICH user to upload as.
  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) return fail(401, "Please sign in.");

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes?.user?.id) return fail(401, "Please sign in.");
  const userId = userRes.user.id;

  // Service role bypasses storage RLS — but the path is pinned to the
  // authenticated user's folder, so the on-disk ownership model the
  // RLS policy enforced is unchanged.
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const data = body.image_base64.includes(",")
    ? body.image_base64.slice(body.image_base64.indexOf(",") + 1)
    : body.image_base64;

  const ext = media === "image/png" ? "png"
    : media === "image/webp" ? "webp"
    : media === "image/gif" ? "gif"
    : (media === "image/heic" || media === "image/heif") ? "heic"
    : "jpg";
  // Stable filename — overwrite on every upload so the stylist never
  // accumulates orphan portraits.
  const path = `${userId}/stylist-photo.${ext}`;

  try {
    const buffer = Buffer.from(data, "base64");
    if (buffer.length === 0) {
      return fail(400, "That photo couldn't be decoded — please try a different image.");
    }
    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: media, upsert: true, cacheControl: "3600" });
    if (upErr) {
      return fail(502, `Upload failed: ${upErr.message || "unknown error"}`);
    }
  } catch (e: any) {
    return fail(502, e?.message || "Upload failed. Please try again.");
  }

  // Cache-bust so a fresh upload shows immediately even behind a CDN.
  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
  const publicUrl = pub?.publicUrl ? `${pub.publicUrl}?v=${Date.now()}` : null;
  if (!publicUrl) return fail(502, "Couldn't resolve uploaded URL.");

  return NextResponse.json({ ok: true, publicUrl, path });
}
