"use client";

// Pull-to-refresh for the Braid Boss Pro PWA.
//
// Mounts once at the root and listens to touch events on window.
// Renders an absolutely-positioned premium indicator at the top of
// the viewport that fades in as the user pulls down past the top of
// the page.
//
// Refresh strategy:
//   1. dispatch a `bbp:refresh` CustomEvent on window — any
//      app-side hook (cloud sync, store re-hydrate) can subscribe
//      with `window.addEventListener("bbp:refresh", ...)` and do
//      its own targeted refetch. This is the preferred path.
//      Listeners can register their fetch promise via
//      `e.detail.waitFor(promise)` so the spinner stays on screen
//      until the work actually finishes (capped by MAX_REFRESH_MS
//      so a stuck network can't lock the indicator forever).
//   2. call router.refresh() from next/navigation as a fallback so
//      any Server Component subtree gets re-evaluated.
//   3. NEVER falls back to window.location.reload — too heavy and
//      kills client state.
//
// Constraints respected:
//   * Only triggers when window.scrollY === 0.
//   * Bails on touchstart if the gesture began inside an editable
//     element (input / textarea / select / contentEditable / [data-no-ptr]).
//   * preventDefault is only called while we're actively pulling
//     (phase ≠ "idle") so normal scrolling, horizontal swipes, and
//     bottom-tab gestures are untouched.
//   * Reduced motion disables the spinner rotation.
//   * Guards against re-entry while already refreshing.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const PULL_THRESHOLD = 70;
const MAX_PULL = 120;
const RESIST_FACTOR = 1.6;
// Minimum hold so a near-instant cache hit still reads as "I did
// something" instead of a flicker; maximum cap so a stuck request
// can't lock the indicator on screen.
const MIN_REFRESH_HOLD_MS = 450;
const MAX_REFRESH_MS = 8000;

type Phase = "idle" | "pulling" | "ready" | "refreshing";

const isEditableTarget = (el: EventTarget | null): boolean => {
  if (!(el instanceof Element)) return false;
  const editable = el.closest(
    "input, textarea, select, [contenteditable=''], [contenteditable='true'], [data-no-ptr]",
  );
  return !!editable;
};

