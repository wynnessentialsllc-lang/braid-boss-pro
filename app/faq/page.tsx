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
    "Common questions about Braid Boss Pro — the booking + commerce app for braid stylists. 14-day free trial, Stripe Connect, deposits, storefront, PWA install on iPhone + Android.",
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
      "Common questions about Braid Boss Pro — booking, commerce, Stripe Connect, PWA install, 14-day free trial.",
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

const FAQS_PRICING: Faq[] = [
  {
    q: "How much does Braid Boss Pro cost?",
    a: "Braid Boss Pro is $14.99/month with a 14-day free trial — every feature unlocked from day one. There are no contracts, no setup fees, and you can cancel anytime from inside the app.",
  },
  {
    q: "What's included in the free trial?",
    a: "Every feature — unlimited clients and appointments, booking links, deposits, contracts, retail storefront, reminders, marketing tools, analytics. No limits, no locked features. After 14 days you're billed $14.99/month unless you cancel.",
  },
  {
    q: "How do I cancel?",
    a: "From inside the app, go to Account → Manage subscription. That opens the Stripe billing portal where you can cancel in one tap. You'll keep access until the end of your current billing period.",
  },
  {
    q: "Is there a yearly plan?",
    a: "Yes — $149/year (save $30.88 vs paying monthly). You can switch between monthly and annual at sign-up or anytime from the billing portal.",
  },
  {
    q: "I bought Founding Stylist access — what happens to my account?",
    a: "Founding stylists keep full lifetime access at no monthly cost — your account is grandfathered in forever. Nothing changes, and there's nothing you need to do. The new monthly plan only applies to new stylists joining now.",
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
    a: "Every account gets: branded booking link (/@yourhandle), real-time calendar, deposit collection, Stripe Connect payments, contracts + e-sign, pricing calculator + saved quotes, client management, retail storefront with product variants + inventory, order tracking, email + SMS text reminders, mobile dashboard, and PWA install. Every feature is unlocked during the 14-day free trial.",
  },
  {
    q: "Can I text my clients?",
    a: "Yes. Braid Boss Pro can text clients automatically — booking confirmations, a day-before and 2-hour reminder, balance reminders, and a post-visit review request — from a verified number. You switch SMS on in Account → Notifications, clients opt in on your booking page, and texts run on prepaid credits (1 credit = 1 text). Clients can reply STOP to opt out anytime.",
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
  const allFaqs = [...FAQS_PRICING, ...FAQS_PRODUCT];
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
        eyebrow="Pricing & access"
        title="Subscription, trial, and pricing."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {FAQS_PRICING.map((f) => (
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
        title="14 days free. Then $14.99/month. Cancel anytime."
        body="Every feature unlocked from day one. No contracts. The business operating system braiders actually run their chairs with."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
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
