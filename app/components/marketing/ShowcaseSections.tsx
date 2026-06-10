"use client";

// Vagaro-inspired "showcase" sections — each pairs a polished product
// mockup with a headline + supporting copy, recreated in the Braid
// Boss Pro palette (purple #7C3AED → pink #FF4D6D, lime sparkle, serif
// display). These are the "simple and sophisticated" feature spotlights
// that sit between the FeatureCard grids on /features.
//
// Everything here is a hand-built mock (no screenshots, no external
// logo assets) so it stays on-brand and renders crisp at any size.

import { type ReactNode } from "react";
import {
  Pencil,
  StickyNote,
  FileText,
  RefreshCw,
  Trash2,
  ArrowLeftRight,
  ChevronRight,
  ChevronDown,
  Scissors,
  Camera,
  Video,
  Share2,
  Search,
  MapPin,
  Star,
  Link as LinkIcon,
  Crown,
  Sparkles,
} from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, GRADIENTS, SHADOWS } from "./tokens";

/* ------------------------------------------------------------------ */
/*  Shared copy block (headline + body under a mockup)                 */
/* ------------------------------------------------------------------ */

const ShowcaseCopy = ({
  heading,
  body,
  font = "sans",
  align = "left",
  tone = "ink",
}: {
  heading: ReactNode;
  body: ReactNode;
  font?: "sans" | "serif";
  align?: "left" | "center";
  tone?: "ink" | "light";
}) => {
  const headingColor = tone === "light" ? "#FFFFFF" : C.ink;
  const bodyColor = tone === "light" ? "rgba(255,255,255,0.82)" : C.coffee;
  return (
    <div style={{ textAlign: align, maxWidth: align === "center" ? 620 : undefined, marginInline: align === "center" ? "auto" : undefined }}>
      <h3
        style={{
          fontFamily: font === "serif" ? FONT_DISPLAY : FONT_BODY,
          fontWeight: font === "serif" ? 600 : 800,
          fontSize: font === "serif" ? "clamp(30px, 5vw, 46px)" : "clamp(28px, 4.6vw, 40px)",
          lineHeight: 1.08,
          letterSpacing: font === "serif" ? "0" : "-0.02em",
          color: headingColor,
          margin: 0,
        }}
      >
        {heading}
      </h3>
      <p
        style={{
          color: bodyColor,
          fontSize: "clamp(15px, 2vw, 18px)",
          lineHeight: 1.55,
          marginTop: 16,
        }}
      >
        {body}
      </p>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  1. Appointment action sheet  (IMG_4598)                            */
/* ------------------------------------------------------------------ */

const actionRows: Array<{
  icon: ReactNode;
  chip: string;
  title: string;
  sub: string;
  chevron?: boolean;
}> = [
  { icon: <span style={{ width: 12, height: 12, borderRadius: 999, background: C.brandPrimary, display: "block" }} />, chip: "rgba(124,58,237,0.12)", title: "Change Status", sub: "Accepted", chevron: true },
  { icon: <Pencil size={16} />, chip: "rgba(124,58,237,0.12)", title: "Edit", sub: "Edit this appointment" },
  { icon: <StickyNote size={16} />, chip: "rgba(251,191,36,0.18)", title: "Client Notes (1)", sub: "Allergic to tight tension" },
  { icon: <FileText size={16} />, chip: "rgba(99,102,241,0.16)", title: "Contract", sub: "View signed contract" },
  { icon: <RefreshCw size={16} />, chip: "rgba(34,197,94,0.16)", title: "Rebook", sub: "Book her next install" },
  { icon: <Trash2 size={16} />, chip: "rgba(255,77,109,0.14)", title: "Delete", sub: "Delete this appointment" },
  { icon: <ArrowLeftRight size={16} />, chip: "rgba(255,122,69,0.16)", title: "Move", sub: "Move to a different time" },
];

const rowIconColor = ["#7C3AED", "#7C3AED", "#B7791F", "#6366F1", "#16A34A", "#E0354F", "#EA6A2E"];

const AppointmentActionMock = () => (
  <div style={{ position: "relative", width: "100%", maxWidth: 380, marginInline: "auto" }}>
    {/* base appointment chip peeking out behind, lower-left */}
    <div
      style={{
        position: "absolute",
        left: 0,
        bottom: -18,
        width: 200,
        background: "#FFFFFF",
        borderRadius: 16,
        boxShadow: "0 18px 40px -18px rgba(21,17,26,0.45)",
        padding: "14px 16px",
        zIndex: 1,
      }}
    >
      <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: C.ink }}>Jasmine Carter</p>
      <p style={{ margin: "2px 0 0", fontSize: 12, color: C.muted }}>Knotless Braids — Medium</p>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: C.muted }}>
          <Scissors size={12} /> Chair 2
        </span>
        <RefreshCw size={14} color={C.brandPrimary} />
      </div>
    </div>

    {/* floating action sheet */}
    <div
      style={{
        position: "relative",
        marginLeft: 56,
        background: "#FFFFFF",
        borderRadius: 22,
        boxShadow: "0 30px 60px -24px rgba(21,17,26,0.5)",
        overflow: "hidden",
        zIndex: 2,
      }}
    >
      {/* header */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "16px 18px 14px" }}>
        <span
          style={{
            width: 40,
            height: 40,
            borderRadius: 999,
            background: GRADIENTS.primary,
            color: "#fff",
            display: "grid",
            placeItems: "center",
            fontWeight: 800,
            fontSize: 15,
            flexShrink: 0,
          }}
        >
          JC
        </span>
        <div>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 15, color: C.ink }}>Jasmine Carter</p>
          <p style={{ margin: "1px 0 0", fontSize: 12, color: C.muted }}>Knotless Braids — Medium</p>
          <p style={{ margin: "1px 0 0", fontSize: 12, color: C.muted }}>Sat, July 18 at 9:00 AM</p>
        </div>
      </div>
      <div style={{ height: 1, background: C.hairline }} />

      {/* rows */}
      <div style={{ padding: "6px 8px" }}>
        {actionRows.map((r, i) => (
          <div key={r.title} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 10px" }}>
            <span
              style={{
                width: 30,
                height: 30,
                borderRadius: 9,
                background: r.chip,
                color: rowIconColor[i],
                display: "grid",
                placeItems: "center",
                flexShrink: 0,
              }}
            >
              {r.icon}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontWeight: 600, fontSize: 13.5, color: C.ink }}>{r.title}</p>
              <p style={{ margin: 0, fontSize: 11.5, color: C.mutedSoft, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.sub}</p>
            </div>
            {r.chevron && <ChevronRight size={16} color={C.mutedSoft} />}
          </div>
        ))}
      </div>

      {/* checkout */}
      <div style={{ padding: "4px 12px 14px" }}>
        <div
          style={{
            background: "linear-gradient(135deg, #22C55E 0%, #16A34A 100%)",
            color: "#fff",
            textAlign: "center",
            fontWeight: 800,
            fontSize: 14,
            letterSpacing: "0.02em",
            padding: "13px 0",
            borderRadius: 13,
            boxShadow: "0 10px 24px -10px rgba(34,197,94,0.6)",
          }}
        >
          Checkout
        </div>
      </div>
    </div>
  </div>
);

