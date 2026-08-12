// Braid Boss Pro — shared email design kit.
//
// One source of truth for the account / billing lifecycle emails. This
// file is deliberately PURE: no Deno APIs, no Node APIs, no fetch, no
// env reads. That lets three very different consumers share the exact
// same markup:
//
//   1. supabase/functions/process-notification-queue  (Deno)  — renders
//      queued rows and hands the HTML to Resend.
//   2. app/api/dev/email-preview                      (Next)  — renders
//      the same templates in a browser for review. Dev-only.
//   3. scripts/build-auth-email-templates.mjs         (Node)  — writes
//      the Supabase Auth dashboard templates to docs/email-templates.
//
// Every caller passes its own data in; nothing is read from the
// environment and nothing is hard-coded to a sample user.
//
// Email-client constraints observed throughout:
//   • table-based layout, inline styles only
//   • 600px desktop width, fluid down to 320px
//   • no webfonts, no CSS animation, no JavaScript, no background images
//   • full-bleed colour bands are real <table> rows, not CSS sections
//   • every image carries alt text and the mail reads fine without it
//   • long URLs wrap instead of blowing out the layout

// ---------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------

/** Canonical production origin. Callers may override; never a preview URL. */
export const SITE_URL = "https://braidbosspro.app";

/**
 * Brand palette. Mirrors app/components/marketing/tokens.ts so the mail
 * and the dashboard read as one product.
 */
export const C = {
  ink: "#15111A",
  body: "#3D3447",
  muted: "#6F6477",
  mutedSoft: "#9F95A8",
  white: "#FFFFFF",
  hairline: "#ECE7F2",
  tint: "#F1ECF9", // lavender wash
  tintSoft: "#F6F2FF",
  purple: "#7C3AED",
  purpleDeep: "#5B21B6",
  lavender: "#B14BE0",
  coral: "#FF4D6D",
  coralDeep: "#E0354F",
  gold: "#FBBF24",
  goldDeep: "#B45309",
  success: "#22C55E",
} as const;

/**
 * Display face. Cormorant Garamond is the brand serif on the web, but
 * webfonts do not load in Outlook, Gmail's web client, or most Android
 * clients. Georgia is the closest widely-installed serif and keeps the
 * editorial headline voice everywhere.
 */
export const FONT_DISPLAY = "Georgia,'Times New Roman',Times,serif";
export const FONT_BODY =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

/** Legal / transactional identity. Sourced from app/privacy/page.tsx. */
export const BUSINESS = {
  legalName: "Wynn Essentials, LLC",
  dba: "Braid Boss Pro",
  address: "3680 Wilshire Blvd, Ste P04 #A118, Los Angeles, CA 90010",
  supportEmail: "hello@braidbosspro.app",
  tagline: "The business OS for braiders.",
  signoff: "Built for stylists, by stylists.",
} as const;

// ---------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------

/** HTML-escape a value for safe interpolation into markup. */
export const esc = (s: unknown): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * Escape a URL for an href. Anything that is not http(s) or a Supabase
 * template variable is dropped, so a malformed or hostile value can
 * never become a `javascript:` link.
 */
export const escUrl = (raw: unknown): string => {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  // Supabase Auth templates interpolate {{ .ConfirmationURL }} at send
  // time; let those through untouched.
  if (s.startsWith("{{")) return s;
  if (!/^https?:\/\//i.test(s)) return "";
  return esc(s);
};

/** Strip a trailing slash so `${base}/path` never doubles up. */
export const normalizeBase = (raw?: string | null): string => {
  const s = String(raw ?? "").trim().replace(/\/+$/, "");
  return s && /^https?:\/\//i.test(s) ? s : SITE_URL;
};

/** First name from a full name. Returns "" when there is nothing usable. */
export const firstNameOf = (full?: string | null): string => {
  const s = String(full ?? "").trim();
  if (!s) return "";
  const first = s.split(/\s+/)[0] || "";
  // Guard against an email address pasted into the name field.
  if (first.includes("@")) return "";
  return first;
};

/**
 * Greeting that reads naturally with or without a name.
 *   "Hi Sheree, your"  /  "Hi there, your"
 */
export const greeting = (firstName?: string | null): string => {
  const n = String(firstName ?? "").trim();
  return n ? `Hi ${n}` : "Hi there";
};

/** Currency formatting with a hand-rolled fallback if Intl is unhappy. */
export const money = (
  amountMinor: number | null | undefined,
  currency = "usd",
): string => {
  // null and "" both coerce to 0 through Number(), which would render a
  // missing amount as "$0.00". An absent amount must render as nothing
  // so the row drops out instead of claiming a free subscription.
  if (amountMinor === null || amountMinor === undefined || (amountMinor as unknown) === "") {
    return "";
  }
  const n = Number(amountMinor);
  if (!Number.isFinite(n)) return "";
  const value = n / 100;
  const code = String(currency || "usd").toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
    }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
};

