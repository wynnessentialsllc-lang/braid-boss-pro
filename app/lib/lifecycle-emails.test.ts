// Tests for the account + billing lifecycle email templates and the
// Stripe-object-to-payload mapping that feeds them.
//
// The templates are pure functions, so these assert on the rendered
// markup and text directly. No network, no database, no mail.

import { describe, expect, it } from "vitest";

import {
  esc,
  escUrl,
  firstNameOf,
  fmtDate,
  greeting,
  maskedCard,
  money,
  normalizeBase,
} from "../../supabase/functions/_shared/email-kit.ts";
import {
  renderEmailChange,
  renderPasswordReset,
  renderPaymentFailed,
  renderSubscriptionConfirmed,
  renderTrialEnding,
  renderTrialStarted,
  renderVerifyEmail,
  renderWelcome,
} from "../../supabase/functions/_shared/lifecycle-emails.ts";
import { FIXTURES } from "../../supabase/functions/_shared/email-fixtures.ts";
import {
  buildPaymentFailedPayload,
  buildSubscriptionConfirmedPayload,
  buildTrialEndingPayload,
  buildTrialStartedPayload,
  cardOf,
  dedupeKeys,
  idOf,
  intervalOf,
  planLabelOf,
  trialEndingSubject,
} from "./subscription-emails";

const AUTH_URL = "https://braidbosspro.app/auth/callback?token=abc123&type=signup";

// ---------------------------------------------------------------------
// Kit primitives
// ---------------------------------------------------------------------

describe("email kit primitives", () => {
  it("escapes HTML metacharacters", () => {
    expect(esc(`<script>"x"&'y'</script>`)).toBe(
      "&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;",
    );
  });

  it("rejects non-http URL schemes", () => {
    expect(escUrl("javascript:alert(1)")).toBe("");
    expect(escUrl("data:text/html,<h1>x</h1>")).toBe("");
    expect(escUrl("  ")).toBe("");
    expect(escUrl("https://braidbosspro.app/")).toBe("https://braidbosspro.app/");
  });

  it("passes Supabase template variables through untouched", () => {
    expect(escUrl("{{ .ConfirmationURL }}")).toBe("{{ .ConfirmationURL }}");
  });

  it("normalizes a base URL and refuses a bogus one", () => {
    expect(normalizeBase("https://braidbosspro.app/")).toBe("https://braidbosspro.app");
    expect(normalizeBase("not-a-url")).toBe("https://braidbosspro.app");
    expect(normalizeBase(null)).toBe("https://braidbosspro.app");
  });

  it("derives a first name, ignoring an email pasted into the field", () => {
    expect(firstNameOf("Sheree Wynn")).toBe("Sheree");
    expect(firstNameOf("  ")).toBe("");
    expect(firstNameOf("sheree@example.com")).toBe("");
    expect(greeting(null)).toBe("Hi there");
    expect(greeting("Sheree")).toBe("Hi Sheree");
  });

  it("formats currency from minor units", () => {
    expect(money(1499, "usd")).toBe("$14.99");
    expect(money(14900, "usd")).toBe("$149.00");
    expect(money(null)).toBe("");
    expect(money(undefined)).toBe("");
  });

  it("formats dates in the given zone and falls back to UTC", () => {
    // 2025-08-27T03:00:00Z is still August 26 on the US west coast.
    const instant = 1_756_263_600;
    expect(fmtDate(instant, "America/Los_Angeles")).toBe("August 26, 2025");
    expect(fmtDate(instant, null)).toBe("August 27, 2025");
    expect(fmtDate(instant, "Not/AZone")).toBe("August 27, 2025");
    expect(fmtDate(null)).toBe("");
  });

  it("masks a card only when a last4 is actually known", () => {
    expect(maskedCard("visa", "4242")).toBe("Visa ending in 4242");
    expect(maskedCard(null, "4242")).toBe("Card ending in 4242");
    expect(maskedCard("visa", null)).toBe("");
    expect(maskedCard(null, null)).toBe("");
  });
});

