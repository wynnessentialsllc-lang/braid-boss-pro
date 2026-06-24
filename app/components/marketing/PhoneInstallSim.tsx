"use client";

// Animated "Add to Home Screen" phone simulator for the How It Works
// install section. Pure-CSS, looping 4-scene walkthrough:
//   A. Browser open on braidbosspro.app (tap Share / ⋮)
//   B. Share sheet (iOS) or menu (Android) — "Add to Home Screen" / "Install app"
//   C. Install confirmation dialog (tap Add / Install)
//   D. Home screen — the app icon pops in with a sparkle
// No JS state, so it's SSR-safe and cheap. Honors prefers-reduced-motion
// by holding the final installed-home-screen frame.

import { type ReactNode } from "react";
import { Share, Plus, MoreVertical, Check, Sparkles, Lock, ChevronLeft } from "lucide-react";
import { C, GRADIENTS, SHADOWS } from "./tokens";

const ICON = (
  <span
    aria-hidden
    style={{
      width: 34,
      height: 34,
      borderRadius: 9,
      background: GRADIENTS.primary,
      boxShadow: SHADOWS.primaryGlow,
      display: "grid",
      placeItems: "center",
      flexShrink: 0,
    }}
  >
    <Sparkles size={16} color="#fff" />
  </span>
);

// One faint app-placeholder square (home screen + share-sheet rows).
const Dot = ({ s = 26 }: { s?: number }) => (
  <span
    aria-hidden
    style={{ width: s, height: s, borderRadius: s * 0.26, background: "rgba(21,17,26,0.07)", flexShrink: 0 }}
  />
);

// Faint skeleton text line.
const Bar = ({ w }: { w: number | string }) => (
  <span aria-hidden style={{ width: w, height: 5, borderRadius: 3, background: "rgba(21,17,26,0.08)" }} />
);

