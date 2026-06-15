// Social media templates.
//
// Owner-facing marketing graphics — the stylist picks a template, it's
// auto-branded with their business name / logo / accent color, then
// downloaded or shared straight to Instagram / TikTok. Square (1080px)
// canvas is already loaded in app/page.tsx via a Google Fonts @import, so
// the canvas can use them once `document.fonts.ready` resolves.

import QRCode from "qrcode";

export type SocialTemplateCategory =
  | "gift_card"
  | "now_booking"
  | "new_style"
  | "seasonal";

export interface TemplateTheme {
  bgFrom: string;
  bgTo: string;
  panelBg: string;
  panelBorder: string;
  eyebrow: string; // also the default accent (CTA fill, motif)
  headline: string;
  body: string;
  ctaText: string;
}

export interface SocialTemplate {
  id: string;
  category: SocialTemplateCategory;
  /** Short label shown on the picker card. */
  name: string;
  /** Small uppercase kicker above the headline. */
  eyebrow: string;
  /** The hero line (display serif, wrapped). */
  headline: string;
  /** Supporting sentence under the headline. */
  subhead: string;
  /** Call-to-action pill text. */
  cta: string;
  /** Decorative emoji motif (renders with the native emoji font). */
  emoji: string;
  theme: TemplateTheme;
  /**
   * When true the owner's brand accent color (if set) overrides the
   * theme's eyebrow / CTA / border so the post matches their booking
   * page. Defaults to true.
   */
  accentDriven?: boolean;
}

export const SOCIAL_CATEGORY_LABELS: Record<SocialTemplateCategory, string> = {
  gift_card: "Gift cards",
  now_booking: "Now booking",
  new_style: "New style drop",
  seasonal: "Seasonal & holiday",
};

// Theme presets keep the library visually cohesive. Each leans on the
// Braid Boss Pro palette (purple lead, coral accent) so a post looks
// on-brand even before the owner's accent color is applied.
const THEMES: Record<string, TemplateTheme> = {
  blush: {
    bgFrom: "#FFE4EC", bgTo: "#FFC2D4",
    panelBg: "#FFFFFF", panelBorder: "#FF4D6D",
    eyebrow: "#E0354F", headline: "#15111A", body: "#6F6477", ctaText: "#FFFFFF",
  },
  lavender: {
    bgFrom: "#EDE4FF", bgTo: "#C9B0F5",
    panelBg: "#FFFFFF", panelBorder: "#7C3AED",
    eyebrow: "#5B21B6", headline: "#15111A", body: "#6F6477", ctaText: "#FFFFFF",
  },
  plum: {
    bgFrom: "#2A1B3D", bgTo: "#4A2A6B",
    panelBg: "#FFFDF8", panelBorder: "#C6A15B",
    eyebrow: "#7C3AED", headline: "#15111A", body: "#6F6477", ctaText: "#FFFFFF",
  },
  sunlit: {
    bgFrom: "#FFEFD6", bgTo: "#FFC97A",
    panelBg: "#FFFFFF", panelBorder: "#E08A35",
    eyebrow: "#C9762B", headline: "#15111A", body: "#6F6477", ctaText: "#FFFFFF",
  },
  frost: {
    bgFrom: "#E6F0FF", bgTo: "#BCD4F5",
    panelBg: "#FFFFFF", panelBorder: "#3D6BC9",
    eyebrow: "#2F55A8", headline: "#15111A", body: "#6F6477", ctaText: "#FFFFFF",
  },
};

// Theme keys an AI-generated template may choose from. Exported so the
// social-AI layer can have the model pick a palette by name and the UI can
// rebuild a real TemplateTheme for the existing canvas renderer.
export const SOCIAL_THEME_KEYS = ["blush", "lavender", "plum", "sunlit", "frost"] as const;
export type SocialThemeKey = (typeof SOCIAL_THEME_KEYS)[number];

/** Resolve a theme key to its palette, falling back to lavender. */
export const getSocialTheme = (key: string | null | undefined): TemplateTheme =>
  THEMES[(key || "").trim()] ?? THEMES.lavender;

