// Stripe webhook for product-checkout sessions.
//
// On `checkout.session.completed`, look the order up by
// metadata.product_order_id (or fall back to stripe_session_id) and
// flip it to 'paid' via mark_product_order_paid — a SECURITY DEFINER
// RPC that also decrements inventory_count for any tracked products
// in the line_items jsonb.
//
// Signature verification matches the booking-deposit webhook's
// manual HMAC-SHA256 implementation so we don't pull in the Stripe
// SDK.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual, randomInt } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOLERANCE_SECONDS = 5 * 60;

// Gift card code — bearer instrument, so use crypto randomness, not
// Math.random. Charset omits 0/O/1/I/L so codes are easy to read and
// retype off a phone screen. `code` is UNIQUE in the table, so an
// (astronomically unlikely) collision just fails that one insert.
const genGiftCardCode = (): string => {
  const cs = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const pick = (n: number) =>
    Array.from({ length: n }, () => cs[randomInt(cs.length)]).join("");
  return `BBP-${pick(4)}-${pick(4)}`;
};

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};

const verifySignature = (
  rawBody: string,
  header: string | null,
  secret: string,
): { ok: true } | { ok: false; reason: string } => {
  if (!header) return { ok: false, reason: "missing signature header" };
  const parts = header.split(",").map((p) => p.trim());
  let ts: number | null = null;
  const v1: string[] = [];
  for (const p of parts) {
    const [k, v] = p.split("=");
    if (k === "t" && v) ts = Number(v);
    else if (k === "v1" && v) v1.push(v);
  }
  if (!ts || v1.length === 0)
    return { ok: false, reason: "malformed signature header" };
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > TOLERANCE_SECONDS) {
    return { ok: false, reason: "signature timestamp out of tolerance" };
  }
  const payload = `${ts}.${rawBody}`;
  const expected = createHmac("sha256", secret).update(payload, "utf8").digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  for (const candidate of v1) {
    let candidateBuf: Buffer;
    try {
      candidateBuf = Buffer.from(candidate, "hex");
    } catch {
      continue;
    }
    if (
      candidateBuf.length === expectedBuf.length &&
      timingSafeEqual(candidateBuf, expectedBuf)
    ) {
      return { ok: true };
    }
  }
  return { ok: false, reason: "no signature match" };
};

