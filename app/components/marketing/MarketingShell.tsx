"use client";

// Marketing-page shell: shared header + footer + global font load
// + entrance-animation styles. Wraps /features and /how-it-works
// (and any future marketing page) so they all carry the same brand
// chrome without each page redeclaring it.

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { C, FONT_BODY, FONT_DISPLAY, GRADIENTS, SHADOWS } from "./tokens";

export const MarketingShell = ({ children }: { children: ReactNode }) => {
  // IntersectionObserver-driven reveal: any element with .bbp-reveal
  // gets the .is-visible class as it scrolls into view. Cheaper than
  // pulling in framer-motion for two marketing pages, honors
  // prefers-reduced-motion via the CSS rule below.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const els = Array.from(document.querySelectorAll<HTMLElement>(".bbp-reveal"));
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("is-visible"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: C.paper,
        color: C.ink,
        fontFamily: FONT_BODY,
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=DM+Sans:wght@400;500;600;700;800&display=swap');
        .bbp-reveal { opacity: 0; transform: translateY(18px); transition: opacity 600ms cubic-bezier(.2,.8,.2,1), transform 600ms cubic-bezier(.2,.8,.2,1); }
        .bbp-reveal.is-visible { opacity: 1; transform: translateY(0); }
        .bbp-reveal[data-delay="100"] { transition-delay: 100ms; }
        .bbp-reveal[data-delay="200"] { transition-delay: 200ms; }
        .bbp-reveal[data-delay="300"] { transition-delay: 300ms; }
        .bbp-reveal[data-delay="400"] { transition-delay: 400ms; }
        @media (prefers-reduced-motion: reduce) {
          .bbp-reveal { opacity: 1; transform: none; transition: none; }
        }
        @keyframes bbpHeroHalo {
          0%, 100% { transform: rotate(0deg) scale(1); opacity: 0.6; }
          50% { transform: rotate(120deg) scale(1.05); opacity: 0.8; }
        }
        .bbp-hero-halo { animation: bbpHeroHalo 18s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .bbp-hero-halo { animation: none; } }
      `}</style>

      <MarketingHeader />
      {children}
      <MarketingFooter />
    </div>
  );
};

const MARKETING_NAV_LINKS: Array<{ href: string; label: string }> = [
  { href: "/features", label: "Features" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/faq", label: "FAQ" },
];

const MarketingHeader = () => {
  const [open, setOpen] = useState(false);

  // Lock background scroll while the drawer is open and close on Escape.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 30,
        background: "rgba(255, 255, 255, 0.85)",
        backdropFilter: "saturate(180%) blur(12px)",
        borderBottom: `1px solid ${C.brandBorder}`,
        paddingTop: "calc(env(safe-area-inset-top, 0px))",
      }}
    >
      <div
        className="max-w-[1100px] mx-auto flex items-center justify-between"
        style={{ padding: "14px 20px" }}
      >
        <Link href="/" style={{ textDecoration: "none" }} onClick={() => setOpen(false)}>
          <span
            style={{
              fontSize: 14,
              fontWeight: 800,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: C.brandPrimary,
            }}
          >
            Braid Boss Pro
          </span>
        </Link>

        {/* Desktop nav — kept inline for sm+ screens. */}
        <nav className="hidden sm:flex items-center" style={{ gap: 18 }}>
          {MARKETING_NAV_LINKS.map((l) => (
            <Link key={l.href} href={l.href} style={marketingNavLink}>
              {l.label}
            </Link>
          ))}
          {/* Plain <a> (not Link) so it hard-navigates to the app root
              — the home page reads ?signin=1 on mount to open the
              sign-in gate; a client-side Link from "/" (this shell now
              also renders as the logged-out home view) wouldn't remount
              it. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- intentional full reload to remount the app gate */}
          <a
            href="/?signin=1"
            style={{
              ...marketingNavLink,
              padding: "8px 14px",
              borderRadius: 999,
              border: `1px solid ${C.brandBorder}`,
              color: C.brandPrimary,
            }}
          >
            Sign in
          </a>
        </nav>

        {/* Mobile hamburger trigger. */}
        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="bbp-mobile-nav"
          onClick={() => setOpen((v) => !v)}
          className="sm:hidden"
          style={{
            appearance: "none",
            background: "transparent",
            border: `1px solid ${C.brandBorder}`,
            borderRadius: 12,
            width: 40,
            height: 40,
            display: "grid",
            placeItems: "center",
            color: C.brandPrimary,
          }}
        >
          <span aria-hidden style={{ position: "relative", width: 18, height: 14, display: "inline-block" }}>
            <span style={hamburgerLine(open ? "translateY(6px) rotate(45deg)" : "translateY(0) rotate(0)", 0)} />
            <span style={hamburgerLine(open ? "scaleX(0)" : "scaleX(1)", 6)} />
            <span style={hamburgerLine(open ? "translateY(-6px) rotate(-45deg)" : "translateY(0) rotate(0)", 12)} />
          </span>
        </button>
      </div>

      {/* Drawer — slides under the sticky header. Uses pointer-events
          gating so it never blocks taps when closed. */}
      <div
        id="bbp-mobile-nav"
        className="sm:hidden"
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 68px)",
          background: "rgba(21, 17, 26, 0.45)",
          backdropFilter: "blur(4px)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 220ms ease",
          zIndex: 29,
        }}
        onClick={() => setOpen(false)}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            background: "#FFFFFF",
            margin: "0 12px",
            borderRadius: 20,
            border: `1px solid ${C.brandBorder}`,
            boxShadow: SHADOWS.cardLifted,
            padding: "16px 14px calc(20px + env(safe-area-inset-bottom, 0px))",
            transform: open ? "translateY(0)" : "translateY(-10px)",
            transition: "transform 240ms cubic-bezier(.2,.8,.2,1)",
          }}
        >
          <nav style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {MARKETING_NAV_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                style={mobileDrawerLink}
              >
                {l.label}
              </Link>
            ))}
            <div style={{ height: 1, background: C.brandBorder, margin: "8px 4px" }} />
            {/* Plain <a> so it hard-navigates to the app root, where
                ?signin=1 opens the sign-in gate on mount. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- intentional full reload to remount the app gate */}
            <a
              href="/?signin=1"
              onClick={() => setOpen(false)}
              style={{
                ...mobileDrawerLink,
                color: "#FFFFFF",
                background: GRADIENTS.primary,
                textAlign: "center",
                boxShadow: SHADOWS.primaryGlow,
              }}
            >
              Sign in
            </a>
          </nav>
        </div>
      </div>
    </header>
  );
};

const hamburgerLine = (transform: string, top: number): React.CSSProperties => ({
  position: "absolute",
  left: 0,
  top,
  width: 18,
  height: 2,
  background: "currentColor",
  borderRadius: 2,
  transformOrigin: "center",
  transform,
  transition: "transform 220ms ease",
});

const mobileDrawerLink: React.CSSProperties = {
  display: "block",
  padding: "14px 12px",
  borderRadius: 12,
  fontSize: 15,
  fontWeight: 700,
  letterSpacing: "0.02em",
  color: C.ink,
  textDecoration: "none",
};

const marketingNavLink: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "#3D3447",
  textDecoration: "none",
};

const MarketingFooter = () => (
  <footer
    style={{
      borderTop: `1px solid ${C.brandBorder}`,
      background: C.brandSurface,
      padding: "32px 20px 40px",
      marginTop: 80,
    }}
  >
    <div
      className="max-w-[1100px] mx-auto"
      style={{
        display: "grid",
        gridTemplateColumns: "1fr",
        gap: 16,
        alignItems: "center",
        justifyItems: "center",
        textAlign: "center",
      }}
    >
      <p
        style={{
          fontSize: 13,
          fontWeight: 800,
          letterSpacing: "0.20em",
          textTransform: "uppercase",
          color: C.brandPrimary,
        }}
      >
        Braid Boss Pro
      </p>
      <nav className="flex flex-wrap items-center justify-center" style={{ gap: 16 }}>
        <Link href="/features" style={footerLink}>
          Features
        </Link>
        <Link href="/how-it-works" style={footerLink}>
          How it works
        </Link>
        <Link href="/pricing" style={footerLink}>
          Pricing
        </Link>
        <Link href="/faq" style={footerLink}>
          FAQ
        </Link>
        <Link href="/privacy" style={footerLink}>
          Privacy
        </Link>
        <Link href="/terms" style={footerLink}>
          Terms
        </Link>
        <Link href="/support" style={footerLink}>
          Support
        </Link>
      </nav>
      {/* Comparison pages — kept in their own labelled row so the
          competitor-vs pages are discoverable from every marketing
          page (and crawlable for SEO), without crowding the primary
          footer nav above. */}
      <nav className="flex flex-wrap items-center justify-center" style={{ gap: 16 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: C.mutedSoft,
          }}
        >
          Compare
        </span>
        <Link href="/compare/braid-boss-pro-vs-styleseat" style={footerLink}>
          vs StyleSeat
        </Link>
        <Link href="/compare/braid-boss-pro-vs-vagaro" style={footerLink}>
          vs Vagaro
        </Link>
        <Link href="/compare/braid-boss-pro-vs-square-appointments" style={footerLink}>
          vs Square Appointments
        </Link>
      </nav>
      <p style={{ fontSize: 11, color: C.mutedSoft }}>
        © {new Date().getFullYear()} <strong style={{ color: C.coffee }}>Wynn Essentials, LLC</strong>. Braid Boss Pro is built for stylists, by stylists.
      </p>
      <p style={{ fontSize: 11, color: C.mutedSoft }}>
        braidbosspro.app is operated by Wynn Essentials, LLC ·{" "}
        <a href="mailto:hello@braidbosspro.app" style={{ color: C.mutedSoft, textDecoration: "underline" }}>
          hello@braidbosspro.app
        </a>
      </p>
    </div>
  </footer>
);

const footerLink: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: C.coffee,
  textDecoration: "none",
};

// Hero section — used by both /features and /how-it-works.
export const MarketingHero = ({
  eyebrow,
  title,
  body,
  primaryCta,
  secondaryCta,
  signInHref,
}: {
  eyebrow: string;
  title: ReactNode;
  body: string;
  primaryCta: { label: string; href: string };
  secondaryCta?: { label: string; href: string };
  // When set, renders an "Already have an account? Sign in" link under
  // the CTAs. Used on the logged-out home landing so returning users
  // have an obvious sign-in path next to the primary "start trial" CTA.
  signInHref?: string;
}) => (
  <section
    style={{
      position: "relative",
      overflow: "hidden",
      padding: "72px 20px 56px",
      background: C.paper,
    }}
  >
    {/* Soft brand halo behind the title — no overlap with content,
        just a colored cloud for warmth. */}
    <div
      aria-hidden
      className="bbp-hero-halo"
      style={{
        position: "absolute",
        top: -120,
        left: "50%",
        transform: "translateX(-50%)",
        width: 720,
        height: 720,
        borderRadius: 999,
        background:
          "conic-gradient(from 220deg, rgba(124, 58, 237, 0.18), rgba(255, 77, 109, 0.18), rgba(177, 75, 224, 0.18), rgba(124, 58, 237, 0.18))",
        filter: "blur(80px)",
        pointerEvents: "none",
      }}
    />
    <div className="max-w-[820px] mx-auto text-center bbp-reveal" style={{ position: "relative" }}>
      <p
        style={{
          fontSize: 12,
          fontWeight: 800,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          color: C.brandPrimary,
          margin: 0,
        }}
      >
        {eyebrow}
      </p>
      <h1
        style={{
          fontFamily: FONT_DISPLAY,
          fontWeight: 700,
          fontSize: "clamp(36px, 6vw, 64px)",
          lineHeight: 1.05,
          color: C.ink,
          margin: "14px 0 0",
          letterSpacing: "-0.01em",
        }}
      >
        {title}
      </h1>
      <p
        style={{
          color: C.coffee,
          fontSize: "clamp(15px, 2vw, 18px)",
          lineHeight: 1.55,
          marginTop: 16,
          maxWidth: 640,
          marginLeft: "auto",
          marginRight: "auto",
        }}
      >
        {body}
      </p>
      <div className="flex flex-wrap items-center justify-center" style={{ gap: 10, marginTop: 26 }}>
        <a
          href={primaryCta.href}
          style={{
            padding: "14px 22px",
            borderRadius: 14,
            background: GRADIENTS.primary,
            color: "#FFFFFF",
            fontSize: 13,
            fontWeight: 800,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            textDecoration: "none",
            boxShadow: SHADOWS.primaryGlow,
          }}
        >
          {primaryCta.label}
        </a>
        {secondaryCta && (
          <a
            href={secondaryCta.href}
            style={{
              padding: "14px 22px",
              borderRadius: 14,
              background: "transparent",
              color: C.brandPrimary,
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              textDecoration: "none",
              border: `1.5px solid ${C.brandPrimary}`,
            }}
          >
            {secondaryCta.label}
          </a>
        )}
      </div>
      {signInHref && (
        // Dynamic href, so the no-html-link-for-pages rule doesn't fire.
        // Plain <a> is intentional — a hard reload remounts the app so it
        // reads ?signin=1 and opens the sign-in gate.
        <p style={{ marginTop: 18, fontSize: 14, color: C.coffee }}>
          Already have an account?{" "}
          <a
            href={signInHref}
            style={{ color: C.brandPrimary, fontWeight: 700, textDecoration: "underline" }}
          >
            Sign in
          </a>
        </p>
      )}
    </div>
  </section>
);

// Section wrapper — eyebrow + title + optional intro, then children.
export const Section = ({
  eyebrow,
  title,
  intro,
  children,
  background = C.paper,
  id,
}: {
  eyebrow?: string;
  title?: string;
  intro?: string;
  children: ReactNode;
  background?: string;
  id?: string;
}) => (
  <section id={id} style={{ background, padding: "60px 20px" }}>
    <div className="max-w-[1100px] mx-auto">
      {(eyebrow || title || intro) && (
        <header className="text-center bbp-reveal" style={{ marginBottom: 36 }}>
          {eyebrow && (
            <p
              style={{
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                color: C.brandPrimary,
                margin: 0,
              }}
            >
              {eyebrow}
            </p>
          )}
          {title && (
            <h2
              style={{
                fontFamily: FONT_DISPLAY,
                fontWeight: 700,
                fontSize: "clamp(28px, 4.5vw, 40px)",
                lineHeight: 1.1,
                color: C.ink,
                margin: "10px 0 0",
                letterSpacing: "-0.005em",
              }}
            >
              {title}
            </h2>
          )}
          {intro && (
            <p
              style={{
                color: C.coffee,
                fontSize: 15,
                lineHeight: 1.6,
                marginTop: 12,
                maxWidth: 560,
                marginLeft: "auto",
                marginRight: "auto",
              }}
            >
              {intro}
            </p>
          )}
        </header>
      )}
      {children}
    </div>
  </section>
);

// Sticky CTA panel — bottom of marketing pages.
export const CtaFooter = ({
  title,
  body,
  primaryCta,
  secondaryCta,
}: {
  title: string;
  body: string;
  primaryCta: { label: string; href: string };
  secondaryCta?: { label: string; href: string };
}) => (
  <section style={{ padding: "60px 20px" }}>
    <div
      className="max-w-[980px] mx-auto bbp-reveal"
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: 32,
        padding: "48px 28px",
        background: GRADIENTS.hero,
        color: "#FFFFFF",
        textAlign: "center",
        boxShadow: SHADOWS.cardLifted,
      }}
    >
      <div
        aria-hidden
        className="bbp-hero-halo"
        style={{
          position: "absolute",
          inset: -120,
          background:
            "conic-gradient(from 220deg, rgba(255, 255, 255, 0.20), rgba(198, 255, 0, 0.15), rgba(255, 255, 255, 0.20))",
          filter: "blur(60px)",
          opacity: 0.35,
        }}
      />
      <div style={{ position: "relative" }}>
        <h2
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 700,
            fontSize: "clamp(30px, 4.5vw, 44px)",
            lineHeight: 1.05,
            margin: 0,
          }}
        >
          {title}
        </h2>
        <p
          style={{
            fontSize: 16,
            opacity: 0.92,
            marginTop: 12,
            lineHeight: 1.55,
            maxWidth: 600,
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          {body}
        </p>
        <div className="flex flex-wrap items-center justify-center" style={{ gap: 10, marginTop: 24 }}>
          <a
            href={primaryCta.href}
            style={{
              padding: "14px 24px",
              borderRadius: 14,
              background: "#FFFFFF",
              color: C.brandPrimary,
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              textDecoration: "none",
              boxShadow: "0 10px 28px -10px rgba(21, 17, 26, 0.25)",
            }}
          >
            {primaryCta.label}
          </a>
          {secondaryCta && (
            <a
              href={secondaryCta.href}
              style={{
                padding: "14px 24px",
                borderRadius: 14,
                background: "transparent",
                color: "#FFFFFF",
                fontSize: 13,
                fontWeight: 800,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                textDecoration: "none",
                border: "1.5px solid rgba(255, 255, 255, 0.55)",
              }}
            >
              {secondaryCta.label}
            </a>
          )}
        </div>
      </div>
    </div>
  </section>
);
