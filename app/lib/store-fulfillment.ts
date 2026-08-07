// Braid Boss Pro Store — shared fulfillment.
//
// Both the Stripe webhook (/api/store-checkout/webhook) and the
// success-page confirm (/api/store-order) race to mark an order paid and
// deliver it. This module is the single place that logic lives, so the
// two paths can't drift and the buyer's email is sent EXACTLY ONCE no
// matter which path wins.
//
// The two-claim design:
//   1. transition status → 'paid' (idempotent: only the first caller to
//      flip it "wins", but every caller ends with a paid order).
//   2. claim the email by atomically setting email_sent_at from NULL →
//      now(); only the winner of THAT claim actually sends. If the send
//      fails, the claim is released so a later retry can try again.

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "./email";
import {
  getStoreProduct,
  formatPrice,
  type StoreProduct,
} from "./store-catalog";

type StoreOrderRow = {
  id: string;
  customer_token: string;
  status: string;
  buyer_email: string | null;
  buyer_name: string | null;
  amount_total: string | number | null;
  currency: string | null;
  line_items: Array<{
    slug?: string;
    name?: string;
    unit_amount?: number;
    quantity?: number;
    is_digital?: boolean;
  }> | null;
  email_sent_at: string | null;
};

export type FulfillResult = {
  paid: boolean;
  emailSent: boolean;
};

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export const storeBaseUrl = (req?: Request): string => {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  if (req) {
    try {
      return new URL(req.url).origin;
    } catch {
      /* fall through */
    }
  }
  return "https://braidbosspro.app";
};

// Direct, one-click download link for a digital line item. Hits the
// server route that re-verifies the order is paid and mints a signed URL.
const downloadUrl = (baseUrl: string, token: string, slug: string): string =>
  `${baseUrl}/api/store-download?token=${encodeURIComponent(
    token,
  )}&product=${encodeURIComponent(slug)}`;

const orderPageUrl = (baseUrl: string, token: string): string =>
  `${baseUrl}/store/success?token=${encodeURIComponent(token)}`;

