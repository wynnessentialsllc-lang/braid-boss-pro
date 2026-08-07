// Read (and, if needed, confirm) a Braid Boss Pro Store order.
//
//   POST { token, session_id? }
//
// The success page calls this to show the buyer their order + download
// links. Because the Stripe webhook and this page race, we don't just
// read the row: when the order is still 'pending' and a session_id is
// present, we retrieve the Checkout Session straight from Stripe and, if
// it's paid, fulfill it here (mark paid + send the email once — the same
// idempotent path the webhook uses). That means the download works the
// instant the buyer lands, even if the webhook is slow or not wired in a
// preview env.
//
// The customer_token is the bearer credential; no auth session needed.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  fulfillStoreOrder,
  storeBaseUrl,
  toPublicOrder,
} from "../../lib/store-fulfillment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STRIPE_API = "https://api.stripe.com/v1";

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};
const fail = (status: number, message: string) =>
  NextResponse.json({ error: message }, { status });

export async function POST(req: Request) {
  let body: { token?: string; session_id?: string };
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid JSON body.");
  }
  const token = String(body?.token || "").trim();
  const sessionId = String(body?.session_id || "").trim();
  if (!token) return fail(400, "Missing order token.");

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

  const selectCols =
    "id, customer_token, status, stripe_session_id, buyer_email, buyer_name, amount_total, currency, line_items, email_sent_at";

  const { data: order, error } = await admin
    .from("store_orders")
    .select(selectCols)
    .eq("customer_token", token)
    .maybeSingle();
  if (error) return fail(500, error.message);
  if (!order) return fail(404, "Order not found.");

  const baseUrl = storeBaseUrl(req);

  // Still pending? Try to confirm directly with Stripe so the buyer isn't
  // stuck waiting on the webhook. Only trust the session that belongs to
  // THIS order (match against the stored session id when we have one).
  if (order.status === "pending" && sessionId) {
    const belongs = !order.stripe_session_id || order.stripe_session_id === sessionId;
    if (belongs) {
      try {
        const secret = env("STRIPE_SECRET_KEY");
        const res = await fetch(
          `${STRIPE_API}/checkout/sessions/${encodeURIComponent(sessionId)}`,
          {
            headers: {
              Authorization: `Bearer ${secret}`,
              "Stripe-Version": "2024-06-20",
            },
            cache: "no-store",
          },
        );
        if (res.ok) {
          const session = (await res.json()) as any;
          const paid =
            session?.payment_status === "paid" ||
            session?.payment_status === "no_payment_required";
          const sessionMatchesOrder =
            String(session?.metadata?.store_order_id || "") === String(order.id) ||
            session?.id === order.stripe_session_id;
          if (paid && sessionMatchesOrder) {
            await fulfillStoreOrder(admin, {
              orderId: order.id,
              baseUrl,
              paymentIntent:
                typeof session?.payment_intent === "string" ? session.payment_intent : null,
              buyerEmail:
                session?.customer_details?.email || session?.customer_email || null,
              buyerName: session?.customer_details?.name || null,
            });
          }
        }
      } catch (e: any) {
        // Non-fatal: fall through and return whatever the row says now.
        console.warn("[store-order] confirm failed:", e?.message || e);
      }
    }
  }

  // Re-read so the response reflects any transition we just made.
  const { data: fresh } = await admin
    .from("store_orders")
    .select(selectCols)
    .eq("customer_token", token)
    .maybeSingle();

  return NextResponse.json({ order: toPublicOrder((fresh || order) as any, baseUrl) });
}
