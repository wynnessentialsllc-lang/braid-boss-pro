"use client";

// Shared shell for the /@handle public storefront family
// (profile, shop, product detail). Renders the brand header,
// nav tabs, and footer so each page can focus on its own body.
//
// Lives under app/u/[handle]/_components/ — the leading underscore
// keeps Next.js from registering this directory as a route.

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";

// 2026 brand tokens, mirrored from app/page.tsx. Re-declared inline
// so the public storefront never has to import the 18k-line admin
// shell.
export const C = {
  espresso: "#15111A",
  coffee: "#3D3447",
  cream: "#FFFFFF",
  ivory: "#F6F2EC",
  paper: "#FFFFFF",
  muted: "#6F6477",
  mutedSoft: "#9F95A8",
  hairline: "rgba(21, 17, 26, 0.10)",
  brandPrimary: "#7C3AED",
  brandPrimaryDeep: "#5B21B6",
  brandSecondary: "#FF4D6D",
  brandText: "#15111A",
  brandBorder: "#ECE7F2",
  brandSuccess: "#22C55E",
  brandWarning: "#FBBF24",
  brandError: "#EF4444",
};

export const GRADIENTS = {
  primary: "linear-gradient(135deg, #7C3AED 0%, #FF4D6D 100%)",
  hero: "linear-gradient(160deg, #7C3AED 0%, #B14BE0 45%, #FF4D6D 100%)",
};

export const SHADOWS = {
  primaryGlow:
    "0 10px 28px -10px rgba(124, 58, 237, 0.45), 0 4px 12px -4px rgba(255, 77, 109, 0.30)",
  card: "0 4px 14px rgba(21, 17, 26, 0.06)",
  cardLifted: "0 12px 32px -12px rgba(21, 17, 26, 0.18)",
};

export const FONT_DISPLAY = `"Cormorant Garamond", Georgia, serif`;
export const FONT_BODY = `"DM Sans", "Inter", system-ui, sans-serif`;

// Money formatter. Falls back to a bare USD format when the visitor's
// runtime doesn't support the currency code the stylist set.
export const fmtMoney = (
  cents: number | null | undefined,
  currency: string = "USD",
): string => {
  if (cents == null || !Number.isFinite(cents)) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(cents);
  } catch {
    return `$${cents.toFixed(2)}`;
  }
};

type Tab = "profile" | "shop";

