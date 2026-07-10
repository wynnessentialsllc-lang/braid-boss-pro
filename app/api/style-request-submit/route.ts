// POST /api/style-request-submit — a public booking-page visitor sends a
// "Build Your Style" request to a stylist's review queue.
//
// Public, anon-callable. Previously BuildYourStyle inserted straight into
// public.style_requests via an anon "with check (true)" INSERT policy, so
// a scripted client could spray the table with the public anon key. This
// route funnels the same submission through the server so we can rate-limit
// per IP and reject rows aimed at a user_id that isn't a real booking
// owner. The row is written with the service role; the companion migration
// revokes the anon INSERT grant so the direct path is closed.
//
// NOTE: distinct from /api/style-request-post, which posts an OPEN
// marketplace request (public.marketplace_style_requests). This route
// targets a single stylist's private review queue (public.style_requests).

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { rateLimit, clientIp } from "../../lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mirror the DB check constraints exactly so a bad value becomes null
// rather than a failed insert.
const SIZES = new Set(["micro", "small", "medium", "large", "jumbo"]);
const LENGTHS = new Set(["shoulder", "mid_back", "waist", "hip", "butt"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fail = (status: number, message: string) =>
  NextResponse.json({ error: message }, { status });

const tooMany = (retryAfter: number) =>
  NextResponse.json(
    { error: "Too many requests — please wait a moment and try again." },
    { status: 429, headers: { "retry-after": String(retryAfter) } },
  );

const clip = (v: unknown, n: number): string | null => {
  const t = typeof v === "string" ? v.trim() : "";
  return t ? t.slice(0, n) : null;
};
const optBool = (v: unknown): boolean | null =>
  v === true ? true : v === false ? false : null;
const optNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};

type Body = {
  user_id?: string;
  client_name?: string;
  client_phone?: string | null;
  client_email?: string | null;
  photo_path?: string | null;
  size?: string | null;
  length?: string | null;
  hair_included?: boolean | null;
  human_hair?: boolean | null;
  color?: string | null;
  notes?: string | null;
  preferred_date?: string | null;
  preferred_time?: string | null;
  ai_style_family?: string | null;
  ai_suggested_service_id?: string | null;
  ai_price_low?: number | string | null;
  ai_price_high?: number | string | null;
  ai_est_duration_hours?: number | string | null;
  ai_rationale?: string | null;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid JSON body.");
  }

  const clientName = clip(body.client_name, 120);
  if (!clientName) return fail(400, "Please add your name.");
  if (!body.client_email && !body.client_phone) {
    return fail(400, "Add an email or phone so the stylist can reach you.");
  }

  const ownerUserId = (body.user_id || "").trim();
  if (!ownerUserId || !UUID_RE.test(ownerUserId)) {
    return fail(400, "This booking link is misconfigured.");
  }

  // Sending a request fans out a notification to the stylist — cap per IP.
  const ip = clientIp(req);
  const gate = rateLimit("style-request-submit:ip", ip, 5, 60_000);
  if (!gate.ok) return tooMany(gate.retryAfter);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return fail(500, "Server is not configured.");

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: owner } = await admin
      .from("booking_links")
      .select("user_id")
      .eq("user_id", ownerUserId)
      .limit(1)
      .maybeSingle();
    if (!owner) return fail(400, "This booking link is misconfigured.");
  } catch {
    return fail(502, "Couldn't reach the server. Please try again.");
  }

  const size = String(body.size || "").trim();
  const length = String(body.length || "").trim();
  const suggested = String(body.ai_suggested_service_id || "").trim();

  const insert = {
    user_id: ownerUserId,
    client_name: clientName,
    client_phone: clip(body.client_phone, 40),
    client_email: clip(body.client_email, 200),
    photo_path: clip(body.photo_path, 400),
    size: SIZES.has(size) ? size : null,
    length: LENGTHS.has(length) ? length : null,
    hair_included: optBool(body.hair_included),
    human_hair: optBool(body.human_hair),
    color: clip(body.color, 120),
    notes: clip(body.notes, 1000),
    preferred_date: clip(body.preferred_date, 20),
    preferred_time: clip(body.preferred_time, 40),
    ai_style_family: clip(body.ai_style_family, 120),
    ai_suggested_service_id: UUID_RE.test(suggested) ? suggested : null,
    ai_price_low: optNum(body.ai_price_low),
    ai_price_high: optNum(body.ai_price_high),
    ai_est_duration_hours: optNum(body.ai_est_duration_hours),
    ai_rationale: clip(body.ai_rationale, 2000),
    // Status is set server-side — never trust the client to skip review.
    status: "submitted",
  };

  try {
    const { data, error } = await admin
      .from("style_requests")
      .insert(insert)
      .select("id")
      .maybeSingle();
    if (error || !data) throw error || new Error("no row");
    return NextResponse.json({ ok: true, id: String((data as any).id) });
  } catch {
    return fail(502, "Couldn't send your request. Please try again.");
  }
}
