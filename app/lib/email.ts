// Resend transactional email helper.
//
// Phase B5a wires the helper but no caller sends real mail yet —
// Phase B5c switches the approval / deposit / confirmation /
// expiration touchpoints from in-app-only to in-app + email. The
// helper is intentionally fail-soft: if RESEND_API_KEY or
// RESEND_FROM_EMAIL is missing, send() returns `{ skipped: true }`
// and the booking flow continues unaffected.
//
// REST-only — no SDK so the bundle stays small. Only callable from
// server-side code (route handlers, edge functions). Importing it
// from a client component will work but the API key envs won't be
// readable, so send() will skip every time.

import { formatAppointmentDate } from "./utils/formatAppointmentDate";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type EmailResult =
  | { ok: true; id: string }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped?: false; error: string };

export type EmailPayload = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
};

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const wrapHtml = (title: string, body: string): string => `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#FAF6EE;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#3A2A1B;">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px;">
    <div style="background:#FFFFFF;border:1px solid #E9DFC8;border-radius:16px;padding:28px;box-shadow:0 1px 4px rgba(58,42,27,0.04);">
      ${body}
    </div>
    <p style="text-align:center;font-size:11px;color:#9A8B72;margin-top:18px;">
      Sent by Braid Boss Pro
    </p>
  </div>
</body></html>`;

export const sendEmail = async (payload: EmailPayload): Promise<EmailResult> => {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    console.warn(
      `[email] skipped — missing ${!apiKey ? "RESEND_API_KEY" : "RESEND_FROM_EMAIL"}. Falling back to in-app notification only.`,
    );
    return { ok: false, skipped: true, reason: "missing_env" };
  }
  if (!payload.to || !payload.to.includes("@")) {
    return { ok: false, skipped: true, reason: "invalid_recipient" };
  }
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        reply_to: payload.replyTo,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(`[email] Resend ${res.status}: ${text.slice(0, 200)}`);
      return { ok: false, error: `resend_${res.status}` };
    }
    const json = (await res.json()) as { id?: string };
    return { ok: true, id: json?.id || "" };
  } catch (e: any) {
    console.warn(`[email] network failure: ${e?.message || e}`);
    return { ok: false, error: "network" };
  }
};

// ---- Templates --------------------------------------------------------
//
// Every template is a thin shell over wrapHtml so B5c can drop them in
// without re-deciding visual style. They're exported as `build*` to
// keep send-or-skip logic at the call site.

export const buildApprovalEmail = (args: {
  clientName: string;
  studioName: string;
  serviceName?: string | null;
  preferredDate?: string | null;
  depositAmount?: number | null;
  paymentUrl: string;
  expiresMinutes: number;
}) => {
  const subject = `${args.studioName} approved your booking — secure with a deposit`;
  const dep = args.depositAmount && args.depositAmount > 0
    ? `<p style="font-size:14px;line-height:22px;">Your deposit is <strong>$${args.depositAmount.toFixed(2)}</strong>. Once it lands, your appointment is locked in.</p>`
    : "";
  const whenLabel = formatAppointmentDate(args.preferredDate);
  const html = wrapHtml(subject, `
    <h1 style="font-size:20px;margin:0 0 12px;color:#1F140A;">You're in, ${escapeHtml(args.clientName)}.</h1>
    <p style="font-size:14px;line-height:22px;">
      ${escapeHtml(args.studioName)} approved your${args.serviceName ? ` ${escapeHtml(args.serviceName)}` : ""} request${whenLabel ? ` for ${escapeHtml(whenLabel)}` : ""}.
    </p>
    ${dep}
    <p style="margin:22px 0;text-align:center;">
      <a href="${args.paymentUrl}" style="display:inline-block;background:#1F140A;color:#FAF6EE;text-decoration:none;padding:14px 26px;border-radius:999px;font-weight:600;font-size:14px;letter-spacing:0.04em;">Pay deposit</a>
    </p>
    <p style="font-size:12px;color:#9A8B72;line-height:18px;">
      This hold expires in ${args.expiresMinutes} minutes. After that, the slot opens back up.
    </p>
  `);
  return { subject, html };
};

