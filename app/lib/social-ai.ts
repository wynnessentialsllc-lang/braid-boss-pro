// Social-AI — the "extras" that turn the static social-template gallery
// into an AI content studio. Pure helpers + types only; the network/model
// call lives in /api/social-ai. Everything here is unit-tested.
//
// Four owner-facing kinds, all anchored to the stylist's REAL business
// (name + service catalog) so the copy sounds like them and never invents
// services or prices:
//
//   caption  — caption + hashtags + best-time for a chosen template
//   template — a brand-new template from a text prompt ("Friday flash sale")
//   photo    — a caption + matching template from a finished-braid photo
//   plan     — a week of post ideas tuned to seasonality + slow days
//
// Generated templates feed the EXISTING canvas renderer unchanged: the
// model picks copy + a theme key, and buildAiTemplate() assembles a real
// SocialTemplate via getSocialTheme().

import {
  getSocialTheme,
  SOCIAL_THEME_KEYS,
  type SocialTemplate,
  type SocialTemplateCategory,
} from "./social-templates";

export type SocialAiKind = "caption" | "template" | "photo" | "plan";

export const SOCIAL_AI_KINDS: SocialAiKind[] = ["caption", "template", "photo", "plan"];

const CATEGORIES: SocialTemplateCategory[] = ["gift_card", "now_booking", "new_style", "seasonal"];

// Bounds — the prompt is owner-supplied but still untrusted.
export const SOCIAL_AI_MAX_PROMPT = 600;
export const MAX_HASHTAGS = 15;

export interface StudioContext {
  businessName: string;
  /** Active catalog — names + prices only; copy never invents these. */
  services: { name: string; price: number }[];
  /** Optional city/area for localized hashtags + seasonality. */
  city?: string | null;
  /** Optional weekday names the stylist is typically quiet (for "plan"). */
  slowDays?: string[];
}

export interface CaptionResult {
  caption: string;
  hashtags: string[];
  bestTime: string;
}

// Copy + layout for a generated template. themeKey is one of
// SOCIAL_THEME_KEYS; buildAiTemplate() turns this into a SocialTemplate.
export interface TemplateFields {
  name: string;
  eyebrow: string;
  headline: string;
  subhead: string;
  cta: string;
  emoji: string;
  category: SocialTemplateCategory;
  themeKey: string;
}

export interface PhotoResult extends TemplateFields, CaptionResult {}

export interface PlanPost {
  day: string;
  idea: string;
  category: SocialTemplateCategory;
}
export interface PlanResult {
  posts: PlanPost[];
}

// ---- shared cleaning helpers -------------------------------------------

const str = (v: unknown, max = 200): string =>
  (typeof v === "string" ? v : "").trim().slice(0, max);

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;

/** Normalize hashtags: ensure leading #, strip spaces, dedupe, cap count. */
export const cleanHashtags = (raw: unknown): string[] => {
  const arr = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of arr) {
    if (typeof item !== "string") continue;
    let tag = item.trim().replace(/\s+/g, "");
    if (!tag) continue;
    if (!tag.startsWith("#")) tag = `#${tag}`;
    // Keep only #word characters; drop anything left empty.
    tag = "#" + tag.slice(1).replace(/[^A-Za-z0-9_]/g, "");
    if (tag.length < 2) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_HASHTAGS) break;
  }
  return out;
};

// ---- context / prompt --------------------------------------------------

export const studioSummary = (ctx: StudioContext): string => {
  const biz = (ctx.businessName || "this studio").trim();
  const svc = ctx.services.length
    ? ctx.services
        .slice(0, 20)
        .map((s) => `${s.name} ($${Math.round(s.price)})`)
        .join(", ")
    : "(no services listed yet)";
  const where = ctx.city?.trim() ? ` based in ${ctx.city.trim()}` : "";
  return `Business: ${biz}${where}.\nServices: ${svc}.`;
};

