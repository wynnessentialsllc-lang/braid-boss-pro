// Preview + test fixtures for the account and billing lifecycle emails.
//
// These are the ONLY place sample names, dates, prices, and URLs appear.
// No production template contains a hard-coded person, amount, or token:
// every renderer takes its values as arguments, and these fixtures are
// what the dev preview route, the screenshot script, and the unit tests
// feed in.
//
// Values are deliberately awkward in places (a very long name, a very
// long verification URL, a missing card, a timezone that flips the
// calendar date) because those are the cases that break email layouts.

import {
  renderEmailChange,
  renderPasswordReset,
  renderSubscriptionConfirmed,
  renderTrialEnding,
  renderTrialStarted,
  renderVerifyEmail,
  renderWelcome,
} from "./lifecycle-emails.ts";
import type { RenderedEmail } from "./email-kit.ts";

export type Fixture = {
  id: string;
  /** Short label for the preview index. */
  label: string;
  /** Which of the five priority emails this exercises. */
  group:
    | "1. Verify your email"
    | "2. Welcome and account confirmed"
    | "3. Free trial started"
    | "4. Trial ending soon"
    | "5. Subscription confirmed"
    | "Other auth emails";
  /** What this fixture is here to prove. */
  note: string;
  render: () => RenderedEmail;
};

// Fixed instants so previews and snapshots do not drift day to day.
// Epoch seconds, because that is the shape Stripe sends.
const TRIAL_START = 1_755_000_000; // 2025-08-12T13:20:00Z
const TRIAL_END = 1_756_209_600; // 2025-08-26T12:00:00Z
// Chosen to sit just after midnight UTC so a US zone renders the
// PREVIOUS calendar day. This is the case that catches naive
// date formatting.
const TRIAL_END_EDGE = 1_756_263_600; // 2025-08-27T03:00:00Z
const PAID_AT = 1_756_209_700;
const NEXT_BILLING = 1_758_888_000;
// Reference "now" for the day-count copy, so previews and snapshots do
// not change meaning as real time passes. Three days before TRIAL_END,
// which is exactly when Stripe fires customer.subscription.trial_will_end.
const NOW_AT_SIGNUP = TRIAL_START;
const NOW_BEFORE_TRIAL_END = TRIAL_END - 3 * 86_400;

const LONG_NAME = "Anastasia Chidinmaobi Oluwafunmilayo-Beauregard";
const LONG_URL =
  "https://braidbosspro.app/auth/callback?token=PREVIEW_ONLY_NOT_A_REAL_TOKEN_00000000000000000000000000000000&type=signup&redirect_to=https%3A%2F%2Fbraidbosspro.app%2Fauth%2Fcallback%3Fsource%3Demail%26campaign%3Dnone";
const SHORT_URL = "https://braidbosspro.app/auth/callback?token=PREVIEW_ONLY_NOT_A_REAL_TOKEN&type=signup";

