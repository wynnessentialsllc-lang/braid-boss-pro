"use client";

// Founder story / origin section. This is the site's honest social
// proof: not a wall of invented testimonials, but the real, first-party
// story that Braid Boss Pro was built by a working braider (SBW
// Braiding) for their own chair. Rendered in two variants:
//   * "home" — a condensed section on the logged-out landing that links
//     out to the full story.
//   * "full" — the richer layout used on the /about page.
//
// NOTE FOR THE OWNER: personalize the founder quote attribution with
// your real name (search for "Founder, SBW Braiding" below). Everything
// here is written to be literally true — there are no fabricated stats,
// user counts, or third-party reviews.

import Link from "next/link";
import { Quote, Scissors, ShieldCheck, HandCoins } from "lucide-react";
import { Section } from "./MarketingShell";
import { C, FONT_DISPLAY, GRADIENTS, SHADOWS } from "./tokens";

const VALUES: Array<{ icon: React.ReactNode; title: string; body: string }> = [
  {
    icon: <Scissors size={18} />,
    title: "Braiders only",
    body: "We don't chase nail bars or blow-dry chains. Every feature is shaped around long, hair-included appointments, deposit policies, and the way braiders actually book — so nothing feels borrowed from generic salon software.",
  },
  {
    icon: <HandCoins size={18} />,
    title: "You own your money",
    body: "Deposits, balances, and product sales land in your own Stripe account — same day, on Stripe's schedule. We never custody your funds, hold your payouts, or take a cut of your services.",
  },
  {
    icon: <ShieldCheck size={18} />,
    title: "One flat price, no games",
    body: "$14.99/mo or $149/yr — every feature unlocked, no per-staff fees, no per-client fees, no upsell maze. If we add something new, it's included.",
  },
];

export function FounderStory({ variant = "home" }: { variant?: "home" | "full" }) {
  return (
    <Section
      eyebrow="Why we built this"
      title="Made at the chair, not in a boardroom."
      intro="Braid Boss Pro started inside a working braid business — SBW Braiding — and every feature still has to earn its place at a real chair."
      background={variant === "home" ? "#FBFAFD" : C.paper}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 20,
          alignItems: "start",
        }}
      >
        {/* Narrative */}
        <div className="bbp-reveal" style={{ color: C.coffee, fontSize: 15, lineHeight: 1.65 }}>
          <p style={{ margin: 0 }}>
            Braid Boss Pro didn&apos;t start as a software company. It started at{" "}
            <strong style={{ color: C.ink }}>SBW Braiding</strong> — a real braiding chair, with real
            clients, real deposits, and the real headache of running all of it from a notes app, a
            calculator, and three different payment apps.
          </p>
          <p style={{ margin: "14px 0 0" }}>
            Every generic salon tool we tried was built for someone else: quick cuts and 30-minute
            color, not all-day knotless, hair-included pricing, or the deposit rules braiders live by.
            So we built the tool we wished existed — booking links, deposits, contracts, a storefront,
            and analytics in one place — and then opened it up to every braider who&apos;s tired of
            duct-taping their business together.
          </p>
          {variant === "home" && (
            <p style={{ margin: "18px 0 0" }}>
              <Link
                href="/about"
                style={{ color: C.brandPrimary, fontWeight: 700, textDecoration: "underline", textUnderlineOffset: 3 }}
              >
                Read the full story →
              </Link>
            </p>
          )}
        </div>

        {/* Founder quote */}
        <figure
          className="bbp-reveal"
          style={{
            position: "relative",
            overflow: "hidden",
            margin: 0,
            borderRadius: 22,
            padding: "26px 24px",
            background: GRADIENTS.hero,
            color: "#FFFFFF",
            boxShadow: SHADOWS.cardLifted,
          }}
        >
          <Quote size={28} aria-hidden style={{ opacity: 0.85 }} />
          <blockquote
            style={{
              margin: "10px 0 0",
              fontFamily: FONT_DISPLAY,
              fontWeight: 600,
              fontSize: "clamp(20px, 2.6vw, 26px)",
              lineHeight: 1.3,
            }}
          >
            “I built Braid Boss Pro to run my own chair first. If it doesn&apos;t make my day easier,
            it doesn&apos;t ship.”
          </blockquote>
          <figcaption style={{ marginTop: 16, fontSize: 13, fontWeight: 700, letterSpacing: "0.04em", opacity: 0.95 }}>
            — Founder, SBW Braiding
          </figcaption>
        </figure>
      </div>

      {variant === "full" && (
        <div
          style={{
            marginTop: 28,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 16,
          }}
        >
          {VALUES.map((v, i) => (
            <article
              key={v.title}
              className="bbp-reveal"
              data-delay={String((i + 1) * 100)}
              style={{
                background: C.paper,
                border: `1px solid ${C.brandBorder}`,
                borderRadius: 18,
                padding: 18,
                boxShadow: SHADOWS.card,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 12,
                  display: "grid",
                  placeItems: "center",
                  background: GRADIENTS.primary,
                  color: "#FFFFFF",
                  boxShadow: SHADOWS.primaryGlow,
                  marginBottom: 10,
                }}
              >
                {v.icon}
              </span>
              <h3
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontWeight: 700,
                  fontSize: 18,
                  color: C.ink,
                  margin: 0,
                  lineHeight: 1.15,
                }}
              >
                {v.title}
              </h3>
              <p style={{ color: C.coffee, fontSize: 13, lineHeight: 1.55, marginTop: 6 }}>{v.body}</p>
            </article>
          ))}
        </div>
      )}
    </Section>
  );
}
