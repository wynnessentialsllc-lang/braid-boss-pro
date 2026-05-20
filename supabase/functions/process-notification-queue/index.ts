// Edge Function: process-notification-queue
//
// Phase B12.1a — email dispatch worker.
//
// Each invocation atomically claims a batch of due notification_queue
// rows via mark_notification_processing (SELECT ... FOR UPDATE SKIP
// LOCKED), renders the appropriate email template from the row's
// notification_type + payload, sends through Resend, and records the
// outcome via mark_notification_sent / mark_notification_failed.
//
// Architecture invariants (do not redesign without updating the
// docs in docs/b12_1_notification_architecture.md):
//   1. Multi-worker safe — the claim path locks each row.
//   2. Idempotent — retried Stripe-style invocations cannot
//      re-send a row that's already in 'sent' / terminal 'failed'.
//   3. Worker-rendered — templates live inside the worker. The
//      app only enqueues the raw template data on `payload`. Old
//      enqueue rows that include `payload.html` are still
//      honored for backward compat.
//   4. Channel: email only in B12.1a. SMS rows are terminal-failed.
//
// Invocation:
//   * Manual: POST <fn URL> with bearer service-role
//   * Future: pg_cron or Vercel cron, every 60 seconds. Not
//     configured in this phase; see docs/b12_1a_deploy.md.

// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// =====================================================================
// Env
// =====================================================================
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "";
const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER") || "";

const BATCH_LIMIT = 25;
const RESEND_ENDPOINT = "https://api.resend.com/emails";

// =====================================================================
// Types — must mirror the column shape returned by
// mark_notification_processing.
// =====================================================================
type ClaimedRow = {
  id: string;
  user_id: string;
  channel: "email" | "sms";
  notification_type: string;
  recipient_email: string | null;
  recipient_phone: string | null;
  recipient_name: string | null;
  subject: string | null;
  body: string;
  payload: Record<string, any>;
  scheduled_for: string;
  status: string;
  retry_count: number;
  dedupe_key: string | null;
  booking_request_id: string | null;
  appointment_id: string | null;
  client_id: string | null;
  contract_id: string | null;
};

// =====================================================================
// Renderers — warm cream / gold / espresso palette. Single inline
// stylesheet, no external CSS, mobile-safe layout. Templates avoid
// images and webfonts so they render cleanly across every client.
// =====================================================================
const C = {
  espresso: "#1F140A",
  coffee: "#4A2C1A",
  cream: "#FAF6EE",
  paper: "#FFFFFF",
  hairline: "#E9DFC8",
  muted: "#9A8B72",
  gold: "#C9A961",
  goldDeep: "#A8893F",
};

const escape = (s: unknown): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const wrapHtml = (title: string, body: string): string => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title></head>
<body style="margin:0;background:${C.cream};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${C.espresso};">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <div style="background:${C.paper};border:1px solid ${C.hairline};border-radius:16px;padding:28px;box-shadow:0 1px 4px rgba(31,20,10,0.04);">
      ${body}
    </div>
    <p style="text-align:center;font-size:11px;color:${C.muted};margin-top:18px;">
      Sent by Braid Boss Pro
    </p>
  </div>
</body></html>`;

const ctaButton = (label: string, url: string): string => `
  <p style="margin:22px 0;text-align:center;">
    <a href="${escape(url)}" style="display:inline-block;background:${C.espresso};color:${C.cream};text-decoration:none;padding:14px 26px;border-radius:999px;font-weight:600;font-size:14px;letter-spacing:0.04em;">
      ${escape(label)}
    </a>
  </p>
`;

// ---- shared: style customization block + portal CTA -----------------
// Backward-compatible: renders nothing when the optional payload
// fields are absent, so existing enqueues are unaffected.
// Every row is conditional — the block disappears entirely when
// nothing was customized, and individual rows only appear when that
// datum exists (so a hair-included service with no curl option never
// shows a curl row). Payload is enriched centrally from the linked
// booking_requests row (see enrichCustomization) so every email type
// shares one source of truth without per-RPC payload threading.
const customizationBlock = (p: Record<string, any>): string => {
  const trow = (label: string, value: string) =>
    `<tr><td style="padding:4px 0;color:${C.muted};font-size:13px;vertical-align:top;">${escape(label)}</td><td style="padding:4px 0 4px 14px;text-align:right;color:${C.espresso};font-size:13px;font-weight:600;vertical-align:top;">${value}</td></tr>`;

  const rows: string[] = [];
  if (p.hairIncluded) rows.push(trow("Hair included", "Yes"));
  if (p.humanHairIncluded) rows.push(trow("Human hair included", "Yes"));
  if (p.selectedHairColor) rows.push(trow("Hair color", escape(p.selectedHairColor)));
  if (p.selectedCurlPattern) rows.push(trow("Curl pattern", escape(p.selectedCurlPattern)));

  const addons: string[] = Array.isArray(p.selectedAddons)
    ? p.selectedAddons.map((a: unknown) => String(a ?? "").trim()).filter(Boolean)
    : [];
  if (addons.length) rows.push(trow("Add-ons", addons.map((a) => escape(a)).join(", ")));

  const notes = String(p.styleNotes ?? "").trim();
  if (notes) rows.push(trow("Notes", escape(notes)));

  const inspoCount = Number(p.inspirationCount) > 0 ? Number(p.inspirationCount) : 0;
  if (inspoCount > 0) {
    rows.push(trow("Inspiration", `${inspoCount} photo${inspoCount === 1 ? "" : "s"} attached`));
  }

  if (rows.length === 0) return "";

  const whats = String(p.whatsIncluded ?? "").trim();
  const whatsBlock = whats
    ? `<p style="font-size:12px;line-height:18px;color:${C.coffee};margin:6px 0 0;"><strong>What's included:</strong> ${escape(whats)}</p>`
    : "";

  return `
    <p style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:${C.goldDeep};margin:16px 0 6px;font-weight:700;">Style customization</p>
    <table style="width:100%;border-collapse:collapse;border-top:1px solid ${C.hairline};border-bottom:1px solid ${C.hairline};">${rows.join("")}</table>
    ${whatsBlock}
  `;
};
// Contract signing section. Only renders when the approved service
// has an active contract template attached (payload.contracts is a
// non-empty list of {title,url}). Supports multiple agreements.
const contractBlock = (p: Record<string, any>): string => {
  const list: Array<{ title?: string; url?: string }> = Array.isArray(p.contracts) ? p.contracts : [];
  const v = list.filter((c) => c && String(c.url || "").trim());
  if (v.length === 0) return "";
  return `<hr style="border:none;border-top:1px solid ${C.hairline};margin:22px 0;" />`
    + `<p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.goldDeep};margin:0 0 8px;font-weight:700;">${v.length > 1 ? "Agreements to sign" : "Agreement to sign"}</p>`
    + `<p style="font-size:14px;line-height:22px;margin:0 0 6px;color:${C.coffee};">Please review and sign ${v.length > 1 ? "these agreements" : "this agreement"} to lock in your appointment.</p>`
    + v.map((c) => ctaButton(v.length > 1 && c.title ? `Review & sign — ${c.title}` : "Review and sign agreement", String(c.url))).join("");
};
const portalButton = (p: Record<string, any>): string => {
  const url = String(p.portalUrl || "").trim();
  if (!url) return "";
  return `<p style="margin:20px 0 4px;text-align:center;"><a href="${escape(url)}" style="display:inline-block;background:transparent;color:${C.espresso};text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:600;font-size:13px;letter-spacing:0.04em;border:1.5px solid ${C.espresso};">View appointment details</a></p>`;
};

// ---- booking_confirmation -------------------------------------------
const renderBookingConfirmation = (p: Record<string, any>) => {
  const clientName  = p.clientName  || "there";
  const studioName  = p.studioName  || "your stylist";
  const serviceName = p.serviceName || null;
  const date        = p.preferredDate || null;
  const time        = p.preferredTime || null;
  const awaitingDeposit = p.approvalStatus === "awaiting_deposit";
  const depositRequired = !!p.depositRequired;
  const when = [date, time].filter(Boolean).join(" · ");

  const nextLine = awaitingDeposit
    ? "We've also sent a deposit link separately. Once your deposit lands and the stylist approves, your appointment is locked in."
    : depositRequired
      ? "Your stylist will review shortly. If a deposit is required, you'll receive a secure link by email."
      : "Your stylist will review and confirm shortly. You'll hear from us as soon as it's approved.";

  const subject = `Booking request received — ${studioName}`;
  const html = wrapHtml(subject, `
    <h1 style="font-size:20px;margin:0 0 12px;color:${C.espresso};">We've got it, ${escape(clientName)}.</h1>
    <p style="font-size:14px;line-height:22px;color:${C.coffee};">
      Your booking request${serviceName ? ` for <strong>${escape(serviceName)}</strong>` : ""}${when ? ` on <strong>${escape(when)}</strong>` : ""} has been received by ${escape(studioName)}.
    </p>
    <p style="font-size:14px;line-height:22px;color:${C.coffee};">${escape(nextLine)}</p>
    ${customizationBlock(p)}
    ${p.prepReminder ? `<p style="font-size:13px;line-height:20px;color:${C.coffee};margin-top:12px;"><strong>Prep:</strong> ${escape(p.prepReminder)}</p>` : ""}
    ${portalButton(p)}
    <p style="font-size:12px;color:${C.muted};line-height:18px;margin-top:18px;">
      We'll only email you about this booking. Reply to this message any time if you need to update something.
    </p>
  `);
  return { subject, html };
};

