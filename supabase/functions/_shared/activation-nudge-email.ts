// Braid Boss Pro — activation nudge.
//
// The onboarding "you still have setup steps left" email, mailed at the
// day 1 / 3 / 7 / 14 / 21 checkpoints of a stylist's free trial. Some
// other part of the system (SQL, see process_activation_nudges or its
// equivalent) decides WHICH checkpoint this is and WHAT is still
// incomplete; this module only renders what it is handed. It never
// computes days-since-signup, never decides which step is "next", and
// treats every `done` flag as an opaque boolean the caller already
// worked out.
//
// Pure render module, like ./monthly-review-email.ts: no Deno APIs, no
// env reads, no I/O. The Deno worker, the dev preview route, and the
// unit tests all call the same function, so what the preview shows is
// byte for byte what Resend sends.
//
// Copy rules carried over from the lifecycle templates:
//   • no em dashes in stylist-facing copy
//   • no urgency or pressure language: no "hurry", no countdown framing,
//     no false scarcity. This is a coaching nudge, not a deadline.
//   • never state a claim the caller didn't supply data for
//   • a completed step still appears, checked off, so the checklist
//     always reads as the stylist's whole setup, not just what's left

import {
  C,
  FONT_BODY,
  FONT_DISPLAY,
  band,
  button,
  document_,
  esc,
  escUrl,
  eyebrow,
  footer,
  greeting,
  headline,
  masthead,
  normalizeBase,
  p,
  rule,
  textBody,
  textFooter,
  type RenderedEmail,
} from "./email-kit.ts";

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

export type ActivationStep = {
  key: "businessName" | "services" | "availability" | "stripe" | "bookingLink";
  done: boolean;
  title: string; // e.g. "Add your business name"
  body: string; // one sentence on why it matters
  actionUrl: string; // deep link into the app for this specific step
  lessonUrl: string; // deep link into the Braider Education Hub lesson for this step
};

export type ActivationNudgeArgs = {
  firstName?: string | null;
  studioName?: string | null;
  /** Which checkpoint this is. Used only for subject/headline tone, never for logic. */
  daysSinceStart: number;
  /**
   * Every one of the possible steps, done or not, in the order the
   * caller wants them displayed. Steps with done:true still render, as
   * a checked-off row, so the whole checklist is visible at once.
   */
  steps: ActivationStep[];
  dashboardUrl?: string | null;
  baseUrl?: string | null;
};

// ---------------------------------------------------------------------
// Copy by checkpoint
//
// Same band structure at every checkpoint (masthead, hero, checklist,
// closing CTA, footer). Only the words change, so this stays one
// function with copy branches rather than five separate templates.
// ---------------------------------------------------------------------

type Bucket = "day1" | "day3" | "day7" | "day14" | "day21";

const bucketOf = (daysSinceStart: unknown): Bucket => {
  const n = Number(daysSinceStart);
  const d = Number.isFinite(n) ? n : 0;
  if (d <= 1) return "day1";
  if (d <= 3) return "day3";
  if (d <= 7) return "day7";
  if (d <= 14) return "day14";
  return "day21";
};

const COPY: Record<
  Bucket,
  { subject: string; eyebrowText: string; headlineText: string; intro: string }
> = {
  day1: {
    subject: "Here's what's left to open your booking page",
    eyebrowText: "Getting started",
    headlineText: "Let's finish opening your doors.",
    intro:
      "you're just a few steps from a booking page you can share. Here is exactly what's left.",
  },
  day3: {
    subject: "A quick setup check for your Braid Boss Pro account",
    eyebrowText: "Setup check",
    headlineText: "You're off to a good start.",
    intro: "a few steps still stand between you and a booking page clients can use.",
  },
  day7: {
    subject: "One week in: here's where your setup stands",
    eyebrowText: "One week in",
    headlineText: "You're partway there.",
    intro: "here is where your setup stands, and what's left to finish it.",
  },
  day14: {
    subject: "Let's get your Braid Boss Pro setup finished",
    eyebrowText: "Almost there",
    headlineText: "Your setup is almost done.",
    intro: "a short list stands between you and a booking page that's fully ready for clients.",
  },
  day21: {
    subject: "Finishing your Braid Boss Pro setup",
    eyebrowText: "Let's finish this",
    headlineText: "These last steps are what's left.",
    intro: "once these are done, your booking page is completely live for clients.",
  },
};

