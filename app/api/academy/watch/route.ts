// POST /api/academy/watch  { token }
//
// Resolves a paid video purchase token to something playable, entirely
// server-side. For a link lesson it returns the external URL; for an
// uploaded lesson it mints a short-lived signed URL from the private
// academy-videos bucket. The object path and the raw external link are
// never exposed to an unpaid visitor — admin_get_video_access is
// service-role only, and the signed URL expires.
//
// Response shapes:
//   { ok: true, kind: "link", url, title, description, access_model, access_expires_at }
//   { ok: true, kind: "file", url, ... }         (url is a signed URL)
//   { ok: false, reason: "not_paid" | "expired" | "not_found" | ... }

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNED_URL_TTL = 6 * 60 * 60; // 6 hours

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};

export async function POST(req: Request) {
  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "bad_request" }, { status: 400 });
  }
  const token = String(body?.token || "").trim();
  if (!token) return NextResponse.json({ ok: false, reason: "invalid_token" }, { status: 400 });

  let supabaseUrl: string;
  let serviceKey: string;
  try {
    supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || env("SUPABASE_URL");
    serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  } catch {
    return NextResponse.json({ ok: false, reason: "not_configured" }, { status: 500 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin.rpc("admin_get_video_access", { token_in: token });
  if (error) {
    return NextResponse.json({ ok: false, reason: "error" }, { status: 500 });
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return NextResponse.json({ ok: false, reason: "not_found" }, { status: 200 });
  if (!row.ok) {
    return NextResponse.json(
      { ok: false, reason: String(row.reason || "unavailable"), access_expires_at: row.access_expires_at ?? null },
      { status: 200 },
    );
  }

  const common = {
    title: row.title || "",
    description: row.description ?? null,
    access_model: row.access_model === "rent" ? "rent" : "buy",
    access_expires_at: row.access_expires_at ?? null,
  };

  if (row.source_type === "upload" && row.storage_path) {
    // Cap the signed-URL lifetime so a rental link can't play past its
    // expiry: min(6h, time left in the rental). admin_get_video_access
    // already rejects an expired purchase, so any expiry here is future.
    let ttl = SIGNED_URL_TTL;
    if (row.access_expires_at) {
      const remaining = Math.floor((new Date(row.access_expires_at).getTime() - Date.now()) / 1000);
      if (remaining > 0) ttl = Math.min(SIGNED_URL_TTL, remaining);
    }
    const { data: signed, error: signErr } = await admin.storage
      .from("academy-videos")
      .createSignedUrl(String(row.storage_path), ttl);
    if (signErr || !signed?.signedUrl) {
      return NextResponse.json({ ok: false, reason: "unavailable" }, { status: 200 });
    }
    return NextResponse.json({ ok: true, kind: "file", url: signed.signedUrl, ...common }, { status: 200 });
  }

  // Link lesson (default) — return the external URL for embedding.
  return NextResponse.json({ ok: true, kind: "link", url: row.access_url ?? null, ...common }, { status: 200 });
}
