// POST /api/waitlist-join — a public booking-page visitor joins a
// stylist's waitlist.
//
// Public, anon-callable. Previously the browser inserted straight into
// public.waitlist_requests via an anon "with check (true)" INSERT policy,
// which meant a scripted client could spray unlimited rows at the table
// with the public anon key. This route funnels the same submission
// through the server so we can (a) rate-limit per IP and (b) reject rows
// aimed at a user_id that isn't a real booking owner. The row is written
// with the service role; the companion migration revokes the anon INSERT
// grant so the direct path is closed.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { rateLimit, clientIp } from "../../lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FLEXIBILITY = new Set(["anytime", "morning", "afternoon", "evening", "specific"]);
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

type Body = {
  user_id?: string;
  client_name?: string;
  client_phone?: string | null;
  client_email?: string | null;
  service_id?: string | null;
  service_name?: string | null;
  preferred_date?: string | null;
  preferred_time?: string | null;
  flexibility?: string | null;
  notes?: string | null;
  timezone?: string | null;
  locale?: string | null;
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

  const ownerUserId = (body.user_id || "").trim();
  if (!ownerUserId || !UUID_RE.test(ownerUserId)) {
    return fail(400, "This booking link is misconfigured.");
  }

  // Joining the waitlist is a lightweight action; allow a small burst but
  // stop a scripted flood cold.
  const ip = clientIp(req);
  const gate = rateLimit("waitlist-join:ip", ip, 8, 60_000);
  if (!gate.ok) return tooMany(gate.retryAfter);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return fail(500, "Server is not configured.");

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Reject rows aimed at a user_id that isn't a real booking owner — this
  // is what stops someone spraying junk at arbitrary/nonexistent accounts.
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

  const flex = String(body.flexibility || "").trim();
  const serviceId = String(body.service_id || "").trim();

  const insert = {
    user_id: ownerUserId,
    client_name: clientName,
    client_phone: clip(body.client_phone, 40),
    client_email: clip(body.client_email, 200),
    service_id: UUID_RE.test(serviceId) ? serviceId : null,
    service_name: clip(body.service_name, 200),
    preferred_date: clip(body.preferred_date, 20),
    preferred_time: clip(body.preferred_time, 40),
    flexibility: FLEXIBILITY.has(flex) ? flex : null,
    notes: clip(body.notes, 1000),
    source: "public_waitlist",
    timezone: clip(body.timezone, 80),
    locale: clip(body.locale, 40),
    created_from_public: true,
  };

  try {
    const { data, error } = await admin
      .from("waitlist_requests")
      .insert(insert)
      .select("id")
      .maybeSingle();
    if (error || !data) throw error || new Error("no row");
    return NextResponse.json({ ok: true, id: String((data as any).id) });
  } catch {
    return fail(502, "Couldn't submit your request. Please try again.");
  }
}
