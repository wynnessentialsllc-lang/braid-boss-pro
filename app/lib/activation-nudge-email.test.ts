// Tests for the activation nudge onboarding email.
//
// The renderer is a pure function, so these assert on the rendered
// markup and text directly. No network, no database, no mail.
//
// The theme running through them: this email only ever renders what the
// caller (the SQL checkpoint job) handed it. It never decides which
// step is done, so these tests check that a done step renders as
// checked off with no action links, a not-done step renders its title,
// body, and both links, and a caller error (nothing left, or nothing
// supplied) still produces a clean message instead of a broken one.

import { describe, expect, it } from "vitest";

import {
  renderActivationNudge,
  type ActivationNudgeArgs,
  type ActivationStep,
} from "../../supabase/functions/_shared/activation-nudge-email.ts";
import { FIXTURES } from "../../supabase/functions/_shared/email-fixtures.ts";

const step = (over: Partial<ActivationStep> = {}): ActivationStep => ({
  key: "services",
  done: false,
  title: "Add your first service",
  body: "Set a price, duration, and deposit so clients can actually book you.",
  actionUrl: "https://braidbosspro.app/?n=services",
  lessonUrl: "https://braidbosspro.app/?n=educationHub&lesson=build-services-menu",
  ...over,
});

const BASE: ActivationNudgeArgs = {
  firstName: "Sheree",
  studioName: "SBW Braiding",
  daysSinceStart: 3,
  steps: [
    step({ key: "businessName", done: true, title: "Add your business name" }),
    step({ key: "services", done: false }),
    step({
      key: "availability",
      done: false,
      title: "Set your availability",
      body: "Choose the days and hours you want clients to see open.",
      actionUrl: "https://braidbosspro.app/?n=availability",
      lessonUrl: "https://braidbosspro.app/?n=educationHub&lesson=set-availability",
    }),
    step({
      key: "stripe",
      done: false,
      title: "Connect Stripe",
      body: "Let deposits and payments go straight to your bank account.",
      actionUrl: "https://braidbosspro.app/?n=stripeConnect",
      lessonUrl: "https://braidbosspro.app/?n=educationHub&lesson=connect-stripe",
    }),
    step({
      key: "bookingLink",
      done: true,
      title: "Claim your booking link",
    }),
  ],
  dashboardUrl: "https://braidbosspro.app",
};

const render = (over: Partial<ActivationNudgeArgs> = {}) =>
  renderActivationNudge({ ...BASE, ...over });

// ---------------------------------------------------------------------
// Checklist rows
// ---------------------------------------------------------------------

describe("checklist rows", () => {
  it("renders a done step as checked off, with no action links", () => {
    // A second, not-done step keeps the fixture out of the all-done
    // defensive branch, which is covered separately below.
    const { html } = render({
      steps: [
        step({
          key: "businessName",
          done: true,
          title: "Add your business name",
          actionUrl: "https://braidbosspro.app/?n=settings",
          lessonUrl: "https://braidbosspro.app/?n=educationHub&lesson=customize-booking-page",
        }),
        step({ key: "services", done: false }),
      ],
    });
    expect(html).toContain("Add your business name");
    expect(html).toContain("Done");
    // The done step's own links must not appear anywhere in the markup,
    // even though the sibling not-done step does render its own pair.
    expect(html).not.toContain('href="https://braidbosspro.app/?n=settings"');
    expect(html).not.toContain(
      'href="https://braidbosspro.app/?n=educationHub&amp;lesson=customize-booking-page"',
    );
  });

  it("renders a not-done step with its title, body, and both links", () => {
    const { html } = render({
      steps: [
        step({
          key: "stripe",
          done: false,
          title: "Connect Stripe",
          body: "Let deposits and payments go straight to your bank account.",
          actionUrl: "https://braidbosspro.app/?n=stripeConnect",
          lessonUrl: "https://braidbosspro.app/?n=educationHub&lesson=connect-stripe",
        }),
      ],
    });
    expect(html).toContain("Connect Stripe");
    expect(html).toContain("Let deposits and payments go straight to your bank account.");
    expect(html).toContain('href="https://braidbosspro.app/?n=stripeConnect"');
    expect(html).toContain(
      'href="https://braidbosspro.app/?n=educationHub&amp;lesson=connect-stripe"',
    );
    expect(html).toContain("Do this");
    expect(html).toContain("See the guide");
  });

  it("keeps every step visible, done or not, rather than only showing what's left", () => {
    const { html } = render();
    expect(html).toContain("Add your business name");
    expect(html).toContain("Claim your booking link");
    expect(html).toContain("Set your availability");
    expect(html).toContain("Connect Stripe");
  });

  it("lists done and not-done steps with the right markers in the text alternative", () => {
    const { text } = render();
    expect(text).toContain("[done] Add your business name");
    expect(text).toContain("[done] Claim your booking link");
    expect(text).toContain("[ ] Set your availability");
    expect(text).toContain("[ ] Connect Stripe");
    expect(text).toContain("Do this: https://braidbosspro.app/?n=stripeConnect");
    expect(text).toContain("Guide: https://braidbosspro.app/?n=educationHub&lesson=connect-stripe");
  });
});