export const SOCIAL_TEMPLATES: SocialTemplate[] = [
  // ---- Gift cards -------------------------------------------------
  {
    id: "gift-cards-here",
    category: "gift_card",
    name: "Gift cards are here",
    eyebrow: "Gift Cards",
    headline: "Gift Cards Are Here!",
    subhead: "The perfect gift for the people you love.",
    cta: "Tap the link to buy",
    emoji: "🎁",
    theme: THEMES.blush,
  },
  {
    id: "treat-someone",
    category: "gift_card",
    name: "Treat someone special",
    eyebrow: "Gift Cards",
    headline: "Treat Someone Special",
    subhead: "Give the gift of a fresh new style.",
    cta: "Gift cards available now",
    emoji: "💝",
    theme: THEMES.blush,
  },
  // ---- Now booking ------------------------------------------------
  {
    id: "now-booking",
    category: "now_booking",
    name: "Now booking",
    eyebrow: "Now Booking",
    headline: "Now Booking",
    subhead: "Spots are filling fast — reserve yours today.",
    cta: "Book your appointment",
    emoji: "🗓️",
    theme: THEMES.lavender,
  },
  {
    id: "few-spots-left",
    category: "now_booking",
    name: "A few spots left",
    eyebrow: "Open Slots",
    headline: "A Few Spots Left",
    subhead: "Don't miss out on this month's availability.",
    cta: "Book now",
    emoji: "⏳",
    theme: THEMES.lavender,
  },
  // ---- New style drop ---------------------------------------------
  {
    id: "new-style-drop",
    category: "new_style",
    name: "New style drop",
    eyebrow: "New Style",
    headline: "New Style Drop",
    subhead: "Fresh looks just added to the menu.",
    cta: "Book your style",
    emoji: "✨",
    theme: THEMES.plum,
  },
  {
    id: "style-of-the-week",
    category: "new_style",
    name: "Style of the week",
    eyebrow: "Featured",
    headline: "Style of the Week",
    subhead: "Loving this look? Let's recreate it for you.",
    cta: "Tap to book",
    emoji: "💇🏾‍♀️",
    theme: THEMES.plum,
  },
  // ---- Seasonal & holiday -----------------------------------------
  {
    id: "mothers-day",
    category: "seasonal",
    name: "Mother's Day",
    eyebrow: "Mother's Day",
    headline: "Treat Yourself, Mama",
    subhead: "You deserve a little self-care this Mother's Day.",
    cta: "Gift cards & bookings open",
    emoji: "🌷",
    theme: THEMES.blush,
  },
  {
    id: "summer-ready",
    category: "seasonal",
    name: "Summer ready",
    eyebrow: "Summer",
    headline: "Get Summer Ready",
    subhead: "Vacation-proof styles that last all season.",
    cta: "Book your summer look",
    emoji: "☀️",
    theme: THEMES.sunlit,
  },
  {
    id: "holiday-glam",
    category: "seasonal",
    name: "Holiday glam",
    eyebrow: "Holidays",
    headline: "Holiday Glam",
    subhead: "Look your best for every celebration.",
    cta: "Book before slots fill",
    emoji: "❄️",
    theme: THEMES.frost,
  },
];

export const templatesByCategory = (): {
  category: SocialTemplateCategory;
  label: string;
  templates: SocialTemplate[];
}[] =>
  (Object.keys(SOCIAL_CATEGORY_LABELS) as SocialTemplateCategory[]).map((category) => ({
    category,
    label: SOCIAL_CATEGORY_LABELS[category],
    templates: SOCIAL_TEMPLATES.filter((t) => t.category === category),
  }));

/** Safe, descriptive download filename. Pure — covered by tests. */
export const socialTemplateFilename = (
  template: Pick<SocialTemplate, "id">,
  businessName?: string | null,
): string => {
  const slug = (s: string) =>
    s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const biz = businessName ? slug(businessName) : "";
  const base = biz ? `${biz}-${template.id}` : template.id;
  return `${base || "social-template"}.png`;
};