export const AppointmentActionShowcase = () => (
  <section style={{ padding: "30px 20px" }}>
    <div className="max-w-[1100px] mx-auto bbp-reveal">
      <div
        style={{
          borderRadius: 32,
          overflow: "hidden",
          background: GRADIENTS.hero,
          boxShadow: SHADOWS.cardLifted,
          position: "relative",
        }}
      >
        <div
          aria-hidden
          className="bbp-hero-halo"
          style={{
            position: "absolute",
            inset: -120,
            background: "conic-gradient(from 200deg, rgba(255,255,255,0.18), rgba(198,255,0,0.14), rgba(255,255,255,0.18))",
            filter: "blur(70px)",
            opacity: 0.4,
            pointerEvents: "none",
          }}
        />
        <div style={{ position: "relative", padding: "clamp(36px, 5vw, 60px)", display: "grid", gap: 44, placeItems: "center", gridTemplateColumns: "1fr" }} className="bbp-showcase-split">
          <div style={{ width: "100%", paddingBottom: 18 }}>
            <AppointmentActionMock />
          </div>
          <ShowcaseCopy
            tone="light"
            heading={<>Rebook, take notes &amp; check out — all from your chair</>}
            body="Tap any appointment to change its status, pull up client notes, view the signed contract, rebook her next install, or check out — without ever leaving your calendar."
          />
        </div>
      </div>
    </div>
    <style>{`
      @media (min-width: 860px) {
        .bbp-showcase-split { grid-template-columns: 0.9fr 1.1fr !important; }
      }
    `}</style>
  </section>
);

