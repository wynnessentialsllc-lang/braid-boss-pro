// POST /api/order-tracking  { token }
//
// Public endpoint — buyers fetch the live Shippo tracking history for their
// own order via the customer_token URL on their order page. We use the
// stylist's Shippo token server-side to call Shippo /tracks; the buyer
// never sees the token. Read-only; safe to call unauthenticated.
//
// Caches lightly via Cache-Control so a buyer's refresh-spam doesn't
// hammer Shippo. Falls back gracefully when:
//   • The order has no carrier or tracking number → empty history.
//   • The stylist isn't on carrier shipping → empty history.
//   • Shippo errors / 404 → empty history (we never expose Shippo errors
//     to the buyer; the carrier_url link is the canonical authoritative
//     source).

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchTrackingHistory } from "../../lib/shippo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    return NextResponse.json({ events: [], status: null, eta: null });
  }
  const token = String(body?.token || "").trim();
  if (!token) {
    return NextResponse.json({ events: [], status: null, eta: null });
  }

  let supabaseUrl: string;
  let serviceKey: string;
  try {
    supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || env("SUPABASE_URL");
    serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  } catch (e: any) {
    return NextResponse.json({ events: [], status: null, eta: null });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Look the order up via the customer_token. We need user_id +
  // tracking_carrier + tracking_number; the public_get_order RPC doesn't
  // surface user_id (intentional — buyer-facing), so we query the table
  // directly under service role and scope by customer_token (high-entropy
  // — token IS the auth).
  const { data: order } = await admin
    .from("product_orders")
    .select("user_id, tracking_carrier, tracking_number")
    .eq("customer_token", token)
    .maybeSingle();
  if (!order || !order.tracking_carrier || !order.tracking_number) {
    return NextResponse.json({ events: [], status: null, eta: null });
  }

  const { data: shop } = await admin
    .from("shop_settings")
    .select("shippo_api_token")
    .eq("user_id", order.user_id)
    .maybeSingle();
  const shippoToken = String((shop as any)?.shippo_api_token || "").trim();
  if (!shippoToken) {
    return NextResponse.json({ events: [], status: null, eta: null });
  }

  const history = await fetchTrackingHistory(
    shippoToken,
    order.tracking_carrier,
    order.tracking_number,
  );
  if (!history) {
    return NextResponse.json({ events: [], status: null, eta: null });
  }
  // 5 min cache. Carriers update tracking on roughly that cadence anyway;
  // shorter would just hammer Shippo on a refresh-spamming buyer.
  return new NextResponse(
    JSON.stringify({ events: history.events, status: history.status, eta: history.eta }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300, s-maxage=300",
      },
    },
  );
}