// ============================================================
//  CANVAS RENDERING (DOM — only runs when called)
// ============================================================

const FONT_DISPLAY = `"Cormorant Garamond", Georgia, serif`;
const FONT_SANS = `"DM Sans", system-ui, -apple-system, sans-serif`;

export interface SocialBranding {
  businessName: string;
  /** Pre-loaded, CORS-safe logo image, or null to render an initial. */
  logoImage?: HTMLImageElement | null;
  /** Brand accent (hex). Overrides the theme accent when accentDriven. */
  accentColor?: string | null;
  /**
   * URL the embedded QR code points to (the stylist's booking page).
   * When set, a scannable QR is drawn in the footer instead of any
   * link text. When null, the footer is just the business name.
   */
  bookingUrl?: string | null;
}

/** Resolve fonts before drawing so canvas text isn't a fallback flash. */
export const ensureFontsReady = async (): Promise<void> => {
  try {
    if (typeof document !== "undefined" && (document as any).fonts?.ready) {
      await (document as any).fonts.ready;
    }
  } catch {
    /* fall back to whatever's available */
  }
};

const isHexColor = (v?: string | null): v is string =>
  !!v && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v.trim());

const roundRect = (
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) => {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
};

const wrapLines = (
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (cur && ctx.measureText(t).width > maxWidth) {
      lines.push(cur);
      cur = w;
    } else {
      cur = t;
    }
  }
  if (cur) lines.push(cur);
  return lines;
};

// Draw a scannable QR onto the canvas. Uses qrcode's pure module
// matrix (no DOM) so we can paint it in our own colors with a white
// quiet zone for reliable scanning. Returns false if encoding fails.
const drawQrCode = (
  ctx: CanvasRenderingContext2D,
  url: string,
  x: number,
  y: number,
  size: number,
  dark: string,
): boolean => {
  try {
    const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
    const count = qr.modules.size;
    const data = qr.modules.data;
    // White card with a quiet-zone margin so scanners lock on.
    const pad = Math.round(size * 0.08);
    roundRect(ctx, x, y, size, size, Math.round(size * 0.08));
    ctx.fillStyle = "#FFFFFF";
    ctx.fill();
    const inner = size - pad * 2;
    const cell = inner / count;
    ctx.fillStyle = dark;
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (data[r * count + c]) {
          // +0.5 overdraw removes hairline gaps between cells.
          ctx.fillRect(
            x + pad + c * cell,
            y + pad + r * cell,
            cell + 0.5,
            cell + 0.5,
          );
        }
      }
    }
    return true;
  } catch {
    return false;
  }
};

const drawSpacedText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  spacing: number,
) => {
  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total =
    widths.reduce((a, b) => a + b, 0) + spacing * Math.max(0, chars.length - 1);
  let x = cx - total / 2;
  const prevAlign = ctx.textAlign;
  ctx.textAlign = "left";
  chars.forEach((c, i) => {
    ctx.fillText(c, x, y);
    x += widths[i] + spacing;
  });
  ctx.textAlign = prevAlign;
};

/**
 * Draw a template onto a square canvas. Coordinates are authored in a
 * 1080 design space and scaled to the canvas size, so the same code
 * renders both the small picker preview and the full-res export.
 */
