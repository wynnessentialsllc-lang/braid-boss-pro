// Secure digital-product download.
//
//   GET /api/product-download?token=<customer_token>&product=<product_id>
//
// Delivers the downloadable file for a digital product a buyer has paid
// for. The customer_token is the same non-guessable bearer the order
// tracking page uses; we re-verify server-side that:
//
//   • the order exists and is PAID,
//   • the requested product is actually a line item on that order,
//   • the product is still digital and has a file attached.
//
// On success we mint a short-lived signed URL from the PRIVATE
// `product-files` bucket (with a Content-Disposition filename so the
// download is sensibly named) and 302 the buyer straight to it. The
// object path is never exposed to the browser — only the expiring signed
// URL is. Any failure redirects back to the order page rather than
// dumping a raw error, since this endpoint is reached by a plain link
// (from the order page and the confirmation email, which can't run JS).

import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Short — the buyer follows the redirect immediately. Long enough to
// survive a slow connection / redirect hop.
const SIGNED_URL_TTL = 5 * 60; // 5 minutes

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};

const baseUrlOf = (req: Request): string => {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  try {
    return new URL(req.url).origin;
  } catch {
    return "";
  }
};

const redirect = (url: string): Response =>
  new Response(null, { status: 302, headers: { Location: url } });

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = (url.searchParams.get("token") || "").trim();
  const productId = (url.searchParams.get("product") || "").trim();
  const baseUrl = baseUrlOf(req);
  // Where we send the buyer when something's wrong — the order page shows
  // a clear status, or the homepage if we don't even have a token.
  const fallback = token
    ? `${baseUrl}/orders/${encodeURIComponent(token)}?download=unavailable`
    : `${baseUrl}/`;

  if (!token || !productId) return redirect(fallback);

  let supabaseUrl: string;
  let serviceKey: string;
  try {
    supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || env("SUPABASE_URL");
    serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  } catch {
    return redirect(fallback);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Resolve + authorize the order. Must be paid.
  const { data: order, error: orderErr } = await admin
    .from("product_orders")
    .select("id, status, line_items")
    .eq("customer_token", token)
    .maybeSingle();
  if (orderErr || !order || order.status !== "paid") return redirect(fallback);

  // 2. The product must be a line item on this order.
  const lineItems = Array.isArray(order.line_items) ? (order.line_items as any[]) : [];
  const onOrder = lineItems.some((li) => String(li?.product_id || "") === productId);
  if (!onOrder) return redirect(fallback);

  // 3. The live product is the authority — it must still be digital with a
  //    file. (A product edited to non-digital after sale stops delivering.)
  const { data: product, error: productErr } = await admin
    .from("products")
    .select("is_digital, digital_file_path, digital_file_name")
    .eq("id", productId)
    .maybeSingle();
  if (productErr || !product || !product.is_digital || !product.digital_file_path) {
    return redirect(fallback);
  }

  // 4. Mint a short-lived signed URL. The `download` option sets
  //    Content-Disposition: attachment; filename=... so the buyer gets a
  //    named file instead of a random object id.
  const fileName = String(product.digital_file_name || "").trim();
  const { data: signed, error: signErr } = await admin.storage
    .from("product-files")
    .createSignedUrl(String(product.digital_file_path), SIGNED_URL_TTL, {
      download: fileName || true,
    });
  if (signErr || !signed?.signedUrl) return redirect(fallback);

  return redirect(signed.signedUrl);
}
