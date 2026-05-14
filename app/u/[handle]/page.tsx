"use client";

// /@handle now redirects to /book/<canonical-slug>. The Phase-1
// standalone profile page existed to surface intro / socials /
// policies, but the booking page already carries all of that PLUS
// the booking action — so the profile was a redundant bridge. We
// keep the /@handle URL alive (it's the friendly share URL the
// stylist puts on Instagram) and just bounce visitors to the
// canonical booking surface.
//
// /@handle/shop and /@handle/products/<slug> are unchanged — they
// stay as standalone storefront pages.

import { useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { C, FONT_DISPLAY } from "./_components/StorefrontShell";
import { useStylistProfile } from "./_components/useStylistProfile";

export default function StylistProfileRedirect() {
  const params = useParams();
  const router = useRouter();
  const handle = useMemo(() => {
    const raw = params?.handle;
    const v = Array.isArray(raw) ? raw[0] : raw || "";
    return decodeURIComponent(v).replace(/^@/, "");
  }, [params]);

  const state = useStylistProfile(handle);

  useEffect(() => {
    if (state.status !== "ready") return;
    // router.replace so the visitor's back button takes them to
    // wherever they came from (e.g. an Instagram tap), not back to
    // the @handle URL that immediately bounces.
    router.replace(`/book/${encodeURIComponent(state.profile.slug)}`);
  }, [state, router]);

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
      Opening booking page…
    </div>
  );
}
