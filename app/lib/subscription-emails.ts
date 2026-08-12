// Payload builders + enqueue helpers for the billing lifecycle emails
// (trial started, trial ending, subscription confirmed, payment failed).
//
// Split out of /api/subscribe/webhook so the mapping from a raw Stripe
// object to an email payload is unit-testable without a webhook, a
// signature, or a database. The pure builders take plain objects and
// return plain objects; only `enqueueLifecycleEmail` touches Supabase.
//
// Sending itself is NOT done here. Every helper enqueues into the
// existing notification_queue via queue_notification, exactly like the
// booking, deposit, and storefront webhooks do, and the
// process-notification-queue worker renders and delivers it. There is
// no second email path.
//
// Server-only. Never import from a client component.

import type { SupabaseClient } from "@supabase/supabase-js";

/** Notification types handled by the shared lifecycle templates. */
export type LifecycleEmailType =
  | "stylist_trial_started"
  | "stylist_trial_ending"
  | "stylist_subscription_confirmed"
  | "stylist_payment_failed";

/** Minimal shape of the bits of a Stripe subscription we read. */
export type StripeSubscriptionLike = {
  id?: string;
  status?: string;
  customer?: string | { id?: string };
  trial_start?: number | null;
  trial_end?: number | null;
  current_period_end?: number | null;
  cancel_at_period_end?: boolean;
  metadata?: Record<string, string> | null;
  items?: { data?: Array<{ price?: StripePriceLike | null }> } | null;
  default_payment_method?: StripePaymentMethodLike | string | null;
  latest_invoice?: string | { id?: string } | null;
};

export type StripePriceLike = {
  unit_amount?: number | null;
  currency?: string | null;
  recurring?: { interval?: string | null } | null;
  nickname?: string | null;
};

export type StripePaymentMethodLike = {
  card?: { brand?: string | null; last4?: string | null } | null;
};