/**
 * Long-form date in the recipient's own time zone.
 *
 * `value` accepts an ISO string, a Date, or a Unix epoch in SECONDS
 * (which is what Stripe sends). `timeZone` is an IANA name; when it is
 * missing or invalid we fall back to UTC so a trial that ends late in
 * the day never renders as the wrong calendar date for one recipient
 * and the right one for another.
 */
export const fmtDate = (
  value: string | number | Date | null | undefined,
  timeZone?: string | null,
): string => {
  const d = toDate(value);
  if (!d) return "";
  const opts: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "long",
    day: "numeric",
  };
  const tz = String(timeZone ?? "").trim();
  if (tz) {
    try {
      return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: tz }).format(d);
    } catch {
      /* invalid zone — fall through to UTC */
    }
  }
  try {
    return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
};

/** Whole days between now (or `from`) and a target date. Never negative. */
export const daysUntil = (
  value: string | number | Date | null | undefined,
  from?: string | number | Date | null,
): number | null => {
  const target = toDate(value);
  const start = toDate(from) || new Date();
  if (!target) return null;
  const ms = target.getTime() - start.getTime();
  return Math.max(0, Math.ceil(ms / 86_400_000));
};

const toDate = (value: string | number | Date | null | undefined): Date | null => {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    // Stripe timestamps are epoch seconds; anything past ~1e12 is ms.
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
};

/** "Visa ending in 4242" from a brand + last4 pair. Empty when unknown. */
export const maskedCard = (
  brand?: string | null,
  last4?: string | null,
): string => {
  const b = String(brand ?? "").trim();
  const l = String(last4 ?? "").trim();
  if (!l) return "";
  const pretty = b
    ? b.charAt(0).toUpperCase() + b.slice(1).toLowerCase().replace(/_/g, " ")
    : "Card";
  return `${pretty} ending in ${l}`;
};

// ---------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------

const CONTENT_WIDTH = 600;

/**
 * A full-bleed colour band. The outer table paints edge to edge, the
 * inner table pins the content to 600px and centres it. `padding` is
 * applied to the inner cell so the colour still reaches the edges on
 * narrow screens.
 */
