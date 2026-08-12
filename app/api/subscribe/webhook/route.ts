// Stripe webhook for the Braid Boss Pro monthly subscription.
//
// Mirrors /api/founding-checkout/webhook: manual HMAC-SHA256 signature
// verification + record_stripe_webhook_event dedupe. Keeps the
// subscription lifecycle mirrored onto profiles via two RPCs:
//   • start_subscription_for_user   — on checkout.session.completed,
//     binds customer + subscription ids to the user (from
//     client_reference_id) and records the initial (trialing) status.
//   • apply_subscription_status     — on customer.subscription.*,
//     updates status / period end / cancel flag, matched by
//     subscription or customer id.
//
// We never revoke lifetime_access / founding_access here — grandfathered
// access is independent of subscription state.
//
// Lifecycle email (added alongside the email redesign, no billing rule
// changed): three of the stylist-facing emails hang off events this
// endpoint already receives, so they are enqueued here rather than in a
// second system.
//   • checkout.session.completed          → trial started
//   • customer.subscription.trial_will_end→ trial ending soon
//   • invoice.payment_succeeded           → subscription confirmed / receipt
//   • invoice.payment_failed              → payment failed (dunning)
// The last three must be enabled on the Stripe endpoint; until they are,
// nothing breaks, those two emails simply never fire. Enqueue is
// fail-soft everywhere: a mail problem must never turn into a non-200
// that makes Stripe retry a billing event.

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "crypto";
import {
  buildPaymentFailedPayload,
  buildSubscriptionConfirmedPayload,
  buildTrialEndingPayload,
  buildTrialStartedPayload,
  dedupeKeys,
  enqueueLifecycleEmail,
  idOf,
  trialEndingSubject,
  type StripeInvoiceLike,
  type StripeSubscriptionLike,
} from "../../../lib/subscription-emails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STRIPE_API = "https://api.stripe.com/v1";
const TOLERANCE_SECONDS = 5 * 60;

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
  if (!ts || v1.length === 0) return { ok: false, reason: "malformed signature header" };
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > TOLERANCE_SECONDS) {
    return { ok: false, reason: "signature timestamp out of tolerance" };
  }
  const payload = `${ts}.${rawBody}`;
  const expected = createHmac("sha256", secret).update(payload, "utf8").digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  for (const candidate of v1) {
    let candidateBuf: Buffer;
    try { candidateBuf = Buffer.from(candidate, "hex"); } catch { continue; }
    if (candidateBuf.length === expectedBuf.length && timingSafeEqual(candidateBuf, expectedBuf)) {
      return { ok: true };
    }
  }
  return { ok: false, reason: "no signature match" };
};

const toTs = (epochSeconds: unknown): string | null => {
  const n = Number(epochSeconds);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
};

