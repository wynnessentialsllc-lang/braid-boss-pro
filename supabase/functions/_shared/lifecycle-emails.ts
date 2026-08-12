// Braid Boss Pro — account + billing lifecycle email templates.
//
// Pure render functions built on ./email-kit.ts. Shared by the Deno
// notification worker, the Next.js preview route, and the Node script
// that emits the Supabase Auth dashboard templates. Nothing here reads
// the environment or performs I/O.
//
// Copy rules followed throughout (per the brand brief):
//   • no em dashes in customer-facing copy
//   • security emails stay short and action-focused, no marketing
//   • no claim about billing, payouts, or a stored card unless the
//     caller actually supplied the data that backs it

import {
  BUSINESS,
  C,
  FONT_BODY,
  FONT_DISPLAY,
  band,
  bulletList,
  button,
  daysUntil,
  detailRows,
  document_,
  esc,
  escUrl,
  eyebrow,
  featureCards,
  fmtDate,
  footer,
  greeting,
  headline,
  masthead,
  maskedCard,
  money,
  normalizeBase,
  numberedStep,
  p,
  rule,
  textBody,
  textFooter,
  type RenderedEmail,
} from "./email-kit.ts";

// ---------------------------------------------------------------------
// Shared content
// ---------------------------------------------------------------------

/** The five setup steps, worded as they appear in the app's own flow. */
export const SETUP_STEPS: Array<{ key: string; title: string; body: string }> = [
  {
    key: "services",
    title: "Add your services",
    body: "Set your prices, appointment lengths, variations, add-ons, deposits, and contracts.",
  },
  {
    key: "availability",
    title: "Set your availability",
    body: "Choose the days and hours you want clients to see.",
  },
  {
    key: "booking_page",
    title: "Customize your booking page",
    body: "Add your business name, logo, policies, and public handle.",
  },
  {
    key: "stripe",
    title: "Connect Stripe",
    body: "Let client deposits and payments go directly to your Stripe account.",
  },
  {
    key: "share",
    title: "Share your booking link",
    body: "Add your Braid Boss Pro link to Instagram, TikTok, and anywhere clients find you.",
  },
];

const STEP_COLORS = [C.purple, C.purple, C.purple, C.purple, C.coral];

/** Why-you-got-this lines. Every template names its own trigger. */
const REASON = {
  verify: "You received this because someone used this address to create a Braid Boss Pro account.",
  reset: "You received this because a password reset was requested for this Braid Boss Pro account.",
  emailChange: "You received this because an email change was requested on this Braid Boss Pro account.",
  welcome: "You received this because you confirmed a Braid Boss Pro account with this address.",
  trial: "You received this because you started a Braid Boss Pro free trial. It is an account notice, not marketing.",
  billing: "You received this because it is a billing notice for your Braid Boss Pro subscription.",
} as const;

/**
 * Access rule this product actually implements, mirrored from
 * app/lib/guest-limits.ts: trialing, active, AND past_due all count as
 * live. That is why the failed-payment email can say the account stays
 * open during retries. If that set ever changes, this copy must too.
 */
const PAST_DUE_KEEPS_ACCESS = true;

// ---------------------------------------------------------------------
// 1. Verify your email  (Supabase Auth template)
// ---------------------------------------------------------------------

export type VerifyEmailArgs = {
  /** The auth provider's secure link. Never rewritten, never tracked. */
  confirmationUrl: string;
  firstName?: string | null;
  /** Human-readable expiry, e.g. "24 hours". Rendered verbatim. */
  expiresIn?: string | null;
  /** Show the raw link as a copy/paste fallback. */
  showFallbackUrl?: boolean;
  baseUrl?: string | null;
};

/**
 * Security email. Deliberately one screen: brand header, one sentence of
 * context, one button, the fallback link, and the ignore-this notice.
 * No feature marketing, no screenshots, no tracking wrapper on the link.
 */
export const renderVerifyEmail = (args: VerifyEmailArgs): RenderedEmail => {
  const base = normalizeBase(args.baseUrl);
  const url = args.confirmationUrl;
  const href = escUrl(url);
  const expires = String(args.expiresIn ?? "").trim();
  const subject = "Boss move pending: verify your Braid Boss Pro account";
  const preheader = "One tap and your new business dashboard is ready.";

  const expiryLine = expires
    ? `This secure link expires in ${expires}. If you did not create a Braid Boss Pro account, you can safely ignore this email and nothing will happen.`
    : "If you did not create a Braid Boss Pro account, you can safely ignore this email and nothing will happen.";

  const bands = [
    masthead(base),
    band({
      bg: C.purple,
      padding: "40px 32px 44px",
      content: [
        eyebrow("Braid Boss Pro", "rgba(255,255,255,0.82)"),
        headline("Your chair. Your clients. Your business.", {
          color: C.white,
          size: 34,
        }),
        rule(C.coral),
        p(
          `${esc(greeting(args.firstName))}, you are one step away from opening your Braid Boss Pro dashboard. Verify your email to secure your account and begin setting up the business behind your chair.`,
          { color: "rgba(255,255,255,0.92)", size: 16, margin: "22px 0 0" },
        ),
      ].join(""),
    }),
    band({
      bg: C.white,
      padding: "34px 32px 36px",
      content: [
        button({ label: "Verify my email", url, bg: C.ink, marginTop: 0 }),
        args.showFallbackUrl === false || !href
          ? ""
          : [
              p("Button not working? Paste this link into your browser:", {
                color: C.muted,
                size: 13,
                margin: "26px 0 0",
              }),
              `<p style="margin:6px 0 0;font-family:${FONT_BODY};font-size:13px;line-height:1.6;word-break:break-all;overflow-wrap:anywhere;"><a href="${href}" style="color:${C.purple};text-decoration:underline;">${esc(
                url,
              )}</a></p>`,
            ].join(""),
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:24px 0 0;"><tr><td style="height:1px;background-color:${C.hairline};font-size:0;line-height:0;">&nbsp;</td></tr></table>`,
        p(esc(expiryLine), { color: C.muted, size: 13, margin: "18px 0 0" }),
      ].join(""),
    }),
    footer({ base, reason: REASON.verify, showSignoff: false }),
  ].join("");

  const text = textBody([
    "BRAID BOSS PRO",
    "",
    "Your chair. Your clients. Your business.",
    "",
    `${greeting(args.firstName)}, you are one step away from opening your Braid Boss Pro dashboard.`,
    "Verify your email to secure your account and begin setting up the business behind your chair.",
    "",
    "Verify my email:",
    url,
    "",
    expiryLine,
    textFooter(REASON.verify),
  ]);

  return { subject, preheader, html: document_({ title: subject, preheader, bands }), text };
};