const VOICE_RULES = [
  "Voice: warm, confident, on-brand for a hair-braiding business. Speak to the client, not about them.",
  "Never invent services, prices, or discounts the business didn't list. It's fine to omit prices entirely.",
  "Keep it social-media native — short lines, tasteful emoji (no more than a few), no corporate stiffness.",
];

const TEMPLATE_RULES = [
  `category must be one of: ${CATEGORIES.join(", ")}.`,
  `themeKey must be one of: ${SOCIAL_THEME_KEYS.join(", ")}.`,
  "headline is the big hero line (<= 24 chars works best). subhead is one supporting sentence. cta is a short button label (e.g. \"Book now\"). eyebrow is a 1-2 word kicker. emoji is a single relevant emoji.",
];

export const buildSystemPrompt = (kind: SocialAiKind, ctx: StudioContext): string => {
  const head = studioSummary(ctx);
  const rules = (lines: string[]) => [...VOICE_RULES, ...lines].map((l) => `- ${l}`).join("\n");
  switch (kind) {
    case "caption":
      return `${head}\n\nWrite an Instagram/TikTok caption for the promo graphic described by the user.\n${rules([
        "Return the caption, a set of relevant hashtags (mix of broad + niche + local), and a best-time-to-post suggestion (e.g. \"Thu 6-8pm\").",
        "8-15 hashtags. Caption: 1-3 short lines plus a clear call to action.",
      ])}`;
    case "template":
      return `${head}\n\nThe user describes a promo. Design a branded square-post template for it.\n${rules(TEMPLATE_RULES)}`;
    case "photo":
      return `${head}\n\nA finished-braid photo is attached. Write a post that shows it off: a matching template AND a caption.\n${rules([
        ...TEMPLATE_RULES,
        "Base the copy on what you actually see (style, length, color) — don't overclaim.",
        "Also return caption, hashtags (8-15, mix broad + niche + local), and best-time-to-post.",
      ])}`;
    case "plan":
      return `${head}\n\nPlan one week (7 posts) of social content for this business.\n${rules([
        `Each post: a day label, a concrete idea (one sentence), and a category (one of: ${CATEGORIES.join(", ")}).`,
        ctx.slowDays?.length
          ? `Lean promotional/booking content toward these typically-quiet days: ${ctx.slowDays.join(", ")}.`
          : "Vary the mix across booking pushes, style showcases, gift cards, and seasonal hooks.",
        "Tie at least one idea to the current season or an upcoming holiday.",
      ])}`;
  }
};

// ---- tools (forced structured output) ----------------------------------

const captionProps = {
  caption: { type: "string", description: "The post caption, 1-3 short lines with a call to action." },
  hashtags: { type: "array", items: { type: "string" }, description: "8-15 relevant hashtags." },
  bestTime: { type: "string", description: 'Best time to post, e.g. "Thu 6-8pm".' },
};

const templateProps = {
  name: { type: "string", description: "Short label for the template picker." },
  eyebrow: { type: "string", description: "1-2 word kicker above the headline." },
  headline: { type: "string", description: "The hero line." },
  subhead: { type: "string", description: "One supporting sentence." },
  cta: { type: "string", description: "Short button label, e.g. \"Book now\"." },
  emoji: { type: "string", description: "A single relevant emoji." },
  category: { type: "string", enum: CATEGORIES, description: "Template category." },
  themeKey: { type: "string", enum: [...SOCIAL_THEME_KEYS], description: "Color palette." },
};

export const SOCIAL_AI_TOOL_NAME: Record<SocialAiKind, string> = {
  caption: "write_caption",
  template: "design_template",
  photo: "design_post",
  plan: "plan_week",
};

