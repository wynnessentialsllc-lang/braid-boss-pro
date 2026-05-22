// Create a Stripe Checkout Session for a storefront cart.
//
// Accepts two payload shapes for backwards compatibility:
//
//   • single item  — { handle, product_slug, quantity, variant_id }
//     (legacy single-product Buy Now path; pre-Phase-2 cart)
//
//   • cart         — { handle, items: [{ product_slug, quantity, variant_id }] }
//     (Phase 2 multi-item path; up to 30 items per checkout)
//
// Server validates every line against the public RPC: each product
// must be active, priced, in stock for the requested quantity, and
// the variant (when the product declares variants) must resolve.
// Bad lines are rejected with a 4xx rather than charging the customer
// a partial cart.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STRIPE_API = "https://api.stripe.com/v1";
const MAX_LINES = 30;
// Buyer-chosen gift-card amount bounds (dollars). Enforced here so a
// hand-crafted request can't mint a $100k gift card.
const GIFT_CARD_MIN = 10;
const GIFT_CARD_MAX = 200;

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

type ResolvedLine = {
  product_id: string;
  product_slug: string;
  title: string;
  image_url: string | null;
  unit_amount_dollars: number;
  unit_amount_cents: number;
  quantity: number;
  requires_shipping: boolean;
  variant_label: string | null;
  variant_id: string | null;
  variant_name: string | null;
};

