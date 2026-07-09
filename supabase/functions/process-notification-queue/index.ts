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
//   4. Channels: email (Resend) and SMS (Twilio). SMS rows consume
//      one prepaid credit per send and refund it on Twilio failure.
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
// Marketing-from is intentionally separate so transactional
// (booking confirmations, balance paid, etc.) stay on noreply@ while
// marketing (rebook nudges, win-backs) come from a friendlier
// hello@ identity. Falls back to the transactional sender when the
// marketing env var isn't set, so a misconfigured deploy still
// sends instead of silently dropping.
const RESEND_MARKETING_FROM_EMAIL =
  Deno.env.get("RESEND_MARKETING_FROM_EMAIL") || RESEND_FROM_EMAIL;

// Owner-facing notifications are sent TO the stylist (alerts, not client
// touchpoints). Their From name is the platform — "Braid Boss Pro" — so
// the stylist instantly recognizes them as system alerts. Everything
// else is client-facing and uses the studio's own name (see below).
const OWNER_FACING_NOTIFICATION_TYPES = new Set<string>([
  "stylist_new_booking",
  "stylist_deposit_paid",
  "stylist_booking_cancelled",
  "stylist_booking_rescheduled",
  "stylist_label_printed",
  "client_message_owner_alert",
  "contract_signed_owner_alert",
  "contract_reminder_owner_alert",
  "booking_refund_manual_stylist",
  "review_received",
  "daily_sales_summary",
  "founding_welcome",
]);

// Pull the bare address out of a "Name <addr>" or plain "addr" string.
const bareAddress = (addr: string): string => {
  const m = (addr || "").match(/<([^>]+)>/);
  return (m ? m[1] : addr).trim();
};

