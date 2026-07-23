// Create a Stripe Checkout Session for a video-lesson purchase.
//
// Same Connect direct-charge pattern as class-checkout / product-
// checkout: the buyer pays on the braider's connected account, the
// platform takes a PLATFORM_FEE_BPS application fee. The buyer never
// sees the secret playback URL here — after payment they get a
// token-gated /watch/<token> page (and an emailed link).
//
// Flow:
//   1. Resolve the lesson via public_get_video (handle + video slug),
//      which returns the connected acct + charges_enabled.
//   2. Validate: published, priced, charges-enabled.
//   3. Mint a pending video_purchase row with a bearer access_token.
//   4. Create the Checkout Session AS the connected account.
//   5. Persist the session id; return { url }.
//
// The webhook flips the purchase to 'paid', stamps the rental expiry
// (for 'rent' lessons), and emails the watch link.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "crypto";

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

const genAccessToken = (): string => randomBytes(24).toString("base64url");

export async function POST(req: Request) {
  let body: {
    handle?: string;
    video_slug?: string;
    buyer_name?: string;
    buyer_email?: string;
  };
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid JSON body.");
  }

  const handle = (body?.handle || "").trim().replace(/^@/, "");
  const videoSlug = (body?.video_slug || "").trim();
  if (!handle) return fail(400, "Missing stylist handle.");
  if (!videoSlug) return fail(400, "Missing video.");

  const buyerName = String(body?.buyer_name || "").replace(/[<>]/g, "").trim().slice(0, 120) || null;
  const buyerEmail = (() => {
    const raw = String(body?.buyer_email || "").trim().slice(0, 254).toLowerCase();
    if (!raw) return null;
    return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(raw) ? raw : null;
  })();
  if (!buyerEmail) return fail(400, "A valid email is required — we send your access link there.");

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

  const { data: rows, error: videoErr } = await admin.rpc("public_get_video", {
    slug_in: handle,
    video_slug_in: videoSlug,
  });
  if (videoErr) return fail(500, "Couldn't load the video.");
  const vid = Array.isArray(rows) ? rows[0] : rows;
  if (!vid) return fail(404, "That video isn't available.");

  const price = Number(vid.price);
  if (!Number.isFinite(price) || price <= 0) {
    return fail(400, "This video isn't set up for paid access.");
  }
  const stylistUserId = vid.user_id ? String(vid.user_id) : null;
  const stylistAccountId = vid.stylist_account_id ? String(vid.stylist_account_id) : null;
  if (!stylistUserId) return fail(500, "Couldn't resolve the braider.");
  if (!stylistAccountId) return fail(409, "This braider hasn't connected Stripe yet.");
  if (!vid.stylist_charges_enabled) {
    return fail(409, "This braider's Stripe account isn't ready to take payments.");
  }

  const currency = String(vid.currency || "usd").toLowerCase();
  const cents = Math.round(price * 100);

  const feeBps = (() => {
    const raw = Number(process.env.PLATFORM_FEE_BPS || 0);
    if (!Number.isFinite(raw) || raw < 0 || raw > 10_000) return 0;
    return Math.floor(raw);
  })();
  const applicationFeeCents = feeBps > 0 ? Math.floor((cents * feeBps) / 10_000) : 0;

  const accessToken = genAccessToken();

  const { data: purchase, error: insErr } = await admin
    .from("video_purchases")
    .insert({
      user_id: stylistUserId,
      video_id: vid.id,
      status: "pending",
      amount_total: cents / 100,
      application_fee: applicationFeeCents > 0 ? applicationFeeCents / 100 : null,
      currency,
      buyer_name: buyerName,
      buyer_email: buyerEmail,
      access_token: accessToken,
      stripe_account_id: stylistAccountId,
    })
    .select("id")
    .maybeSingle();
  if (insErr || !purchase) {
    return fail(500, "Couldn't start checkout. Try again in a moment.");
  }

  const baseUrl = baseUrlOf(req);
  const rentalNote =
    vid.access_model === "rent" && vid.rental_days
      ? ` (${vid.rental_days}-day access)`
      : "";

  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("payment_method_types[]", "card");
  form.set("line_items[0][quantity]", "1");
  form.set("line_items[0][price_data][currency]", currency);
  form.set("line_items[0][price_data][unit_amount]", String(cents));
  form.set("line_items[0][price_data][product_data][name]", `${vid.title}${rentalNote}`);
  form.set("customer_email", buyerEmail);
  form.set("success_url", `${baseUrl}/watch/${encodeURIComponent(accessToken)}?fresh=1`);
  form.set(
    "cancel_url",
    `${baseUrl}/@${encodeURIComponent(handle)}/videos/${encodeURIComponent(videoSlug)}?cancelled=1`,
  );
  form.set("metadata[video_purchase_id]", String(purchase.id));
  form.set("metadata[video_id]", String(vid.id));
  form.set("metadata[stylist_user_id]", stylistUserId);
  form.set("payment_intent_data[metadata][video_purchase_id]", String(purchase.id));
  if (applicationFeeCents > 0) {
    form.set("payment_intent_data[application_fee_amount]", String(applicationFeeCents));
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
      .from("video_purchases")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", purchase.id);
    return fail(502, `Couldn't start checkout (${stripeRes.status}). ${text.slice(0, 160)}`);
  }
  const session = (await stripeRes.json()) as { id?: string; url?: string };
  if (!session.id || !session.url) {
    await admin.from("video_purchases").update({ status: "failed" }).eq("id", purchase.id);
    return fail(502, "Stripe returned an unusable session.");
  }

  await admin
    .from("video_purchases")
    .update({ stripe_session_id: session.id })
    .eq("id", purchase.id);

  return NextResponse.json({ url: session.url });
}