/* ------------------------------------------------------------------ */
/*  2. Customizable calendar  (IMG_4600)                               */
/* ------------------------------------------------------------------ */

type Appt = { name: string; service: string; top: number; height: number; tint: keyof typeof BLOCK };

const BLOCK = {
  lilac: { bg: "rgba(124,58,237,0.14)", bar: "#7C3AED", text: "#4C2A86" },
  rose: { bg: "rgba(255,77,109,0.14)", bar: "#FF4D6D", text: "#A02742" },
  peach: { bg: "rgba(255,122,69,0.16)", bar: "#FF7A45", text: "#9A461F" },
  mint: { bg: "rgba(34,197,94,0.15)", bar: "#22C55E", text: "#1B6E3C" },
  sky: { bg: "rgba(56,189,248,0.16)", bar: "#38BDF8", text: "#1E6E97" },
} as const;

// Single-stylist day — Braid Boss Pro is a one-chair app, so the
// mockup shows the owner's own day in one column (mirrors the real
// app's day view), not multiple braiders.
const dayAppts: Appt[] = [
  { name: "Natalie Brooks", service: "Boho Knotless", top: 4, height: 100, tint: "lilac" },
  { name: "Rachel Kim", service: "Color + Box Braids", top: 110, height: 74, tint: "rose" },
  { name: "Amanda White", service: "Soft Locs", top: 190, height: 56, tint: "mint" },
  { name: "Diana Park", service: "Passion Twists", top: 252, height: 56, tint: "sky" },
];

const times = ["8 AM", "9 AM", "10 AM", "11 AM", "12 PM", "1 PM"];

