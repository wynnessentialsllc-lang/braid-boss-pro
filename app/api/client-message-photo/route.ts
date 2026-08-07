// POST /api/client-message-photo — anon screenshot / photo upload for a
// message in the client appointment portal thread.
//
// The portal is anonymous and the client-message-photos bucket disallows
// anon writes by policy. So we resolve the portal_token -> stylist
// user_id + request id via the service role, then upload server-side.
// Returns the public URL; the portal then posts the message through the
// public_post_client_message RPC with that URL (the RPC only accepts a
// URL that lives in this bucket).

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { rateLimit, clientIp } from "../../lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ~7 MB after base64 inflation.
const MAX_IMAGE_B64_CHARS = 9_400_000;
const ALLOWED_MEDIA = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const BUCKET = "client-message-photos";

const fail = (status: number, message: string) =>
  NextResponse.json({ error: message }, { status });

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};

type Body = {
  token?: string;
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

  const token = (body.token || "").trim();
  if (token.length < 16) return fail(400, "Missing or invalid appointment link.");
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
  const ipGate = rateLimit("client-message-photo:ip", ip, 20, 60_000);
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

  // Resolve the portal token -> owner + request, which both validates the
  // link and namespaces the upload path.
  let userId: string | null = null;
  let requestId: string | null = null;
  try {
    const { data, error } = await admin
      .from("booking_requests")
      .select("id, user_id")
      .eq("portal_token", token)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    userId = data?.user_id ? String(data.user_id) : null;
    requestId = data?.id ? String(data.id) : null;
  } catch {
    return fail(502, "Couldn't look up this appointment link.");
  }
  if (!userId || !requestId) return fail(404, "Appointment link not found.");

  const raw = body.image_base64.includes(",")
    ? body.image_base64.slice(body.image_base64.indexOf(",") + 1)
    : body.image_base64;

  const ext = media === "image/png" ? "png"
    : media === "image/webp" ? "webp"
    : media === "image/gif" ? "gif" : "jpg";
  const path = `${userId}/${requestId}/${crypto.randomUUID()}.${ext}`;
  try {
    const buffer = Buffer.from(raw, "base64");
    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: media, upsert: false });
    if (upErr) throw upErr;
  } catch {
    return fail(502, "Couldn't upload the photo. Please try again.");
  }

  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
  return NextResponse.json({ ok: true, path, url: pub?.publicUrl || null });
}
