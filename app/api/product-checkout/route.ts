// Storefront Commerce Phase 1 — Stripe Checkout Session for a single
// product. Mirrors app/api/booking-deposit/checkout/route.ts: direct
// charges on the stylist's connected account, optional platform
// application fee in basis points, ad-hoc line items (no Stripe
// Product/Price stored), and a product_orders row written before
// the session is returned so the webhook can mark it paid by
// stripe_session_id.
//
// Inputs:
//   body.handle          — stylist URL handle (the bit after /@)
//   body.product_slug    — the per-stylist unique product slug
//   body.quantity        — defaults to 1; capped at 99 for safety
//
// On success: { url } — the Checkout Session URL. Browser redirects.
//
// All charges land directly in the stylist's Stripe balance via the
// Stripe-Account header; the platform takes PLATFORM_FEE_BPS bps as
// an application fee when set.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

const baseUrlOf = (req: Request): string => {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  try {
    return new URL(req.url).origin;
  } catch {
    return "";
  }
};

export async function POST(req: Request) {
  let body: { handle?: string; product_slug?: string; quantity?: number };
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid JSON body.");
  }
  const handle = (body?.handle || "").trim().replace(/^@/, "");
  const productSlug = (body?.product_slug || "").trim();
  // Clamp quantity to 1..99. Negative / zero / non-finite all collapse
  // to 1 so a malformed client never charges a nonsense amount.
  const rawQty = Number(body?.quantity);
  const quantity = Number.isFinite(rawQty) && rawQty >= 1 ? Math.min(99, Math.floor(rawQty)) : 1;

  if (!handle) return fail(400, "Missing stylist handle.");
  if (!productSlug) return fail(400, "Missing product slug.");

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

  // Resolve the product. The SECURITY DEFINER RPC handles handle →
  // user_id lookup AND joins in stripe_connect_account_id /
  // charges_enabled, so we don't need a second profiles read.
  const { data: rpcRows, error: rpcErr } = await admin.rpc(
    "public_get_product",
    { slug_in: handle, product_slug_in: productSlug },
  );
  if (rpcErr) return fail(500, rpcErr.message);
  const product = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
  if (!product) return fail(404, "Product not found.");

  const acctId: string | null = product.stylist_account_id || null;
  if (!acctId) return fail(409, "Stylist hasn't connected Stripe yet.");
  if (!product.stylist_charges_enabled) {
    return fail(409, "Stylist's Stripe account isn't ready to take charges.");
  }
  if (product.external_checkout_url) {
    return fail(
      409,
      "This product is sold through an external storefront — open the product page link instead.",
    );
  }

  const price = product.price == null ? null : Number(product.price);
  if (price == null || !Number.isFinite(price) || price < 0) {
    return fail(400, "This product doesn't have a price set.");
  }

  // Stock guard. inventory_count = null → untracked; else require >=
  // quantity. We do this here (not just in the RPC) so the user gets
  // a friendly error rather than a Stripe 4xx after redirect.
  if (
    product.inventory_count != null &&
    Number(product.inventory_count) < quantity
  ) {
    return fail(409, "Not enough stock to fulfill that quantity.");
  }

  const unitAmountCents = Math.round(price * 100);
  const subtotalCents = unitAmountCents * quantity;
  const baseUrl = baseUrlOf(req);

  const feeBps = (() => {
    const raw = Number(process.env.PLATFORM_FEE_BPS || 0);
    if (!Number.isFinite(raw) || raw < 0 || raw > 10_000) return 0;
    return Math.floor(raw);
  })();
  const applicationFeeCents = feeBps > 0 ? Math.floor((subtotalCents * feeBps) / 10_000) : 0;

  // Pre-insert the order row. We need an id for the metadata, and
  // having the row in 'pending' state means a webhook arriving
  // ahead of the persisted-session-id update can still find us.
  const lineItem = {
    product_id: String(product.id),
    product_slug: product.slug,
    title: product.title,
    unit_amount: price,
    quantity,
    requires_shipping: !!product.requires_shipping,
  };
  const { data: order, error: orderErr } = await admin
    .from("product_orders")
    .insert({
      user_id: product.user_id,
      stripe_account_id: acctId,
      amount_total: (subtotalCents / 100).toFixed(2),
      application_fee: applicationFeeCents > 0 ? (applicationFeeCents / 100).toFixed(2) : null,
      currency: "usd",
      shipping_required: !!product.requires_shipping,
      line_items: [lineItem],
      metadata: {
        handle,
        product_slug: product.slug,
      },
    })
    .select("id")
    .maybeSingle();
  if (orderErr || !order?.id) {
    return fail(500, orderErr?.message || "Couldn't create the order row.");
  }

  // Build the Checkout Session payload. URLSearchParams form-encode
  // matches what the booking-deposit route does so the Stripe-Account
  // header semantics are identical.
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("payment_method_types[]", "card");
  form.set("line_items[0][quantity]", String(quantity));
  form.set("line_items[0][price_data][currency]", "usd");
  form.set("line_items[0][price_data][unit_amount]", String(unitAmountCents));
  form.set("line_items[0][price_data][product_data][name]", product.title);
  if (product.image_url) {
    form.set("line_items[0][price_data][product_data][images][]", product.image_url);
  }
  form.set(
    "success_url",
    `${baseUrl}/shop/success?session_id={CHECKOUT_SESSION_ID}&handle=${encodeURIComponent(handle)}`,
  );
  form.set(
    "cancel_url",
    `${baseUrl}/@${encodeURIComponent(handle)}/products/${encodeURIComponent(product.slug)}?cancelled=1`,
  );
  if (product.requires_shipping) {
    form.set("shipping_address_collection[allowed_countries][]", "US");
    form.set("phone_number_collection[enabled]", "true");
  }
  // Metadata — everything the webhook needs to look the order up
  // and the dashboard needs to display human-readable context.
  form.set("metadata[product_order_id]", String(order.id));
  form.set("metadata[stylist_user_id]", String(product.user_id));
  form.set("metadata[stylist_account_id]", acctId);
  form.set("metadata[product_id]", String(product.id));
  form.set("metadata[product_slug]", product.slug);
  form.set("metadata[handle]", handle);
  form.set("metadata[quantity]", String(quantity));
  form.set("payment_intent_data[metadata][product_order_id]", String(order.id));
  if (applicationFeeCents > 0) {
    form.set("payment_intent_data[application_fee_amount]", String(applicationFeeCents));
  }

  const stripeRes = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecret}`,
      "Stripe-Version": "2024-06-20",
      "Stripe-Account": acctId,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
    cache: "no-store",
  });
  if (!stripeRes.ok) {
    const text = await stripeRes.text().catch(() => "");
    // Mark the order failed so we don't accumulate stuck pending rows
    // when Stripe rejects the session up front.
    await admin
      .from("product_orders")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", order.id);
    return fail(502, `Stripe rejected the session (${stripeRes.status}). ${text.slice(0, 200)}`);
  }
  const session = (await stripeRes.json()) as { id?: string; url?: string };
  if (!session.id || !session.url) {
    await admin.from("product_orders").update({ status: "failed" }).eq("id", order.id);
    return fail(502, "Stripe returned an unusable session.");
  }

  // Stamp the session id so the webhook can route paid events to
  // this row. The handle / product_slug are already in metadata for
  // observability.
  await admin
    .from("product_orders")
    .update({ stripe_session_id: session.id, updated_at: new Date().toISOString() })
    .eq("id", order.id);

  return NextResponse.json({ url: session.url });
}
