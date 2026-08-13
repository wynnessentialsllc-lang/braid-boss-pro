"use client";

// Public video lessons list at /@handle/videos. Lists the braider's
// published tutorials; tapping a card routes to /@handle/videos/<slug>
// to buy access. Mirrors /@handle/shop + /@handle/classes.

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
import { fetchPublicVideos, videoAccessLabel, type PublicVideo } from "../../../lib/academy";

export default function StylistVideosPage() {
  const params = useParams();
  const router = useRouter();
  const handle = useMemo(() => {
    const raw = params?.handle;
    const v = Array.isArray(raw) ? raw[0] : raw || "";
    return decodeURIComponent(v).replace(/^@/, "");
  }, [params]);

  const profileState = useStylistProfile(handle);

  const [videos, setVideos] = useState<PublicVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profileState.status !== "ready") return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const r = await fetchPublicVideos(profileState.profile.slug);
      if (cancelled) return;
      if (!r.ok) {
        setError(r.error);
        setVideos([]);
      } else {
        setError(null);
        setVideos(r.videos);
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
      shopHidden={profileState.profile.shop_hidden}
      active="videos"
    >
      {loading ? (
        <div className="grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ height: 180, borderRadius: 16, background: C.ivory }} className="animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <EmptyState title="Couldn't load videos" body={error} />
      ) : videos.length === 0 ? (
        <EmptyState
          title="Tutorials coming soon"
          body="This braider hasn't posted any video lessons yet — check back soon."
        />
      ) : (
        <section className="grid grid-cols-2 gap-3">
          {videos.map((v) => (
            <VideoCard
              key={v.id}
              video={v}
              onTap={() =>
                router.push(`/@${encodeURIComponent(handle)}/videos/${encodeURIComponent(v.slug)}`)
              }
            />
          ))}
        </section>
      )}
    </StorefrontShell>
  );
}

function VideoCard({ video, onTap }: { video: PublicVideo; onTap: () => void }) {
  return (
    <button
      type="button"
      onClick={onTap}
      className="text-left rounded-2xl overflow-hidden transition"
      style={{ background: C.paper, border: `1px solid ${C.brandBorder}`, boxShadow: SHADOWS.card }}
    >
      <div
        className="relative"
        style={{
          aspectRatio: "16 / 10",
          background: video.cover_image_url
            ? `url(${video.cover_image_url}) center / cover no-repeat`
            : GRADIENTS.hero,
        }}
      >
        <span
          aria-hidden
          className="absolute inset-0 grid place-items-center"
          style={{ color: "rgba(255,255,255,0.92)", fontSize: 30 }}
        >
          ▶
        </span>
      </div>
      <div className="p-2.5">
        <h3
          className="text-[14px] font-bold leading-tight line-clamp-2"
          style={{ color: C.brandText }}
        >
          {video.title}
        </h3>
        <p className="text-[11px] mt-1" style={{ color: C.mutedSoft }}>
          {videoAccessLabel(video.access_model, video.rental_days)}
        </p>
        <p className="text-[14px] font-bold mt-1" style={{ color: C.brandPrimary }}>
          {fmtMoney(video.price, video.currency.toUpperCase())}
        </p>
      </div>
    </button>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="text-center py-14 px-6">
      <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 700, color: C.brandText }}>{title}</h2>
      <p className="text-[14px] mt-2" style={{ color: C.muted }}>
        {body}
      </p>
    </div>
  );
}