const ALL_DONE = {
  subject: "You're all set up on Braid Boss Pro",
  eyebrowText: "All set",
  headlineText: "You're all set up.",
  intro: "every setup step on your account is complete. There is nothing left to finish here.",
};

// ---------------------------------------------------------------------
// Checklist
//
// Kept local rather than pushed into email-kit: this row shape (a
// checked-off state versus an actionable state with two links) exists
// to draw this one email, and the kit stays the vocabulary the rest of
// the account and billing mail already shares.
// ---------------------------------------------------------------------

/** Only ever show a URL that is actually a live http(s) link. */
const plainUrl = (raw: unknown): string => {
  const s = String(raw ?? "").trim();
  return /^https?:\/\//i.test(s) ? s : "";
};

const stepIcon = (opts: { done: boolean; index: number }): string =>
  opts.done
    ? `<td width="28" valign="top" style="width:28px;padding:1px 14px 0 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
          <tr>
            <td align="center" valign="middle" bgcolor="${C.success}" style="width:28px;height:28px;background-color:${C.success};border-radius:14px;font-family:${FONT_BODY};font-size:14px;font-weight:700;color:${C.white};text-align:center;line-height:28px;">&#10003;</td>
          </tr>
        </table>
      </td>`
    : `<td width="28" valign="top" style="width:28px;padding:1px 14px 0 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
          <tr>
            <td align="center" valign="middle" bgcolor="${C.tint}" style="width:28px;height:28px;background-color:${C.tint};border:1px solid ${C.hairline};border-radius:14px;font-family:${FONT_BODY};font-size:12px;font-weight:700;color:${C.purpleDeep};text-align:center;line-height:26px;">${opts.index}</td>
          </tr>
        </table>
      </td>`;

/** The "Do this" pill plus the lighter "See the guide" link. Not-done rows only. */
const stepActions = (step: ActivationStep): string => {
  const doHref = escUrl(step.actionUrl);
  const learnHref = escUrl(step.lessonUrl);
  if (!doHref && !learnHref) return "";
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:12px 0 0;">
      <tr>
        ${
          doHref
            ? `<td style="padding:0 14px 0 0;"><a href="${doHref}" style="display:inline-block;padding:9px 18px;font-family:${FONT_BODY};font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${C.white};background-color:${C.purple};border-radius:6px;text-decoration:none;">Do this</a></td>`
            : ""
        }
        ${
          learnHref
            ? `<td valign="middle"><a href="${learnHref}" style="font-family:${FONT_BODY};font-size:12px;font-weight:600;color:${C.muted};text-decoration:underline;">See the guide</a></td>`
            : ""
        }
      </tr>
    </table>`;
};

/** One checklist row: a checked-off treatment when done, an actionable one when not. */
const checklistRow = (opts: { step: ActivationStep; index: number; last?: boolean }): string => {
  const { step, index, last } = opts;
  const titleColor = step.done ? C.muted : C.ink;
  const doneTag = step.done
    ? `<span style="margin-left:8px;font-family:${FONT_BODY};font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${C.success};">Done</span>`
    : "";
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
    <tr>
      ${stepIcon({ done: step.done, index })}
      <td valign="top" style="padding:0 0 ${last ? "0" : "20px"};">
        <p style="margin:0;font-family:${FONT_BODY};font-size:15px;line-height:1.4;font-weight:700;color:${titleColor};">${esc(
          step.title,
        )}${doneTag}</p>
        <p style="margin:4px 0 0;font-family:${FONT_BODY};font-size:13px;line-height:1.5;color:${
          step.done ? C.mutedSoft : C.body
        };">${esc(step.body)}</p>
        ${step.done ? "" : stepActions(step)}
      </td>
    </tr>
  </table>`;
};

const sectionLabel = (text: string, color: string = C.purple): string =>
  `<p style="margin:0 0 14px;font-family:${FONT_BODY};font-size:11px;line-height:16px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:${color};">${esc(
    text,
  )}</p>`;

