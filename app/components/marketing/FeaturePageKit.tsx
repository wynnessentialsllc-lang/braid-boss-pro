"use client";

// Shared building blocks for the SEO feature pages under /features/*.
// Every feature page is assembled from these so the whole set carries
// one consistent visual language (and so the FAQ copy that renders on
// screen is the exact same array that feeds the FAQPage JSON-LD —
// they can never drift).

import Link from "next/link";
import { Check, ChevronDown, ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { C, FONT_DISPLAY, GRADIENTS, SHADOWS } from "./tokens";
import { featurePath, type FeaturePage } from "../../lib/feature-pages";

export type QA = { q: string; a: ReactNode };

// Gradient-filled emphasis word, used inside hero <h1> titles to match
// the brand treatment on /features and /how-it-works.
export const GradientText = ({ children }: { children: ReactNode }) => (
  <em
    style={{
      fontStyle: "italic",
      background: "linear-gradient(135deg, #7C3AED 0%, #FF4D6D 100%)",
      WebkitBackgroundClip: "text",
      WebkitTextFillColor: "transparent",
      backgroundClip: "text",
    }}
  >
    {children}
  </em>
);

// Visible breadcrumb trail. Mirrors the BreadcrumbList JSON-LD emitted
// by <FeatureSchema/> so the on-page trail and the structured data agree.
export const Breadcrumbs = ({ trail }: { trail: Array<{ label: string; href?: string }> }) => (
  <nav
    aria-label="Breadcrumb"
    style={{ maxWidth: 1100, margin: "0 auto", padding: "18px 20px 0" }}
  >
    <ol
      style={{
        listStyle: "none",
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        margin: 0,
        padding: 0,
        fontSize: 12.5,
        color: C.muted,
      }}
    >
      {trail.map((item, i) => (
        <li key={item.label} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {item.href ? (
            <Link href={item.href} style={{ color: C.brandPrimary, textDecoration: "none", fontWeight: 600 }}>
              {item.label}
            </Link>
          ) : (
            <span aria-current="page" style={{ color: C.coffee, fontWeight: 600 }}>
              {item.label}
            </span>
          )}
          {i < trail.length - 1 && <span aria-hidden style={{ color: C.mutedSoft }}>/</span>}
        </li>
      ))}
    </ol>
  </nav>
);

// Two-column checkmark list — the workhorse for rendering a feature's
// "what's included" bullets densely without 12 separate cards.
export const CheckList = ({ items }: { items: ReactNode[] }) => (
  <ul
    style={{
      listStyle: "none",
      margin: 0,
      padding: 0,
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
      gap: 12,
      maxWidth: 900,
      marginInline: "auto",
    }}
  >
    {items.map((item, i) => (
      <li
        key={i}
        className="bbp-reveal"
        style={{
          display: "flex",
          gap: 10,
          alignItems: "flex-start",
          background: C.paper,
          border: `1px solid ${C.brandBorder}`,
          borderRadius: 14,
          padding: "13px 15px",
          boxShadow: SHADOWS.card,
        }}
      >
        <span
          aria-hidden
          style={{
            flexShrink: 0,
            width: 24,
            height: 24,
            borderRadius: 8,
            background: GRADIENTS.softA,
            display: "grid",
            placeItems: "center",
            color: C.brandPrimary,
            marginTop: 1,
          }}
        >
          <Check size={15} />
        </span>
        <span style={{ fontSize: 14, lineHeight: 1.5, color: C.ink }}>{item}</span>
      </li>
    ))}
  </ul>
);

// FAQ accordion — native <details> so it works without JS, and the
// same QA[] array is handed to the FAQ JSON-LD in <FeatureSchema/>.
export const FaqAccordion = ({ items }: { items: QA[] }) => (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
    {items.map((f, i) => (
      <details
        key={i}
        className="bbp-reveal bbp-faq"
        style={{
          background: C.paper,
          border: `1px solid ${C.brandBorder}`,
          borderRadius: 16,
          padding: "16px 18px",
          boxShadow: SHADOWS.card,
        }}
      >
        <summary
          style={{
            cursor: "pointer",
            listStyle: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            fontWeight: 700,
            fontSize: 15,
            color: C.ink,
          }}
        >
          <span>{f.q}</span>
          <ChevronDown
            size={16}
            className="bbp-faq-chevron"
            style={{ color: C.muted, flexShrink: 0, transition: "transform 200ms ease" }}
          />
        </summary>
        <div style={{ marginTop: 10, color: C.coffee, fontSize: 14, lineHeight: 1.6 }}>{f.a}</div>
        <style>{`
          details.bbp-faq[open] .bbp-faq-chevron { transform: rotate(180deg); }
          details.bbp-faq summary::-webkit-details-marker { display: none; }
        `}</style>
      </details>
    ))}
  </div>
);

// Related-feature cross-link cards — internal linking + crawl depth.
export const RelatedFeatures = ({ pages }: { pages: FeaturePage[] }) => {
  if (!pages.length) return null;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
        gap: 16,
      }}
    >
      {pages.map((p, i) => (
        <Link
          key={p.slug}
          href={featurePath(p.slug)}
          className="bbp-reveal bbp-related-card"
          data-delay={i === 0 ? undefined : ((i * 100) as 100 | 200 | 300)}
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
          <style jsx>{`
            .bbp-related-card:hover {
              transform: translateY(-3px);
              box-shadow: 0 18px 36px -16px rgba(21, 17, 26, 0.22);
            }
            @media (prefers-reduced-motion: reduce) {
              .bbp-related-card:hover { transform: none; box-shadow: ${SHADOWS.card}; }
            }
          `}</style>
        </Link>
      ))}
    </div>
  );
};