// ---- contract_signing (+ legacy alias contract_invite) --------------
const renderContractSigning = (p: Record<string, any>) => {
  const clientName    = p.clientName    || "there";
  const studioName    = p.studioName    || "your stylist";
  const contractTitle = p.contractTitle || "Appointment agreement";
  const serviceName   = p.serviceName   || null;
  const contractUrl   = String(p.contractUrl || "").trim();
  const isReminder    = !!p.reminder;

  const subject = isReminder
    ? `Reminder: your ${studioName} appointment agreement is still pending`
    : `${studioName}: please review and sign your appointment agreement`;
  const cta = contractUrl
    ? ctaButton("Review and sign agreement", contractUrl)
    : "";
  const intro = isReminder
    ? `Just a heads-up — your appointment with ${escape(studioName)}${serviceName ? ` for <strong>${escape(serviceName)}</strong>` : ""} is coming up and your agreement is <strong>still unsigned</strong>.`
    : `Your stylist at ${escape(studioName)} sent an agreement for your upcoming${serviceName ? ` <strong>${escape(serviceName)}</strong>` : ""} appointment.`;
  const html = wrapHtml(subject, `
    ${isReminder ? `<p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.goldDeep};margin:0 0 10px;font-weight:700;">Reminder</p>` : ""}
    <h1 style="font-size:20px;margin:0 0 12px;color:${C.espresso};">Hi ${escape(clientName)},</h1>
    <p style="font-size:14px;line-height:22px;color:${C.coffee};">
      ${intro}
    </p>
    <p style="font-size:14px;line-height:22px;color:${C.coffee};">
      Please take a minute to review and sign:
    </p>
    ${cta}
    <p style="font-size:12px;color:${C.muted};line-height:18px;">
      Signing keeps your appointment time secure and policies clear.
    </p>
  `);
  return { subject, html };
};

// ---- appointment_approved ------------------------------------------
const renderAppointmentApproved = (p: Record<string, any>) => {
  const clientName  = p.clientName  || "there";
  const studioName  = p.studioName  || "your stylist";
  const serviceName = p.serviceName || null;
  const date        = p.preferredDate || null;
  const time        = p.preferredTime || null;
  const when        = [date, time].filter(Boolean).join(" · ");
  const depositAmount = Number(p.depositAmount) > 0 ? Number(p.depositAmount) : null;
  const paymentUrl  = String(p.paymentUrl || "").trim();
  const expiresMin  = Number(p.expiresMinutes) > 0 ? Number(p.expiresMinutes) : null;

  const subject = depositAmount && depositAmount > 0
    ? `${studioName} approved your booking — secure with a deposit`
    : `${studioName} approved your booking`;

  const dep = depositAmount
    ? `<p style="font-size:14px;line-height:22px;">Your deposit is <strong>$${depositAmount.toFixed(2)}</strong>. Once it lands, your appointment is locked in.</p>`
    : "";
  const cta = paymentUrl && depositAmount
    ? ctaButton("Pay deposit", paymentUrl)
    : "";
  const expiresLine = paymentUrl && depositAmount && expiresMin
    ? `<p style="font-size:12px;color:${C.muted};line-height:18px;">This hold expires in ${expiresMin} minutes. After that, the slot opens back up.</p>`
    : "";

  const html = wrapHtml(subject, `
    <h1 style="font-size:20px;margin:0 0 12px;color:${C.espresso};">You're in, ${escape(clientName)}.</h1>
    <p style="font-size:14px;line-height:22px;">
      ${escape(studioName)} approved your${serviceName ? ` ${escape(serviceName)}` : ""} request${when ? ` for ${escape(when)}` : ""}.
    </p>
    ${customizationBlock(p)}
    ${dep}
    ${cta}
    ${expiresLine}
    ${contractBlock(p)}
  `);
  return { subject, html };
};

// ---- deposit_received ----------------------------------------------
const renderDepositReceived = (p: Record<string, any>) => {
  const clientName  = p.clientName  || "there";
  const studioName  = p.studioName  || "your stylist";
  const serviceName = p.serviceName || null;
  const date        = p.preferredDate || null;
  const time        = p.preferredTime || null;
  const when        = [date, time].filter(Boolean).join(" · ");
  const subject = `Deposit received — pending ${studioName}'s approval`;
  const html = wrapHtml(subject, `
    <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.goldDeep};margin:0 0 10px;font-weight:700;">Deposit received</p>
    <h1 style="font-size:20px;margin:0 0 12px;color:${C.espresso};">Thanks, ${escape(clientName)}.</h1>
    <p style="font-size:14px;line-height:22px;color:${C.coffee};">
      We received your deposit for your${serviceName ? ` <strong>${escape(serviceName)}</strong>` : ""} request${when ? ` on <strong>${escape(when)}</strong>` : ""}.
    </p>
    <p style="font-size:14px;line-height:22px;color:${C.coffee};">
      <strong>Your appointment isn't confirmed yet.</strong> ${escape(studioName)} still needs to review and approve it — we'll email you to confirm as soon as that happens.
    </p>
    ${customizationBlock(p)}
    ${contractBlock(p)}
    <p style="font-size:12px;color:${C.muted};line-height:18px;">
      No action needed right now. Reach out if anything changes.
    </p>
  `);
  return { subject, html };
};

// ---- balance_paid (with review link) -------------------------------
const renderBalancePaid = (p: Record<string, any>) => {
  const clientName  = p.clientName  || "there";
  const studioName  = p.studioName  || "your stylist";
  const serviceName = p.serviceName || null;
  const amountPaid  = Number(p.amountPaid) > 0 ? Number(p.amountPaid) : null;
  const reviewUrl   = String(p.reviewUrl || "").trim();
  const subject = `Thank you — your balance is paid, ${studioName}`;
  const amount = amountPaid
    ? `<p style="font-size:14px;line-height:22px;">We received <strong>$${amountPaid.toFixed(2)}</strong> for your${serviceName ? ` ${escape(serviceName)}` : ""} appointment. You're all set.</p>`
    : "";
  const cta = reviewUrl
    ? `<p style="margin:18px 0 8px;text-align:center;"><a href="${reviewUrl}" style="display:inline-block;background:${C.espresso};color:${C.cream};text-decoration:none;padding:14px 26px;border-radius:999px;font-weight:600;font-size:14px;letter-spacing:0.04em;">Leave a review · ★★★★★</a></p>`
    : "";
  const html = wrapHtml(subject, `
    <h1 style="font-size:20px;margin:0 0 12px;color:${C.espresso};">Thank you, ${escape(clientName)}.</h1>
    <p style="font-size:14px;line-height:22px;">
      Thanks for visiting ${escape(studioName)} — your balance is paid in full.
    </p>
    ${amount}
    ${customizationBlock(p)}
    <p style="font-size:14px;line-height:22px;margin-top:18px;">
      If you have a moment, your feedback means the world. It only takes 30 seconds.
    </p>
    ${cta}
    <p style="font-size:12px;color:${C.muted};line-height:18px;text-align:center;">
      Rate your experience and share anything you'd want ${escape(studioName)} to know.
    </p>
  `);
  return { subject, html };
};

// ---- review_request (post-appointment "how was it?" ask) -----------
const renderReviewRequest = (p: Record<string, any>) => {
  const clientName = p.clientName || "there";
  const studioName = p.studioName || "your stylist";
  const serviceName = p.serviceName || null;
  const reviewUrl = String(p.reviewUrl || "").trim();
  const subject = `How was your appointment with ${studioName}?`;
  const cta = reviewUrl ? ctaButton("Leave a review", reviewUrl) : "";
  const html = wrapHtml(subject, `
    <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.goldDeep};margin:0 0 10px;font-weight:700;">Thank you</p>
    <h1 style="font-size:22px;line-height:1.25;margin:0 0 14px;color:${C.espresso};">Thank you, ${escape(clientName)}.</h1>
    <p style="font-size:15px;line-height:24px;margin:0 0 14px;color:${C.coffee};">
      Thanks for visiting ${escape(studioName)}${serviceName ? ` for your <strong>${escape(serviceName)}</strong>` : ""}. We'd love to hear how it went.
    </p>
    <p style="font-size:14px;line-height:22px;margin:0 0 4px;color:${C.coffee};">
      It only takes 30 seconds, and it helps ${escape(studioName)} grow while helping future clients book with confidence.
    </p>
    ${cta}
    <p style="font-size:12px;color:${C.muted};line-height:18px;text-align:center;">
      Rate your experience and share anything you'd want ${escape(studioName)} to know.
    </p>
  `);
  return { subject, html };
};