// ---------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------

/**
 * Render the activation nudge.
 *
 * The caller should only enqueue this when at least one step is still
 * incomplete, but a bad call is rendered defensively rather than
 * thrown: with nothing left to do (or no steps supplied at all), the
 * checklist is swapped for a short "you're all set" message instead of
 * an empty or broken-looking list.
 */
export const renderActivationNudge = (args: ActivationNudgeArgs): RenderedEmail => {
  const base = normalizeBase(args.baseUrl);
  const studio = String(args.studioName ?? "").trim();
  const steps = Array.isArray(args.steps) ? args.steps : [];
  const doneCount = steps.filter((s) => s && s.done).length;
  const allDone = steps.every((s) => s && s.done);

  const dashboardUrl = String(args.dashboardUrl ?? "").trim() || base;
  const bucket = bucketOf(args.daysSinceStart);
  const copy = allDone ? ALL_DONE : COPY[bucket];

  const subject = studio ? `${copy.subject} (${studio})` : copy.subject;
  const preheader = allDone
    ? "Every setup step is complete. Nothing left to finish here."
    : `${doneCount} of ${steps.length} setup step${steps.length === 1 ? "" : "s"} done.`;

  // ---- hero -----------------------------------------------------------
  const introText = `${greeting(args.firstName)}, ${copy.intro}`;
  const heroBand = band({
    bg: C.purple,
    padding: "40px 32px 44px",
    content: [
      eyebrow(copy.eyebrowText, "rgba(255,255,255,0.82)"),
      headline(copy.headlineText, { color: C.white, size: 32 }),
      rule(C.coral),
      p(esc(introText), { color: "rgba(255,255,255,0.92)", size: 16, margin: "22px 0 0" }),
    ].join(""),
  });

  // ---- checklist --------------------------------------------------------
  const checklistBand = allDone
    ? band({
        bg: C.white,
        padding: "30px 32px 8px",
        content: p(
          "Your booking page, services, availability, and payments are all set. There is nothing left on this checklist.",
          { margin: "0", size: 15 },
        ),
      })
    : band({
        bg: C.white,
        padding: "30px 32px 8px",
        content: [
          sectionLabel(`${doneCount} of ${steps.length} done`),
          steps
            .map((step, i) =>
              checklistRow({ step, index: i + 1, last: i === steps.length - 1 }),
            )
            .join(""),
        ].join(""),
      });

  // ---- close ------------------------------------------------------------
  const ctaBand = band({
    bg: C.white,
    padding: "24px 32px 36px",
    content: [
      button({
        label: "Open your dashboard",
        url: dashboardUrl,
        align: "center",
        marginTop: 6,
      }),
      p(
        "Every one of these lives in Settings whenever you're ready to pick it back up.",
        { margin: "18px 0 0", size: 12, color: C.muted, align: "center" },
      ),
    ].join(""),
  });

  const html = document_({
    title: subject,
    preheader,
    bands: [
      masthead(base),
      heroBand,
      checklistBand,
      ctaBand,
      footer({
        base,
        reason:
          "You received this because you're inside your Braid Boss Pro free trial. It stops once your setup is finished.",
      }),
    ].join(""),
  });

  const text = textBody([
    copy.headlineText,
    "",
    `${greeting(args.firstName)}, ${copy.intro}`,
    "",
    allDone
      ? "Every setup step on your account is complete."
      : `Setup checklist (${doneCount} of ${steps.length} done):`,
    "",
    ...(allDone
      ? []
      : steps.flatMap((step) => {
          if (step.done) return [`[done] ${step.title}`, ""];
          const doUrl = plainUrl(step.actionUrl);
          const learnUrl = plainUrl(step.lessonUrl);
          return [
            `[ ] ${step.title}`,
            `    ${step.body}`,
            doUrl ? `    Do this: ${doUrl}` : "",
            learnUrl ? `    Guide: ${learnUrl}` : "",
            "",
          ];
        })),
    `Open your dashboard: ${dashboardUrl}`,
    textFooter(
      "You received this because you're inside your Braid Boss Pro free trial. It stops once your setup is finished.",
    ),
  ]);

  return { subject, preheader, html, text };
};
