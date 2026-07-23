"use client";

// Public video-lesson detail at /@handle/videos/<slug>. Shows the
// lesson + optional preview, collects a name + email, and starts
// Stripe checkout on the braider's connected account via
// /api/video-checkout. After payment the buyer is redirected straight
// to /watch/<token> (the checkout route's success URL), so this page
// only handles the pre-purchase + ?cancelled=1 states.

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  StorefrontShell,
  C,
  GRADIENTS,
  SHADOWS,
  FONT_DISPLAY,
  fmtMoney,
} from "../../_components/StorefrontShell";
import { useStylistProfile } from "../../_components/useStylistProfile";
import {
  fetchPublicVideo,
  startVideoCheckout,
  videoAccessLabel,
  type PublicVideoDetail,
} from "../../../../lib/academy";

export default function VideoDetailPage() {
  const params = useParams();
  const router = useRouter();
  const search = useSearchParams();
  const handle = useMemo(() => {
    const raw = params?.handle;
    const v = Array.isArray(raw) ? raw[0] : raw || "";
    return decodeURIComponent(v).replace(/^@/, "");
  }, [params]);
  const videoSlug = useMemo(() => {
    const raw = params?.videoSlug;
    const v = Array.isArray(raw) ? raw[0] : raw || "";
    return decodeURIComponent(v);
  }, [params]);

  const cancelled = search?.get("cancelled") === "1";
  const profileState = useStylistProfile(handle);

  const [video, setVideo] = useState<PublicVideoDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profileState.status !== "ready") return;
    let stop = false;
    (async () => {
      setLoading(true);
      const r = await fetchPublicVideo(profileState.profile.slug, videoSlug);
      if (stop) return;
      if (!r.ok) {
        setError(r.error);
        setVideo(null);
      } else {
        setError(null);
        setVideo(r.video);
      }
      setLoading(false);
    })();
    return () => {
      stop = true;
    };
  }, [profileState.status, profileState.status === "ready" ? profileState.profile.slug : "", videoSlug]);

  if (profileState.status === "loading") return <CenterNote text="Loading…" />;
  if (profileState.status === "not_found") return <CenterNote text="Storefront not found." />;

  return (
    <StorefrontShell
      handle={handle}
      businessName={profileState.profile.shop_name || profileState.profile.business_name}
      description={profileState.profile.shop_description}
      bannerUrl={profileState.profile.shop_banner_url || profileState.profile.banner_image_url}
      logoUrl={profileState.profile.shop_logo_url || profileState.profile.logo_url}
      active="videos"
    >
      <button
        type="button"
        onClick={() => router.push(`/@${encodeURIComponent(handle)}/videos`)}
        className="text-[13px] font-semibold mb-4"
        style={{ color: C.muted }}
      >
        ← All videos
      </button>

      {loading ? (
        <div style={{ height: 320, borderRadius: 16, background: C.ivory }} className="animate-pulse" />
      ) : error || !video ? (
        <CenterNote text={error || "That video isn't available."} inline />
      ) : (
        <VideoBuy video={video} handle={handle} cancelled={cancelled} />
      )}
    </StorefrontShell>
  );
}

