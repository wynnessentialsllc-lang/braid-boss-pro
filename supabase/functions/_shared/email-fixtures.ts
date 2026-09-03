// Preview + test fixtures for the account, billing, and report emails.
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
  renderPaymentFailed,
  renderSubscriptionConfirmed,
  renderTrialEnding,
  renderTrialStarted,
  renderVerifyEmail,
  renderWelcome,
} from "./lifecycle-emails.ts";
import { renderMonthlyReview } from "./monthly-review-email.ts";
import { renderActivationNudge, type ActivationStep } from "./activation-nudge-email.ts";
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
    | "6. Payment failed"
    | "7. Month in review"
    | "8. Activation nudge"
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
const FAILED_AT = 1_756_209_700;
const NEXT_RETRY = 1_756_555_200; // 2025-08-30T12:00:00Z
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

// A believable month for a braider working Thursday through Saturday:
// weekday averages that peak on Saturday, afternoons that out-earn
// mornings, and a mix of services and shop items.
const MONTH_FULL = {
  studioName: "SBW Braiding",
  monthLabel: "August 2026",
  prevMonthLabel: "July 2026",
  currency: "USD",
  revenue: 6420,
  prevRevenue: 5480,
  salesCount: 27,
  prevSalesCount: 23,
  customersServed: 22,
  newCustomers: 8,
  returningCustomers: 14,
  daysWithSales: 13,
  bestWeekday: "Saturday",
  bestWeekdayAvg: 780,
  avgDailySales: 494,
  byWeekday: [
    { weekday: "Sunday", sales: 0 },
    { weekday: "Monday", sales: 0 },
    { weekday: "Tuesday", sales: 180 },
    { weekday: "Wednesday", sales: 240 },
    { weekday: "Thursday", sales: 420 },
    { weekday: "Friday", sales: 610 },
    { weekday: "Saturday", sales: 780 },
  ],
  byHour: [
    { hour: 8, sales: 320 },
    { hour: 9, sales: 640 },
    { hour: 11, sales: 980 },
    { hour: 13, sales: 1420 },
    { hour: 15, sales: 1860 },
    { hour: 17, sales: 900 },
    { hour: 19, sales: 300 },
  ],
  busiestDate: "2026-08-15",
  busiestDateSales: 1240,
  topServiceName: "Knotless Box Braids",
  topServiceSales: 2480,
  items: [
    { name: "Knotless Box Braids", count: 8, sales: 2480 },
    { name: "Boho Knotless", count: 5, sales: 1650 },
    { name: "Stitch Braids", count: 6, sales: 1290 },
    { name: "Edge Control 4oz", count: 14, sales: 336 },
    { name: "Braid Spray", count: 9, sales: 264 },
  ],
};

const LONG_STUDIO = "Crowned & Coiled Protective Styling Studio of Greater Los Angeles";
const LONG_SERVICE =
  "Waist Length Boho Knotless Braids with Human Hair Curls and Scalp Treatment";

// Setup steps for the activation nudge. Copy and deep links mirror the
// app's own setup flow (see SETUP_STEPS in lifecycle-emails.ts) and the
// four "setup-page" lessons in app/lib/braider-education-content.ts —
// the query params are illustrative only, not load-bearing for the
// renderer, which just places them in hrefs.
const ACTIVATION_STEP_CONTENT: Record<
  ActivationStep["key"],
  Omit<ActivationStep, "key" | "done">
> = {
  businessName: {
    title: "Add your business name",
    body: "Clients see this on your booking page and in every email you send them.",
    actionUrl: "https://braidbosspro.app/?n=settings",
    lessonUrl: "https://braidbosspro.app/?n=educationHub&lesson=customize-booking-page",
  },
  services: {
    title: "Add your first service",
    body: "Set a price, duration, and deposit so clients can actually book you.",
    actionUrl: "https://braidbosspro.app/?n=services",
    lessonUrl: "https://braidbosspro.app/?n=educationHub&lesson=build-services-menu",
  },
  availability: {
    title: "Set your availability",
    body: "Choose the days and hours you want clients to see open.",
    actionUrl: "https://braidbosspro.app/?n=availability",
    lessonUrl: "https://braidbosspro.app/?n=educationHub&lesson=set-availability",
  },
  stripe: {
    title: "Connect Stripe",
    body: "Let deposits and payments go straight to your bank account.",
    actionUrl: "https://braidbosspro.app/?n=stripeConnect",
    lessonUrl: "https://braidbosspro.app/?n=educationHub&lesson=connect-stripe",
  },
  bookingLink: {
    title: "Claim your booking link",
    body: "Get a shareable link for Instagram, TikTok, and anywhere clients find you.",
    actionUrl: "https://braidbosspro.app/?n=bookingPage",
    lessonUrl: "https://braidbosspro.app/?n=educationHub&lesson=customize-booking-page",
  },
};

const ACTIVATION_STEP_ORDER: ActivationStep["key"][] = [
  "businessName",
  "services",
  "availability",
  "stripe",
  "bookingLink",
];

