"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// Shared shell for the public-facing legal & support pages. Standalone
// of the main app shell (no auth, no bottom nav) so anonymous visitors
// from the App Store review or a client's email link can read these
// without booting the whole React tree.

const C = {
  espresso: "#15111A", coffee: "#3D3447", caramel: "#6F6477",
  cream: "#FFFFFF", ivory: "#F6F2EC", paper: "#FFFFFF",
  gold: "#7C3AED", goldDeep: "#5B21B6",
  muted: "#6F6477", hairline: "rgba(21, 17, 26, 0.12)",
} as const;
const FONT_DISPLAY = `"Cormorant Garamond", Georgia, serif`;
const FONT_BODY = `"DM Sans", "Inter", system-ui, sans-serif`;

export const LegalShell = ({
  title,
  intro,
  updated,
  children,
}: {
  title: string;
  intro?: string;
  updated?: string;
  children: React.ReactNode;
}) => {
  const router = useRouter();
  return (
    <div style={{ minHeight: "100dvh", background: C.cream, fontFamily: FONT_BODY, color: C.espresso }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=DM+Sans:wght@400;500;600;700&display=swap');
        * { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
        body { margin: 0; }
        a { color: ${C.goldDeep}; }
      `}</style>
      <header
        className="sticky top-0 z-10"
        style={{
          background: `${C.cream}f5`,
          backdropFilter: "blur(10px)",
          borderBottom: `1px solid ${C.hairline}`,
        }}>
        <div className="mx-auto flex items-center justify-between px-5 py-3" style={{ maxWidth: 720 }}>
          <button
            onClick={() => { if (window.history.length > 1) router.back(); else router.push("/"); }}
            className="text-sm font-semibold flex items-center gap-1.5 active:scale-[0.97] transition"
            style={{ color: C.coffee }}
            aria-label="Back">
            <span aria-hidden>←</span> Back
          </button>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: C.gold }}>
            Braid Boss Pro
          </p>
          <div style={{ width: 60 }} aria-hidden />
        </div>
      </header>

      <main className="mx-auto px-5 pb-16" style={{ maxWidth: 720 }}>
        <div className="pt-8 pb-4">
          <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 36, fontWeight: 600, lineHeight: 1.1, color: C.espresso }}>
            {title}
          </h1>
          {intro && (
            <p className="mt-3 text-sm leading-relaxed" style={{ color: C.coffee }}>
              {intro}
            </p>
          )}
          {updated && (
            <p className="mt-2 text-[11px]" style={{ color: C.muted }}>
              Last updated: {updated}
            </p>
          )}
        </div>
        <article className="space-y-6 text-[14px] leading-relaxed" style={{ color: C.coffee }}>
          {children}
        </article>

        <footer className="mt-12 pt-6" style={{ borderTop: `1px solid ${C.hairline}` }}>
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-[12px]" style={{ color: C.muted }}>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/support">Support</Link>
            <Link href="/">Open the app</Link>
          </div>
          <p className="mt-3 text-[11px]" style={{ color: C.muted }}>
            © {new Date().getFullYear()} <strong>Wynn Essentials, LLC</strong>. Braid Boss Pro is built for braiders, by people who love your work.
          </p>
          <p className="mt-1 text-[11px]" style={{ color: C.muted }}>
            braidbosspro.app is operated by Wynn Essentials, LLC · Contact{" "}
            <a href="mailto:hello@braidbosspro.app">hello@braidbosspro.app</a>
          </p>
        </footer>
      </main>
    </div>
  );
};

export const LegalSection = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section>
    <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 600, color: C.espresso, marginBottom: 8 }}>
      {title}
    </h2>
    <div className="space-y-3">{children}</div>
  </section>
);

export const LegalList = ({ items }: { items: React.ReactNode[] }) => (
  <ul className="space-y-1.5 pl-5" style={{ listStyle: "disc" }}>
    {items.map((item, i) => <li key={i}>{item}</li>)}
  </ul>
);

export const LEGAL_TOKENS = C;