export const band = (opts: {
  bg: string;
  content: string;
  padding?: string;
  align?: "left" | "center";
}): string => {
  const padding = opts.padding ?? "36px 32px";
  const align = opts.align ?? "left";
  return `
  <tr>
    <td align="center" bgcolor="${opts.bg}" style="background-color:${opts.bg};padding:0;">
      <table role="presentation" width="${CONTENT_WIDTH}" cellpadding="0" cellspacing="0" border="0" class="bbp-w" style="width:100%;max-width:${CONTENT_WIDTH}px;border-collapse:collapse;">
        <tr>
          <td align="${align}" class="bbp-pad" style="padding:${padding};font-family:${FONT_BODY};text-align:${align};">
            ${opts.content}
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
};

/** Small uppercase label that sits above a headline. */
export const eyebrow = (text: string, color: string): string =>
  `<p style="margin:0 0 12px;font-family:${FONT_BODY};font-size:11px;line-height:16px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:${color};">${esc(
    text,
  )}</p>`;

/** Editorial serif headline. */
export const headline = (
  text: string,
  opts?: { color?: string; size?: number; align?: "left" | "center" },
): string => {
  const color = opts?.color ?? C.ink;
  const size = opts?.size ?? 34;
  const align = opts?.align ?? "left";
  return `<h1 class="bbp-h1" style="margin:0;font-family:${FONT_DISPLAY};font-size:${size}px;line-height:1.16;font-weight:400;color:${color};text-align:${align};">${esc(
    text,
  )}</h1>`;
};

/** The coral rule that sits under a hero headline in the brand system. */
export const rule = (color: string = C.coral, width = 96): string =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:20px 0 0;">
     <tr><td style="width:${width}px;height:5px;background-color:${color};font-size:0;line-height:0;border-radius:3px;">&nbsp;</td></tr>
   </table>`;

/** Body paragraph. */
export const p = (
  html: string,
  opts?: { color?: string; size?: number; margin?: string; align?: string },
): string =>
  `<p style="margin:${opts?.margin ?? "16px 0 0"};font-family:${FONT_BODY};font-size:${
    opts?.size ?? 16
  }px;line-height:1.6;color:${opts?.color ?? C.body};text-align:${opts?.align ?? "inherit"};">${html}</p>`;

/**
 * Bulletproof-ish button. A padded anchor inside a background-coloured
 * table cell: renders as a solid block in every client including
 * Outlook, and the 16px vertical padding keeps the tap target above
 * 44px on mobile.
 */
export const button = (opts: {
  label: string;
  url: string;
  bg?: string;
  color?: string;
  align?: "left" | "center";
  marginTop?: number;
}): string => {
  const href = escUrl(opts.url);
  if (!href) return "";
  const bg = opts.bg ?? C.purple;
  const color = opts.color ?? C.white;
  const align = opts.align ?? "left";
  // Only emit the align attribute for centring. `align="left"` on a
  // table is a FLOAT in HTML, which makes the next paragraph wrap
  // alongside the button instead of sitting under it.
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"${
    align === "center" ? ' align="center"' : ""
  } style="border-collapse:separate;margin:${
    opts.marginTop ?? 26
  }px ${align === "center" ? "auto" : "0"} 0;">
    <tr>
      <td align="center" bgcolor="${bg}" style="background-color:${bg};border-radius:8px;">
        <a href="${href}" style="display:block;padding:16px 32px;font-family:${FONT_BODY};font-size:13px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${color};text-decoration:none;border-radius:8px;">${esc(
          opts.label,
        )}</a>
      </td>
    </tr>
  </table>`;
};

/** Key/value rows for a details card. Blank values are dropped. */
export const detailRows = (
  rows: Array<[string, string | null | undefined]>,
  opts?: { labelColor?: string; valueColor?: string },
): string => {
  const kept = rows.filter(([, v]) => String(v ?? "").trim() !== "");
  if (kept.length === 0) return "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
    ${kept
      .map(
        ([label, value], i) => `<tr>
      <td class="bbp-stack" style="padding:${i === 0 ? "0" : "10px"} 12px 10px 0;font-family:${FONT_BODY};font-size:13px;line-height:1.5;color:${
        opts?.labelColor ?? C.muted
      };white-space:nowrap;vertical-align:top;">${esc(label)}</td>
      <td class="bbp-stack" style="padding:${i === 0 ? "0" : "10px"} 0 10px;font-family:${FONT_BODY};font-size:15px;line-height:1.5;font-weight:700;color:${
        opts?.valueColor ?? C.ink
      };text-align:right;vertical-align:top;word-break:break-word;">${esc(String(value))}</td>
    </tr>`,
      )
      .join("")}
  </table>`;
};

/** Numbered setup step with the brand's circled index. */
export const numberedStep = (opts: {
  index: number;
  title: string;
  body: string;
  color: string;
  last?: boolean;
}): string => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
    <tr>
      <td width="34" valign="top" style="width:34px;padding:0 14px 0 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
          <tr>
            <td align="center" valign="middle" bgcolor="${opts.color}" style="width:34px;height:34px;background-color:${opts.color};border-radius:17px;font-family:${FONT_BODY};font-size:14px;font-weight:700;color:${C.white};text-align:center;line-height:34px;">${opts.index}</td>
          </tr>
        </table>
      </td>
      <td valign="top" style="padding:0 0 ${opts.last ? "0" : "22px"};">
        <p style="margin:0;font-family:${FONT_BODY};font-size:16px;line-height:1.4;font-weight:700;color:${C.ink};">${esc(
          opts.title,
        )}</p>
        <p style="margin:5px 0 0;font-family:${FONT_BODY};font-size:14px;line-height:1.55;color:${C.body};">${esc(
          opts.body,
        )}</p>
      </td>
    </tr>
  </table>`;

/** Three small white cards in a row that stack on mobile. */
export const featureCards = (
  cards: Array<{ label: string; body: string }>,
): string => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;border-spacing:0;">
    <tr>
      ${cards
        .map(
          (card, i) => `<td class="bbp-card" width="33%" valign="top" style="width:33.33%;padding:${
            i === 0 ? "0 6px 0 0" : i === cards.length - 1 ? "0 0 0 6px" : "0 6px"
          };">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
          <tr>
            <td bgcolor="${C.white}" style="background-color:${C.white};border:1px solid rgba(21,17,26,0.10);border-radius:10px;padding:16px 14px;">
              <p style="margin:0;font-family:${FONT_BODY};font-size:11px;line-height:16px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${C.ink};">${esc(
                card.label,
              )}</p>
              <p style="margin:6px 0 0;font-family:${FONT_BODY};font-size:13px;line-height:1.45;color:${C.body};">${esc(
                card.body,
              )}</p>
            </td>
          </tr>
        </table>
      </td>`,
        )
        .join("")}
    </tr>
  </table>`;