const PullToRefresh = () => {
  const [phase, setPhase] = useState<Phase>("idle");
  const [distance, setDistance] = useState(0);
  const [reduced, setReduced] = useState(false);

  const startY = useRef<number | null>(null);
  const pulling = useRef(false);
  const refreshing = useRef(false);
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      setReduced(mq.matches);
      const on = () => setReduced(mq.matches);
      mq.addEventListener?.("change", on);
      return () => mq.removeEventListener?.("change", on);
    } catch {
      /* older Safari — silent */
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onTouchStart = (e: TouchEvent) => {
      if (refreshing.current) return;
      if (window.scrollY > 0) return;
      if (isEditableTarget(e.target)) return;
      if (e.touches.length !== 1) return;
      startY.current = e.touches[0].clientY;
      pulling.current = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (refreshing.current) return;
      if (startY.current === null) return;
      // If the page has scrolled, the pull-to-refresh gesture is
      // over — the user is just scrolling normally.
      if (window.scrollY > 0) {
        startY.current = null;
        pulling.current = false;
        if (phase !== "idle") {
          setPhase("idle");
          setDistance(0);
        }
        return;
      }
      const delta = e.touches[0].clientY - startY.current;
      if (delta <= 0) {
        if (pulling.current) {
          pulling.current = false;
          setPhase("idle");
          setDistance(0);
        }
        return;
      }
      // Once we've decided this is a pull, take over the gesture so
      // the page doesn't rubber-band.
      if (e.cancelable) e.preventDefault();
      pulling.current = true;

      // Tiered resistance: linear up to threshold, then divide so the
      // user feels the brake before MAX_PULL.
      const adjusted =
        delta <= PULL_THRESHOLD
          ? delta
          : PULL_THRESHOLD + (delta - PULL_THRESHOLD) / RESIST_FACTOR;
      const clamped = Math.min(MAX_PULL, adjusted);
      setDistance(clamped);
      setPhase(clamped >= PULL_THRESHOLD ? "ready" : "pulling");
    };

    const onTouchEnd = () => {
      if (refreshing.current) return;
      if (!pulling.current) {
        startY.current = null;
        return;
      }
      pulling.current = false;
      startY.current = null;

      if (distance < PULL_THRESHOLD) {
        setPhase("idle");
        setDistance(0);
        return;
      }

      // Lock and trigger the refresh.
      refreshing.current = true;
      setPhase("refreshing");
      setDistance(PULL_THRESHOLD);

      // Collect any promises listeners want us to wait for. The event
      // is mutated synchronously by listeners (waitFor pushes into the
      // array), so by the time dispatchEvent returns we have the full
      // set of in-flight refetches to await.
      const refreshPromises: Promise<unknown>[] = [];
      try {
        const evt = new CustomEvent("bbp:refresh", {
          detail: {
            waitFor: (p: Promise<unknown>) => {
              if (p && typeof (p as any).then === "function") refreshPromises.push(p);
            },
          },
        });
        window.dispatchEvent(evt);
      } catch {
        /* CustomEvent unsupported — extremely rare */
      }
      try {
        router.refresh();
      } catch {
        /* router not available — silent */
      }

      const startedAt = Date.now();
      const finish = () => {
        const elapsed = Date.now() - startedAt;
        const remaining = Math.max(0, MIN_REFRESH_HOLD_MS - elapsed);
        window.setTimeout(() => {
          refreshing.current = false;
          setPhase("idle");
          setDistance(0);
        }, remaining);
      };
      // Wait for whatever the app told us to wait for, but cap so a
      // dead network can't park the spinner forever.
      Promise.race([
        refreshPromises.length > 0 ? Promise.allSettled(refreshPromises) : Promise.resolve(),
        new Promise(r => window.setTimeout(r, MAX_REFRESH_MS)),
      ]).then(finish, finish);
    };

    const onTouchCancel = () => {
      pulling.current = false;
      startY.current = null;
      if (!refreshing.current) {
        setPhase("idle");
        setDistance(0);
      }
    };

    // passive: false so we can preventDefault during a pull.
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchCancel, { passive: true });

    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [distance, phase, router]);

  // Hide the indicator entirely in idle state so SSR markup is empty
  // and hydration is stable. Once active, the element animates in via
  // inline transform (driven by state, deterministic).
  if (phase === "idle" && distance === 0) return null;

  const label =
    phase === "refreshing"
      ? "Refreshing…"
      : phase === "ready"
      ? "Release to refresh"
      : "Pull to refresh";

  const progress = Math.min(1, distance / PULL_THRESHOLD);

  return (
    <div
      aria-hidden={phase !== "refreshing"}
      role={phase === "refreshing" ? "status" : undefined}
      style={{
        position: "fixed",
        top: "max(8px, env(safe-area-inset-top))",
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
        zIndex: 9999,
        transition:
          phase === "refreshing" || phase === "idle"
            ? "transform 220ms cubic-bezier(0.22, 0.61, 0.36, 1), opacity 220ms ease"
            : "none",
        transform: `translateY(${Math.max(0, distance - 56)}px)`,
        opacity: Math.max(0.2, progress),
      }}
    >
      <style>{`
        @keyframes bbp-ptr-spin {
          to { transform: rotate(360deg); }
        }
        .bbp-ptr-spinner {
          animation: bbp-ptr-spin 0.9s linear infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .bbp-ptr-spinner { animation: none !important; }
        }
      `}</style>
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 16px 8px 12px",
          borderRadius: 999,
          background: "#FFFFFF",
          border: "1px solid rgba(21, 17, 26,0.12)",
          boxShadow:
            "0 10px 22px -10px rgba(21, 17, 26,0.28), 0 2px 4px rgba(21, 17, 26,0.05)",
          color: "#15111A",
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: "0.03em",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <span
          aria-hidden
          className={
            phase === "refreshing" && !reduced ? "bbp-ptr-spinner" : ""
          }
          style={{
            width: 16,
            height: 16,
            borderRadius: 99,
            border: "2px solid rgba(168,137,63,0.25)",
            borderTopColor: "#5B21B6",
            // While pulling, the ring rotates with the pull progress
            // for a tactile feel; while refreshing, the keyframe spin
            // takes over.
            transform:
              phase === "refreshing"
                ? undefined
                : `rotate(${progress * 360}deg)`,
            transition:
              phase === "refreshing" ? "none" : "transform 60ms linear",
          }}
        />
        <span style={{ whiteSpace: "nowrap" }}>{label}</span>
      </div>
    </div>
  );
};

export default PullToRefresh;