export const buildDepositReceivedEmail = (args: {
  clientName: string;
  studioName: string;
  serviceName?: string | null;
  preferredDate?: string | null;
  preferredTime?: string | null;
}) => {
  const subject = `Deposit received — pending ${args.studioName}'s approval`;
  const when = formatAppointmentDate(args.preferredDate, args.preferredTime);
  const html = wrapHtml(subject, `
    <h1 style="font-size:20px;margin:0 0 12px;color:#1F140A;">Thanks, ${escapeHtml(args.clientName)}.</h1>
    <p style="font-size:14px;line-height:22px;">
      We received your deposit for your${args.serviceName ? ` ${escapeHtml(args.serviceName)}` : ""} request${when ? ` on <strong>${escapeHtml(when)}</strong>` : ""}.
    </p>
    <p style="font-size:14px;line-height:22px;">
      <strong>Your appointment isn't confirmed yet.</strong> ${escapeHtml(args.studioName).replace(/^./, (c) => c.toUpperCase())} still needs to review and approve it — we'll email you to confirm as soon as that happens.
    </p>
    <p style="font-size:12px;color:#9A8B72;line-height:18px;">
      No action needed right now. Reach out if anything changes.
    </p>
  `);
  return { subject, html };
};

// Sent from the balance-payment webhook when the client pays the
// final balance through Stripe. Includes a private review link so
// the stylist can collect feedback while the appointment is fresh.
export const buildBalancePaidEmail = (args: {
  clientName: string;
  studioName: string;
  serviceName?: string | null;
  amountPaid?: number | null;
  reviewUrl: string;
}) => {
  const subject = `Thank you — your balance is paid, ${args.studioName}`;
  const amount = args.amountPaid && args.amountPaid > 0
    ? `<p style="font-size:14px;line-height:22px;">We received <strong>$${args.amountPaid.toFixed(2)}</strong> for your${args.serviceName ? ` ${escapeHtml(args.serviceName)}` : ""} appointment. You're all set.</p>`
    : "";
  const html = wrapHtml(subject, `
    <h1 style="font-size:20px;margin:0 0 12px;color:#1F140A;">Thank you, ${escapeHtml(args.clientName)}.</h1>
    <p style="font-size:14px;line-height:22px;">
      Thanks for visiting ${escapeHtml(args.studioName)} — your balance is paid in full.
    </p>
    ${amount}
    <p style="font-size:14px;line-height:22px;margin-top:18px;">
      If you have a moment, your feedback means the world. It only takes 30 seconds.
    </p>
    <p style="margin:18px 0 8px;text-align:center;">
      <a href="${args.reviewUrl}" style="display:inline-block;background:#1F140A;color:#FAF6EE;text-decoration:none;padding:14px 26px;border-radius:999px;font-weight:600;font-size:14px;letter-spacing:0.04em;">Leave a review · ★★★★★</a>
    </p>
    <p style="font-size:12px;color:#9A8B72;line-height:18px;text-align:center;">
      Rate your experience and share anything you'd want ${escapeHtml(args.studioName)} to know.
    </p>
  `);
  return { subject, html };
};

export const buildExpirationEmail = (args: {
  clientName: string;
  studioName: string;
  rebookUrl?: string | null;
}) => {
  const subject = `Your booking hold with ${args.studioName} expired`;
  const cta = args.rebookUrl
    ? `<p style="margin:22px 0;text-align:center;">
        <a href="${args.rebookUrl}" style="display:inline-block;background:#1F140A;color:#FAF6EE;text-decoration:none;padding:14px 26px;border-radius:999px;font-weight:600;font-size:14px;">Pick a new time</a>
      </p>`
    : "";
  const html = wrapHtml(subject, `
    <h1 style="font-size:20px;margin:0 0 12px;color:#1F140A;">Hold expired.</h1>
    <p style="font-size:14px;line-height:22px;">
      Hi ${escapeHtml(args.clientName)} — the deposit window for your booking with ${escapeHtml(args.studioName)} closed before payment came through, so the slot is back on the calendar.
    </p>
    <p style="font-size:14px;line-height:22px;">
      Still want it? Pop back in and grab another time.
    </p>
    ${cta}
  `);
  return { subject, html };
};

