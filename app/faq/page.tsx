import type { Metadata } from "next";
import { ChevronDown } from "lucide-react";
import {
  MarketingShell,
  MarketingHero,
  Section,
  CtaFooter,
} from "../components/marketing/MarketingShell";
import { C, SHADOWS } from "../components/marketing/tokens";

export const metadata: Metadata = {
  title: "FAQ · Braid Boss Pro — booking app for braiders",
  description:
    "Common questions about Braid Boss Pro — the booking + commerce app for braid stylists. Founding stylist lifetime access, Stripe Connect, deposits, storefront, PWA install on iPhone + Android.",
  alternates: { canonical: "/faq" },
  keywords: [
    "braider booking app FAQ",
    "booking app for braiders questions",
    "braider scheduling app help",
    "braid business management app",
    "Stripe Connect for braiders",
    "deposits for braiders",
    "PWA install braider app",
    "iPhone Android booking app for braiders",
  ],
  openGraph: {
    title: "FAQ · Braid Boss Pro",
    description:
      "Common questions about Braid Boss Pro — booking, commerce, Stripe Connect, PWA install, founding stylist lifetime access.",
    url: "/faq",
    siteName: "Braid Boss Pro",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "FAQ · Braid Boss Pro",
    description: "Common questions about the booking + commerce app for braid stylists.",
  },
};

// Source of truth for the FAQ — used to render the UI AND to
// generate the FAQPage structured-data JSON-LD below. Keeping them
// in one place guarantees the page text and the schema can never
// drift out of sync (which Google + Bing both rank against).
type Faq = { q: string; a: string };

const FAQS_FOUNDING: Faq[] = [
  {
    q: "What is Founding Stylist access?",
    a: "Founding Stylist access is a one-time payment that unlocks lifetime access to Braid Boss Pro — the business operating system for braiders. The first 100 stylists who sign up lock in lifetime platform access at the founding rate. After the first 100 spots are claimed, Braid Boss Pro transitions to monthly membership pricing.",
  },
  {
    q: "How much does Founding Stylist access cost?",
    a: "Founding Stylist access is a single one-time payment of $9.99 — no monthly fee, ever. After the first 100 spots are claimed, the platform moves to monthly subscription pricing. Founding stylists are grandfathered in at their one-time rate forever.",
  },
  {
    q: "How do I claim founding stylist access?",
    a: "Create your account at braidbosspro.app. As long as fewer than 100 stylists have signed up, your one-time payment locks in lifetime founding access — there's no separate waitlist or application.",
  },
  {
    q: "What happens when the first 100 spots are gone?",
    a: "Braid Boss Pro transitions to a monthly membership pricing structure for new sign-ups. Founding stylists keep their account exactly as it was — full platform access, no monthly bill, grandfathered in forever.",
  },
  {
    q: "Do founding stylists get future platform upgrades?",
    a: "Yes. Every future feature, integration, automation, and platform upgrade is included for founding stylists at no additional cost. Founding stylists also receive priority access to new tools as they ship.",
  },
];

const FAQS_PRODUCT: Faq[] = [
  {
    q: "Why is Braid Boss Pro built specifically for braiders?",
    a: "Generic salon software wasn't built around how braiders work — variations, hair-included pricing, deposit policies for long appointments, retail storefronts for hair products and edge control. Braid Boss Pro is the business operating system for braid stylists, with workflows + tools designed around the braid chair.",
  },
  {
    q: "Do I need an app-store download?",
    a: "No. Braid Boss Pro is a Progressive Web App (PWA). Open braidbosspro.app in your phone's browser and install it to your home screen — iPhone Safari and Android Chrome both support it natively. Step 6 of the How It Works guide walks you through the install on both phones.",
  },
  {
    q: "Will it work on both iPhone and Android?",
    a: "Yes. Braid Boss Pro is mobile-first and works on iPhone Safari, Android Chrome, and any modern desktop browser. The home-screen install is supported on iOS 16.4+ and recent versions of Android Chrome.",
  },
  {
    q: "Who holds my money?",
    a: "You do. Braid Boss Pro uses Stripe Connect to route every payment directly to your own Stripe account — we never custody your funds. Deposits, balances, and product sales all land in your Stripe dashboard the same day they're charged.",
  },
  {
    q: "What is Stripe Connect?",
    a: "Stripe Connect is Stripe's platform for routing payments to multiple connected accounts. When a client pays a deposit or a customer buys a retail product, the charge happens directly on YOUR Stripe account — not ours. Stripe handles refunds, 1099s, payouts, and disputes for you.",
  },
  {
    q: "Are deposits required?",
    a: "No — deposits are optional per service. You can require a deposit on some services and not others, or run the entire calendar + client + retail workflow without a single deposit. Most stylists require 25–50% deposits to dramatically reduce no-shows.",
  },
  {
    q: "Does my storefront need Stripe Connect?",
    a: "Only if you want to take card payments through Braid Boss Pro. You can list products as external-checkout (the Buy button redirects to your Shopify, Etsy, or other shop) or local-pickup-only without connecting Stripe.",
  },
  {
    q: "Can I import my existing clients?",
    a: "Yes. Go to Settings → Clients → Import and paste names + phone numbers + emails from a spreadsheet. Braid Boss Pro de-duplicates against your existing client list so you don't get doubles.",
  },
  {
    q: "What features are included?",
    a: "Every account gets: branded booking link (/@yourhandle), real-time calendar, deposit collection, Stripe Connect payments, contracts + e-sign, pricing calculator + saved quotes, client management, retail storefront with product variants + inventory, order tracking, reminder automation, mobile dashboard, and PWA install. Founding stylists lock in lifetime access to every current and future platform upgrade with a one-time payment.",
  },
  {
    q: "How long does setup take?",
    a: "Under 10 minutes from sign-up to a shareable booking link. The How It Works page walks you through the five-step setup checklist — add services, set availability, connect Stripe, share your link, install on your phone.",
  },
];

