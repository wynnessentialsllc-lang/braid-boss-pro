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
  title: "Braid Boss Pro vs StyleSeat · Which is better for braiders?",
  description:
    "Side-by-side comparison of Braid Boss Pro and StyleSeat for braid stylists. Pricing, deposits, retail storefront, contracts, and creator-economy workflow.",
  alternates: { canonical: "/compare/braid-boss-pro-vs-styleseat" },
  openGraph: {
    title: "Braid Boss Pro vs StyleSeat for braiders",
    description: "Side-by-side comparison for braid stylists choosing between Braid Boss Pro and StyleSeat.",
    url: "/compare/braid-boss-pro-vs-styleseat",
    type: "article",
  },
};

const rows: ComparisonRow[] = [
  // Every figure here is from StyleSeat's own published pricing page.
  // This table previously claimed "$1 per new client" and a booking fee
  // "up to $7.99" — neither exists. The real per-new-client charge is
  // far larger and works differently (a percentage of the first
  // appointment, not a flat dollar), and the real client booking fee is
  // $2.35. Both were invented and both made StyleSeat look worse than
  // it is, which is the one direction a comparison page cannot afford
  // to be wrong in.
  { feature: "Monthly price", bbp: { mark: "text", note: "$14.99" }, them: { mark: "text", note: "$35 — single tier" } },
  { feature: "Booking fee charged to your client", bbp: { mark: "no", note: "Your client pays your price" }, them: { mark: "yes", note: "$2.35 at time of booking" } },
  // Optional and opt-out-able — but it is how the marketplace pipeline
  // is paid for, so a stylist who is there for discovery is paying it.
  { feature: "Fee on marketplace-sourced new clients", bbp: { mark: "no" }, them: { mark: "yes", note: "30% of first appointment, $50 cap — optional" } },
  // StyleSeat is cheaper than us on card-on-file rate. Saying so costs
  // nothing and is the reason the rest of the page can be trusted.
  { feature: "Online rate (deposits)", bbp: { mark: "text", note: "2.9% + 30¢ — Stripe standard" }, them: { mark: "text", note: "2.6% + 30¢ — lower than ours" } },
  { feature: "You own your client list", bbp: { mark: "yes", note: "Stored in your account, exportable any time" }, them: { mark: "partial", note: "Locked behind StyleSeat" } },
  { feature: "Stripe Connect (you own payouts)", bbp: { mark: "yes", note: "Same-day to your Stripe account" }, them: { mark: "no", note: "StyleSeat custodies funds" } },
  { feature: "Branded /@handle booking link", bbp: { mark: "yes" }, them: { mark: "partial", note: "styleseat.com/yourname" } },
  // StyleSeat does have client intake forms. What it does not appear to
  // have is a signed contract — so the row is "partial", not "no".
  { feature: "Digital contracts + e-signature", bbp: { mark: "yes" }, them: { mark: "partial", note: "Intake forms, but no signed contract" } },
  { feature: "Custom website", bbp: { mark: "yes", note: "Included" }, them: { mark: "partial", note: "$10/mo add-on" } },
  { feature: "Pricing calculator for braid quotes", bbp: { mark: "yes" }, them: { mark: "no" } },
  { feature: "Retail storefront", bbp: { mark: "yes", note: "Variants + inventory + Stripe checkout" }, them: { mark: "no" } },
  { feature: "SMS appointment reminders", bbp: { mark: "yes" }, them: { mark: "yes" } },
  { feature: "Marketing automation (rebook, win-back, birthday)", bbp: { mark: "yes" }, them: { mark: "partial", note: "Basic only" } },
  { feature: "Public stylist reviews", bbp: { mark: "yes" }, them: { mark: "yes" } },
  { feature: "PWA install — no app store", bbp: { mark: "yes" }, them: { mark: "no", note: "App store required" } },
];

const FAQS: FaqEntry[] = [
  {
    q: "Is Braid Boss Pro cheaper than StyleSeat?",
    a: "On subscription, yes — $14.99/month against StyleSeat's $35, which is about $240 a year. StyleSeat gives some of that back with a lower card-on-file rate, 2.6% + 30¢ against our 2.9% + 30¢, worth roughly $78 a year on $25,000 of online payments. The bigger number is the marketplace fee: 30% of a new client's first appointment, capped at $50, so a $180 install booked through StyleSeat costs you $50. It is optional and can be switched off, but it is what the discovery pipeline costs.",
  },
  {
    q: "Can I keep my clients if I switch from StyleSeat to Braid Boss Pro?",
    a: "Yes. On Braid Boss Pro your client list lives in your own account and is exportable any time. You are not locked into a marketplace, and nothing is added to your client's total at booking.",
  },
  {
    q: "Who holds my money — do I get paid directly?",
    a: "With Braid Boss Pro you connect your own Stripe account through Stripe Connect, so deposits and balance payments land in your account, usually same-day. Braid Boss Pro never custodies your funds. StyleSeat processes and holds payouts on its own schedule.",
  },
  {
    q: "Does StyleSeat have deposits, contracts, and a retail storefront like Braid Boss Pro?",
    a: "Braid Boss Pro includes deposit collection, digital contracts with e-signature, a pricing calculator for hair-included braid quotes, and a retail storefront with variants and inventory — all in the flat price. StyleSeat collects deposits and has client intake forms, but not a signed contract, a braid-specific quote calculator, or a product storefront, and its custom website is a $10/month add-on.",
  },
  {
    q: "Is StyleSeat or Braid Boss Pro better for braiders specifically?",
    a: "StyleSeat is generalist salon software with a built-in consumer marketplace, which helps brand-new stylists get discovered. Braid Boss Pro is purpose-built for braiders — service variations for length and density, long-appointment deposit logic, and hair-included pricing — at a lower flat price with full client ownership.",
  },
];