// Retrieve a subscription so checkout.session.completed can record the
// accurate status + current_period_end without waiting for the
// customer.subscription.* event.
//
// default_payment_method is expanded so the trial and receipt emails can
// show "Visa ending in 4242". When Stripe has no payment method on the
// subscription the field comes back null and the templates simply drop
// that row rather than implying a card exists.
const retrieveSubscription = async (
  stripeSecret: string,
  subscriptionId: string,
): Promise<any | null> => {
  try {
    const url = `${STRIPE_API}/subscriptions/${encodeURIComponent(subscriptionId)}`
      + `?expand[]=default_payment_method`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${stripeSecret}`,
        "Stripe-Version": "2024-06-20",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
};

// ---- lifecycle email support ---------------------------------------

type Stylist = {
  userId: string;
  email: string | null;
  firstName: string | null;
  timeZone: string | null;
  stripeConnectActive: boolean;
};

/** First token of a full name, ignoring an email pasted into the field. */
const firstNameOf = (full?: string | null): string | null => {
  const s = String(full ?? "").trim();
  if (!s) return null;
  const first = s.split(/\s+/)[0] || "";
  return first && !first.includes("@") ? first : null;
};

/**
 * Everything the templates need about the recipient, resolved from the
 * app's own data rather than from Stripe. Fail-soft: any piece that
 * cannot be read comes back null and the template drops that element.
 */
const loadStylist = async (
  admin: SupabaseClient,
  userId: string,
): Promise<Stylist> => {
  const out: Stylist = {
    userId,
    email: null,
    firstName: null,
    timeZone: null,
    stripeConnectActive: false,
  };
  try {
    const { data: user } = await admin.auth.admin.getUserById(userId);
    out.email = user?.user?.email || null;
    const meta = (user?.user?.user_metadata || {}) as Record<string, unknown>;
    out.firstName =
      firstNameOf(typeof meta.full_name === "string" ? meta.full_name : null) ||
      firstNameOf(typeof meta.name === "string" ? meta.name : null) ||
      firstNameOf(typeof meta.first_name === "string" ? meta.first_name : null);
  } catch {
    /* leave null */
  }
  try {
    const { data: profile } = await admin
      .from("profiles")
      .select("full_name, stripe_connect_charges_enabled")
      .eq("id", userId)
      .maybeSingle();
    out.firstName = firstNameOf(profile?.full_name) || out.firstName;
    out.stripeConnectActive = profile?.stripe_connect_charges_enabled === true;
  } catch {
    /* leave defaults */
  }
  try {
    // The app captures the browser's IANA zone on every public booking
    // request. Reusing the most recent one is the same resolution the
    // reminder cron uses, and it keeps a trial-end date from rendering
    // as the wrong calendar day. No bookings yet means UTC.
    const { data: tz } = await admin
      .from("booking_requests")
      .select("timezone")
      .eq("user_id", userId)
      .not("timezone", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const zone = String(tz?.timezone || "").trim();
    out.timeZone = zone || null;
  } catch {
    /* leave null */
  }
  return out;
};

/** Find the profile a customer/subscription id belongs to. */
const findUserIdForSubscription = async (
  admin: SupabaseClient,
  subscriptionId: string | null,
  customerId: string | null,
): Promise<string | null> => {
  try {
    if (subscriptionId) {
      const { data } = await admin
        .from("profiles")
        .select("id")
        .eq("stripe_subscription_id", subscriptionId)
        .maybeSingle();
      if (data?.id) return data.id as string;
    }
    if (customerId) {
      const { data } = await admin
        .from("profiles")
        .select("id")
        .eq("stripe_customer_id", customerId)
        .maybeSingle();
      if (data?.id) return data.id as string;
    }
  } catch {
    /* fall through */
  }
  return null;
};

const appBaseUrl = (): string =>
  (process.env.NEXT_PUBLIC_SITE_URL || "https://braidbosspro.app").replace(/\/$/, "");

export async function POST(req: Request) {
  let secret: string;
  let supabaseUrl: string;
  let serviceKey: string;
  let stripeSecret: string;
  try {
    // Dedicated subscription secret preferred; fall back to the shared
    // webhook secret when a single endpoint serves all events.
    secret =
      process.env.STRIPE_SUBSCRIPTION_WEBHOOK_SECRET ||
      env("STRIPE_WEBHOOK_SECRET");
    supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || env("SUPABASE_URL");
    serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
    stripeSecret = env("STRIPE_SECRET_KEY");
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
  try { evt = JSON.parse(rawBody); }
  catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const handledTypes = new Set([
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    // Email-only. Neither of these touches subscription state; they
    // exist so the trial reminder and the payment receipt can be sent
    // from data Stripe already knows.
    "customer.subscription.trial_will_end",
    "invoice.payment_succeeded",
    "invoice.payment_failed",
  ]);
  if (!handledTypes.has(evt?.type)) {
    return NextResponse.json({ received: true, ignored: evt?.type }, { status: 200 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Dedupe — distinct endpoint name keeps subscription events out of
  // the founding/booking/product namespaces.
  const eventId: string | undefined = typeof evt?.id === "string" ? evt.id : undefined;
  if (eventId) {
    const { data: firstTime, error: dedupeErr } = await admin.rpc(
      "record_stripe_webhook_event",
      {
        event_id_in: eventId,
        event_type_in: evt.type,
        endpoint_in: "subscription",
        account_id_in: typeof evt?.account === "string" ? evt.account : null,
      },
    );
    if (dedupeErr) {
      console.error("[subscribe/webhook] dedupe failed:", dedupeErr.message);
      return NextResponse.json({ error: dedupeErr.message }, { status: 500 });
    }
    if (firstTime === false) {
      return NextResponse.json({ received: true, duplicate: true }, { status: 200 });
    }
  }

  // ---- checkout.session.completed (subscription mode) --------------
  if (evt.type === "checkout.session.completed") {
    const session = evt?.data?.object;
    const meta = session?.metadata || {};
    if (session?.mode !== "subscription" || meta?.purpose !== "subscription") {
      return NextResponse.json({ received: true, ignored: "not_subscription" }, { status: 200 });
    }
    const userId: string | null =
      (typeof session?.client_reference_id === "string" && session.client_reference_id) ||
      (typeof meta?.user_id === "string" && meta.user_id) ||
      null;
    const customerId: string | null = typeof session?.customer === "string" ? session.customer : null;
    const subscriptionId: string | null =
      typeof session?.subscription === "string" ? session.subscription : null;
    if (!userId) {
      return NextResponse.json({ received: true, ignored: "no_user_ref" }, { status: 200 });
    }

    // Retrieve the subscription for accurate status + period end.
    let status = "trialing";
    let periodEnd: string | null = null;
    let cancelAtPeriodEnd = false;
    // Kept in scope so the trial-started email can read the plan, trial
    // window, and card off the same object we already fetched.
    let subscriptionObject: any = null;
    if (subscriptionId) {
      const sub = await retrieveSubscription(stripeSecret, subscriptionId);
      if (sub) {
        subscriptionObject = sub;
        status = typeof sub.status === "string" ? sub.status : status;
        periodEnd = toTs(sub.current_period_end);
        cancelAtPeriodEnd = sub.cancel_at_period_end === true;
      }
    }

    const { error } = await admin.rpc("start_subscription_for_user", {
      user_id_in: userId,
      customer_id_in: customerId,
      subscription_id_in: subscriptionId,
      status_in: status,
      current_period_end_in: periodEnd,
      cancel_at_period_end_in: cancelAtPeriodEnd,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // "Your free trial has started" — only once the trial genuinely
    // exists. If Stripe reports anything other than `trialing` (a promo
    // code that skipped the trial, an immediate charge, an incomplete
    // subscription), this email does not go out.
    if (subscriptionId && status === "trialing" && subscriptionObject) {
      const stylist = await loadStylist(admin, userId);
      if (stylist.email) {
        await enqueueLifecycleEmail({
          admin,
          userId,
          recipientEmail: stylist.email,
          recipientName: stylist.firstName,
          type: "stylist_trial_started",
          payload: buildTrialStartedPayload(subscriptionObject as StripeSubscriptionLike, {
            firstName: stylist.firstName,
            timeZone: stylist.timeZone,
            baseUrl: appBaseUrl(),
            stripeConnectActive: stylist.stripeConnectActive,
          }),
          dedupeKey: dedupeKeys.trialStarted(subscriptionId),
        });
      }
    }
    return NextResponse.json({ received: true }, { status: 200 });
  }

  // ---- customer.subscription.trial_will_end ------------------------
  // Stripe fires this three days before a trial converts. Using it
  // means no new cron job, no new schema, and a payload that always
  // matches the live subscription. Purely a notification: subscription
  // state is untouched here.
  if (evt.type === "customer.subscription.trial_will_end") {
    const sub = (evt?.data?.object || {}) as StripeSubscriptionLike;
    const subId = idOf(sub?.id) || null;
    const custId = idOf(sub?.customer) || null;
    const userId = await findUserIdForSubscription(admin, subId, custId);
    if (!userId) {
      return NextResponse.json({ received: true, ignored: "no_profile_match" }, { status: 200 });
    }
    // Re-read the subscription so the card is expanded; the event
    // payload never includes an expanded default_payment_method.
    const full = subId ? await retrieveSubscription(stripeSecret, subId) : null;
    const source: StripeSubscriptionLike = (full as StripeSubscriptionLike) || sub;
    const stylist = await loadStylist(admin, userId);
    if (stylist.email && subId) {
      await enqueueLifecycleEmail({
        admin,
        userId,
        recipientEmail: stylist.email,
        recipientName: stylist.firstName,
        type: "stylist_trial_ending",
        subject: trialEndingSubject(source?.trial_end ?? null),
        payload: buildTrialEndingPayload(source, {
          firstName: stylist.firstName,
          timeZone: stylist.timeZone,
          baseUrl: appBaseUrl(),
        }),
        dedupeKey: dedupeKeys.trialEnding(subId, source?.trial_end ?? null),
      });
    }
    return NextResponse.json({ received: true }, { status: 200 });
  }

  // ---- invoice.payment_succeeded -----------------------------------
  // The subscription receipt. Zero-amount invoices (the $0 one Stripe
  // issues when a trial starts) are skipped so nobody gets a "payment
  // confirmed" mail for a payment that never happened.
  if (evt.type === "invoice.payment_succeeded") {
    const invoice = (evt?.data?.object || {}) as StripeInvoiceLike;
    const reason = String(invoice?.billing_reason || "");
    const amountPaid = Number(invoice?.amount_paid);
    const invoiceId = idOf(invoice?.id);
    const subId = idOf(invoice?.subscription);
    const custId = idOf(invoice?.customer);

    if (!invoiceId || !subId) {
      return NextResponse.json({ received: true, ignored: "not_subscription_invoice" }, { status: 200 });
    }
    if (!Number.isFinite(amountPaid) || amountPaid <= 0) {
      return NextResponse.json({ received: true, ignored: "zero_amount" }, { status: 200 });
    }
    if (!["subscription_create", "subscription_cycle", "subscription_update"].includes(reason)) {
      return NextResponse.json({ received: true, ignored: `billing_reason_${reason}` }, { status: 200 });
    }

    const userId = await findUserIdForSubscription(admin, subId, custId);
    if (!userId) {
      return NextResponse.json({ received: true, ignored: "no_profile_match" }, { status: 200 });
    }
    const full = (await retrieveSubscription(stripeSecret, subId)) as StripeSubscriptionLike | null;
    const stylist = await loadStylist(admin, userId);
    if (stylist.email) {
      await enqueueLifecycleEmail({
        admin,
        userId,
        recipientEmail: stylist.email,
        recipientName: stylist.firstName,
        type: "stylist_subscription_confirmed",
        subject:
          reason === "subscription_cycle"
            ? "Your Braid Boss Pro payment went through"
            : undefined,
        payload: buildSubscriptionConfirmedPayload(invoice, full, {
          firstName: stylist.firstName,
          timeZone: stylist.timeZone,
          baseUrl: appBaseUrl(),
        }),
        dedupeKey: dedupeKeys.subscriptionConfirmed(invoiceId),
      });
    }
    return NextResponse.json({ received: true }, { status: 200 });
  }

  // ---- invoice.payment_failed --------------------------------------
  // Dunning notice. Subscription state still flows through the
  // customer.subscription.updated event that Stripe sends alongside
  // this one (status → past_due); nothing about billing is decided
  // here, we only tell the stylist her card needs a look.
  //
  // Nothing from Stripe's failure detail is read: no decline code, no
  // network response, no last_payment_error. Those are processor
  // internals and never belong in a customer inbox.
  if (evt.type === "invoice.payment_failed") {
    const invoice = (evt?.data?.object || {}) as StripeInvoiceLike;
    const invoiceId = idOf(invoice?.id);
    const subId = idOf(invoice?.subscription);
    const custId = idOf(invoice?.customer);
    const amountDue = Number(invoice?.amount_due);

    if (!invoiceId || !subId) {
      return NextResponse.json({ received: true, ignored: "not_subscription_invoice" }, { status: 200 });
    }
    // A zero-amount invoice cannot meaningfully fail, and telling
    // somebody their $0.00 payment was declined is pure confusion.
    if (!Number.isFinite(amountDue) || amountDue <= 0) {
      return NextResponse.json({ received: true, ignored: "zero_amount" }, { status: 200 });
    }

    const userId = await findUserIdForSubscription(admin, subId, custId);
    if (!userId) {
      return NextResponse.json({ received: true, ignored: "no_profile_match" }, { status: 200 });
    }
    const full = (await retrieveSubscription(stripeSecret, subId)) as StripeSubscriptionLike | null;
    const stylist = await loadStylist(admin, userId);
    if (stylist.email) {
      await enqueueLifecycleEmail({
        admin,
        userId,
        recipientEmail: stylist.email,
        recipientName: stylist.firstName,
        type: "stylist_payment_failed",
        payload: buildPaymentFailedPayload(invoice, full, {
          firstName: stylist.firstName,
          timeZone: stylist.timeZone,
          baseUrl: appBaseUrl(),
          // The event's own timestamp is when the attempt failed. The
          // invoice's `created` is when it was raised, which can be
          // days earlier on a retry.
          failedAt: Number.isFinite(Number(evt?.created)) ? Number(evt.created) : null,
        }),
        dedupeKey: dedupeKeys.paymentFailed(invoiceId, invoice?.attempt_count ?? null),
      });
    }
    return NextResponse.json({ received: true }, { status: 200 });
  }

  // ---- customer.subscription.created / updated / deleted -----------
  const sub = evt?.data?.object;
  const subscriptionId: string | null = typeof sub?.id === "string" ? sub.id : null;
  const customerId: string | null = typeof sub?.customer === "string" ? sub.customer : null;
  // On deletion Stripe still reports the final status ('canceled').
  const status: string | null = typeof sub?.status === "string" ? sub.status : null;
  const periodEnd = toTs(sub?.current_period_end);
  const cancelAtPeriodEnd = sub?.cancel_at_period_end === true;

  if (!status || (!subscriptionId && !customerId)) {
    return NextResponse.json({ received: true, ignored: "incomplete_subscription" }, { status: 200 });
  }

  const { error } = await admin.rpc("apply_subscription_status", {
    customer_id_in: customerId,
    subscription_id_in: subscriptionId,
    status_in: status,
    current_period_end_in: periodEnd,
    cancel_at_period_end_in: cancelAtPeriodEnd,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ received: true }, { status: 200 });
}