export default function FaqPage() {
  // FAQPage JSON-LD for rich-snippet eligibility on Google + Bing.
  // Keep mainEntity in lockstep with the rendered <Question/>s
  // below — both lists derive from the same Faq objects.
  const allFaqs = [...FAQS_FOUNDING, ...FAQS_PRODUCT];
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: allFaqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: f.a,
      },
    })),
  };

  return (
    <MarketingShell>
      {/* Structured data — emitted as an inline <script> in the
          server-rendered HTML so crawlers see it on first load. */}
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <MarketingHero
        eyebrow="Frequently asked"
        title={
          <>
            Common questions,{" "}
            <em
              style={{
                fontStyle: "italic",
                background: "linear-gradient(135deg, #7C3AED 0%, #FF4D6D 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              answered.
            </em>
          </>
        }
        body="Everything stylists ask before signing up — pricing, payments, install, Stripe, deposits, storefront. If something isn't here, send us a note from the support page and we'll add it."
        primaryCta={{ label: "Create my account", href: "/" }}
        secondaryCta={{ label: "See pricing", href: "/pricing" }}
      />

      <Section
        eyebrow="Founding Stylist access"
        title="The first 100 spots."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {FAQS_FOUNDING.map((f) => (
            <Question key={f.q} q={f.q} a={f.a} />
          ))}
        </div>
      </Section>

      <Section
        eyebrow="Product"
        title="How the app works."
        background="#FBFAFD"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {FAQS_PRODUCT.map((f) => (
            <Question key={f.q} q={f.q} a={f.a} />
          ))}
        </div>
      </Section>

      <CtaFooter
        title="The first 100 spots. One-time payment. Lifetime access."
        body="Founding stylists lock in lifetime access at a single one-time payment before Braid Boss Pro transitions to monthly membership pricing."
        primaryCta={{ label: "Claim founding access", href: "/pricing" }}
        secondaryCta={{ label: "See features", href: "/features" }}
      />
    </MarketingShell>
  );
}

const Question = ({ q, a }: { q: string; a: string }) => (
  <details
    className="bbp-reveal bbp-faq"
    style={{
      background: C.paper,
      border: `1px solid ${C.brandBorder}`,
      borderRadius: 16,
      padding: "16px 18px",
      boxShadow: SHADOWS.card,
    }}
  >
    <summary
      style={{
        cursor: "pointer",
        listStyle: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        fontWeight: 700,
        fontSize: 15,
        color: C.ink,
      }}
    >
      <span>{q}</span>
      <ChevronDown
        size={16}
        className="bbp-faq-chevron"
        style={{ color: C.muted, flexShrink: 0, transition: "transform 200ms ease" }}
      />
    </summary>
    <div style={{ marginTop: 10, color: C.coffee, fontSize: 14, lineHeight: 1.6 }}>{a}</div>
    <style>{`
      details.bbp-faq[open] .bbp-faq-chevron { transform: rotate(180deg); }
      details.bbp-faq summary::-webkit-details-marker { display: none; }
    `}</style>
  </details>
);
