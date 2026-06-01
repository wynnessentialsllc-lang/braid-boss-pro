import type { Metadata } from "next";
import {
  MarketingShell,
  MarketingHero,
  Section,
  CtaFooter,
} from "../../components/marketing/MarketingShell";
import { ComparisonTable, type ComparisonRow } from "../../components/marketing/ComparisonTable";

export const metadata: Metadata = {
  title: "Braid Boss Pro vs Vagaro · Which is better for braiders?",
  description:
    "Side-by-side comparison of Braid Boss Pro and Vagaro for braid stylists. Pricing, deposits, contracts, retail, and braider-specific workflow features.",
  alternates: { canonical: "/compare/braid-boss-pro-vs-vagaro" },
  keywords: [
    "Braid Boss Pro vs Vagaro",
    "Vagaro for braiders",
    "best booking app for braiders",
    "Vagaro alternative for braid stylists",
    "salon software for braiders",
  ],
  openGraph: {
    title: "Braid Boss Pro vs Vagaro for braiders",
    description: "Side-by-side comparison for braid stylists choosing between Braid Boss Pro and Vagaro.",
    url: "/compare/braid-boss-pro-vs-vagaro",
    type: "article",
  },
};

const rows: ComparisonRow[] = [
  { feature: "Monthly price", bbp: { mark: "text", note: "$14.99" }, them: { mark: "text", note: "$30+ (per user)" } },
  { feature: "Per-staff fees", bbp: { mark: "no", note: "Flat price" }, them: { mark: "yes", note: "Scales with team" } },
  { feature: "14-day free trial", bbp: { mark: "yes" }, them: { mark: "partial", note: "30-day, requires card" } },
  { feature: "Built specifically for braiders", bbp: { mark: "yes", note: "Braid styles, hair-included pricing, long-appointment deposits" }, them: { mark: "no", note: "General salon software" } },
  { feature: "Branded /@handle booking link", bbp: { mark: "yes" }, them: { mark: "partial", note: "Generic Vagaro URL" } },
  { feature: "Stripe Connect (you own payouts)", bbp: { mark: "yes" }, them: { mark: "no", note: "Vagaro Pay processes" } },
  { feature: "Digital contracts + e-signature", bbp: { mark: "yes", note: "Per-service templates included" }, them: { mark: "partial", note: "Forms add-on" } },
  { feature: "Pricing calculator for braid quotes", bbp: { mark: "yes", note: "Hair + travel + tip + add-ons" }, them: { mark: "no" } },
  { feature: "Retail storefront", bbp: { mark: "yes", note: "Variants + inventory" }, them: { mark: "yes", note: "Included" } },
  { feature: "SMS appointment reminders", bbp: { mark: "yes" }, them: { mark: "partial", note: "Per-message fees on top" } },
  { feature: "Rebooking + retention automation", bbp: { mark: "yes" }, them: { mark: "partial", note: "Marketing add-on" } },
  { feature: "PWA install — no app store", bbp: { mark: "yes" }, them: { mark: "no", note: "App store download" } },
  { feature: "Public stylist reviews", bbp: { mark: "yes" }, them: { mark: "yes" } },
];

export default function VsVagaroPage() {
  return (
    <MarketingShell>
      <MarketingHero
        eyebrow="Comparison"
        title={
          <>
            Braid Boss Pro vs Vagaro <em style={{ fontStyle: "italic", background: "linear-gradient(135deg, #7C3AED 0%, #FF4D6D 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>for braid stylists.</em>
          </>
        }
        body="Vagaro is one of the biggest names in salon booking, but it's built around generic appointments — not the hair-included pricing, long-appointment deposit policies, and creator-economy workflow braid stylists actually use. Here's the side-by-side."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See pricing", href: "/pricing" }}
      />

      <Section eyebrow="At a glance" title="The numbers that matter">
        <ComparisonTable competitorName="Vagaro" rows={rows} />
      </Section>

      <Section eyebrow="Where Vagaro wins" title="Honest take" background="#FBFAFD">
        <p style={{ fontSize: 15.5, lineHeight: 1.7, color: "#3D3447", maxWidth: 720, margin: "0 auto" }}>
          Vagaro is the right pick if you run a multi-chair salon with multiple service providers (hair, nails, skin, lashes) and need one back office for all of it. Its marketplace (&ldquo;Find Beauty Pros&rdquo;) brings in walk-in discovery. The catch: pricing climbs fast with each staff member, and the workflow assumes a 60-minute clinical appointment — not an 8-hour boho knotless install with a $150 hair-included add-on and a 50% deposit. If you&apos;re a solo braider or run a small braid-focused chair, Vagaro is over-built and over-priced for your reality.
        </p>
      </Section>

      <Section eyebrow="Where Braid Boss Pro wins" title="Built around your chair">
        <p style={{ fontSize: 15.5, lineHeight: 1.7, color: "#3D3447", maxWidth: 720, margin: "0 auto" }}>
          Every feature in Braid Boss Pro starts from how braiders actually work. Service variations for take-down + length + hair type. Hair-included or hair-billed pricing per style. Long-appointment deposit logic that respects realistic timeline windows. A /@handle booking link that feels like Linktree, not a clinic intake form. Stripe Connect so payouts land in YOUR own Stripe account same-day. Contracts built for natural hair work, including allergy and aftercare clauses. And it&apos;s $14.99/month flat — less than half of Vagaro&apos;s entry tier, with no per-staff penalty if you add a chair.
        </p>
      </Section>

      <CtaFooter
        title="The braider-first alternative to Vagaro."
        body="Every feature unlocked. 14-day free trial. Then $14.99/month. Cancel anytime."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See features", href: "/features" }}
      />
    </MarketingShell>
  );
}
