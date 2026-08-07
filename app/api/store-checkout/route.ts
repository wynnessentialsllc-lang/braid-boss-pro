// Create a Stripe Checkout Session for the Braid Boss Pro Store.
//
//   POST { slug, buyer_email, buyer_name?, quantity? }
//
// This is the platform's OWN store — the charge is created on the
// PLATFORM Stripe account (no Stripe-Account header, no Connect, no
// application fee), unlike the tenant storefront's product-checkout which
// charges AS the stylist. The price is read server-side from the catalog
// (app/lib/store-catalog.ts); the client never sends an amount.
//
// A pending store_orders row is written first (carrying the bearer
// customer_token), then the Stripe session; the webhook — or the
// success-page confirm — flips it to 'paid' and delivers the download.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  getStoreProduct,
  isPurchasable,
  unitPriceCents,
} from "../../lib/store-catalog";
import { storeBaseUrl } from "../../lib/store-fulfillment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STRIPE_API = "https://api.stripe.com/v1";
const MAX_QUANTITY = 10;

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};
const fail = (status: number, message: string) =>
  NextResponse.json({ error: message }, { status });

export async function POST(req: Request) {
  let body: {
    slug?: string;
    buyer_email?: string;
    buyer_name?: string;
    quantity?: number;
  };
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid JSON body.");
  }

  const slug = String(body?.slug || "").trim();
  if (!slug) return fail(400, "Missing product.");

  // Light email validation — Stripe re-validates, but we prefill it on the
  // session and store it, so keep obvious junk out.
  const buyerEmail = String(body?.buyer_email || "").trim().slice(0, 254).toLowerCase();
  if (!buyerEmail || !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(buyerEmail)) {
    return fail(400, "A valid email is required.");
  }
  const buyerName = String(body?.buyer_name || "").trim().slice(0, 120) || null;
  const quantity = Math.max(1, Math.min(MAX_QUANTITY, Math.floor(Number(body?.quantity || 1))));

  // Resolve the product from the catalog — the authority for name + price.
  const product = getStoreProduct(slug);
  if (!product) return fail(404, "That product doesn't exist.");
  if (!isPurchasable(product)) {
    // Active-but-unconfigured (no price / missing digital file) or a
    // "coming soon" launch item. Never take money for it.
    return fail(409, "This product isn't available for purchase yet.");
  }

  const unitCents = unitPriceCents(product);
  // Digital-only for now: no shipping address, no fulfillment method.
  const digitalOnly = product.isDigital;

  let stripeSecret: string;
  let supabaseUrl: string;
  let serviceKey: string;
  try {
    stripeSecret = env("STRIPE_SECRET_KEY");
    supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || env("SUPABASE_URL");
    serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  } catch (e: any) {
    return fail(500, e?.message || "Server is not configured.");
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const amountTotalDollars = (unitCents * quantity) / 100;

  // Snapshot the purchase. The download route re-derives the file path
  // from the live catalog, so line_items only needs identity + price.
  const lineItemsJson = [
    {
      slug: product.slug,
      name: product.name,
      unit_amount: unitCents / 100,
      quantity,
      is_digital: product.isDigital,
    },
  ];

  const { data: order, error: orderErr } = await admin
    .from("store_orders")
    .insert({
      status: "pending",
      buyer_email: buyerEmail,
      buyer_name: buyerName,
      currency: product.currency,
      amount_total: amountTotalDollars.toFixed(2),
      line_items: lineItemsJson,
      metadata: { slug: product.slug, quantity },
    })
    .select("id, customer_token")
    .maybeSingle();
  if (orderErr || !order?.id) {
    return fail(500, orderErr?.message || "Couldn't create the order.");
  }

  const baseUrl = storeBaseUrl(req);
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("customer_email", buyerEmail);
  // Ad-hoc price_data, no Stripe Product objects — mirrors product-checkout.
  form.set("line_items[0][quantity]", String(quantity));
  form.set("line_items[0][price_data][currency]", product.currency);
  form.set("line_items[0][price_data][unit_amount]", String(unitCents));
  form.set("line_items[0][price_data][product_data][name]", product.name);
  if (product.tagline) {
    form.set(
      "line_items[0][price_data][product_data][description]",
      product.tagline.slice(0, 500),
    );
  }
  if (product.image && /^https?:\/\//i.test(product.image)) {
    // Stripe requires absolute image URLs; skip local /public paths.
    form.set("line_items[0][price_data][product_data][images][]", product.image);
  }
  form.set(
    "success_url",
    `${baseUrl}/store/success?token=${encodeURIComponent(order.customer_token)}&session_id={CHECKOUT_SESSION_ID}`,
  );
  form.set("cancel_url", `${baseUrl}/store/${encodeURIComponent(product.slug)}?cancelled=1`);
  form.set("metadata[store_order_id]", String(order.id));
  form.set("metadata[slug]", product.slug);
  form.set("payment_intent_data[metadata][store_order_id]", String(order.id));
  // Let Stripe surface eligible payment methods (card + wallets). Digital
  // goods need no address; a physical product later would add
  // shipping_address_collection here.
  if (!digitalOnly) {
    form.set("shipping_address_collection[allowed_countries][]", "US");
    form.set("phone_number_collection[enabled]", "true");
  }

  const stripeRes = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecret}`,
      "Stripe-Version": "2024-06-20",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
    cache: "no-store",
  });
  if (!stripeRes.ok) {
    const text = await stripeRes.text().catch(() => "");
    await admin
      .from("store_orders")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", order.id);
    return fail(502, `Stripe rejected the session (${stripeRes.status}). ${text.slice(0, 200)}`);
  }
  const session = (await stripeRes.json()) as { id?: string; url?: string };
  if (!session.id || !session.url) {
    await admin.from("store_orders").update({ status: "failed" }).eq("id", order.id);
    return fail(502, "Stripe returned an unusable session.");
  }

  await admin
    .from("store_orders")
    .update({ stripe_session_id: session.id, updated_at: new Date().toISOString() })
    .eq("id", order.id);

  return NextResponse.json({ url: session.url, order_token: order.customer_token });
}
