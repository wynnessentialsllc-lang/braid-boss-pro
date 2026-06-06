// Social media templates.
//
// Owner-facing marketing graphics — the stylist picks a template, it's
// auto-branded with their business name / logo / accent color, then
// downloaded or shared straight to Instagram / TikTok. Square (1080px)
// canvas output, the standard Instagram feed size.
//
// This module is split so the config + filename helpers stay pure
// (node-testable, no DOM) while the canvas drawing only touches
// `document` when actually called. Fonts (Cormorant Garamond + DM Sans)
// are already loaded in app/page.tsx via a Google Fonts @import, so the
// canvas can use them once `document.fonts.ready` resolves.

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
  /** Footer handle, e.g. "@curlsbysheree" or a short booking URL. */
  handle?: string | null;
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
  const maxTextW = pw - 150;

  // --- Measure the centered stack so it's vertically balanced ------
  ctx.textAlign = "center";

  // Headline
  ctx.font = `600 96px ${FONT_DISPLAY}`;
  const headLines = wrapLines(ctx, template.headline, maxTextW);
  const headLH = 102;

  // Subhead
  ctx.font = `400 38px ${FONT_SANS}`;
  const subLines = wrapLines(ctx, template.subhead, maxTextW - 40);
  const subLH = 50;

  const logoBlock = 168; // diameter + gap
  const eyebrowBlock = 30 + 30;
  const emojiBlock = 138;
  const headBlock = headLines.length * headLH + 26;
  const subBlock = subLines.length * subLH + 44;
  const ctaBlock = 92;
  const footerReserve = 110;

  const stackH =
    logoBlock + eyebrowBlock + emojiBlock + headBlock + subBlock + ctaBlock;
  const available = innerBottom - footerReserve - innerTop;
  let y = innerTop + Math.max(0, (available - stackH) / 2);

  // --- Logo / initial ----------------------------------------------
  const logoR = 72;
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
    const initial = (branding.businessName || "B").trim().charAt(0).toUpperCase();
    ctx.fillStyle = "#FFFFFF";
    ctx.font = `600 70px ${FONT_DISPLAY}`;
    ctx.textBaseline = "middle";
    ctx.fillText(initial, cx, logoCY + 4);
    ctx.textBaseline = "alphabetic";
  }
  ctx.restore();
  y += logoBlock;

  // --- Eyebrow ------------------------------------------------------
  ctx.fillStyle = accent;
  ctx.font = `700 26px ${FONT_SANS}`;
  drawSpacedText(ctx, template.eyebrow.toUpperCase(), cx, y + 24, 6);
  y += eyebrowBlock;

  // --- Emoji motif --------------------------------------------------
  ctx.font = `110px ${FONT_SANS}`;
  ctx.fillText(template.emoji, cx, y + 104);
  y += emojiBlock;

  // --- Headline -----------------------------------------------------
  ctx.fillStyle = theme.headline;
  ctx.font = `600 96px ${FONT_DISPLAY}`;
  for (const line of headLines) {
    y += headLH;
    ctx.fillText(line, cx, y);
  }
  y += 26;

  // --- Subhead ------------------------------------------------------
  ctx.fillStyle = theme.body;
  ctx.font = `400 38px ${FONT_SANS}`;
  for (const line of subLines) {
    y += subLH;
    ctx.fillText(line, cx, y);
  }
  y += 44;

  // --- CTA pill -----------------------------------------------------
  ctx.font = `700 32px ${FONT_SANS}`;
  const ctaText = template.cta;
  const ctaW = Math.min(maxTextW, ctx.measureText(ctaText).width + 80);
  const ctaH = 76;
  roundRect(ctx, cx - ctaW / 2, y, ctaW, ctaH, ctaH / 2);
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.fillStyle = theme.ctaText;
  ctx.textBaseline = "middle";
  ctx.fillText(ctaText, cx, y + ctaH / 2 + 2);
  ctx.textBaseline = "alphabetic";

  // --- Footer: business name + handle ------------------------------
  const footY = innerBottom - 10;
  if (branding.handle) {
    ctx.fillStyle = theme.body;
    ctx.font = `500 28px ${FONT_SANS}`;
    ctx.fillText(branding.handle, cx, footY);
  }
  ctx.fillStyle = theme.headline;
  ctx.font = `600 44px ${FONT_DISPLAY}`;
  ctx.fillText(branding.businessName || "Your Studio", cx, footY - (branding.handle ? 40 : 0));

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