// ---- appointment_confirmed (final approval — deposit already in) ---
//
// Distinct from `appointment_approved`, which is the earlier "please
// pay your deposit" approval email. This one fires after the stylist
// taps Approve & schedule on a deposit-paid request, so the client
// gets a clean "officially booked" confirmation with date, time,
// and remaining balance.
const renderAppointmentConfirmed = (p: Record<string, any>) => {
  const clientName = p.clientName || "there";
  const studioName = p.studioName || "your stylist";
  const serviceName = p.serviceName || null;
  const date = p.preferredDate || null;
  const time = p.preferredTime || null;
  const when = [date, time].filter(Boolean).join(" · ");
  const depositPaid = Number(p.depositPaid) > 0 ? Number(p.depositPaid) : null;
  const remainingBalance =
    p.remainingBalance != null && Number(p.remainingBalance) >= 0
      ? Number(p.remainingBalance)
      : null;

  const subject = `Your appointment is confirmed with ${studioName}`;
  const balanceLine = remainingBalance != null
    ? remainingBalance > 0
      ? `<p style="font-size:14px;line-height:22px;margin:0 0 12px;color:${C.coffee};">Remaining balance: <strong>$${remainingBalance.toFixed(2)}</strong>${depositPaid ? ` (deposit of $${depositPaid.toFixed(2)} received)` : ""}. Due at your appointment.</p>`
      : `<p style="font-size:14px;line-height:22px;margin:0 0 12px;color:${C.coffee};">Paid in full${depositPaid ? ` — deposit of $${depositPaid.toFixed(2)} received` : ""}. Nothing more due at your appointment.</p>`
    : "";

  const html = wrapHtml(subject, `
    <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.goldDeep};margin:0 0 10px;font-weight:700;">
      Confirmed
    </p>
    <h1 style="font-size:22px;line-height:1.25;margin:0 0 14px;color:${C.espresso};">
      You're officially booked, ${escape(clientName)}.
    </h1>
    <p style="font-size:15px;line-height:24px;margin:0 0 14px;">
      ${escape(studioName)} approved and scheduled your appointment${serviceName ? ` for <strong>${escape(serviceName)}</strong>` : ""}${when ? ` on <strong>${escape(when)}</strong>` : ""}.
    </p>
    ${balanceLine}
    ${customizationBlock(p)}
    ${contractBlock(p)}
    <p style="font-size:14px;line-height:22px;margin:0 0 14px;color:${C.coffee};">
      We'll send a reminder closer to the day. If anything changes, reply to this email and ${escape(studioName)} will get it.
    </p>
    ${portalButton(p)}
    <p style="font-size:12px;color:${C.muted};line-height:18px;margin-top:18px;">
      See you soon — thanks for booking with ${escape(studioName)}.
    </p>
  `);
  return { subject, html };
};

// ---- appointment_reminder (24h-out reminder with action links) -----
//
// The reminder is the only place the cancel/reschedule URLs surface
// today. The enqueue RPC builds the URLs from the booking row's
// tokens and passes them in `payload.cancelUrl` / `payload.rescheduleUrl`.
// If reschedule has already been used, rescheduleUrl will be null
// and the template hides that CTA in favor of a plain-text note.
const renderAppointmentReminder = (p: Record<string, any>) => {
  const clientName = p.clientName || "there";
  const studioName = p.studioName || "your stylist";
  const serviceName = p.serviceName || null;
  const date = p.preferredDate || null;
  const time = p.preferredTime || null;
  const when = [date, time].filter(Boolean).join(" · ");
  const cancelUrl = String(p.cancelUrl || "").trim();
  const rescheduleUrl = String(p.rescheduleUrl || "").trim();
  const rescheduleUsed = !!p.rescheduleUsed;

  const subject = `Reminder: your appointment with ${studioName}`;
  const rescheduleBlock = rescheduleUrl
    ? `
      <p style="margin:0 0 8px;font-size:14px;font-weight:600;color:${C.espresso};">Need to reschedule?</p>
      <p style="margin:0 0 12px;font-size:13px;line-height:20px;color:${C.coffee};">You may reschedule one time without paying another deposit. Your original deposit will roll over to your new appointment time.</p>
      <p style="margin:0 0 18px;"><a href="${escape(rescheduleUrl)}" style="display:inline-block;background:${C.espresso};color:${C.cream};text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;font-size:13px;letter-spacing:0.04em;">Reschedule appointment</a></p>`
    : rescheduleUsed
      ? `<p style="margin:0 0 18px;font-size:13px;line-height:20px;color:${C.muted};">You've already used your one-time reschedule option for this appointment. To make another change, contact your stylist directly.</p>`
      : "";

  const cancelBlock = cancelUrl
    ? `
      <p style="margin:0 0 8px;font-size:14px;font-weight:600;color:${C.espresso};">Need to cancel?</p>
      <p style="margin:0 0 12px;font-size:13px;line-height:20px;color:${C.coffee};">You may cancel from this link, but your deposit will be forfeited according to the stylist's policy.</p>
      <p style="margin:0;"><a href="${escape(cancelUrl)}" style="display:inline-block;background:transparent;color:${C.espresso};text-decoration:none;padding:11px 22px;border-radius:999px;font-weight:600;font-size:13px;letter-spacing:0.04em;border:1.5px solid ${C.espresso};">Cancel appointment</a></p>`
    : "";

  const html = wrapHtml(subject, `
    <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.goldDeep};margin:0 0 10px;font-weight:700;">Reminder</p>
    <h1 style="font-size:22px;line-height:1.25;margin:0 0 14px;color:${C.espresso};">See you soon, ${escape(clientName)}.</h1>
    <p style="font-size:15px;line-height:24px;margin:0 0 14px;">Your appointment with <strong>${escape(studioName)}</strong>${serviceName ? ` for <strong>${escape(serviceName)}</strong>` : ""}${when ? ` is on <strong>${escape(when)}</strong>` : " is coming up soon"}.</p>
    ${customizationBlock(p)}
    ${p.prepInstructions ? `<p style="font-size:13px;line-height:20px;color:${C.coffee};margin:0 0 14px;"><strong>Prep:</strong> ${escape(p.prepInstructions)}</p>` : ""}
    <p style="font-size:14px;line-height:22px;margin:0 0 18px;color:${C.coffee};">If everything still looks good, no action needed — we just wanted to give you a heads up.</p>
    ${portalButton(p)}
    <hr style="border:none;border-top:1px solid ${C.hairline};margin:22px 0;" />
    <p style="font-size:13px;font-weight:700;letter-spacing:0.04em;color:${C.coffee};margin:0 0 14px;text-transform:uppercase;">Need to make a change?</p>
    ${rescheduleBlock}
    ${cancelBlock}
  `);
  return { subject, html };
};