// Build the From header with an explicit display name. A bare address
// (e.g. "hello@braidbosspro.app") makes inbox clients fall back to just
// the local part ("hello") as the sender, which looks unbranded. Because
// Braid Boss Pro is multi-tenant on one shared sending address, the
// display name is chosen PER MESSAGE: each stylist's clients see that
// stylist's studio name, owner alerts read "Braid Boss Pro", and we fall
// back to the platform name when a studio name isn't available.
const formatFrom = (displayName: string, addr: string): string => {
  const a = bareAddress(addr);
  const name = (displayName || "").trim();
  if (!a) return a;
  if (!name) return a;
  // Quote + escape the display name per RFC 5322 (it may contain "@", a
  // ".", or stray quotes from a free-text studio name).
  const safe = name.replace(/[\\"]/g, (c) => "\\" + c);
  return `"${safe}" <${a}>`;
};

// The sender display name for a given queue row, per the per-tenant rule.
const senderDisplayName = (row: ClaimedRow): string => {
  if (OWNER_FACING_NOTIFICATION_TYPES.has(row.notification_type)) return "Braid Boss Pro";
  const studio = String((row.payload as any)?.studioName || "").trim();
  return studio || "Braid Boss Pro";
};
// Notification types treated as marketing for sender selection.
// Must be kept in sync with the suppression rules in the queue
// processor — opt-out (clients.marketing_emails_enabled=false) is
// already enforced at the enqueue step in process_rebook_nudges,
// but we use the same set here to pick the right FROM.
const MARKETING_NOTIFICATION_TYPES = new Set<string>([
  "rebook_nudge",
  "birthday_greeting",
  "winback",
  "new_client_welcome",
  "marketing_campaign",
  "reorder_nudge",
]);
// .trim() every Twilio credential: dashboard paste regularly tacks a
// trailing newline/space onto a secret, and Twilio rejects e.g. a
// MessagingServiceSid with a stray "\n" as error 21705 (invalid SID).
const TWILIO_ACCOUNT_SID = (Deno.env.get("TWILIO_ACCOUNT_SID") || "").trim();
const TWILIO_AUTH_TOKEN = (Deno.env.get("TWILIO_AUTH_TOKEN") || "").trim();
const TWILIO_PHONE_NUMBER = (Deno.env.get("TWILIO_PHONE_NUMBER") || "").trim();
// Preferred sender. A Messaging Service (MG...) lets Twilio pick the
// right number from its sender pool and carries the toll-free / A2P
// registration. When set we send with MessagingServiceSid instead of a
// bare From number; TWILIO_PHONE_NUMBER stays as the fallback so an
// older single-number deploy keeps working.
const TWILIO_MESSAGING_SERVICE_SID =
  (Deno.env.get("TWILIO_MESSAGING_SERVICE_SID") || "").trim();
// Where Twilio POSTs delivery receipts (twilio-status edge function),
// which flip the queue row to delivered/failed and refund undelivered
// sends. Defaults to this project's functions domain; override if needed.
const TWILIO_STATUS_CALLBACK_URL =
  Deno.env.get("TWILIO_STATUS_CALLBACK_URL") ||
  (SUPABASE_URL
    ? `https://${new URL(SUPABASE_URL).hostname.split(".")[0]}.functions.supabase.co/twilio-status`
    : "");

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
  // Provider message id (Twilio SID / Resend id). Normally null for a
  // freshly-queued row; non-null means a PRIOR dispatch attempt already
  // handed this message to the provider — see the idempotency guard in
  // the dispatch loop.
  provider_message_id: string | null;
};

// =====================================================================
// Renderers — Braid Boss Pro 2026 brand palette: white surfaces with
// vibrant purple → lavender → coral accents (mirrors the in-app tokens
// in app/page.tsx). Single inline stylesheet, no external CSS,
// mobile-safe layout. Templates avoid images and webfonts so they
// render cleanly across every client. Key names are kept stable
// (gold/goldDeep/cream…) so every existing template inherits the new
// brand colors without per-template edits.
// =====================================================================
const C = {
  espresso: "#15111A",   // ink — primary headings
  coffee: "#3D3447",     // body copy
  cream: "#FFFFFF",      // page + light-on-dark text (now pure white)
  paper: "#FFFFFF",      // card surface
  hairline: "#ECE7F2",   // soft purple-tinted hairline border
  muted: "#6F6477",      // captions / footnotes
  gold: "#7C3AED",       // brand purple — eyebrows & primary accent
  goldDeep: "#5B21B6",   // deep purple
  // Bright brand accents for multicolor emphasis.
  purple: "#7C3AED",
  purpleDeep: "#5B21B6",
  lavender: "#B14BE0",
  coral: "#FF4D6D",
  coralDeep: "#E0354F",
  tint: "#F6F2FF",       // faint lavender wash for inset boxes
};

// Primary brand gradient (purple → coral). Used as the CTA fill, with a
// solid purple fallback for clients that drop background-image.
const BRAND_GRADIENT = "linear-gradient(135deg,#7C3AED 0%,#B14BE0 45%,#FF4D6D 100%)";

const escape = (s: unknown): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Normalize a stored date to US MM/DD/YYYY for display. Accepts an
// ISO `YYYY-MM-DD` (the shape the enqueue RPCs persist), with or
// without a trailing time. Anything that doesn't match is returned
// trimmed and unchanged so unexpected formats never break rendering.
const fmtDate = (raw: unknown): string | null => {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : s;
};

// Multicolor wordmark masthead — "Braid Boss Pro" rendered bright and
// bold across the three brand hues (purple / lavender / coral) on
// white, matching the in-app header. Serif stack only (no webfont) so
// it renders everywhere.
const masthead = `
  <div style="text-align:center;margin:0 0 22px;">
    <span style="font-family:Georgia,'Times New Roman',serif;font-size:26px;font-weight:700;letter-spacing:0.01em;line-height:1;">
      <span style="color:${C.purple};">Braid</span> <span style="color:${C.lavender};">Boss</span> <span style="color:${C.coral};">Pro</span>
    </span>
  </div>`;

const wrapHtml = (title: string, body: string): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title>
<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only">
<style>:root{color-scheme:light only;supported-color-schemes:light only;}</style></head>
<body style="margin:0;background:#FFFFFF;color-scheme:light only;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${C.espresso};">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    ${masthead}
    <div style="background:${C.paper};border:1px solid ${C.hairline};border-radius:16px;padding:28px;box-shadow:0 6px 22px -12px rgba(124,58,237,0.28);">
      ${body}
    </div>
    <p style="text-align:center;font-size:11px;color:${C.muted};margin-top:18px;">
      Sent by <span style="color:${C.purple};font-weight:600;">Braid Boss Pro</span>
    </p>
  </div>
</body></html>`;

const ctaButton = (label: string, url: string): string => `
  <p style="margin:22px 0;text-align:center;">
    <a href="${escape(url)}" style="display:inline-block;background:${C.purple};background-image:${BRAND_GRADIENT};color:#FFFFFF;text-decoration:none;padding:14px 26px;border-radius:999px;font-weight:700;font-size:14px;letter-spacing:0.04em;">
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
// Intake / consultation answers. Renders the client's booking-time
// answers as a labeled Q/A list. Empty / absent → renders nothing.
const intakeBlock = (p: Record<string, any>): string => {
  const raw = Array.isArray(p.intakeAnswers) ? p.intakeAnswers : [];
  const items = raw
    .map((x: any) => ({ q: String(x?.q ?? "").trim(), a: String(x?.a ?? "").trim() }))
    .filter((x: { q: string; a: string }) => x.q && x.a);
  if (items.length === 0) return "";
  const rows = items
    .map(
      (x: { q: string; a: string }) =>
        `<div style="margin:0 0 10px;"><p style="font-size:12px;color:${C.muted};margin:0 0 2px;">${escape(x.q)}</p><p style="font-size:14px;color:${C.espresso};margin:0;font-weight:600;">${escape(x.a)}</p></div>`,
    )
    .join("");
  return `
    <p style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:${C.goldDeep};margin:16px 0 8px;font-weight:700;">Consultation</p>
    <div style="border-top:1px solid ${C.hairline};padding-top:10px;">${rows}</div>
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
// Hair-to-bring callout — shown when the service is client-supplied and
// the stylist filled in a hair spec (payload.hairBring). Empty otherwise.
const hairBringBlock = (p: Record<string, any>): string => {
  const hair = String(p.hairBring ?? "").trim();
  if (!hair) return "";
  return `<div style="margin-top:12px;padding:12px 14px;border-radius:12px;background:${C.tint};border:1px solid ${C.hairline};">
    <p style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${C.goldDeep};margin:0 0 4px;font-weight:700;">Hair to bring</p>
    <p style="font-size:13px;line-height:20px;color:${C.coffee};margin:0;">${escape(hair)}</p>
  </div>`;
};

const portalButton = (p: Record<string, any>): string => {
  const url = String(p.portalUrl || "").trim();
  if (!url) return "";
  return `<p style="margin:20px 0 4px;text-align:center;"><a href="${escape(url)}" style="display:inline-block;background:transparent;color:${C.espresso};text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:600;font-size:13px;letter-spacing:0.04em;border:1.5px solid ${C.espresso};">View appointment details</a></p>`;
};

// A one-line "Appointment for: <name>" banner, shown in client-facing
// emails when the booking was made for someone else (e.g. a parent
// booking for their child). Renders nothing when it's for the client.
const recipientLine = (p: Record<string, any>): string => {
  const who = String(p.bookedForName ?? "").trim();
  if (!who) return "";
  return `<p style="font-size:13px;line-height:20px;margin:0 0 14px;color:${C.coffee};"><span style="color:${C.muted};">Appointment for:</span> <strong style="color:${C.espresso};">${escape(who)}</strong></p>`;
};

// ---- booking_confirmation -------------------------------------------
const renderBookingConfirmation = (p: Record<string, any>) => {
  const clientName  = p.clientName  || "there";
  const studioName  = p.studioName  || "your stylist";
  const serviceName = p.serviceName || null;
  const date        = fmtDate(p.preferredDate);
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
    ${recipientLine(p)}
    ${customizationBlock(p)}
    ${hairBringBlock(p)}
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

// ---- contract_signed_owner_alert (stylist's records copy) -----------
// Sent to the stylist the moment a client signs. Unlike the other
// contract emails (which are client-facing invites), this one is the
// stylist's documented PROOF: the full agreement snapshot exactly as
// signed, plus the signature audit trail (typed signature, initials,
// signed timestamp, IP, device). Keeps the "Braid Boss Pro" system
// framing — it's an internal records email, not a client touchpoint.
const renderContractSignedOwnerAlert = (p: Record<string, any>) => {
  const studioName    = p.studioName    || "your studio";
  const contractTitle = p.contractTitle || "Appointment agreement";
  const serviceName   = p.serviceName   || null;
  const clientName    = p.clientName    || "Client";
  const clientEmail   = String(p.clientEmail   || "").trim();
  const clientPhone   = String(p.clientPhone   || "").trim();
  const bodySnapshot  = String(p.bodySnapshot  || "").trim();
  const signedName    = p.signedName    || clientName;
  const signatureText = String(p.signatureText || "").trim();
  const initials      = String(p.initials      || "").trim();
  const signedDate    = String(p.signedDate    || "").trim();
  const signedAt      = String(p.signedAt      || "").trim();
  const ipAddress     = String(p.ipAddress     || "").trim();
  const userAgent     = String(p.userAgent     || "").trim();

  // Human-readable signed timestamp in UTC, falling back to the date.
  let signedStamp = signedDate;
  if (signedAt) {
    const d = new Date(signedAt);
    if (!isNaN(d.getTime())) {
      signedStamp = `${d.toISOString().replace("T", " ").slice(0, 16)} UTC`;
    }
  }

  const subject = `Signed contract: ${contractTitle} — ${signedName}`;

  const metaRow = (label: string, value: string) =>
    value
      ? `<tr><td style="padding:4px 0;color:${C.muted};font-size:13px;vertical-align:top;white-space:nowrap;">${escape(label)}</td><td style="padding:4px 0 4px 14px;color:${C.espresso};font-size:13px;font-weight:600;vertical-align:top;word-break:break-word;">${escape(value)}</td></tr>`
      : "";

  const agreementBody = bodySnapshot
    ? plainTextToHtml(bodySnapshot)
    : `<p style="font-size:14px;color:${C.muted};margin:0;">(Agreement text unavailable.)</p>`;

  const html = wrapHtml(subject, `
    <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.goldDeep};margin:0 0 10px;font-weight:700;">Signed contract — your copy</p>
    <h1 style="font-size:20px;line-height:1.3;margin:0 0 12px;color:${C.espresso};">${escape(signedName)} signed ${escape(contractTitle)}.</h1>
    <p style="font-size:14px;line-height:22px;margin:0 0 16px;color:${C.coffee};">
      Keep this email for your records — it's your documented copy of the agreement ${escape(clientName)} signed${serviceName ? ` for <strong>${escape(serviceName)}</strong>` : ""} at ${escape(studioName)}.
    </p>
    <table style="width:100%;border-collapse:collapse;border-top:1px solid ${C.hairline};border-bottom:1px solid ${C.hairline};margin:0 0 18px;">
      ${metaRow("Client", clientName)}
      ${metaRow("Email", clientEmail)}
      ${metaRow("Phone", clientPhone)}
      ${metaRow("Service", serviceName || "")}
      ${metaRow("Signed", signedStamp)}
    </table>
    <p style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:${C.goldDeep};margin:0 0 8px;font-weight:700;">Agreement</p>
    <p style="font-size:15px;font-weight:700;margin:0 0 8px;color:${C.espresso};">${escape(contractTitle)}</p>
    <div style="font-size:14px;line-height:22px;color:${C.coffee};border-left:3px solid ${C.hairline};padding-left:14px;margin:0 0 18px;">
      ${agreementBody}
    </div>
    <p style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:${C.goldDeep};margin:0 0 8px;font-weight:700;">Signature</p>
    <table style="width:100%;border-collapse:collapse;border-top:1px solid ${C.hairline};border-bottom:1px solid ${C.hairline};">
      ${metaRow("Signed by", signedName)}
      ${metaRow("Signature", signatureText)}
      ${metaRow("Initials", initials)}
      ${metaRow("Date", signedStamp)}
      ${metaRow("IP address", ipAddress)}
      ${metaRow("Device", userAgent)}
    </table>
    <p style="font-size:12px;color:${C.muted};line-height:18px;margin-top:18px;">
      Automated records copy from Braid Boss Pro. The signing details above were captured at the time ${escape(clientName)} submitted their signature.
    </p>
  `);
  return { subject, html };
};

// ---- contract_reminder_owner_alert (stylist heads-up) ---------------
// Sent to the stylist when the 7-day unsigned-contract reminder fires:
// "we nudged the client, they still haven't signed." Lets the stylist
// decide whether to follow up personally. System framing, not a
// client touchpoint.
const renderContractReminderOwnerAlert = (p: Record<string, any>) => {
  const studioName    = p.studioName    || "your studio";
  const contractTitle = p.contractTitle || "Appointment agreement";
  const serviceName   = p.serviceName   || null;
  const clientName    = p.clientName    || "Your client";
  const clientEmail   = String(p.clientEmail || "").trim();
  const daysUnsigned  = Number(p.daysUnsigned) > 0 ? Number(p.daysUnsigned) : null;
  const contractUrl   = String(p.contractUrl || "").trim();

  const subject = `Reminder sent: ${contractTitle} still unsigned by ${clientName}`;
  const html = wrapHtml(subject, `
    <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.goldDeep};margin:0 0 10px;font-weight:700;">Still unsigned</p>
    <h1 style="font-size:20px;line-height:1.3;margin:0 0 12px;color:${C.espresso};">${escape(clientName)} hasn't signed yet.</h1>
    <p style="font-size:14px;line-height:22px;margin:0 0 14px;color:${C.coffee};">
      <strong>${escape(contractTitle)}</strong>${serviceName ? ` (for ${escape(serviceName)})` : ""} has been outstanding${daysUnsigned ? ` for ${daysUnsigned} day${daysUnsigned === 1 ? "" : "s"}` : ""} at ${escape(studioName)}. We just sent ${escape(clientName)} a reminder to review and sign.
    </p>
    <table style="width:100%;border-collapse:collapse;border-top:1px solid ${C.hairline};border-bottom:1px solid ${C.hairline};margin:0 0 16px;">
      <tr><td style="padding:4px 0;color:${C.muted};font-size:13px;">Client</td><td style="padding:4px 0 4px 14px;text-align:right;color:${C.espresso};font-size:13px;font-weight:600;">${escape(clientName)}</td></tr>
      ${clientEmail ? `<tr><td style="padding:4px 0;color:${C.muted};font-size:13px;">Email</td><td style="padding:4px 0 4px 14px;text-align:right;color:${C.espresso};font-size:13px;font-weight:600;word-break:break-word;">${escape(clientEmail)}</td></tr>` : ""}
    </table>
    <p style="font-size:13px;line-height:20px;margin:0 0 14px;color:${C.coffee};">
      Want to follow up personally? Reach out to ${escape(clientName)} directly${clientEmail ? ` at ${escape(clientEmail)}` : ""}, or share the signing link again.
    </p>
    ${contractUrl ? ctaButton("View the signing link", contractUrl) : ""}
    <p style="font-size:12px;color:${C.muted};line-height:18px;margin-top:18px;">
      Automated alert from Braid Boss Pro. You'll get a signed copy here the moment ${escape(clientName)} completes it.
    </p>
  `);
  return { subject, html };
};

// ---- appointment_approved ------------------------------------------
const renderAppointmentApproved = (p: Record<string, any>) => {
  const clientName  = p.clientName  || "there";
  const studioName  = p.studioName  || "your stylist";
  const serviceName = p.serviceName || null;
  const date        = fmtDate(p.preferredDate);
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
    ${recipientLine(p)}
    ${customizationBlock(p)}
    ${intakeBlock(p)}
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
  const date        = fmtDate(p.preferredDate);
  const time        = p.preferredTime || null;
  const when        = [date, time].filter(Boolean).join(" · ");
  // Pay-in-full BNPL bookings reuse this notification type but should
  // read as a full payment, not a deposit.
  const paidInFull  = !!p.paidInFull;
  const amountPaid  = Number(p.amountPaid) > 0 ? Number(p.amountPaid) : null;
  const eyebrow     = paidInFull ? "Payment received" : "Deposit received";
  const subject = paidInFull
    ? `Payment received — pending ${studioName}'s approval`
    : `Deposit received — pending ${studioName}'s approval`;
  const html = wrapHtml(subject, `
    <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.goldDeep};margin:0 0 10px;font-weight:700;">${eyebrow}</p>
    <h1 style="font-size:20px;margin:0 0 12px;color:${C.espresso};">Thanks, ${escape(clientName)}.</h1>
    <p style="font-size:14px;line-height:22px;color:${C.coffee};">
      ${paidInFull
        ? `We received your payment${amountPaid ? ` of <strong>$${amountPaid.toFixed(2)}</strong>` : " in full"} for your`
        : "We received your deposit for your"}${serviceName ? ` <strong>${escape(serviceName)}</strong>` : ""} request${when ? ` on <strong>${escape(when)}</strong>` : ""}.
    </p>
    <p style="font-size:14px;line-height:22px;color:${C.coffee};">
      <strong>Your appointment isn't confirmed yet.</strong> ${escape(studioName).replace(/^./, (c) => c.toUpperCase())} still needs to review and approve it — we'll email you to confirm as soon as that happens.
    </p>
    ${customizationBlock(p)}
    ${contractBlock(p)}
    <p style="font-size:12px;color:${C.muted};line-height:18px;">
      No action needed right now. Reach out if anything changes.
    </p>
  `);
  return { subject, html };
};

