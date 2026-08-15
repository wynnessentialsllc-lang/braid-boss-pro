import type { Metadata } from "next";
import {
  MarketingShell,
  MarketingHero,
  Section,
  CtaFooter,
} from "../../components/marketing/MarketingShell";
import { ComparisonTable, type ComparisonRow } from "../../components/marketing/ComparisonTable";
import { FaqAccordion } from "../../components/marketing/FeaturePageKit";
import CompareSchema from "../../components/marketing/CompareSchema";
import { type FaqEntry } from "../../components/marketing/FeatureSchema";
import { C } from "../../components/marketing/tokens";

export const metadata: Metadata = {
  title: "Braid Boss Pro vs Square Appointments · Which is better for braiders?",
  description:
    "Side-by-side comparison of Braid Boss Pro and Square Appointments for braid stylists. Pricing, deposits, contracts, retail, and braid-specific workflow.",
  alternates: { canonical: "/compare/braid-boss-pro-vs-square-appointments" },
  openGraph: {
    title: "Braid Boss Pro vs Square Appointments for braiders",
    description: "Side-by-side comparison for braid stylists choosing between Braid Boss Pro and Square Appointments.",
    url: "/compare/braid-boss-pro-vs-square-appointments",
    type: "article",
  },
};

const rows: ComparisonRow[] = [
  { feature: "Monthly price (1 stylist)", bbp: { mark: "text", note: "$14.99" }, them: { mark: "text", note: "$0 Free · $49 Plus · $149 Premium" } },
  // The row that matters most: a booking deposit is an online payment, and
  // Square's free tier prices those 0.4% above Stripe's standard rate.
  { feature: "Online rate (deposits)", bbp: { mark: "text", note: "2.9% + 30¢ — Stripe standard" }, them: { mark: "text", note: "3.3% + 30¢ on Free; 2.9% on Plus ($49/mo per location)" } },
  { feature: "Free trial", bbp: { mark: "yes", note: "30 days, every feature" }, them: { mark: "no", note: "None on paid plans" } },
  { feature: "Team management", bbp: { mark: "yes", note: "Included" }, them: { mark: "partial", note: "Limited on Free; Plus is $49/mo per location" } },
  { feature: "Built specifically for braiders", bbp: { mark: "yes", note: "Hair-included pricing, long appointments, allergy/aftercare" }, them: { mark: "no", note: "Generic appointment software" } },
  { feature: "Stripe Connect (you own payouts)", bbp: { mark: "yes" }, them: { mark: "no", note: "Square processing only" } },
  { feature: "Pricing calculator for braid quotes", bbp: { mark: "yes" }, them: { mark: "no" } },
  { feature: "Digital contracts + e-signature", bbp: { mark: "yes", note: "Braid-specific templates — allergy, aftercare, take-down" }, them: { mark: "yes" } },
  // Square Free sends a contract but cannot require it to be signed, and
  // custom fields are gated the same way. Enforcement is the thing that
  // matters to a braider, and it starts at Plus.
  { feature: "Require a signature before the appointment", bbp: { mark: "yes" }, them: { mark: "partial", note: "Not on Free; starts at Plus ($49/mo)" } },
  { feature: "Custom contract fields", bbp: { mark: "yes" }, them: { mark: "partial", note: "Not on Free; starts at Plus ($49/mo)" } },
  { feature: "Branded /@handle booking link", bbp: { mark: "yes" }, them: { mark: "partial", note: "square.site URL" } },
  { feature: "Retail storefront", bbp: { mark: "yes", note: "Variants + inventory" }, them: { mark: "yes", note: "Strong retail tools" } },
  { feature: "SMS text marketing", bbp: { mark: "yes", note: "Prepaid credits, no monthly fee" }, them: { mark: "no", note: "Not available on Free; Plus has 500 then 3¢/text" } },
  { feature: "Marketing automation", bbp: { mark: "yes" }, them: { mark: "partial", note: "Starts at Plus ($49/mo)" } },
  { feature: "PWA install — no app store", bbp: { mark: "yes" }, them: { mark: "no" } },
];

const FAQS: FaqEntry[] = [
  {
    q: "Square Appointments is free — is Braid Boss Pro still worth $14.99/month?",
    a: "Square's free tier looks cheaper until you price the whole job. It charges 3.3% + 30¢ on online payments against our 2.9% + 30¢, text marketing is not available on it at all, and marketing and full team management start at Plus — $49/month per location, with no free trial. Braid Boss Pro includes reminders, marketing, contracts, retail, analytics, and a braid pricing calculator in one $14.99 flat price.",
  },
  {
    q: "Is Braid Boss Pro or Square Appointments better for braiders?",
    a: "Square Appointments is generic appointment and retail software tuned for quick chair turnover. Braid Boss Pro is built for braid work — hair-included vs hair-billed pricing, variations like length and take-down, long-appointment deposit windows, and allergy/aftercare contract clauses.",
  },
  {
    q: "How does Braid Boss Pro's price compare to Square's plans?",
    a: "Braid Boss Pro is a flat $14.99/month. Square prices per location: Free at $0, Plus at $49/month per location, Premium at $149/month per location. Full team management, marketing, and the lower 2.9% online rate all start at Plus, and Square runs no free trial on its paid plans.",
  },
  {
    q: "How do payments and payouts compare?",
    a: "Braid Boss Pro uses Stripe Connect, so you own your Stripe account and payouts land there, usually same-day. Square keeps processing inside its own ecosystem. On rate, Square's free plan charges 3.3% + 30¢ for online payments — a booking deposit is an online payment — against Stripe's standard 2.9% + 30¢. Square matches 2.9% on Plus at $49/month per location.",
  },
  {
    q: "Does Braid Boss Pro have a retail storefront like Square?",
    a: "Yes. Braid Boss Pro includes a retail storefront with product variants and inventory so you can sell hair, edge control, and aftercare alongside your services. Square also has strong retail tools, especially with its hardware — but those live behind Square's paid stack rather than in one flat braider-focused price.",
  },
];

