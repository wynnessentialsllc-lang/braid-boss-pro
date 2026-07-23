"use client";

// Public classes list at /@handle/classes. Lists the braider's
// published, upcoming workshops. Tapping a card routes to
// /@handle/classes/<slug> to sign up + pay. Mirrors /@handle/shop.

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  StorefrontShell,
  C,
  GRADIENTS,
  SHADOWS,
  FONT_DISPLAY,
  fmtMoney,
} from "../_components/StorefrontShell";
import { useStylistProfile } from "../_components/useStylistProfile";
import {
  fetchPublicClasses,
  formatClassWhen,
  type PublicClass,
} from "../../../lib/academy";

export default function StylistClassesPage() {
  const params = useParams();
  const router = useRouter();
  const handle = useMemo(() => {
    const raw = params?.handle;
    const v = Array.isArray(raw) ? raw[0] : raw || "";
    return decodeURIComponent(v).replace(/^@/, "");
  }, [params]);

  const profileState = useStylistProfile(handle);

  const [classes, setClasses] = useState<PublicClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profileState.status !== "ready") return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const r = await fetchPublicClasses(profileState.profile.slug);
      if (cancelled) return;
      if (!r.ok) {
        setError(r.error);
        setClasses([]);
      } else {
        setError(null);
        setClasses(r.classes);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [profileState.status, profileState.status === "ready" ? profileState.profile.slug : ""]);

  if (profileState.status === "loading") {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: C.muted }}>
        Loading…
      </div>
    );
  }
  if (profileState.status === "not_found") {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, color: C.brandText }}>
        <p>Storefront not found.</p>
      </div>
    );
  }

  return (
    <StorefrontShell
      handle={handle}
      businessName={profileState.profile.shop_name || profileState.profile.business_name}
      description={profileState.profile.shop_description}
      bannerUrl={profileState.profile.shop_banner_url || profileState.profile.banner_image_url}
      logoUrl={profileState.profile.shop_logo_url || profileState.profile.logo_url}
      active="classes"
    >
      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{ height: 92, borderRadius: 16, background: C.ivory }}
              className="animate-pulse"
            />
          ))}
        </div>
      ) : error ? (
        <EmptyState title="Couldn't load classes" body={error} />
      ) : classes.length === 0 ? (
        <EmptyState
          title="Classes coming soon"
          body="This braider hasn't posted any classes yet — check back soon."
        />
      ) : (
        <section className="space-y-3">
          {classes.map((c) => (
            <ClassCard
              key={c.id}
              klass={c}
              onTap={() =>
                router.push(
                  `/@${encodeURIComponent(handle)}/classes/${encodeURIComponent(c.slug)}`,
                )
              }
            />
          ))}
        </section>
      )}
    </StorefrontShell>
  );
}

function ClassCard({ klass, onTap }: { klass: PublicClass; onTap: () => void }) {
  const full = klass.seats_remaining != null && klass.seats_remaining <= 0;
  const low =
    klass.seats_remaining != null && klass.seats_remaining > 0 && klass.seats_remaining <= 3;
  return (
    <button
      type="button"
      onClick={onTap}
      className="w-full text-left flex gap-3 rounded-2xl overflow-hidden transition"
      style={{ background: C.paper, border: `1px solid ${C.brandBorder}`, boxShadow: SHADOWS.card }}
    >
      <div
        style={{
          width: 96,
          minHeight: 96,
          alignSelf: "stretch",
          background: klass.cover_image_url
            ? `url(${klass.cover_image_url}) center / cover no-repeat`
            : GRADIENTS.hero,
          flexShrink: 0,
        }}
      />
      <div className="flex-1 min-w-0 py-3 pr-3">
        <div className="flex items-center gap-2 mb-1">
          <span
            className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full"
            style={{
              color: C.brandPrimary,
              background: "rgba(124,58,237,0.08)",
              letterSpacing: "0.1em",
            }}
          >
            {klass.format === "virtual" ? "Virtual" : "In person"}
          </span>
          {full && (
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: C.brandError }}>
              Full
            </span>
          )}
          {low && (
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: C.brandWarning }}>
              {klass.seats_remaining} left
            </span>
          )}
        </div>
        <h3
          className="truncate"
          style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700, color: C.brandText, lineHeight: 1.2 }}
        >
          {klass.title}
        </h3>
        <p className="text-[12px] mt-0.5" style={{ color: C.muted }}>
          {formatClassWhen(klass.starts_at, klass.timezone)}
        </p>
        <p className="text-[14px] font-bold mt-1" style={{ color: C.brandPrimary }}>
          {fmtMoney(klass.price, klass.currency.toUpperCase())}
        </p>
      </div>
    </button>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="text-center py-14 px-6">
      <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 700, color: C.brandText }}>
        {title}
      </h2>
      <p className="text-[14px] mt-2" style={{ color: C.muted }}>
        {body}
      </p>
    </div>
  );
}
