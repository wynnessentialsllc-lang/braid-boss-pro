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
  // Vagaro publishes "as low as 2.29% to 2.6%" at the $23.99 base on
  // their own comparison page. The top of that range is below our 2.9%,
  // so this row goes to them and says so. An earlier version of this
  // page claimed 3.5% from a third-party roundup; that figure was wrong
  // as well as unsourced. Do not quote a Vagaro rate that does not come
  // from Vagaro.
  { feature: "Card processing rate", bbp: { mark: "text", note: "2.9% + 30¢ — Stripe standard" }, them: { mark: "text", note: "2.29%–2.6% published — lower than ours" } },
  // From the merchant-services fine print, quotable verbatim: the free
  // EMV reader carries a 12-month processing commitment and a $150
  // early cancellation fee.
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
  // Vagaro ships a drag-and-drop custom form builder. Marking this
  // "partial — Forms add-on" understated them; the difference is not
  // whether forms exist, it is whether they arrive knowing what a
  // take-down clause is.
  { feature: "Digital contracts + e-signature", bbp: { mark: "yes", note: "Braid templates — allergy, aftercare, take-down" }, them: { mark: "yes", note: "Custom form builder, build your own" } },
  { feature: "Pricing calculator for braid quotes", bbp: { mark: "yes", note: "Hair + travel + tip + add-ons" }, them: { mark: "no" } },
  { feature: "Retail storefront", bbp: { mark: "yes", note: "Variants + inventory" }, them: { mark: "yes", note: "Included" } },
  // Vagaro's own materials say unlimited reminders and email + text
  // campaign automations are all in the $23.99 base. Both of these rows
  // previously marked them down for add-on fees. They are parity rows.
  { feature: "Appointment reminders", bbp: { mark: "yes" }, them: { mark: "yes", note: "Unlimited, included in base" } },
  { feature: "Email + text campaign automation", bbp: { mark: "yes" }, them: { mark: "yes", note: "Included in base; 1,000 emails/mo" } },
  { feature: "24/7 human phone support", bbp: { mark: "no", note: "One person, email — usually same day" }, them: { mark: "yes", note: "Included in base" } },
  { feature: "PWA install — no app store", bbp: { mark: "yes" }, them: { mark: "no", note: "App store download" } },
  { feature: "Public stylist reviews", bbp: { mark: "yes" }, them: { mark: "yes" } },
];

