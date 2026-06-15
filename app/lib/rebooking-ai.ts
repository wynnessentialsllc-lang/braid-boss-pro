// Rebooking-AI — turns the static one-line rebooking nudge into a
// personalized, copy-paste-ready message, and drafts win-back campaigns
// for lapsed cohorts. Pure helpers + types only; the model call lives in
// /api/rebooking-ai. Everything here is unit-tested.
//
// Two owner-facing kinds:
//
//   nudge   — one client who's due/overdue to rebook. Channel-aware:
//             a text message, or an email (subject + body). Anchored to
//             the client's real last style + how long it's been.
//   winback — a marketing campaign for a lapsed segment, shaped to drop
//             straight into the existing campaign composer (name/subject/
//             body_text).
//
// Hard guardrail across both: NEVER invent a discount, price, or offer.
// An incentive only appears if the stylist explicitly supplied one.

export type RebookAiKind = "nudge" | "winback";
export type RebookChannel = "sms" | "email";
export type RebookTone = "warm" | "professional" | "playful" | "vip";

export const REBOOK_AI_KINDS: RebookAiKind[] = ["nudge", "winback"];
export const REBOOK_CHANNELS: RebookChannel[] = ["sms", "email"];
export const REBOOK_TONES: RebookTone[] = ["warm", "professional", "playful", "vip"];

// Bounds (owner-supplied but still untrusted).
export const REBOOK_AI_MAX_OFFER = 160;
export const SMS_MAX = 400;
export const SUBJECT_MAX = 90;
export const BODY_MAX = 1400;

export interface StudioContext {
  businessName: string;
  city?: string | null;
}

// Per-client brief for a nudge — only what the model needs to personalize.
// First name, not full name; no contact details.
export interface RebookBrief {
  firstName: string;
  lastStyle?: string | null;
  /** Days past the recommended rebook date; negative = due soon. */
  daysOverdue?: number;
  visitCount?: number;
  isVip?: boolean;
  lifetimeSpend?: number;
}

// Cohort brief for a win-back campaign.
export interface WinbackBrief {
  /** Lapsed threshold in days (e.g. 60 = no booking in 60+ days). */
  lapsedDays: number;
  /** Approximate recipient count, for tone (small vs. blast). */
  count: number;
  /** Styles common in the cohort, to make the copy concrete. */
  topStyles?: string[];
}

export interface NudgeSmsResult { channel: "sms"; message: string }
export interface NudgeEmailResult { channel: "email"; subject: string; body: string }
export type NudgeResult = NudgeSmsResult | NudgeEmailResult;
export interface WinbackResult { name: string; subject: string; body: string }

// ---- cleaning helpers --------------------------------------------------

const str = (v: unknown, max: number): string =>
  (typeof v === "string" ? v : "").trim().slice(0, max);

export const firstNameOf = (name: string | null | undefined): string => {
  const n = (name || "").trim().split(/\s+/)[0] || "";
  // Title-case a lowercase token; leave already-cased names alone.
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : "there";
};

/** Pick the implied tone for a client unless the caller overrides it. */
export const toneForBrief = (brief: RebookBrief, override?: RebookTone | null): RebookTone => {
  if (override && REBOOK_TONES.includes(override)) return override;
  return brief.isVip ? "vip" : "warm";
};

const TONE_HINT: Record<RebookTone, string> = {
  warm: "Warm and friendly, like texting a regular you're glad to see.",
  professional: "Polished and professional, still personable.",
  playful: "Upbeat and playful, a little fun — never gimmicky.",
  vip: "Make them feel like a valued regular: appreciative and a touch exclusive.",
};

// ---- context / prompts -------------------------------------------------

const OFFER_RULE = (offer: string) =>
  offer
    ? `The stylist is offering this incentive — mention it naturally, exactly as written, and don't change the terms: "${offer}".`
    : "No discount or offer was provided. Do NOT invent or imply any discount, price, sale, or freebie.";

const BASE_RULES = [
  "Write in the stylist's first-person voice, speaking directly to the client.",
  "Never fabricate prices, offers, dates, or availability. Keep it copy-paste ready with no placeholders like [name].",
  "Sound human, not like marketing spam. No emoji walls — at most one or two.",
];

const styleLine = (style?: string | null) =>
  style && style.trim() ? `Their last style with us was ${style.trim()}.` : "We don't have their last style on record.";

const overdueLine = (days?: number) => {
  if (days == null) return "";
  if (days <= 0) return "They're coming due for a refresh soon.";
  if (days < 21) return `It's been about ${days} days past when they'd normally rebook.`;
  return `It's been a while — roughly ${days} days past their usual rebook window.`;
};

export const buildNudgeSystem = (
  ctx: StudioContext,
  brief: RebookBrief,
  channel: RebookChannel,
  tone: RebookTone,
  offer: string,
): string => {
  const lines = [
    `You write rebooking messages for ${ctx.businessName || "a hair-braiding studio"}${ctx.city ? ` in ${ctx.city}` : ""}.`,
    `Client: ${brief.firstName}.`,
    styleLine(brief.lastStyle),
    overdueLine(brief.daysOverdue),
    brief.isVip ? "They're a VIP / loyal regular." : "",
    `Tone: ${TONE_HINT[tone]}`,
    channel === "sms"
      ? "Channel: a text message / DM. Keep it short — 2-4 sentences, under ~50 words. One clear, low-pressure call to book."
      : "Channel: email. Return a short subject line and a friendly 2-3 short-paragraph body. End with a clear call to book.",
    OFFER_RULE(offer),
    ...BASE_RULES,
  ].filter(Boolean);
  return lines.map((l) => `- ${l}`).join("\n");
};

