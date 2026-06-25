// POST /api/style-request-post — create a marketplace "Open Style Request".
//
// Public, anon-callable. A client describes the style they want (photo +
// canonical style tags + budget + city + contact) and we broadcast it to
// the marketplace. Matching braiders (sub-step 2) see it and send quotes;
// the client watches them at /requests/<token>.
//
// The inspiration photo is uploaded SERVER-SIDE with the service role
// (the bucket has no anon write policy), and the request row is inserted
// with the service role too (marketplace_style_requests is RLS-locked with
// no anon policy). We return only the opaque client_token.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { STYLE_TAGS } from "../../lib/marketplace";
import { STYLE_SIZES, STYLE_LENGTHS } from "../../lib/style-request";
import { rateLimit, clientIp } from "../../lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_B64_CHARS = 9_400_000;
const ALLOWED_MEDIA = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const CANONICAL_SLUGS = new Set(STYLE_TAGS.map(s => s.slug));
const SIZE_SET = new Set<string>(STYLE_SIZES as readonly string[]);
const LENGTH_SET = new Set<string>(STYLE_LENGTHS as readonly string[]);

const fail = (status: number, message: string) =>
  NextResponse.json({ error: message }, { status });

const tooMany = (retryAfter: number) =>
  NextResponse.json(
    { error: "Too many requests — please wait a moment and try again." },
    { status: 429, headers: { "retry-after": String(retryAfter) } },
  );

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};

type Body = {
  client_name?: string;
  client_email?: string | null;
  client_phone?: string | null;
  image_base64?: string | null;
  media_type?: string | null;
  style_tags?: unknown;
  size?: string | null;
  length?: string | null;
  budget_min?: number | string | null;
  budget_max?: number | string | null;
  city?: string | null;
  state?: string | null;
  preferred_date?: string | null;
  preferred_time?: string | null;
  notes?: string | null;
};

const optNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};
const clip = (v: unknown, n: number): string | null => {
  const t = typeof v === "string" ? v.trim() : "";
  return t ? t.slice(0, n) : null;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid JSON body.");
  }

  const clientName = (body.client_name || "").trim();
  if (!clientName) return fail(400, "Please add your name.");
  if (!body.client_email && !body.client_phone) {
    return fail(400, "Add an email or phone so braiders can reach you.");
  }

  const mediaType = (body.media_type || "").trim();
  if (mediaType && !ALLOWED_MEDIA.has(mediaType)) {
    return fail(415, "Unsupported image type. Use JPEG, PNG, WebP, or GIF.");
  }
  if (typeof body.image_base64 === "string" && body.image_base64.length > MAX_IMAGE_B64_CHARS) {
    return fail(413, "That photo is too large. Please use an image under ~7 MB.");
  }

  // Posting broadcasts to braiders + uploads a photo — cap per IP.
  const ip = clientIp(req);
  const gate = rateLimit("style-request-post:ip", ip, 5, 60_000);
  if (!gate.ok) return tooMany(gate.retryAfter);

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

  // Validate style tags against the canonical vocabulary.
  const rawTags = Array.isArray(body.style_tags) ? body.style_tags : [];
  const styleTags = Array.from(
    new Set(rawTags.map(t => String(t || "").trim()).filter(t => CANONICAL_SLUGS.has(t))),
  ).slice(0, 5);

  const size = String(body.size || "").trim();
  const length = String(body.length || "").trim();

  // Optional inspiration photo — best-effort; a storage failure never
  // blocks the request.
  let photoPath: string | null = null;
  if (body.image_base64 && mediaType) {
    try {
      const imageData = body.image_base64.includes(",")
        ? body.image_base64.slice(body.image_base64.indexOf(",") + 1)
        : body.image_base64;
      const ext = mediaType === "image/png" ? "png"
        : mediaType === "image/webp" ? "webp"
        : mediaType === "image/gif" ? "gif" : "jpg";
      const path = `marketplace/${crypto.randomUUID()}.${ext}`;
      const buffer = Buffer.from(imageData, "base64");
      const { error: upErr } = await admin.storage
        .from("style-request-photos")
        .upload(path, buffer, { contentType: mediaType, upsert: false });
      if (!upErr) photoPath = path;
    } catch {
      // ignore — photo is non-critical
    }
  }

  const budgetMin = optNum(body.budget_min);
  const budgetMax = optNum(body.budget_max);

  const insert = {
    client_name: clientName.slice(0, 120),
    client_email: clip(body.client_email, 200),
    client_phone: clip(body.client_phone, 40),
    photo_path: photoPath,
    style_tags: styleTags,
    size: SIZE_SET.has(size) ? size : null,
    length: LENGTH_SET.has(length) ? length : null,
    budget_min: budgetMin,
    budget_max: budgetMax,
    city: clip(body.city, 120),
    state: clip(body.state, 60),
    preferred_date: clip(body.preferred_date, 20),
    preferred_time: clip(body.preferred_time, 40),
    notes: clip(body.notes, 1000),
  };

  let token: string | null = null;
  let requestId: string | null = null;
  try {
    const { data, error } = await admin
      .from("marketplace_style_requests")
      .insert(insert)
      .select("id, client_token")
      .maybeSingle();
    if (error || !data) throw error || new Error("no row");
    token = String((data as any).client_token);
    requestId = String((data as any).id);
  } catch {
    return fail(502, "Couldn't post your request. Please try again.");
  }

  // Fan out "new request near you" emails to matching braiders. Best-effort:
  // a notification failure never fails the client's post.
  try {
    await admin.rpc("enqueue_request_match_notifications", { p_request_id: requestId });
  } catch {
    // ignore
  }

  return NextResponse.json({ token });
}