// Phase B12 — contract invite. Sent (in B12.1) when a stylist
// approves a booking request that has unsigned agreements attached,
// or whenever the stylist taps "Resend agreement" from the
// Approvals queue.
// Phase B12.1a — booking confirmation. Sent immediately after a
// public booking submit lands (assuming the client provided an email).
// Tone: warm, premium, mobile-friendly. Tells the client what's
// happening next so they don't worry about silence between submit
// and the stylist's approval.
export const buildBookingConfirmationEmail = (args: {
  clientName: string;
  studioName: string;
  serviceName?: string | null;
  preferredDate?: string | null;
  preferredTime?: string | null;
  approvalStatus?: string | null;
  depositRequired?: boolean | null;
}) => {
  const when = formatAppointmentDate(args.preferredDate, args.preferredTime);
  const isAwaitingDeposit = args.approvalStatus === "awaiting_deposit";
  const subject = `Booking request received — ${args.studioName}`;
  const nextLine = (() => {
    if (isAwaitingDeposit) {
      return "We've also sent a deposit link separately. Once your deposit lands and the stylist approves, your appointment is locked in.";
    }
    if (args.depositRequired) {
      return "Your stylist will review shortly. If a deposit is required, you'll receive a secure link by email.";
    }
    return "Your stylist will review and confirm shortly. You'll hear from us as soon as it's approved.";
  })();

  const html = wrapHtml(subject, `
    <h1 style="font-size:20px;margin:0 0 12px;color:#1F140A;">We've got it, ${escapeHtml(args.clientName)}.</h1>
    <p style="font-size:14px;line-height:22px;">
      Your booking request${args.serviceName ? ` for <strong>${escapeHtml(args.serviceName)}</strong>` : ""}${when ? ` on <strong>${escapeHtml(when)}</strong>` : ""} has been received by ${escapeHtml(args.studioName)}.
    </p>
    <p style="font-size:14px;line-height:22px;">${escapeHtml(nextLine)}</p>
    <p style="font-size:12px;color:#9A8B72;line-height:18px;margin-top:18px;">
      We'll only email you about this booking. Reply to this message any time if you need to update something.
    </p>
  `);
  return { subject, html };
};

export const buildContractInviteEmail = (args: {
  clientName: string;
  studioName: string;
  contractTitle: string;
  serviceName?: string | null;
  contractUrl: string;
}) => {
  const subject = `Please review and sign your appointment agreement`;
  const html = wrapHtml(subject, `
    <h1 style="font-size:20px;margin:0 0 12px;color:#1F140A;">Hi ${escapeHtml(args.clientName)},</h1>
    <p style="font-size:14px;line-height:22px;">
      Your stylist at ${escapeHtml(args.studioName)} sent an agreement for your upcoming${args.serviceName ? ` <strong>${escapeHtml(args.serviceName)}</strong>` : ""} appointment.
    </p>
    <p style="font-size:14px;line-height:22px;">
      Please take a minute to review and sign:
    </p>
    <p style="margin:22px 0;text-align:center;">
      <a href="${args.contractUrl}" style="display:inline-block;background:#1F140A;color:#FAF6EE;text-decoration:none;padding:14px 26px;border-radius:999px;font-weight:600;font-size:14px;letter-spacing:0.04em;">Review &amp; sign — ${escapeHtml(args.contractTitle)}</a>
    </p>
    <p style="font-size:12px;color:#9A8B72;line-height:18px;">
      Signing keeps your appointment time secure and policies clear.
    </p>
  `);
  return { subject, html };
};