// ---------------------------------------------------------------------
// Structure shared by every template
// ---------------------------------------------------------------------

describe("every fixture", () => {
  it("renders a subject, preview text, HTML, and plain text", () => {
    for (const f of FIXTURES) {
      const r = f.render();
      expect(r.subject.length, f.id).toBeGreaterThan(0);
      expect(r.preheader.length, f.id).toBeGreaterThan(0);
      expect(r.text.length, f.id).toBeGreaterThan(80);
      expect(r.html.startsWith("<!doctype html>"), f.id).toBe(true);
    }
  });

  it("uses no em dashes in customer-facing copy", () => {
    for (const f of FIXTURES) {
      const r = f.render();
      expect(r.html.includes("—"), `${f.id} html`).toBe(false);
      expect(r.text.includes("—"), `${f.id} text`).toBe(false);
      expect(r.subject.includes("—"), `${f.id} subject`).toBe(false);
    }
  });

  it("keeps the desktop width at 600px and ships mobile breakpoints", () => {
    for (const f of FIXTURES) {
      const html = f.render().html;
      expect(html.includes("max-width:600px"), f.id).toBe(true);
      expect(html.includes("@media only screen and (max-width:620px)"), f.id).toBe(true);
      expect(html.includes("@media only screen and (max-width:360px)"), f.id).toBe(true);
      expect(html.includes('name="viewport"'), f.id).toBe(true);
    }
  });

  it("gives every image an alt attribute", () => {
    for (const f of FIXTURES) {
      const html = f.render().html;
      const imgs = html.match(/<img\b[^>]*>/g) || [];
      expect(imgs.length, `${f.id} should include the brand mark`).toBeGreaterThan(0);
      for (const img of imgs) {
        expect(/\salt="/.test(img), `${f.id}: ${img}`).toBe(true);
      }
    }
  });

  it("loads images only from the production origin", () => {
    for (const f of FIXTURES) {
      const html = f.render().html;
      for (const src of html.match(/<img[^>]+src="([^"]+)"/g) || []) {
        expect(src.includes("https://braidbosspro.app/"), `${f.id}: ${src}`).toBe(true);
        expect(/localhost|127\.0\.0\.1|vercel\.app|file:|\?token=/.test(src), f.id).toBe(false);
      }
    }
  });

  it("carries the transactional business identity", () => {
    for (const f of FIXTURES) {
      const r = f.render();
      expect(r.html.includes("Wynn Essentials, LLC"), f.id).toBe(true);
      expect(r.html.includes("Los Angeles, CA 90010"), f.id).toBe(true);
      expect(r.html.includes("hello@braidbosspro.app"), f.id).toBe(true);
      expect(r.text.includes("Wynn Essentials, LLC"), `${f.id} text`).toBe(true);
    }
  });

  it("states why the recipient received it", () => {
    for (const f of FIXTURES) {
      expect(f.render().html.includes("You received this because"), f.id).toBe(true);
    }
  });

  it("never renders an unsubscribe link in these transactional emails", () => {
    for (const f of FIXTURES) {
      const html = f.render().html.toLowerCase();
      expect(html.includes("unsubscribe"), f.id).toBe(false);
    }
  });

  it("uses no webfonts, scripts, or unsupported email features", () => {
    for (const f of FIXTURES) {
      const html = f.render().html;
      expect(/<script/i.test(html), f.id).toBe(false);
      expect(/@import/i.test(html), f.id).toBe(false);
      expect(/fonts\.googleapis/i.test(html), f.id).toBe(false);
      expect(/@keyframes|animation:/i.test(html), f.id).toBe(false);
      expect(/background-image:\s*url/i.test(html), f.id).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------
// 1. Verify your email
// ---------------------------------------------------------------------

describe("verify email", () => {
  it("uses the provider link verbatim in both the button and the fallback", () => {
    const r = renderVerifyEmail({ confirmationUrl: AUTH_URL, expiresIn: "24 hours" });
    const hrefs = (r.html.match(/href="([^"]+)"/g) || []).filter((h) => h.includes("token"));
    expect(hrefs.length).toBe(2); // button + copyable fallback
    for (const h of hrefs) {
      expect(h).toContain("token=abc123");
      // No tracking redirect wrapped around an auth token.
      expect(h).not.toMatch(/click\.|track\.|utm_/);
    }
    expect(r.text).toContain(AUTH_URL);
  });

  it("works with the Supabase template variable in place of a URL", () => {
    const r = renderVerifyEmail({ confirmationUrl: "{{ .ConfirmationURL }}" });
    expect(r.html).toContain('href="{{ .ConfirmationURL }}"');
  });

  it("states the expiry only when one was supplied", () => {
    expect(
      renderVerifyEmail({ confirmationUrl: AUTH_URL, expiresIn: "24 hours" }).html,
    ).toContain("expires in 24 hours");
    expect(renderVerifyEmail({ confirmationUrl: AUTH_URL }).html).not.toContain("expires in");
  });

  it("always offers the safe ignore instruction", () => {
    for (const r of [
      renderVerifyEmail({ confirmationUrl: AUTH_URL }),
      renderPasswordReset({ confirmationUrl: AUTH_URL }),
      renderEmailChange({ confirmationUrl: AUTH_URL }),
    ]) {
      expect(r.html).toContain("safely ignore this email");
    }
  });

  it("stays short: security emails carry no feature marketing", () => {
    const r = renderVerifyEmail({ confirmationUrl: AUTH_URL, expiresIn: "24 hours" });
    expect(r.html.length).toBeLessThan(14_000);
    expect(r.html).not.toContain("Five steps to go live");
    // One brand mark in the header and one in the footer, nothing more.
    expect((r.html.match(/<img\b/g) || []).length).toBe(2);
  });

  it("escapes a hostile name instead of injecting markup", () => {
    const r = renderVerifyEmail({
      confirmationUrl: AUTH_URL,
      firstName: '<img src=x onerror="alert(1)">',
    });
    // The literal text survives, but only as escaped entities: there is
    // no real tag and no real attribute for a client to execute.
    expect(r.html).not.toContain('<img src=x onerror="alert(1)">');
    expect(r.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("drops a hostile confirmation URL rather than linking it", () => {
    const r = renderVerifyEmail({ confirmationUrl: "javascript:alert(1)" });
    expect(r.html).not.toContain("javascript:");
  });
});

// ---------------------------------------------------------------------
// 2. Welcome
// ---------------------------------------------------------------------

describe("welcome email", () => {
  it("greets by name and falls back cleanly when there is none", () => {
    expect(renderWelcome({ firstName: "Sheree" }).html).toContain("Hi Sheree,");
    expect(renderWelcome({}).html).toContain("Hi there,");
  });

  it("lists all five setup steps in order", () => {
    const html = renderWelcome({}).html;
    for (const title of [
      "Add your services",
      "Set your availability",
      "Customize your booking page",
      "Connect Stripe",
      "Share your booking link",
    ]) {
      expect(html).toContain(title);
    }
  });

  it("marks completed onboarding steps when progress is known", () => {
    const plain = renderWelcome({}).html;
    const partial = renderWelcome({ completed: ["services"] }).html;
    expect(plain).not.toContain("Add your services (done)");
    expect(partial).toContain("Add your services (done)");
  });

  it("points every CTA at the dashboard it was given", () => {
    const r = renderWelcome({ dashboardUrl: "https://braidbosspro.app/", setupUrl: "https://braidbosspro.app/" });
    expect(r.html).toContain('href="https://braidbosspro.app/"');
    expect(r.text).toContain("Open my dashboard: https://braidbosspro.app/");
  });

  it("invents no client names, appointments, or amounts", () => {
    const html = renderWelcome({ firstName: "Sheree" }).html;
    // The dashboard-at-a-glance card describes what the product does.
    // It must never stand in fake bookings, times, or revenue.
    for (const invented of [
      "Jasmine",
      "Maya",
      "9:00 AM",
      "1:00 PM",
      "4 appointments",
      "Deposit paid",
      "$",
    ]) {
      expect(html.includes(invented), invented).toBe(false);
    }
  });

  it("closes with the brand signoff", () => {
    expect(renderWelcome({}).html).toContain("Built for stylists, by stylists.");
  });
});

// ---------------------------------------------------------------------
// 3. Trial started
// ---------------------------------------------------------------------

describe("trial started email", () => {
  const full = {
    firstName: "Sheree",
    planLabel: "Monthly",
    trialStart: 1_755_000_000,
    trialEnd: 1_756_209_600,
    amountAfterTrialMinor: 1499,
    currency: "usd",
    interval: "month",
    cardBrand: "visa",
    cardLast4: "4242",
    timeZone: "America/Los_Angeles",
  };

  it("renders every detail row when the data is present", () => {
    const html = renderTrialStarted(full).html;
    expect(html).toContain("Monthly");
    expect(html).toContain("$14.99/month");
    expect(html).toContain("Visa ending in 4242");
    expect(html).toContain("August 26, 2025");
  });

  it("renders the annual amount and interval", () => {
    const html = renderTrialStarted({
      ...full,
      planLabel: "Annual",
      interval: "year",
      amountAfterTrialMinor: 14900,
    }).html;
    expect(html).toContain("$149.00/year");
  });

  it("omits the payment method row when no card is on file", () => {
    const html = renderTrialStarted({ ...full, cardBrand: null, cardLast4: null }).html;
    expect(html).not.toContain("Payment method");
    expect(html).not.toContain("ending in");
  });

  it("omits the amount row rather than guessing a price", () => {
    const html = renderTrialStarted({ ...full, amountAfterTrialMinor: null }).html;
    expect(html).not.toContain("Amount after trial");
    expect(html).not.toContain("$14.99");
  });

  it("claims direct Stripe payouts only when Connect is charge-enabled", () => {
    const claim = "Braid Boss Pro does not hold your money";
    expect(renderTrialStarted({ ...full, stripeConnectActive: true }).html).toContain(claim);
    expect(renderTrialStarted({ ...full, stripeConnectActive: false }).html).not.toContain(claim);
    expect(renderTrialStarted(full).html).not.toContain(claim);
  });

  it("still reads as a complete email with nothing but defaults", () => {
    const r = renderTrialStarted({});
    expect(r.html).toContain("Hi there,");
    expect(r.html).toContain("Fourteen days. Every feature.");
    expect(r.html).not.toContain("undefined");
    expect(r.html).not.toContain("null");
    expect(r.html).not.toContain("NaN");
  });

  it("tells the recipient how to cancel", () => {
    expect(renderTrialStarted(full).html).toContain("Manage subscription");
  });
});

// ---------------------------------------------------------------------
// 4. Trial ending
// ---------------------------------------------------------------------

describe("trial ending email", () => {
  const base = {
    firstName: "Sheree",
    planLabel: "Monthly",
    trialEnd: 1_756_209_600,
    amountMinor: 1499,
    currency: "usd",
    interval: "month",
    cardBrand: "visa",
    cardLast4: "4242",
    now: 1_756_209_600 - 3 * 86_400,
  };

  it("counts the remaining days in the subject", () => {
    expect(renderTrialEnding(base).subject).toBe("Your Braid Boss Pro trial ends in 3 days");
    expect(renderTrialEnding({ ...base, now: 1_756_209_600 - 86_400 }).subject).toBe(
      "Your Braid Boss Pro trial ends in 1 day",
    );
    expect(renderTrialEnding({ ...base, now: 1_756_209_600 }).subject).toBe(
      "Your Braid Boss Pro trial ends today",
    );
  });

  it("renders the same instant as a different calendar day per zone", () => {
    const edge = { ...base, trialEnd: 1_756_263_600 };
    expect(renderTrialEnding(edge).html).toContain("August 27, 2025");
    expect(renderTrialEnding({ ...edge, timeZone: "America/Los_Angeles" }).html).toContain(
      "August 26, 2025",
    );
  });

  it("does not promise a charge when the subscription is set to cancel", () => {
    const r = renderTrialEnding({ ...base, cancelAtPeriodEnd: true });
    expect(r.html).toContain("set to stop at the end of the trial");
    expect(r.html).toContain("no payment will be taken");
    expect(r.html).not.toContain("subscription will begin");
  });

  it("states the upcoming charge plainly when one is coming", () => {
    const r = renderTrialEnding(base);
    expect(r.html).toContain("subscription will begin at $14.99/month");
    expect(r.html).toContain("unless you cancel before the trial ends");
  });

  it("uses no fear language", () => {
    const html = renderTrialEnding(base).html.toLowerCase();
    for (const word of ["lose", "losing", "expire", "deleted", "warning", "last chance", "act now"]) {
      expect(html.includes(word), word).toBe(false);
    }
  });

  it("offers a management link alongside the continue CTA", () => {
    const r = renderTrialEnding({ ...base, manageUrl: "https://braidbosspro.app/" });
    expect(r.html).toContain("Manage or cancel my subscription");
    expect(r.text).toContain("Manage or cancel my subscription: https://braidbosspro.app/");
  });
});

// ---------------------------------------------------------------------
// 5. Subscription confirmed
// ---------------------------------------------------------------------

describe("subscription confirmed email", () => {
  const paid = {
    firstName: "Sheree",
    planLabel: "Monthly",
    amountPaidMinor: 1499,
    currency: "usd",
    interval: "month",
    paidAt: 1_756_209_700,
    nextBillingDate: 1_758_888_000,
    cardBrand: "visa",
    cardLast4: "4242",
    invoiceUrl: "https://invoice.stripe.com/i/test",
    timeZone: "America/Los_Angeles",
  };

  it("renders the first-payment confirmation", () => {
    const r = renderSubscriptionConfirmed({ ...paid, mode: "first" });
    expect(r.subject).toBe("You're officially a Braid Boss Pro");
    expect(r.html).toContain("Your business has a system now.");
    expect(r.html).toContain("$14.99");
    expect(r.html).toContain("Billed monthly");
  });

  it("switches to receipt wording for a later cycle", () => {
    const r = renderSubscriptionConfirmed({ ...paid, mode: "renewal" });
    expect(r.subject).toBe("Your Braid Boss Pro payment went through");
    expect(r.html).toContain("Payment received");
    expect(r.html).not.toContain("Your business has a system now.");
  });

  it("links the Stripe receipt when there is one and omits it when not", () => {
    expect(renderSubscriptionConfirmed(paid).html).toContain(
      'href="https://invoice.stripe.com/i/test"',
    );
    const none = renderSubscriptionConfirmed({ ...paid, invoiceUrl: null }).html;
    expect(none).not.toContain("View or download your receipt");
  });

  it("closes on the brand line", () => {
    expect(renderSubscriptionConfirmed(paid).html).toContain(
      "You bring the talent. Braid Boss Pro helps run the business around it.",
    );
  });
});

// ---------------------------------------------------------------------
// Stripe object to payload mapping
// ---------------------------------------------------------------------

const subscription = {
  id: "sub_123",
  status: "trialing",
  customer: "cus_123",
  trial_start: 1_755_000_000,
  trial_end: 1_756_209_600,
  current_period_end: 1_756_209_600,
  cancel_at_period_end: false,
  metadata: { plan: "monthly", user_id: "u1" },
  items: {
    data: [{ price: { unit_amount: 1499, currency: "usd", recurring: { interval: "month" } } }],
  },
  default_payment_method: { card: { brand: "visa", last4: "4242" } },
};

describe("stripe payload builders", () => {
  it("reads ids whether Stripe expanded the field or not", () => {
    expect(idOf("sub_1")).toBe("sub_1");
    expect(idOf({ id: "sub_2" })).toBe("sub_2");
    expect(idOf(null)).toBe(null);
    expect(idOf({})).toBe(null);
  });

  it("derives the plan from the live price, not from our metadata", () => {
    expect(planLabelOf(subscription)).toBe("Monthly");
    expect(intervalOf(subscription)).toBe("month");
    const annual = {
      ...subscription,
      metadata: { plan: "monthly" },
      items: { data: [{ price: { unit_amount: 14900, currency: "usd", recurring: { interval: "year" } } }] },
    };
    expect(planLabelOf(annual)).toBe("Annual");
  });

  it("falls back to metadata only when there is no price", () => {
    expect(planLabelOf({ metadata: { plan: "annual" } })).toBe("Annual");
    expect(planLabelOf({})).toBe(null);
  });

  it("returns no card unless Stripe expanded one", () => {
    expect(cardOf(subscription)).toEqual({ cardBrand: "visa", cardLast4: "4242" });
    expect(cardOf({ ...subscription, default_payment_method: "pm_123" })).toEqual({
      cardBrand: null,
      cardLast4: null,
    });
    expect(cardOf({})).toEqual({ cardBrand: null, cardLast4: null });
  });

  it("builds a trial-started payload the template can render", () => {
    const payload = buildTrialStartedPayload(subscription, {
      firstName: "Sheree",
      timeZone: "America/Los_Angeles",
      baseUrl: "https://braidbosspro.app",
      stripeConnectActive: true,
    });
    expect(payload).toMatchObject({
      planLabel: "Monthly",
      amountAfterTrialMinor: 1499,
      currency: "usd",
      interval: "month",
      cardBrand: "visa",
      cardLast4: "4242",
      stripeConnectActive: true,
      dashboardUrl: "https://braidbosspro.app/",
    });
    const html = renderTrialStarted(payload as never).html;
    expect(html).toContain("$14.99/month");
    expect(html).toContain("Visa ending in 4242");
  });

  it("builds a trial-ending payload and carries the cancel flag", () => {
    const payload = buildTrialEndingPayload(
      { ...subscription, cancel_at_period_end: true },
      { baseUrl: "https://braidbosspro.app" },
    );
    expect(payload).toMatchObject({ cancelAtPeriodEnd: true, amountMinor: 1499 });
  });

  it("marks the first invoice and a renewal invoice differently", () => {
    const invoice = {
      id: "in_1",
      amount_paid: 1499,
      currency: "usd",
      billing_reason: "subscription_create",
      created: 1_756_209_700,
      hosted_invoice_url: "https://invoice.stripe.com/i/test",
      lines: { data: [{ period: { end: 1_758_888_000 }, price: { recurring: { interval: "month" } } }] },
    };
    const first = buildSubscriptionConfirmedPayload(invoice, subscription, {
      baseUrl: "https://braidbosspro.app",
    });
    expect(first).toMatchObject({
      mode: "first",
      amountPaidMinor: 1499,
      planLabel: "Monthly",
      invoiceUrl: "https://invoice.stripe.com/i/test",
      nextBillingDate: 1_758_888_000,
    });
    const renewal = buildSubscriptionConfirmedPayload(
      { ...invoice, billing_reason: "subscription_cycle" },
      subscription,
      { baseUrl: "https://braidbosspro.app" },
    );
    expect(renewal).toMatchObject({ mode: "renewal" });
  });

  it("survives an invoice with no subscription object to read", () => {
    const payload = buildSubscriptionConfirmedPayload(
      { id: "in_2", amount_paid: 1499, currency: "usd", billing_reason: "subscription_cycle" },
      null,
      { baseUrl: "https://braidbosspro.app" },
    );
    expect(payload).toMatchObject({ cardBrand: null, cardLast4: null, invoiceUrl: null });
    expect(renderSubscriptionConfirmed(payload as never).html).not.toContain("undefined");
  });
});

describe("duplicate-send protection", () => {
  it("keys on the real-world event, not the webhook delivery", () => {
    expect(dedupeKeys.trialStarted("sub_1")).toBe("stylist_trial_started:sub_1");
    expect(dedupeKeys.subscriptionConfirmed("in_1")).toBe(
      "stylist_subscription_confirmed:in_1",
    );
    // Same subscription, same trial end → same key, so a replayed
    // trial_will_end cannot produce a second reminder.
    expect(dedupeKeys.trialEnding("sub_1", 111)).toBe(dedupeKeys.trialEnding("sub_1", 111));
    // A rescheduled trial end is a genuinely new notice.
    expect(dedupeKeys.trialEnding("sub_1", 111)).not.toBe(
      dedupeKeys.trialEnding("sub_1", 222),
    );
  });

  it("keeps the reminder subject in step with the template", () => {
    const end = 1_756_209_600;
    const now = new Date((end - 3 * 86_400) * 1000);
    expect(trialEndingSubject(end, now)).toBe(
      renderTrialEnding({ trialEnd: end, now: now.getTime() }).subject,
    );
    expect(trialEndingSubject(null)).toBe("Your Braid Boss Pro trial is ending soon");
  });
});

// ---------------------------------------------------------------------
// 6. Payment failed
// ---------------------------------------------------------------------

describe("payment failed email", () => {
  const failed = {
    firstName: "Sheree",
    planLabel: "Monthly",
    amountDueMinor: 1499,
    currency: "usd",
    interval: "month",
    failedAt: 1_756_209_700,
    nextRetryAt: 1_756_555_200,
    cardBrand: "visa",
    cardLast4: "4242",
    invoiceUrl: "https://invoice.stripe.com/i/test",
    timeZone: "America/Los_Angeles",
  };

  it("states the amount due, plan, failure date, and retry date", () => {
    const r = renderPaymentFailed(failed);
    expect(r.html).toContain("$14.99");
    expect(r.html).toContain("Monthly");
    expect(r.html).toContain("Billed monthly");
    expect(r.html).toContain("August 26, 2025"); // attempted on
    expect(r.html).toContain("August 30, 2025"); // next automatic attempt
  });

  it("says when Stripe will retry", () => {
    expect(renderPaymentFailed(failed).html).toContain(
      "Stripe will automatically try again on August 30, 2025",
    );
  });

  it("does not imply another attempt once retries are exhausted", () => {
    const r = renderPaymentFailed({ ...failed, nextRetryAt: null });
    expect(r.html).toContain("finished its automatic attempts");
    expect(r.html).not.toContain("will automatically try again");
    expect(r.html).not.toContain("Next automatic attempt");
  });

  it("routes card updates through the app, never a raw billing-portal URL", () => {
    const r = renderPaymentFailed({ ...failed, manageUrl: "https://braidbosspro.app/" });
    expect(r.html).toContain("Update my payment method");
    expect(r.html).toContain('href="https://braidbosspro.app/"');
    // A portal session URL is a short-lived bearer credential and must
    // never be embedded in mail.
    expect(r.html).not.toContain("billing.stripe.com");
    expect(r.text).not.toContain("billing.stripe.com");
  });

  it("links the Stripe invoice when there is one and omits it when not", () => {
    expect(renderPaymentFailed(failed).html).toContain('href="https://invoice.stripe.com/i/test"');
    expect(renderPaymentFailed({ ...failed, invoiceUrl: null }).html).not.toContain(
      "View this invoice on Stripe",
    );
  });

  it("shows at most a masked card, never full payment details", () => {
    const r = renderPaymentFailed(failed);
    expect(r.html).toContain("Visa ending in 4242");
    expect(r.html).not.toMatch(/\b\d{13,19}\b/); // no PAN
    expect(r.html).not.toMatch(/\bcvc\b|\bcvv\b|exp_month|exp_year/i);
    expect(renderPaymentFailed({ ...failed, cardLast4: null }).html).not.toContain("Card on file");
  });

  it("uses calm, non-punitive language", () => {
    const r = renderPaymentFailed(failed);
    // Source comments are not customer copy, so strip them before
    // judging the wording. The plain-text part is checked too, since
    // that is what some clients actually display.
    const html = (r.html.replace(/<!--[\s\S]*?-->/g, "") + " " + r.text).toLowerCase();
    for (const word of [
      "urgent",
      "immediately",
      "suspended",
      "terminated",
      "failure to",
      "act now",
      "last chance",
      "overdue",
      "delinquent",
    ]) {
      expect(html.includes(word), word).toBe(false);
    }
  });

  it("tells the truth about access, which past_due preserves", () => {
    expect(renderPaymentFailed(failed).html).toContain("Your account is still open");
  });

  it("offers a human to talk to", () => {
    expect(renderPaymentFailed(failed).html).toContain("hello@braidbosspro.app");
  });

  it("still reads as a complete email with nothing supplied", () => {
    const r = renderPaymentFailed({});
    expect(r.html).toContain("Hi there,");
    expect(r.html).not.toContain("undefined");
    expect(r.html).not.toContain("null");
    expect(r.html).not.toContain("NaN");
    expect(r.html).not.toContain("$0.00");
  });
});

describe("payment failed payload", () => {
  const failedInvoice = {
    id: "in_9",
    amount_due: 1499,
    amount_paid: 0,
    attempt_count: 2,
    next_payment_attempt: 1_756_555_200,
    currency: "usd",
    created: 1_755_000_000,
    hosted_invoice_url: "https://invoice.stripe.com/i/test",
    lines: { data: [{ price: { recurring: { interval: "month" } } }] },
  };

  it("maps the invoice onto the template arguments", () => {
    const payload = buildPaymentFailedPayload(failedInvoice, subscription, {
      firstName: "Sheree",
      baseUrl: "https://braidbosspro.app",
      failedAt: 1_756_209_700,
    });
    expect(payload).toMatchObject({
      planLabel: "Monthly",
      amountDueMinor: 1499,
      nextRetryAt: 1_756_555_200,
      failedAt: 1_756_209_700,
      cardBrand: "visa",
      cardLast4: "4242",
      manageUrl: "https://braidbosspro.app/",
    });
  });

  it("prefers the event timestamp over the invoice creation date", () => {
    const withEvent = buildPaymentFailedPayload(failedInvoice, null, {
      baseUrl: "https://braidbosspro.app",
      failedAt: 1_756_209_700,
    });
    expect(withEvent.failedAt).toBe(1_756_209_700);
    const withoutEvent = buildPaymentFailedPayload(failedInvoice, null, {
      baseUrl: "https://braidbosspro.app",
    });
    expect(withoutEvent.failedAt).toBe(1_755_000_000);
  });

  it("carries no Stripe failure internals through to the template", () => {
    const noisy = {
      ...failedInvoice,
      last_payment_error: { message: "Your card was declined.", decline_code: "do_not_honor" },
      charge: { outcome: { network_status: "declined_by_network", reason: "do_not_honor" } },
    };
    const payload = buildPaymentFailedPayload(noisy as never, subscription, {
      baseUrl: "https://braidbosspro.app",
    });
    const serialized = JSON.stringify(payload);
    for (const leak of ["decline_code", "do_not_honor", "declined_by_network", "last_payment_error", "was declined"]) {
      expect(serialized.includes(leak), leak).toBe(false);
    }
    const html = renderPaymentFailed(payload as never).html;
    expect(html).not.toContain("do_not_honor");
  });

  it("reports null when Stripe scheduled no further retry", () => {
    const payload = buildPaymentFailedPayload(
      { ...failedInvoice, next_payment_attempt: null },
      null,
      { baseUrl: "https://braidbosspro.app" },
    );
    expect(payload.nextRetryAt).toBe(null);
  });

  it("keys dedupe per attempt so each retry notifies once", () => {
    expect(dedupeKeys.paymentFailed("in_9", 2)).toBe("stylist_payment_failed:in_9:2");
    expect(dedupeKeys.paymentFailed("in_9", 2)).toBe(dedupeKeys.paymentFailed("in_9", 2));
    expect(dedupeKeys.paymentFailed("in_9", 2)).not.toBe(dedupeKeys.paymentFailed("in_9", 3));
    expect(dedupeKeys.paymentFailed("in_9", null)).toBe("stylist_payment_failed:in_9:1");
  });
});