/** A bulleted checklist rendered with real table cells, not CSS markers. */
export const bulletList = (items: string[], color: string = C.purple): string =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
    ${items
      .map(
        (item) => `<tr>
      <td width="18" valign="top" style="width:18px;padding:0 10px 10px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:8px;">
          <tr><td style="width:7px;height:7px;background-color:${color};border-radius:4px;font-size:0;line-height:0;">&nbsp;</td></tr>
        </table>
      </td>
      <td valign="top" style="padding:0 0 10px;font-family:${FONT_BODY};font-size:15px;line-height:1.55;color:${C.body};">${esc(
        item,
      )}</td>
    </tr>`,
      )
      .join("")}
  </table>`;

// ---------------------------------------------------------------------
// Masthead + footer
// ---------------------------------------------------------------------

/**
 * Brand header. The gold monogram is served from the production origin
 * (`/icons/icon-192.png`, committed at public/icons/icon-192.png), and
 * the wordmark beside it is live text, so the header still identifies
 * the sender when images are blocked.
 */
export const masthead = (base: string): string => `
  <tr>
    <td align="center" bgcolor="${C.white}" style="background-color:${C.white};padding:0;">
      <table role="presentation" width="${CONTENT_WIDTH}" cellpadding="0" cellspacing="0" border="0" class="bbp-w" style="width:100%;max-width:${CONTENT_WIDTH}px;border-collapse:collapse;">
        <tr>
          <td class="bbp-pad" style="padding:24px 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
              <tr>
                <td width="44" valign="middle" style="width:44px;padding-right:14px;">
                  <!-- Decorative: the wordmark immediately to the right
                       carries the same information as live text, so an
                       empty alt avoids a screen reader announcing the
                       brand twice, and a blocked image leaves no
                       stray placeholder caption. -->
                  <img src="${base}/icons/icon-192.png" width="44" height="44" alt="" style="display:block;width:44px;height:44px;border:0;border-radius:9px;" />
                </td>
                <td valign="middle">
                  <p style="margin:0;font-family:${FONT_BODY};font-size:15px;line-height:20px;font-weight:800;letter-spacing:0.16em;text-transform:uppercase;color:${C.ink};">Braid Boss Pro</p>
                  <p style="margin:3px 0 0;font-family:${FONT_BODY};font-size:10px;line-height:14px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${C.muted};">The business OS for braiders</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;

/**
 * Transactional footer: sender identity, why the recipient got the
 * message, and the legal business details required on transactional
 * mail. No unsubscribe link — these are account and billing notices,
 * not marketing, and the recipient cannot opt out of them without
 * closing the account.
 */