export const drawSocialTemplate = (
  canvas: HTMLCanvasElement,
  template: SocialTemplate,
  branding: SocialBranding,
): void => {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const size = canvas.width;
  const D = 1080; // design space
  const s = size / D;

  const { theme } = template;
  const accentOn = template.accentDriven !== false;
  const accent = accentOn && isHexColor(branding.accentColor)
    ? branding.accentColor.trim()
    : theme.eyebrow;

  ctx.save();
  ctx.scale(s, s);
  ctx.clearRect(0, 0, D, D);

  // --- Background gradient -----------------------------------------
  const bg = ctx.createLinearGradient(0, 0, D, D);
  bg.addColorStop(0, theme.bgFrom);
  bg.addColorStop(1, theme.bgTo);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, D, D);

  // Soft decorative blobs in the accent.
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = accent;
  ctx.beginPath(); ctx.arc(120, 140, 180, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(980, 980, 230, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // --- Center panel -------------------------------------------------
  const m = 72;
  const pw = D - m * 2;
  const ph = D - m * 2;
  ctx.save();
  ctx.shadowColor = "rgba(21,17,26,0.18)";
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 24;
  roundRect(ctx, m, m, pw, ph, 56);
  ctx.fillStyle = theme.panelBg;
  ctx.fill();
  ctx.restore();
  roundRect(ctx, m + 10, m + 10, pw - 20, ph - 20, 46);
  ctx.lineWidth = 3;
  ctx.strokeStyle = accent;
  ctx.stroke();

  const cx = D / 2;
  const innerTop = m + 70;
  const innerBottom = D - m - 70;
  const usable = innerBottom - innerTop;
  const maxTextW = pw - 150;
  const businessName = (branding.businessName || "Your Studio").trim();
  const hasQr = !!branding.bookingUrl;

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // --- Measure every block at its natural size, THEN scale the whole
  //     stack to fit between innerTop and innerBottom. Laying the
  //     footer out as the last element in the same flow (not pinned to
  //     the bottom) means nothing can ever overlap, no matter how many
  //     lines the headline or subhead wrap to. ---------------------
  ctx.font = `600 92px ${FONT_DISPLAY}`;
  const headLines = wrapLines(ctx, template.headline, maxTextW);
  ctx.font = `400 36px ${FONT_SANS}`;
  const subLines = wrapLines(ctx, template.subhead, maxTextW - 40);

  // Base (unscaled) metrics.
  const LOGO_D = 140, EYEBROW_H = 28, EMOJI_H = 104;
  const HEAD_LH = 98, SUB_LH = 48, CTA_H = 74;
  const QR_SIZE = 150, NAME_ONLY_H = 50;
  const G_LOGO = 26, G_EYEBROW = 18, G_EMOJI = 12, G_HEAD = 16, G_SUB = 30, G_CTA = 38;

  const footerH = hasQr ? QR_SIZE : NAME_ONLY_H;
  const natural =
    LOGO_D + G_LOGO +
    EYEBROW_H + G_EYEBROW +
    EMOJI_H + G_EMOJI +
    headLines.length * HEAD_LH + G_HEAD +
    subLines.length * SUB_LH + G_SUB +
    CTA_H + G_CTA +
    footerH;

  const k = Math.min(1, usable / natural);
  let y = innerTop + Math.max(0, (usable - natural * k) / 2);

  // --- Logo / initial ----------------------------------------------
  const logoR = (LOGO_D / 2) * k;
  const logoCY = y + logoR;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, logoCY, logoR, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = accent;
  ctx.fill();
  if (branding.logoImage && branding.logoImage.complete && branding.logoImage.naturalWidth > 0) {
    ctx.save();
    ctx.clip();
    const img = branding.logoImage;
    const ar = img.naturalWidth / img.naturalHeight;
    let dw = logoR * 2, dh = logoR * 2;
    if (ar > 1) dw = dh * ar; else dh = dw / ar;
    ctx.drawImage(img, cx - dw / 2, logoCY - dh / 2, dw, dh);
    ctx.restore();
  } else {
    const initial = businessName.charAt(0).toUpperCase() || "B";
    ctx.fillStyle = "#FFFFFF";
    ctx.font = `600 ${70 * k}px ${FONT_DISPLAY}`;
    ctx.textBaseline = "middle";
    ctx.fillText(initial, cx, logoCY);
    ctx.textBaseline = "alphabetic";
  }
  ctx.restore();
  y += LOGO_D * k + G_LOGO * k;

  // --- Eyebrow ------------------------------------------------------
  ctx.fillStyle = accent;
  ctx.font = `700 ${26 * k}px ${FONT_SANS}`;
  drawSpacedText(ctx, template.eyebrow.toUpperCase(), cx, y + EYEBROW_H * k, 6 * k);
  y += EYEBROW_H * k + G_EYEBROW * k;

  // --- Emoji motif --------------------------------------------------
  ctx.font = `${100 * k}px ${FONT_SANS}`;
  ctx.fillText(template.emoji, cx, y + EMOJI_H * k);
  y += EMOJI_H * k + G_EMOJI * k;

  // --- Headline -----------------------------------------------------
  ctx.fillStyle = theme.headline;
  ctx.font = `600 ${92 * k}px ${FONT_DISPLAY}`;
  for (const line of headLines) {
    y += HEAD_LH * k;
    ctx.fillText(line, cx, y);
  }
  y += G_HEAD * k;

  // --- Subhead ------------------------------------------------------
  ctx.fillStyle = theme.body;
  ctx.font = `400 ${36 * k}px ${FONT_SANS}`;
  for (const line of subLines) {
    y += SUB_LH * k;
    ctx.fillText(line, cx, y);
  }
  y += G_SUB * k;

  // --- CTA pill -----------------------------------------------------
  ctx.font = `700 ${31 * k}px ${FONT_SANS}`;
  const ctaText = template.cta;
  const ctaW = Math.min(maxTextW, ctx.measureText(ctaText).width + 80 * k);
  const ctaH = CTA_H * k;
  roundRect(ctx, cx - ctaW / 2, y, ctaW, ctaH, ctaH / 2);
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.fillStyle = theme.ctaText;
  ctx.textBaseline = "middle";
  ctx.fillText(ctaText, cx, y + ctaH / 2 + 1);
  ctx.textBaseline = "alphabetic";
  y += ctaH + G_CTA * k;

  // --- Footer -------------------------------------------------------
  // With a booking URL: a scannable QR on the left + the business name
  // and a "Scan to book" caption to its right. Without: just the name.
  let footerDrawn = false;
  if (hasQr) {
    const qpx = QR_SIZE * k;
    ctx.font = `600 ${40 * k}px ${FONT_DISPLAY}`;
    const nameW = ctx.measureText(businessName).width;
    ctx.font = `700 ${22 * k}px ${FONT_SANS}`;
    const capW = ctx.measureText("SCAN TO BOOK").width + 6 * k * 11;
    const txtW = Math.max(nameW, capW);
    const gap = 26 * k;
    const groupW = qpx + gap + txtW;
    const gx = cx - groupW / 2;
    // drawQrCode only paints once encoding succeeds, so a failure
    // leaves the area untouched and we fall through to the name.
    if (drawQrCode(ctx, branding.bookingUrl!, gx, y, qpx, theme.headline)) {
      const txc = gx + qpx + gap + txtW / 2;
      ctx.fillStyle = theme.headline;
      ctx.font = `600 ${40 * k}px ${FONT_DISPLAY}`;
      ctx.fillText(businessName, txc, y + qpx / 2 - 6 * k);
      ctx.fillStyle = accent;
      ctx.font = `700 ${22 * k}px ${FONT_SANS}`;
      drawSpacedText(ctx, "SCAN TO BOOK", txc, y + qpx / 2 + 34 * k, 6 * k);
      footerDrawn = true;
    }
  }
  if (!footerDrawn) {
    ctx.fillStyle = theme.headline;
    ctx.font = `600 ${44 * k}px ${FONT_DISPLAY}`;
    ctx.fillText(businessName, cx, y + (hasQr ? (QR_SIZE * k) / 2 : NAME_ONLY_H * k * 0.7));
  }

  ctx.restore();
};

/** Render a full-resolution PNG blob for download / share. */
export const renderSocialTemplateBlob = async (
  template: SocialTemplate,
  branding: SocialBranding,
  size = 1080,
): Promise<Blob> => {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  await ensureFontsReady();
  drawSocialTemplate(canvas, template, branding);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Could not render image"))),
      "image/png",
    );
  });
};

/** Load a logo URL into a CORS-safe image for canvas use, or null. */
export const loadBrandLogo = (url?: string | null): Promise<HTMLImageElement | null> =>
  new Promise((resolve) => {
    if (!url || typeof window === "undefined") {
      resolve(null);
      return;
    }
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // tolerate CORS / 404 — fall back to initial
    img.src = url;
  });
