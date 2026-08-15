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
  title: "Braid Boss Pro vs Vagaro · Which is better for braiders?",
  description:
    "Side-by-side comparison of Braid Boss Pro and Vagaro for braid stylists. Pricing, deposits, contracts, retail, and braider-specific workflow features.",
  alternates: { canonical: "/compare/braid-boss-pro-vs-vagaro" },
  openGraph: {
    title: "Braid Boss Pro vs Vagaro for braiders",
    description: "Side-by-side comparison for braid stylists choosing between Braid Boss Pro and Vagaro.",
    url: "/compare/braid-boss-pro-vs-vagaro",
    type: "article",
  },
};

const rows: ComparisonRow[] = [
  // Vagaro prices per "bookable calendar", not per user: $30 for the
  // first, +$10 for each additional, which is why 4 calendars lists at
  // $60 and 7+ at $90. The $23.99 is their standing promotional rate on
  // the first calendar — quoting only the $30 would read as inflated to
  // anyone who has actually opened their pricing page.
  { feature: "Monthly price (1 stylist)", bbp: { mark: "text", note: "$14.99" }, them: { mark: "text", note: "$30 list, $23.99 promo — 1 bookable calendar" } },
  { feature: "Cost to add a second chair", bbp: { mark: "text", note: "$14.99 — unchanged" }, them: { mark: "text", note: "+$10/mo per extra calendar" } },
  // A processing-rate row used to sit here, sourced from a third-party
  // pricing roundup. Vagaro does not publish per-transaction rates on
  // its pricing page — they live inside the Merchant Services
  // agreement — so the figure could not be confirmed against them and
  // was removed rather than left standing on one secondary source.
  // Do not re-add it without a Vagaro-published number.
  //
  // What IS published, in the merchant-services fine print: the free
  // EMV reader carries a 12-month processing commitment and a $150
  // early cancellation fee. That is the real lock-in, and it is
  // quotable verbatim.
  { feature: "Free card reader with no strings", bbp: { mark: "text", note: "No hardware, no commitment" }, them: { mark: "no", note: "12-month processing commitment; $150 to leave early" } },
  // Parity row, deliberately. This used to read "14-day free trial" with
  // Vagaro marked "partial — 30-day, requires card", which dinged them
  // for a card requirement we also have (app/api/subscribe/route.ts
  // collects one up front) while their trial was the longer of the two.
  // Now that ours is 30 days, both offers match, so both are marked yes.
  { feature: "30-day free trial", bbp: { mark: "yes", note: "Card required" }, them: { mark: "yes", note: "Card required" } },
  { feature: "Built specifically for braiders", bbp: { mark: "yes", note: "Braid styles, hair-included pricing, long-appointment deposits" }, them: { mark: "no", note: "General salon software" } },
  { feature: "Branded /@handle booking link", bbp: { mark: "yes" }, them: { mark: "partial", note: "Generic Vagaro URL" } },
  { feature: "Stripe Connect (you own payouts)", bbp: { mark: "yes" }, them: { mark: "no", note: "Vagaro Pay processes" } },
  { feature: "Digital contracts + e-signature", bbp: { mark: "yes", note: "Per-service templates included" }, them: { mark: "partial", note: "Forms add-on, $10/mo" } },
  { feature: "Pricing calculator for braid quotes", bbp: { mark: "yes", note: "Hair + travel + tip + add-ons" }, them: { mark: "no" } },
  { feature: "Retail storefront", bbp: { mark: "yes", note: "Variants + inventory" }, them: { mark: "yes", note: "Included" } },
  // Reminders are NOT the paid part — Vagaro includes a base text
  // allowance. It's marketing campaigns beyond that allowance that cost
  // $20/mo. Claiming reminders carry per-message fees was aimed at the
  // wrong feature.
  { feature: "SMS appointment reminders", bbp: { mark: "yes" }, them: { mark: "yes", note: "Base text allowance included" } },
  { feature: "SMS marketing campaigns", bbp: { mark: "yes", note: "Prepaid credits, no monthly fee" }, them: { mark: "partial", note: "Text Marketing add-on, $20/mo" } },
  { feature: "Rebooking + retention automation", bbp: { mark: "yes" }, them: { mark: "partial", note: "Text Marketing add-on, $20/mo" } },
  { feature: "PWA install — no app store", bbp: { mark: "yes" }, them: { mark: "no", note: "Vagaro app download; your own branded app is $100/mo" } },
  { feature: "Public stylist reviews", bbp: { mark: "yes" }, them: { mark: "yes" } },
];

const FAQS: FaqEntry[] = [
  {
    q: "Is Braid Boss Pro cheaper than Vagaro?",
    a: "Yes. Braid Boss Pro is $14.99/month flat, every feature included. Vagaro lists at $30/month for one bookable calendar — $23.99 on their standing promotion — and adds $10/month for each additional calendar, so three chairs is $50 and seven is $90 for scheduling alone. Add the pieces a braider actually needs and it climbs further: Forms for waivers is $10/month and Text Marketing is $20/month, both included in our $14.99.",
  },
  {
    q: "Is Vagaro or Braid Boss Pro better for braiders?",
    a: "Vagaro is broad salon software built for multi-service shops (hair, nails, skin, lashes) and generic 60-minute appointments. Braid Boss Pro is built specifically for braiders — service variations for length and density, hair-included pricing, and long-appointment deposit logic for styles that take all day.",
  },
  {
    q: "Does Braid Boss Pro charge per staff member like Vagaro?",
    a: "No. Braid Boss Pro is one flat $14.99/month price no matter how many stylists you add. Vagaro prices per bookable calendar — $30 for the first and $10 for each one after — so every chair you add raises the bill.",
  },
  {
    q: "Do I own my payouts on Braid Boss Pro?",
    a: "Yes. Braid Boss Pro uses Stripe Connect, so deposits and balance payments land in your own Stripe account, usually same-day, and Braid Boss Pro never holds your funds. Vagaro processes payments through Vagaro Pay on its own schedule.",
  },
  {
    q: "Can I move to Braid Boss Pro if I already use Vagaro?",
    a: "Yes. You can set up your services, booking link, and policies on Braid Boss Pro and run the 30-day free trial alongside your current tools before switching. Your client list stays in your own account and is exportable at any time.",
  },
];