// ---------------------------------------------------------------------
// 1b. Password reset / email change  (same security shell, new copy)
// ---------------------------------------------------------------------

export type AuthActionArgs = {
  confirmationUrl: string;
  firstName?: string | null;
  expiresIn?: string | null;
  baseUrl?: string | null;
};

const securityEmail = (opts: {
  subject: string;
  preheader: string;
  eyebrowText: string;
  headlineText: string;
  bodyText: string;
  buttonLabel: string;
  ignoreText: string;
  reason: string;
  url: string;
  expiresIn?: string | null;
  baseUrl?: string | null;
}): RenderedEmail => {
  const base = normalizeBase(opts.baseUrl);
  const href = escUrl(opts.url);
  const expires = String(opts.expiresIn ?? "").trim();
  const expiryLine = expires
    ? `This secure link expires in ${expires}. ${opts.ignoreText}`
    : opts.ignoreText;

  const bands = [
    masthead(base),
    band({
      bg: C.purple,
      padding: "40px 32px 44px",
      content: [
        eyebrow(opts.eyebrowText, "rgba(255,255,255,0.82)"),
        headline(opts.headlineText, { color: C.white, size: 32 }),
        rule(C.coral),
        p(esc(opts.bodyText), {
          color: "rgba(255,255,255,0.92)",
          size: 16,
          margin: "22px 0 0",
        }),
      ].join(""),
    }),
    band({
      bg: C.white,
      padding: "34px 32px 36px",
      content: [
        button({ label: opts.buttonLabel, url: opts.url, bg: C.ink, marginTop: 0 }),
        href
          ? [
              p("Button not working? Paste this link into your browser:", {
                color: C.muted,
                size: 13,
                margin: "26px 0 0",
              }),
              `<p style="margin:6px 0 0;font-family:${FONT_BODY};font-size:13px;line-height:1.6;word-break:break-all;overflow-wrap:anywhere;"><a href="${href}" style="color:${C.purple};text-decoration:underline;">${esc(
                opts.url,
              )}</a></p>`,
            ].join("")
          : "",
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:24px 0 0;"><tr><td style="height:1px;background-color:${C.hairline};font-size:0;line-height:0;">&nbsp;</td></tr></table>`,
        p(esc(expiryLine), { color: C.muted, size: 13, margin: "18px 0 0" }),
      ].join(""),
    }),
    footer({ base, reason: opts.reason, showSignoff: false }),
  ].join("");

  const text = textBody([
    "BRAID BOSS PRO",
    "",
    opts.headlineText,
    "",
    opts.bodyText,
    "",
    `${opts.buttonLabel}:`,
    opts.url,
    "",
    expiryLine,
    textFooter(opts.reason),
  ]);

  return {
    subject: opts.subject,
    preheader: opts.preheader,
    html: document_({ title: opts.subject, preheader: opts.preheader, bands }),
    text,
  };
};

export const renderPasswordReset = (args: AuthActionArgs): RenderedEmail =>
  securityEmail({
    subject: "Reset your Braid Boss Pro password",
    preheader: "One tap to set a new password and get back to your dashboard.",
    eyebrowText: "Password reset",
    headlineText: "Let's get you back in.",
    bodyText: `${greeting(
      args.firstName,
    )}, we received a request to reset the password on your Braid Boss Pro account. Choose a new one and you are back at the controls.`,
    buttonLabel: "Reset my password",
    ignoreText:
      "If you did not request a password reset, you can safely ignore this email and your password will stay exactly as it is.",
    reason: REASON.reset,
    url: args.confirmationUrl,
    expiresIn: args.expiresIn,
    baseUrl: args.baseUrl,
  });

export const renderEmailChange = (args: AuthActionArgs): RenderedEmail =>
  securityEmail({
    subject: "Confirm your new Braid Boss Pro email address",
    preheader: "Confirm this address to finish updating your account.",
    eyebrowText: "Email change",
    headlineText: "Confirm your new address.",
    bodyText: `${greeting(
      args.firstName,
    )}, a request was made to change the email address on your Braid Boss Pro account. Confirm it here so your account notices and booking alerts reach the right inbox.`,
    buttonLabel: "Confirm this address",
    ignoreText:
      "If you did not request this change, you can safely ignore this email and your address will stay exactly as it is.",
    reason: REASON.emailChange,
    url: args.confirmationUrl,
    expiresIn: args.expiresIn,
    baseUrl: args.baseUrl,
  });

// ---------------------------------------------------------------------
// 2. Welcome and account confirmed
// ---------------------------------------------------------------------

export type WelcomeArgs = {
  firstName?: string | null;
  /** Where "Open my dashboard" points. Defaults to the app root. */
  dashboardUrl?: string | null;
  /** Where "Finish my setup" points. Defaults to the dashboard. */
  setupUrl?: string | null;
  /** Setup step keys already done, e.g. ["services"]. Optional. */
  completed?: string[] | null;
  baseUrl?: string | null;
};