export const socialAiTool = (kind: SocialAiKind) => {
  switch (kind) {
    case "caption":
      return {
        name: SOCIAL_AI_TOOL_NAME.caption,
        description: "Return a caption, hashtags, and best time to post.",
        input_schema: {
          type: "object" as const,
          additionalProperties: false,
          required: ["caption", "hashtags", "bestTime"],
          properties: captionProps,
        },
      };
    case "template":
      return {
        name: SOCIAL_AI_TOOL_NAME.template,
        description: "Return the copy and theme for a branded promo template.",
        input_schema: {
          type: "object" as const,
          additionalProperties: false,
          required: ["name", "eyebrow", "headline", "subhead", "cta", "emoji", "category", "themeKey"],
          properties: templateProps,
        },
      };
    case "photo":
      return {
        name: SOCIAL_AI_TOOL_NAME.photo,
        description: "Return a matching template plus a caption for the attached photo.",
        input_schema: {
          type: "object" as const,
          additionalProperties: false,
          required: ["name", "eyebrow", "headline", "subhead", "cta", "emoji", "category", "themeKey", "caption", "hashtags", "bestTime"],
          properties: { ...templateProps, ...captionProps },
        },
      };
    case "plan":
      return {
        name: SOCIAL_AI_TOOL_NAME.plan,
        description: "Return a 7-post weekly content plan.",
        input_schema: {
          type: "object" as const,
          additionalProperties: false,
          required: ["posts"],
          properties: {
            posts: {
              type: "array",
              description: "Exactly 7 posts.",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["day", "idea", "category"],
                properties: {
                  day: { type: "string" },
                  idea: { type: "string" },
                  category: { type: "string", enum: CATEGORIES },
                },
              },
            },
          },
        },
      };
  }
};

// ---- parsers (validate + clamp model output) ---------------------------

export const parseCaption = (input: unknown): CaptionResult | null => {
  const o = (input ?? {}) as Record<string, unknown>;
  const caption = str(o.caption, 600);
  if (!caption) return null;
  return { caption, hashtags: cleanHashtags(o.hashtags), bestTime: str(o.bestTime, 60) };
};

const parseTemplateFields = (o: Record<string, unknown>): TemplateFields | null => {
  const headline = str(o.headline, 60);
  if (!headline) return null;
  return {
    name: str(o.name, 60) || headline,
    eyebrow: str(o.eyebrow, 30),
    headline,
    subhead: str(o.subhead, 160),
    cta: str(o.cta, 40) || "Book now",
    emoji: str(o.emoji, 8) || "✨",
    category: oneOf(o.category, CATEGORIES, "now_booking"),
    themeKey: oneOf(o.themeKey, SOCIAL_THEME_KEYS, "lavender"),
  };
};

export const parseTemplate = (input: unknown): TemplateFields | null =>
  parseTemplateFields((input ?? {}) as Record<string, unknown>);

export const parsePhoto = (input: unknown): PhotoResult | null => {
  const o = (input ?? {}) as Record<string, unknown>;
  const fields = parseTemplateFields(o);
  const caption = parseCaption(o);
  if (!fields || !caption) return null;
  return { ...fields, ...caption };
};

export const parsePlan = (input: unknown): PlanResult | null => {
  const o = (input ?? {}) as Record<string, unknown>;
  const raw = Array.isArray(o.posts) ? o.posts : [];
  const posts: PlanPost[] = [];
  for (const p of raw) {
    const obj = (p ?? {}) as Record<string, unknown>;
    const idea = str(obj.idea, 240);
    if (!idea) continue;
    posts.push({
      day: str(obj.day, 30) || `Day ${posts.length + 1}`,
      idea,
      category: oneOf(obj.category, CATEGORIES, "now_booking"),
    });
    if (posts.length >= 7) break;
  }
  return posts.length ? { posts } : null;
};

// ---- assemble a renderable template ------------------------------------

let aiTemplateSeq = 0;

/**
 * Turn AI copy + a theme key into a real SocialTemplate the existing
 * canvas renderer can draw — no renderer changes needed.
 */
export const buildAiTemplate = (fields: TemplateFields, id?: string): SocialTemplate => ({
  id: id || `ai-${Date.now()}-${aiTemplateSeq++}`,
  category: fields.category,
  name: fields.name,
  eyebrow: fields.eyebrow || fields.name,
  headline: fields.headline,
  subhead: fields.subhead,
  cta: fields.cta,
  emoji: fields.emoji,
  theme: getSocialTheme(fields.themeKey),
});