export default function VsStyleSeatPage() {
  return (
    <MarketingShell>
      <CompareSchema
        path="/compare/braid-boss-pro-vs-styleseat"
        breadcrumbName="Braid Boss Pro vs StyleSeat"
        faqs={FAQS}
      />
      <MarketingHero
        eyebrow="Comparison"
        title={
          <>
            Braid Boss Pro vs StyleSeat <em style={{ fontStyle: "italic", background: "linear-gradient(135deg, #7C3AED 0%, #FF4D6D 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>for braid stylists.</em>
          </>
        }
        body="StyleSeat is one of the most familiar booking apps in the industry, and its marketplace really does bring in new clients. It also costs $35/month, adds a $2.35 booking fee your client pays, and takes 30% of a marketplace-sourced client's first appointment. Braid Boss Pro is $14.99 flat, nothing added to your client's total, and you keep your list and your payouts."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See pricing", href: "/pricing" }}
      />

      <Section eyebrow="At a glance" title="The numbers that matter">
        <ComparisonTable competitorName="StyleSeat" rows={rows} />
        {/* The subscription gap is the small part of this. The
            new-client fee is the big one, and it is the honest reason a
            busy braider leaves. The processing-rate concession is
            deliberate: StyleSeat beats us there, and a page that hides
            that is not worth reading. Figures are StyleSeat's own
            published pricing; theirs to change. */}
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
          <strong style={{ color: C.brandPrimary }}>Where the money actually goes.</strong>{" "}
          The subscription gap is the small part. StyleSeat is{" "}
          <strong>$420 a year</strong> against our{" "}
          <strong>$179.88</strong> — about $240. Their lower card-on-file
          rate gives some of that back: on roughly $25,000 of online
          payments a year, 0.3% is about $78. Call it{" "}
          <strong>$162 a year</strong> on the two together.
          <br />
          <br />
          The new-client fee is the part that moves real money.{" "}
          <strong>30% of the first appointment, capped at $50</strong> — so
          a $180 knotless install booked through the marketplace costs you
          $50. Three of those in a year is another $150, and now the gap
          has roughly doubled.
          <br />
          <br />
          That is a fair price for a lead if you needed the lead. It is a
          bad price for a client who would have found you on Instagram
          anyway.
          <br />
          <br />
          <span style={{ fontSize: 12.5, opacity: 0.8 }}>
            Being straight about it: StyleSeat&apos;s card-on-file rate of
            2.6% + 30¢ is lower than our 2.9% + 30¢, and their marketplace
            is something we do not have an answer to. New Client
            Connection and Smart Pricing are both optional and can be
            switched off. Pricing is theirs to change — check it before
            deciding.
          </span>
        </div>
      </Section>

      <Section eyebrow="Where StyleSeat wins" title="Honest take" background="#FBFAFD">
        <p style={{ fontSize: 15.5, lineHeight: 1.7, color: "#3D3447", maxWidth: 720, margin: "0 auto" }}>
          StyleSeat&apos;s biggest advantage is its consumer marketplace — a lot of clients search styleseat.com to find a stylist nearby, so there&apos;s discovery built in. If you&apos;re brand new with zero following, that pipeline can fill your book in week one, and no amount of flat-rate software substitutes for it. StyleSeat also processes card-on-file payments at 2.6% + 30¢, which is genuinely cheaper than our 2.9%. The trade-off is what the pipeline costs: a $2.35 fee added to your client&apos;s total at booking, 30% of the first appointment when the marketplace sends you someone new, and payouts StyleSeat holds rather than ones landing in your own Stripe account. That new-client fee is optional and you can switch it off — but switching it off is switching off the reason most stylists are there. Once your book is full of clients who already know your name, you&apos;re paying marketplace prices for a marketplace you&apos;ve stopped needing.
        </p>
      </Section>

      <Section eyebrow="Where Braid Boss Pro wins" title="You own everything">
        <p style={{ fontSize: 15.5, lineHeight: 1.7, color: "#3D3447", maxWidth: 720, margin: "0 auto" }}>
          With Braid Boss Pro, your clients are YOUR clients — exportable any time, no commission when one books their first appointment, and nothing added to what they pay at checkout. Your booking link is /@yourhandle, not a sub-page of someone else&apos;s domain. Stripe Connect means deposits and balance payments land directly in your own Stripe account same-day; we never custody your funds. Pricing calculator + saved quotes for hair-included braid work, digital contracts with e-signature, retail storefront for selling hair products + edge control alongside your services, and a real analytics dashboard. All for less than half of what StyleSeat charges before the per-client fees even start.
        </p>
      </Section>

      <Section eyebrow="FAQ" title="StyleSeat vs Braid Boss Pro, answered." background="#FBFAFD">
        <FaqAccordion items={FAQS} />
      </Section>

      <CtaFooter
        title="Keep your clients. Keep your money."
        body="The StyleSeat alternative built specifically for braiders. 30-day free trial, then $14.99/month flat."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See features", href: "/features" }}
      />
    </MarketingShell>
  );
}