export const footer = (opts: {
  base: string;
  reason: string;
  showSignoff?: boolean;
}): string => `
  <tr>
    <td align="center" bgcolor="${C.white}" style="background-color:${C.white};padding:0;">
      <table role="presentation" width="${CONTENT_WIDTH}" cellpadding="0" cellspacing="0" border="0" class="bbp-w" style="width:100%;max-width:${CONTENT_WIDTH}px;border-collapse:collapse;">
        <tr><td style="height:4px;background-color:${C.coral};font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr>
          <td align="center" class="bbp-pad" style="padding:30px 32px 36px;text-align:center;">
            <img src="${opts.base}/icons/icon-192.png" width="40" height="40" alt="" style="display:block;margin:0 auto;width:40px;height:40px;border:0;border-radius:8px;" />
            ${
              opts.showSignoff === false
                ? ""
                : `<p style="margin:14px 0 0;font-family:${FONT_DISPLAY};font-size:24px;line-height:1.25;color:${C.ink};">${esc(
                    BUSINESS.signoff,
                  )}</p>`
            }
            <p style="margin:14px 0 0;font-family:${FONT_BODY};font-size:11px;line-height:1.6;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${C.purple};">Braid Boss Pro &middot; Los Angeles</p>
            <p style="margin:10px 0 0;font-family:${FONT_BODY};font-size:12px;line-height:1.65;color:${C.muted};">${esc(
              opts.reason,
            )}</p>
            <p style="margin:10px 0 0;font-family:${FONT_BODY};font-size:12px;line-height:1.65;color:${C.mutedSoft};">
              Questions? <a href="mailto:${BUSINESS.supportEmail}" style="color:${C.muted};text-decoration:underline;">${BUSINESS.supportEmail}</a>
            </p>
            <p style="margin:10px 0 0;font-family:${FONT_BODY};font-size:11px;line-height:1.65;color:${C.mutedSoft};">
              ${esc(BUSINESS.legalName)} (DBA ${esc(BUSINESS.dba)})<br />${esc(BUSINESS.address)}
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;

// ---------------------------------------------------------------------
// Document shell
// ---------------------------------------------------------------------

/**
 * Wrap bands into a complete document.
 *
 * The <style> block only carries progressive enhancement: the layout is
 * already fluid without it, so clients that strip <head> styles (Gmail
 * web historically, some Android clients) still render correctly. It
 * pins light mode too, because these templates are built on white and
 * an auto dark-mode inversion muddies the brand colours.
 */
export const document_ = (opts: {
  title: string;
  preheader: string;
  bands: string;
}): string => `<!doctype html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no" />
<meta name="color-scheme" content="light only" />
<meta name="supported-color-schemes" content="light only" />
<title>${esc(opts.title)}</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<![endif]-->
<style>
  :root { color-scheme: light only; supported-color-schemes: light only; }
  body { margin:0 !important; padding:0 !important; width:100% !important; }
  img { -ms-interpolation-mode:bicubic; }
  a { text-decoration:none; }
  @media only screen and (max-width:620px) {
    .bbp-w { width:100% !important; max-width:100% !important; }
    .bbp-pad { padding-left:22px !important; padding-right:22px !important; }
    .bbp-h1 { font-size:28px !important; }
    .bbp-h2 { font-size:24px !important; }
    .bbp-card { display:block !important; width:100% !important; padding:0 0 8px 0 !important; }
    .bbp-stack { text-align:left !important; }
  }
  @media only screen and (max-width:360px) {
    .bbp-pad { padding-left:18px !important; padding-right:18px !important; }
    .bbp-h1 { font-size:25px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${C.tint};">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${C.tint};">${esc(
    opts.preheader,
  )}</div>
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.tint}" style="width:100%;background-color:${C.tint};border-collapse:collapse;">
    <tr>
      <td align="center" style="padding:0;">
        <table role="presentation" width="${CONTENT_WIDTH}" cellpadding="0" cellspacing="0" border="0" class="bbp-w" style="width:100%;max-width:${CONTENT_WIDTH}px;border-collapse:collapse;background-color:${C.white};">
          ${opts.bands}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

// ---------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------

/**
 * Build the text/plain alternative. Blank entries are dropped and runs
 * of blank lines collapse, so callers can pass conditional values
 * without worrying about gaps.
 */
export const textBody = (lines: Array<string | null | undefined | false>): string =>
  lines
    .map((l) => (l === false || l === null || l === undefined ? "" : String(l)))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** Standard text/plain footer for a transactional message. */
export const textFooter = (reason: string): string =>
  textBody([
    "",
    "---",
    reason,
    `Questions? ${BUSINESS.supportEmail}`,
    `${BUSINESS.legalName} (DBA ${BUSINESS.dba})`,
    BUSINESS.address,
  ]);

/** What every renderer returns. */
export type RenderedEmail = {
  subject: string;
  preheader: string;
  html: string;
  text: string;
};