export const PhoneInstallSim = ({ tone, label }: { tone: "ios" | "android"; label: string }) => {
  const isIos = tone === "ios";

  // Shared faux page body (BBP tile + url + skeleton lines).
  const PageBody = (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, paddingTop: 22 }}>
      {ICON}
      <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: C.brandPrimary }}>
        braidbosspro.app
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "center", marginTop: 4 }}>
        <Bar w={84} /><Bar w={68} /><Bar w={76} />
      </div>
    </div>
  );

  return (
    <div className="bbp-sim" style={{ width: "100%", maxWidth: 176, margin: "0 auto" }}>
      <div
        className="bbp-sim-phone"
        style={{ width: "100%", aspectRatio: "9 / 19", borderRadius: 30, background: "#15111A", padding: 7, boxShadow: SHADOWS.cardLifted }}
      >
        <div
          className="bbp-sim-screen"
          style={{ position: "relative", width: "100%", height: "100%", borderRadius: 24, overflow: "hidden", background: "#FFFFFF" }}
        >
          {/* Status bar */}
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 18, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 10px", zIndex: 5 }}>
            <span style={{ fontSize: 7, fontWeight: 800, color: C.ink }}>9:41</span>
            <span aria-hidden style={{ width: isIos ? 30 : 6, height: 6, borderRadius: 999, background: "#15111A" }} />
            <span aria-hidden style={{ width: 14, height: 6, borderRadius: 2, border: `1px solid ${C.ink}`, opacity: 0.5 }} />
          </div>

          {/* SCENE A — browser */}
          <div className="bbp-sc bbp-sc-a" style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
            {!isIos && (
              <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", borderBottom: "1px solid rgba(21,17,26,0.06)" }}>
                <Lock size={9} color={C.muted} />
                <span style={{ fontSize: 7, color: C.muted, flex: 1 }}>braidbosspro.app</span>
                <span className="bbp-tap" style={{ borderRadius: 8, padding: 2, display: "grid", placeItems: "center" }}>
                  <MoreVertical size={13} color={C.brandPrimary} />
                </span>
              </div>
            )}
            <div style={{ flex: 1, display: "grid", placeItems: "center" }}>{PageBody}</div>
            {isIos && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-around", padding: "7px 8px", background: "#F4F2F6", borderTop: "1px solid rgba(21,17,26,0.06)" }}>
                <ChevronLeft size={13} color={C.mutedSoft} />
                <ChevronLeft size={13} color={C.mutedSoft} style={{ transform: "scaleX(-1)" }} />
                <span className="bbp-tap" style={{ borderRadius: 8, padding: 3, display: "grid", placeItems: "center" }}>
                  <Share size={13} color={C.brandPrimary} />
                </span>
                <span aria-hidden style={{ width: 11, height: 11, border: `1.5px solid ${C.mutedSoft}`, borderRadius: 3 }} />
              </div>
            )}
          </div>

          {/* SCENE B — share sheet (iOS) / menu (Android) */}
          <div className="bbp-sc bbp-sc-b" style={{ position: "absolute", inset: 0 }}>
            <div style={{ position: "absolute", inset: 0, background: "rgba(21,17,26,0.28)" }} />
            {isIos ? (
              <div className="bbp-sheet" style={{ position: "absolute", left: 6, right: 6, bottom: 6, borderRadius: 16, background: "#fff", padding: 10, boxShadow: "0 -8px 24px rgba(21,17,26,0.18)" }}>
                <div style={{ width: 30, height: 4, borderRadius: 999, background: "rgba(21,17,26,0.14)", margin: "0 auto 9px" }} />
                <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 9 }}>
                  <Dot /><Dot /><Dot /><Dot />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <Row faint label="Copy" right={<span style={{ width: 12, height: 12, borderRadius: 3, border: `1.5px solid ${C.mutedSoft}` }} />} />
                  <Row active label="Add to Home Screen" right={<span style={{ width: 14, height: 14, borderRadius: 4, border: `1.5px solid ${C.brandPrimary}`, display: "grid", placeItems: "center" }}><Plus size={9} color={C.brandPrimary} /></span>} />
                </div>
              </div>
            ) : (
              <div className="bbp-menu" style={{ position: "absolute", top: 26, right: 8, width: "62%", borderRadius: 12, background: "#fff", padding: 6, boxShadow: "0 12px 28px rgba(21,17,26,0.22)" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <Row faint label="New tab" />
                  <Row active label="Install app" right={<Plus size={11} color={C.brandPrimary} />} />
                  <Row faint label="Share" />
                </div>
              </div>
            )}
          </div>

          {/* SCENE C — confirm dialog */}
          <div className="bbp-sc bbp-sc-c" style={{ position: "absolute", inset: 0 }}>
            <div style={{ position: "absolute", inset: 0, background: "rgba(21,17,26,0.28)" }} />
            {isIos ? (
              <div style={{ position: "absolute", top: 24, left: 8, right: 8, borderRadius: 14, background: "#fff", overflow: "hidden", boxShadow: "0 12px 28px rgba(21,17,26,0.22)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 10px", borderBottom: "1px solid rgba(21,17,26,0.07)" }}>
                  <span style={{ fontSize: 8, color: C.mutedSoft }}>Cancel</span>
                  <span style={{ fontSize: 8, fontWeight: 700, color: C.ink }}>Add to Home Screen</span>
                  <span className="bbp-tap" style={{ fontSize: 8.5, fontWeight: 800, color: C.brandPrimary, padding: "1px 4px", borderRadius: 5 }}>Add</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 10 }}>
                  {ICON}
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <span style={{ fontSize: 8.5, fontWeight: 700, color: C.ink }}>Braid Boss Pro</span>
                    <span style={{ fontSize: 7, color: C.muted }}>braidbosspro.app</span>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ position: "absolute", left: 8, right: 8, bottom: 8, borderRadius: 14, background: "#fff", padding: 12, boxShadow: "0 12px 28px rgba(21,17,26,0.22)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  {ICON}
                  <span style={{ fontSize: 9, fontWeight: 700, color: C.ink }}>Install app?</span>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, alignItems: "center" }}>
                  <span style={{ fontSize: 8, color: C.mutedSoft }}>Cancel</span>
                  <span className="bbp-tap" style={{ fontSize: 9, fontWeight: 800, color: "#fff", background: GRADIENTS.primary, padding: "3px 10px", borderRadius: 999 }}>Install</span>
                </div>
              </div>
            )}
          </div>

          {/* SCENE D — home screen, icon pops in */}
          <div className="bbp-sc bbp-sc-d" style={{ position: "absolute", inset: 0, background: GRADIENTS.softA }}>
            <div style={{ position: "absolute", top: 26, left: 12, right: 12, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, justifyItems: "center" }}>
              <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <span className="bbp-pop" style={{ display: "grid", placeItems: "center", width: 32, height: 32, borderRadius: 9, background: GRADIENTS.primary, boxShadow: SHADOWS.primaryGlow }}>
                  <Sparkles size={15} color="#fff" />
                </span>
                <span style={{ fontSize: 6.5, fontWeight: 700, color: C.ink, whiteSpace: "nowrap" }}>Braid Boss</span>
                <Sparkles className="bbp-sparkle" size={12} color={C.brandSecondary} style={{ position: "absolute", top: -6, right: -2 }} />
              </div>
              <Dot s={32} /><Dot s={32} /><Dot s={32} />
              <Dot s={32} /><Dot s={32} /><Dot s={32} /><Dot s={32} />
            </div>
            <div className="bbp-installed" style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 4, background: "#fff", borderRadius: 999, padding: "4px 9px", boxShadow: SHADOWS.card }}>
              <Check size={10} color={C.brandSuccess} />
              <span style={{ fontSize: 7.5, fontWeight: 800, color: C.ink }}>Installed</span>
            </div>
          </div>
        </div>
      </div>

      {/* Progress pips */}
      <div style={{ display: "flex", gap: 5, justifyContent: "center", marginTop: 12 }}>
        <span className="bbp-pip bbp-pip-1" /><span className="bbp-pip bbp-pip-2" />
        <span className="bbp-pip bbp-pip-3" /><span className="bbp-pip bbp-pip-4" />
      </div>
      <p style={{ textAlign: "center", fontSize: 9, fontWeight: 700, color: C.muted, letterSpacing: "0.10em", textTransform: "uppercase", marginTop: 8 }}>
        {label}
      </p>

      <style>{`
        .bbp-sim .bbp-sc { opacity: 0; }
        .bbp-sim .bbp-sc-a { animation: bbpScA 13s infinite ease-in-out; }
        .bbp-sim .bbp-sc-b { animation: bbpScB 13s infinite ease-in-out; }
        .bbp-sim .bbp-sc-c { animation: bbpScC 13s infinite ease-in-out; }
        .bbp-sim .bbp-sc-d { animation: bbpScD 13s infinite ease-in-out; }
        .bbp-sim .bbp-sheet { animation: bbpSheetUp 13s infinite cubic-bezier(.2,.8,.2,1); }
        .bbp-sim .bbp-menu { transform-origin: top right; animation: bbpMenuIn 13s infinite cubic-bezier(.2,.8,.2,1); }
        .bbp-sim .bbp-pop { animation: bbpPop 13s infinite cubic-bezier(.2,.9,.2,1.2); }
        .bbp-sim .bbp-sparkle { animation: bbpSparkle 13s infinite ease-out; opacity: 0; }
        .bbp-sim .bbp-installed { animation: bbpInstalled 13s infinite ease-out; opacity: 0; }
        .bbp-sim .bbp-tap { box-shadow: 0 0 0 0 rgba(124,58,237,0.5); animation: bbpTap 1.5s infinite ease-out; }
        .bbp-sim .bbp-pip { width: 5px; height: 5px; border-radius: 999px; background: rgba(124,58,237,0.18); transition: none; }
        .bbp-sim .bbp-pip-1 { animation: bbpPip1 13s infinite ease-in-out; }
        .bbp-sim .bbp-pip-2 { animation: bbpPip2 13s infinite ease-in-out; }
        .bbp-sim .bbp-pip-3 { animation: bbpPip3 13s infinite ease-in-out; }
        .bbp-sim .bbp-pip-4 { animation: bbpPip4 13s infinite ease-in-out; }

        @keyframes bbpScA { 0%{opacity:1} 22%{opacity:1} 26%{opacity:0} 96%{opacity:0} 100%{opacity:1} }
        @keyframes bbpScB { 0%,24%{opacity:0} 28%,47%{opacity:1} 51%,100%{opacity:0} }
        @keyframes bbpScC { 0%,49%{opacity:0} 53%,72%{opacity:1} 76%,100%{opacity:0} }
        @keyframes bbpScD { 0%,74%{opacity:0} 78%,97%{opacity:1} 100%{opacity:0} }
        @keyframes bbpSheetUp { 0%,24%{transform:translateY(115%)} 30%,47%{transform:translateY(0)} 52%,100%{transform:translateY(115%)} }
        @keyframes bbpMenuIn { 0%,24%{transform:scale(.7);opacity:0} 30%,47%{transform:scale(1);opacity:1} 52%,100%{transform:scale(.7);opacity:0} }
        @keyframes bbpPop { 0%,76%{transform:scale(.3);opacity:0} 82%{transform:scale(1.12);opacity:1} 88%,97%{transform:scale(1);opacity:1} 100%{opacity:0} }
        @keyframes bbpSparkle { 0%,79%{opacity:0;transform:scale(.4) rotate(-20deg)} 85%{opacity:1;transform:scale(1) rotate(0)} 93%{opacity:0} 100%{opacity:0} }
        @keyframes bbpInstalled { 0%,82%{opacity:0;transform:translateX(-50%) translateY(6px)} 88%,97%{opacity:1;transform:translateX(-50%) translateY(0)} 100%{opacity:0} }
        @keyframes bbpTap { 0%{box-shadow:0 0 0 0 rgba(124,58,237,0.45)} 70%{box-shadow:0 0 0 9px rgba(124,58,237,0)} 100%{box-shadow:0 0 0 0 rgba(124,58,237,0)} }
        @keyframes bbpPip1 { 0%,22%{background:#7C3AED;width:13px} 25%,100%{background:rgba(124,58,237,0.18);width:5px} }
        @keyframes bbpPip2 { 0%,25%{background:rgba(124,58,237,0.18);width:5px} 28%,47%{background:#7C3AED;width:13px} 51%,100%{background:rgba(124,58,237,0.18);width:5px} }
        @keyframes bbpPip3 { 0%,50%{background:rgba(124,58,237,0.18);width:5px} 53%,72%{background:#7C3AED;width:13px} 76%,100%{background:rgba(124,58,237,0.18);width:5px} }
        @keyframes bbpPip4 { 0%,75%{background:rgba(124,58,237,0.18);width:5px} 78%,97%{background:#7C3AED;width:13px} 100%{background:rgba(124,58,237,0.18);width:5px} }

        @media (prefers-reduced-motion: reduce) {
          .bbp-sim .bbp-sc-a, .bbp-sim .bbp-sc-b, .bbp-sim .bbp-sc-c { animation: none; opacity: 0 !important; }
          .bbp-sim .bbp-sc-d { animation: none; opacity: 1 !important; }
          .bbp-sim .bbp-pop, .bbp-sim .bbp-installed, .bbp-sim .bbp-sparkle { animation: none; opacity: 1 !important; transform: none !important; }
          .bbp-sim .bbp-installed { transform: translateX(-50%) !important; }
          .bbp-sim .bbp-tap { animation: none; }
          .bbp-sim .bbp-pip { animation: none; }
          .bbp-sim .bbp-pip-4 { background: #7C3AED; width: 13px; }
        }
      `}</style>
    </div>
  );
};

// Share-sheet / menu list row. `active` = the tap target (highlighted).
const Row = ({ label, right, active, faint }: { label: string; right?: ReactNode; active?: boolean; faint?: boolean }) => (
  <span
    className={active ? "bbp-tap" : undefined}
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
      padding: "6px 8px",
      borderRadius: 9,
      background: active ? "rgba(124,58,237,0.10)" : "transparent",
      border: active ? "1px solid rgba(124,58,237,0.30)" : "1px solid transparent",
    }}
  >
    <span style={{ fontSize: 8.5, fontWeight: active ? 800 : 600, color: faint ? C.mutedSoft : active ? C.brandPrimaryDeep : C.ink }}>
      {label}
    </span>
    {right ?? <span aria-hidden style={{ width: 12, height: 12 }} />}
  </span>
);
