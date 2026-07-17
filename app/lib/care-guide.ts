// Braid Care Guide — shared content model for the post-service aftercare email.
//
// One automated, EDITABLE email a braider can send a few days after a
// finished appointment: how to care for braids, how long to wear them, what
// most wearers get wrong, and when to reach out. Off by default — a braider
// opts in per studio and can edit/add/remove any part.
//
// This module is the single source of truth for the content SHAPE and the
// default copy. It is pure (no React, no Supabase) so it's shared by:
//   * the settings editor (renders + edits the fields),
//   * the send job (personalizes + enqueues the stored content),
//   * the email renderer (turns the content into the branded email).
// Persisted as `braid_care_guides.content` jsonb.

export type CareGuideSection = {
  /** Stable id so the editor can reorder/remove without key churn. */
  id: string;
  title: string;
  items: string[];
};

export type CareGuideMyth = { myth: string; truth: string };

export type CareGuideContent = {
  /** Opening line. Supports {client}, {style}, {studio} tokens. */
  intro: string;
  sections: CareGuideSection[];
  myths: CareGuideMyth[];
  reachOut: string[];
  /** Line under the reach-out list. Supports {studio}. */
  reachOutNote: string;
  closing: string;
  ctaLabel: string;
};

export type CareGuideSettings = {
  enabled: boolean;
  /** Days after a completed appointment to send. */
  delayDays: number;
  content: CareGuideContent;
};

export const CARE_GUIDE_MIN_DELAY = 1;
export const CARE_GUIDE_MAX_DELAY = 30;
export const CARE_GUIDE_DEFAULT_DELAY = 3;

// The out-of-the-box guide. Grounded in dermatology + professional-braider
// aftercare guidance; a braider can change every line.
export const DEFAULT_CARE_GUIDE_CONTENT: CareGuideContent = {
  intro:
    "Hi {client}, your {style} looks amazing — here's how to keep them, and your natural hair underneath, healthy the whole time you wear them. Save this one.",
  sections: [
    {
      id: "care",
      title: "How to care for your braids",
      items: [
        "Wash your scalp every 1–2 weeks (weekly if you sweat or work out) — diluted sulfate-free shampoo in a squeeze bottle, on the scalp. Don't scrub the length.",
        "Dry completely — hooded dryer, or air-dry a full day. Never tie damp braids up; trapped moisture causes odor and mildew.",
        "Moisturize with a water-based leave-in spray 1–2× a week, then a few drops of light oil to seal. Water first, oil second.",
        "Skip heavy grease and thick butters — they build up, flake, and itch.",
        "Wrap every night in a satin or silk bonnet (or satin pillowcase). The single biggest thing for keeping braids fresh.",
        "Be gentle on your edges — no tight slicking or heavy gel. They break first.",
      ],
    },
    {
      id: "duration",
      title: "How long to keep them in",
      items: [
        "6–8 weeks, max. After that, shed hair mats and tangles inside the braid — which means breakage at takedown.",
        "Give your scalp and edges a 1–2 week break before your next set.",
      ],
    },
    {
      id: "first-days",
      title: "The first few days",
      items: [
        "A little tightness or tenderness for 1–2 days is normal while your scalp adjusts.",
        "Ease it: a warm-water rinse on the scalp, gentle fingertip massage, a light tension spray, and wear your hair down (not up) at first.",
        "Too tight if you have sharp or throbbing pain, headaches, little bumps at the base of the braids, or your edges look pulled. That's not settling — message me and I'll loosen them.",
      ],
    },
  ],
  myths: [
    { myth: "Braids are a break, so I don't need to wash.", truth: "Your scalp still needs cleansing every 1–2 weeks." },
    { myth: "Pain means they'll last longer.", truth: "Pain is a warning sign, not a good install." },
    { myth: "More oil = healthier.", truth: "Over-oiling causes buildup — light and water-based wins." },
    { myth: "I can just sleep on them.", truth: "Cotton causes frizz and dryness — always wrap." },
  ],
  reachOut: [
    "Pain or headaches lasting past the first couple of days",
    "Bumps, pus, redness, or soreness along your hairline",
    "Thinning, or a fringe of short broken hairs, at your edges",
    "Itch or flaking that won't quit, or a mildew smell",
  ],
  reachOutNote: "Message {studio} and we'll help — catching these early keeps your hair healthy.",
  closing: "Take care of them and they'll take care of you.",
  ctaLabel: "Book my refresh",
};

export const blankCareGuideSettings = (): CareGuideSettings => ({
  enabled: false,
  delayDays: CARE_GUIDE_DEFAULT_DELAY,
  content: DEFAULT_CARE_GUIDE_CONTENT,
});

const str = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v : fallback;

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => str(x)).map((s) => s.trim()).filter(Boolean) : [];

const clampInt = (v: unknown, lo: number, hi: number, dflt: number): number => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
};

/**
 * Coerce stored/untrusted jsonb into a valid CareGuideContent, filling any
 * missing piece from the default so an old or partial row never renders a
 * broken email. Drops empty items; keeps at least the default when a whole
 * list was blanked so the guide is never empty on a section that exists.
 */
export const normalizeCareGuideContent = (raw: unknown): CareGuideContent => {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_CARE_GUIDE_CONTENT;

  const sectionsRaw = Array.isArray(r.sections) ? r.sections : [];
  const sections: CareGuideSection[] = sectionsRaw
    .map((s, i) => {
      const so = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
      return {
        id: str(so.id) || `section-${i + 1}`,
        title: str(so.title).trim(),
        items: strList(so.items),
      };
    })
    // A section needs a title and at least one item to render.
    .filter((s) => s.title && s.items.length > 0);

  const mythsRaw = Array.isArray(r.myths) ? r.myths : [];
  const myths: CareGuideMyth[] = mythsRaw
    .map((m) => {
      const mo = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
      return { myth: str(mo.myth).trim(), truth: str(mo.truth).trim() };
    })
    .filter((m) => m.myth && m.truth);

  return {
    intro: str(r.intro, d.intro).trim() || d.intro,
    sections: sections.length ? sections : d.sections,
    myths, // may be empty — the section is optional and simply hides
    reachOut: strList(r.reachOut),
    reachOutNote: str(r.reachOutNote, d.reachOutNote).trim(),
    closing: str(r.closing, d.closing).trim(),
    ctaLabel: str(r.ctaLabel, d.ctaLabel).trim() || d.ctaLabel,
  };
};

/** Coerce a whole settings blob (enabled + delay + content) safely. */
export const normalizeCareGuideSettings = (raw: unknown): CareGuideSettings => {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    enabled: r.enabled === true,
    delayDays: clampInt(r.delayDays, CARE_GUIDE_MIN_DELAY, CARE_GUIDE_MAX_DELAY, CARE_GUIDE_DEFAULT_DELAY),
    content: normalizeCareGuideContent(r.content),
  };
};

/** Replace {client}/{style}/{studio} tokens for a specific send/preview. */
export const personalizeCareGuideText = (
  text: string,
  vars: { client?: string | null; style?: string | null; studio?: string | null },
): string =>
  str(text)
    .replace(/\{client\}/g, (vars.client || "there").trim() || "there")
    .replace(/\{style\}/g, (vars.style || "your braids").trim() || "your braids")
    .replace(/\{studio\}/g, (vars.studio || "your stylist").trim() || "your stylist");
