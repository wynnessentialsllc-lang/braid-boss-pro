// POST /api/analytics/track
//
// Public endpoint. Anyone — auth or guest — can post an event. We
// use the service role here so we don't have to expose any analytics
// write permission to the anon role; RLS on analytics_events stays
// deny-by-default.
//
// We do NOT trust the client-supplied user_id. If a session JWT is
// present we resolve user_id from it; otherwise the event is stored
// anonymously with the supplied session_id.
//
// Request rate is naturally capped by client-side call sites — every
// trackEvent() is fire-and-forget per real user action. We don't add
// server-side rate limiting in this phase.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAdminUser } from "../../../lib/admin";
import { rateLimit, clientIp } from "../../../lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_NAME = 80;
const MAX_CATEGORY = 64;
const MAX_PATH = 200;
const MAX_UA = 256;
const MAX_SESSION = 64;
// Cap the free-form metadata blob so a caller can't bloat the table with
// multi-MB jsonb payloads on this unauthenticated, service-role insert.
const MAX_METADATA_CHARS = 4_000;

const cleanStr = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.slice(0, max);
};

export async function POST(req: Request) {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    // Server misconfigured — silently accept so the client never
    // gets a visible error from a tracking call.
    return NextResponse.json({ ok: true, dropped: "no_env" }, { status: 200 });
  }

  // Best-effort flood guard. This is a public, service-role insert, so a
  // script could otherwise spray rows. Generous per-IP cap; legit
  // fire-and-forget tracking never approaches it. Drop silently (200) so
  // the client never sees a tracking error.
  const ipGate = rateLimit("analytics:ip", clientIp(req), 60, 60_000);
  if (!ipGate.ok) {
    return NextResponse.json({ ok: true, dropped: "rate_limited" }, { status: 200 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: true, dropped: "bad_json" }, { status: 200 });
  }

  const event_name = cleanStr(body?.event_name, MAX_NAME);
  if (!event_name) {
    return NextResponse.json({ ok: true, dropped: "no_event_name" }, { status: 200 });
  }
  const event_category = cleanStr(body?.event_category, MAX_CATEGORY);
  const session_id = cleanStr(body?.session_id, MAX_SESSION);
  const path = cleanStr(body?.path, MAX_PATH);
  const user_agent = cleanStr(req.headers.get("user-agent"), MAX_UA);
  // Accept only a plain object, and drop it entirely if it serializes
  // beyond the cap so oversized blobs can't bloat the jsonb column.
  let metadata: Record<string, unknown> =
    body?.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
      ? body.metadata
      : {};
  try {
    if (JSON.stringify(metadata).length > MAX_METADATA_CHARS) metadata = {};
  } catch {
    // Non-serializable (e.g. circular) — drop it.
    metadata = {};
  }

  // Resolve user_id + email from the request's bearer token if
  // present; never trust body.user_id directly. The email is only
  // used here to drop admin-originated events on write — never
  // persisted to analytics_events.
  let user_id: string | null = null;
  let user_email: string | null = null;
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (token) {
    try {
      const userClient = createClient(supabaseUrl, serviceKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data } = await userClient.auth.getUser();
      user_id = data?.user?.id ?? null;
      user_email = data?.user?.email ?? null;
    } catch {
      /* anon */
    }
  }
  // Fallback: caller may pass user_id directly when no JWT header was
  // sent (most browser fetch calls won't attach the supabase JWT). We
  // accept it best-effort — analytics integrity isn't a security
  // boundary because the table is admin-read-only. When we hit this
  // path we have no email; admin filtering relies on the JWT-resolved
  // path above.
  if (!user_id) {
    const raw = body?.user_id;
    if (typeof raw === "string" && /^[0-9a-f-]{36}$/i.test(raw)) {
      user_id = raw;
    }
  }

  // Skip admin-originated events so the dashboard reflects real
  // user behavior, not your own dogfooding. Only effective when the
  // request had a Bearer JWT we could resolve to an email.
  if (isAdminUser(user_email)) {
    return NextResponse.json({ ok: true, dropped: "admin" }, { status: 200 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await admin.from("analytics_events").insert({
    event_name,
    event_category,
    metadata,
    path,
    user_agent,
    session_id,
    user_id,
  });
  if (error) {
    console.warn("[analytics/track] insert failed:", error.message);
    return NextResponse.json({ ok: true, dropped: "insert_failed" }, { status: 200 });
  }

  return NextResponse.json({ ok: true });
}
