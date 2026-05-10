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
  const html = wrapHtml(subject, `
    <h1 style="font-size:20px;margin:0 0 12px;color:#1F140A;">You're in, ${escapeHtml(args.clientName)}.</h1>
    <p style="font-size:14px;line-height:22px;">
      ${escapeHtml(args.studioName)} approved your${args.serviceName ? ` ${escapeHtml(args.serviceName)}` : ""} request${args.preferredDate ? ` for ${escapeHtml(args.preferredDate)}` : ""}.
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
  const subject = `Deposit received — your appointment with ${args.studioName} is confirmed`;
  const when = [args.preferredDate, args.preferredTime].filter(Boolean).join(" · ");
  const html = wrapHtml(subject, `
    <h1 style="font-size:20px;margin:0 0 12px;color:#1F140A;">You're confirmed.</h1>
    <p style="font-size:14px;line-height:22px;">
      Thanks ${escapeHtml(args.clientName)} — your deposit landed and ${escapeHtml(args.studioName)} has your${args.serviceName ? ` ${escapeHtml(args.serviceName)}` : ""} appointment locked in${when ? ` for <strong>${escapeHtml(when)}</strong>` : ""}.
    </p>
    <p style="font-size:12px;color:#9A8B72;line-height:18px;">
      You'll get a reminder closer to the day. Reach out if anything changes.
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