const CalendarMock = () => (
  <div
    style={{
      background: "#FFFFFF",
      borderRadius: 22,
      border: `1px solid ${C.brandBorder}`,
      boxShadow: SHADOWS.cardLifted,
      overflow: "hidden",
      maxWidth: 880,
      marginInline: "auto",
    }}
  >
    {/* window chrome / toolbar */}
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "12px 16px",
        background: GRADIENTS.hero,
        color: "#fff",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Sparkles size={16} />
        <span style={{ fontWeight: 800, letterSpacing: "0.08em", fontSize: 13 }}>BRAID BOSS PRO</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, opacity: 0.9 }}>Wed, Sep 30</span>
        <span style={{ background: "rgba(255,255,255,0.25)", borderRadius: 8, padding: "4px 10px", fontSize: 12, fontWeight: 700 }}>Day</span>
        <span style={{ background: "#FFFFFF", color: C.brandPrimary, borderRadius: 8, padding: "4px 12px", fontSize: 12, fontWeight: 800 }}>+ Add</span>
      </div>
    </div>

    {/* day label row */}
    <div style={{ display: "grid", gridTemplateColumns: "44px 1fr", borderBottom: `1px solid ${C.hairline}` }}>
      <div />
      <div style={{ padding: "10px 14px" }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: C.ink }}>My day</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginLeft: 8 }}>4 appointments</span>
      </div>
    </div>

    {/* grid body — single column */}
    <div style={{ display: "grid", gridTemplateColumns: "44px 1fr", position: "relative" }}>
      {/* time gutter */}
      <div>
        {times.map((t) => (
          <div key={t} style={{ height: 52, fontSize: 10.5, color: C.mutedSoft, padding: "4px 6px", textAlign: "right" }}>{t}</div>
        ))}
      </div>
      {/* the day's single column */}
      <div style={{ position: "relative", borderLeft: `1px solid ${C.hairline}` }}>
        {times.map((t, ti) => (
          <div key={t} style={{ height: 52, borderBottom: `1px solid ${C.hairline}`, background: ti % 2 ? "#FFFFFF" : "#FCFBFE" }} />
        ))}
        {dayAppts.map((a) => {
          const b = BLOCK[a.tint];
          return (
            <div
              key={a.name}
              style={{
                position: "absolute",
                left: 8,
                right: 10,
                top: a.top + 4,
                height: a.height,
                background: b.bg,
                borderLeft: `3px solid ${b.bar}`,
                borderRadius: 10,
                padding: "8px 11px",
                overflow: "hidden",
              }}
            >
              <p style={{ margin: 0, fontWeight: 700, fontSize: 12.5, color: b.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</p>
              <p style={{ margin: "2px 0 0", fontSize: 11, color: b.text, opacity: 0.78 }}>{a.service}</p>
            </div>
          );
        })}
      </div>
    </div>
  </div>
);

export const CalendarShowcase = () => (
  <section style={{ padding: "56px 20px", background: C.brandSurface }}>
    <div className="max-w-[1100px] mx-auto">
      <header className="text-center bbp-reveal" style={{ marginBottom: 32 }}>
        <ShowcaseCopy
          align="center"
          font="serif"
          heading={<>Make your calendar match your brand</>}
          body="Set appointment colors per service, pick a theme gradient, and switch between light and dark. Turn on the Aura glow when you want your day to look as good as your work."
        />
      </header>
      <div className="bbp-reveal" data-delay={100}>
        <CalendarMock />
      </div>
    </div>
  </section>
);

/* ------------------------------------------------------------------ */
/*  3. Track appointments by source  (IMG_4601)                        */
/* ------------------------------------------------------------------ */

const sources: Array<{ icon: ReactNode; label: string; color: string }> = [
  { icon: <Camera size={20} />, label: "Instagram", color: "#E1306C" },
  { icon: <Video size={20} />, label: "TikTok", color: "#15111A" },
  { icon: <Share2 size={20} />, label: "Facebook", color: "#1877F2" },
  { icon: <Search size={20} />, label: "Google", color: "#4285F4" },
  { icon: <MapPin size={20} />, label: "Maps", color: "#34A853" },
  { icon: <Star size={20} />, label: "Reviews", color: "#FBBF24" },
  { icon: <LinkIcon size={20} />, label: "Link in bio", color: "#7C3AED" },
];

const SourceOrbitMock = () => {
  const size = 320;
  const center = size / 2;
  const radius = 132;
  return (
    <div style={{ position: "relative", width: size, height: size, marginInline: "auto", maxWidth: "100%" }}>
      {/* concentric rings */}
      {[radius, radius - 36, radius - 72].map((r) => (
        <div
          key={r}
          aria-hidden
          style={{
            position: "absolute",
            left: center - r,
            top: center - r,
            width: r * 2,
            height: r * 2,
            borderRadius: 999,
            border: `1px solid ${C.hairline}`,
          }}
        />
      ))}
      {/* soft brand glow */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: center - 78,
          top: center - 78,
          width: 156,
          height: 156,
          borderRadius: 999,
          background: GRADIENTS.softA,
          filter: "blur(14px)",
        }}
      />
      {/* center BBP mark */}
      <div
        style={{
          position: "absolute",
          left: center - 34,
          top: center - 34,
          width: 68,
          height: 68,
          borderRadius: 20,
          background: "#FFFFFF",
          display: "grid",
          placeItems: "center",
          boxShadow: SHADOWS.cardLifted,
        }}
      >
        <span style={{ width: 44, height: 44, borderRadius: 14, background: GRADIENTS.primary, display: "grid", placeItems: "center", color: "#fff", boxShadow: SHADOWS.primaryGlow }}>
          <Sparkles size={22} />
        </span>
      </div>
      {/* orbiting source badges */}
      {sources.map((s, i) => {
        const angle = (-90 + i * (360 / sources.length)) * (Math.PI / 180);
        const x = center + radius * Math.cos(angle);
        const y = center + radius * Math.sin(angle);
        return (
          <div
            key={s.label}
            title={s.label}
            style={{
              position: "absolute",
              left: x - 24,
              top: y - 24,
              width: 48,
              height: 48,
              borderRadius: 14,
              background: "#FFFFFF",
              color: s.color,
              display: "grid",
              placeItems: "center",
              boxShadow: "0 12px 28px -12px rgba(21,17,26,0.35)",
              border: `1px solid ${C.brandBorder}`,
            }}
          >
            {s.icon}
          </div>
        );
      })}
    </div>
  );
};

