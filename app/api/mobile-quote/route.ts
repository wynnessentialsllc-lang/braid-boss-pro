// POST /api/mobile-quote — public booking-page quote for a mobile
// service. Takes { slug, service_id, address }, geocodes the address
// via Mapbox, computes the distance from the stylist's home base, and
// returns { in_area, distance_miles, travel_fee, blocked_reason }.
//
// Anonymous endpoint. Rate-limited per IP and per slug because each
// call costs a Mapbox geocode (1 of 100k/month on the free tier).
//
// Why server-side: keeping MAPBOX_TOKEN off the client; checking the
// service's pricing/area config against the live DB so a tampered
// payload can't quote a discount; resolving the slug -> user_id and
// reading the stylist's home base coords with the service role.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  calculateTravelFee,
  haversineMiles,
  isInServiceArea,
  MOBILE_FEE_MODELS,
  type MobileFeeModel,
} from "../../lib/mobile-service";
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

type Body = {
  slug?: string;
  service_id?: string;
  address?: string;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid JSON body.");
  }

  const slug = (body.slug || "").trim();
  const serviceId = (body.service_id || "").trim();
  const address = (body.address || "").trim();
  if (!slug) return fail(400, "Missing booking link.");
  if (!serviceId) return fail(400, "Missing service.");
  if (!address) return fail(400, "Please enter an address.");
  if (address.length < 5 || address.length > 300) {
    return fail(400, "That address doesn't look right — please double-check it.");
  }

  // Throttle: each call hits Mapbox + Supabase. 30/min per IP, 120/min
  // per slug. Real clients tweak their address a handful of times max.
  const ip = clientIp(req);
  const ipGate = rateLimit("mobile-quote:ip", ip, 30, 60_000);
  if (!ipGate.ok) {
    return NextResponse.json(
      { error: "Too many requests — please wait a moment." },
      { status: 429, headers: { "retry-after": String(ipGate.retryAfter) } },
    );
  }
  const slugGate = rateLimit("mobile-quote:slug", slug.toLowerCase(), 120, 60_000);
  if (!slugGate.ok) {
    return NextResponse.json(
      { error: "Too many requests — please wait a moment." },
      { status: 429, headers: { "retry-after": String(slugGate.retryAfter) } },
    );
  }

  let supabaseUrl: string;
  let serviceKey: string;
  let mapboxToken: string;
  try {
    supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || env("SUPABASE_URL");
    serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  } catch (e: any) {
    return fail(500, e?.message || "Server is not configured.");
  }
  try {
    mapboxToken = env("MAPBOX_TOKEN");
  } catch {
    return fail(503, "Mobile quotes are temporarily unavailable. Please contact the stylist.");
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Resolve slug -> mobile config (base coords + radius + blocked zips).
  let cfgRow: {
    user_id: string;
    base_lat: number | null;
    base_lng: number | null;
    base_zip: string | null;
    radius_miles: number;
    blocked_zips: string[];
  } | null = null;
  try {
    const { data, error } = await admin.rpc("public_get_mobile_config", { slug_in: slug });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : (data as any);
    if (row) {
      cfgRow = {
        user_id: String(row.user_id),
        base_lat: row.base_lat == null ? null : Number(row.base_lat),
        base_lng: row.base_lng == null ? null : Number(row.base_lng),
        base_zip: row.base_zip ?? null,
        radius_miles: Number(row.radius_miles) || 0,
        blocked_zips: Array.isArray(row.blocked_zips) ? row.blocked_zips : [],
      };
    }
  } catch {
    return fail(502, "Couldn't look up this booking link.");
  }
  if (!cfgRow) return fail(404, "Booking link not found.");
  if (cfgRow.base_lat == null || cfgRow.base_lng == null) {
    return fail(409, "This stylist hasn't set their travel base yet — please contact them.");
  }

  // Load the service (mobile fee model + values). We trust the DB, not
  // the client payload, so a tampered service_id can't reprice the trip.
  let svc: any = null;
  try {
    const { data, error } = await admin
      .from("services")
      .select(
        "id, name, base_price, is_active, mobile_service, mobile_fee_model, "
        + "mobile_flat_fee, mobile_per_mile_fee, mobile_hybrid_free_miles, "
        + "mobile_tiered_bands, mobile_minimum_price",
      )
      .eq("id", serviceId)
      .eq("user_id", cfgRow.user_id)
      .maybeSingle();
    if (error) throw error;
    svc = data;
  } catch {
    return fail(502, "Couldn't look up this service.");
  }
  if (!svc || svc.is_active === false) return fail(404, "Service not found.");
  if (!svc.mobile_service) return fail(409, "This service is studio-only.");
  if (!MOBILE_FEE_MODELS.includes(svc.mobile_fee_model as MobileFeeModel)) {
    return fail(500, "This service's travel pricing is misconfigured.");
  }

  // Fetch the stylist's saved city/state to give Mapbox enough context
  // to lock onto a street name when the client typed "1234 Knowlton
  // St" without their city. Plus pass the base coords as a proximity
  // bias so nearby hits win over identically-named streets elsewhere.
  let ctxCity: string | null = null;
  let ctxState: string | null = null;
  try {
    const { data: linkRow } = await admin
      .from("booking_links")
      .select("business_city, business_state")
      .eq("user_id", cfgRow.user_id)
      .maybeSingle();
    ctxCity = linkRow?.business_city ?? null;
    ctxState = linkRow?.business_state ?? null;
  } catch {
    /* fall through — proceed without city/state context */
  }

  // Geocode + distance. A null geocode (Mapbox couldn't resolve the
  // string) is a soft 422 so the client can retype the address.
  let hit: Awaited<ReturnType<typeof geocodeAddress>> = null;
  try {
    hit = await geocodeAddress(mapboxToken, address, {
      city: ctxCity,
      state: ctxState,
      proximity: { lat: cfgRow.base_lat, lng: cfgRow.base_lng },
    });
  } catch {
    return fail(502, "Couldn't look up that address. Please try again.");
  }
  if (!hit) return fail(422, "We couldn't find that address — try adding a city / zip.");

  const miles = haversineMiles(
    { lat: cfgRow.base_lat, lng: cfgRow.base_lng },
    { lat: hit.lat, lng: hit.lng },
  );

  const area = isInServiceArea(
    { radius_miles: cfgRow.radius_miles, blocked_zips: cfgRow.blocked_zips },
    miles,
    hit.zip,
  );

  if (!area.ok) {
    return NextResponse.json({
      ok: true,
      in_area: false,
      blocked_reason: area.reason,
      distance_miles: Number(miles.toFixed(2)),
      address: hit.label,
      zip: hit.zip || null,
    });
  }

  const travelFee = calculateTravelFee(svc, miles);
  const meetsMinimum = svc.mobile_minimum_price == null
    || Number(svc.base_price) >= Number(svc.mobile_minimum_price);

  return NextResponse.json({
    ok: true,
    in_area: true,
    distance_miles: Number(miles.toFixed(2)),
    travel_fee: travelFee,
    address: hit.label,
    zip: hit.zip || null,
    lat: hit.lat,
    lng: hit.lng,
    meets_minimum: meetsMinimum,
    minimum_price: svc.mobile_minimum_price == null ? null : Number(svc.mobile_minimum_price),
  });
}