export const buildWinbackSystem = (
  ctx: StudioContext,
  brief: WinbackBrief,
  tone: RebookTone,
  offer: string,
): string => {
  const styles = (brief.topStyles || []).filter((s) => s && s.trim()).slice(0, 5);
  const lines = [
    `You draft a win-back email campaign for ${ctx.businessName || "a hair-braiding studio"}${ctx.city ? ` in ${ctx.city}` : ""}.`,
    `Audience: ${brief.count > 0 ? `about ${brief.count} ` : ""}clients who haven't booked in ${brief.lapsedDays}+ days.`,
    styles.length ? `Styles they tend to book: ${styles.join(", ")}.` : "",
    `Tone: ${TONE_HINT[tone]}`,
    "Return a short internal campaign name, a subject line, and an email body (2-3 short paragraphs) that gently invites them back and makes booking feel easy.",
    "Address the group warmly but personally; this goes to many clients, so don't reference a single person's specific history.",
    OFFER_RULE(offer),
    ...BASE_RULES,
  ].filter(Boolean);
  return lines.map((l) => `- ${l}`).join("\n");
};

// ---- tools (forced structured output) ----------------------------------

export const REBOOK_TOOL_NAME = {
  nudge_sms: "write_text",
  nudge_email: "write_email",
  winback: "draft_campaign",
} as const;

export const rebookTool = (kind: RebookAiKind, channel: RebookChannel) => {
  if (kind === "nudge" && channel === "sms") {
    return {
      name: REBOOK_TOOL_NAME.nudge_sms,
      description: "Return a short rebooking text message.",
      input_schema: {
        type: "object" as const,
        additionalProperties: false,
        required: ["message"],
        properties: { message: { type: "string", description: "The text message, under ~50 words." } },
      },
    };
  }
  if (kind === "nudge") {
    return {
      name: REBOOK_TOOL_NAME.nudge_email,
      description: "Return a rebooking email.",
      input_schema: {
        type: "object" as const,
        additionalProperties: false,
        required: ["subject", "body"],
        properties: {
          subject: { type: "string", description: "Email subject line." },
          body: { type: "string", description: "Email body, 2-3 short paragraphs." },
        },
      },
    };
  }
  return {
    name: REBOOK_TOOL_NAME.winback,
    description: "Return a win-back email campaign draft.",
    input_schema: {
      type: "object" as const,
      additionalProperties: false,
      required: ["name", "subject", "body"],
      properties: {
        name: { type: "string", description: "Short internal campaign name." },
        subject: { type: "string", description: "Email subject line." },
        body: { type: "string", description: "Email body, 2-3 short paragraphs." },
      },
    },
  };
};

// ---- parsers -----------------------------------------------------------

export const parseNudge = (input: unknown, channel: RebookChannel): NudgeResult | null => {
  const o = (input ?? {}) as Record<string, unknown>;
  if (channel === "sms") {
    const message = str(o.message, SMS_MAX);
    return message ? { channel: "sms", message } : null;
  }
  const subject = str(o.subject, SUBJECT_MAX);
  const body = str(o.body, BODY_MAX);
  return subject && body ? { channel: "email", subject, body } : null;
};

export const parseWinback = (input: unknown): WinbackResult | null => {
  const o = (input ?? {}) as Record<string, unknown>;
  const subject = str(o.subject, SUBJECT_MAX);
  const body = str(o.body, BODY_MAX);
  if (!subject || !body) return null;
  return { name: str(o.name, 60) || "Win-back campaign", subject, body };
};

// ---- input sanitizers (for the route) ----------------------------------

export const cleanBrief = (raw: unknown): RebookBrief => {
  const o = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    firstName: firstNameOf(typeof o.firstName === "string" ? o.firstName : ""),
    lastStyle: typeof o.lastStyle === "string" ? o.lastStyle.trim().slice(0, 80) || null : null,
    daysOverdue: num(o.daysOverdue),
    visitCount: num(o.visitCount),
    isVip: o.isVip === true,
    lifetimeSpend: num(o.lifetimeSpend),
  };
};

export const cleanWinbackBrief = (raw: unknown): WinbackBrief => {
  const o = (raw ?? {}) as Record<string, unknown>;
  const lapsedRaw = Number(o.lapsedDays);
  const countRaw = Number(o.count);
  return {
    lapsedDays: Number.isFinite(lapsedRaw) ? Math.min(3650, Math.max(1, Math.round(lapsedRaw))) : 60,
    count: Number.isFinite(countRaw) ? Math.max(0, Math.round(countRaw)) : 0,
    topStyles: Array.isArray(o.topStyles)
      ? o.topStyles.filter((s): s is string => typeof s === "string").map((s) => s.trim()).filter(Boolean).slice(0, 8)
      : [],
  };
};