export const SourceOrbitShowcase = () => (
  <section style={{ padding: "30px 20px" }}>
    <div className="max-w-[1100px] mx-auto bbp-reveal">
      <div style={{ display: "grid", gap: 40, placeItems: "center", gridTemplateColumns: "1fr" }} className="bbp-showcase-split">
        <div style={{ paddingBlock: 20 }}>
          <SourceOrbitMock />
        </div>
        <ShowcaseCopy
          heading={<>Track every booking back to its source</>}
          body="When a client finds you on Instagram, TikTok, Google, or your link in bio, the booking is tagged automatically. See exactly which platforms fill your chair — so you know where your next post should go."
        />
      </div>
    </div>
  </section>
);

/* ------------------------------------------------------------------ */
/*  4. Easy access to client info  (IMG_4602)                          */
/* ------------------------------------------------------------------ */

const clientStats: Array<{ value: string; label: string }> = [
  { value: "Jan 24, 2021", label: "Client Since" },
  { value: "47", label: "Appointments" },
  { value: "$3,240", label: "Lifetime Spend" },
  { value: "May 28, 2026", label: "Last Visit" },
  { value: "0", label: "No Shows" },
  { value: "1", label: "Cancellations" },
];

const ClientInfoMock = () => (
  <div
    style={{
      background: "rgba(255,255,255,0.06)",
      borderRadius: 26,
      padding: 22,
      maxWidth: 460,
      marginInline: "auto",
      border: "1px solid rgba(255,255,255,0.12)",
    }}
  >
    {/* client header */}
    <div
      style={{
        background: "#FFFFFF",
        borderRadius: 16,
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        boxShadow: SHADOWS.card,
      }}
    >
      <span style={{ width: 42, height: 42, borderRadius: 999, background: GRADIENTS.primary, color: "#fff", display: "grid", placeItems: "center", fontWeight: 800 }}>
        MR
      </span>
      <span style={{ fontWeight: 700, fontSize: 17, color: C.ink, flex: 1 }}>Maya Robinson</span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "rgba(124,58,237,0.1)", color: C.brandPrimary, borderRadius: 999, padding: "4px 10px", fontSize: 11, fontWeight: 800, letterSpacing: "0.04em" }}>
        <Crown size={12} /> VIP
      </span>
      <ChevronDown size={18} color={C.mutedSoft} />
    </div>

    {/* stat grid */}
    <div
      style={{
        marginTop: 14,
        background: "#FFFFFF",
        borderRadius: 16,
        boxShadow: SHADOWS.card,
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        overflow: "hidden",
      }}
    >
      {clientStats.map((s, i) => (
        <div
          key={s.label}
          style={{
            padding: "18px 10px",
            textAlign: "center",
            borderRight: i % 3 !== 2 ? `1px solid ${C.hairline}` : undefined,
            borderTop: i >= 3 ? `1px solid ${C.hairline}` : undefined,
          }}
        >
          <p style={{ margin: 0, fontWeight: 800, fontSize: "clamp(15px, 2.2vw, 19px)", color: C.ink }}>{s.value}</p>
          <p style={{ margin: "4px 0 0", fontSize: 11.5, color: C.muted }}>{s.label}</p>
        </div>
      ))}
    </div>
  </div>
);

export const ClientInfoShowcase = () => (
  <section style={{ padding: "30px 20px" }}>
    <div className="max-w-[1100px] mx-auto bbp-reveal">
      <div
        style={{
          borderRadius: 32,
          overflow: "hidden",
          background: "linear-gradient(160deg, #1F1530 0%, #3A2350 60%, #4C2A6B 100%)",
          boxShadow: SHADOWS.cardLifted,
          position: "relative",
        }}
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: -80,
            right: -60,
            width: 280,
            height: 280,
            borderRadius: 999,
            background: GRADIENTS.softB,
            filter: "blur(50px)",
            opacity: 0.6,
            pointerEvents: "none",
          }}
        />
        <div style={{ position: "relative", padding: "clamp(36px, 5vw, 60px)", display: "grid", gap: 40, placeItems: "center", gridTemplateColumns: "1fr" }} className="bbp-showcase-split">
          <div style={{ width: "100%" }}>
            <ClientInfoMock />
          </div>
          <ShowcaseCopy
            tone="light"
            heading={<>Every client&apos;s story, one tap away</>}
            body="Lifetime spend, visit history, no-shows, and her last style photo — all on one card. Pull up everything you need to make her feel like a regular, then send an update straight from her profile."
          />
        </div>
      </div>
    </div>
  </section>
);
