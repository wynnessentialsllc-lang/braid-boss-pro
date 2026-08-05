// Shared Academy email templates.
//
// One source of truth for the buyer "you now have access" emails (sent by
// the checkout webhooks, the reconcile sweep, and the owner "Resend"
// action) and the seller sale alerts. Keeping the copy + styling here
// means it can never drift between those call sites.

export type BuiltEmail = { subject: string; html: string; text: string };

// ── Branded shell ───────────────────────────────────────────────────
// Matches the app's transactional look: warm cream backdrop, a wordmark,
// a white card, and a footer — so these read like a real Braid Boss Pro
// email instead of raw HTML.
const BRAND = {
  bg: "#FAF6EE",
  card: "#FFFFFF",
  border: "#E9DFC8",
  ink: "#2A1D12",
  coffee: "#6F5B47",
  muted: "#9A8B72",
  accent: "#7C3AED",
};

const wrapAcademyEmail = (title: string, inner: string): string => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
  </head>
  <body style="margin:0;padding:0;background:${BRAND.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${BRAND.ink};-webkit-font-smoothing:antialiased;">
    <div style="max-width:520px;margin:0 auto;padding:28px 20px;">
      <p style="text-align:center;font-size:12px;font-weight:700;letter-spacing:0.24em;color:${BRAND.accent};margin:0 0 18px;">BRAID BOSS PRO</p>
      <div style="background:${BRAND.card};border:1px solid ${BRAND.border};border-radius:18px;padding:32px 28px;box-shadow:0 2px 12px rgba(42,29,18,0.06);">
        ${inner}
      </div>
      <p style="text-align:center;font-size:11px;line-height:1.5;color:${BRAND.muted};margin:20px 0 0;">
        Sent by Braid Boss Pro · You received this because you made a purchase.
      </p>
    </div>
  </body>
