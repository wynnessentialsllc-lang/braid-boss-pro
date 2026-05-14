"use client";

// Marketing-page shell: shared header + footer + global font load
// + entrance-animation styles. Wraps every public marketing page
// (/features, /how-it-works, /pricing, /faq) so they carry the
// same brand chrome without each page redeclaring it.

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { C, FONT_BODY, FONT_DISPLAY, GRADIENTS, SHADOWS } from "./tokens";

const NAV_LINKS: Array<{ href: string; label: string }> = [
  { href: "/features", label: "Features" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/faq", label: "FAQ" },
];

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
        @keyframes bbpDrawerSlide { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes bbpDrawerFade { from { opacity: 0; } to { opacity: 1; } }
        .bbp-mobile-drawer { animation: bbpDrawerSlide 280ms cubic-bezier(.2,.8,.2,1) both; }
        .bbp-mobile-drawer-backdrop { animation: bbpDrawerFade 200ms ease both; }
        @media (prefers-reduced-motion: reduce) {
          .bbp-mobile-drawer, .bbp-mobile-drawer-backdrop { animation: none; }
        }
      `}</style>

      <MarketingHeader />
      {children}
      <MarketingFooter />
    </div>
  );
};

// ---- Header --------------------------------------------------------------

const MarketingHeader = () => {
  const [menuOpen, setMenuOpen] = useState(false);

  // Lock body scroll while the mobile drawer is open so iOS Safari
  // doesn't bounce the page under the sheet. Also closes the
  // drawer on Esc for keyboard users.
  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <>
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 30,
          background: "rgba(255, 255, 255, 0.85)",
          backdropFilter: "saturate(180%) blur(12px)",
          WebkitBackdropFilter: "saturate(180%) blur(12px)",
          borderBottom: `1px solid ${C.brandBorder}`,
          paddingTop: "calc(env(safe-area-inset-top, 0px))",
        }}
      >
        <div
          className="max-w-[1100px] mx-auto flex items-center justify-between"
          style={{ padding: "14px 20px" }}
        >
          <Link href="/" style={{ textDecoration: "none" }}>
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

          {/* Desktop inline nav — hidden on mobile (md = 768px and up). */}
          <nav
            className="hidden md:flex items-center"
            style={{ gap: 20 }}
            aria-label="Primary"
          >
            {NAV_LINKS.map((l) => (
              <Link key={l.href} href={l.href} style={marketingNavLink}>
                {l.label}
              </Link>
            ))}
            <Link href="/?signin=1" style={marketingNavLink}>
              Sign in
            </Link>
          </nav>

          {/* Mobile hamburger — shown below md. */}
          <button
            type="button"
            className="md:hidden"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            aria-expanded={menuOpen}
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              background: "transparent",
              border: `1px solid ${C.brandBorder}`,
              display: "grid",
              placeItems: "center",
              color: C.ink,
              cursor: "pointer",
            }}
          >
            <HamburgerIcon />
          </button>
        </div>
      </header>

      {menuOpen && (
        <MobileDrawer onClose={() => setMenuOpen(false)} />
      )}
    </>
  );
};

const HamburgerIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <line x1="4" y1="7" x2="20" y2="7" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="17" x2="20" y2="17" />
  </svg>
);

const CloseIcon = () => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="18" y1="6" x2="6" y2="18" />
  </svg>
);

const MobileDrawer = ({ onClose }: { onClose: () => void }) => (
  <div
    role="dialog"
    aria-modal="true"
    aria-label="Menu"
    className="md:hidden"
    style={{
      position: "fixed",
      inset: 0,
      zIndex: 100,
      display: "flex",
    }}
  >
    {/* Backdrop blur — tap to close. */}
    <button
      type="button"
      aria-label="Close menu"
      onClick={onClose}
      className="bbp-mobile-drawer-backdrop"
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(21, 17, 26, 0.45)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        border: 0,
        cursor: "pointer",
      }}
    />
    {/* Drawer panel — slides in from the right. Width capped so a
        tablet doesn't render edge-to-edge. */}
    <aside
      className="bbp-mobile-drawer"
      style={{
        marginLeft: "auto",
        position: "relative",
        height: "100%",
        width: "min(86vw, 360px)",
        background: C.paper,
        boxShadow: SHADOWS.cardLifted,
        display: "flex",
        flexDirection: "column",
        paddingTop: "calc(env(safe-area-inset-top, 0px) + 14px)",
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 20px 18px",
          borderBottom: `1px solid ${C.brandBorder}`,
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 800,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: C.brandPrimary,
          }}
        >
          Braid Boss Pro
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close menu"
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            background: "transparent",
            border: `1px solid ${C.brandBorder}`,
            display: "grid",
            placeItems: "center",
            color: C.ink,
            cursor: "pointer",
          }}
        >
          <CloseIcon />
        </button>
      </div>

      <nav
        aria-label="Primary"
        style={{
          display: "flex",
          flexDirection: "column",
          padding: "10px 16px",
          gap: 2,
        }}
      >
        {NAV_LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            onClick={onClose}
            style={mobileNavLink}
          >
            {l.label}
          </Link>
        ))}
      </nav>

      <div style={{ marginTop: "auto", padding: "16px 20px 0" }}>
        <Link
          href="/?signin=1"
          onClick={onClose}
          style={{
            display: "block",
            textAlign: "center",
            padding: "14px 18px",
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
          Sign in
        </Link>
        <Link
          href="/pricing"
          onClick={onClose}
          style={{
            display: "block",
            textAlign: "center",
            padding: "12px 18px",
            marginTop: 8,
            borderRadius: 14,
            background: "transparent",
            color: C.brandPrimary,
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            textDecoration: "none",
            border: `1.5px solid ${C.brandPrimary}`,
          }}
        >
          Claim founding access
        </Link>
      </div>
    </aside>
  </div>
);

const marketingNavLink: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: "#3D3447",
  textDecoration: "none",
};

const mobileNavLink: React.CSSProperties = {
  display: "block",
  padding: "14px 12px",
  borderRadius: 12,
  fontSize: 16,
  fontWeight: 700,
  color: "#15111A",
  textDecoration: "none",
  letterSpacing: "-0.005em",
};

// ---- Footer --------------------------------------------------------------

const MarketingFooter = () => (
  <footer
    style={{
      borderTop: `1px solid ${C.brandBorder}`,
      background: C.brandSurface,
      padding: "40px 20px 48px",
      marginTop: 96,
    }}
  >
    <div
      className="max-w-[1100px] mx-auto"
      style={{
        display: "grid",
        gridTemplateColumns: "1fr",
        gap: 20,
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
          margin: 0,
        }}
      >
        Braid Boss Pro
      </p>
      <p style={{ fontSize: 12, color: C.muted, margin: 0, maxWidth: 420, lineHeight: 1.55 }}>
        The business operating system for braiders.
      </p>
      <nav className="flex flex-wrap items-center justify-center" style={{ gap: 16, marginTop: 4 }}>
        <Link href="/features" style={footerLink}>Features</Link>
        <Link href="/how-it-works" style={footerLink}>How it works</Link>
        <Link href="/pricing" style={footerLink}>Pricing</Link>
        <Link href="/faq" style={footerLink}>FAQ</Link>
        <Link href="/privacy" style={footerLink}>Privacy</Link>
        <Link href="/terms" style={footerLink}>Terms</Link>
        <Link href="/support" style={footerLink}>Support</Link>
      </nav>
      <p style={{ fontSize: 11, color: C.mutedSoft, margin: 0 }}>
        © {new Date().getFullYear()} Braid Boss Pro. Built for braiders.
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

// ---- Hero ----------------------------------------------------------------

export const MarketingHero = ({
  eyebrow,
  title,
  body,
  primaryCta,
  secondaryCta,
}: {
  eyebrow: string;
  title: ReactNode;
  body: string;
  primaryCta: { label: string; href: string };
  secondaryCta?: { label: string; href: string };
}) => (
  <section
    style={{
      position: "relative",
      overflow: "hidden",
      padding: "96px 20px 72px",
      background: C.paper,
    }}
  >
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
          fontSize: "clamp(40px, 6vw, 68px)",
          lineHeight: 1.04,
          color: C.ink,
          margin: "18px 0 0",
          letterSpacing: "-0.015em",
        }}
      >
        {title}
      </h1>
      <p
        style={{
          color: C.coffee,
          fontSize: "clamp(16px, 2vw, 18px)",
          lineHeight: 1.6,
          marginTop: 20,
          maxWidth: 640,
          marginLeft: "auto",
          marginRight: "auto",
        }}
      >
        {body}
      </p>
      <div className="flex flex-wrap items-center justify-center" style={{ gap: 12, marginTop: 32 }}>
        <a
          href={primaryCta.href}
          style={{
            padding: "15px 24px",
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
              padding: "15px 24px",
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
    </div>
  </section>
);

// ---- Section -------------------------------------------------------------

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
  <section id={id} style={{ background, padding: "72px 20px" }}>
    <div className="max-w-[1100px] mx-auto">
      {(eyebrow || title || intro) && (
        <header className="text-center bbp-reveal" style={{ marginBottom: 44 }}>
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
                fontSize: "clamp(30px, 4.5vw, 42px)",
                lineHeight: 1.1,
                color: C.ink,
                margin: "12px 0 0",
                letterSpacing: "-0.01em",
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
                lineHeight: 1.65,
                marginTop: 14,
                maxWidth: 580,
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

// ---- CtaFooter -----------------------------------------------------------

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
  <section style={{ padding: "72px 20px" }}>
    <div
      className="max-w-[980px] mx-auto bbp-reveal"
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: 32,
        padding: "56px 28px",
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
            fontSize: "clamp(32px, 4.5vw, 46px)",
            lineHeight: 1.05,
            margin: 0,
            letterSpacing: "-0.01em",
          }}
        >
          {title}
        </h2>
        <p
          style={{
            fontSize: 16,
            opacity: 0.92,
            marginTop: 14,
            lineHeight: 1.6,
            maxWidth: 620,
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          {body}
        </p>
        <div className="flex flex-wrap items-center justify-center" style={{ gap: 12, marginTop: 30 }}>
          <a
            href={primaryCta.href}
            style={{
              padding: "15px 26px",
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
                padding: "15px 26px",
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