// ---- stylist_deposit_paid (notify stylist: paid booking to review) -
// Fires from the deposit webhook once a deposit clears. This is the
// stylist's first ping about the request — unpaid requests stay quiet.
const renderStylistDepositPaid = (p: Record<string, any>) => {
  const clientName  = p.clientName  || "A client";
  const serviceName = p.serviceName || null;
  const date        = fmtDate(p.preferredDate);
  const time        = p.preferredTime || null;
  const when        = [date, time].filter(Boolean).join(" · ");
  const subject = `New paid booking — ${clientName}`;
  const html = wrapHtml(subject, `
    <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.goldDeep};margin:0 0 10px;font-weight:700;">Deposit paid</p>
    <h1 style="font-size:20px;line-height:1.25;margin:0 0 12px;color:${C.espresso};">${escape(clientName)} paid their deposit.</h1>
    <p style="font-size:14px;line-height:22px;margin:0 0 10px;color:${C.coffee};">${serviceName ? `<strong>${escape(serviceName)}</strong>` : ""}${serviceName && when ? " · " : ""}${when ? `<strong>${escape(when)}</strong>` : ""}</p>
    <p style="font-size:14px;line-height:22px;margin:0 0 14px;color:${C.coffee};">The deposit has cleared and the request is waiting for your approval. Open Braid Boss Pro to review and confirm.</p>
    <p style="font-size:12px;color:${C.muted};line-height:18px;margin-top:18px;">You're only notified once a deposit clears — unpaid requests stay quiet.</p>
  `);
  return { subject, html };
};

// ---- stylist_new_booking (notify stylist: no-deposit request) ------
// Fires from enqueue_public_booking_emails the moment a NO-DEPOSIT
// request lands. Deposit-first requests stay quiet until their deposit
// clears (renderStylistDepositPaid handles those); a no-deposit request
// is a real booking on arrival, so the stylist hears about it now.
const renderStylistNewBooking = (p: Record<string, any>) => {
  const clientName  = p.clientName  || "A client";
  const serviceName = p.serviceName || null;
  const date        = fmtDate(p.preferredDate);
  const time        = p.preferredTime || null;
  const when        = [date, time].filter(Boolean).join(" · ");
  const subject = `New booking request — ${clientName}`;
  const html = wrapHtml(subject, `
    <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.goldDeep};margin:0 0 10px;font-weight:700;">New request</p>
    <h1 style="font-size:20px;line-height:1.25;margin:0 0 12px;color:${C.espresso};">${escape(clientName)} requested a booking.</h1>
    <p style="font-size:14px;line-height:22px;margin:0 0 10px;color:${C.coffee};">${serviceName ? `<strong>${escape(serviceName)}</strong>` : ""}${serviceName && when ? " · " : ""}${when ? `<strong>${escape(when)}</strong>` : ""}</p>
    <p style="font-size:14px;line-height:22px;margin:0 0 14px;color:${C.coffee};">This request doesn't require a deposit, so it's waiting on you. Open Braid Boss Pro to review and confirm it onto your calendar — or decline.</p>
  `);
  return { subject, html };
};