export default function VsSquarePage() {
  return (
    <MarketingShell>
      <CompareSchema
        path="/compare/braid-boss-pro-vs-square-appointments"
        breadcrumbName="Braid Boss Pro vs Square Appointments"
        faqs={FAQS}
      />
      <MarketingHero
        eyebrow="Comparison"
        title={
          <>
            Braid Boss Pro vs Square Appointments <em style={{ fontStyle: "italic", background: "linear-gradient(135deg, #7C3AED 0%, #FF4D6D 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>for braid stylists.</em>
          </>
        }
        body="Square Appointments has a free tier — but it prices online payments at 3.3% + 30¢ where we run on Stripe's 2.9%, text marketing isn't available on that plan at all, and the system is built around quick clinical appointments rather than 8-hour braid installs with deposit policies and hair-included pricing. Here's the side-by-side."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See pricing", href: "/pricing" }}
      />

      <Section eyebrow="At a glance" title="The numbers that matter">
        <ComparisonTable competitorName="Square Appointments" rows={rows} />
        {/* Figures verified against Square's own published plan comparison
            on squareup.com. The load-bearing one is the online rate: a
            booking deposit is an online payment, and Square's free tier
            prices those 0.4% above Stripe's standard rate. The "Online
            API" caveat below is deliberate — Square does publish 2.9% for
            API-taken payments on every tier, and omitting that would be
            the kind of selective quoting this page criticises. */}
        <div
          style={{
            marginTop: 22,
            padding: 18,
            background: "#FBFAFD",
            border: `1px dashed ${C.brandBorder}`,
            borderRadius: 18,
            color: C.coffee,
            fontSize: 14,
            lineHeight: 1.6,
          }}
        >
          <strong style={{ color: C.brandPrimary }}>Free is not the same as cheaper.</strong>{" "}
          Square&apos;s free tier has no monthly fee, and it will take a
          deposit — but it prices online payments at{" "}
          <strong>3.3% + 30¢</strong>, and a booking deposit is an online
          payment. Braid Boss Pro runs on Stripe&apos;s standard{" "}
          <strong>2.9% + 30¢</strong>. On a $180 deposit that is 72¢ more,
          every time, on Square.
          <br />
          <br />
          To match our rate you need Square Plus at{" "}
          <strong>$49/month</strong> — which is also where team management
          and marketing features start. That is more than three times
          $14.99, and Square runs no free trial on its paid plans.
          <br />
          <br />
          The crossover is about <strong>$45,000 a year</strong> in online
          payments, roughly $3,750 a month. Above that, the 0.4% rate
          difference alone covers our subscription and Braid Boss Pro costs
          you less than Square&apos;s free plan outright.
          <br />
          <br />
          Some of it you cannot buy on Square at any price: a pricing
          calculator that understands hair-included quotes, braiding-hair
          inventory by color and length, aftercare guides, or long-appointment
          deposit windows.
          <br />
          <br />
          <span style={{ fontSize: 12.5, opacity: 0.8 }}>
            For completeness: Square publishes a separate 2.9% + 30¢
            &ldquo;Online API&rdquo; rate on every tier, for payments taken
            through their developer API rather than a hosted checkout. The
            3.3% above is their listed Online rate on Square Free. Pricing
            is theirs to change — check it before deciding. Ours is one
            number: $14.99/month, every feature, no per-location fee.
          </span>
        </div>
      </Section>

      <Section eyebrow="Where Square wins" title="Honest take" background="#FBFAFD">
        <p style={{ fontSize: 15.5, lineHeight: 1.7, color: "#3D3447", maxWidth: 720, margin: "0 auto" }}>
          Square&apos;s strongest move is its hardware ecosystem: tap-to-pay readers, registers, retail terminals — all of it integrates seamlessly if you have a brick-and-mortar studio doing both services and physical product sales. The free tier looks attractive on paper, and it does more than people expect — it takes deposits, and it sends contracts. What it will not do on the free plan is require the client to actually sign one — that starts at Plus. Nor does it match the rate: 3.3% + 30¢ on online payments against Stripe&apos;s standard 2.9%. Text marketing is not available on it at all, and marketing plus full team management start at Plus, $49/month per location, with no free trial to test it on. And the appointment defaults are tuned for a quick chair turnover, not braiders.
        </p>
      </Section>

      <Section eyebrow="Where Braid Boss Pro wins" title="Built for braid work">
        <p style={{ fontSize: 15.5, lineHeight: 1.7, color: "#3D3447", maxWidth: 720, margin: "0 auto" }}>
          Braid Boss Pro is $14.99/month all-in — reminders, marketing, contracts, retail storefront, analytics, and pricing calculator are all included from day one. The data model understands hair-included vs hair-billed pricing, variations like length + take-down + parting, and long-appointment deposit windows. Stripe Connect lets you own your payouts directly. A /@handle booking link feels like Linktree, not a Square sub-site. And no per-staff fees if you grow to a small team.
        </p>
      </Section>

      <Section eyebrow="FAQ" title="Square Appointments vs Braid Boss Pro, answered." background="#FBFAFD">
        <FaqAccordion items={FAQS} />
      </Section>

      <CtaFooter
        title="Less than Square. Built around braid work."
        body="$14.99/month, all features included. 30-day free trial. Cancel anytime."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See features", href: "/features" }}
      />
    </MarketingShell>
  );
}