function VideoBuy({
  video,
  handle,
  cancelled,
}: {
  video: PublicVideoDetail;
  handle: string;
  cancelled: boolean;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const notReady = !video.stylist_account_id || !video.stylist_charges_enabled;

  const submit = async () => {
    setFormError(null);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()))
      return setFormError("Please enter a valid email — we send your access link there.");
    setSubmitting(true);
    const r = await startVideoCheckout({
      handle,
      videoSlug: video.slug,
      buyerName: name.trim(),
      buyerEmail: email.trim(),
    });
    if (!r.ok) {
      setFormError(r.error);
      setSubmitting(false);
      return;
    }
    window.location.href = r.url;
  };

  return (
    <>
      {/* Preview embed when the braider set one, else the cover art. */}
      {video.preview_url ? (
        <div style={{ borderRadius: 16, overflow: "hidden", boxShadow: SHADOWS.card }}>
          <div style={{ position: "relative", aspectRatio: "16 / 9", background: "#000" }}>
            <iframe
              src={video.preview_url}
              title={`${video.title} preview`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
            />
          </div>
        </div>
      ) : (
        <div
          className="relative"
          style={{
            aspectRatio: "16 / 9",
            borderRadius: 16,
            background: video.cover_image_url
              ? `url(${video.cover_image_url}) center / cover no-repeat`
              : GRADIENTS.hero,
            boxShadow: SHADOWS.card,
          }}
        >
          <span
            aria-hidden
            className="absolute inset-0 grid place-items-center"
            style={{ color: "rgba(255,255,255,0.92)", fontSize: 44 }}
          >
            ▶
          </span>
        </div>
      )}

      <span
        className="inline-block mt-4 text-[11px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full"
        style={{ color: C.brandPrimary, background: "rgba(124,58,237,0.08)", letterSpacing: "0.1em" }}
      >
        {videoAccessLabel(video.access_model, video.rental_days)}
      </span>

      <h1
        className="mt-2"
        style={{ fontFamily: FONT_DISPLAY, fontSize: 28, fontWeight: 700, color: C.brandText, lineHeight: 1.15 }}
      >
        {video.title}
      </h1>
      <p className="text-[18px] font-bold mt-1" style={{ color: C.brandPrimary }}>
        {fmtMoney(video.price, video.currency.toUpperCase())}
      </p>

      {video.description?.trim() && (
        <p className="mt-4 text-[15px] whitespace-pre-wrap" style={{ color: C.coffee, lineHeight: 1.6 }}>
          {video.description.trim()}
        </p>
      )}

      <div className="mt-6 rounded-2xl p-4" style={{ background: C.ivory }}>
        {cancelled && (
          <p
            className="text-[13px] mb-3 px-3 py-2 rounded-lg"
            style={{ background: "rgba(251,191,36,0.14)", color: "#92600A" }}
          >
            Checkout was cancelled — no charge was made.
          </p>
        )}
        {notReady ? (
          <p className="text-[14px]" style={{ color: C.muted }}>
            {"This braider isn't accepting payments yet. Please check back soon."}
          </p>
        ) : (
          <>
            <label className="block text-[12px] font-bold uppercase tracking-widest mb-1" style={{ color: C.muted }}>
              Name <span style={{ fontWeight: 400, textTransform: "none" }}>(optional)</span>
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Doe"
              className="w-full mb-3 px-3 py-2.5 rounded-lg text-[15px]"
              style={{ border: `1px solid ${C.brandBorder}`, background: C.paper, color: C.brandText }}
            />
            <label className="block text-[12px] font-bold uppercase tracking-widest mb-1" style={{ color: C.muted }}>
              Email
            </label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              inputMode="email"
              placeholder="you@email.com"
              className="w-full mb-3 px-3 py-2.5 rounded-lg text-[15px]"
              style={{ border: `1px solid ${C.brandBorder}`, background: C.paper, color: C.brandText }}
            />
            {formError && (
              <p className="text-[13px] mb-2" style={{ color: C.brandError }}>
                {formError}
              </p>
            )}
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="w-full py-3 rounded-xl text-[15px] font-bold text-white transition"
              style={{ background: GRADIENTS.primary, boxShadow: SHADOWS.primaryGlow, opacity: submitting ? 0.7 : 1 }}
            >
              {submitting
                ? "Starting checkout…"
                : `Get access · ${fmtMoney(video.price, video.currency.toUpperCase())}`}
            </button>
            <p className="text-[11px] text-center mt-2" style={{ color: C.mutedSoft }}>
              Secure checkout by Stripe. We email your private watch link right after payment.
            </p>
          </>
        )}
      </div>
    </>
  );
}

function CenterNote({ text, inline }: { text: string; inline?: boolean }) {
  if (inline) {
    return (
      <p className="text-center py-14 text-[15px]" style={{ color: C.muted }}>
        {text}
      </p>
    );
  }
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, color: C.muted }}>
      {text}
    </div>
  );
}