/** The dashboard-at-a-glance card. Describes the product, invents no data. */
const glanceCard = (dashboardUrl: string): string => {
  const row = (accent: string, title: string, body: string, last = false) => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
      <tr>
        <td width="4" style="width:4px;background-color:${accent};border-radius:2px;font-size:0;line-height:0;">&nbsp;</td>
        <td style="padding:0 0 ${last ? "0" : "14px"} 14px;">
          <p style="margin:0;font-family:${FONT_BODY};font-size:15px;line-height:1.35;font-weight:700;color:${C.ink};">${esc(
            title,
          )}</p>
          <p style="margin:3px 0 0;font-family:${FONT_BODY};font-size:13px;line-height:1.5;color:${C.body};">${esc(
            body,
          )}</p>
        </td>
      </tr>
    </table>`;

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
    <tr>
      <td bgcolor="${C.white}" style="background-color:${C.white};border-radius:14px;padding:22px 22px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="font-family:${FONT_DISPLAY};font-size:21px;line-height:1.2;color:${C.ink};">Your dashboard</td>
            <td align="right" style="font-family:${FONT_BODY};font-size:12px;line-height:1.4;color:${C.muted};text-align:right;">Ready now</td>
          </tr>
          <tr><td colspan="2" style="padding:14px 0 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;"><tr><td style="height:1px;background-color:${C.hairline};font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>
          <tr><td colspan="2" style="padding:16px 0 0;">
            ${row(C.purple, "Calendar and bookings", "Requests, approvals, and every appointment in one place.")}
            ${row(C.lavender, "Deposits and payments", "Quote, collect, and reconcile in one flow.")}
            ${row(C.coral, "Clients and contracts", "Every client, every visit, every dollar.", true)}
          </td></tr>
        </table>
        ${button({ label: "Open dashboard", url: dashboardUrl, bg: C.purple, marginTop: 22 })}
      </td>
    </tr>
  </table>`;
};

export const renderWelcome = (args: WelcomeArgs): RenderedEmail => {
  const base = normalizeBase(args.baseUrl);
  const dashboardUrl = String(args.dashboardUrl || "").trim() || `${base}/`;
  const setupUrl = String(args.setupUrl || "").trim() || dashboardUrl;
  const done = new Set((args.completed || []).map((k) => String(k)));

  const subject = "Welcome to Braid Boss Pro. Let's set up your business.";
  const preheader = "Your dashboard is ready. Your booking link is next.";

  const steps = SETUP_STEPS.map((step, i) =>
    numberedStep({
      index: i + 1,
      title: done.has(step.key) ? `${step.title} (done)` : step.title,
      body: step.body,
      color: done.has(step.key) ? C.success : STEP_COLORS[i] || C.purple,
      last: i === SETUP_STEPS.length - 1,
    }),
  ).join("");

  const bands = [
    masthead(base),
    // Hero
    band({
      bg: C.purple,
      padding: "40px 32px 46px",
      content: [
        eyebrow("Account confirmed", "rgba(255,255,255,0.82)"),
        headline("Welcome to the boss side of braiding.", {
          color: C.white,
          size: 38,
        }),
        rule(C.coral),
        p(
          `${esc(
            greeting(args.firstName),
          )}, your Braid Boss Pro account is ready. You now have one place to organize your services, calendar, clients, policies, deposits, contracts, and the money moving through your business.`,
          { color: "rgba(255,255,255,0.92)", size: 16, margin: "22px 0 0" },
        ),
      ].join(""),
    }),
    // Dashboard at a glance
    band({
      bg: C.ink,
      padding: "32px 32px 34px",
      content: [
        eyebrow("Your business at a glance", "rgba(255,255,255,0.65)"),
        glanceCard(dashboardUrl),
      ].join(""),
    }),
    // Five steps
    band({
      bg: C.white,
      padding: "38px 32px 40px",
      content: [
        eyebrow("From sign-up to booked", C.purple),
        headline("Five steps to go live.", { size: 32 }),
        p("Set it up once. Let your booking system do the rest.", {
          color: C.body,
          size: 15,
          margin: "10px 0 26px",
        }),
        steps,
        button({ label: "Finish my setup", url: setupUrl, bg: C.ink, marginTop: 30 }),
      ].join(""),
    }),
    // Built for braiders
    band({
      bg: C.gold,
      padding: "38px 32px 38px",
      content: [
        eyebrow("Built around the braid chair", C.ink),
        headline("Built for the way braiders actually work.", { size: 31 }),
        p(
          "Long appointments. Hair-included pricing. Deposits. Service variations. Client notes. Contracts. Retail. Braid Boss Pro brings the pieces together so you can spend less time piecing together your business.",
          { color: C.ink, size: 15, margin: "14px 0 24px" },
        ),
        featureCards([
          { label: "Bookings", body: "One clean link." },
          { label: "Deposits", body: "Paid up front." },
          { label: "Contracts", body: "Signed on the phone." },
        ]),
      ].join(""),
    }),
    // Closer
    band({
      bg: C.tint,
      padding: "38px 32px 40px",
      align: "center",
      content: [
        eyebrow("The next boss move", C.purple),
        headline("Create the link that books you.", { size: 30, align: "center" }),
        p("Your dashboard is open. Your clients can be next.", {
          color: C.body,
          size: 15,
          margin: "12px 0 0",
          align: "center",
        }),
        button({
          label: "Open Braid Boss Pro",
          url: dashboardUrl,
          bg: C.purple,
          align: "center",
          marginTop: 24,
        }),
      ].join(""),
    }),
    footer({ base, reason: REASON.welcome }),
  ].join("");

  const text = textBody([
    "BRAID BOSS PRO / ACCOUNT CONFIRMED",
    "",
    "Welcome to the boss side of braiding.",
    "",
    `${greeting(
      args.firstName,
    )}, your Braid Boss Pro account is ready. You now have one place to organize your services, calendar, clients, policies, deposits, contracts, and the money moving through your business.`,
    "",
    `Open my dashboard: ${dashboardUrl}`,
    "",
    "FIVE STEPS TO GO LIVE",
    ...SETUP_STEPS.map(
      (s, i) => `${i + 1}. ${s.title}${done.has(s.key) ? " (done)" : ""}\n   ${s.body}`,
    ),
    "",
    `Finish my setup: ${setupUrl}`,
    "",
    "Built for the way braiders actually work. Long appointments. Hair-included pricing. Deposits. Service variations. Client notes. Contracts. Retail.",
    "",
    BUSINESS.signoff,
    textFooter(REASON.welcome),
  ]);

  return { subject, preheader, html: document_({ title: subject, preheader, bands }), text };
};