export async function POST(req: Request) {
  let secret: string;
  let supabaseUrl: string;
  let serviceKey: string;
  try {
    // Falls back to the deposit secret so single-endpoint deployments
    // (one Stripe webhook endpoint configured for both event sources)
    // still verify. Set STRIPE_PRODUCT_WEBHOOK_SECRET when you wire a
    // separate endpoint in the Stripe dashboard.
    secret =
      process.env.STRIPE_PRODUCT_WEBHOOK_SECRET ||
      env("STRIPE_DEPOSIT_WEBHOOK_SECRET");
    supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || env("SUPABASE_URL");
    serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "not configured" }, { status: 500 });
  }

  const rawBody = await req.text();
  const sigHeader = req.headers.get("stripe-signature");
  const verify = verifySignature(rawBody, sigHeader, secret);
  if (!verify.ok) {
    return NextResponse.json({ error: verify.reason }, { status: 400 });
  }

  let evt: any;
  try {
    evt = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  if (evt?.type !== "checkout.session.completed") {
    return NextResponse.json({ received: true, ignored: evt?.type }, { status: 200 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const eventId: string | undefined = typeof evt?.id === "string" ? evt.id : undefined;
  if (eventId) {
    const { data: firstTime, error: dedupeErr } = await admin.rpc(
      "record_stripe_webhook_event",
      {
        event_id_in: eventId,
        event_type_in: evt.type,
        endpoint_in: "product_checkout",
        account_id_in: typeof evt?.account === "string" ? evt.account : null,
      },
    );
    if (dedupeErr) {
      console.error("[product-checkout/webhook] dedupe failed:", dedupeErr.message);
      return NextResponse.json({ error: dedupeErr.message }, { status: 500 });
    }
    if (firstTime === false) {
      return NextResponse.json({ received: true, duplicate: true }, { status: 200 });
    }
  }

  const session = evt?.data?.object;
  const meta = session?.metadata || {};
  const sessionId: string | undefined = session?.id;
  const paymentIntent: string | undefined =
    typeof session?.payment_intent === "string" ? session.payment_intent : undefined;

  // Not one of ours — booking deposit + product checkout share the
  // same dedupe table, so we must ignore events lacking our metadata
  // key rather than misroute them.
  if (!meta?.product_order_id) {
    return NextResponse.json({ received: true, ignored: "no_product_order_id" }, { status: 200 });
  }
  // 'no_payment_required' is the status of a $0 session — i.e. a
  // gift card covered the whole order. It still counts as paid.
  if (
    session?.payment_status &&
    session.payment_status !== "paid" &&
    session.payment_status !== "no_payment_required"
  ) {
    return NextResponse.json(
      { received: true, ignored: `payment_status=${session.payment_status}` },
      { status: 200 },
    );
  }

  // Stripe surfaces total in cents on the session — convert to the
  // decimal the RPC stores.
  const amountTotal =
    typeof session?.amount_total === "number"
      ? Number((session.amount_total / 100).toFixed(2))
      : 0;

  const customerEmail: string | null =
    (typeof session?.customer_details?.email === "string" && session.customer_details.email) ||
    (typeof session?.customer_email === "string" && session.customer_email) ||
    null;
  const customerName: string | null =
    (typeof session?.customer_details?.name === "string" && session.customer_details.name) ||
    null;
  const shippingAddress = session?.shipping_details?.address || session?.customer_details?.address || null;

  const { data: marked, error: rpcErr } = await admin.rpc("mark_product_order_paid", {
    session_id_in: sessionId || null,
    payment_intent_in: paymentIntent || null,
    amount_total_in: amountTotal,
    customer_email_in: customerEmail,
    customer_name_in: customerName,
    shipping_address_in: shippingAddress,
  });
  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }
  if (marked === false) {
    // No matching row — the pre-insert in the checkout route never
    // wrote the order (rare). Ack so Stripe doesn't retry forever.
    return NextResponse.json({ received: true, ignored: "no_matching_order" }, { status: 200 });
  }

  // Order-confirmation email. Best-effort: a queue-failure here
  // never undoes the order. The notification processor renders
  // and sends via Resend; we just enqueue the row with the data
  // the renderer needs. Dedupe key keys off the order id so a
  // Stripe replay doesn't re-send the receipt.
  try {
    const { data: orderForEmail } = await admin
      .from("product_orders")
      .select("id, user_id, customer_email, customer_name, amount_total, currency, line_items, shipping_required")
      .eq("stripe_session_id", sessionId || "")
      .maybeSingle();
    if (orderForEmail?.customer_email) {
      // Studio name + storefront slug for the "View order" link.
      let studioName: string | null = null;
      let slug: string | null = null;
      try {
        const { data: profile } = await admin
          .from("profiles")
          .select("studio_name, business_name, slug")
          .eq("id", orderForEmail.user_id)
          .maybeSingle();
        studioName = (profile?.studio_name || profile?.business_name || "").toString().trim() || null;
        slug = (profile?.slug || "").toString().trim() || null;
      } catch { /* best-effort */ }

      const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
      const orderRefShort = String(orderForEmail.id).slice(0, 8).toUpperCase();
      const items = Array.isArray(orderForEmail.line_items)
        ? (orderForEmail.line_items as any[]).map(li => ({
            title: li?.title,
            variant: [li?.variant_label, li?.variant_name].filter(Boolean).join(" · ") || null,
            quantity: Number(li?.quantity) || 1,
            unitAmount: Number(li?.unit_amount) || 0,
            imageUrl: li?.image_url || null,
          }))
        : [];

      const subtotal = items.reduce((s, i) => s + i.unitAmount * i.quantity, 0);
      const total = Number(orderForEmail.amount_total) || subtotal;
      const isPickup = !orderForEmail.shipping_required;
      const customerToken = (await admin
        .from("product_orders")
        .select("customer_token")
        .eq("id", orderForEmail.id)
        .maybeSingle()).data?.customer_token;
      const viewOrderUrl = baseUrl && customerToken
        ? `${baseUrl}/order/${customerToken}`
        : "";

      await admin.rpc("queue_notification", {
        user_id_in: orderForEmail.user_id,
        channel_in: "email",
        notification_type_in: "order_confirmation",
        body_in: `Your order from ${studioName || "the boutique"} is confirmed.`,
        subject_in: `Your order is confirmed · #${orderRefShort}`,
        recipient_email_in: orderForEmail.customer_email,
        recipient_name_in: orderForEmail.customer_name || null,
        payload_in: {
          customerName: orderForEmail.customer_name || null,
          studioName: studioName || "your boutique",
          orderRef: orderRefShort,
          currency: orderForEmail.currency || "USD",
          items,
          subtotal,
          total,
          isPickup,
          viewOrderUrl,
        },
        // Dedupe on order id so a Stripe webhook replay can't send
        // two confirmations. queue_notification respects this key.
        dedupe_key_in: `order_confirmation:${orderForEmail.id}`,
      });
    }
  } catch (e: any) {
    console.warn("[product-checkout/webhook] order_confirmation enqueue failed:", e?.message || e);
  }

  // Gift cards — issue a redeemable code per unit for any gift-card
  // line in the order, then email the codes to the buyer.
  // Best-effort + idempotent: an order that already has issued cards
  // is skipped, so a Stripe replay can't double-issue.
  try {
    const { data: gcOrder } = await admin
      .from("product_orders")
      .select("id, user_id, customer_email, customer_name, line_items")
      .eq("stripe_session_id", sessionId || "")
      .maybeSingle();
    const gcLines = Array.isArray(gcOrder?.line_items)
      ? (gcOrder!.line_items as any[])
      : [];
    if (gcOrder?.id && gcLines.length > 0) {
      const gcProductIds = Array.from(
        new Set(gcLines.map((li) => String(li?.product_id || "")).filter(Boolean)),
      );
      const { data: gcProducts } = await admin
        .from("products")
        .select("id, is_gift_card")
        .in("id", gcProductIds);
      const giftProductIds = new Set(
        (gcProducts || [])
          .filter((p) => (p as any).is_gift_card)
          .map((p) => String(p.id)),
      );
      if (giftProductIds.size > 0) {
        const { data: existing } = await admin
          .from("gift_cards")
          .select("id")
          .eq("product_order_id", gcOrder.id)
          .limit(1);
        if (!existing || existing.length === 0) {
          const issued: Array<{ code: string; amount: number }> = [];
          for (const li of gcLines) {
            if (!giftProductIds.has(String(li?.product_id || ""))) continue;
            const unit = Number(li?.unit_amount);
            const qty = Math.max(1, Math.floor(Number(li?.quantity) || 1));
            if (!Number.isFinite(unit) || unit <= 0) continue;
            for (let i = 0; i < qty; i++) {
              const code = genGiftCardCode();
              const { error: gcErr } = await admin.from("gift_cards").insert({
                user_id: gcOrder.user_id,
                code,
                initial_amount: unit.toFixed(2),
                balance: unit.toFixed(2),
                currency: "usd",
                status: "active",
                purchaser_email: gcOrder.customer_email || null,
                purchaser_name: gcOrder.customer_name || null,
                product_order_id: gcOrder.id,
              });
              if (!gcErr) issued.push({ code, amount: unit });
            }
          }
          if (issued.length > 0 && gcOrder.customer_email) {
            let studioName: string | null = null;
            try {
              const { data: prof } = await admin
                .from("profiles")
                .select("studio_name, business_name")
                .eq("id", gcOrder.user_id)
                .maybeSingle();
              studioName =
                (prof?.studio_name || prof?.business_name || "").toString().trim() ||
                null;
            } catch { /* best-effort */ }
            await admin.rpc("queue_notification", {
              user_id_in: gcOrder.user_id,
              channel_in: "email",
              notification_type_in: "gift_card_issued",
              body_in: `Your gift card code${issued.length > 1 ? "s" : ""}: ${issued
                .map((g) => g.code)
                .join(", ")}`,
              subject_in: `Your gift card from ${studioName || "the studio"}`,
              recipient_email_in: gcOrder.customer_email,
              recipient_name_in: gcOrder.customer_name || null,
              payload_in: {
                studioName: studioName || "your studio",
                purchaserName: gcOrder.customer_name || null,
                cards: issued.map((g) => ({ code: g.code, amount: g.amount })),
              },
              dedupe_key_in: `gift_card_issued:${gcOrder.id}`,
            });
          }
        }
      }
    }
  } catch (e: any) {
    console.warn("[product-checkout/webhook] gift card issuance failed:", e?.message || e);
  }

  // Gift card redemption — if this order paid (partly or fully)
  // with a gift card, decrement that card's balance. Idempotent:
  // gift_card_redemptions has a UNIQUE product_order_id, so a Stripe
  // replay can't double-spend the card.
  try {
    const { data: redOrder } = await admin
      .from("product_orders")
      .select("id, user_id, gift_card_id, gift_card_redeemed_amount")
      .eq("stripe_session_id", sessionId || "")
      .maybeSingle();
    if (
      redOrder?.gift_card_id &&
      Number(redOrder.gift_card_redeemed_amount) > 0
    ) {
      const { error: redeemErr } = await admin.rpc("redeem_gift_card_for_order", {
        card_id_in: redOrder.gift_card_id,
        order_id_in: redOrder.id,
        user_id_in: redOrder.user_id,
        amount_in: Number(redOrder.gift_card_redeemed_amount),
      });
      if (redeemErr) {
        console.warn(
          "[product-checkout/webhook] gift card redeem failed:",
          redeemErr.message,
        );
      }
    }
  } catch (e: any) {
    console.warn("[product-checkout/webhook] gift card redemption failed:", e?.message || e);
  }

  // Inventory V1 — decrement any linked items. Best-effort: a
  // failure here doesn't undo the order, but is logged so a manual
  // adjustment can square the books. The legacy product.inventory_count
  // column is still maintained by mark_product_order_paid; this is
  // additive, only firing when a product has an inventory_item_id link.
  try {
    const { data: order, error: orderErr } = await admin
      .from("product_orders")
      .select("id, user_id, line_items")
      .eq("stripe_session_id", sessionId || "")
      .maybeSingle();
    if (orderErr || !order) {
      return NextResponse.json({ received: true, inventory_skipped: "order_lookup_failed" }, { status: 200 });
    }
    const lineItems = Array.isArray(order.line_items) ? order.line_items : [];
    if (lineItems.length === 0) {
      return NextResponse.json({ received: true, inventory_skipped: "no_line_items" }, { status: 200 });
    }
    const productIds = Array.from(new Set(lineItems.map((li: any) => String(li?.product_id || "")).filter(Boolean)));
    if (productIds.length === 0) {
      return NextResponse.json({ received: true, inventory_skipped: "no_product_ids" }, { status: 200 });
    }
    const { data: products, error: productsErr } = await admin
      .from("products")
      .select("id, inventory_item_id")
      .in("id", productIds);
    if (productsErr) {
      console.warn("[product-checkout/webhook] inventory lookup failed:", productsErr.message);
      return NextResponse.json({ received: true, inventory_skipped: "product_lookup_failed" }, { status: 200 });
    }
    const linkedById = new Map<string, string>();
    for (const p of (products || [])) {
      const linked = (p as any).inventory_item_id;
      if (linked) linkedById.set(String(p.id), String(linked));
    }
    const skipped: string[] = [];
    for (const li of lineItems) {
      const productId = String((li as any)?.product_id || "");
      const qty = Number((li as any)?.quantity);
      if (!productId || !Number.isFinite(qty) || qty <= 0) { skipped.push(productId || "n/a"); continue; }
      const itemId = linkedById.get(productId);
      if (!itemId) continue; // product isn't linked to inventory — that's fine
      const movementId = `mov_${order.id}_${productId}`.slice(0, 96);
      const { error: applyErr } = await admin.rpc("inventory_apply_movement_admin", {
        user_id_in: order.user_id,
        movement_id_in: movementId,
        item_id_in: itemId,
        delta_in: -qty,
        reason_in: "storefront_sale",
        appointment_id_in: null,
        storefront_order_id_in: order.id,
        business_expense_id_in: null,
        unit_cost_snapshot_in: null,
        note_in: (li as any)?.title || null,
      });
      if (applyErr) {
        // Most likely cause: already applied (movement id is
        // deterministic per order+product, so a Stripe replay won't
        // double-deduct — duplicate PK is the expected outcome).
        if (!/duplicate key/i.test(applyErr.message)) {
          console.warn(`[product-checkout/webhook] inventory apply failed for ${productId}:`, applyErr.message);
        }
      }
    }
    return NextResponse.json({ received: true, inventory_applied: true, skipped }, { status: 200 });
  } catch (e: any) {
    console.warn("[product-checkout/webhook] inventory side-effects failed:", e?.message || e);
    return NextResponse.json({ received: true, inventory_error: e?.message || "unknown" }, { status: 200 });
  }
}
