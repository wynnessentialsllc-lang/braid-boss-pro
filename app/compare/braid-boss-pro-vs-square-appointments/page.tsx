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
  { feature: "Monthly price (1 stylist)", bbp: { mark: "text", note: "$14.99" }, them: { mark: "text", note: "$0 (free tier) — $29 Plus" } },
  { feature: "Payment processing fees", bbp: { mark: "text", note: "Stripe standard (~2.9% + 30¢)" }, them: { mark: "text", note: "~2.6% + 10¢ (in-person) / 2.9% + 30¢ online" } },
  { feature: "Per-staff fees", bbp: { mark: "no", note: "Flat" }, them: { mark: "yes", note: "$20–35/mo per additional staff" } },
  { feature: "Built specifically for braiders", bbp: { mark: "yes", note: "Hair-included pricing, long appointments, allergy/aftercare" }, them: { mark: "no", note: "Generic appointment software" } },
  { feature: "Stripe Connect (you own payouts)", bbp: { mark: "yes" }, them: { mark: "no", note: "Square processing only" } },
  { feature: "Pricing calculator for braid quotes", bbp: { mark: "yes" }, them: { mark: "no" } },
  { feature: "Digital contracts + e-signature", bbp: { mark: "yes" }, them: { mark: "partial", note: "Forms add-on" } },
  { feature: "Branded /@handle booking link", bbp: { mark: "yes" }, them: { mark: "partial", note: "square.site URL" } },
  { feature: "Retail storefront", bbp: { mark: "yes", note: "Variants + inventory" }, them: { mark: "yes", note: "Strong retail tools" } },
  { feature: "SMS appointment reminders", bbp: { mark: "yes" }, them: { mark: "partial", note: "Paid add-on" } },
  { feature: "Marketing automation", bbp: { mark: "yes" }, them: { mark: "partial", note: "Square Marketing add-on, $15+/mo" } },
  { feature: "PWA install — no app store", bbp: { mark: "yes" }, them: { mark: "no" } },
];

const FAQS: FaqEntry[] = [
  {
    q: "Square Appointments is free — is Braid Boss Pro still worth $14.99/month?",
    a: "Square's free tier looks cheaper until you add the features braiders actually need. SMS reminders, marketing automation, and contracts are all paid add-ons on Square, often $15–40/month combined. Braid Boss Pro includes reminders, marketing, contracts, retail, analytics, and a braid pricing calculator in the single $14.99 flat price.",
  },
  {
    q: "Is Braid Boss Pro or Square Appointments better for braiders?",
    a: "Square Appointments is generic appointment and retail software tuned for quick chair turnover. Braid Boss Pro is built for braid work — hair-included vs hair-billed pricing, variations like length and take-down, long-appointment deposit windows, and allergy/aftercare contract clauses.",
  },
  {
    q: "Does Braid Boss Pro charge per staff member like Square?",
    a: "No. Braid Boss Pro is a flat $14.99/month with no per-staff fees. Square Appointments charges roughly $20–35/month for each additional team member on the paid tiers.",
  },
  {
    q: "How do payments and payouts compare?",
    a: "Braid Boss Pro uses Stripe Connect, so you own your Stripe account and payouts land there, usually same-day. Square keeps payment processing inside the Square ecosystem. Processing rates are similar (~2.9% + 30¢ online), but with Braid Boss Pro the relationship and the money are yours.",
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
        body="Square Appointments has a free tier — but every braider-specific feature (reminders, marketing, contracts) is a paid add-on, and the system is built around quick clinical appointments, not 8-hour braid installs with deposit policies and hair-included pricing. Here's the side-by-side."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See pricing", href: "/pricing" }}
      />

      <Section eyebrow="At a glance" title="The numbers that matter">
        <ComparisonTable competitorName="Square Appointments" rows={rows} />
        {/* The table above prices each add-on separately, which reads as a
            row of small asterisks. This adds them up once, using only the
            figures already in the rows — Plus at $29 and Marketing at
            $15+ — so the total cannot drift from the table above it.
            Deliberately "at least": the SMS and Forms add-ons are real
            costs we do not put a number on. */}
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
          <strong style={{ color: C.brandPrimary }}>Add it up.</strong>{" "}
          Square&apos;s free tier is genuinely free — but the things braiders
          actually ask for are priced separately. Appointments Plus ($29/mo)
          for no-show protection and a custom booking site, Square Marketing
          ($15+/mo) for campaigns, then the SMS and Forms add-ons on top.
          That is <strong>at least $44/month</strong> before per-staff
          charges, against <strong>$14.99</strong> with everything switched
          on from day one.
          <br />
          <br />
          Some of it you cannot buy on Square at any price: a pricing
          calculator that understands hair-included quotes, braiding-hair
          inventory by color and length, aftercare guides, or long-appointment
          deposit windows.
          <br />
          <br />
          <span style={{ fontSize: 12.5, opacity: 0.8 }}>
            Square&apos;s pricing is theirs to change — check their current
            rates before deciding. Ours is one number: $14.99/month, every
            feature, no per-staff fee.
          </span>
        </div>
      </Section>

      <Section eyebrow="Where Square wins" title="Honest take" background="#FBFAFD">
        <p style={{ fontSize: 15.5, lineHeight: 1.7, color: "#3D3447", maxWidth: 720, margin: "0 auto" }}>
          Square&apos;s strongest move is its hardware ecosystem: tap-to-pay readers, registers, retail terminals — all of it integrates seamlessly if you have a brick-and-mortar studio doing both services and physical product sales. The free tier looks attractive on paper. But once you actually need SMS reminders, marketing automation, contracts, or any of the workflow that keeps your book full, you&apos;re bolting on $15–40/month of add-ons that erase the &quot;free&quot; advantage. And the appointment defaults are tuned for a quick chair turnover, not braiders.
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