// ---------------------------------------------------------------------
// 3. Free trial started
// ---------------------------------------------------------------------

export type TrialStartedArgs = {
  firstName?: string | null;
  /** "Monthly" / "Annual". Derived from the live Stripe subscription. */
  planLabel?: string | null;
  trialStart?: string | number | Date | null;
  trialEnd?: string | number | Date | null;
  /** Minor units, e.g. 1499. Omit to leave the amount row out. */
  amountAfterTrialMinor?: number | null;
  currency?: string | null;
  /** "month" | "year". Only used to render "/month" or "/year". */
  interval?: string | null;
  cardBrand?: string | null;
  cardLast4?: string | null;
  timeZone?: string | null;
  dashboardUrl?: string | null;
  setupUrl?: string | null;
  /** Only true when the account really has Stripe Connect wired up. */
  stripeConnectActive?: boolean | null;
  completed?: string[] | null;
  baseUrl?: string | null;
  /** Reference instant for "days remaining". Defaults to now. */
  now?: string | number | Date | null;
};

const intervalSuffix = (interval?: string | null): string => {
  const i = String(interval ?? "").trim().toLowerCase();
  if (i === "year" || i === "annual" || i === "yearly") return "/year";
  if (i === "month" || i === "monthly") return "/month";
  return "";
};

