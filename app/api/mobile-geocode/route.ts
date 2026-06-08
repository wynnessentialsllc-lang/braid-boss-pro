// POST /api/mobile-geocode — geocode a free-text address into
// (lat, lng, zip, normalized label). Used by the stylist settings UI
// to resolve a typed "home base address" once at save time so the
// public quote route doesn't have to re-geocode on every booking.
//
// Auth: requires a signed-in Supabase user. The geocode itself costs a
// Mapbox call, so this is gated behind auth + per-user rate limit.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeZip } from "../../lib/mobile-service";
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

  const url = new URL(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json`,
  );
  url.searchParams.set("access_token", mapboxToken);
  url.searchParams.set("country", "us");
  url.searchParams.set("types", "address,postcode,place");
  url.searchParams.set("limit", "1");
  url.searchParams.set("autocomplete", "false");

  try {
    const res = await fetch(url.toString(), { method: "GET" });
    if (!res.ok) return fail(502, "Address lookup failed. Please try again.");
    const data = await res.json().catch(() => null) as any;
    const feature = data?.features?.[0];
    if (!feature || !Array.isArray(feature.center) || feature.center.length < 2) {
      return fail(422, "We couldn't find that address — try adding a city / zip.");
    }
    const [lng, lat] = feature.center as [number, number];
    const contextZip = Array.isArray(feature.context)
      ? feature.context.find((c: any) => typeof c?.id === "string" && c.id.startsWith("postcode"))?.text
      : null;
    const zip = normalizeZip(contextZip || feature.text || feature.place_name);
    return NextResponse.json({
      ok: true,
      lat: Number(lat),
      lng: Number(lng),
      zip: zip || null,
      label: String(feature.place_name || address).slice(0, 200),
    });
  } catch {
    return fail(502, "Address lookup failed. Please try again.");
  }
}