export type StripeInvoiceLike = {
  id?: string;
  amount_paid?: number | null;
  amount_due?: number | null;
  attempt_count?: number | null;
  next_payment_attempt?: number | null;
  currency?: string | null;
  status?: string | null;
  billing_reason?: string | null;
  created?: number | null;
  status_transitions?: { paid_at?: number | null } | null;
  hosted_invoice_url?: string | null;
  invoice_pdf?: string | null;
  subscription?: string | { id?: string } | null;
  customer?: string | { id?: string } | null;
  lines?: { data?: Array<{ period?: { end?: number | null } | null; price?: StripePriceLike | null }> } | null;
};

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Read an id off a field Stripe returns either expanded or as a string. */
export const idOf = (v: unknown): string | null => {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (v && typeof v === "object") {
    const id = (v as { id?: unknown }).id;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  return null;
};

/** The first recurring price on the subscription, if there is one. */
export const priceOf = (sub: StripeSubscriptionLike): StripePriceLike | null =>
  sub?.items?.data?.[0]?.price ?? null;

/**
 * Billing interval as Stripe reports it ("month" / "year"), taken from
 * the live price rather than from our own metadata, so the email can
 * never disagree with what the customer is actually on.
 */
export const intervalOf = (sub: StripeSubscriptionLike): string | null =>
  str(priceOf(sub)?.recurring?.interval) || null;

/**
 * Human plan label. Prefers the live price interval; falls back to the
 * `plan` metadata the checkout route stamps. Returns null rather than
 * guessing when neither is present.
 */
export const planLabelOf = (sub: StripeSubscriptionLike): string | null => {
  const interval = intervalOf(sub);
  if (interval === "year") return "Annual";
  if (interval === "month") return "Monthly";
  const meta = str(sub?.metadata?.plan).toLowerCase();
  if (meta === "annual") return "Annual";
  if (meta === "monthly") return "Monthly";
  return null;
};

/** Card brand + last4, only when Stripe actually expanded a card. */
export const cardOf = (
  sub: StripeSubscriptionLike,
): { cardBrand: string | null; cardLast4: string | null } => {
  const pm = sub?.default_payment_method;
  if (!pm || typeof pm === "string") return { cardBrand: null, cardLast4: null };
  const card = pm.card;
  const last4 = str(card?.last4);
  if (!last4) return { cardBrand: null, cardLast4: null };
  return { cardBrand: str(card?.brand) || null, cardLast4: last4 };
};

// ---------------------------------------------------------------------
// Payload builders (pure)
// ---------------------------------------------------------------------

export type RecipientContext = {
  firstName?: string | null;
  /** IANA zone used to render dates. Falls back to UTC in the template. */
  timeZone?: string | null;
  baseUrl: string;
  /** Only pass true when Stripe Connect really is charge-enabled. */
  stripeConnectActive?: boolean;
};

export const buildTrialStartedPayload = (
  sub: StripeSubscriptionLike,
  ctx: RecipientContext,
): Record<string, unknown> => {
  const price = priceOf(sub);
  const { cardBrand, cardLast4 } = cardOf(sub);
  return {
    firstName: ctx.firstName ?? null,
    planLabel: planLabelOf(sub),
    trialStart: sub?.trial_start ?? null,
    trialEnd: sub?.trial_end ?? null,
    amountAfterTrialMinor:
      typeof price?.unit_amount === "number" ? price.unit_amount : null,
    currency: str(price?.currency) || "usd",
    interval: intervalOf(sub),
    cardBrand,
    cardLast4,
    timeZone: ctx.timeZone ?? null,
    stripeConnectActive: ctx.stripeConnectActive === true,
    baseUrl: ctx.baseUrl,
    dashboardUrl: `${ctx.baseUrl}/`,
    setupUrl: `${ctx.baseUrl}/`,
  };
};

export const buildTrialEndingPayload = (
  sub: StripeSubscriptionLike,
  ctx: RecipientContext,
): Record<string, unknown> => {
  const price = priceOf(sub);
  const { cardBrand, cardLast4 } = cardOf(sub);
  return {
    firstName: ctx.firstName ?? null,
    planLabel: planLabelOf(sub),
    // trial_end is the authoritative end of the free period. Fall back
    // to the period end only when Stripe omitted it.
    trialEnd: sub?.trial_end ?? sub?.current_period_end ?? null,
    amountMinor: typeof price?.unit_amount === "number" ? price.unit_amount : null,
    currency: str(price?.currency) || "usd",
    interval: intervalOf(sub),
    cardBrand,
    cardLast4,
    cancelAtPeriodEnd: sub?.cancel_at_period_end === true,
    timeZone: ctx.timeZone ?? null,
    baseUrl: ctx.baseUrl,
    dashboardUrl: `${ctx.baseUrl}/`,
    manageUrl: `${ctx.baseUrl}/`,
  };
};

/**
 * Receipt / confirmation payload.
 *
 * `mode` is "first" for the invoice that creates the subscription or the
 * first one after a trial, and "renewal" for every later cycle, so one
 * template covers both without inventing a second email.
 */
export const buildSubscriptionConfirmedPayload = (
  invoice: StripeInvoiceLike,
  sub: StripeSubscriptionLike | null,
  ctx: RecipientContext,
): Record<string, unknown> => {
  const line = invoice?.lines?.data?.[0] ?? null;
  const price = line?.price ?? (sub ? priceOf(sub) : null);
  const { cardBrand, cardLast4 } = sub
    ? cardOf(sub)
    : { cardBrand: null, cardLast4: null };
  const reason = str(invoice?.billing_reason);
  const mode: "first" | "renewal" =
    reason === "subscription_cycle" ? "renewal" : "first";
  const interval = str(price?.recurring?.interval) || (sub ? intervalOf(sub) : null);
  const planLabel =
    interval === "year" ? "Annual" : interval === "month" ? "Monthly" : sub ? planLabelOf(sub) : null;

  return {
    firstName: ctx.firstName ?? null,
    mode,
    planLabel,
    amountPaidMinor:
      typeof invoice?.amount_paid === "number" ? invoice.amount_paid : null,
    currency: str(invoice?.currency) || "usd",
    interval,
    paidAt: invoice?.status_transitions?.paid_at ?? invoice?.created ?? null,
    nextBillingDate: line?.period?.end ?? sub?.current_period_end ?? null,
    cardBrand,
    cardLast4,
    invoiceUrl: str(invoice?.hosted_invoice_url) || null,
    timeZone: ctx.timeZone ?? null,
    baseUrl: ctx.baseUrl,
    dashboardUrl: `${ctx.baseUrl}/`,
    manageUrl: `${ctx.baseUrl}/`,
  };
};

/**
 * Dunning payload.
 *
 * Deliberately narrow. Stripe puts a decline code, a network response,
 * and a `last_payment_error` on the surrounding objects; none of it is
 * copied here, so processor internals cannot reach an inbox even if a
 * future template tried to render them.
 *
 * `failedAt` is passed in by the caller (the webhook uses the event's
 * own timestamp) rather than guessed from the invoice, because an
 * invoice's `created` is when it was raised, not when the attempt
 * failed.
 */
export const buildPaymentFailedPayload = (
  invoice: StripeInvoiceLike,
  sub: StripeSubscriptionLike | null,
  ctx: RecipientContext & { failedAt?: number | null },
): Record<string, unknown> => {
  const line = invoice?.lines?.data?.[0] ?? null;
  const price = line?.price ?? (sub ? priceOf(sub) : null);
  const { cardBrand, cardLast4 } = sub
    ? cardOf(sub)
    : { cardBrand: null, cardLast4: null };
  const interval = str(price?.recurring?.interval) || (sub ? intervalOf(sub) : null);
  const planLabel =
    interval === "year" ? "Annual" : interval === "month" ? "Monthly" : sub ? planLabelOf(sub) : null;

  return {
    firstName: ctx.firstName ?? null,
    planLabel,
    amountDueMinor: typeof invoice?.amount_due === "number" ? invoice.amount_due : null,
    currency: str(invoice?.currency) || "usd",
    interval,
    failedAt: ctx.failedAt ?? invoice?.created ?? null,
    // Absent when Stripe has exhausted its retry schedule. The template
    // says so plainly rather than implying another attempt is coming.
    nextRetryAt: invoice?.next_payment_attempt ?? null,
    cardBrand,
    cardLast4,
    invoiceUrl: str(invoice?.hosted_invoice_url) || null,
    timeZone: ctx.timeZone ?? null,
    baseUrl: ctx.baseUrl,
    manageUrl: `${ctx.baseUrl}/`,
  };
};

// ---------------------------------------------------------------------
// Dedupe keys
// ---------------------------------------------------------------------

/**
 * One key per real-world event, not per webhook delivery.
 *
 * The webhook route already drops duplicate Stripe *events* via
 * record_stripe_webhook_event. These keys defend against the other
 * shape of duplication: two DIFFERENT events that describe the same
 * moment (for example checkout.session.completed and
 * customer.subscription.created both landing for one new trial).
 */
export const dedupeKeys = {
  trialStarted: (subscriptionId: string) => `stylist_trial_started:${subscriptionId}`,
  trialEnding: (subscriptionId: string, trialEnd?: number | null) =>
    `stylist_trial_ending:${subscriptionId}:${trialEnd ?? "na"}`,
  subscriptionConfirmed: (invoiceId: string) =>
    `stylist_subscription_confirmed:${invoiceId}`,
  // Keyed by ATTEMPT, not just by invoice. Stripe retries a failed
  // invoice several times over about two weeks, and each genuine
  // attempt deserves one notice, while a replayed webhook for the same
  // attempt must not produce a second.
  paymentFailed: (invoiceId: string, attemptCount?: number | null) =>
    `stylist_payment_failed:${invoiceId}:${attemptCount ?? 1}`,
} as const;

// ---------------------------------------------------------------------
// Enqueue
// ---------------------------------------------------------------------

const SUBJECTS: Record<LifecycleEmailType, string> = {
  stylist_trial_started: "Your 14-day Braid Boss Pro trial has started",
  stylist_trial_ending: "Your Braid Boss Pro trial is ending soon",
  stylist_subscription_confirmed: "You're officially a Braid Boss Pro",
  stylist_payment_failed: "We could not process your Braid Boss Pro payment",
};

/**
 * Short plain-text safety net stored on the queue row. The lifecycle
 * templates build their own full text/plain alternative and that one is
 * what actually ships; this only surfaces if a row is ever rendered by
 * the generic fallback.
 */
const FALLBACK_BODY: Record<LifecycleEmailType, string> = {
  stylist_trial_started:
    "Your Braid Boss Pro free trial is active. Every feature is unlocked. Open the app to add your services, set your availability, connect Stripe, and share your booking link.",
  stylist_trial_ending:
    "Your Braid Boss Pro trial is ending soon. Open the app to review your plan, or to manage or cancel your subscription from Account.",
  stylist_subscription_confirmed:
    "Your Braid Boss Pro subscription payment went through. Open the app to keep running your booking, payments, and client tools.",
  stylist_payment_failed:
    "Your bank did not approve the latest payment for your Braid Boss Pro subscription. Your account is still open. Open the app and go to Account then Manage subscription to update your card.",
};

export type EnqueueArgs = {
  admin: SupabaseClient;
  userId: string;
  recipientEmail: string;
  recipientName?: string | null;
  type: LifecycleEmailType;
  payload: Record<string, unknown>;
  dedupeKey: string;
  /** Override the default subject, e.g. the day-count trial reminder. */
  subject?: string | null;
};

/**
 * Enqueue one lifecycle email. Fail-soft on purpose: a billing webhook
 * must return 200 to Stripe even when the mail queue is unhappy, or
 * Stripe retries the event and the subscription state churns. Failures
 * are logged without the recipient's address.
 */
export const enqueueLifecycleEmail = async (
  args: EnqueueArgs,
): Promise<{ ok: boolean; reason?: string }> => {
  if (!args.userId || !args.recipientEmail || !args.recipientEmail.includes("@")) {
    return { ok: false, reason: "no_recipient" };
  }
  try {
    const { error } = await args.admin.rpc("queue_notification", {
      user_id_in: args.userId,
      channel_in: "email",
      notification_type_in: args.type,
      body_in: FALLBACK_BODY[args.type],
      subject_in: args.subject || SUBJECTS[args.type],
      recipient_email_in: args.recipientEmail,
      recipient_name_in: args.recipientName || null,
      payload_in: args.payload,
      dedupe_key_in: args.dedupeKey,
    });
    if (error) {
      console.warn(`[subscription-emails] enqueue ${args.type} failed: ${error.message}`);
      return { ok: false, reason: error.message };
    }
    return { ok: true };
  } catch (e: any) {
    console.warn(`[subscription-emails] enqueue ${args.type} threw: ${e?.message || e}`);
    return { ok: false, reason: "exception" };
  }
};

/**
 * Subject line for the trial reminder, which names the remaining days
 * when we can compute them. Kept next to the template's own subject
 * logic so the inbox line and the mail body never disagree.
 */
export const trialEndingSubject = (
  trialEndEpochSeconds?: number | null,
  now: Date = new Date(),
): string => {
  const n = Number(trialEndEpochSeconds);
  if (!Number.isFinite(n) || n <= 0) return SUBJECTS.stylist_trial_ending;
  const days = Math.max(0, Math.ceil((n * 1000 - now.getTime()) / 86_400_000));
  if (days === 0) return "Your Braid Boss Pro trial ends today";
  return `Your Braid Boss Pro trial ends in ${days} ${days === 1 ? "day" : "days"}`;
};