export const renderTrialStarted = (args: TrialStartedArgs): RenderedEmail => {
  const base = normalizeBase(args.baseUrl);
  const dashboardUrl = String(args.dashboardUrl || "").trim() || `${base}/`;
  const setupUrl = String(args.setupUrl || "").trim() || dashboardUrl;
  const trialEndLabel = fmtDate(args.trialEnd, args.timeZone);
  const trialStartLabel = fmtDate(args.trialStart, args.timeZone);
  const amount =
    args.amountAfterTrialMinor === null || args.amountAfterTrialMinor === undefined
      ? ""
      : `${money(args.amountAfterTrialMinor, args.currency || "usd")}${intervalSuffix(
          args.interval,
        )}`;
  const card = maskedCard(args.cardBrand, args.cardLast4);
  const days = daysUntil(args.trialEnd, args.now);

  const subject = "Your 14-day Braid Boss Pro trial has started";
  const preheader = "Every feature is open. Here is what to do first.";

  const openingCopy = trialEndLabel
    ? `${greeting(
        args.firstName,
      )}, your Braid Boss Pro free trial is active through ${trialEndLabel}. Every feature is unlocked, so you can set up your business, share your booking page, take real appointments, and explore the full platform before your first subscription payment.`
    : `${greeting(
        args.firstName,
      )}, your Braid Boss Pro free trial is active. Every feature is unlocked, so you can set up your business, share your booking page, take real appointments, and explore the full platform before your first subscription payment.`;

  const done = new Set((args.completed || []).map((k) => String(k)));
  const firstActions = [
    "Add at least one service",
    "Set your availability",
    "Create your public booking handle",
    "Connect Stripe",
    "Put your booking link in your Instagram and TikTok bios",
    "Install Braid Boss Pro on your phone home screen",
  ];
  const remaining = SETUP_STEPS.filter((s) => !done.has(s.key));

  const bands = [
    masthead(base),
    band({
      bg: C.purple,
      padding: "40px 32px 46px",
      content: [
        eyebrow("Your free trial is active", "rgba(255,255,255,0.82)"),
        headline("Fourteen days. Every feature. Let's get you booked.", {
          color: C.white,
          size: 36,
        }),
        rule(C.coral),
        p(esc(openingCopy), {
          color: "rgba(255,255,255,0.92)",
          size: 16,
          margin: "22px 0 0",
        }),
      ].join(""),
    }),
    // Trial details
    band({
      bg: C.ink,
      padding: "32px 32px 34px",
      content: [
        eyebrow("Your trial", "rgba(255,255,255,0.65)"),
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
          <tr><td bgcolor="${C.white}" style="background-color:${C.white};border-radius:14px;padding:22px;">
            ${detailRows([
              ["Plan", args.planLabel || ""],
              ["Trial started", trialStartLabel],
              ["Trial ends", trialEndLabel],
              ["Amount after trial", amount],
              ["Payment method", card],
            ])}
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:16px 0 0;"><tr><td style="height:1px;background-color:${C.hairline};font-size:0;line-height:0;">&nbsp;</td></tr></table>
            ${p(
              "Cancel anytime from Account then Manage subscription inside Braid Boss Pro.",
              { color: C.muted, size: 13, margin: "14px 0 0" },
            )}
          </td></tr>
        </table>`,
      ].join(""),
    }),
    // First actions
    band({
      bg: C.white,
      padding: "38px 32px 40px",
      content: [
        eyebrow("Start here", C.purple),
        headline(
          days && days > 0 ? `Your first ${days === 1 ? "day" : "few days"}, sorted.` : "Your first few days, sorted.",
          { size: 31 },
        ),
        p("Do these in order and your booking link is live before the week is out.", {
          color: C.body,
          size: 15,
          margin: "10px 0 22px",
        }),
        bulletList(firstActions),
        button({ label: "Start my setup", url: setupUrl, bg: C.ink, marginTop: 28 }),
      ].join(""),
    }),
    // What is left, only when we actually know
    remaining.length > 0 && done.size > 0
      ? band({
          bg: C.tintSoft,
          padding: "30px 32px 32px",
          content: [
            eyebrow("Still to do", C.purple),
            bulletList(remaining.map((s) => s.title)),
          ].join(""),
        })
      : "",
    // Money reassurance, only when Connect is genuinely wired
    args.stripeConnectActive
      ? band({
          bg: C.gold,
          padding: "32px 32px 34px",
          content: [
            eyebrow("Your money", C.ink),
            headline("Your payments land in your account.", { size: 27 }),
            p(
              "Your clients' deposits and payments are charged on your own connected Stripe account and pay out to your bank on your Stripe schedule. Braid Boss Pro does not hold your money.",
              { color: C.ink, size: 15, margin: "12px 0 0" },
            ),
          ].join(""),
        })
      : "",
    band({
      bg: C.tint,
      padding: "34px 32px 38px",
      align: "center",
      content: [
        headline("From sign-up to deposits in under 10 minutes.", {
          size: 27,
          align: "center",
        }),
        button({
          label: "Open Braid Boss Pro",
          url: dashboardUrl,
          bg: C.purple,
          align: "center",
          marginTop: 22,
        }),
      ].join(""),
    }),
    footer({ base, reason: REASON.trial }),
  ]
    .filter(Boolean)
    .join("");

  const text = textBody([
    "BRAID BOSS PRO / YOUR FREE TRIAL IS ACTIVE",
    "",
    "Fourteen days. Every feature. Let's get you booked.",
    "",
    openingCopy,
    "",
    "YOUR TRIAL",
    args.planLabel ? `Plan: ${args.planLabel}` : "",
    trialStartLabel ? `Trial started: ${trialStartLabel}` : "",
    trialEndLabel ? `Trial ends: ${trialEndLabel}` : "",
    amount ? `Amount after trial: ${amount}` : "",
    card ? `Payment method: ${card}` : "",
    "Cancel anytime from Account then Manage subscription inside Braid Boss Pro.",
    "",
    "START HERE",
    ...firstActions.map((a) => `- ${a}`),
    "",
    `Start my setup: ${setupUrl}`,
    args.stripeConnectActive
      ? "\nYour clients' deposits and payments are charged on your own connected Stripe account and pay out to your bank on your Stripe schedule. Braid Boss Pro does not hold your money."
      : "",
    "",
    `Open Braid Boss Pro: ${dashboardUrl}`,
    textFooter(REASON.trial),
  ]);

  return { subject, preheader, html: document_({ title: subject, preheader, bands }), text };
};

// ---------------------------------------------------------------------
// 4. Trial ending soon
// ---------------------------------------------------------------------

export type TrialEndingArgs = {
  firstName?: string | null;
  planLabel?: string | null;
  trialEnd?: string | number | Date | null;
  amountMinor?: number | null;
  currency?: string | null;
  interval?: string | null;
  cardBrand?: string | null;
  cardLast4?: string | null;
  /** True when the subscription is already set to stop at trial end. */
  cancelAtPeriodEnd?: boolean | null;
  timeZone?: string | null;
  dashboardUrl?: string | null;
  /** Where the recipient manages or cancels. Defaults to the app root. */
  manageUrl?: string | null;
  baseUrl?: string | null;
  /** Reference instant for "days remaining". Defaults to now. */
  now?: string | number | Date | null;
};

export const renderTrialEnding = (args: TrialEndingArgs): RenderedEmail => {
  const base = normalizeBase(args.baseUrl);
  const dashboardUrl = String(args.dashboardUrl || "").trim() || `${base}/`;
  const manageUrl = String(args.manageUrl || "").trim() || dashboardUrl;
  const endLabel = fmtDate(args.trialEnd, args.timeZone);
  const days = daysUntil(args.trialEnd, args.now);
  const amount =
    args.amountMinor === null || args.amountMinor === undefined
      ? ""
      : `${money(args.amountMinor, args.currency || "usd")}${intervalSuffix(args.interval)}`;
  const card = maskedCard(args.cardBrand, args.cardLast4);
  const cancelling = args.cancelAtPeriodEnd === true;

  const subject =
    days === null
      ? "Your Braid Boss Pro trial is ending soon"
      : days === 0
        ? "Your Braid Boss Pro trial ends today"
        : `Your Braid Boss Pro trial ends in ${days} ${days === 1 ? "day" : "days"}`;
  const preheader = "Your dashboard and setup are waiting. Here is what happens next.";

  const bodyCopy = cancelling
    ? `${greeting(args.firstName)}, your Braid Boss Pro trial ends${
        endLabel ? ` on ${endLabel}` : " soon"
      }. Your subscription is currently set to stop at the end of the trial, so no payment will be taken. You can turn it back on any time before then and keep everything you have set up.`
    : `${greeting(args.firstName)}, your Braid Boss Pro trial ends${
        endLabel ? ` on ${endLabel}` : " soon"
      }. After that, your${args.planLabel ? ` ${args.planLabel}` : ""} subscription will begin${
        amount ? ` at ${amount}` : ""
      }, unless you cancel before the trial ends.`;

  const bands = [
    masthead(base),
    band({
      bg: C.purple,
      padding: "40px 32px 46px",
      content: [
        eyebrow("Trial update", "rgba(255,255,255,0.82)"),
        headline("Keep the business behind your chair moving.", {
          color: C.white,
          size: 35,
        }),
        rule(C.coral),
        p(esc(bodyCopy), {
          color: "rgba(255,255,255,0.92)",
          size: 16,
          margin: "22px 0 0",
        }),
      ].join(""),
    }),
    band({
      bg: C.ink,
      padding: "32px 32px 34px",
      content: [
        eyebrow("What happens next", "rgba(255,255,255,0.65)"),
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
          <tr><td bgcolor="${C.white}" style="background-color:${C.white};border-radius:14px;padding:22px;">
            ${detailRows([
              ["Trial ends", endLabel],
              ["Plan", args.planLabel || ""],
              [cancelling ? "Amount if you continue" : "Upcoming amount", amount],
              ["Billing interval", intervalLabel(args.interval)],
              ["Payment method", card],
            ])}
          </td></tr>
        </table>`,
      ].join(""),
    }),
    band({
      bg: C.white,
      padding: "36px 32px 38px",
      content: [
        headline("Everything you set up stays put.", { size: 29 }),
        p(
          "Your services, availability, booking page, clients, contracts, and history are all exactly where you left them.",
          { color: C.body, size: 15, margin: "12px 0 0" },
        ),
        button({
          label: "Continue with Braid Boss Pro",
          url: dashboardUrl,
          bg: C.ink,
          marginTop: 26,
        }),
        `<p style="margin:18px 0 0;font-family:${FONT_BODY};font-size:14px;line-height:1.6;"><a href="${escUrl(
          manageUrl,
        )}" style="color:${C.purple};text-decoration:underline;">Manage or cancel my subscription</a></p>`,
        p(
          "Manage subscription lives inside Braid Boss Pro under Account. It opens the Stripe billing portal, where you can update your card or cancel in one tap.",
          { color: C.muted, size: 13, margin: "8px 0 0" },
        ),
      ].join(""),
    }),
    footer({ base, reason: REASON.billing }),
  ].join("");

  const text = textBody([
    "BRAID BOSS PRO / TRIAL UPDATE",
    "",
    "Keep the business behind your chair moving.",
    "",
    bodyCopy,
    "",
    "WHAT HAPPENS NEXT",
    endLabel ? `Trial ends: ${endLabel}` : "",
    args.planLabel ? `Plan: ${args.planLabel}` : "",
    amount ? `${cancelling ? "Amount if you continue" : "Upcoming amount"}: ${amount}` : "",
    intervalLabel(args.interval) ? `Billing interval: ${intervalLabel(args.interval)}` : "",
    card ? `Payment method: ${card}` : "",
    "",
    `Continue with Braid Boss Pro: ${dashboardUrl}`,
    `Manage or cancel my subscription: ${manageUrl}`,
    "Manage subscription lives inside Braid Boss Pro under Account.",
    textFooter(REASON.billing),
  ]);

  return { subject, preheader, html: document_({ title: subject, preheader, bands }), text };
};