// ---- client_booking_cancelled (after client cancels via link) -------
const renderClientBookingCancelled = (p: Record<string, any>) => {
  const clientName = p.clientName || "there";
  const studioName = p.studioName || "your stylist";
  const serviceName = p.serviceName || null;
  const date = p.preferredDate || null;
  const time = p.preferredTime || null;
  const when = [date, time].filter(Boolean).join(" · ");
  const depositForfeited = !!p.depositForfeited;
  const depositAmount = Number(p.depositAmount) > 0 ? Number(p.depositAmount) : null;
  const subject = `Your appointment with ${studioName} was cancelled`;
  const html = wrapHtml(subject, `
    <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.muted};margin:0 0 10px;font-weight:700;">Cancelled</p>
    <h1 style="font-size:22px;line-height:1.25;margin:0 0 14px;color:${C.espresso};">Your appointment was cancelled.</h1>
    <p style="font-size:14px;line-height:22px;margin:0 0 12px;color:${C.coffee};">We've let ${escape(studioName)} know.${serviceName || when ? " The cancelled booking:" : ""}</p>
    ${serviceName || when ? `<p style="font-size:14px;line-height:22px;margin:0 0 12px;color:${C.coffee};">${serviceName ? `<strong>${escape(serviceName)}</strong>` : ""}${serviceName && when ? " · " : ""}${when ? `<strong>${escape(when)}</strong>` : ""}</p>` : ""}
    ${depositForfeited ? `<p style="font-size:14px;line-height:22px;margin:0 0 14px;color:${C.coffee};">Per the stylist's policy, your deposit${depositAmount ? ` of $${depositAmount.toFixed(2)}` : ""} has been forfeited.</p>` : ""}
    <p style="font-size:13px;color:${C.muted};line-height:20px;margin-top:18px;">If this was a mistake, reach out to ${escape(studioName)} directly.</p>
  `);
  return { subject, html };
};

// ---- stylist_booking_cancelled (notify stylist) ---------------------
const renderStylistBookingCancelled = (p: Record<string, any>) => {
  const clientName = p.clientName || "A client";
  const serviceName = p.serviceName || null;
  const date = p.preferredDate || null;
  const time = p.preferredTime || null;
  const when = [date, time].filter(Boolean).join(" · ");
  const reason = String(p.reason || "").trim();
  const depositAmount = Number(p.depositAmount) > 0 ? Number(p.depositAmount) : null;
  const subject = `Client cancelled — ${clientName}`;
  const html = wrapHtml(subject, `
    <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.muted};margin:0 0 10px;font-weight:700;">Cancellation</p>
    <h1 style="font-size:20px;line-height:1.25;margin:0 0 12px;color:${C.espresso};">${escape(clientName)} cancelled.</h1>
    <p style="font-size:14px;line-height:22px;margin:0 0 10px;color:${C.coffee};">${serviceName ? `<strong>${escape(serviceName)}</strong>` : ""}${serviceName && when ? " · " : ""}${when ? `<strong>${escape(when)}</strong>` : ""}</p>
    ${reason ? `<p style="font-size:13px;line-height:20px;margin:0 0 14px;color:${C.coffee};"><strong>Reason:</strong> ${escape(reason)}</p>` : ""}
    ${depositAmount ? `<p style="font-size:13px;line-height:20px;margin:0 0 14px;color:${C.coffee};">Deposit of <strong>$${depositAmount.toFixed(2)}</strong> has been marked forfeited. The slot is released from your calendar.</p>` : `<p style="font-size:13px;line-height:20px;margin:0 0 14px;color:${C.coffee};">The slot is released from your calendar.</p>`}
    <p style="font-size:12px;color:${C.muted};line-height:18px;margin-top:18px;">Cancelled via the secure client self-service link.</p>
  `);
  return { subject, html };
};

// ---- client_booking_rescheduled (after successful reschedule) -------
const renderClientBookingRescheduled = (p: Record<string, any>) => {
  const clientName = p.clientName || "there";
  const studioName = p.studioName || "your stylist";
  const serviceName = p.serviceName || null;
  const newDate = p.preferredDate || null;
  const newTime = p.preferredTime || null;
  const oldDate = p.fromDate || null;
  const oldTime = p.fromTime || null;
  const newWhen = [newDate, newTime].filter(Boolean).join(" · ");
  const oldWhen = [oldDate, oldTime].filter(Boolean).join(" · ");
  const depositAmount = Number(p.depositAmount) > 0 ? Number(p.depositAmount) : null;
  const subject = `Reschedule request received — ${studioName}`;
  const html = wrapHtml(subject, `
    <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.goldDeep};margin:0 0 10px;font-weight:700;">Reschedule requested</p>
    <h1 style="font-size:22px;line-height:1.25;margin:0 0 14px;color:${C.espresso};">We got your request, ${escape(clientName)}.</h1>
    <p style="font-size:15px;line-height:24px;margin:0 0 12px;">Requested time with <strong>${escape(studioName)}</strong>${serviceName ? ` for <strong>${escape(serviceName)}</strong>` : ""}: <strong>${escape(newWhen)}</strong>.</p>
    ${oldWhen ? `<p style="font-size:13px;line-height:20px;margin:0 0 14px;color:${C.muted};">Moving from ${escape(oldWhen)}.</p>` : ""}
    <p style="font-size:14px;line-height:22px;margin:0 0 14px;color:${C.coffee};">Your existing deposit${depositAmount ? ` of $${depositAmount.toFixed(2)}` : ""} rolls over — no second charge.</p>
    <p style="font-size:14px;line-height:22px;margin:0 0 14px;color:${C.coffee};"><strong>${escape(studioName)} still needs to confirm the new time.</strong> We'll email you the moment it's approved.</p>
    <p style="font-size:13px;color:${C.muted};line-height:20px;margin-top:18px;">This was your one-time reschedule. Any further changes need to go through ${escape(studioName)} directly.</p>
  `);
  return { subject, html };
};

// ---- stylist_booking_rescheduled (notify stylist) -------------------
const renderStylistBookingRescheduled = (p: Record<string, any>) => {
  const clientName = p.clientName || "A client";
  const serviceName = p.serviceName || null;
  const fromDate = p.fromDate || null;
  const fromTime = p.fromTime || null;
  const toDate = p.toDate || null;
  const toTime = p.toTime || null;
  const fromWhen = [fromDate, fromTime].filter(Boolean).join(" · ");
  const toWhen = [toDate, toTime].filter(Boolean).join(" · ");
  const subject = `Reschedule request — ${clientName}`;
  const html = wrapHtml(subject, `
    <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.goldDeep};margin:0 0 10px;font-weight:700;">Action needed</p>
    <h1 style="font-size:20px;line-height:1.25;margin:0 0 12px;color:${C.espresso};">${escape(clientName)} requested a new time.</h1>
    ${serviceName ? `<p style="font-size:14px;line-height:22px;margin:0 0 10px;color:${C.coffee};"><strong>${escape(serviceName)}</strong></p>` : ""}
    ${fromWhen ? `<p style="font-size:13px;line-height:20px;margin:0 0 6px;color:${C.muted};">From: ${escape(fromWhen)}</p>` : ""}
    <p style="font-size:14px;line-height:22px;margin:0 0 14px;color:${C.coffee};">To: <strong>${escape(toWhen)}</strong></p>
    <p style="font-size:14px;line-height:22px;margin:0 0 6px;color:${C.coffee};">The original slot has been released. <strong>Open Braid Boss Pro and approve the new time</strong> to put it on your calendar — the deposit rolls over, no new charge.</p>
    <p style="font-size:12px;color:${C.muted};line-height:18px;margin-top:18px;">Requested via the secure client self-service link. The client has used their one-time reschedule.</p>
  `);
  return { subject, html };
};

// ---- founding_welcome (Founding Stylist Access activation) ---------
const renderFoundingWelcome = (p: Record<string, any>) => {
  const stylistName = p.stylistName || "Stylist";
  const appUrl = String(p.appUrl || "https://braidbosspro.app").trim() || "https://braidbosspro.app";
  const subject = "Welcome to Braid Boss Pro, Founding Stylist";
  const html = wrapHtml(subject, `
    <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.goldDeep};margin:0 0 10px;font-weight:700;">
      Founding Stylist Access
    </p>
    <h1 style="font-size:22px;line-height:1.25;margin:0 0 14px;color:${C.espresso};">
      Welcome to Braid Boss Pro, ${escape(stylistName)}.
    </h1>
    <p style="font-size:15px;line-height:24px;margin:0 0 14px;">
      You're officially part of the first 100 founding stylists.
    </p>
    <p style="font-size:14px;line-height:22px;margin:0 0 14px;color:${C.coffee};">
      Your lifetime access is active, and your account is grandfathered into Braid Boss Pro as the platform grows.
    </p>
    <p style="font-size:14px;line-height:22px;margin:0 0 18px;color:${C.coffee};">
      You can now set up your services, booking link, deposits, clients, storefront, contracts, and business tools.
    </p>
    ${ctaButton("Open Braid Boss Pro", appUrl)}
    <p style="font-size:12px;color:${C.muted};line-height:18px;text-align:center;margin-top:14px;">
      Thank you for backing us early — we're building this with stylists like you in mind.
    </p>
  `);
  return { subject, html };
};

// ---- booking denial / refund (client + stylist) --------------------
const whenLine = (p: Record<string, any>): string => {
  const d = String(p.preferredDate || "").trim();
  const t = String(p.preferredTime || "").trim();
  const when = [d, t].filter(Boolean).join(" · ");
  return when
    ? `<p style="font-size:13px;line-height:20px;margin:0 0 12px;color:${C.muted};">Requested time: ${escape(when)}</p>`
    : "";
};

const renderBookingDeniedNoCharge = (p: Record<string, any>) => {
  const clientName = p.clientName || "there";
  const studioName = p.studioName || "your stylist";
  const serviceName = p.serviceName || null;
  const subject = `Booking request update — ${studioName}`;
  const html = wrapHtml(subject, `
    <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.muted};margin:0 0 10px;font-weight:700;">Booking update</p>
    <h1 style="font-size:20px;line-height:1.25;margin:0 0 14px;color:${C.espresso};">Hi ${escape(clientName)},</h1>
    <p style="font-size:14px;line-height:22px;margin:0 0 12px;color:${C.coffee};">
      Your booking request${serviceName ? ` for <strong>${escape(serviceName)}</strong>` : ""} was not approved by ${escape(studioName)}. <strong>No payment was collected.</strong>
    </p>
    ${whenLine(p)}
    <p style="font-size:13px;color:${C.muted};line-height:20px;margin-top:14px;">You're welcome to submit a new request for another time.</p>
  `);
  return { subject, html };
};

const renderBookingDeniedRefunded = (p: Record<string, any>) => {
  const clientName = p.clientName || "there";
  const studioName = p.studioName || "your stylist";
  const serviceName = p.serviceName || null;
  const refundAmount = Number(p.refundAmount) > 0 ? Number(p.refundAmount) : null;
  const subject = `Booking request refunded — ${studioName}`;
  const html = wrapHtml(subject, `
    <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.goldDeep};margin:0 0 10px;font-weight:700;">Refund issued</p>
    <h1 style="font-size:20px;line-height:1.25;margin:0 0 14px;color:${C.espresso};">Hi ${escape(clientName)},</h1>
    <p style="font-size:14px;line-height:22px;margin:0 0 12px;color:${C.coffee};">
      Your booking request${serviceName ? ` for <strong>${escape(serviceName)}</strong>` : ""} with ${escape(studioName)} was not approved. <strong>Your deposit${refundAmount ? ` of $${refundAmount.toFixed(2)}` : ""} has been refunded.</strong>
    </p>
    ${whenLine(p)}
    <p style="font-size:13px;color:${C.muted};line-height:20px;margin-top:14px;">Refund timing depends on your bank or card provider — it typically takes a few business days to appear.</p>
  `);
  return { subject, html };
};

const renderBookingDeniedRefundManual = (p: Record<string, any>) => {
  const clientName = p.clientName || "there";
  const studioName = p.studioName || "your stylist";
  const serviceName = p.serviceName || null;
  const subject = `Booking request update — ${studioName}`;
  const html = wrapHtml(subject, `
    <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.muted};margin:0 0 10px;font-weight:700;">Booking update</p>
    <h1 style="font-size:20px;line-height:1.25;margin:0 0 14px;color:${C.espresso};">Hi ${escape(clientName)},</h1>
    <p style="font-size:14px;line-height:22px;margin:0 0 12px;color:${C.coffee};">
      Your booking request${serviceName ? ` for <strong>${escape(serviceName)}</strong>` : ""} was not approved. ${escape(studioName)} has been notified to review your deposit refund manually.
    </p>
    ${whenLine(p)}
    <p style="font-size:13px;color:${C.muted};line-height:20px;margin-top:14px;">If you have any questions about your refund, reply to this email and your stylist will follow up.</p>
  `);
  return { subject, html };
};

const renderBookingRefundManualStylist = (p: Record<string, any>) => {
  const clientName = p.clientName || "A client";
  const serviceName = p.serviceName || null;
  const depositAmount = Number(p.depositAmount) > 0 ? Number(p.depositAmount) : null;
  const reason = String(p.reason || "refund_failed").trim();
  const subject = "Action needed: manual deposit refund — Braid Boss Pro";
  const html = wrapHtml(subject, `
    <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.danger};margin:0 0 10px;font-weight:700;">Manual refund needed</p>
    <h1 style="font-size:20px;line-height:1.25;margin:0 0 12px;color:${C.espresso};">A deposit refund didn't go through automatically.</h1>
    <p style="font-size:14px;line-height:22px;margin:0 0 10px;color:${C.coffee};">
      You denied ${escape(clientName)}'s booking${serviceName ? ` for <strong>${escape(serviceName)}</strong>` : ""}, but the automatic Stripe refund failed${depositAmount ? ` for the <strong>$${depositAmount.toFixed(2)}</strong> deposit` : ""}.
    </p>
    ${whenLine(p)}
    <p style="font-size:14px;line-height:22px;margin:0 0 10px;color:${C.coffee};">
      <strong>Please issue the refund manually in your Stripe dashboard.</strong> The client has been told their refund is being reviewed manually.
    </p>
    <p style="font-size:12px;color:${C.muted};line-height:18px;margin-top:14px;">Reason: ${escape(reason)}</p>
  `);
  return { subject, html };
};

// ---- appointment_rescheduled (stylist moved an existing appt) ------
// Distinct from client_booking_rescheduled (a client REQUEST awaiting
// approval). Here the stylist already changed a confirmed
// appointment, so the tone is "it's done, here's your new time".
const renderAppointmentRescheduled = (p: Record<string, any>) => {
  const clientName = p.clientName || "there";
  const studioName = p.studioName || "your stylist";
  const serviceName = p.serviceName || null;
  const newWhen = [p.preferredDate || null, p.preferredTime || null].filter(Boolean).join(" · ");
  const oldWhen = [p.fromDate || null, p.fromTime || null].filter(Boolean).join(" · ");
  const cancelUrl = String(p.cancelUrl || "").trim();
  const subject = `Your appointment with ${studioName} has been rescheduled`;
  const html = wrapHtml(subject, `
    <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.goldDeep};margin:0 0 10px;font-weight:700;">Appointment updated</p>
    <h1 style="font-size:22px;line-height:1.25;margin:0 0 14px;color:${C.espresso};">Your appointment has moved, ${escape(clientName)}.</h1>
    <p style="font-size:15px;line-height:24px;margin:0 0 12px;color:${C.coffee};">
      ${escape(studioName)} rescheduled your${serviceName ? ` <strong>${escape(serviceName)}</strong>` : ""} appointment${newWhen ? ` to <strong>${escape(newWhen)}</strong>` : ""}.
    </p>
    ${oldWhen ? `<p style="font-size:13px;line-height:20px;margin:0 0 14px;color:${C.muted};">Previously: ${escape(oldWhen)}.</p>` : ""}
    ${customizationBlock(p)}
    ${portalButton(p)}
    <p style="font-size:13px;color:${C.muted};line-height:20px;margin:14px 0;">No action needed — your booking and any deposit carry over. If the new time doesn't work, reply to this email and your stylist will help.</p>
    ${cancelUrl ? `<hr style="border:none;border-top:1px solid ${C.hairline};margin:18px 0;" /><p style="margin:0 0 8px;font-size:13px;font-weight:600;color:${C.espresso};">Can't make the new time?</p><p style="margin:0 0 10px;font-size:12px;line-height:18px;color:${C.coffee};">You can cancel from the link below. Your deposit is handled per your stylist's policy.</p><p style="margin:0;"><a href="${escape(cancelUrl)}" style="display:inline-block;background:transparent;color:${C.espresso};text-decoration:none;padding:10px 20px;border-radius:999px;font-weight:600;font-size:12px;letter-spacing:0.04em;border:1.5px solid ${C.espresso};">Cancel appointment</a></p>` : ""}
  `);
  return { subject, html };
};

// ---- order_confirmation (customer-facing receipt) ------------------
// Fires from the product-checkout webhook the moment Stripe confirms
// payment. Payload shape:
//   { customerName, studioName, orderRef, currency, items[],
//     subtotal, shippingCents, total, isPickup, viewOrderUrl }
// items[] entries: { title, variant, quantity, unitAmount, imageUrl }
const renderOrderConfirmation = (p: Record<string, any>) => {
  const customerName = p.customerName || "there";
  const studioName   = p.studioName   || "your boutique";
  const orderRef     = p.orderRef     || "";
  const currency     = (p.currency || "USD").toUpperCase();
  const items        = Array.isArray(p.items) ? p.items : [];
  const isPickup     = !!p.isPickup;
  const viewOrderUrl = String(p.viewOrderUrl || "").trim();
  const fmtMoney = (n: number | string | null | undefined): string => {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    try { return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(v); }
    catch { return `$${v.toFixed(2)}`; }
  };

  const itemRows = items.map((it: any) => {
    const title = escape(it?.title || "Item");
    const variant = it?.variant ? `<div style="font-size:12px;color:${C.muted};">${escape(it.variant)}</div>` : "";
    const qty = Number(it?.quantity) || 1;
    const unit = Number(it?.unitAmount) || 0;
    const line = qty * unit;
    return `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid ${C.hairline};vertical-align:top;">
          <div style="font-size:14px;font-weight:600;color:${C.espresso};">${title}</div>
          ${variant}
          <div style="font-size:12px;color:${C.muted};margin-top:2px;">Qty ${qty}</div>
        </td>
        <td style="padding:10px 0;border-bottom:1px solid ${C.hairline};text-align:right;font-size:14px;color:${C.espresso};white-space:nowrap;vertical-align:top;">
          ${fmtMoney(line)}
        </td>
      </tr>`;
  }).join("");

  const subtotal = Number(p.subtotal);
  const total    = Number(p.total);
  const shipping = Number(p.shippingCents) > 0 ? Number(p.shippingCents) / 100 : null;
  const showSubtotal = Number.isFinite(subtotal) && Number.isFinite(total) && subtotal !== total;

  const subject = `Your ${studioName} order is confirmed${orderRef ? ` · #${orderRef}` : ""}`;
  const html = wrapHtml(subject, `
    <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.goldDeep};margin:0 0 10px;font-weight:700;">Order confirmed</p>
    <h1 style="font-size:22px;line-height:1.25;margin:0 0 12px;color:${C.espresso};">Thanks, ${escape(customerName)}.</h1>
    <p style="font-size:15px;line-height:24px;margin:0 0 16px;color:${C.coffee};">
      Your order from <strong>${escape(studioName)}</strong> is in. We'll let you know when it's ${isPickup ? "ready for pickup" : "shipped"}.
    </p>
    ${orderRef ? `<p style="font-size:12px;color:${C.muted};margin:0 0 14px;">Order reference · <span style="font-family:SFMono-Regular,Menlo,Monaco,Consolas,monospace;color:${C.coffee};">${escape(orderRef)}</span></p>` : ""}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin:8px 0 6px;">
      ${itemRows}
      ${showSubtotal ? `
        <tr>
          <td style="padding:10px 0 4px;font-size:13px;color:${C.muted};">Subtotal</td>
          <td style="padding:10px 0 4px;text-align:right;font-size:13px;color:${C.coffee};">${fmtMoney(subtotal)}</td>
        </tr>` : ""}
      ${shipping != null ? `
        <tr>
          <td style="padding:4px 0;font-size:13px;color:${C.muted};">Shipping</td>
          <td style="padding:4px 0;text-align:right;font-size:13px;color:${C.coffee};">${fmtMoney(shipping)}</td>
        </tr>` : ""}
      <tr>
        <td style="padding:10px 0 0;font-size:14px;font-weight:700;color:${C.espresso};">Total paid</td>
        <td style="padding:10px 0 0;text-align:right;font-size:16px;font-weight:700;color:${C.espresso};">${fmtMoney(total)}</td>
      </tr>
    </table>
    ${viewOrderUrl ? ctaButton("View order", viewOrderUrl) : ""}
    <p style="font-size:12px;color:${C.muted};line-height:18px;margin:18px 0 0;">
      Questions about your order? Reply to this email and ${escape(studioName)} will be in touch.
    </p>
  `);
  return { subject, html };
};

// ---- order_ready_for_pickup ----------------------------------------
// Fires when the stylist taps "Ready for pickup" on a pickup order.
// Payload shape:
//   { customerName, studioName, orderRef, items[], pickupAddress,
//     pickupInstructions, viewOrderUrl }
// pickupAddress is the pre-formatted single-line string built on the
// client side from shop_settings.pickup_address_* columns.
const renderOrderReadyForPickup = (p: Record<string, any>) => {
  const customerName = p.customerName || "there";
  const studioName   = p.studioName   || "your boutique";
  const orderRef     = p.orderRef     || "";
  const items        = Array.isArray(p.items) ? p.items : [];
  const pickupAddress      = String(p.pickupAddress || "").trim();
  const pickupInstructions = String(p.pickupInstructions || "").trim();
  const viewOrderUrl       = String(p.viewOrderUrl || "").trim();
  const mapsUrl = pickupAddress
    ? `https://maps.google.com/?q=${encodeURIComponent(pickupAddress)}`
    : "";

  const itemList = items.map((it: any) => {
    const qty = Number(it?.quantity) || 1;
    const title = escape(it?.title || "Item");
    const variant = it?.variant ? ` — ${escape(it.variant)}` : "";
    return `<li style="font-size:14px;line-height:22px;color:${C.coffee};">${qty}× ${title}${variant}</li>`;
  }).join("");

  const subject = `Your ${studioName} order is ready for pickup${orderRef ? ` · #${orderRef}` : ""}`;
  const html = wrapHtml(subject, `
    <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.goldDeep};margin:0 0 10px;font-weight:700;">Ready for pickup</p>
    <h1 style="font-size:22px;line-height:1.25;margin:0 0 12px;color:${C.espresso};">Your order is ready, ${escape(customerName)}.</h1>
    <p style="font-size:15px;line-height:24px;margin:0 0 14px;color:${C.coffee};">
      Come grab it from <strong>${escape(studioName)}</strong> at your convenience.
    </p>
    ${pickupAddress ? `
      <div style="background:${C.cream};border:1px solid ${C.hairline};border-radius:12px;padding:14px 16px;margin:0 0 14px;">
        <p style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:${C.muted};margin:0 0 6px;font-weight:700;">Pickup location</p>
        <p style="font-size:15px;line-height:22px;margin:0;color:${C.espresso};font-weight:600;">${escape(pickupAddress)}</p>
        ${pickupInstructions ? `<p style="font-size:13px;line-height:20px;margin:8px 0 0;color:${C.coffee};">${escape(pickupInstructions)}</p>` : ""}
        ${mapsUrl ? `<p style="margin:10px 0 0;"><a href="${escape(mapsUrl)}" style="font-size:13px;color:${C.goldDeep};text-decoration:none;font-weight:600;">Get directions →</a></p>` : ""}
      </div>` : ""}
    ${items.length > 0 ? `
      <p style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:${C.muted};margin:0 0 6px;font-weight:700;">Your items</p>
      <ul style="margin:0 0 14px;padding-left:18px;">${itemList}</ul>` : ""}
    ${viewOrderUrl ? ctaButton("View order", viewOrderUrl) : ""}
    <p style="font-size:12px;color:${C.muted};line-height:18px;margin:18px 0 0;">
      Questions? Reply to this email and ${escape(studioName)} will be in touch.
    </p>
  `);
  return { subject, html };
};