const FAQS: FaqEntry[] = [
  {
    q: "Is Braid Boss Pro cheaper than Vagaro?",
    a: "On subscription, yes, but it is closer than it looks. Braid Boss Pro is $14.99/month flat. Vagaro lists at $30 for one bookable calendar and runs a standing $23.99 promotion, and that base includes more than most people expect — unlimited reminders, email and text campaign automation, loyalty, memberships, inventory and 24/7 phone support. Their published card rate of 2.29%–2.6% is also below our 2.9%. The gap that does widen is per chair: Vagaro charges $10/month for every extra bookable calendar, so seven chairs is $90 for scheduling alone, while ours stays $14.99.",
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
        body="Vagaro is a genuinely strong salon platform — deep back office, 24/7 phone support, and a card rate lower than ours. What it isn't is braid software: nothing in it prices a hair-included quote, varies by length and take-down, or ships a contract with allergy and aftercare clauses. Here's the honest side-by-side, including where they beat us."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See pricing", href: "/pricing" }}
      />

      <Section eyebrow="At a glance" title="The numbers that matter">
        <ComparisonTable competitorName="Vagaro" rows={rows} />
        {/* This callout used to run an add-on ladder — Forms at $10,
            Text Marketing at $20 — and arrive at "$60/month before you
            process a payment". Vagaro's own comparison materials show
            reminders, email and text campaign automation, loyalty,
            memberships, waitlist, inventory and 24/7 phone support all
            included in the $23.99 base, and a custom form builder in the
            product. The ladder was built on a third-party add-on list
            and it overstated. It is gone.

            What survives is narrower and true: per-calendar scaling, the
            reader commitment, and the fact that no amount of Vagaro
            configuration produces braid-specific pricing. Do not rebuild
            a cost ladder here without Vagaro-published add-on prices. */}
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
          <strong style={{ color: C.brandPrimary }}>Vagaro is a lot of software for $23.99.</strong>{" "}
          We are not going to pretend otherwise. Unlimited appointment
          reminders, email and text campaign automation, loyalty points,
          memberships, waitlist, inventory, timecards and 24/7 human phone
          support are all in their base plan. Their published card rate
          runs <strong>2.29%–2.6%</strong>, under our 2.9%. They take{" "}
          <strong>$0 commission</strong> on your bookings and your
          marketplace revenue. If you want a full salon back office and you
          are not specifically a braider, Vagaro is a genuinely good buy and
          we are the wrong tool.
          <br />
          <br />
          Three things still separate us. The first is{" "}
          <strong>what a chair costs</strong>: their base is per bookable
          calendar, so a second stylist is +$10/month and seven chairs is
          $90 for scheduling alone. Ours is $14.99 at every one of those.
          <br />
          <br />
          The second is the card reader. Vagaro&apos;s pricing page says{" "}
          <em>&ldquo;no contract fees, cancellation fees, setup fees&rdquo;</em>{" "}
          — true of the software subscription. The Merchant Services
          agreement is a separate document, and it says the free reader
          carries a <strong>12-month processing commitment</strong> and a{" "}
          <strong>$150 early cancellation fee</strong>. Both statements are
          accurate; they are just not on the same page.
          <br />
          <br />
          The third is the one that does not have a price. Vagaro will
          happily hold an 8-hour appointment — but nothing in it knows what
          hair-included pricing is, prices a quote by length and take-down,
          or ships a contract that already has allergy and aftercare
          clauses in it. That is not an add-on you can buy. It is the whole
          reason this app exists.
          <br />
          <br />
          <span style={{ fontSize: 12.5, opacity: 0.8 }}>
            Figures are Vagaro&apos;s own published materials, including a
            standing promotional rate of $23.99 on the first calendar at
            the time of writing. Pricing is theirs to change — check it
            before deciding. Ours is one number: $14.99/month, every
            feature, no per-calendar fee.
          </span>
        </div>
      </Section>

      <Section eyebrow="Where Vagaro wins" title="Honest take" background="#FBFAFD">
        <p style={{ fontSize: 15.5, lineHeight: 1.7, color: "#3D3447", maxWidth: 720, margin: "0 auto" }}>
          Vagaro wins more of this comparison than any other tool we&apos;ve looked at. Their $23.99 base includes things we would have guessed were add-ons — unlimited reminders, email and text campaign automation, loyalty, memberships, inventory, timecards — plus 24/7 human phone support, free data migration, and a marketplace with tens of millions of clients on it. Their published card rate is lower than ours. They take no commission on your bookings. If you run a multi-service shop doing hair, nails and lashes, or you want a real support line at 9pm on a Saturday, Vagaro is the better product and you should buy it. Where it stops fitting is narrower than we used to claim. The base is per bookable calendar, so growth costs $10 a chair. The free card reader quietly commits you to twelve months of their processing. And the appointment model is a 60-minute salon visit — nothing in it understands hair-included pricing, a quote that varies by length and take-down, or a contract that needs allergy and aftercare clauses before an 8-hour install. If you are a braider, that last one is the whole job, and it is not something Vagaro sells at any tier.
        </p>
      </Section>

      <Section eyebrow="Where Braid Boss Pro wins" title="Built around your chair">
        <p style={{ fontSize: 15.5, lineHeight: 1.7, color: "#3D3447", maxWidth: 720, margin: "0 auto" }}>
          Every feature in Braid Boss Pro starts from how braiders actually work. Service variations for take-down + length + hair type. Hair-included or hair-billed pricing per style. Long-appointment deposit logic that respects realistic timeline windows. A /@handle booking link that feels like Linktree, not a clinic intake form. Stripe Connect so payouts land in YOUR own Stripe account same-day. Contracts built for natural hair work, including allergy and aftercare clauses. And it&apos;s $14.99/month flat, with no per-calendar charge when you add a chair.
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