// ---------------------------------------------------------------------
// The all-done defensive case
// ---------------------------------------------------------------------

describe("the all-done defensive case", () => {
  it("renders without throwing when every step is already done", () => {
    expect(() =>
      render({
        steps: [
          step({ key: "businessName", done: true }),
          step({ key: "services", done: true }),
          step({ key: "availability", done: true }),
          step({ key: "stripe", done: true }),
          step({ key: "bookingLink", done: true }),
        ],
      }),
    ).not.toThrow();
  });

  it("swaps the checklist for a short all-set message instead of a broken list", () => {
    const { html, text } = render({
      steps: [
        step({ key: "businessName", done: true }),
        step({ key: "services", done: true }),
        step({ key: "availability", done: true }),
        step({ key: "stripe", done: true }),
        step({ key: "bookingLink", done: true }),
      ],
    });
    expect(html).toContain("all set");
    expect(html).not.toContain("Do this");
    expect(html).not.toContain("[ ]");
    expect(text).not.toContain("[ ]");
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
  });

  it("also renders cleanly when no steps are supplied at all", () => {
    const { html, subject } = render({ steps: [] });
    expect(subject.length).toBeGreaterThan(0);
    expect(html).not.toContain("Do this");
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
  });
});

// ---------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------

describe("escaping", () => {
  it("escapes a malicious step title instead of rendering it raw", () => {
    const { html } = render({
      steps: [step({ title: `<script>alert("x")</script>` })],
    });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("drops a javascript: actionUrl rather than rendering it as a live href", () => {
    const { html } = render({
      steps: [step({ actionUrl: "javascript:alert(1)" })],
    });
    expect(html).not.toContain("javascript:alert");
  });

  it("drops a javascript: lessonUrl rather than rendering it as a live href", () => {
    const { html } = render({
      steps: [step({ lessonUrl: "javascript:alert(1)" })],
    });
    expect(html).not.toContain("javascript:alert");
  });
});

// ---------------------------------------------------------------------
// Copy tone by checkpoint
// ---------------------------------------------------------------------

describe("copy by checkpoint", () => {
  it("uses different subject and headline copy for an early bucket versus a late one", () => {
    const early = render({ daysSinceStart: 1 });
    const late = render({ daysSinceStart: 21 });
    expect(early.subject).not.toBe(late.subject);
    expect(early.html).not.toBe(late.html);
  });

  it("never uses urgency or deadline language", () => {
    for (const days of [1, 3, 7, 14, 21]) {
      const { html, text, subject } = render({ daysSinceStart: days });
      for (const banned of ["hurry", "urgent", "act now", "countdown", "last chance"]) {
        expect(html.toLowerCase()).not.toContain(banned);
        expect(text.toLowerCase()).not.toContain(banned);
        expect(subject.toLowerCase()).not.toContain(banned);
      }
    }
  });
});

// ---------------------------------------------------------------------
// Structure and copy safety
// ---------------------------------------------------------------------

describe("activation nudge", () => {
  it("renders a complete HTML document pinned to light mode", () => {
    const { html } = render();
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<meta name="color-scheme" content="light only" />');
  });

  it("always offers the dashboard", () => {
    const { html, text } = render({ dashboardUrl: "https://braidbosspro.app" });
    expect(html).toContain('href="https://braidbosspro.app"');
    expect(text).toContain("https://braidbosspro.app");
  });

  it("writes a plain text alternative with no markup", () => {
    const { text } = render();
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain("<");
  });

  it("uses no em dashes anywhere", () => {
    const { subject, preheader, html, text } = render();
    expect(subject.includes("—")).toBe(false);
    expect(preheader.includes("—")).toBe(false);
    expect(html.includes("—")).toBe(false);
    expect(text.includes("—")).toBe(false);
  });
});

// ---------------------------------------------------------------------
// Preview fixtures
// ---------------------------------------------------------------------

describe("activation nudge fixtures", () => {
  const activation = FIXTURES.filter((f) => f.group === "8. Activation nudge");

  it("are registered for the dev preview route", () => {
    expect(activation.length).toBeGreaterThanOrEqual(4);
  });

  it("every fixture renders a complete document with a subject and text part", () => {
    for (const f of activation) {
      const r = f.render();
      expect(r.subject, f.id).not.toBe("");
      expect(r.html.startsWith("<!doctype html>"), f.id).toBe(true);
      expect(r.html.trimEnd().endsWith("</html>"), f.id).toBe(true);
      expect(r.text.length, f.id).toBeGreaterThan(0);
      expect(r.html, f.id).not.toContain("undefined");
      expect(r.html, f.id).not.toContain("NaN");
      expect(r.text, f.id).not.toContain("undefined");
      expect(r.text, f.id).not.toContain("NaN");
    }
  });

  it("uses no em dashes in any activation nudge fixture", () => {
    for (const f of activation) {
      const r = f.render();
      expect(r.html.includes("—"), `${f.id} html`).toBe(false);
      expect(r.text.includes("—"), `${f.id} text`).toBe(false);
      expect(r.subject.includes("—"), `${f.id} subject`).toBe(false);
    }
  });

  it("keeps fixture ids unique across the whole preview index", () => {
    const ids = FIXTURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