// ---- client_message_owner_alert (notify stylist: client wrote in) ---
// The in-app bell + web push already fire from public_post_client_message
// the instant a client posts. This is the email half so the stylist
// still hears about a new client message when the app is closed.
// Recipient is the stylist, so no client-facing studio framing.
const renderClientMessageOwnerAlert = (p: Record<string, any>) => {
  const clientName = p.clientName || "A client";
  const preview = String(p.messagePreview || "").trim();
  // Deep-link straight to the Inbox (?focus=inbox) instead of the bare
  // site root, which would land the stylist on the marketing page.
  const base = (Deno.env.get("NEXT_PUBLIC_SITE_URL") || String(p.appUrl || "") || "https://braidbosspro.app").replace(/\/$/, "");
  const inboxUrl = `${base}/?focus=inbox`;
  const subject = `New message from ${clientName}`;
  const html = wrapHtml(subject, `
    <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.goldDeep};margin:0 0 10px;font-weight:700;">New message</p>
    <h1 style="font-size:20px;line-height:1.25;margin:0 0 12px;color:${C.espresso};">${escape(clientName)} sent you a message.</h1>
    ${preview ? `<p style="font-size:14px;line-height:22px;margin:0 0 16px;color:${C.coffee};border-left:3px solid ${C.hairline};padding-left:12px;">${escape(preview)}</p>` : ""}
    <p style="font-size:14px;line-height:22px;margin:0 0 4px;color:${C.coffee};">Open Braid Boss Pro to read the full message and reply.</p>
    ${ctaButton("Open messages", inboxUrl)}
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
    ? `<p style="margin:18px 0 8px;text-align:center;"><a href="${reviewUrl}" style="display:inline-block;background:${C.purple};background-image:${BRAND_GRADIENT};color:#FFFFFF;text-decoration:none;padding:14px 26px;border-radius:999px;font-weight:700;font-size:14px;letter-spacing:0.04em;">Leave a review · ★★★★★</a></p>`
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

// ---- review_received (stylist alert: a client left feedback) ------
const renderReviewReceived = (p: Record<string, any>) => {
  const clientName = p.clientName || "A client";
  const studioName = p.studioName || "your studio";
  const serviceName = p.serviceName || null;
  const stars = Math.max(1, Math.min(5, parseInt(String(p.stars), 10) || 5));
  const reviewText = String(p.reviewText || "").trim();
  const appUrl = String(p.appUrl || "").trim();
  const starRow = "★★★★★☆☆☆☆☆".slice(5 - stars, 10 - stars);
  const subject = `New ${stars}-star review from ${clientName}`;
  const cta = appUrl ? ctaButton("Open Braid Boss Pro", appUrl) : "";
  const quote = reviewText
    ? `<p style="font-size:15px;line-height:24px;margin:0 0 16px;color:${C.coffee};border-left:3px solid ${C.goldDeep};padding-left:14px;font-style:italic;">"${escape(reviewText)}"</p>`
    : `<p style="font-size:14px;line-height:22px;margin:0 0 16px;color:${C.muted};">No written note — just the star rating.</p>`;
  const html = wrapHtml(subject, `
    <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.goldDeep};margin:0 0 10px;font-weight:700;">New review</p>
    <h1 style="font-size:22px;line-height:1.25;margin:0 0 12px;color:${C.espresso};">${escape(clientName)} left you a review.</h1>
    <p style="font-size:26px;letter-spacing:4px;margin:0 0 14px;color:${C.goldDeep};">${starRow}</p>
    <p style="font-size:15px;line-height:24px;margin:0 0 14px;color:${C.coffee};">
      ${escape(clientName)} reviewed their visit${serviceName ? ` for <strong>${escape(serviceName)}</strong>` : ""} at ${escape(studioName)}.
    </p>
    ${quote}
    ${cta}
  `);
  return { subject, html };
};

// ---- gift_card_issued (buyer's copy of purchased gift card codes) --
const renderGiftCardIssued = (p: Record<string, any>) => {
  const studioName = p.studioName || "your studio";
  const purchaserName = p.purchaserName || "there";
  const cards: Array<{ code: string; amount: number }> =
    Array.isArray(p.cards) ? p.cards : [];
  const money = (n: unknown) => `$${(Number(n) || 0).toFixed(2)}`;
  const total = cards.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const multi = cards.length > 1;
  const subject = `Your gift card from ${studioName}`;
  const cardBlocks = cards
    .map(
      (c) => `
    <div style="border:1px solid ${C.hairline};border-radius:12px;padding:16px;margin:0 0 10px;text-align:center;background:${C.tint};">
      <p style="font-size:12px;color:${C.muted};margin:0 0 6px;text-transform:uppercase;letter-spacing:0.12em;">${money(c.amount)} gift card</p>
      <p style="font-size:24px;font-weight:700;letter-spacing:2px;margin:0;color:${C.espresso};font-family:'Courier New',monospace;">${escape(c.code)}</p>
    </div>`,
    )
    .join("");
  const html = wrapHtml(subject, `
    <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.goldDeep};margin:0 0 10px;font-weight:700;">Gift card</p>
    <h1 style="font-size:22px;line-height:1.25;margin:0 0 14px;color:${C.espresso};">Thank you, ${escape(purchaserName)}.</h1>
    <p style="font-size:15px;line-height:24px;margin:0 0 16px;color:${C.coffee};">
      Here ${multi ? "are your gift cards" : "is your gift card"} for ${escape(studioName)}${multi ? ` — ${money(total)} total` : ""}.
      Keep ${multi ? "these codes" : "this code"} safe and share with whoever ${multi ? "they're" : "it's"} for.
    </p>
    ${cardBlocks}
    <p style="font-size:13px;line-height:21px;margin:14px 0 0;color:${C.muted};">
      Redeemable toward ${escape(studioName)}'s services and products.
    </p>
  `);
  return { subject, html };
};

// ---- appointment_confirmed (final approval — deposit already in) ---
// Distinct from `appointment_approved`, which is the earlier "please
// pay your deposit" approval email. This one fires after the stylist
// taps Approve & schedule on a deposit-paid request, so the client
// gets a clean "officially booked" confirmation with date, time,
// and remaining balance.
const renderAppointmentConfirmed = (p: Record<string, any>) => {
  const clientName = p.clientName || "there";
  const studioName = p.studioName || "your stylist";
  const serviceName = p.serviceName || null;
  const date = fmtDate(p.preferredDate);
  const time = p.preferredTime || null;
  const when = [date, time].filter(Boolean).join(" · ");
  const depositPaid = Number(p.depositPaid) > 0 ? Number(p.depositPaid) : null;
  const remainingBalance =
    p.remainingBalance != null && Number(p.remainingBalance) >= 0
      ? Number(p.remainingBalance)
      : null;

  const subject = `Your appointment is confirmed with ${studioName}`;
  // Optional stylist note (Square-style) — appears at the top of the
  // confirmation, above the standard details.
  const customMessage = String(p.customMessage || "").trim();
  const messageBlock = customMessage
    ? `<div style="background:${C.tint};border:1px solid ${C.hairline};border-radius:12px;padding:12px 14px;margin:0 0 16px;">
         <p style="font-size:14px;line-height:21px;margin:0;color:${C.coffee};white-space:pre-wrap;">${escape(customMessage)}</p>
       </div>`
    : "";
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
    ${messageBlock}
    <p style="font-size:15px;line-height:24px;margin:0 0 14px;">
      ${escape(studioName)} approved and scheduled your appointment${serviceName ? ` for <strong>${escape(serviceName)}</strong>` : ""}${when ? ` on <strong>${escape(when)}</strong>` : ""}.
    </p>
    ${recipientLine(p)}
    ${balanceLine}
    ${customizationBlock(p)}
    ${hairBringBlock(p)}
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
  const date = fmtDate(p.preferredDate);
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
      <p style="margin:0 0 18px;"><a href="${escape(rescheduleUrl)}" style="display:inline-block;background:${C.purple};background-image:${BRAND_GRADIENT};color:#FFFFFF;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:700;font-size:13px;letter-spacing:0.04em;">Reschedule appointment</a></p>`
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
    <h1 style="font-size:22px;line-height:1.25;margin:0 0 14px;color:${C.espresso};">See you soon, <span style="color:${C.purple};">${escape(clientName)}</span>.</h1>
    <p style="font-size:15px;line-height:24px;margin:0 0 14px;color:${C.coffee};">Your appointment with <strong style="color:${C.purpleDeep};">${escape(studioName)}</strong>${serviceName ? ` for <strong style="color:${C.coralDeep};">${escape(serviceName)}</strong>` : ""}${when ? ` is on <strong style="color:${C.espresso};">${escape(when)}</strong>` : " is coming up soon"}.</p>
    ${recipientLine(p)}
    ${customizationBlock(p)}
    ${hairBringBlock(p)}
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
  const date = fmtDate(p.preferredDate);
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
  const date = fmtDate(p.preferredDate);
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
  const newDate = fmtDate(p.preferredDate);
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
  const d = fmtDate(p.preferredDate) || "";
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
  const paidInFull = !!p.paidInFull;
  const refundedWhat = paidInFull ? "payment" : "deposit";
  const subject = `Booking request refunded — ${studioName}`;
  const html = wrapHtml(subject, `
    <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.goldDeep};margin:0 0 10px;font-weight:700;">Refund issued</p>
    <h1 style="font-size:20px;line-height:1.25;margin:0 0 14px;color:${C.espresso};">Hi ${escape(clientName)},</h1>
    <p style="font-size:14px;line-height:22px;margin:0 0 12px;color:${C.coffee};">
      Your booking request${serviceName ? ` for <strong>${escape(serviceName)}</strong>` : ""} with ${escape(studioName)} was not approved. <strong>Your ${refundedWhat}${refundAmount ? ` of $${refundAmount.toFixed(2)}` : ""} has been refunded.</strong>
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
  const newWhen = [fmtDate(p.preferredDate), p.preferredTime || null].filter(Boolean).join(" · ");
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

// ---- appointment_updated (stylist edited an existing appt) ---------
// One consolidated notice when a stylist changes any mix of date/time,
// total price, or add-ons on an existing appointment. The save path
// detects everything that moved and enqueues this once, so the client
// gets a single email instead of one per field. Per-category flags
// (changedDate / changedTime / changedPrice / changedAddons) drive
// which "what changed" lines show; the details table always reflects
// the new state. Add-on names come in explicitly via currentAddonNames
// (the edit isn't mirrored to booking_requests, so enrichment would be
// stale).
const renderAppointmentUpdated = (p: Record<string, any>) => {
  const clientName  = p.clientName  || "there";
  const studioName  = p.studioName  || "your stylist";
  const serviceName = p.serviceName || null;
  const currency    = String(p.currency || "USD").toUpperCase();
  const money = (n: unknown): string => {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    try { return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(v); }
    catch { return `$${v.toFixed(2)}`; }
  };
  const newWhen = [fmtDate(p.preferredDate), p.preferredTime || null].filter(Boolean).join(" · ");
  const oldWhen = [p.fromDate || null, p.fromTime || null].filter(Boolean).join(" · ");
  const cancelUrl = String(p.cancelUrl || "").trim();
  const addonNames: string[] = Array.isArray(p.currentAddonNames)
    ? p.currentAddonNames.map((a: unknown) => String(a ?? "").trim()).filter(Boolean)
    : [];
  const changedDateOrTime = !!p.changedDate || !!p.changedTime;
  const changedPrice  = !!p.changedPrice;
  const changedAddons = !!p.changedAddons;
  const changedOption = !!p.changedOption;
  const optionName = String(p.optionName ?? "").trim();
  const changedHairColor = !!p.changedHairColor;
  const changedCurl = !!p.changedCurl;
  const hairColor = String(p.hairColor ?? "").trim();
  const curlPattern = String(p.curlPattern ?? "").trim();
  const hasPrice = p.totalPrice != null && Number.isFinite(Number(p.totalPrice)) && Number(p.totalPrice) > 0;

  // "What changed" — only the categories that actually moved.
  const liStyle = `font-size:14px;line-height:22px;margin:0 0 8px;color:${C.coffee};`;
  const changeLines: string[] = [];
  if (changedDateOrTime && newWhen) {
    changeLines.push(`<li style="${liStyle}">New date &amp; time: <strong>${escape(newWhen)}</strong>${oldWhen ? ` <span style="color:${C.muted};">(was ${escape(oldWhen)})</span>` : ""}</li>`);
  }
  if (changedOption && optionName) {
    changeLines.push(`<li style="${liStyle}">Option: <strong>${escape(optionName)}</strong></li>`);
  }
  if (changedHairColor && hairColor) {
    changeLines.push(`<li style="${liStyle}">Hair color: <strong>${escape(hairColor)}</strong></li>`);
  }
  if (changedCurl && curlPattern) {
    changeLines.push(`<li style="${liStyle}">Curl pattern: <strong>${escape(curlPattern)}</strong></li>`);
  }
  if (changedAddons) {
    changeLines.push(`<li style="${liStyle}">Add-ons: <strong>${addonNames.length ? escape(addonNames.join(", ")) : "none"}</strong></li>`);
  }
  if (changedPrice) {
    const wasPrice = (p.fromPrice != null && Number.isFinite(Number(p.fromPrice)))
      ? ` <span style="color:${C.muted};">(was ${escape(money(p.fromPrice))})</span>` : "";
    changeLines.push(`<li style="${liStyle}">Updated total: <strong>${escape(money(p.totalPrice))}</strong>${wasPrice}</li>`);
  }
  const changedList = changeLines.length
    ? `<ul style="margin:0 0 4px;padding-left:18px;">${changeLines.join("")}</ul>`
    : "";

  // Current-state details — always the new booking.
  const trow = (label: string, value: string) =>
    `<tr><td style="padding:4px 0;color:${C.muted};font-size:13px;vertical-align:top;">${escape(label)}</td><td style="padding:4px 0 4px 14px;text-align:right;color:${C.espresso};font-size:13px;font-weight:600;vertical-align:top;">${value}</td></tr>`;
  const detailRows: string[] = [];
  if (serviceName)      detailRows.push(trow("Service", escape(serviceName)));
  if (newWhen)          detailRows.push(trow("When", escape(newWhen)));
  if (addonNames.length) detailRows.push(trow("Add-ons", addonNames.map((a) => escape(a)).join(", ")));
  if (hasPrice)         detailRows.push(trow("Total", escape(money(p.totalPrice))));
  const detailsTable = detailRows.length
    ? `<p style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:${C.goldDeep};margin:18px 0 6px;font-weight:700;">Your appointment</p><table style="width:100%;border-collapse:collapse;border-top:1px solid ${C.hairline};border-bottom:1px solid ${C.hairline};">${detailRows.join("")}</table>`
    : "";

  const subject = `Your appointment with ${studioName} was updated`;
  const html = wrapHtml(subject, `
    <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.goldDeep};margin:0 0 10px;font-weight:700;">Appointment updated</p>
    <h1 style="font-size:22px;line-height:1.25;margin:0 0 14px;color:${C.espresso};">Here's your updated appointment, ${escape(clientName)}.</h1>
    <p style="font-size:15px;line-height:24px;margin:0 0 14px;color:${C.coffee};">
      ${escape(studioName)} made a change to your${serviceName ? ` <strong>${escape(serviceName)}</strong>` : ""} appointment. Here's what's new:
    </p>
    ${changedList}
    ${detailsTable}
    ${portalButton(p)}
    <p style="font-size:13px;color:${C.muted};line-height:20px;margin:14px 0;">No action needed — your booking and any deposit carry over. If something doesn't look right, reply to this email and your stylist will help.</p>
    ${cancelUrl ? `<hr style="border:none;border-top:1px solid ${C.hairline};margin:18px 0;" /><p style="margin:0 0 8px;font-size:13px;font-weight:600;color:${C.espresso};">Need to cancel?</p><p style="margin:0 0 10px;font-size:12px;line-height:18px;color:${C.coffee};">You can cancel from the link below. Your deposit is handled per your stylist's policy.</p><p style="margin:0;"><a href="${escape(cancelUrl)}" style="display:inline-block;background:transparent;color:${C.espresso};text-decoration:none;padding:10px 20px;border-radius:999px;font-weight:600;font-size:12px;letter-spacing:0.04em;border:1.5px solid ${C.espresso};">Cancel appointment</a></p>` : ""}
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
      <div style="background:${C.tint};border:1px solid ${C.hairline};border-radius:12px;padding:14px 16px;margin:0 0 14px;">
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
      <div style="background:${C.tint};border:1px solid ${C.hairline};border-radius:12px;padding:14px 16px;margin:0 0 14px;">
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

// ---- cart_abandoned (buyer never finished checkout, 24h nudge) -------
// Fires from process_cart_abandoned_nudges (pg_cron, every 30 min). Only
// reaches the buyer when they explicitly ticked the "Remind me" box at
// checkout — opt-in, CAN-SPAM-friendly. One nudge per order, never.
const renderCartAbandoned = (p: Record<string, any>) => {
  const studioName = p.studioName || "your stylist";
  const items     = Array.isArray(p.items) ? p.items : [];
  const orderRef  = p.orderRef || "";
  const returnUrl = String(p.returnUrl || "").trim();
  const itemList  = items.map((it: any) => {
    const qty = Number(it?.quantity) || 1;
    const title = escape(it?.title || "Item");
    const variant = it?.variant_name ? ` — ${escape(it.variant_name)}` : "";
    return `<li style="font-size:14px;line-height:22px;color:${C.coffee};">${qty}× ${title}${variant}</li>`;
  }).join("");
  const subject = `You left items in your cart at ${studioName}`;
  const html = wrapHtml(subject, `
    <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.goldDeep};margin:0 0 10px;font-weight:700;">Your cart is waiting</p>
    <h1 style="font-size:22px;line-height:1.25;margin:0 0 12px;color:${C.espresso};">Pick up where you left off.</h1>
    <p style="font-size:14px;line-height:22px;margin:0 0 14px;color:${C.coffee};">
      You started checking out at <strong>${escape(studioName)}</strong> but didn't finish${orderRef ? ` (cart ref #${escape(orderRef)})` : ""}.
    </p>
    ${items.length > 0 ? `
      <p style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:${C.muted};margin:0 0 6px;font-weight:700;">In your cart</p>
      <ul style="margin:0 0 14px;padding-left:18px;">${itemList}</ul>` : ""}
    ${returnUrl ? ctaButton("Return to shop", returnUrl) : ""}
    <p style="font-size:12px;color:${C.muted};line-height:18px;margin:18px 0 0;">
      You're receiving this because you asked us to remind you. We only send one reminder per cart.
    </p>
  `);
  return { subject, html };
};

// ---- stylist_label_printed (notify stylist: label bought + tracking) -
// Fires from /api/shipping-label right after Shippo bills the stylist's
// account for the prepaid label. Mirrors the buyer-facing order_shipped
// email but addressed to the stylist with a per-order receipt: who it
// shipped to, the carrier/service, the tracking number, and a "View order"
// link back into the Orders screen.
const renderStylistLabelPrinted = (p: Record<string, any>) => {
  const customerName   = p.customerName   || "Customer";
  const orderRef       = p.orderRef       || "";
  const carrier        = String(p.carrier        || "").trim();
  const service        = String(p.service        || "").trim();
  const trackingNumber = String(p.trackingNumber || "").trim();
  const trackingUrl    = String(p.trackingUrl    || "").trim();
  const labelUrl       = String(p.labelUrl       || "").trim();
  const viewOrderUrl   = String(p.viewOrderUrl   || "").trim();
  const cityState      = String(p.shipToCityState || "").trim();
  const labelCost      = Number(p.labelCostUsd);
  const subject = `Label printed — ${customerName}${orderRef ? ` · #${orderRef}` : ""}`;
  const html = wrapHtml(subject, `
    <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.goldDeep};margin:0 0 10px;font-weight:700;">Label printed</p>
    <h1 style="font-size:20px;line-height:1.25;margin:0 0 12px;color:${C.espresso};">Ready to drop off.</h1>
    <p style="font-size:14px;line-height:22px;margin:0 0 14px;color:${C.coffee};">
      Label purchased for <strong>${escape(customerName)}</strong>${cityState ? ` in <strong>${escape(cityState)}</strong>` : ""}${carrier ? ` via <strong>${escape(carrier)}${service ? ` ${escape(service)}` : ""}</strong>` : ""}${Number.isFinite(labelCost) && labelCost > 0 ? ` for <strong>$${labelCost.toFixed(2)}</strong>` : ""}.
    </p>
    ${trackingNumber ? `
      <div style="background:${C.tint};border:1px solid ${C.hairline};border-radius:12px;padding:14px 16px;margin:0 0 14px;">
        <p style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:${C.muted};margin:0 0 6px;font-weight:700;">Tracking</p>
        <p style="font-size:15px;line-height:22px;margin:0;color:${C.espresso};font-weight:600;font-family:SFMono-Regular,Menlo,Monaco,Consolas,monospace;">${escape(trackingNumber)}</p>
        ${trackingUrl ? `<p style="margin:10px 0 0;"><a href="${escape(trackingUrl)}" style="font-size:13px;color:${C.goldDeep};text-decoration:none;font-weight:600;">Open carrier tracking →</a></p>` : ""}
      </div>` : ""}
    ${labelUrl ? `<p style="margin:0 0 14px;"><a href="${escape(labelUrl)}" style="font-size:13px;color:${C.goldDeep};text-decoration:none;font-weight:600;">Reopen label PDF →</a></p>` : ""}
    ${viewOrderUrl ? ctaButton("View order", viewOrderUrl) : ""}
    <p style="font-size:12px;color:${C.muted};line-height:18px;margin:18px 0 0;">
      The buyer was emailed the tracking number separately.
    </p>
  `);
  return { subject, html };
};

// ---- rebook_nudge (marketing: "your style is due for a refresh") ----
// Fired by the daily process_rebook_nudges() cron. CAN-SPAM compliant
// — every render appends an unsubscribe footer with a one-tap opt-out
// link keyed off the recipient's opaque token. Don't omit the
// footer; it's a legal requirement, not a UX nicety.
const renderRebookNudge = (p: Record<string, any>) => {
  const clientName  = p.clientName  || "there";
  const studioName  = p.studioName  || "your stylist";
  const serviceName = p.serviceName || "your style";
  const weeksSince  = Number(p.weeksSince) || null;
  const bookingSlug = String(p.bookingSlug || "").trim();
  const unsubscribeToken = String(p.unsubscribeToken || "").trim();
  const baseUrl = (Deno.env.get("NEXT_PUBLIC_SITE_URL") || "https://braidbosspro.app").replace(/\/$/, "");
  const bookUrl = bookingSlug ? `${baseUrl}/book/${encodeURIComponent(bookingSlug)}` : "";
  const unsubscribeUrl = unsubscribeToken
    ? `${baseUrl}/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`
    : "";

  const subject = `Time to refresh your ${serviceName}?`;
  const html = wrapHtml(subject, `
    <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.goldDeep};margin:0 0 10px;font-weight:700;">Ready for a refresh</p>
    <h1 style="font-size:22px;line-height:1.25;margin:0 0 14px;color:${C.espresso};">Hey ${escape(clientName)},</h1>
    <p style="font-size:15px;line-height:24px;margin:0 0 14px;color:${C.coffee};">
      It's been ${weeksSince ? `<strong>${weeksSince} weeks</strong>` : "a while"} since your last <strong>${escape(serviceName)}</strong> with ${escape(studioName)}. Most clients book their refresh around now — tap below to grab your next spot.
    </p>
    ${bookUrl ? ctaButton("Book now", bookUrl) : ""}
    <p style="font-size:12px;color:${C.muted};line-height:18px;margin:18px 0 0;">
      Questions? Reply to this email and ${escape(studioName)} will be in touch.
    </p>
    ${unsubscribeUrl ? `
      <hr style="border:none;border-top:1px solid ${C.hairline};margin:22px 0 14px;" />
      <p style="font-size:11px;color:${C.muted};line-height:18px;text-align:center;margin:0;">
        You're getting this because you booked with ${escape(studioName)}.
        <a href="${escape(unsubscribeUrl)}" style="color:${C.muted};text-decoration:underline;">Unsubscribe from marketing emails</a>.
      </p>` : ""}
  `);
  return { subject, html };
};

// Shared marketing footer with the CAN-SPAM-required unsubscribe
// link. Built once so all three Phase-2 templates render identically.
const marketingFooter = (p: Record<string, any>, studioName: string): string => {
  const unsubscribeToken = String(p.unsubscribeToken || "").trim();
  const baseUrl = (Deno.env.get("NEXT_PUBLIC_SITE_URL") || "https://braidbosspro.app").replace(/\/$/, "");
  const unsubscribeUrl = unsubscribeToken
    ? `${baseUrl}/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`
    : "";
  if (!unsubscribeUrl) return "";
  return `
    <hr style="border:none;border-top:1px solid ${C.hairline};margin:22px 0 14px;" />
    <p style="font-size:11px;color:${C.muted};line-height:18px;text-align:center;margin:0;">
      You're getting this because you booked with ${escape(studioName)}.
      <a href="${escape(unsubscribeUrl)}" style="color:${C.muted};text-decoration:underline;">Unsubscribe from marketing emails</a>.
    </p>`;
};

const bookUrlOf = (p: Record<string, any>): string => {
  const slug = String(p.bookingSlug || "").trim();
  if (!slug) return "";
  const baseUrl = (Deno.env.get("NEXT_PUBLIC_SITE_URL") || "https://braidbosspro.app").replace(/\/$/, "");
  return `${baseUrl}/book/${encodeURIComponent(slug)}`;
};

// ---- birthday_greeting (marketing) ---------------------------------
// Personal greeting on the client's birthday. No discount in V1 —
// matches the rebook-nudge philosophy. Sent once per client per
// calendar year via dedupe key.
const renderBirthdayGreeting = (p: Record<string, any>) => {
  const clientName = p.clientName || "there";
  const studioName = p.studioName || "your stylist";
  const bookUrl    = bookUrlOf(p);
  const subject    = `Happy birthday from ${studioName}!`;
  const html = wrapHtml(subject, `
    <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.goldDeep};margin:0 0 10px;font-weight:700;">Happy birthday</p>
    <h1 style="font-size:24px;line-height:1.25;margin:0 0 14px;color:${C.espresso};">Happy birthday, ${escape(clientName)}!</h1>
    <p style="font-size:15px;line-height:24px;margin:0 0 14px;color:${C.coffee};">
      Wishing you the best year yet — and a fresh new look whenever you're ready. We'd love to see you back in the chair at <strong>${escape(studioName)}</strong> soon.
    </p>
    ${bookUrl ? ctaButton("Book your birthday style", bookUrl) : ""}
    <p style="font-size:12px;color:${C.muted};line-height:18px;margin:18px 0 0;">
      With love, ${escape(studioName)} 💜
    </p>
    ${marketingFooter(p, studioName)}
  `);
  return { subject, html };
};

// ---- winback (marketing) -------------------------------------------
// Fired on clients 90+ days since their last appointment. Warmer
// tone than the rebook nudge — they've drifted, not just hit a
// maintenance window. Includes how-long-ago + their last style so
// it feels personal, not blasted.
const renderWinback = (p: Record<string, any>) => {
  const clientName = p.clientName || "there";
  const studioName = p.studioName || "your stylist";
  const lastStyle  = p.lastStyle ? String(p.lastStyle) : null;
  const daysSince  = Number(p.daysSince) || null;
  const bookUrl    = bookUrlOf(p);
  const subject    = `We miss you at ${studioName}`;
  // Frame "weeks" or "months" depending on distance — "180 days" reads
  // worse than "about 6 months".
  const sinceLabel = daysSince
    ? daysSince < 60
      ? `${Math.round(daysSince / 7)} weeks`
      : `about ${Math.round(daysSince / 30)} months`
    : null;
  const html = wrapHtml(subject, `
    <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.goldDeep};margin:0 0 10px;font-weight:700;">It's been a minute</p>
    <h1 style="font-size:22px;line-height:1.25;margin:0 0 14px;color:${C.espresso};">We miss you, ${escape(clientName)}.</h1>
    <p style="font-size:15px;line-height:24px;margin:0 0 14px;color:${C.coffee};">
      ${sinceLabel ? `It's been <strong>${sinceLabel}</strong> since` : "It's been a while since"}
      ${lastStyle ? `your last <strong>${escape(lastStyle)}</strong>` : "your last visit"} at ${escape(studioName)}. Your seat is still warm whenever you're ready to come back.
    </p>
    ${bookUrl ? ctaButton("Book your next style", bookUrl) : ""}
    <p style="font-size:12px;color:${C.muted};line-height:18px;margin:18px 0 0;">
      Reply to this email and ${escape(studioName)} will help find a time that works.
    </p>
    ${marketingFooter(p, studioName)}
  `);
  return { subject, html };
};

// ---- new_client_welcome (marketing) --------------------------------
// Day after their first completed appointment. Sets the relationship
// + nudges toward rebook without being pushy. Doesn't replace the
// receipt or review request — separate moment, separate purpose.
const renderNewClientWelcome = (p: Record<string, any>) => {
  const clientName = p.clientName || "there";
  const studioName = p.studioName || "your stylist";
  const firstStyle = p.firstStyle ? String(p.firstStyle) : null;
  const bookUrl    = bookUrlOf(p);
  const subject    = `Welcome to ${studioName}`;
  const html = wrapHtml(subject, `
    <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.goldDeep};margin:0 0 10px;font-weight:700;">Welcome</p>
    <h1 style="font-size:22px;line-height:1.25;margin:0 0 14px;color:${C.espresso};">Welcome to ${escape(studioName)}, ${escape(clientName)}.</h1>
    <p style="font-size:15px;line-height:24px;margin:0 0 14px;color:${C.coffee};">
      Thank you for trusting us with your hair. It was a pleasure doing your${firstStyle ? ` <strong>${escape(firstStyle)}</strong>` : ""} — we hope you're loving how it turned out.
    </p>
    <p style="font-size:15px;line-height:24px;margin:0 0 14px;color:${C.coffee};">
      A few quick things to keep in mind for at-home care:
    </p>
    <ul style="margin:0 0 14px;padding-left:18px;color:${C.coffee};font-size:14px;line-height:22px;">
      <li>Sleep with a satin bonnet or silk pillowcase to extend wear</li>
      <li>Spray the scalp lightly with diluted leave-in to keep it moisturized</li>
      <li>Avoid heavy oils on the braids themselves — focus on the scalp</li>
      <li>Book your next appointment before the schedule fills up</li>
    </ul>
    ${bookUrl ? ctaButton("Book your next appointment", bookUrl) : ""}
    <p style="font-size:12px;color:${C.muted};line-height:18px;margin:18px 0 0;">
      Any questions, just reply to this email — ${escape(studioName)} is here.
    </p>
    ${marketingFooter(p, studioName)}
  `);
  return { subject, html };
};

// ---- marketing_campaign (one-off, stylist-composed) ----------------
// The stylist's draft is plain text + merge tags. We:
//   1. escape it so user input can't inject HTML
//   2. convert blank-line-separated chunks into <p> blocks and
//      single newlines into <br> for readable rendering
//   3. substitute merge tags AFTER escaping (so the {{...}} markers
//      survive the escape pass and the substituted values are not
//      themselves escaped at write time)
// The subject line gets its own substitution pass — same set of
// tags, no HTML treatment since it's plain text in the mail client.
const MERGE_TAG_RE = /\{\{\s*(client_name|studio_name|book_url|first_name)\s*\}\}/g;

const firstNameOf = (name: string | null | undefined): string => {
  if (!name) return "";
  const trimmed = String(name).trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/, 1)[0] || trimmed;
};

const substituteMergeTags = (input: string, p: Record<string, any>): string => {
  const studioName = String(p.studioName || "");
  const clientName = String(p.clientName || "");
  const bookUrl    = bookUrlOf(p);
  return input.replace(MERGE_TAG_RE, (_match, key) => {
    switch (key) {
      case "client_name": return clientName || "there";
      case "first_name":  return firstNameOf(clientName) || "there";
      case "studio_name": return studioName || "your stylist";
      case "book_url":    return bookUrl || "";
      default:            return "";
    }
  });
};

const plainTextToHtml = (input: string): string => {
  const escaped = escape(input);
  // Split on 2+ newlines → paragraphs; single newlines → <br>.
  const paragraphs = escaped
    .split(/\n{2,}/)
    .map(par => par.replace(/\n/g, "<br>").trim())
    .filter(Boolean);
  return paragraphs
    .map(par => `<p style="font-size:15px;line-height:24px;margin:0 0 14px;color:${C.coffee};">${par}</p>`)
    .join("");
};

const renderMarketingCampaign = (p: Record<string, any>) => {
  const studioName = String(p.studioName || "your stylist");
  const bookUrl    = bookUrlOf(p);

  const rawSubject = String(p.subject || "Update from " + studioName);
  const subject = substituteMergeTags(rawSubject, p);

  const rawBody = String(p.bodyText || "");
  // Tags substituted AFTER escaping so the placeholders aren't
  // double-escaped and the substituted values aren't accidentally
  // dropped by the escape pass.
  const bodyHtml = substituteMergeTags(plainTextToHtml(rawBody), p);

  const html = wrapHtml(subject, `
    <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.goldDeep};margin:0 0 14px;font-weight:700;">${escape(studioName)}</p>
    ${bodyHtml}
    ${bookUrl ? ctaButton("Book now", bookUrl) : ""}
    ${marketingFooter(p, studioName)}
  `);
  return { subject, html };
};

// ---- reorder_nudge (marketing) -------------------------------------
// Fires when a paid product order's reorder window has passed. Payload:
//   { clientName, studioName, productTitle, productSlug, productImage,
//     weeksSince, reorderAfterWeeks, bookingSlug, unsubscribeToken }
// CTA points at the public product page when slug is available,
// else at the shop landing page. Image rendered when present.
const renderReorderNudge = (p: Record<string, any>) => {
  const clientName     = p.clientName     || "there";
  const studioName     = p.studioName     || "your stylist";
  const productTitle   = p.productTitle   || "your product";
  const productSlug    = String(p.productSlug || "").trim();
  const productImage   = String(p.productImage || "").trim();
  const weeksSince     = Number(p.weeksSince) || null;
  const bookingSlug    = String(p.bookingSlug || "").trim();
  const baseUrl = (Deno.env.get("NEXT_PUBLIC_SITE_URL") || "https://braidbosspro.app").replace(/\/$/, "");
  // Product page slug pattern lives at /u/<handle>/products/<slug>.
  // If we don't have the handle in the payload (the SQL processor
  // doesn't pull it today), fall back to the public shop landing
  // which uses the same slug. Both URLs surface the buy button.
  const productUrl = bookingSlug && productSlug
    ? `${baseUrl}/u/${encodeURIComponent(bookingSlug)}/products/${encodeURIComponent(productSlug)}`
    : bookingSlug
      ? `${baseUrl}/u/${encodeURIComponent(bookingSlug)}/shop`
      : "";
  const subject = `Time to restock your ${productTitle}?`;
  const html = wrapHtml(subject, `
    <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.goldDeep};margin:0 0 10px;font-weight:700;">Time to restock</p>
    <h1 style="font-size:22px;line-height:1.25;margin:0 0 12px;color:${C.espresso};">Running low, ${escape(clientName)}?</h1>
    <p style="font-size:15px;line-height:24px;margin:0 0 14px;color:${C.coffee};">
      ${weeksSince ? `It's been <strong>${weeksSince} weeks</strong> since` : "It's been a while since"}
      you picked up your <strong>${escape(productTitle)}</strong> from ${escape(studioName)} — should be running low about now.
    </p>
    ${productImage ? `
      <div style="text-align:center;margin:0 0 16px;">
        <img src="${escape(productImage)}" alt="${escape(productTitle)}" style="max-width:240px;width:100%;height:auto;border-radius:12px;border:1px solid ${C.hairline};" />
      </div>` : ""}
    ${productUrl ? ctaButton("Buy again", productUrl) : ""}
    <p style="font-size:12px;color:${C.muted};line-height:18px;margin:18px 0 0;">
      Reply to this email if you have any questions.
    </p>
    ${marketingFooter(p, studioName)}
  `);
  return { subject, html };
};

// ---- generic fallback -----------------------------------------------
// ---- waitlist_opening (last-minute opening broadcast) --------------
const renderWaitlistOpening = (p: Record<string, any>) => {
  const clientName = p.clientName || "there";
  const studioName = p.studioName || "your stylist";
  const date = String(p.date || "").trim();
  const time = String(p.time || "").trim();
  const serviceName = String(p.serviceName || "").trim();
  const note = String(p.note || "").trim();
  const bookUrl = String(p.bookUrl || "").trim();
  const when = [date, time].filter(Boolean).join(" · ");
  const subject = `${studioName}: a last-minute opening just came up`;
  const html = wrapHtml(subject, `
    <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.goldDeep};margin:0 0 10px;font-weight:700;">Opening available</p>
    <h1 style="font-size:20px;margin:0 0 12px;color:${C.espresso};">Hey ${escape(clientName)} — a spot just opened up.</h1>
    <p style="font-size:14px;line-height:22px;color:${C.coffee};margin:0 0 8px;">
      ${escape(studioName)} has a last-minute opening${when ? ` <strong>${escape(when)}</strong>` : ""}${serviceName ? ` for <strong>${escape(serviceName)}</strong>` : ""}.
      It's first come, first served — book now to claim it.
    </p>
    ${note ? `<p style="font-size:13px;line-height:20px;color:${C.coffee};margin:0 0 8px;">${escape(note)}</p>` : ""}
    ${bookUrl ? ctaButton("Book this opening", bookUrl) : ""}
    <p style="font-size:12px;color:${C.muted};line-height:18px;margin:14px 0 0;">You're getting this because you joined ${escape(studioName)}'s waitlist.</p>
  `);
  return { subject, html };
};

// ---- daily_sales_summary (owner end-of-day report) -----------------
// Sent to the stylist at their local midnight summarizing the prior
// day's sales. Enqueued by process_daily_sales_summaries() only when
// the day had at least one paid appointment, so this renderer can
// assume non-zero revenue. Mirrors the sections of a POS daily report
// (totals, customers, top service, item sales) in Braid Boss Pro's
// white + multicolor brand styling.
const renderDailySalesSummary = (p: Record<string, any>) => {
  const studioName  = p.studioName || "Your studio";
  const currency    = String(p.currency || "USD");
  const dateLabel   = fmtDate(p.summaryDate) || "";
  const weekday     = String(p.weekday || "").trim();
  const money = (n: unknown): string => {
    const v = Number(n) || 0;
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(v);
    } catch {
      return "$" + v.toFixed(2);
    }
  };
  const revenue       = Number(p.revenue) || 0;
  const salesCount    = Number(p.salesCount) || 0;
  const customers     = Number(p.customersServed) || 0;
  const newCustomers  = Number(p.newCustomers) || 0;
  const returning     = Number(p.returningCustomers) || 0;
  const topServiceName = p.topServiceName ? String(p.topServiceName) : null;
  const topServiceSales = Number(p.topServiceSales) || 0;
  const items: any[] = Array.isArray(p.items) ? p.items : [];

  const subject = `${studioName} — your sales summary for ${dateLabel}`;

  // Stat tile — label + bright value on a faint lavender card.
  const stat = (label: string, value: string, color: string): string =>
    `<td style="width:50%;padding:5px;" valign="top">
       <div style="background:${C.tint};border:1px solid ${C.hairline};border-radius:12px;padding:14px 16px;">
         <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.10em;text-transform:uppercase;color:${C.muted};font-weight:700;">${escape(label)}</p>
         <p style="margin:0;font-size:22px;font-weight:700;color:${color};font-family:Georgia,serif;line-height:1;">${escape(value)}</p>
       </div>
     </td>`;

  const itemsRows = items.slice(0, 8).map((it: any): string => {
    const name = escape(it?.name || "Service");
    const qty  = Number(it?.count) || 0;
    return `<tr>
      <td style="padding:8px 0;border-bottom:1px solid ${C.hairline};font-size:14px;color:${C.espresso};">${name}${qty ? ` <span style="color:${C.muted};">× ${qty}</span>` : ""}</td>
      <td style="padding:8px 0;border-bottom:1px solid ${C.hairline};font-size:14px;font-weight:700;color:${C.coralDeep};text-align:right;white-space:nowrap;">${money(it?.sales)}</td>
    </tr>`;
  }).join("");

  const dashUrl = (Deno.env.get("NEXT_PUBLIC_SITE_URL") || "https://braidbosspro.app").replace(/\/$/, "");

  const html = wrapHtml(subject, `
    <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.goldDeep};margin:0 0 10px;font-weight:700;">Daily summary${weekday ? ` &middot; ${escape(weekday)}` : ""}</p>
    <h1 style="font-size:22px;line-height:1.25;margin:0 0 4px;color:${C.espresso};"><span style="color:${C.purple};">${escape(studioName)}</span>, here's your day.</h1>
    <p style="font-size:13px;color:${C.muted};margin:0 0 18px;">${escape(dateLabel)}</p>

    <div style="text-align:center;background:${C.tint};border:1px solid ${C.hairline};border-radius:16px;padding:22px 20px;margin:0 0 6px;">
      <p style="margin:0 0 6px;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:${C.purpleDeep};font-weight:700;">Total collected</p>
      <p style="margin:0;font-size:40px;line-height:1.05;font-weight:700;font-family:Georgia,serif;color:${C.purpleDeep};">${money(revenue)}</p>
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;">
      <tr>
        ${stat("Sales", String(salesCount), C.espresso)}
        ${stat("Customers", String(customers), C.coralDeep)}
      </tr>
      <tr>
        ${stat("New clients", String(newCustomers), C.lavender)}
        ${stat("Returning", String(returning), C.purpleDeep)}
      </tr>
    </table>

    ${topServiceName ? `<p style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:${C.goldDeep};margin:18px 0 8px;font-weight:700;">Top seller</p>
    <p style="margin:0;font-size:16px;font-weight:700;color:${C.espresso};">${escape(topServiceName)} &nbsp;<span style="color:${C.coralDeep};">${money(topServiceSales)}</span></p>` : ""}

    ${itemsRows ? `<p style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:${C.goldDeep};margin:18px 0 6px;font-weight:700;">Item sales</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${itemsRows}</table>` : ""}

    ${ctaButton("Open your dashboard", dashUrl)}
    <p style="font-size:12px;color:${C.muted};line-height:18px;margin-top:2px;text-align:center;">Sent automatically the morning after a day with sales.</p>
  `);
  return { subject, html };
};

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
    case "contract_signed_owner_alert":
      return renderContractSignedOwnerAlert(row.payload || {});
    case "contract_reminder_owner_alert":
      return renderContractReminderOwnerAlert(row.payload || {});
    case "appointment_approved":
      return renderAppointmentApproved(row.payload || {});
    case "deposit_received":
      return renderDepositReceived(row.payload || {});
    case "stylist_deposit_paid":
      return renderStylistDepositPaid(row.payload || {});
    case "stylist_new_booking":
      return renderStylistNewBooking(row.payload || {});
    case "client_message_owner_alert":
      return renderClientMessageOwnerAlert(row.payload || {});
    case "balance_paid":
      return renderBalancePaid(row.payload || {});
    case "review_request":
      return renderReviewRequest(row.payload || {});
    case "review_received":
      return renderReviewReceived(row.payload || {});
    case "gift_card_issued":
      return renderGiftCardIssued(row.payload || {});
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
    case "appointment_updated":
      return renderAppointmentUpdated(row.payload || {});
    case "founding_welcome":
      return renderFoundingWelcome(row.payload || {});
    case "order_confirmation":
      return renderOrderConfirmation(row.payload || {});
    case "order_ready_for_pickup":
      return renderOrderReadyForPickup(row.payload || {});
    case "order_shipped":
      return renderOrderShipped(row.payload || {});
    case "stylist_label_printed":
      return renderStylistLabelPrinted(row.payload || {});
    case "cart_abandoned":
      return renderCartAbandoned(row.payload || {});
    case "rebook_nudge":
      return renderRebookNudge(row.payload || {});
    case "birthday_greeting":
      return renderBirthdayGreeting(row.payload || {});
    case "winback":
      return renderWinback(row.payload || {});
    case "new_client_welcome":
      return renderNewClientWelcome(row.payload || {});
    case "marketing_campaign":
      return renderMarketingCampaign(row.payload || {});
    case "reorder_nudge":
      return renderReorderNudge(row.payload || {});
    case "waitlist_opening":
      return renderWaitlistOpening(row.payload || {});
    case "daily_sales_summary":
      return renderDailySalesSummary(row.payload || {});
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
  replyTo: string | null = null,
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
  // Pick the right sender. Marketing types (rebook nudges, etc.) use
  // the marketing identity (hello@…); everything else uses the
  // transactional identity (noreply@…). Falls back gracefully when
  // the marketing env isn't set.
  const fromEmail = MARKETING_NOTIFICATION_TYPES.has(row.notification_type)
    ? RESEND_MARKETING_FROM_EMAIL
    : RESEND_FROM_EMAIL;
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: formatFrom(senderDisplayName(row), fromEmail),
        to: row.recipient_email,
        reply_to: replyTo || undefined,
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
  let txt = String(fromPayload || row.body || "").trim();
  if (!txt) return "";
  // A2P 10DLC brand identification: the campaign is registered under the
  // "Braid Boss Pro" brand, so every message must identify that brand to
  // stay consistent with the registration (the message body still names
  // the stylist's business for the client's benefit). Prepend unless the
  // text already references the brand so we don't double up.
  if (!/braid\s*boss\s*pro/i.test(txt)) {
    txt = `Braid Boss Pro: ${txt}`;
  }
  // Carrier compliance (A2P 10DLC / CTIA): every outbound message must
  // carry opt-out instructions, and content filters look for them. Append
  // unless the body already references STOP so we don't double up.
  if (!/\bSTOP\b/i.test(txt)) {
    txt = `${txt} Reply STOP to opt out.`;
  }
  // Hard cap so a bad payload can't fan out into many billed segments.
  return txt.length > 480 ? `${txt.slice(0, 477)}...` : txt;
};

const sendViaTwilio = async (
  row: ClaimedRow,
): Promise<
  | { ok: true; providerMessageId: string | null }
  | { ok: false; retryable: boolean; error: string }
> => {
  if (
    !TWILIO_ACCOUNT_SID ||
    !TWILIO_AUTH_TOKEN ||
    (!TWILIO_MESSAGING_SERVICE_SID && !TWILIO_PHONE_NUMBER)
  ) {
    // Non-retryable: missing config won't fix itself on retry. Need the
    // account creds plus a sender — either a Messaging Service SID or a
    // From number. Email rows in the same batch are unaffected (per-row
    // dispatch).
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
    // Prefer the Messaging Service (sender pool + A2P/toll-free
    // registration); fall back to a single From number.
    if (TWILIO_MESSAGING_SERVICE_SID) {
      form.set("MessagingServiceSid", TWILIO_MESSAGING_SERVICE_SID);
    } else {
      form.set("From", TWILIO_PHONE_NUMBER);
    }
    form.set("Body", body);
    // Ask Twilio to POST delivery receipts so we can mark
    // delivered/failed and refund carrier-dropped (e.g. 30032) sends.
    if (TWILIO_STATUS_CALLBACK_URL) {
      form.set("StatusCallback", TWILIO_STATUS_CALLBACK_URL);
    }
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
  "appointment_updated",
]);

const enrichCustomization = async (
  admin: ReturnType<typeof createClient>,
  row: ClaimedRow,
): Promise<void> => {
  if (!CUSTOMIZATION_TYPES.has(row.notification_type)) return;
  const cols =
    "selected_hair_color, selected_curl_pattern, client_style_notes, inspiration_photo_urls, customization_summary, selected_addons, selected_variation_name, portal_token, cancel_token, intake_answers, booked_for_name";
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
  // Who the appointment is for (a dependent the client booked for).
  fill("bookedForName", br.booked_for_name || null);
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

  // Intake / consultation answers — array of { q, a }. Surfaces in the
  // approval ("appointment_approved") email via intakeBlock.
  if (Array.isArray(br.intake_answers) && br.intake_answers.length > 0) {
    fill("intakeAnswers", br.intake_answers);
  }
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
  "appointment_updated",
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

// Reply-To enrichment — client-facing emails go out from the platform's
// verified send address (so DKIM/SPF/DMARC pass), but a client hitting
// "reply" should reach the stylist, not the platform inbox. We resolve
// the stylist's login email once per user_id (cached for the batch) and
// set it as Reply-To. Stylist-addressed alerts (recipient == the stylist)
// and marketing blasts are excluded.
const ownerEmailCache = new Map<string, string | null>();

const resolveOwnerEmail = async (
  admin: ReturnType<typeof createClient>,
  userId: string | null,
): Promise<string | null> => {
  if (!userId) return null;
  if (ownerEmailCache.has(userId)) return ownerEmailCache.get(userId) ?? null;
  let email: string | null = null;
  try {
    const { data } = await admin.auth.admin.getUserById(userId);
    email = (data?.user?.email ?? null) || null;
  } catch {
    email = null; // best-effort — fall back to no Reply-To
  }
  ownerEmailCache.set(userId, email);
  return email;
};

const resolveReplyTo = async (
  admin: ReturnType<typeof createClient>,
  row: ClaimedRow,
): Promise<string | null> => {
  if (row.channel !== "email") return null;
  if (MARKETING_NOTIFICATION_TYPES.has(row.notification_type)) return null;
  const owner = await resolveOwnerEmail(admin, row.user_id);
  if (!owner) return null;
  // Don't point a stylist-addressed alert's Reply-To back at the stylist.
  if (row.recipient_email && row.recipient_email.toLowerCase() === owner.toLowerCase()) {
    return null;
  }
  return owner;
};

// =====================================================================
// Shop name enrichment — product/order emails are storefront purchases,
// which carry their own brand (booking_links.shop_name, e.g. a boutique
// name distinct from the booking/studio name). Enqueue paths thread the
// studio/business name into payload.studioName; for order types we
// override it with the shop name so the receipt reads "Your order from
// <shop>". Resolution mirrors the storefront (app/lib/storefront-meta):
// booking_links.shop_name → booking_links.business_name. When neither
// exists we leave the enqueuer's value (renderer falls back to
// "your boutique").
const SHOP_NAME_TYPES = new Set([
  "order_confirmation",
  "order_ready_for_pickup",
  "order_shipped",
  // Reorder nudge ("time to restock your <product>") is a storefront/
  // product email, so it carries the shop brand too.
  "reorder_nudge",
]);

const enrichShopName = async (
  admin: ReturnType<typeof createClient>,
  row: ClaimedRow,
): Promise<void> => {
  if (!SHOP_NAME_TYPES.has(row.notification_type)) return;
  if (!row.user_id) return;
  const p: Record<string, any> =
    (row.payload && typeof row.payload === "object") ? row.payload : (row.payload = {});
  try {
    const { data } = await admin
      .from("booking_links").select("shop_name, business_name")
      .eq("user_id", row.user_id)
      .order("created_at", { ascending: false })
      .limit(1).maybeSingle();
    const resolved =
      String((data as any)?.shop_name ?? "").trim() ||
      String((data as any)?.business_name ?? "").trim();
    if (resolved) p.studioName = resolved;
  } catch {
    // best-effort — renderer fallback ("your boutique") still applies
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

      // Idempotency guard. A non-null provider_message_id on a claimed
      // row means a PRIOR attempt already handed this message to the
      // provider (Twilio/Resend accepted it), but the terminal
      // mark_notification_sent didn't land and sweep_stuck_notifications
      // later flipped the row back to 'queued'. Do NOT resend — that
      // would duplicate the text/email and, for SMS, burn a SECOND
      // prepaid credit. Just finalize the row as sent.
      if (row.provider_message_id) {
        const { error } = await admin.rpc("mark_notification_sent", {
          id_in: row.id,
          provider_in: row.channel === "sms" ? "twilio" : "resend",
          provider_message_id_in: row.provider_message_id,
        });
        if (error) {
          console.error(
            `[process-notification-queue] finalize (already-dispatched) failed for ${row.id}: ${error.message}`,
          );
          failed++;
          return;
        }
        sent++;
        return;
      }

      let result:
        | { ok: true; providerMessageId: string | null }
        | { ok: false; retryable: boolean; error: string };
      let provider: string;
      if (row.channel === "sms") {
        // Prepaid-credit gate. Consume one credit before sending —
        // the consume RPC is atomic, so concurrent workers can't
        // double-spend. No credits → terminal-fail (don't burn
        // retries; the stylist must top up). On a Twilio failure
        // the credit is refunded so an undelivered text is free.
        const { data: consumeRes, error: consumeErr } = await admin.rpc(
          "consume_sms_credit",
          { user_id_in: row.user_id, body_in: smsText(row) },
        );
        const consumed =
          !consumeErr && consumeRes && (consumeRes as any).ok === true;
        if (!consumed) {
          await failTerminal(admin, row.id, "no_sms_credits");
          failed++;
          return;
        }
        result = await sendViaTwilio(row);
        provider = "twilio";
        if (!result.ok) {
          try {
            await admin.rpc("refund_sms_credit", {
              user_id_in: row.user_id,
              note_in: "twilio_send_failed",
            });
          } catch {
            /* refund is best-effort */
          }
        }
      } else {
        await enrichCustomization(admin, row);
        await enrichStudioName(admin, row);
        await enrichShopName(admin, row);
        const rendered = renderForRow(row);
        const replyTo = await resolveReplyTo(admin, row);
        result = await sendViaResend(row, rendered, replyTo);
        provider = "resend";
      }

      if (result.ok) {
        // Persist the provider message id with a fast, single-column
        // write BEFORE the terminal mark. If mark_notification_sent then
        // fails and the row is later swept back to 'queued', the next
        // claim sees this id and finalizes via the idempotency guard
        // above instead of resending (no duplicate send, no double
        // credit charge). Best-effort: mark_notification_sent records it
        // too, so a hiccup here just leaves the original behavior.
        if (result.providerMessageId) {
          try {
            await admin
              .from("notification_queue")
              .update({ provider_message_id: result.providerMessageId })
              .eq("id", row.id);
          } catch {
            /* best-effort */
          }
        }
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
