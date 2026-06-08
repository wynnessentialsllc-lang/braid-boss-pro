// POST /api/booking-color-photo — anon inspiration photo upload for the
// "Customized braiding hair color" option on the public booking page.
//
// The page is anonymous, and the style-request-photos bucket disallows
// anon writes by policy. So we resolve the slug -> stylist user_id, then
// upload via the service role. Returns the public URL the booking
// submit will stash on the request so the stylist sees the inspiration
// photo at review time.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { rateLimit, clientIp } from "../../lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ~7 MB after base64 inflation.
const MAX_IMAGE_B64_CHARS = 9_400_000;
const ALLOWED_MEDIA = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const fail = (status: number, message: string) =>
  NextResponse.json({ error: message }, { status });

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};

type Body = {
  slug?: string;
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

  const slug = (body.slug || "").trim();
  if (!slug) return fail(400, "Missing booking link.");
  if (!body.image_base64 || typeof body.image_base64 !== "string") {
    return fail(400, "Missing image.");
  }
  if (body.image_base64.length > MAX_IMAGE_B64_CHARS) {
    return fail(413, "That photo is too large. Please use an image under ~7 MB.");
  }
  const media = body.media_type && ALLOWED_MEDIA.has(body.media_type)
    ? body.media_type
    : null;
  if (!media) return fail(400, "Unsupported image type.");

  const ip = clientIp(req);
  const ipGate = rateLimit("booking-color-photo:ip", ip, 20, 60_000);
  if (!ipGate.ok) {
    return NextResponse.json(
      { error: "Too many uploads — please wait a moment." },
      { status: 429, headers: { "retry-after": String(ipGate.retryAfter) } },
    );
  }

  let supabaseUrl: string;
  let serviceKey: string;
  try {
    supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || env("SUPABASE_URL");
    serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  } catch (e: any) {
    return fail(500, e?.message || "Server is not configured.");
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let userId: string | null = null;
  try {
    const { data, error } = await admin.rpc("public_resolve_booking_slug", { slug_in: slug });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : (data as any);
    userId = row?.user_id ? String(row.user_id) : null;
  } catch {
    return fail(502, "Couldn't look up this booking link.");
  }
  if (!userId) return fail(404, "Booking link not found.");

  const data = body.image_base64.includes(",")
    ? body.image_base64.slice(body.image_base64.indexOf(",") + 1)
    : body.image_base64;

  const ext = media === "image/png" ? "png"
    : media === "image/webp" ? "webp"
    : media === "image/gif" ? "gif" : "jpg";
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  try {
    const buffer = Buffer.from(data, "base64");
    const { error: upErr } = await admin.storage
      .from("style-request-photos")
      .upload(path, buffer, { contentType: media, upsert: false });
    if (upErr) throw upErr;
  } catch {
    return fail(502, "Couldn't upload the photo. Please try again.");
  }

  const { data: pub } = admin.storage.from("style-request-photos").getPublicUrl(path);
  return NextResponse.json({ ok: true, path, url: pub?.publicUrl || null });
}