</html>`;

// Human "when" for a class start, in the braider's timezone when set.
export const fmtClassWhen = (startsAt: string | null, tz: string | null): string => {
  if (!startsAt) return "Time TBA — the braider will be in touch.";
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: tz || undefined,
    }).format(new Date(startsAt));
  } catch {
    return new Date(startsAt).toLocaleString();
  }
};

const button = (href: string, label: string): string =>
  `<a href="${href}" style="display:inline-block;background:${BRAND.accent};color:#ffffff;text-decoration:none;padding:14px 30px;border-radius:12px;font-weight:700;font-size:15px;letter-spacing:0.01em;">${label}</a>`;

export const buildVideoAccessEmail = (args: {
  videoTitle: string;
  accessToken: string;
  accessModel: string;
  accessExpiresAt: string | null;
  baseUrl: string;
}): BuiltEmail => {
  const watchUrl = `${args.baseUrl.replace(/\/$/, "")}/watch/${encodeURIComponent(args.accessToken)}`;
  const expiryLine =
    args.accessModel === "rent" && args.accessExpiresAt
      ? `<p style="font-size:13px;line-height:1.5;color:${BRAND.coffee};margin:0;">Your access is available until <strong>${new Date(
          args.accessExpiresAt,
        ).toLocaleString()}</strong>.</p>`
      : `<p style="font-size:13px;line-height:1.5;color:${BRAND.coffee};margin:0;">You have permanent access — save this email.</p>`;
  const inner = `
    <h1 style="font-size:22px;line-height:1.3;font-weight:700;margin:0 0 12px;color:${BRAND.ink};">Thanks for your purchase! 🎬</h1>
    <p style="font-size:15px;line-height:1.6;margin:0 0 22px;color:${BRAND.coffee};">You now have access to <strong style="color:${BRAND.ink};">${args.videoTitle}</strong>.</p>
    <p style="margin:0 0 22px;">${button(watchUrl, "Watch now →")}</p>
    ${expiryLine}
    <hr style="border:none;border-top:1px solid ${BRAND.border};margin:22px 0 16px;" />
    <p style="font-size:12px;line-height:1.5;color:${BRAND.muted};margin:0;word-break:break-all;">
      Button not working? Paste this link:<br />
      <a href="${watchUrl}" style="color:${BRAND.accent};">${watchUrl}</a>
    </p>`;
  return {
    subject: `Your video access: ${args.videoTitle}`,
    html: wrapAcademyEmail(`Your video access: ${args.videoTitle}`, inner),
    text: `Thanks for your purchase! Watch ${args.videoTitle} here: ${watchUrl}`,
  };
};

export const buildClassAccessEmail = (args: {
  classTitle: string;
  startsAt: string | null;
  timezone: string | null;
  format: string;
  meetingUrl: string | null;
  locationText: string | null;
  seats: number;
}): BuiltEmail => {
  const when = fmtClassWhen(args.startsAt, args.timezone);
  const isVirtual = args.format === "virtual";
  const row = (label: string, value: string): string =>
    `<tr>
      <td style="padding:4px 0;font-size:13px;color:${BRAND.muted};width:92px;vertical-align:top;">${label}</td>
      <td style="padding:4px 0;font-size:14px;color:${BRAND.ink};">${value}</td>
    </tr>`;
  const accessValue = isVirtual
    ? args.meetingUrl
      ? `<a href="${args.meetingUrl}" style="color:${BRAND.accent};word-break:break-all;">${args.meetingUrl}</a>`
      : "Your join link will be sent before the class."
    : args.locationText
      ? args.locationText
      : "Location details will follow from your braider.";
  const detailRows =
    row("When", when) +
    (args.seats > 1 ? row("Seats", String(args.seats)) : "") +
    row(isVirtual ? "Join link" : "Location", accessValue);
  const inner = `
    <h1 style="font-size:22px;line-height:1.3;font-weight:700;margin:0 0 12px;color:${BRAND.ink};">You're in! 🎉</h1>
    <p style="font-size:15px;line-height:1.6;margin:0 0 20px;color:${BRAND.coffee};">Your spot in <strong style="color:${BRAND.ink};">${args.classTitle}</strong> is confirmed.</p>
    <div style="background:${BRAND.bg};border:1px solid ${BRAND.border};border-radius:12px;padding:14px 18px;margin:0 0 20px;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${detailRows}</table>
    </div>
    <p style="font-size:14px;line-height:1.6;color:${BRAND.coffee};margin:0;">See you there! 💜</p>`;
  return {
    subject: `You're signed up: ${args.classTitle}`,
    html: wrapAcademyEmail(`You're signed up: ${args.classTitle}`, inner),
    text: `You're signed up for ${args.classTitle}. When: ${when}. ${
      isVirtual ? `Join: ${args.meetingUrl || "link to follow"}` : `Location: ${args.locationText || "details to follow"}`
    }`,
  };
};

// ── Seller (braider) sale alerts ────────────────────────────────────
// Plain subject + body for queue_stylist_email_alert → the notification
// worker's renderGeneric wraps the body in its own branded shell and
// sends it, and the stylist-addressed row also fires a web push +
// in-app bell. Kept as plain text because renderGeneric escapes the body.

const money = (amount: number, currency: string): string => {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: (currency || "usd").toUpperCase(),
    }).format(amount);
  } catch {
    return `$${(Number(amount) || 0).toFixed(2)}`;
  }
};

export type SellerAlert = { subject: string; body: string };

export const buildVideoSaleAlert = (args: {
  videoTitle: string;
  buyerLabel: string;
  amount: number;
  currency: string;
}): SellerAlert => ({
  subject: `New sale: ${args.videoTitle}`,
  body: `${args.buyerLabel} just purchased "${args.videoTitle}" for ${money(args.amount, args.currency)}.\n\nOpen Braid Boss Pro → Video Lessons → Sales to see the buyer.`,
});

export const buildClassSaleAlert = (args: {
  classTitle: string;
  buyerLabel: string;
  seats: number;
  amount: number;
  currency: string;
}): SellerAlert => ({
  subject: `New class sign-up: ${args.classTitle}`,
  body: `${args.buyerLabel} signed up for "${args.classTitle}"${
    args.seats > 1 ? ` (${args.seats} seats)` : ""
  } — ${money(args.amount, args.currency)}.\n\nOpen Braid Boss Pro → Classes → Sign-ups to see the roster.`,
});