export const StorefrontShell = ({
  handle,
  businessName,
  description,
  bannerUrl,
  logoUrl,
  active,
  children,
}: {
  handle: string;             // Without the leading "@" — e.g. "janestylist".
  businessName: string | null;
  // Short shop description shown under the shop name — what the
  // stylist sells (e.g. "Hair bundles, edge control & growth oils").
  description?: string | null;
  bannerUrl: string | null;
  logoUrl: string | null;
  active: Tab;
  children: ReactNode;
}) => {
  const router = useRouter();

  // Personalize the document title. Public storefront has no admin
  // bundle to fight with, so this is a clean SSR-replacement on
  // first paint for crawlers that execute JS.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const t = businessName?.trim();
    document.title = t ? `${t} · Braid Boss Pro` : "Braid Boss Pro";
  }, [businessName]);

  const go = (path: string) => {
    router.push(`/@${encodeURIComponent(handle)}${path}`);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: C.cream,
        color: C.brandText,
        fontFamily: FONT_BODY,
      }}
    >
      {/* Load the brand fonts — without these the h1 falls through
          to Georgia/serif which renders visibly larger + heavier
          than Cormorant Garamond, so the storefront title looked
          chunkier than the booking-page title even though every
          inline style matched. The booking page loads the same two
          families via its own <style> block; we mirror that here so
          /@handle/shop and /@handle/products/<slug> render with
          identical metrics. */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=DM+Sans:wght@400;500;600;700&display=swap');
        /* Brand wordmark entrance — slides in from the left while
           fading + finishing on its wider letter-spacing. Plays
           once on first paint; honors prefers-reduced-motion. */
        @keyframes bbpBrandSlideIn {
          0% {
            opacity: 0;
            transform: translateX(-36px);
            letter-spacing: 0.20em;
          }
          100% {
            opacity: 1;
            transform: translateX(0);
            letter-spacing: 0.34em;
          }
        }
        .bbp-brand-wordmark {
          animation: bbpBrandSlideIn 1.2s cubic-bezier(.2,.8,.2,1) both;
          animation-delay: 180ms;
        }
        @media (prefers-reduced-motion: reduce) {
          .bbp-brand-wordmark { animation: none; }
        }
      `}</style>
      {/* Banner — falls back to a brand gradient when the stylist
          hasn't uploaded one. */}
      <div
        className="relative"
        style={{
          height: 156,
          background: bannerUrl
            ? `url(${bannerUrl}) center / cover no-repeat`
            : GRADIENTS.hero,
        }}
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.18) 100%)",
          }}
        />
        {/* Brand wordmark — centered in the visual top half of the
            banner (the bottom 44px is reserved for the logo
            overlap). Only renders when there's no custom banner
            image; a stylist who uploaded their own banner shouldn't
            have our wordmark stamped over their photography. */}
        {!bannerUrl && (
          <p
            aria-hidden
            className="bbp-brand-wordmark"
            style={{
              position: "absolute",
              top: 46,
              left: 0,
              right: 0,
              textAlign: "center",
              color: "rgba(255, 255, 255, 0.96)",
              fontSize: 15,
              fontWeight: 800,
              letterSpacing: "0.34em",
              textTransform: "uppercase",
              textShadow: "0 1px 10px rgba(21, 17, 26, 0.20)",
              margin: 0,
              // The keyframe drives transform / opacity /
              // letter-spacing. willChange hints the browser to
              // promote a compositor layer for the transform so
              // the slide stays jank-free on a low-end phone.
              willChange: "transform, opacity, letter-spacing",
            }}
          >
            Braid Boss Pro
          </p>
        )}
      </div>

      {/* Logo + name + handle pill, sitting on the banner edge. */}
      <div
        className="max-w-[640px] mx-auto px-5"
        style={{ marginTop: -44, position: "relative" }}
      >
        {/* Header row: logo overlaps the banner edge; title +
            handle sit lower so they land on the white surface
            instead of floating in the banner gradient. Mirrors the
            booking-page header treatment so the two surfaces feel
            like one site. */}
        <div className="flex items-start gap-[14px]">
          <div
            className="rounded-2xl shrink-0 overflow-hidden"
            style={{
              width: 88,
              height: 88,
              background: C.paper,
              border: `4px solid ${C.cream}`,
              boxShadow: SHADOWS.cardLifted,
            }}
          >
            {logoUrl ? (
              // Plain img — no Next.js Image because the public
              // storefront ships static and Image config adds setup
              // overhead we don't need for this phase.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  background: GRADIENTS.primary,
                }}
              />
            )}
          </div>
          <div className="flex-1 min-w-0" style={{ marginTop: 52 }}>
            <h1
              className="truncate"
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: 28,
                fontWeight: 700,
                color: C.brandPrimary,
                lineHeight: 1.1,
                margin: 0,
              }}
            >
              {businessName || "Welcome"}
            </h1>
            {/* Shop description sits where the @handle used to. It's a
                short line describing what the stylist sells. The
                @handle is intentionally not shown — on a shop that
                carries its own brand name it read as a mismatched
                personal tag (the handle still drives nav via the
                `handle` prop). */}
            {description?.trim() && (
              <p
                className="text-[12px]"
                style={{ color: C.muted, marginTop: 4, lineHeight: 1.5 }}
              >
                {description.trim()}
              </p>
            )}
          </div>
        </div>

        {/* Tab nav: Profile / Shop. Mounting a third "Book" tab is
            on the roadmap for Phase 2 — for now the existing book
            button on the profile card carries that flow. */}
        <nav
          className="mt-5 flex gap-2 border-b"
          style={{ borderColor: C.brandBorder }}
        >
          {(["profile", "shop"] as const).map((t) => {
            const isActive = active === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => go(t === "profile" ? "" : `/${t}`)}
                className="px-3 py-3 text-[13px] font-bold uppercase tracking-widest transition"
                style={{
                  color: isActive ? C.brandPrimary : C.muted,
                  letterSpacing: "0.14em",
                  borderBottom: `2px solid ${isActive ? C.brandPrimary : "transparent"}`,
                  marginBottom: -1,
                }}
              >
                {t === "profile" ? "Profile" : "Shop"}
              </button>
            );
          })}
        </nav>
      </div>

      <main className="max-w-[640px] mx-auto px-5 pb-20 pt-6">{children}</main>

      <footer
        className="max-w-[640px] mx-auto px-5 py-8 text-center"
        style={{ color: C.mutedSoft }}
      >
        <p className="text-[11px]">
          Powered by{" "}
          <span style={{ color: C.brandPrimary, fontWeight: 700 }}>
            Braid Boss Pro
          </span>
        </p>
      </footer>
    </div>
  );
};
