import type { Metadata } from "next";
import {
  MarketingShell,
  MarketingHero,
  Section,
  CtaFooter,
} from "../../components/marketing/MarketingShell";
import { FeatureCard, FeatureGrid } from "../../components/marketing/FeatureCard";
import {
  Breadcrumbs,
  CheckList,
  FaqAccordion,
  RelatedFeatures,
  GradientText,
} from "../../components/marketing/FeaturePageKit";
import FeatureSchema, { type FaqEntry } from "../../components/marketing/FeatureSchema";
import { relatedFeaturePages, featurePath } from "../../lib/feature-pages";
import { Layers, Coins, Repeat, XCircle, Globe } from "lucide-react";

const SLUG = "memberships-and-packages";
const PATH = featurePath(SLUG);

export const metadata: Metadata = {
  title: "Memberships & Packages for Braiders · Braid Boss Pro",
  description:
    "Sell prepaid visit bundles, credit packages, and recurring monthly or yearly memberships with subscription billing, self-service cancellation, and public buy pages. Built for braiders.",
  alternates: { canonical: PATH },
  keywords: [
    "braider memberships",
    "prepaid hair packages",
    "salon membership software",
    "prepaid visit bundles for braiders",
  ],
  openGraph: {
    title: "Memberships & Packages for Braiders · Braid Boss Pro",
    description:
      "Prepaid visit bundles, credit packages, and recurring memberships with self-service cancellation and public buy pages.",
    url: PATH,
    siteName: "Braid Boss Pro",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Memberships & Packages for Braiders · Braid Boss Pro",
    description: "Prepaid packages and recurring memberships built for braiders.",
  },
};

const FAQS: FaqEntry[] = [
  {
    q: "What's the difference between packages and memberships?",
    a: "Packages are prepaid — a client buys a bundle of visits or a block of credits up front and draws them down over time. Memberships are recurring — a client is billed monthly or yearly for ongoing access. Braid Boss Pro supports both.",
  },
  {
    q: "How do prepaid visit bundles work?",
    a: "A client buys a bundle of visits or credits in advance, and each appointment draws from the balance. It locks in repeat business and gives you revenue up front instead of one visit at a time.",
  },
  {
    q: "Can clients buy a membership or package on their own?",
    a: "Yes. Public buy pages let clients purchase a package or start a membership themselves, so you can share a link and let them check out without back-and-forth.",
  },
  {
    q: "How is recurring billing handled?",
    a: "Recurring memberships are billed through subscription billing on Stripe, so monthly and yearly charges run automatically and the money lands in your own account.",
  },
  {
    q: "Can members cancel themselves?",
    a: "Yes. Self-service cancellation lets members manage and cancel their own membership, so you aren't fielding cancellation requests by text.",
  },
  {
    q: "Why offer memberships as a braider?",
    a: "Prepaid packages and memberships smooth out your income, lock in loyal clients, and reduce gaps in your calendar — turning one-off appointments into a predictable base of repeat business.",
  },
];

export default function MembershipsPage() {
  return (
    <MarketingShell>
      <FeatureSchema
        path={PATH}
        breadcrumbName="Memberships & Packages"
        faqs={FAQS}
        software={{
          name: "Braid Boss Pro — Memberships & Packages",
          description:
            "Prepaid packages and recurring memberships for braiders: prepaid visit bundles, credit packages, monthly and yearly memberships, subscription billing, self-service cancellation, and public buy pages.",
          featureList: [
            "Prepaid visit bundles",
            "Credit packages",
            "Monthly and yearly memberships",
            "Subscription billing",
            "Self-service cancellation",
            "Public buy pages",
          ],
        }}
      />
      <Breadcrumbs
        trail={[
          { label: "Home", href: "/" },
          { label: "Features", href: "/features" },
          { label: "Memberships & packages" },
        ]}
      />

      <MarketingHero
        eyebrow="Memberships & packages"
        title={
          <>
            Predictable income, <GradientText>loyal clients.</GradientText>
          </>
        }
        body="Sell prepaid visit bundles and credit packages, or run recurring monthly and yearly memberships with subscription billing. Public buy pages and self-service cancellation mean clients handle it themselves — and your calendar fills with repeat business."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See pricing", href: "/pricing" }}
      />

      <Section
        eyebrow="Prepaid"
        title="Get paid up front, fill your calendar."
        intro="Bundles and credits give you revenue in advance and a reason for clients to keep coming back."
      >
        <FeatureGrid>
          <FeatureCard
            tone="primary"
            icon={<Layers size={22} />}
            title="Prepaid visit bundles"
            body="Sell a block of visits up front that clients draw down over time — revenue now, repeat appointments locked in."
            delay={0}
          />
          <FeatureCard
            tone="secondary"
            icon={<Coins size={22} />}
            title="Credit packages"
            body="Offer credit packages clients buy in advance and apply toward services, smoothing your income across the month."
            delay={100}
          />
          <FeatureCard
            tone="primary"
            icon={<Globe size={22} />}
            title="Public buy pages"
            body="Share a link and let clients purchase a package or start a membership on their own — no back-and-forth required."
            delay={200}
          />
        </FeatureGrid>
      </Section>

      <Section
        eyebrow="Recurring"
        title="Memberships that bill themselves."
        background="#FBFAFD"
      >
        <FeatureGrid>
          <FeatureCard
            tone="soft-c"
            icon={<Repeat size={22} />}
            title="Monthly & yearly memberships"
            body="Run recurring memberships billed monthly or yearly through Stripe subscription billing, with charges that run automatically."
          />
          <FeatureCard
            tone="primary"
            icon={<XCircle size={22} />}
            title="Self-service cancellation"
            body="Members manage and cancel their own membership, so cancellation requests don't land in your texts."
            delay={100}
          />
        </FeatureGrid>
      </Section>

      <Section eyebrow="Everything in this feature" title="What's included with memberships & packages.">
        <CheckList
          items={[
            "Prepaid visit bundles",
            "Credit packages",
            "Monthly and yearly memberships",
            "Subscription billing",
            "Self-service cancellation",
            "Public buy pages",
          ]}
        />
      </Section>

      <Section eyebrow="FAQ" title="Membership & package questions, answered.">
        <FaqAccordion items={FAQS} />
      </Section>

      <Section eyebrow="Keep exploring" title="Related features" background="#FBFAFD">
        <RelatedFeatures pages={relatedFeaturePages(SLUG)} />
      </Section>

      <CtaFooter
        title="Turn one-off visits into recurring revenue."
        body="Start a 14-day free trial — every feature unlocked. Then $14.99/month. No contracts, cancel anytime."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See pricing", href: "/pricing" }}
      />
    </MarketingShell>
  );
}