export async function POST(req: Request) {
  let body: {
    handle?: string;
    product_slug?: string;
    quantity?: number;
    variant_id?: string | null;
    custom_amount?: number | null;
    gift_card_code?: string | null;
    items?: Array<{ product_slug?: string; quantity?: number; variant_id?: string | null; custom_amount?: number | null }>;
  };
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid JSON body.");
  }
  const handle = (body?.handle || "").trim().replace(/^@/, "");
  if (!handle) return fail(400, "Missing stylist handle.");
  const giftCardCode = String(body?.gift_card_code || "").trim().toUpperCase();

  // Normalize to a uniform list of {product_slug, quantity, variant_id,
  // custom_amount}. Legacy single-item payloads are wrapped to length 1.
  const inputItems: Array<{ product_slug: string; quantity: number; variant_id: string | null; custom_amount: number | null }> = [];
  const readCustom = (raw: unknown): number | null => {
    if (raw === null || raw === undefined || raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  if (Array.isArray(body.items) && body.items.length > 0) {
    for (const raw of body.items) {
      const slug = String(raw?.product_slug || "").trim();
      if (!slug) continue;
      const q = Math.max(1, Math.min(99, Math.floor(Number(raw?.quantity || 1))));
      const vid = typeof raw?.variant_id === "string" && raw.variant_id.trim() ? raw.variant_id.trim() : null;
      inputItems.push({ product_slug: slug, quantity: q, variant_id: vid, custom_amount: readCustom(raw?.custom_amount) });
    }
  } else {
    const slug = String(body?.product_slug || "").trim();
    if (!slug) return fail(400, "Missing product slug.");
    const q = Math.max(1, Math.min(99, Math.floor(Number(body?.quantity || 1))));
    const vid = typeof body?.variant_id === "string" && body.variant_id.trim() ? body.variant_id.trim() : null;
    inputItems.push({ product_slug: slug, quantity: q, variant_id: vid, custom_amount: readCustom(body?.custom_amount) });
  }
  if (inputItems.length === 0) return fail(400, "Cart is empty.");
  if (inputItems.length > MAX_LINES) return fail(400, `Cart exceeds ${MAX_LINES} items.`);

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

  // Resolve each line through the public RPC. We collapse duplicate
  // slug+variant pairs by summing quantities so the cart never
  // double-validates inventory for the same SKU.
  const resolved: ResolvedLine[] = [];
  let stylistUserId: string | null = null;
  let stylistAccountId: string | null = null;
  let chargesEnabled = false;
  // Custom-amount lines never collapse together — two $50 and $75
  // gift cards are distinct SKUs — so the amount is part of the key.
  const collapseKey = (slug: string, vid: string | null, amt: number | null) =>
    `${slug}::${vid || ""}::${amt == null ? "" : amt}`;
  const merged = new Map<string, { product_slug: string; variant_id: string | null; quantity: number; custom_amount: number | null }>();
  for (const item of inputItems) {
    const k = collapseKey(item.product_slug, item.variant_id, item.custom_amount);
    const prior = merged.get(k);
    if (prior) prior.quantity = Math.min(99, prior.quantity + item.quantity);
    else merged.set(k, { ...item });
  }

  for (const item of merged.values()) {
    const { data: rows, error: rpcErr } = await admin.rpc("public_get_product", {
      slug_in: handle,
      product_slug_in: item.product_slug,
    });
    if (rpcErr) return fail(500, rpcErr.message);
    const product = Array.isArray(rows) ? rows[0] : rows;
    if (!product) return fail(404, `Product not found: ${item.product_slug}`);

    if (!stylistUserId) stylistUserId = String(product.user_id);
    else if (String(product.user_id) !== stylistUserId) {
      return fail(400, "Cart mixes products from different stylists. Reset and try again.");
    }
    stylistAccountId = product.stylist_account_id || stylistAccountId;
    chargesEnabled = !!product.stylist_charges_enabled;

    if (product.external_checkout_url) {
      return fail(409, `'${product.title}' is sold via an external store — remove it from the cart and visit the product page.`);
    }
    const variants = Array.isArray(product.variants) ? (product.variants as any[]) : [];
    let resolvedVariant: any = null;
    let priceDollars: number | null = null;

    if (product.is_gift_card && item.custom_amount != null) {
      // Gift-card custom-amount path: a buyer-chosen amount replaces
      // the variant/product price entirely — no variant pick needed.
      if (!product.gift_card_allow_custom) {
        return fail(400, `'${product.title}' doesn't accept a custom amount.`);
      }
      const amt = Number(item.custom_amount);
      if (!Number.isFinite(amt) || amt < GIFT_CARD_MIN || amt > GIFT_CARD_MAX) {
        return fail(400, `Gift card amount must be between $${GIFT_CARD_MIN} and $${GIFT_CARD_MAX}.`);
      }
      priceDollars = Math.round(amt * 100) / 100;
    } else {
      // Variant validation runs FIRST so a variant-specific price /
      // inventory override applies to the rest of the checks.
      if (variants.length > 0) {
        if (!item.variant_id) {
          return fail(400, `Pick a ${product.variant_label || "variant"} for '${product.title}'.`);
        }
        const match = variants.find((v) => v && String(v.id) === item.variant_id);
        if (!match) return fail(400, `That variant is no longer available for '${product.title}'.`);
        resolvedVariant = match;
      }

      // Variant price override wins when set; otherwise fall back to
      // product.price. Negative / missing prices reject the line.
      const variantPriceRaw = resolvedVariant?.price;
      const variantPrice =
        variantPriceRaw === null || variantPriceRaw === undefined || variantPriceRaw === ""
          ? null
          : Number(variantPriceRaw);
      priceDollars =
        variantPrice != null && Number.isFinite(variantPrice) && variantPrice >= 0
          ? variantPrice
          : product.price == null
            ? null
            : Number(product.price);
      if (priceDollars == null || !Number.isFinite(priceDollars) || priceDollars < 0) {
        return fail(400, `'${product.title}' doesn't have a price set.`);
      }
    }

    // Inventory ceiling: variant's count wins when present, else
    // product.inventory_count, else untracked (null = unlimited).
    const variantInvRaw = resolvedVariant?.inventory_count;
    const variantInv =
      variantInvRaw === null || variantInvRaw === undefined || variantInvRaw === ""
        ? null
        : Number(variantInvRaw);
    const effectiveStock =
      variantInv != null && Number.isFinite(variantInv)
        ? variantInv
        : product.inventory_count == null
          ? null
          : Number(product.inventory_count);
    if (effectiveStock != null && effectiveStock < item.quantity) {
      const variantLabel = resolvedVariant ? ` (${resolvedVariant.name})` : "";
      if (effectiveStock <= 0) {
        return fail(409, `'${product.title}${variantLabel}' is sold out.`);
      }
      return fail(409, `'${product.title}${variantLabel}' only has ${effectiveStock} in stock.`);
    }

    // Variant image override: persist on the line item so the order
    // tracking + admin show the picked variant's photo, not the
    // generic product photo.
    const variantImage = resolvedVariant?.image_url
      ? String(resolvedVariant.image_url)
      : product.image_url ?? null;

    resolved.push({
      product_id: String(product.id),
      product_slug: String(product.slug),
      title: String(product.title),
      image_url: variantImage,
      unit_amount_dollars: priceDollars,
      unit_amount_cents: Math.round(priceDollars * 100),
      quantity: item.quantity,
      requires_shipping: !!product.requires_shipping,
      variant_label: resolvedVariant ? (product.variant_label || null) : null,
      variant_id: resolvedVariant?.id || null,
      variant_name: resolvedVariant ? String(resolvedVariant.name || "").trim() : null,
    });
  }

  if (!stylistUserId) return fail(500, "Couldn't resolve stylist.");
  if (!stylistAccountId) return fail(409, "Stylist hasn't connected Stripe yet.");
  if (!chargesEnabled) return fail(409, "Stylist's Stripe account isn't ready to take charges.");

  const requiresShipping = resolved.some((r) => r.requires_shipping);
  const subtotalCents = resolved.reduce((s, r) => s + r.unit_amount_cents * r.quantity, 0);
  const subtotalDollars = subtotalCents / 100;

  // Gift card redemption — validate the code against this stylist's
  // own active cards. The redeemed amount is capped at the subtotal
  // (a $100 card on a $30 order redeems $30, leaving $70 on the card).
  let giftCardId: string | null = null;
  let redeemCents = 0;
  if (giftCardCode) {
    const { data: card } = await admin
      .from("gift_cards")
      .select("id, balance, status")
      .eq("code", giftCardCode)
      .eq("user_id", stylistUserId)
      .maybeSingle();
    if (!card) return fail(400, "That gift card code isn't valid for this shop.");
    if (card.status !== "active" || Number(card.balance) <= 0) {
      return fail(400, "That gift card has no remaining balance.");
    }
    const balanceCents = Math.round(Number(card.balance) * 100);
    redeemCents = Math.min(balanceCents, subtotalCents);
    giftCardId = String(card.id);
  }
  // What the buyer actually pays by card after the gift card applies.
  const chargeableCents = subtotalCents - redeemCents;

  const feeBps = (() => {
    const raw = Number(process.env.PLATFORM_FEE_BPS || 0);
    if (!Number.isFinite(raw) || raw < 0 || raw > 10_000) return 0;
    return Math.floor(raw);
  })();
  // Fee is taken on what the buyer pays, never the pre-gift-card
  // subtotal — Stripe rejects an application fee above the charge.
  const applicationFeeCents = feeBps > 0 ? Math.floor((chargeableCents * feeBps) / 10_000) : 0;

  // Pre-insert the order row. customer_token auto-fills from the
  // column default. line_items captures the resolved cart shape so
  // the webhook + tracking page can read it without re-resolving.
  const lineItemsJson = resolved.map((r) => ({
    product_id: r.product_id,
    product_slug: r.product_slug,
    title: r.title,
    unit_amount: r.unit_amount_dollars,
    quantity: r.quantity,
    requires_shipping: r.requires_shipping,
    image_url: r.image_url,
    variant_label: r.variant_label,
    variant_id: r.variant_id,
    variant_name: r.variant_name,
  }));

  const { data: order, error: orderErr } = await admin
    .from("product_orders")
    .insert({
      user_id: stylistUserId,
      stripe_account_id: stylistAccountId,
      amount_total: subtotalDollars.toFixed(2),
      application_fee: applicationFeeCents > 0 ? (applicationFeeCents / 100).toFixed(2) : null,
      currency: "usd",
      shipping_required: requiresShipping,
      line_items: lineItemsJson,
      gift_card_id: giftCardId,
      gift_card_redeemed_amount: redeemCents > 0 ? (redeemCents / 100).toFixed(2) : null,
      metadata: { handle, item_count: resolved.length },
    })
    .select("id, customer_token")
    .maybeSingle();
  if (orderErr || !order?.id) {
    return fail(500, orderErr?.message || "Couldn't create the order row.");
  }

  // Build the Stripe Checkout Session payload. Each resolved line
  // becomes a line_items[i] block; ad-hoc price_data per line (no
  // Stripe Product objects).
  const baseUrl = baseUrlOf(req);
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("payment_method_types[]", "card");
  resolved.forEach((r, i) => {
    const name = r.variant_name ? `${r.title} · ${r.variant_name}` : r.title;
    form.set(`line_items[${i}][quantity]`, String(r.quantity));
    form.set(`line_items[${i}][price_data][currency]`, "usd");
    form.set(`line_items[${i}][price_data][unit_amount]`, String(r.unit_amount_cents));
    form.set(`line_items[${i}][price_data][product_data][name]`, name);
    if (r.image_url) {
      form.set(`line_items[${i}][price_data][product_data][images][]`, r.image_url);
    }
  });
  form.set(
    "success_url",
    `${baseUrl}/orders/${encodeURIComponent(order.customer_token)}?session_id={CHECKOUT_SESSION_ID}`,
  );
  form.set("cancel_url", `${baseUrl}/@${encodeURIComponent(handle)}/shop?cancelled=1`);
  if (requiresShipping) {
    form.set("shipping_address_collection[allowed_countries][]", "US");
    form.set("phone_number_collection[enabled]", "true");
  }
  form.set("metadata[product_order_id]", String(order.id));
  form.set("metadata[stylist_user_id]", String(stylistUserId));
  form.set("metadata[stylist_account_id]", stylistAccountId);
  form.set("metadata[handle]", handle);
  form.set("metadata[item_count]", String(resolved.length));
  // payment_intent_data is meaningless when a gift card covers the
  // whole order — there's no PaymentIntent, and Stripe rejects the
  // block on a $0 session.
  if (chargeableCents > 0) {
    form.set("payment_intent_data[metadata][product_order_id]", String(order.id));
    if (applicationFeeCents > 0) {
      form.set("payment_intent_data[application_fee_amount]", String(applicationFeeCents));
    }
  }

  // Gift card → a one-time amount_off coupon on the connected
  // account. Stripe does the discount math (partial, full, or
  // capped). A full cover yields a $0 session that completes with
  // payment_status 'no_payment_required' — handled in the webhook.
  if (redeemCents > 0) {
    const couponForm = new URLSearchParams();
    couponForm.set("amount_off", String(redeemCents));
    couponForm.set("currency", "usd");
    couponForm.set("duration", "once");
    couponForm.set("name", "Gift card");
    couponForm.set("max_redemptions", "1");
    const couponRes = await fetch(`${STRIPE_API}/coupons`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecret}`,
        "Stripe-Version": "2024-06-20",
        "Stripe-Account": stylistAccountId,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: couponForm.toString(),
      cache: "no-store",
    });
    if (!couponRes.ok) {
      await admin
        .from("product_orders")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", order.id);
      return fail(502, "Couldn't apply the gift card. Try again in a moment.");
    }
    const coupon = (await couponRes.json()) as { id?: string };
    if (!coupon?.id) {
      await admin.from("product_orders").update({ status: "failed" }).eq("id", order.id);
      return fail(502, "Couldn't apply the gift card. Try again in a moment.");
    }
    form.set("discounts[0][coupon]", String(coupon.id));
  }

  const stripeRes = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecret}`,
      "Stripe-Version": "2024-06-20",
      "Stripe-Account": stylistAccountId,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
    cache: "no-store",
  });
  if (!stripeRes.ok) {
    const text = await stripeRes.text().catch(() => "");
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

  await admin
    .from("product_orders")
    .update({ stripe_session_id: session.id, updated_at: new Date().toISOString() })
    .eq("id", order.id);

  return NextResponse.json({
    url: session.url,
    order_token: order.customer_token,
  });
}
