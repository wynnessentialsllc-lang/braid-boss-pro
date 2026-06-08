// POST /api/mobile-geocode — geocode a free-text address into
// (lat, lng, zip, normalized label). Used by the stylist settings UI
// to resolve a typed "home base address" once at save time so the
// public quote route doesn't have to re-geocode on every booking.
//
// Auth: requires a signed-in Supabase user. The geocode itself costs a
// Mapbox call, so this is gated behind auth + per-user rate limit.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { geocodeAddress } from "../../lib/mapbox-geocode";
import { rateLimit, clientIp } from "../../lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fail = (status: number, message: string) =>
  NextResponse.json({ error: message }, { status });

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};

export async function POST(req: Request) {
  let body: { address?: string };
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid JSON body.");
  }
  const address = (body.address || "").trim();
  if (!address) return fail(400, "Please enter an address.");
  if (address.length < 5 || address.length > 300) {
    return fail(400, "That address doesn't look right — please double-check it.");
  }

  let supabaseUrl: string;
  let mapboxToken: string;
  try {
    supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || env("SUPABASE_URL");
  } catch (e: any) {
    return fail(500, e?.message || "Server is not configured.");
  }
  try {
    mapboxToken = env("MAPBOX_TOKEN");
  } catch {
    return fail(503, "Address lookup is temporarily unavailable.");
  }

  // Verify the caller is signed in. We don't need to talk to the DB —
  // the public anon key + the bearer token is enough to check identity.
  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) return fail(401, "Please sign in.");
  const supabase = createClient(supabaseUrl, env("SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userRes?.user?.id) return fail(401, "Please sign in.");

  const userId = userRes.user.id;
  const ipGate = rateLimit("mobile-geocode:ip", clientIp(req), 30, 60_000);
  if (!ipGate.ok) {
    return NextResponse.json(
      { error: "Too many requests — please wait a moment." },
      { status: 429, headers: { "retry-after": String(ipGate.retryAfter) } },
    );
  }
  const userGate = rateLimit("mobile-geocode:user", userId, 60, 60_000);
  if (!userGate.ok) {
    return NextResponse.json(
      { error: "Too many requests — please wait a moment." },
      { status: 429, headers: { "retry-after": String(userGate.retryAfter) } },
    );
  }

  // Auto-augment a bare street address with the stylist's saved
  // city + state from booking_links so "5309 Knowlton St" resolves
  // instead of failing because the same street name exists in other
  // states. Best-effort: if the lookup fails, we still geocode the
  // raw input verbatim.
  let ctxCity: string | null = null;
  let ctxState: string | null = null;
  try {
    const supabaseUrl2 = process.env.NEXT_PUBLIC_SUPABASE_URL || env("SUPABASE_URL");
    const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(supabaseUrl2, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: linkRow } = await admin
      .from("booking_links")
      .select("business_city, business_state, mobile_base_lat, mobile_base_lng")
      .eq("user_id", userId)
      .maybeSingle();
    ctxCity = linkRow?.business_city ?? null;
    ctxState = linkRow?.business_state ?? null;
  } catch {
    /* fall through — we still try without context */
  }

  try {
    const hit = await geocodeAddress(mapboxToken, address, {
      city: ctxCity, state: ctxState,
    });
    if (!hit) return fail(422, "We couldn't find that address — try adding a city / zip.");
    return NextResponse.json({
      ok: true,
      lat: hit.lat,
      lng: hit.lng,
      zip: hit.zip || null,
      label: hit.label,
    });
  } catch {
    return fail(502, "Address lookup failed. Please try again.");
  }
}