// ---- order_shipped --------------------------------------------------
// Fires when the stylist taps "Mark shipped" and enters carrier +
// tracking. Payload shape:
//   { customerName, studioName, orderRef, items[], carrier,
//     trackingNumber, trackingUrl, viewOrderUrl }
const renderOrderShipped = (p: Record<string, any>) => {
  const customerName   = p.customerName   || "there";
  const studioName     = p.studioName     || "your boutique";
  const orderRef       = p.orderRef       || "";
  const items          = Array.isArray(p.items) ? p.items : [];
  const carrier        = String(p.carrier        || "").trim();
  const trackingNumber = String(p.trackingNumber || "").trim();
  const trackingUrl    = String(p.trackingUrl    || "").trim();
  const viewOrderUrl   = String(p.viewOrderUrl   || "").trim();

  const itemList = items.map((it: any) => {
    const qty = Number(it?.quantity) || 1;
    const title = escape(it?.title || "Item");
    const variant = it?.variant ? ` — ${escape(it.variant)}` : "";
    return `<li style="font-size:14px;line-height:22px;color:${C.coffee};">${qty}× ${title}${variant}</li>`;
  }).join("");

  const subject = `Your ${studioName} order has shipped${orderRef ? ` · #${orderRef}` : ""}`;
  const html = wrapHtml(subject, `
    <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.goldDeep};margin:0 0 10px;font-weight:700;">On the way</p>
    <h1 style="font-size:22px;line-height:1.25;margin:0 0 12px;color:${C.espresso};">It's shipped, ${escape(customerName)}.</h1>
    <p style="font-size:15px;line-height:24px;margin:0 0 14px;color:${C.coffee};">
      Your order from <strong>${escape(studioName)}</strong> is in transit${carrier ? ` via <strong>${escape(carrier)}</strong>` : ""}.
    </p>
    ${trackingNumber ? `
      <div style="background:${C.cream};border:1px solid ${C.hairline};border-radius:12px;padding:14px 16px;margin:0 0 14px;">
        <p style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:${C.muted};margin:0 0 6px;font-weight:700;">Tracking</p>
        <p style="font-size:15px;line-height:22px;margin:0;color:${C.espresso};font-weight:600;font-family:SFMono-Regular,Menlo,Monaco,Consolas,monospace;">${escape(trackingNumber)}</p>
        ${trackingUrl ? `<p style="margin:10px 0 0;"><a href="${escape(trackingUrl)}" style="font-size:13px;color:${C.goldDeep};text-decoration:none;font-weight:600;">Track your package →</a></p>` : ""}
      </div>` : ""}
    ${items.length > 0 ? `
      <p style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:${C.muted};margin:0 0 6px;font-weight:700;">In this shipment</p>
      <ul style="margin:0 0 14px;padding-left:18px;">${itemList}</ul>` : ""}
    ${viewOrderUrl ? ctaButton("View order", viewOrderUrl) : ""}
    <p style="font-size:12px;color:${C.muted};line-height:18px;margin:18px 0 0;">
      Questions? Reply to this email and ${escape(studioName)} will be in touch.
    </p>
  `);
  return { subject, html };
};

