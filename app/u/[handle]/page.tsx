"use client";

// Public stylist profile at /@handle (mounted at /u/[handle]/ via
// middleware.ts so the file system stays out of Next.js parallel
// route territory). Surfaces the stylist's brand, intro, location,
// socials, plus a CTA to the existing booking page and a tab to
// the new /@handle/shop storefront.

import { useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  StorefrontShell,
  C,
  GRADIENTS,
  SHADOWS,
  FONT_DISPLAY,
} from "./_components/StorefrontShell";
import { useStylistProfile } from "./_components/useStylistProfile";

export default function StylistProfilePage() {
  const params = useParams();
  const router = useRouter();
  // The middleware passes through the literal handle (no leading @
  // because the rewrite stripped it). We strip again defensively in
  // case the URL was hit directly via /u/<handle>.
  const handle = useMemo(() => {
    const raw = params?.handle;
    const v = Array.isArray(raw) ? raw[0] : raw || "";
    return decodeURIComponent(v).replace(/^@/, "");
  }, [params]);

  const state = useStylistProfile(handle);

  if (state.status === "loading") {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: C.cream,
          display: "grid",
          placeItems: "center",
          color: C.muted,
        }}
      >
        Loading…
      </div>
    );
  }
  if (state.status === "not_found") {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: C.cream,
          display: "grid",
          placeItems: "center",
          padding: 24,
          textAlign: "center",
          color: C.brandText,
        }}
      >
        <div>
          <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 28, fontWeight: 600 }}>
            Storefront not found
          </h1>
          <p style={{ marginTop: 8, color: C.muted }}>{state.error}</p>
        </div>
      </div>
    );
  }

  const p = state.profile;
  const locationLine = [
    p.location_text,
    [p.business_city, p.business_state].filter(Boolean).join(", "),
  ]
    .filter((s) => s && s.trim())
    .join(" · ");

  return (
    <StorefrontShell
      handle={handle}
      displayHandle={p.branded_slug}
      businessName={p.business_name}
      bannerUrl={p.banner_image_url}
      logoUrl={p.logo_url}
      active="profile"
    >
      {/* Hero card — intro + Book button. */}
      <section
        className="rounded-3xl p-5"
        style={{
          background: C.paper,
          border: `1px solid ${C.brandBorder}`,
          boxShadow: SHADOWS.card,
        }}
      >
        {locationLine && (
          <p
            className="text-[11px] font-bold uppercase tracking-widest mb-1"
            style={{ color: C.brandPrimary, letterSpacing: "0.16em" }}
          >
            {locationLine}
          </p>
        )}
        {p.intro && (
          <p
            className="text-[15px] leading-relaxed"
            style={{ color: C.coffee }}
          >
            {p.intro}
          </p>
        )}
        <button
          type="button"
          onClick={() => router.push(`/book/${encodeURIComponent(p.slug)}`)}
          className="mt-4 w-full rounded-2xl px-4 py-3 text-[14px] font-bold uppercase tracking-widest active:scale-[0.98] transition"
          style={{
            background: GRADIENTS.primary,
            color: "#FFFFFF",
            boxShadow: SHADOWS.primaryGlow,
            letterSpacing: "0.12em",
            border: 0,
          }}
        >
          Book an appointment
        </button>
        <button
          type="button"
          onClick={() => router.push(`/@${encodeURIComponent(handle)}/shop`)}
          className="mt-2 w-full rounded-2xl px-4 py-3 text-[13px] font-bold uppercase tracking-widest active:scale-[0.98] transition"
          style={{
            background: "transparent",
            color: C.brandPrimary,
            border: `1.5px solid ${C.brandPrimary}`,
            letterSpacing: "0.12em",
          }}
        >
          Shop the storefront
        </button>
      </section>

      {/* Socials row */}
      {(p.instagram_url || p.tiktok_url || p.website_url) && (
        <section className="mt-5 flex flex-wrap gap-2">
          {p.instagram_url && (
            <SocialChip label="Instagram" href={p.instagram_url} />
          )}
          {p.tiktok_url && <SocialChip label="TikTok" href={p.tiktok_url} />}
          {p.website_url && <SocialChip label="Website" href={p.website_url} />}
        </section>
      )}

      {p.years_in_business != null && p.years_in_business > 0 && (
        <p
          className="mt-5 text-[12px]"
          style={{ color: C.muted }}
        >
          {p.years_in_business} {p.years_in_business === 1 ? "year" : "years"} in
          business
        </p>
      )}

      {p.policies && (
        <section className="mt-6">
          <h2
            className="text-[11px] font-bold uppercase tracking-widest mb-2"
            style={{ color: C.muted, letterSpacing: "0.14em" }}
          >
            Policies
          </h2>
          <p
            className="text-[13px] leading-relaxed whitespace-pre-wrap"
            style={{ color: C.coffee }}
          >
            {p.policies}
          </p>
        </section>
      )}
    </StorefrontShell>
  );
}

const SocialChip = ({ label, href }: { label: string; href: string }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-widest"
    style={{
      color: C.brandPrimary,
      border: `1px solid ${C.brandPrimary}`,
      letterSpacing: "0.12em",
    }}
  >
    {label}
  </a>
);