export default function VsVagaroPage() {
  return (
    <MarketingShell>
      <CompareSchema
        path="/compare/braid-boss-pro-vs-vagaro"
        breadcrumbName="Braid Boss Pro vs Vagaro"
        faqs={FAQS}
      />
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
        {/* The base price is not the price. Vagaro unbundles aggressively,
            and the add-ons a braider would actually reach for — waivers,
            marketing, a website — stack on top of a per-calendar base.
            Figures are Vagaro's published add-on rates; they are theirs to
            change, hence the caveat line at the bottom. */}
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
          <strong style={{ color: C.brandPrimary }}>The base price is not the price.</strong>{" "}
          Vagaro is upfront about this — their pricing page says{" "}
          <em>&ldquo;only pay for what you need.&rdquo;</em> The catch for a
          braider is that you need most of it. The entry tier covers
          scheduling; the rest is sold separately:{" "}
          <strong>Forms</strong> for waivers and intake at $10/mo,{" "}
          <strong>Text Marketing</strong> at $20/mo, <strong>MySite</strong>{" "}
          for a branded website at $20/mo, and a{" "}
          <strong>branded app</strong> at $100/mo.
          <br />
          <br />
          A solo braider who wants waivers and marketing is at{" "}
          <strong>$30 + $10 + $20 = $60/month</strong> before a single
          payment is processed. Braid Boss Pro includes contracts,
          marketing, retail, and analytics in the $14.99.
          <br />
          <br />
          And it compounds with team size, because the base is per bookable
          calendar: three chairs is $50/month for scheduling alone, seven is
          $90. Ours stays $14.99 at every one of those.
          <br />
          <br />
          One line worth reading twice before you take the free card
          reader. Vagaro&apos;s pricing page says{" "}
          <em>&ldquo;no contract fees, cancellation fees, setup fees&rdquo;</em>{" "}
          — and for the software subscription, that is true. The Merchant
          Services agreement is a separate document, and it says the reader
          comes with a <strong>12-month processing commitment</strong> and a{" "}
          <strong>$150 early cancellation fee</strong> if you stop before
          then. Both statements are accurate; they just are not on the same
          page.
          <br />
          <br />
          <span style={{ fontSize: 12.5, opacity: 0.8 }}>
            Fair to them on two counts: Vagaro runs a standing promotional
            rate — $23.99 on the first calendar at the time of writing — and
            they take $0 commission on your bookings and marketplace
            revenue, which is more than some competitors can say. Their
            per-transaction processing rates are not published on the
            pricing page, so we do not quote one. Pricing is theirs to
            change; check it before deciding. Ours is one number:
            $14.99/month, every feature, no per-calendar fee.
          </span>
        </div>
      </Section>

      <Section eyebrow="Where Vagaro wins" title="Honest take" background="#FBFAFD">
        <p style={{ fontSize: 15.5, lineHeight: 1.7, color: "#3D3447", maxWidth: 720, margin: "0 auto" }}>
          Vagaro is the right pick if you run a multi-chair salon with multiple service providers (hair, nails, skin, lashes) and need one back office for all of it. Its marketplace (&ldquo;Find Beauty Pros&rdquo;) brings in walk-in discovery, its retail and payroll tooling is genuinely deep, and appointment reminders come with a text allowance rather than a meter. Credit where it is due on two more: Vagaro takes no commission on your bookings or your marketplace revenue, and their support — free data migration, training, 24/7 phone — is better than anything a one-person company can offer. The catch is the shape of the pricing: a base that climbs with every bookable calendar, and the features around scheduling sold one at a time — $10 for waivers, $20 for marketing, $20 for a website, $100 for your own branded app. The workflow also assumes a 60-minute clinical appointment, not an 8-hour boho knotless install with a $150 hair-included add-on and a 50% deposit. If you&apos;re a solo braider or run a small braid-focused chair, Vagaro is over-built and over-priced for your reality.
        </p>
      </Section>

      <Section eyebrow="Where Braid Boss Pro wins" title="Built around your chair">
        <p style={{ fontSize: 15.5, lineHeight: 1.7, color: "#3D3447", maxWidth: 720, margin: "0 auto" }}>
          Every feature in Braid Boss Pro starts from how braiders actually work. Service variations for take-down + length + hair type. Hair-included or hair-billed pricing per style. Long-appointment deposit logic that respects realistic timeline windows. A /@handle booking link that feels like Linktree, not a clinic intake form. Stripe Connect so payouts land in YOUR own Stripe account same-day. Contracts built for natural hair work, including allergy and aftercare clauses. And it&apos;s $14.99/month flat — less than half of Vagaro&apos;s entry tier, with no per-staff penalty if you add a chair.
        </p>
      </Section>

      <Section eyebrow="FAQ" title="Vagaro vs Braid Boss Pro, answered." background="#FBFAFD">
        <FaqAccordion items={FAQS} />
      </Section>

      <CtaFooter
        title="The braider-first alternative to Vagaro."
        body="Every feature unlocked. 30-day free trial. Then $14.99/month. Cancel anytime."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See features", href: "/features" }}
      />
    </MarketingShell>
  );
}