// ---- generic fallback -----------------------------------------------
const renderGeneric = (row: ClaimedRow) => {
  const subject = row.subject || "Notification from Braid Boss Pro";
  const html = wrapHtml(subject, `
    <h1 style="font-size:20px;margin:0 0 12px;color:${C.espresso};">${escape(subject)}</h1>
    <pre style="font-size:14px;line-height:22px;color:${C.coffee};white-space:pre-wrap;font-family:inherit;margin:0;">${escape(row.body)}</pre>
  `);
  return { subject, html };
};

// ---- dispatcher -----------------------------------------------------
type Rendered = { subject: string; html: string };

const renderForRow = (row: ClaimedRow): Rendered => {
  // Backward compatibility: rows enqueued by older app builds put a
  // pre-rendered html string into payload.html. Honor that if
  // present; future enqueues just provide raw data and the
  // worker-side renderers take over.
  if (typeof row.payload?.html === "string" && row.payload.html.trim()) {
    return {
      subject: row.subject || "Notification from Braid Boss Pro",
      html: row.payload.html,
    };
  }

  switch (row.notification_type) {
    case "booking_confirmation":
      return renderBookingConfirmation(row.payload || {});
    case "contract_signing":
    case "contract_signing_email":
    case "contract_invite":
      return renderContractSigning(row.payload || {});
    case "appointment_approved":
      return renderAppointmentApproved(row.payload || {});
    case "deposit_received":
      return renderDepositReceived(row.payload || {});
    case "balance_paid":
      return renderBalancePaid(row.payload || {});
    case "review_request":
      return renderReviewRequest(row.payload || {});
    case "booking_denied_no_charge":
      return renderBookingDeniedNoCharge(row.payload || {});
    case "booking_denied_refunded":
      return renderBookingDeniedRefunded(row.payload || {});
    case "booking_denied_refund_manual":
      return renderBookingDeniedRefundManual(row.payload || {});
    case "booking_refund_manual_stylist":
      return renderBookingRefundManualStylist(row.payload || {});
    case "appointment_confirmed":
      return renderAppointmentConfirmed(row.payload || {});
    case "appointment_reminder":
      return renderAppointmentReminder(row.payload || {});
    case "client_booking_cancelled":
      return renderClientBookingCancelled(row.payload || {});
    case "stylist_booking_cancelled":
      return renderStylistBookingCancelled(row.payload || {});
    case "client_booking_rescheduled":
      return renderClientBookingRescheduled(row.payload || {});
    case "stylist_booking_rescheduled":
      return renderStylistBookingRescheduled(row.payload || {});
    case "appointment_rescheduled":
      return renderAppointmentRescheduled(row.payload || {});
    case "founding_welcome":
      return renderFoundingWelcome(row.payload || {});
    case "order_confirmation":
      return renderOrderConfirmation(row.payload || {});
    case "order_ready_for_pickup":
      return renderOrderReadyForPickup(row.payload || {});
    case "order_shipped":
      return renderOrderShipped(row.payload || {});
    default:
      return renderGeneric(row);
  }
};