export const FIXTURES: Fixture[] = [
  // ---- 1. Verify your email ----------------------------------------
  {
    id: "verify-basic",
    label: "Verify email",
    group: "1. Verify your email",
    note: "Baseline security email. No name, because the signup form collects only an email and a password.",
    render: () =>
      renderVerifyEmail({ confirmationUrl: SHORT_URL, expiresIn: "24 hours" }),
  },
  {
    id: "verify-named",
    label: "Verify email, with first name",
    group: "1. Verify your email",
    note: "Same email once a first name is known.",
    render: () =>
      renderVerifyEmail({
        confirmationUrl: SHORT_URL,
        firstName: "Sheree",
        expiresIn: "24 hours",
      }),
  },
  {
    id: "verify-long-url",
    label: "Verify email, very long link",
    group: "1. Verify your email",
    note: "Long verification URL must wrap instead of stretching the layout.",
    render: () =>
      renderVerifyEmail({
        confirmationUrl: LONG_URL,
        firstName: LONG_NAME,
        expiresIn: "1 hour",
      }),
  },
  {
    id: "verify-no-expiry",
    label: "Verify email, no expiry stated",
    group: "1. Verify your email",
    note: "When the provider's expiry window is unknown we say nothing about it rather than guessing.",
    render: () => renderVerifyEmail({ confirmationUrl: SHORT_URL }),
  },

  // ---- 2. Welcome ---------------------------------------------------
  {
    id: "welcome-named",
    label: "Welcome, with first name",
    group: "2. Welcome and account confirmed",
    note: "The main welcome build.",
    render: () => renderWelcome({ firstName: "Sheree" }),
  },
  {
    id: "welcome-no-name",
    label: "Welcome, no name on file",
    group: "2. Welcome and account confirmed",
    note: "The common real case today: greeting falls back to 'Hi there'.",
    render: () => renderWelcome({}),
  },
  {
    id: "welcome-long-name",
    label: "Welcome, very long name",
    group: "2. Welcome and account confirmed",
    note: "Long first name must not break the hero.",
    render: () => renderWelcome({ firstName: LONG_NAME }),
  },
  {
    id: "welcome-partial-setup",
    label: "Welcome, some setup already done",
    group: "2. Welcome and account confirmed",
    note: "Optional onboarding progress: completed steps render green and marked done.",
    render: () =>
      renderWelcome({ firstName: "Sheree", completed: ["services", "availability"] }),
  },
  {
    id: "welcome-lifetime",
    label: "Welcome, grandfathered lifetime user",
    group: "2. Welcome and account confirmed",
    note: "Lifetime and founding members get the same welcome. They never receive the trial or subscription emails, because they have no Stripe subscription and so generate none of those events.",
    render: () => renderWelcome({ firstName: "Toya" }),
  },
  {
    id: "welcome-long-url",
    label: "Welcome, very long dashboard URL",
    group: "2. Welcome and account confirmed",
    note: "Long CTA destination must not widen the layout.",
    render: () =>
      renderWelcome({
        firstName: "Sheree",
        dashboardUrl: `${LONG_URL}`,
        setupUrl: `${LONG_URL}`,
      }),
  },

  // ---- 3. Trial started ---------------------------------------------
  {
    id: "trial-monthly-card",
    label: "Trial started, monthly, card on file",
    group: "3. Free trial started",
    note: "Monthly trial with a stored card. Every details row is populated.",
    render: () =>
      renderTrialStarted({
        firstName: "Sheree",
        planLabel: "Monthly",
        now: NOW_AT_SIGNUP,
        trialStart: TRIAL_START,
        trialEnd: TRIAL_END,
        amountAfterTrialMinor: 1499,
        currency: "usd",
        interval: "month",
        cardBrand: "visa",
        cardLast4: "4242",
        timeZone: "America/Los_Angeles",
        stripeConnectActive: true,
      }),
  },
  {
    id: "trial-annual-card",
    label: "Trial started, annual, card on file",
    group: "3. Free trial started",
    note: "Annual trial. Amount and interval come from the live Stripe price, not from copy.",
    render: () =>
      renderTrialStarted({
        firstName: "Nia",
        planLabel: "Annual",
        now: NOW_AT_SIGNUP,
        trialStart: TRIAL_START,
        trialEnd: TRIAL_END,
        amountAfterTrialMinor: 14900,
        currency: "usd",
        interval: "year",
        cardBrand: "mastercard",
        cardLast4: "5555",
        timeZone: "America/New_York",
        stripeConnectActive: true,
      }),
  },
  {
    id: "trial-no-card",
    label: "Trial started, no payment method",
    group: "3. Free trial started",
    note: "No card on the subscription: the payment-method row disappears rather than claiming a card exists.",
    render: () =>
      renderTrialStarted({
        firstName: "Sheree",
        planLabel: "Monthly",
        now: NOW_AT_SIGNUP,
        trialStart: TRIAL_START,
        trialEnd: TRIAL_END,
        amountAfterTrialMinor: 1499,
        currency: "usd",
        interval: "month",
      }),
  },
  {
    id: "trial-no-connect",
    label: "Trial started, Stripe not connected",
    group: "3. Free trial started",
    note: "The payouts reassurance band is omitted entirely until Stripe Connect is genuinely charge-enabled.",
    render: () =>
      renderTrialStarted({
        firstName: "Sheree",
        planLabel: "Monthly",
        now: NOW_AT_SIGNUP,
        trialStart: TRIAL_START,
        trialEnd: TRIAL_END,
        amountAfterTrialMinor: 1499,
        currency: "usd",
        interval: "month",
        cardBrand: "visa",
        cardLast4: "4242",
        stripeConnectActive: false,
      }),
  },
  {
    id: "trial-minimal",
    label: "Trial started, minimal data",
    group: "3. Free trial started",
    note: "Worst case: no name, no plan, no dates, no amount. The email still reads as a complete message.",
    render: () => renderTrialStarted({ now: NOW_AT_SIGNUP }),
  },

  // ---- 4. Trial ending ----------------------------------------------
  {
    id: "ending-monthly",
    label: "Trial ending, monthly",
    group: "4. Trial ending soon",
    note: "Three days out, the point at which Stripe fires trial_will_end.",
    render: () =>
      renderTrialEnding({
        firstName: "Sheree",
        now: NOW_BEFORE_TRIAL_END,
        planLabel: "Monthly",
        trialEnd: TRIAL_END,
        amountMinor: 1499,
        currency: "usd",
        interval: "month",
        cardBrand: "visa",
        cardLast4: "4242",
        timeZone: "America/Los_Angeles",
      }),
  },
  {
    id: "ending-annual",
    label: "Trial ending, annual",
    group: "4. Trial ending soon",
    note: "Annual plan wording and amount.",
    render: () =>
      renderTrialEnding({
        firstName: "Nia",
        now: NOW_BEFORE_TRIAL_END,
        planLabel: "Annual",
        trialEnd: TRIAL_END,
        amountMinor: 14900,
        currency: "usd",
        interval: "year",
        cardBrand: "amex",
        cardLast4: "0005",
        timeZone: "America/Chicago",
      }),
  },
  {
    id: "ending-tz-utc",
    label: "Trial ending, boundary date rendered in UTC",
    group: "4. Trial ending soon",
    note: "Trial ends 03:00 UTC. With no known zone we render the UTC date (August 27).",
    render: () =>
      renderTrialEnding({
        firstName: "Sheree",
        now: NOW_BEFORE_TRIAL_END,
        planLabel: "Monthly",
        trialEnd: TRIAL_END_EDGE,
        amountMinor: 1499,
        currency: "usd",
        interval: "month",
      }),
  },
  {
    id: "ending-tz-pacific",
    label: "Trial ending, same instant in Los Angeles",
    group: "4. Trial ending soon",
    note: "Same instant as the previous fixture, rendered in the stylist's own zone (August 26). Compare the two.",
    render: () =>
      renderTrialEnding({
        firstName: "Sheree",
        now: NOW_BEFORE_TRIAL_END,
        planLabel: "Monthly",
        trialEnd: TRIAL_END_EDGE,
        amountMinor: 1499,
        currency: "usd",
        interval: "month",
        timeZone: "America/Los_Angeles",
      }),
  },
  {
    id: "ending-cancelling",
    label: "Trial ending, already set to cancel",
    group: "4. Trial ending soon",
    note: "Subscription is set to stop at trial end. The email must not say a payment is coming.",
    render: () =>
      renderTrialEnding({
        firstName: "Sheree",
        now: NOW_BEFORE_TRIAL_END,
        planLabel: "Monthly",
        trialEnd: TRIAL_END,
        amountMinor: 1499,
        currency: "usd",
        interval: "month",
        cancelAtPeriodEnd: true,
        timeZone: "America/Los_Angeles",
      }),
  },

  // ---- 5. Subscription confirmed ------------------------------------
  {
    id: "sub-first",
    label: "Subscription confirmed, first payment",
    group: "5. Subscription confirmed",
    note: "First real charge after the trial converts.",
    render: () =>
      renderSubscriptionConfirmed({
        firstName: "Sheree",
        mode: "first",
        planLabel: "Monthly",
        amountPaidMinor: 1499,
        currency: "usd",
        interval: "month",
        paidAt: PAID_AT,
        nextBillingDate: NEXT_BILLING,
        cardBrand: "visa",
        cardLast4: "4242",
        invoiceUrl: "https://invoice.stripe.com/i/preview_only_not_a_real_invoice",
        timeZone: "America/Los_Angeles",
      }),
  },
  {
    id: "sub-annual",
    label: "Subscription confirmed, annual",
    group: "5. Subscription confirmed",
    note: "Annual amount and interval.",
    render: () =>
      renderSubscriptionConfirmed({
        firstName: "Nia",
        mode: "first",
        planLabel: "Annual",
        amountPaidMinor: 14900,
        currency: "usd",
        interval: "year",
        paidAt: PAID_AT,
        nextBillingDate: NEXT_BILLING,
        cardBrand: "mastercard",
        cardLast4: "5555",
        invoiceUrl: "https://invoice.stripe.com/i/preview_only_not_a_real_invoice",
        timeZone: "America/New_York",
      }),
  },
  {
    id: "sub-renewal",
    label: "Payment received, later billing cycle",
    group: "5. Subscription confirmed",
    note: "Same template in renewal mode, so a recurring receipt does not need a second email system.",
    render: () =>
      renderSubscriptionConfirmed({
        firstName: "Sheree",
        mode: "renewal",
        planLabel: "Monthly",
        amountPaidMinor: 1499,
        currency: "usd",
        interval: "month",
        paidAt: PAID_AT,
        nextBillingDate: NEXT_BILLING,
        cardBrand: "visa",
        cardLast4: "4242",
        invoiceUrl: "https://invoice.stripe.com/i/preview_only_not_a_real_invoice",
        timeZone: "America/Los_Angeles",
      }),
  },
  {
    id: "sub-no-invoice",
    label: "Subscription confirmed, no receipt link",
    group: "5. Subscription confirmed",
    note: "Stripe did not return a hosted invoice URL. The receipt link is dropped, not rendered dead.",
    render: () =>
      renderSubscriptionConfirmed({
        firstName: "Sheree",
        mode: "first",
        planLabel: "Monthly",
        amountPaidMinor: 1499,
        currency: "usd",
        interval: "month",
        paidAt: PAID_AT,
        cardBrand: "visa",
        cardLast4: "4242",
      }),
  },

  // ---- Other auth emails --------------------------------------------
  {
    id: "reset-password",
    label: "Password reset",
    group: "Other auth emails",
    note: "Existing Supabase flow, restyled to match. Same security shell as the verify email.",
    render: () =>
      renderPasswordReset({ confirmationUrl: SHORT_URL, expiresIn: "1 hour" }),
  },
  {
    id: "email-change",
    label: "Email change confirmation",
    group: "Other auth emails",
    note: "Existing Supabase flow, restyled to match.",
    render: () =>
      renderEmailChange({ confirmationUrl: SHORT_URL, expiresIn: "24 hours" }),
  },
];

export const fixtureById = (id: string): Fixture | undefined =>
  FIXTURES.find((f) => f.id === id);
