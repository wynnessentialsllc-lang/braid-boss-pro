"use client";

// The feature-page directory shown on the /features hub — a grid of
// cards linking to every dedicated SEO feature page, plus the
// "Why Braid Boss Pro" overview. Rendered inside FeaturesContent via
// its optional `directory` slot so the hub links to all sub-pages
// without altering the logged-out home landing.

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Section } from "./MarketingShell";
import { C, FONT_DISPLAY, SHADOWS } from "./tokens";
import { FEATURE_PAGES, featurePath } from "../../lib/feature-pages";

export const FeatureDirectory = () => (
  <Section
    eyebrow="Explore by topic"
    title="Dedicated feature pages"
    intro="Go deep on any part of the platform — each page covers what's included, how it works, and answers the questions braiders ask most."
    background="#FBFAFD"
  >
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: 16,
      }}
    >
      {FEATURE_PAGES.map((p) => (
        <Link
          key={p.slug}
          href={featurePath(p.slug)}
          className="bbp-reveal bbp-dir-card"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            background: C.paper,
            border: `1px solid ${C.brandBorder}`,
            borderRadius: 18,
            padding: 20,
            boxShadow: SHADOWS.card,
            textDecoration: "none",
            transition: "transform 220ms cubic-bezier(.2,.8,.2,1), box-shadow 220ms ease",
          }}
        >
          <h3
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 700,
              fontSize: 20,
              color: C.ink,
              margin: 0,
              lineHeight: 1.15,
            }}
          >
            {p.navTitle}
          </h3>
          <p style={{ color: C.coffee, fontSize: 13.5, lineHeight: 1.5, margin: 0, flex: 1 }}>
            {p.cardBlurb}
          </p>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              color: C.brandPrimary,
              fontSize: 13,
              fontWeight: 700,
              marginTop: 2,
            }}
          >
            Explore <ArrowRight size={14} />
          </span>
        </Link>
      ))}

      {/* Overview page card */}
      <Link
        href="/why-braid-boss-pro"
        className="bbp-reveal bbp-dir-card"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          background: "linear-gradient(160deg, #7C3AED 0%, #B14BE0 45%, #FF4D6D 100%)",
          border: "1px solid transparent",
          borderRadius: 18,
          padding: 20,
          boxShadow: SHADOWS.cardLifted,
          textDecoration: "none",
          color: "#FFFFFF",
          transition: "transform 220ms cubic-bezier(.2,.8,.2,1), box-shadow 220ms ease",
        }}
      >
        <h3
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 700,
            fontSize: 20,
            margin: 0,
            lineHeight: 1.15,
            color: "#FFFFFF",
          }}
        >
          Why Braid Boss Pro
        </h3>
        <p style={{ fontSize: 13.5, lineHeight: 1.5, margin: 0, flex: 1, opacity: 0.92 }}>
          The big picture — how every pillar connects into one all-in-one platform built for braiders.
        </p>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, marginTop: 2 }}>
          See the overview <ArrowRight size={14} />
        </span>
      </Link>
    </div>

    <style jsx>{`
      .bbp-dir-card:hover {
        transform: translateY(-3px);
        box-shadow: 0 18px 36px -16px rgba(21, 17, 26, 0.22);
      }
      @media (prefers-reduced-motion: reduce) {
        .bbp-dir-card:hover { transform: none; }
      }
    `}</style>
  </Section>
);
