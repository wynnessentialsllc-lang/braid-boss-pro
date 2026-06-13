// POST /api/delivery-check  { handle, zip }
//
// Storefront preview for local delivery: tells the buyer whether their ZIP is
// inside the shop's delivery radius (and how far) so the cart / product page
// can enable or block the "Local delivery" option before checkout. The
// checkout route re-checks authoritatively, so this is UX only.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkDeliveryRadius } from "../../lib/delivery-distance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};
const fail = (status: number, message: string) =>
  NextResponse.json({ error: message }, { status });

export async function POST(req: Request) {
  let body: { handle?: string; zip?: string };
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid JSON.");
  }
  const handle = (body?.handle || "").trim().replace(/^@/, "");
  const zip = String(body?.zip || "").trim();
  if (!handle) return fail(400, "Missing handle.");
  if (!zip) return fail(400, "Enter your ZIP code.");

  let supabaseUrl: string;
  let serviceKey: string;
  let mapboxToken = "";
  try {
    supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || env("SUPABASE_URL");
    serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
    mapboxToken = process.env.MAPBOX_TOKEN || "";
  } catch (e: any) {
    return fail(500, e?.message || "Server is not configured.");
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: resolved } = await admin.rpc("public_resolve_booking_slug", { slug_in: handle });
  const row = Array.isArray(resolved) ? resolved[0] : resolved;
  const userId = row?.user_id ? String(row.user_id) : null;
  if (!userId) return fail(404, "Shop not found.");

  try {
    const result = await checkDeliveryRadius(admin, mapboxToken, userId, zip);
    if (!result.configured) {
      // Delivery isn't radius-limited (or no geocoder) — treat as allowed.
      return NextResponse.json({ ok: true, within: true, limited: false });
    }
    return NextResponse.json({
      ok: true,
      limited: true,
      within: result.within,
      miles: result.miles,
      radius: result.radius,
      reason: result.reason || null,
    });
  } catch {
    // Geocode/transient failure shouldn't hard-block the buyer here; the
    // checkout route is the real gate.
    return NextResponse.json({ ok: true, within: true, limited: false });
  }
}