// =====================================================================
// Resend
// =====================================================================
const sendViaResend = async (
  row: ClaimedRow,
  rendered: Rendered,
): Promise<
  | { ok: true; providerMessageId: string | null }
  | { ok: false; retryable: boolean; error: string }
> => {
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
    return { ok: false, retryable: false, error: "resend_env_missing" };
  }
  if (!row.recipient_email) {
    return { ok: false, retryable: false, error: "missing_recipient_email" };
  }
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to: row.recipient_email,
        subject: rendered.subject,
        html: rendered.html,
        text: row.body,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // 5xx + 429 → transient, retryable. Everything else → permanent.
      const retryable = res.status >= 500 || res.status === 429;
      return {
        ok: false,
        retryable,
        error: `resend_${res.status}: ${text.slice(0, 240)}`,
      };
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, providerMessageId: data?.id || null };
  } catch (e: any) {
    return { ok: false, retryable: true, error: `network: ${e?.message || e}` };
  }
};

// =====================================================================
// Twilio SMS — Phase 1 foundation. Reuses the same notification_queue
// row lifecycle as email (claim → send → mark_sent/mark_failed), so
// duplicate sends are prevented by the existing atomic claim and the
// idempotent mark_notification_sent terminal state. SMS rows carry
// their text in payload.smsText (preferred) or the row's `body`.
// =====================================================================
const TWILIO_ENDPOINT = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;

// Best-effort E.164 normalization. Returns null when the input can't
// be confidently formatted, so the row is failed safely rather than
// sending to a malformed destination. Defaults bare 10/11-digit
// numbers to US (+1) — the only market in scope for v1.
const toE164 = (raw: unknown): string | null => {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const hasPlus = s.startsWith("+");
  const digits = s.replace(/[^\d]/g, "");
  if (!digits) return null;
  if (hasPlus) {
    // Already international: 8–15 digits after the +.
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  // 8–15 digits without a + is ambiguous internationally — reject.
  return null;
};

const smsText = (row: ClaimedRow): string => {
  const fromPayload =
    row.payload && typeof row.payload === "object" && typeof row.payload.smsText === "string"
      ? row.payload.smsText
      : "";
  const txt = String(fromPayload || row.body || "").trim();
  // Hard cap so a bad payload can't fan out into many billed segments.
  return txt.length > 480 ? `${txt.slice(0, 477)}...` : txt;
};

const sendViaTwilio = async (
  row: ClaimedRow,
): Promise<
  | { ok: true; providerMessageId: string | null }
  | { ok: false; retryable: boolean; error: string }
> => {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    // Non-retryable: missing config won't fix itself on retry. Email
    // rows in the same batch are unaffected (per-row dispatch).
    return { ok: false, retryable: false, error: "twilio_env_missing" };
  }
  const to = toE164(row.recipient_phone);
  if (!to) {
    return { ok: false, retryable: false, error: "invalid_recipient_phone" };
  }
  const body = smsText(row);
  if (!body) {
    return { ok: false, retryable: false, error: "empty_sms_body" };
  }
  try {
    const form = new URLSearchParams();
    form.set("To", to);
    form.set("From", TWILIO_PHONE_NUMBER);
    form.set("Body", body);
    const res = await fetch(TWILIO_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // 5xx + 429 → transient. 4xx (bad number, opt-out, etc.) →
      // permanent so we don't retry-spam Twilio.
      const retryable = res.status >= 500 || res.status === 429;
      return { ok: false, retryable, error: `twilio_${res.status}: ${text.slice(0, 240)}` };
    }
    const data = (await res.json().catch(() => ({}))) as { sid?: string };
    return { ok: true, providerMessageId: data?.sid || null };
  } catch (e: any) {
    return { ok: false, retryable: true, error: `network: ${e?.message || e}` };
  }
};

// =====================================================================
// Helpers
// =====================================================================
const failTerminal = async (
  admin: ReturnType<typeof createClient>,
  id: string,
  reason: string,
): Promise<void> => {
  // mark_notification_failed increments retry_count by 1; after 3
  // increments the row terminates. Call it three times to force a
  // permanent failure on non-retryable errors. Each call sets
  // scheduled_for = now() + 5 min, so a concurrent worker tick
  // can't pick the row up between increments.
  for (let i = 0; i < 3; i++) {
    const { error } = await admin.rpc("mark_notification_failed", {
      id_in: id,
      reason_in: reason,
    });
    if (error) {
      console.warn(
        `[process-notification-queue] failTerminal increment ${i + 1} failed for ${id}: ${error.message}`,
      );
      break;
    }
  }
};

// =====================================================================
// Customization enrichment — single source of truth
// =====================================================================
// Booking customization (hair color, curl pattern, add-ons, notes,
// inspiration photos, what's-included) lives on the booking_requests
// row. Rather than thread it through every enqueue path, the worker
// pulls it once per email from the linked request (by
// booking_request_id, falling back to appointment_id) and merges it
// into the payload WITHOUT overriding anything the enqueuer set.
const CUSTOMIZATION_TYPES = new Set([
  "booking_confirmation",
  "deposit_received",
  "appointment_approved",
  "appointment_confirmed",
  "appointment_reminder",
  "balance_paid",
  "appointment_rescheduled",
]);

