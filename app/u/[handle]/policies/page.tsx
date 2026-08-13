"use client";

// Public policies page at /@handle/policies. Read-only buyer-facing
// surface for the three text fields the stylist publishes (shipping,
// return, refund). Linked from the cart checkout disclosure as the
// "By placing this order you agree to our shipping & return policies"
// click target — that affirmative acknowledgment is the chargeback /
// BNPL / state-consumer-law safety net.

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  StorefrontShell,
  C,
  FONT_DISPLAY,
} from "../_components/StorefrontShell";
import { useStylistProfile } from "../_components/useStylistProfile";
import { fetchShopPolicies, type ShopPolicies } from "../../../lib/storefront";

// Render a single policy section. Renders nothing when the text is empty
// so a stylist who only set one of three doesn't show empty headers.
const Section = ({ title, text }: { title: string; text: string | null }) => {
  if (!text || !text.trim()) return null;
  return (
    <section style={{ marginTop: 28 }}>
      <h2
        style={{
          fontSize: 11,
          fontWeight: 800,
          color: C.muted,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          margin: 0,
        }}
      >
        {title}
      </h2>
      <p
        style={{
          marginTop: 10,
          fontSize: 14,
          color: C.espresso,
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
        }}
      >
        {text.trim()}
      </p>
    </section>
  );
};

export default function PoliciesPage() {
  const params = useParams();
  const handle = useMemo(() => {
    const raw = params?.handle;
    const v = Array.isArray(raw) ? raw[0] : raw || "";
    return decodeURIComponent(v).replace(/^@/, "");
  }, [params]);

  const profileState = useStylistProfile(handle);
  const [policies, setPolicies] = useState<ShopPolicies | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (profileState.status !== "ready") return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const p = await fetchShopPolicies(profileState.profile.slug);
      if (!cancelled) {
        setPolicies(p);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileState.status, profileState.profile?.slug]);

  // Use whatever fields the profile has; mirrors how the products page calls
  // the shell so the header/banner is consistent across the storefront.
  const shellProps = {
    handle,
    businessName: (profileState.status === "ready"
      ? profileState.profile.shop_name || profileState.profile.business_name
      : null) as string | null,
    description: (profileState.status === "ready"
      ? profileState.profile.shop_description
      : null) as string | null,
    bannerUrl: (profileState.status === "ready"
      ? profileState.profile.shop_banner_url || profileState.profile.banner_image_url
      : null) as string | null,
    logoUrl: (profileState.status === "ready"
      ? profileState.profile.shop_logo_url || profileState.profile.logo_url
      : null) as string | null,
    shopHidden: profileState.status === "ready" ? profileState.profile.shop_hidden : false,
    active: "shop" as const,
  };

  if (profileState.status === "loading" || loading) {
    return (
      <StorefrontShell {...shellProps}>
        <div style={{ padding: "40px 20px", color: C.muted, textAlign: "center" }}>Loading…</div>
      </StorefrontShell>
    );
  }
  if (profileState.status === "not_found") {
    return (
      <StorefrontShell {...shellProps}>
        <div style={{ padding: "40px 20px", color: C.muted, textAlign: "center" }}>Shop not found.</div>
      </StorefrontShell>
    );
  }

  const hasAny = !!(
    policies?.shipping_policy?.trim() ||
    policies?.return_policy?.trim() ||
    policies?.refund_policy?.trim()
  );
  const studio = policies?.studio_name || shellProps.businessName || "this shop";

  return (
    <StorefrontShell {...shellProps}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "20px 20px 60px" }}>
        <p
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: C.muted,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            margin: 0,
          }}
        >
          Shop policies
        </p>
        <h1
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 32,
            fontWeight: 700,
            color: C.espresso,
            margin: "6px 0 4px",
          }}
        >
          {studio}
        </h1>
        <p style={{ fontSize: 13, color: C.muted, marginTop: 0 }}>
          The policies below apply to retail orders placed through this shop.
        </p>

        {!hasAny ? (
          <p style={{ marginTop: 32, fontSize: 14, color: C.muted, lineHeight: 1.55 }}>
            {studio} hasn&apos;t published shipping or return policies yet. If you have a
            question about a recent order, reach out through the contact details on the shop
            page.
          </p>
        ) : (
          <>
            <Section title="Shipping" text={policies?.shipping_policy ?? null} />
            <Section title="Returns" text={policies?.return_policy ?? null} />
            <Section title="Refunds" text={policies?.refund_policy ?? null} />
          </>
        )}
      </div>
    </StorefrontShell>
  );
}
