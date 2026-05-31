import type { Metadata } from "next";
import {
  MarketingShell,
  MarketingHero,
  Section,
  CtaFooter,
} from "../../components/marketing/MarketingShell";
import { ComparisonTable, type ComparisonRow } from "../../components/marketing/ComparisonTable";

export const metadata: Metadata = {
  title: "Braid Boss Pro vs Square Appointments · Which is better for braiders?",
  description:
    "Side-by-side comparison of Braid Boss Pro and Square Appointments for braid stylists. Pricing, deposits, contracts, retail, and braid-specific workflow.",
  alternates: { canonical: "/compare/braid-boss-pro-vs-square-appointments" },
  keywords: [
    "Braid Boss Pro vs Square Appointments",
    "Square Appointments for braiders",
    "Square Appointments alternative",
    "booking app for braid stylists",
    "Square fees salon",
  ],
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

export default function VsSquarePage() {
  return (
    <MarketingShell>
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

      <CtaFooter
        title="Less than Square. Built around braid work."
        body="$14.99/month, all features included. 14-day free trial. Cancel anytime."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See features", href: "/features" }}
      />
    </MarketingShell>
  );
}
