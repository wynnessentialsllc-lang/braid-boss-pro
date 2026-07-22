"use client";

// Token-gated watch page at /watch/<token>. The ONLY place a paid
// video's playback link is revealed — public_get_video_access checks
// the purchase is paid and unexpired server-side (SECURITY DEFINER),
// so the raw access_url never ships to an unpaid visitor.
//
// Known providers (YouTube / Vimeo / Loom) render inline as an embed;
// anything else (a Drive link, a direct file) shows a prominent
// "Open video" button. Right after checkout the redirect can beat the
// webhook, so a 'not_paid' result polls a few times before giving up.

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  C,
  GRADIENTS,
  SHADOWS,
  FONT_DISPLAY,
  FONT_BODY,
} from "../../u/[handle]/_components/StorefrontShell";
import { fetchVideoAccess, type VideoAccess } from "../../lib/academy";

// Convert a share URL to an inline-embeddable one for the providers
// braiders actually use. Returns null when the URL isn't a known
// embeddable host — the caller then falls back to an "Open video" link.
const toEmbedUrl = (raw: string | null): string | null => {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = u.pathname.slice(1);
    return id ? `https://www.youtube.com/embed/${id}` : null;
  }
  if (host === "youtube.com" || host === "m.youtube.com") {
    const id = u.searchParams.get("v");
    if (id) return `https://www.youtube.com/embed/${id}`;
    if (u.pathname.startsWith("/embed/")) return raw;
    return null;
  }
  if (host === "vimeo.com") {
    const id = u.pathname.split("/").filter(Boolean)[0];
    return id && /^\d+$/.test(id) ? `https://player.vimeo.com/video/${id}` : null;
  }
  if (host === "loom.com") {
    const parts = u.pathname.split("/").filter(Boolean);
    const id = parts[parts.length - 1];
    return id ? `https://www.loom.com/embed/${id}` : null;
  }
  return null;
};

const REASON_COPY: Record<string, { title: string; body: string }> = {
  not_found: { title: "Link not found", body: "This watch link isn't valid. Double-check the link in your email." },
  expired: {
    title: "Access expired",
    body: "Your rental window has ended. You can purchase access again from the braider's storefront.",
  },
  invalid_token: { title: "Invalid link", body: "This watch link is malformed." },
  error: { title: "Something went wrong", body: "We couldn't load your video. Please try again in a moment." },
  unavailable: { title: "Unavailable", body: "This video isn't available right now." },
};

export default function WatchPage() {
  const params = useParams();
  const token = useMemo(() => {
    const raw = params?.token;
    const v = Array.isArray(raw) ? raw[0] : raw || "";
    return decodeURIComponent(v);
  }, [params]);

  const [access, setAccess] = useState<VideoAccess | null>(null);

  // Poll while the webhook catches up on a fresh purchase (not_paid).
  // State is only ever set inside the async runner, never synchronously
  // in the effect body.
  useEffect(() => {
    let stop = false;
    let count = 0;
    const run = () => {
      void (async () => {
        const r = await fetchVideoAccess(token);
        if (stop) return;
        setAccess(r);
        // Stop polling once we have a terminal answer (paid, or a hard
        // failure that won't change). Keep polling only while not_paid.
        if (r.ok || r.reason !== "not_paid") clearInterval(id);
      })();
    };
    const id = setInterval(() => {
      count += 1;
      if (count > 6) {
        clearInterval(id);
        return;
      }
      run();
    }, 2500);
    run();
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [token]);

  const shell = (children: React.ReactNode) => (
    <div style={{ minHeight: "100vh", background: C.espresso, color: "#fff", fontFamily: FONT_BODY }}>
      <div className="max-w-[820px] mx-auto px-5 py-8">
        <p
          className="text-center text-[13px] font-bold uppercase tracking-widest mb-6"
          style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "0.28em" }}
        >
          Braid Boss Pro
        </p>
        {children}
      </div>
    </div>
  );

  if (!access) {
    return shell(<p className="text-center py-20" style={{ color: "rgba(255,255,255,0.7)" }}>Loading…</p>);
  }

  if (!access.ok) {
    if (access.reason === "not_paid") {
      return shell(
        <div className="text-center py-16">
          <div style={{ fontSize: 34 }}>⏳</div>
          <h1 className="mt-3" style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 700 }}>
            Unlocking your video…
          </h1>
          <p className="mt-2 text-[14px]" style={{ color: "rgba(255,255,255,0.7)" }}>
            Your payment is confirming. This page will unlock automatically in a few seconds — no need to refresh.
          </p>
        </div>,
      );
    }
    const copy = REASON_COPY[access.reason] || REASON_COPY.unavailable;
    return shell(
      <div className="text-center py-16">
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 700 }}>{copy.title}</h1>
        <p className="mt-2 text-[14px]" style={{ color: "rgba(255,255,255,0.7)" }}>
          {copy.body}
        </p>
      </div>,
    );
  }

  const embedUrl = toEmbedUrl(access.access_url);

  return shell(
    <>
      {embedUrl ? (
        <div style={{ borderRadius: 16, overflow: "hidden", boxShadow: SHADOWS.cardLifted }}>
          <div style={{ position: "relative", aspectRatio: "16 / 9", background: "#000" }}>
            <iframe
              src={embedUrl}
              title={access.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              allowFullScreen
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
            />
          </div>
        </div>
      ) : (
        <div
          className="rounded-2xl p-8 text-center"
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }}
        >
          <div style={{ fontSize: 40 }}>🎬</div>
          <p className="mt-3 text-[15px]" style={{ color: "rgba(255,255,255,0.8)" }}>
            Your video is ready to watch.
          </p>
          {access.access_url && (
            <a
              href={access.access_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-4 py-3 px-6 rounded-xl text-[15px] font-bold text-white"
              style={{ background: GRADIENTS.primary, boxShadow: SHADOWS.primaryGlow }}
            >
              Open video ↗
            </a>
          )}
        </div>
      )}

      <div className="mt-5">
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 700 }}>{access.title}</h1>
        {access.description?.trim() && (
          <p className="mt-2 text-[15px] whitespace-pre-wrap" style={{ color: "rgba(255,255,255,0.78)", lineHeight: 1.6 }}>
            {access.description.trim()}
          </p>
        )}
        <p className="mt-4 text-[12px]" style={{ color: "rgba(255,255,255,0.5)" }}>
          {access.access_model === "rent" && access.access_expires_at
            ? `Access available until ${new Date(access.access_expires_at).toLocaleString()}.`
            : "You have permanent access — bookmark this page or keep the email."}
        </p>
      </div>
    </>,
  );
}
