import type { Metadata } from "next";
import {
  Lock,
  ShieldCheck,
  KeyRound,
  CreditCard,
  Database,
  UserCheck,
  DownloadCloud,
} from "lucide-react";
import {
  MarketingShell,
  MarketingHero,
  Section,
  CtaFooter,
} from "../components/marketing/MarketingShell";
import { C, FONT_DISPLAY, GRADIENTS, SHADOWS } from "../components/marketing/tokens";

export const metadata: Metadata = {
  title: "Security · Braid Boss Pro — how we protect your business data",
  description:
    "How Braid Boss Pro protects your and your clients' data: encryption in transit and at rest, per-user row-level isolation, PCI-DSS payments through Stripe (we never see card data), and one-tap data export and deletion.",
  alternates: { canonical: "/security" },
  keywords: [
    "braid boss pro security",
    "is braid boss pro safe",
    "braider app data security",
    "salon software client data protection",
  ],
  openGraph: {
    title: "Security · Braid Boss Pro",
    description:
      "Encryption, per-user data isolation, PCI-DSS payments through Stripe, and full data ownership — how Braid Boss Pro keeps your business data safe.",
    url: "/security",
    siteName: "Braid Boss Pro",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Security · Braid Boss Pro",
    description:
      "How Braid Boss Pro protects your and your clients' data — encryption, data isolation, PCI-DSS payments, and full data ownership.",
  },
};

const PILLARS: Array<{ icon: React.ReactNode; title: string; body: string }> = [
  {
    icon: <Lock size={20} />,
    title: "Encrypted in transit and at rest",
    body: "Every request runs over HTTPS, and your records live in an encrypted, managed Postgres database. Nothing about your business travels or sits in the clear.",
  },
  {
    icon: <KeyRound size={20} />,
    title: "Your data is walled off from everyone else's",
    body: "Client records and photos live in private storage with per-user row-level security — your account can only ever read or write the rows it owns. One braider can never see another's book.",
  },
  {
    icon: <CreditCard size={20} />,
    title: "Payments handled by Stripe — we never see card data",
    body: "Card details are entered directly with Stripe, a PCI-DSS-certified processor, and are never seen or stored by Braid Boss Pro. Funds settle straight into your own Stripe account; we don't custody your money.",
  },
  {
    icon: <UserCheck size={20} />,
    title: "Access on a need-to-know basis",
    body: "Access to user data is restricted to authorized personnel only, following industry-standard administrative, technical, and physical safeguards against unauthorized access or disclosure.",
  },
  {
    icon: <ShieldCheck size={20} />,
    title: "Hardened by modern security headers",
    body: "The site ships a strict Content-Security-Policy, HSTS (with preload), and clickjacking protection (frame-ancestors none) — the same protections banks use to blunt injection and framing attacks.",
  },
  {
    icon: <DownloadCloud size={20} />,
    title: "You own your data — export or delete anytime",
    body: "Export everything we hold for you as a single JSON file in one tap. Delete your account and we cascade-delete every per-user row in the database. Your business is yours to take or remove.",
  },
];

export default function SecurityPage() {
  return (
    <MarketingShell>
      <MarketingHero
        eyebrow="Trust & security"
        title={
          <>
            Your business data,{" "}
            <em
              style={{
                fontStyle: "italic",
                background: "linear-gradient(135deg, #7C3AED 0%, #FF4D6D 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              protected.
            </em>
          </>
        }
        body="Your client book, your photos, your money — Braid Boss Pro treats all of it like it's ours to protect. Here's exactly how your and your clients' data is kept safe."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "Read the privacy policy", href: "/privacy" }}
      />

      <Section
        eyebrow="How we protect you"
        title="Security built into every layer."
        intro="No marketing hand-waving — every point below reflects how the product actually works today."
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 16,
          }}
        >
          {PILLARS.map((p, i) => (
            <article
              key={p.title}
              className="bbp-reveal"
              data-delay={String(((i % 3) + 1) * 100)}
              style={{
                background: C.paper,
                border: `1px solid ${C.brandBorder}`,
                borderRadius: 18,
                padding: 18,
                boxShadow: SHADOWS.card,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 12,
                  display: "grid",
                  placeItems: "center",
                  background: GRADIENTS.primary,
                  color: "#FFFFFF",
                  boxShadow: SHADOWS.primaryGlow,
                  marginBottom: 10,
                }}
              >
                {p.icon}
              </span>
              <h2
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontWeight: 700,
                  fontSize: 18,
                  color: C.ink,
                  margin: 0,
                  lineHeight: 1.15,
                }}
              >
                {p.title}
              </h2>
              <p style={{ color: C.coffee, fontSize: 13, lineHeight: 1.55, marginTop: 6 }}>{p.body}</p>
            </article>
          ))}
        </div>

        <div
          className="bbp-reveal"
          style={{
            marginTop: 26,
            padding: 18,
            background: "#FBFAFD",
            border: `1px solid ${C.brandBorder}`,
            borderRadius: 18,
            color: C.coffee,
            fontSize: 13.5,
            lineHeight: 1.6,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <Database size={20} aria-hidden style={{ color: C.brandPrimary, flexShrink: 0 }} />
          <span>
            Want the full detail on what we collect, how it&apos;s used, and your rights? Read the{" "}
            <a href="/privacy" style={{ color: C.brandPrimary, fontWeight: 700, textDecoration: "underline" }}>
              Privacy Policy
            </a>
            . Found a security issue? Email{" "}
            <a href="mailto:hello@braidbosspro.app" style={{ color: C.brandPrimary, fontWeight: 700, textDecoration: "underline" }}>
              hello@braidbosspro.app
            </a>
            .
          </span>
        </div>
      </Section>

      <CtaFooter
        title="Run your business on a platform that protects it."
        body="Start with a 14-day free trial — every feature unlocked. Then $14.99/month, or $149/year. No contracts, cancel anytime."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See pricing", href: "/pricing" }}
      />
    </MarketingShell>
  );
}