const enrichCustomization = async (
  admin: ReturnType<typeof createClient>,
  row: ClaimedRow,
): Promise<void> => {
  if (!CUSTOMIZATION_TYPES.has(row.notification_type)) return;
  const cols =
    "selected_hair_color, selected_curl_pattern, client_style_notes, inspiration_photo_urls, customization_summary, selected_addons, selected_variation_name, portal_token, cancel_token";
  let br: any = null;
  try {
    if (row.booking_request_id) {
      const { data } = await admin
        .from("booking_requests").select(cols)
        .eq("id", row.booking_request_id).maybeSingle();
      br = data;
    }
    if (!br && row.appointment_id) {
      const { data } = await admin
        .from("booking_requests").select(cols)
        .eq("appointment_id", row.appointment_id)
        .order("created_at", { ascending: false })
        .limit(1).maybeSingle();
      br = data;
    }
  } catch {
    return; // enrichment is best-effort — never block the send
  }
  if (!br) return;

  const cs = br.customization_summary && typeof br.customization_summary === "object"
    ? br.customization_summary : {};
  const addonNames: string[] = Array.isArray(br.selected_addons)
    ? br.selected_addons.map((a: any) => String(a?.name ?? "").trim()).filter(Boolean)
    : [];
  const blob = `${br.selected_variation_name || ""} ${addonNames.join(" ")}`.toLowerCase();
  const humanHair = !!cs.human_hair_included || /human hair/.test(blob);

  const p: Record<string, any> =
    (row.payload && typeof row.payload === "object") ? row.payload : (row.payload = {});
  const fill = (k: string, v: any) => {
    if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) return;
    const cur = p[k];
    if (cur == null || cur === "" || (Array.isArray(cur) && cur.length === 0)) p[k] = v;
  };
  fill("selectedHairColor", br.selected_hair_color || cs.custom_hair_color || null);
  fill("selectedCurlPattern", br.selected_curl_pattern || cs.custom_curl_pattern || null);
  if (humanHair && !p.humanHairIncluded) p.humanHairIncluded = true;
  fill("selectedAddons", addonNames);
  fill("styleNotes", br.client_style_notes || (typeof cs.notes === "string" ? cs.notes : null));
  const inspo = Array.isArray(br.inspiration_photo_urls) ? br.inspiration_photo_urls.length : 0;
  if (inspo > 0 && !(Number(p.inspirationCount) > 0)) p.inspirationCount = inspo;
  fill(
    "whatsIncluded",
    typeof cs.whats_included === "string" ? cs.whats_included
      : (typeof cs.summary === "string" ? cs.summary : null),
  );
  // Self-service links from the linked booking request, so the
  // reschedule email (and any enriched type lacking them) can show
  // "View appointment details" + a cancel option. Base comes from
  // the enqueuer when provided, else the prod default the SQL RPCs
  // also use. cancel_token is null once a cancel has been used.
  const base = String(p.appBase || "").replace(/\/$/, "") || "https://braidbosspro.app";
  if (br.portal_token) fill("portalUrl", `${base}/client/appointment/${br.portal_token}`);
  if (br.cancel_token) fill("cancelUrl", `${base}/booking-action/${br.cancel_token}/cancel`);
};

// =====================================================================
// Studio name enrichment — client-facing emails must feel like they
// come from the stylist's business, not the platform. Enqueue RPCs
// already set payload.studioName in most paths; this is a safety net
// so a renderer never falls back to "your stylist" just because one
// enqueue path forgot to thread it. Fallback order mirrors the app:
// profiles.business_name → profiles.full_name → "your stylist".
// Stylist-facing / platform emails are intentionally excluded so they
// keep their "Braid Boss Pro" system framing.
const STUDIO_NAME_TYPES = new Set([
  "booking_confirmation",
  "contract_signing",
  "contract_signing_email",
  "contract_invite",
  "appointment_approved",
  "deposit_received",
  "balance_paid",
  "review_request",
  "booking_denied_no_charge",
  "booking_denied_refunded",
  "booking_denied_refund_manual",
  "appointment_confirmed",
  "appointment_reminder",
  "client_booking_cancelled",
  "client_booking_rescheduled",
  "appointment_rescheduled",
]);

const enrichStudioName = async (
  admin: ReturnType<typeof createClient>,
  row: ClaimedRow,
): Promise<void> => {
  if (!STUDIO_NAME_TYPES.has(row.notification_type)) return;
  const p: Record<string, any> =
    (row.payload && typeof row.payload === "object") ? row.payload : (row.payload = {});
  const cur = String(p.studioName ?? "").trim();
  if (cur && cur.toLowerCase() !== "your stylist") return;
  if (!row.user_id) return;
  try {
    const { data } = await admin
      .from("profiles").select("business_name, full_name")
      .eq("id", row.user_id).maybeSingle();
    const resolved =
      String((data as any)?.business_name ?? "").trim() ||
      String((data as any)?.full_name ?? "").trim();
    if (resolved) p.studioName = resolved;
  } catch {
    // best-effort — renderer fallback ("your stylist") still applies
  }
};

// =====================================================================
// HTTP handler
// =====================================================================
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "GET") {
    // Friendly health probe so ops can curl the URL.
    return json(200, { ok: true, endpoint: "process-notification-queue" });
  }
  if (req.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json(500, { error: "supabase_env_missing" });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 0. Recover rows stuck in 'processing' from a previous crashed
  //    worker. Cheap when there's nothing to sweep (indexed partial
  //    scan); critical for not losing notifications when the edge
  //    function times out mid-send.
  const { data: sweptCount, error: sweepErr } = await admin.rpc(
    "sweep_stuck_notifications",
    { stuck_after_minutes_in: 30 },
  );
  if (sweepErr) {
    // Sweep is best-effort — don't fail the whole tick on it.
    console.warn("[process-notification-queue] sweep failed:", sweepErr.message);
  } else if (typeof sweptCount === "number" && sweptCount > 0) {
    console.info(`[process-notification-queue] swept ${sweptCount} stuck row(s)`);
  }

  // 1. Atomic claim
  const { data: claimRes, error: claimErr } = await admin.rpc(
    "mark_notification_processing",
    { limit_in: BATCH_LIMIT },
  );
  if (claimErr) {
    console.error(
      "[process-notification-queue] claim failed:",
      claimErr.message,
    );
    return json(500, { error: claimErr.message });
  }
  const rows: ClaimedRow[] =
    (claimRes as { rows?: ClaimedRow[] })?.rows || [];
  if (rows.length === 0) {
    return json(200, { processed: 0, sent: 0, failed: 0, skipped: 0 });
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  // 2. Per-row dispatch. Errors are contained to the row.
  await Promise.all(rows.map(async (row) => {
    try {
      if (row.channel !== "email" && row.channel !== "sms") {
        await failTerminal(admin, row.id, `unsupported_channel:${row.channel}`);
        skipped++;
        return;
      }

      let result:
        | { ok: true; providerMessageId: string | null }
        | { ok: false; retryable: boolean; error: string };
      let provider: string;
      if (row.channel === "sms") {
        // SMS reuses the same row lifecycle as email — no separate
        // architecture. Dedup is the existing atomic claim +
        // idempotent mark_notification_sent.
        result = await sendViaTwilio(row);
        provider = "twilio";
      } else {
        await enrichCustomization(admin, row);
        await enrichStudioName(admin, row);
        const rendered = renderForRow(row);
        result = await sendViaResend(row, rendered);
        provider = "resend";
      }

      if (result.ok) {
        const { error } = await admin.rpc("mark_notification_sent", {
          id_in: row.id,
          provider_in: provider,
          provider_message_id_in: result.providerMessageId,
        });
        if (error) {
          console.error(
            `[process-notification-queue] mark_sent failed for ${row.id}: ${error.message}`,
          );
          failed++;
          return;
        }
        sent++;
        return;
      }

      if (!result.retryable) {
        await failTerminal(admin, row.id, result.error);
        failed++;
        return;
      }

      const { error } = await admin.rpc("mark_notification_failed", {
        id_in: row.id,
        reason_in: result.error,
      });
      if (error) {
        console.error(
          `[process-notification-queue] mark_failed failed for ${row.id}: ${error.message}`,
        );
      }
      failed++;
    } catch (e: any) {
      console.error(
        `[process-notification-queue] row ${row.id} threw:`,
        e?.message || e,
      );
      try {
        await admin.rpc("mark_notification_failed", {
          id_in: row.id,
          reason_in: `worker_exception: ${(e?.message || e).toString().slice(0, 240)}`,
        });
      } catch { /* swallow — next tick will retry */ }
      failed++;
    }
  }));

  return json(200, {
    processed: rows.length,
    sent,
    failed,
    skipped,
  });
});