const intervalLabel = (interval?: string | null): string => {
  const i = String(interval ?? "").trim().toLowerCase();
  if (i === "year" || i === "annual" || i === "yearly") return "Billed yearly";
  if (i === "month" || i === "monthly") return "Billed monthly";
  return "";
};

// ---------------------------------------------------------------------
// 5. Subscription confirmed / payment received
// ---------------------------------------------------------------------

export type SubscriptionConfirmedArgs = {
  firstName?: string | null;
  /**
   * "first" renders the welcome-to-the-club confirmation. "renewal"
   * renders the same layout as a receipt for a later billing cycle, so
   * one template covers both without a second email system.
   */
  mode?: "first" | "renewal" | null;
  planLabel?: string | null;
  amountPaidMinor?: number | null;
  currency?: string | null;
  interval?: string | null;
  paidAt?: string | number | Date | null;
  nextBillingDate?: string | number | Date | null;
  cardBrand?: string | null;
  cardLast4?: string | null;
  /** Stripe-hosted invoice or receipt URL. Omitted when absent. */
  invoiceUrl?: string | null;
  timeZone?: string | null;
  dashboardUrl?: string | null;
  manageUrl?: string | null;
  baseUrl?: string | null;
};

export const renderSubscriptionConfirmed = (
  args: SubscriptionConfirmedArgs,
): RenderedEmail => {
  const base = normalizeBase(args.baseUrl);
  const dashboardUrl = String(args.dashboardUrl || "").trim() || `${base}/`;
  const manageUrl = String(args.manageUrl || "").trim() || dashboardUrl;
  const renewal = args.mode === "renewal";
  const amount = money(args.amountPaidMinor, args.currency || "usd");
  const card = maskedCard(args.cardBrand, args.cardLast4);
  const paidLabel = fmtDate(args.paidAt, args.timeZone);
  const nextLabel = fmtDate(args.nextBillingDate, args.timeZone);
  const invoice = escUrl(args.invoiceUrl);

  const subject = renewal
    ? "Your Braid Boss Pro payment went through"
    : "You're officially a Braid Boss Pro";
  const preheader = renewal
    ? "Receipt inside. Your subscription stays active."
    : "Your subscription is active and your business tools are ready.";

  const bodyCopy = renewal
    ? `${greeting(args.firstName)}, thank you. Your Braid Boss Pro subscription payment went through and your account stays active. Your receipt is below.`
    : `${greeting(
        args.firstName,
      )}, your Braid Boss Pro subscription is active. Your booking, payments, contracts, clients, storefront, reminders, and business tools are ready whenever you are.`;

  const bands = [
    masthead(base),
    band({
      bg: C.purple,
      padding: "40px 32px 46px",
      content: [
        eyebrow(renewal ? "Payment received" : "Subscription confirmed", "rgba(255,255,255,0.82)"),
        headline(renewal ? "Your system keeps running." : "Your business has a system now.", {
          color: C.white,
          size: 36,
        }),
        rule(C.coral),
        p(esc(bodyCopy), {
          color: "rgba(255,255,255,0.92)",
          size: 16,
          margin: "22px 0 0",
        }),
      ].join(""),
    }),
    band({
      bg: C.ink,
      padding: "32px 32px 34px",
      content: [
        eyebrow(renewal ? "Your receipt" : "Your subscription", "rgba(255,255,255,0.65)"),
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
          <tr><td bgcolor="${C.white}" style="background-color:${C.white};border-radius:14px;padding:22px;">
            ${detailRows([
              ["Plan", args.planLabel || ""],
              ["Amount paid", amount],
              ["Billing interval", intervalLabel(args.interval)],
              ["Payment date", paidLabel],
              ["Next billing date", nextLabel],
              ["Payment method", card],
            ])}
            ${
              invoice
                ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:16px 0 0;"><tr><td style="height:1px;background-color:${C.hairline};font-size:0;line-height:0;">&nbsp;</td></tr></table>
                   <p style="margin:14px 0 0;font-family:${FONT_BODY};font-size:14px;line-height:1.6;word-break:break-word;overflow-wrap:anywhere;"><a href="${invoice}" style="color:${C.purple};text-decoration:underline;font-weight:700;">View or download your receipt</a></p>`
                : ""
            }
          </td></tr>
        </table>`,
      ].join(""),
    }),
    band({
      bg: C.white,
      padding: "36px 32px 38px",
      content: [
        headline(
          renewal ? "Everything stays exactly where it is." : "Run your braid business like a brand.",
          { size: 29 },
        ),
        p(
          renewal
            ? "Your services, calendar, clients, contracts, and payment history carry on without a break."
            : "Set the rules once. Hold the line every time. Your booking page, deposits, contracts, and reminders keep working while you are in the chair.",
          { color: C.body, size: 15, margin: "12px 0 0" },
        ),
        button({
          label: "Open Braid Boss Pro",
          url: dashboardUrl,
          bg: C.ink,
          marginTop: 26,
        }),
        `<p style="margin:18px 0 0;font-family:${FONT_BODY};font-size:14px;line-height:1.6;"><a href="${escUrl(
          manageUrl,
        )}" style="color:${C.purple};text-decoration:underline;">Manage my subscription</a></p>`,
        p("Account then Manage subscription opens the Stripe billing portal.", {
          color: C.muted,
          size: 13,
          margin: "8px 0 0",
        }),
      ].join(""),
    }),
    band({
      bg: C.tint,
      padding: "32px 32px 36px",
      align: "center",
      content: headline(
        "You bring the talent. Braid Boss Pro helps run the business around it.",
        { size: 25, align: "center" },
      ),
    }),
    footer({ base, reason: REASON.billing }),
  ].join("");

  const text = textBody([
    `BRAID BOSS PRO / ${renewal ? "PAYMENT RECEIVED" : "SUBSCRIPTION CONFIRMED"}`,
    "",
    renewal ? "Your system keeps running." : "Your business has a system now.",
    "",
    bodyCopy,
    "",
    renewal ? "YOUR RECEIPT" : "YOUR SUBSCRIPTION",
    args.planLabel ? `Plan: ${args.planLabel}` : "",
    amount ? `Amount paid: ${amount}` : "",
    intervalLabel(args.interval) ? `Billing interval: ${intervalLabel(args.interval)}` : "",
    paidLabel ? `Payment date: ${paidLabel}` : "",
    nextLabel ? `Next billing date: ${nextLabel}` : "",
    card ? `Payment method: ${card}` : "",
    args.invoiceUrl ? `Receipt: ${args.invoiceUrl}` : "",
    "",
    `Open Braid Boss Pro: ${dashboardUrl}`,
    `Manage my subscription: ${manageUrl}`,
    "",
    "You bring the talent. Braid Boss Pro helps run the business around it.",
    textFooter(REASON.billing),
  ]);

  return { subject, preheader, html: document_({ title: subject, preheader, bands }), text };
};

// ---------------------------------------------------------------------
// 6. Payment failed
// ---------------------------------------------------------------------

export type PaymentFailedArgs = {
  firstName?: string | null;
  planLabel?: string | null;
  /** Minor units still owed on the invoice. */
  amountDueMinor?: number | null;
  currency?: string | null;
  interval?: string | null;
  /** When the attempt failed. */
  failedAt?: string | number | Date | null;
  /**
   * Stripe's next automatic retry. Null means Stripe has finished
   * retrying, which changes the copy: we say so plainly instead of
   * implying another attempt is coming.
   */
  nextRetryAt?: string | number | Date | null;
  cardBrand?: string | null;
  cardLast4?: string | null;
  /**
   * Stripe-hosted invoice page. Optional. Stripe issues these to be
   * emailed, and it is the one link that lets a stylist settle the
   * invoice without signing in first.
   */
  invoiceUrl?: string | null;
  timeZone?: string | null;
  /**
   * Where the recipient updates the card. This is the APP, not a raw
   * billing-portal session URL: portal sessions are short-lived bearer
   * credentials, so mailing one would both break by the time many
   * people open it and hand anyone with the message full access to the
   * billing account. The app creates a fresh, authenticated portal
   * session on tap instead.
   */
  manageUrl?: string | null;
  baseUrl?: string | null;
};

/**
 * Dunning notice.
 *
 * Rules this template holds to:
 *   • calm and direct. No countdown pressure, no threat, no red alarm
 *     styling. A declined card is usually a bank hold or an expiry, not
 *     a crisis, and the recipient is a business owner mid-appointment.
 *   • no Stripe internals. Decline codes, `last_payment_error` strings,
 *     network responses, and failure reasons are never rendered. They
 *     are noise to the reader and leak processor detail into an inbox.
 *   • no payment details beyond a masked brand and last four, and only
 *     when the caller supplied them.
 *   • no claim about losing access beyond what the app truly does.
 */
export const renderPaymentFailed = (args: PaymentFailedArgs): RenderedEmail => {
  const base = normalizeBase(args.baseUrl);
  const manageUrl = String(args.manageUrl || "").trim() || `${base}/`;
  const amount = money(args.amountDueMinor, args.currency || "usd");
  const card = maskedCard(args.cardBrand, args.cardLast4);
  const failedLabel = fmtDate(args.failedAt, args.timeZone);
  const retryLabel = fmtDate(args.nextRetryAt, args.timeZone);
  const invoice = escUrl(args.invoiceUrl);

  const subject = "We could not process your Braid Boss Pro payment";
  const preheader = "Your account is still open. Update your card when you get a minute.";

  const bodyCopy = `${greeting(
    args.firstName,
  )}, your bank did not approve the latest payment for your Braid Boss Pro subscription${
    amount ? ` of ${amount}` : ""
  }. This happens often, usually an expired card or a routine hold, and it is quick to sort out.`;

  const retryCopy = retryLabel
    ? `Stripe will automatically try again on ${retryLabel}. If you update your card before then, the next attempt uses the new one.`
    : "Stripe has finished its automatic attempts on this invoice, so the next step is yours: update your card and the balance is settled.";

  const accessCopy = PAST_DUE_KEEPS_ACCESS
    ? "Your account is still open in the meantime. Your booking page, calendar, clients, and payments all keep working while this is sorted."
    : "";

  const bands = [
    masthead(base),
    band({
      bg: C.purple,
      padding: "40px 32px 46px",
      content: [
        eyebrow("Payment update", "rgba(255,255,255,0.82)"),
        headline("Your card needs a quick update.", { color: C.white, size: 35 }),
        rule(C.coral),
        p(esc(bodyCopy), {
          color: "rgba(255,255,255,0.92)",
          size: 16,
          margin: "22px 0 0",
        }),
      ].join(""),
    }),
    band({
      bg: C.ink,
      padding: "32px 32px 34px",
      content: [
        eyebrow("What we tried", "rgba(255,255,255,0.65)"),
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
          <tr><td bgcolor="${C.white}" style="background-color:${C.white};border-radius:14px;padding:22px;">
            ${detailRows([
              ["Plan", args.planLabel || ""],
              ["Amount due", amount],
              ["Billing interval", intervalLabel(args.interval)],
              ["Attempted on", failedLabel],
              ["Next automatic attempt", retryLabel],
              ["Card on file", card],
            ])}
          </td></tr>
        </table>`,
      ].join(""),
    }),
    band({
      bg: C.white,
      padding: "36px 32px 38px",
      content: [
        headline("Two minutes and you are back to normal.", { size: 29 }),
        p(esc(retryCopy), { color: C.body, size: 15, margin: "12px 0 0" }),
        accessCopy ? p(esc(accessCopy), { color: C.body, size: 15, margin: "12px 0 0" }) : "",
        button({
          label: "Update my payment method",
          url: manageUrl,
          bg: C.ink,
          marginTop: 26,
        }),
        p(
          "That opens Braid Boss Pro. Go to Account then Manage subscription to reach the Stripe billing portal, where you can change your card. We do not put a billing link in an email, so nobody but you can open your billing account.",
          { color: C.muted, size: 13, margin: "16px 0 0" },
        ),
        invoice
          ? `<p style="margin:16px 0 0;font-family:${FONT_BODY};font-size:14px;line-height:1.6;word-break:break-word;overflow-wrap:anywhere;"><a href="${invoice}" style="color:${C.purple};text-decoration:underline;font-weight:700;">View this invoice on Stripe</a></p>`
          : "",
      ].join(""),
    }),
    band({
      bg: C.tint,
      padding: "30px 32px 34px",
      align: "center",
      content: [
        p(
          `Something not adding up? Reply to this email or write to <a href="mailto:${BUSINESS.supportEmail}" style="color:${C.purple};text-decoration:underline;">${BUSINESS.supportEmail}</a> and a person will help.`,
          { color: C.body, size: 15, margin: "0", align: "center" },
        ),
      ].join(""),
    }),
    footer({ base, reason: REASON.billing }),
  ].join("");

  const text = textBody([
    "BRAID BOSS PRO / PAYMENT UPDATE",
    "",
    "Your card needs a quick update.",
    "",
    bodyCopy,
    "",
    "WHAT WE TRIED",
    args.planLabel ? `Plan: ${args.planLabel}` : "",
    amount ? `Amount due: ${amount}` : "",
    intervalLabel(args.interval) ? `Billing interval: ${intervalLabel(args.interval)}` : "",
    failedLabel ? `Attempted on: ${failedLabel}` : "",
    retryLabel ? `Next automatic attempt: ${retryLabel}` : "",
    card ? `Card on file: ${card}` : "",
    "",
    retryCopy,
    accessCopy,
    "",
    `Update my payment method: ${manageUrl}`,
    "Go to Account then Manage subscription to reach the Stripe billing portal.",
    args.invoiceUrl ? `View this invoice on Stripe: ${args.invoiceUrl}` : "",
    "",
    `Questions? ${BUSINESS.supportEmail}`,
    textFooter(REASON.billing),
  ]);

  return { subject, preheader, html: document_({ title: subject, preheader, bands }), text };
};