const activationStep = (
  key: ActivationStep["key"],
  done: boolean,
  overrides: Partial<Omit<ActivationStep, "key" | "done">> = {},
): ActivationStep => ({
  key,
  done,
  ...ACTIVATION_STEP_CONTENT[key],
  ...overrides,
});

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
  {
    id: "trial-no-stripe-yet",
    label: "Trial started, no Stripe object at all (the real signup flow)",
    group: "3. Free trial started",
    note: "Every trial now starts automatically at signup with no card collected — no Stripe subscription exists yet, so there is nothing to cancel and no billing portal to point at. The plan/dates/setup content still renders in full; only the closing line changes to \"add a card before your trial ends\" rather than \"cancel anytime.\"",
    render: () =>
      renderTrialStarted({
        firstName: "Sheree",
        planLabel: "Monthly",
        now: NOW_AT_SIGNUP,
        trialStart: TRIAL_START,
        trialEnd: TRIAL_END,
        timeZone: "America/Los_Angeles",
      }),
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
  {
    id: "ending-no-stripe-yet",
    label: "Trial ending, no Stripe object at all (the real signup flow)",
    group: "4. Trial ending soon",
    note: "Every trial now starts automatically at signup with no card collected. Nothing is set to auto-charge and there is no billing portal to send anyone to, so the copy and CTA both change: \"Subscribe now\" instead of \"Manage or cancel my subscription.\"",
    render: () =>
      renderTrialEnding({
        firstName: "Sheree",
        now: NOW_BEFORE_TRIAL_END,
        planLabel: "Monthly",
        trialEnd: TRIAL_END,
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

  // ---- 6. Payment failed --------------------------------------------
  {
    id: "failed-with-retry",
    label: "Payment failed, retry scheduled",
    group: "6. Payment failed",
    note: "The common case. Stripe will try again, so the copy says when and stays calm.",
    render: () =>
      renderPaymentFailed({
        firstName: "Sheree",
        planLabel: "Monthly",
        amountDueMinor: 1499,
        currency: "usd",
        interval: "month",
        failedAt: FAILED_AT,
        nextRetryAt: NEXT_RETRY,
        cardBrand: "visa",
        cardLast4: "4242",
        invoiceUrl: "https://invoice.stripe.com/i/preview_only_not_a_real_invoice",
        timeZone: "America/Los_Angeles",
      }),
  },
  {
    id: "failed-final-attempt",
    label: "Payment failed, no more retries",
    group: "6. Payment failed",
    note: "Stripe has exhausted its retry schedule. The email must not imply another attempt is coming.",
    render: () =>
      renderPaymentFailed({
        firstName: "Sheree",
        planLabel: "Monthly",
        amountDueMinor: 1499,
        currency: "usd",
        interval: "month",
        failedAt: FAILED_AT,
        nextRetryAt: null,
        cardBrand: "visa",
        cardLast4: "4242",
        invoiceUrl: "https://invoice.stripe.com/i/preview_only_not_a_real_invoice",
        timeZone: "America/Los_Angeles",
      }),
  },
  {
    id: "failed-annual",
    label: "Payment failed, annual plan",
    group: "6. Payment failed",
    note: "Larger annual amount and interval wording.",
    render: () =>
      renderPaymentFailed({
        firstName: "Nia",
        planLabel: "Annual",
        amountDueMinor: 14900,
        currency: "usd",
        interval: "year",
        failedAt: FAILED_AT,
        nextRetryAt: NEXT_RETRY,
        cardBrand: "mastercard",
        cardLast4: "5555",
        timeZone: "America/New_York",
      }),
  },
  {
    id: "failed-minimal",
    label: "Payment failed, minimal data",
    group: "6. Payment failed",
    note: "No name, no card, no plan, no invoice link. Every row drops out and the email still reads as a complete, actionable message.",
    render: () => renderPaymentFailed({}),
  },

  // ---- 7. Month in review -------------------------------------------
  // The report the stylist gets on the first of the month. Every block
  // below the headline figure is optional, so these fixtures exist to
  // prove the layout holds as they drop away one at a time.
  {
    id: "monthly-review-full",
    label: "Month in review, full data",
    group: "7. Month in review",
    note: "A busy month with every section populated and a month-over-month gain. This is the build to review first.",
    render: () => renderMonthlyReview(MONTH_FULL),
  },
  {
    id: "monthly-review-down",
    label: "Month in review, down on last month",
    group: "7. Month in review",
    note: "The delta pill flips to coral. A slower month must still read as a report, not a scolding.",
    render: () =>
      renderMonthlyReview({
        ...MONTH_FULL,
        revenue: 3120,
        prevRevenue: 5480,
        salesCount: 14,
        prevSalesCount: 23,
      }),
  },
  {
    id: "monthly-review-first",
    label: "Month in review, first month with sales",
    group: "7. Month in review",
    note: "No prior month to compare against, so the comparison pill and the sales delta line both disappear rather than claiming infinite growth.",
    render: () =>
      renderMonthlyReview({
        ...MONTH_FULL,
        prevMonthLabel: null,
        prevRevenue: 0,
        prevSalesCount: 0,
        newCustomers: 11,
        returningCustomers: 0,
      }),
  },
  {
    id: "monthly-review-sparse",
    label: "Month in review, one appointment",
    group: "7. Month in review",
    note: "The realistic floor: a single sale, no shop orders, no recorded appointment time. The hour chart and the biggest-day card drop out and the report still closes properly.",
    render: () =>
      renderMonthlyReview({
        studioName: "SBW Braiding",
        monthLabel: "August 2026",
        prevMonthLabel: "July 2026",
        currency: "USD",
        revenue: 215,
        prevRevenue: 0,
        salesCount: 1,
        prevSalesCount: 0,
        customersServed: 1,
        newCustomers: 0,
        returningCustomers: 1,
        daysWithSales: 1,
        bestWeekday: "Saturday",
        bestWeekdayAvg: 215,
        avgDailySales: 215,
        byWeekday: [{ weekday: "Saturday", sales: 215 }],
        byHour: [],
        busiestDate: null,
        busiestDateSales: 0,
        topServiceName: null,
        topServiceSales: 0,
        items: [],
      }),
  },
  {
    id: "monthly-review-long-names",
    label: "Month in review, long studio and service names",
    group: "7. Month in review",
    note: "Long names must wrap inside the item table instead of stretching the 600px shell, and the subject line must stay readable.",
    render: () =>
      renderMonthlyReview({
        ...MONTH_FULL,
        studioName: LONG_STUDIO,
        topServiceName: LONG_SERVICE,
        items: [
          { name: LONG_SERVICE, count: 6, sales: 2040 },
          { name: "Marley Twists & Scalp Treatment (Add-On Bundle)", count: 3, sales: 810 },
        ],
      }),
  },

  // ---- 8. Activation nudge -------------------------------------------
  // The onboarding "setup steps left" checkpoint mail, sent at day 1 / 3
  // / 7 / 14 / 21 of the free trial. These fixtures prove the checklist
  // holds as steps complete one by one, and that a caller error (nothing
  // left, or nothing supplied at all) still renders cleanly.
  {
    id: "activation-day1-none-done",
    label: "Activation nudge, day 1, nothing done yet",
    group: "8. Activation nudge",
    note: "The first checkpoint. Every step is still open, and the tone is welcoming rather than a scolding.",
    render: () =>
      renderActivationNudge({
        firstName: "Sheree",
        studioName: "SBW Braiding",
        daysSinceStart: 1,
        steps: ACTIVATION_STEP_ORDER.map((key) => activationStep(key, false)),
        dashboardUrl: "https://braidbosspro.app",
      }),
  },
  {
    id: "activation-day7-mixed",
    label: "Activation nudge, day 7, a realistic mix",
    group: "8. Activation nudge",
    note: "One week in: two steps done and checked off, three still open. The whole checklist stays visible, not just what's left.",
    render: () =>
      renderActivationNudge({
        firstName: "Nia",
        studioName: "Nia's Knotless",
        daysSinceStart: 7,
        steps: [
          activationStep("businessName", true),
          activationStep("services", true),
          activationStep("availability", false),
          activationStep("stripe", false),
          activationStep("bookingLink", false),
        ],
        dashboardUrl: "https://braidbosspro.app",
      }),
  },
  {
    id: "activation-day14-one-left",
    label: "Activation nudge, day 14, one step left",
    group: "8. Activation nudge",
    note: "Almost finished: only Stripe is still open. Copy turns more direct without any deadline pressure.",
    render: () =>
      renderActivationNudge({
        firstName: "Sheree",
        studioName: "SBW Braiding",
        daysSinceStart: 14,
        steps: [
          activationStep("businessName", true),
          activationStep("services", true),
          activationStep("availability", true),
          activationStep("stripe", false),
          activationStep("bookingLink", true),
        ],
        dashboardUrl: "https://braidbosspro.app",
      }),
  },
  {
    id: "activation-day21-all-done",
    label: "Activation nudge, everything already done",
    group: "8. Activation nudge",
    note: "Defensive case: the SQL side should never enqueue this once every step is complete, but a bad call still has to render as a clean 'you're all set' message rather than a broken or empty checklist.",
    render: () =>
      renderActivationNudge({
        firstName: "Sheree",
        studioName: "SBW Braiding",
        daysSinceStart: 21,
        steps: ACTIVATION_STEP_ORDER.map((key) => activationStep(key, true)),
        dashboardUrl: "https://braidbosspro.app",
      }),
  },
  {
    id: "activation-long-names",
    label: "Activation nudge, long studio and step names",
    group: "8. Activation nudge",
    note: "Long studio and step copy must wrap inside the checklist row instead of stretching the 600px shell.",
    render: () =>
      renderActivationNudge({
        firstName: LONG_NAME,
        studioName: LONG_STUDIO,
        daysSinceStart: 3,
        steps: [
          activationStep("businessName", true),
          activationStep("services", false, {
            title: "Add your first Waist Length Boho Knotless Braids with Scalp Treatment service",
            body: "Set a price, duration, and deposit for every style so clients can actually book the appointment they want.",
          }),
          activationStep("availability", false),
          activationStep("stripe", false),
          activationStep("bookingLink", false),
        ],
        dashboardUrl: "https://braidbosspro.app",
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