// ── Delivery email ───────────────────────────────────────────────────
const buildDeliveryEmail = (args: {
  order: StoreOrderRow;
  baseUrl: string;
}): { subject: string; html: string; text: string } => {
  const { order, baseUrl } = args;
  const items = Array.isArray(order.line_items) ? order.line_items : [];
  const firstName = (order.buyer_name || "").trim().split(/\s+/)[0] || "there";
  const total =
    order.amount_total != null
      ? formatPrice(
          Math.round(Number(order.amount_total) * 100),
          order.currency || "usd",
        )
      : null;

  const digital = items.filter((li) => li?.is_digital && li?.slug);
  const hasDigital = digital.length > 0;

  const subject = "Your Braid Boss Pro Store order — download inside";

  const itemRows = items
    .map((li) => {
      const name = escapeHtml(String(li?.name || "Item"));
      const qty = Number(li?.quantity || 1);
      const line =
        li?.unit_amount != null
          ? formatPrice(Math.round(Number(li.unit_amount) * 100), order.currency || "usd")
          : "";
      return `<tr>
        <td style="padding:8px 0;font-size:14px;color:#1F140A;">${name}${qty > 1 ? ` × ${qty}` : ""}</td>
        <td style="padding:8px 0;font-size:14px;color:#1F140A;text-align:right;">${line}</td>
      </tr>`;
    })
    .join("");

  const downloadButtons = digital
    .map((li) => {
      const name = escapeHtml(String(li?.name || "your file"));
      const href = downloadUrl(baseUrl, order.customer_token, String(li.slug));
      return `<p style="margin:10px 0;text-align:center;">
        <a href="${href}" style="display:inline-block;background:#7C3AED;color:#FFFFFF;text-decoration:none;padding:14px 26px;border-radius:999px;font-weight:700;font-size:14px;letter-spacing:0.02em;">Download ${name}</a>
      </p>`;
    })
    .join("");

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;background:#FBFAFD;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#15111A;">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px;">
    <div style="background:#FFFFFF;border:1px solid #ECE7F2;border-radius:16px;padding:28px;box-shadow:0 1px 4px rgba(21,17,26,0.05);">
      <p style="font-size:11px;font-weight:800;letter-spacing:0.2em;text-transform:uppercase;color:#7C3AED;margin:0 0 10px;">Braid Boss Pro Store</p>
      <h1 style="font-size:22px;margin:0 0 12px;color:#15111A;">Thank you, ${escapeHtml(firstName)}!</h1>
      <p style="font-size:14px;line-height:22px;margin:0 0 8px;">
        Your order is confirmed and your ${hasDigital ? "download is ready" : "order is on its way"}.
      </p>
      ${downloadButtons}
      ${
        hasDigital
          ? `<p style="font-size:12px;color:#9F95A8;line-height:18px;text-align:center;margin:6px 0 0;">
              Download links open a secure, expiring page — you can always come back to your order to grab a fresh one.
            </p>`
          : ""
      }
      <table style="width:100%;border-collapse:collapse;margin-top:22px;border-top:1px solid #ECE7F2;">
        ${itemRows}
        ${
          total
            ? `<tr><td style="padding:12px 0 0;font-size:14px;font-weight:700;color:#15111A;border-top:1px solid #ECE7F2;">Total</td>
               <td style="padding:12px 0 0;font-size:14px;font-weight:700;color:#15111A;text-align:right;border-top:1px solid #ECE7F2;">${total}</td></tr>`
            : ""
        }
      </table>
      <p style="margin:24px 0 0;text-align:center;">
        <a href="${orderPageUrl(baseUrl, order.customer_token)}" style="font-size:13px;color:#7C3AED;text-decoration:underline;">View your order</a>
      </p>
    </div>
    <p style="text-align:center;font-size:11px;color:#9F95A8;margin-top:18px;">
      Braid Boss Pro · Wynn Essentials, LLC · Questions? Reply to this email.
    </p>
  </div>
</body></html>`;

  const textLines = [
    `Thank you, ${firstName}!`,
    "",
    "Your Braid Boss Pro Store order is confirmed.",
    ...digital.map(
      (li) =>
        `Download ${String(li?.name || "your file")}: ${downloadUrl(
          baseUrl,
          order.customer_token,
          String(li.slug),
        )}`,
    ),
    "",
    `View your order: ${orderPageUrl(baseUrl, order.customer_token)}`,
  ];

  return { subject, html, text: textLines.join("\n") };
};

// ── The one true fulfillment path ────────────────────────────────────
// Marks the order paid (idempotent) and sends the delivery email once.
// Returns what happened so callers can log it. Never throws — a failure
// to email must not fail the webhook (Stripe would retry the whole
// event) nor the buyer's confirm request.
export const fulfillStoreOrder = async (
  admin: SupabaseClient,
  args: {
    orderId: string;
    baseUrl: string;
    paymentIntent?: string | null;
    buyerEmail?: string | null;
    buyerName?: string | null;
  },
): Promise<FulfillResult> => {
  const { orderId, baseUrl } = args;

  // 1. Transition to paid. Only updates rows not already paid, so this is
  //    safe to call from both the webhook and the confirm endpoint.
  const patch: Record<string, unknown> = {
    status: "paid",
    paid_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (args.paymentIntent) patch.stripe_payment_intent = args.paymentIntent;
  if (args.buyerEmail) patch.buyer_email = args.buyerEmail;
  if (args.buyerName) patch.buyer_name = args.buyerName;

  await admin
    .from("store_orders")
    .update(patch)
    .eq("id", orderId)
    .neq("status", "paid");

  // 2. Load the (now-paid) row so we have the final buyer email + items.
  const { data: order } = await admin
    .from("store_orders")
    .select(
      "id, customer_token, status, buyer_email, buyer_name, amount_total, currency, line_items, email_sent_at",
    )
    .eq("id", orderId)
    .maybeSingle();

  if (!order || order.status !== "paid") {
    return { paid: order?.status === "paid", emailSent: false };
  }

  // 3. Claim the email atomically: set email_sent_at only if still NULL.
  //    Whoever gets the row back is the sole sender.
  if (order.email_sent_at) return { paid: true, emailSent: false };
  const recipient = (order.buyer_email || args.buyerEmail || "").trim();
  if (!recipient || !recipient.includes("@")) {
    return { paid: true, emailSent: false };
  }

  const { data: claimed } = await admin
    .from("store_orders")
    .update({ email_sent_at: new Date().toISOString() })
    .eq("id", orderId)
    .is("email_sent_at", null)
    .select("id")
    .maybeSingle();
  if (!claimed) return { paid: true, emailSent: false }; // someone else claimed it

  const { subject, html, text } = buildDeliveryEmail({
    order: { ...(order as StoreOrderRow), buyer_email: recipient },
    baseUrl,
  });
  const result = await sendEmail({ to: recipient, subject, html, text });

  if (!result.ok) {
    // Release the claim so a retry (webhook redelivery / buyer refresh)
    // can resend. A skip due to missing RESEND envs is NOT released —
    // there's no point retrying a config gap on every event.
    if (!("skipped" in result && result.skipped)) {
      await admin
        .from("store_orders")
        .update({ email_sent_at: null })
        .eq("id", orderId);
    }
    return { paid: true, emailSent: false };
  }

  return { paid: true, emailSent: true };
};

// Public shape returned to the success page (safe subset — no internal
// ids). Digital items carry a ready-to-use download URL.
export type PublicStoreOrder = {
  status: string;
  currency: string;
  amountTotal: number | null;
  buyerEmail: string | null;
  items: Array<{
    slug: string;
    name: string;
    quantity: number;
    unitAmount: number | null;
    isDigital: boolean;
    downloadUrl: string | null;
    product?: Pick<StoreProduct, "slug" | "name" | "image" | "tagline">;
  }>;
};

export const toPublicOrder = (
  order: StoreOrderRow,
  baseUrl: string,
): PublicStoreOrder => {
  const paid = order.status === "paid";
  const items = (Array.isArray(order.line_items) ? order.line_items : []).map(
    (li) => {
      const slug = String(li?.slug || "");
      const product = getStoreProduct(slug);
      const isDigital = !!li?.is_digital;
      return {
        slug,
        name: String(li?.name || product?.name || "Item"),
        quantity: Number(li?.quantity || 1),
        unitAmount: li?.unit_amount != null ? Number(li.unit_amount) : null,
        isDigital,
        // Only expose a download link once the order is actually paid.
        downloadUrl:
          paid && isDigital && slug ? downloadUrl(baseUrl, order.customer_token, slug) : null,
        product: product
          ? {
              slug: product.slug,
              name: product.name,
              image: product.image,
              tagline: product.tagline,
            }
          : undefined,
      };
    },
  );
  return {
    status: order.status,
    currency: order.currency || "usd",
    amountTotal: order.amount_total != null ? Number(order.amount_total) : null,
    buyerEmail: order.buyer_email,
    items,
  };
};
