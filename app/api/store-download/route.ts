// Secure digital-product download for the Braid Boss Pro Store.
//
//   GET /api/store-download?token=<customer_token>&product=<slug>
//
// Mirrors the tenant shop's /api/product-download: delivers the file for
// a digital product the buyer has paid for. We re-verify server-side that
//
//   • the order exists and is PAID,
//   • the requested product is a line item on that order,
//   • the product is still digital and has a file in the catalog.
//
// The file path comes from the live catalog (app/lib/store-catalog.ts) —
// the authority — not the stored order, so a product taken down stops
// delivering. On success we mint a short-lived signed URL from the
// PRIVATE `store-files` bucket and 302 the buyer straight to it. The
// object path is never exposed. Any failure redirects to the order page
// (this endpoint is hit by plain links from the page and the email).

import { createClient } from "@supabase/supabase-js";
import { getStoreProduct } from "../../lib/store-catalog";
import { storeBaseUrl } from "../../lib/store-fulfillment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNED_URL_TTL = 5 * 60; // 5 minutes

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};

const redirect = (url: string): Response =>
  new Response(null, { status: 302, headers: { Location: url } });

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = (url.searchParams.get("token") || "").trim();
  const slug = (url.searchParams.get("product") || "").trim();
  const baseUrl = storeBaseUrl(req);
  const fallback = token
    ? `${baseUrl}/store/success?token=${encodeURIComponent(token)}&download=unavailable`
    : `${baseUrl}/store`;

  if (!token || !slug) return redirect(fallback);

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
    .from("store_orders")
    .select("id, status, line_items")
    .eq("customer_token", token)
    .maybeSingle();
  if (orderErr || !order || order.status !== "paid") return redirect(fallback);

  // 2. The product must be a line item on this order.
  const lineItems = Array.isArray(order.line_items) ? (order.line_items as any[]) : [];
  const onOrder = lineItems.some((li) => String(li?.slug || "") === slug);
  if (!onOrder) return redirect(fallback);

  // 3. The live catalog product is the authority — still digital + a file.
  const product = getStoreProduct(slug);
  if (!product || !product.isDigital || !product.digitalFilePath) {
    return redirect(fallback);
  }

  // 4. Mint a short-lived signed URL with a sensible download filename.
  const fileName = String(product.digitalFileName || "").trim();
  const { data: signed, error: signErr } = await admin.storage
    .from("store-files")
    .createSignedUrl(product.digitalFilePath, SIGNED_URL_TTL, {
      download: fileName || true,
    });
  if (signErr || !signed?.signedUrl) return redirect(fallback);

  return redirect(signed.signedUrl);
}
