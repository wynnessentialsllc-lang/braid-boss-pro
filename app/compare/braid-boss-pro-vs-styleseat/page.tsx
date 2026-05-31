import type { Metadata } from "next";
import {
  MarketingShell,
  MarketingHero,
  Section,
  CtaFooter,
} from "../../components/marketing/MarketingShell";
import { ComparisonTable, type ComparisonRow } from "../../components/marketing/ComparisonTable";

export const metadata: Metadata = {
  title: "Braid Boss Pro vs StyleSeat · Which is better for braiders?",
  description:
    "Side-by-side comparison of Braid Boss Pro and StyleSeat for braid stylists. Pricing, deposits, retail storefront, contracts, and creator-economy workflow.",
  alternates: { canonical: "/compare/braid-boss-pro-vs-styleseat" },
  keywords: [
    "Braid Boss Pro vs StyleSeat",
    "StyleSeat for braiders",
    "StyleSeat alternative",
    "booking app for braid stylists",
    "StyleSeat fees",
  ],
  openGraph: {
    title: "Braid Boss Pro vs StyleSeat for braiders",
    description: "Side-by-side comparison for braid stylists choosing between Braid Boss Pro and StyleSeat.",
    url: "/compare/braid-boss-pro-vs-styleseat",
    type: "article",
  },
};

const rows: ComparisonRow[] = [
  { feature: "Monthly price", bbp: { mark: "text", note: "$14.99" }, them: { mark: "text", note: "$35 + $1 per new client" } },
  { feature: "Per-new-client fee", bbp: { mark: "no" }, them: { mark: "yes", note: "$1 every new client" } },
  { feature: "Booking fee on clients", bbp: { mark: "no" }, them: { mark: "yes", note: "Up to $7.99 per booking" } },
  { feature: "You own your client list", bbp: { mark: "yes", note: "Stored in your account, exportable any time" }, them: { mark: "partial", note: "Locked behind StyleSeat" } },
  { feature: "Stripe Connect (you own payouts)", bbp: { mark: "yes", note: "Same-day to your Stripe account" }, them: { mark: "no", note: "StyleSeat custodies funds" } },
  { feature: "Branded /@handle booking link", bbp: { mark: "yes" }, them: { mark: "partial", note: "styleseat.com/yourname" } },
  { feature: "Digital contracts + e-signature", bbp: { mark: "yes" }, them: { mark: "no" } },
  { feature: "Pricing calculator for braid quotes", bbp: { mark: "yes" }, them: { mark: "no" } },
  { feature: "Retail storefront", bbp: { mark: "yes", note: "Variants + inventory + Stripe checkout" }, them: { mark: "no" } },
  { feature: "SMS appointment reminders", bbp: { mark: "yes" }, them: { mark: "yes" } },
  { feature: "Marketing automation (rebook, win-back, birthday)", bbp: { mark: "yes" }, them: { mark: "partial", note: "Basic only" } },
  { feature: "Public stylist reviews", bbp: { mark: "yes" }, them: { mark: "yes" } },
  { feature: "PWA install — no app store", bbp: { mark: "yes" }, them: { mark: "no", note: "App store required" } },
];

export default function VsStyleSeatPage() {
  return (
    <MarketingShell>
      <MarketingHero
        eyebrow="Comparison"
        title={
          <>
            Braid Boss Pro vs StyleSeat <em style={{ fontStyle: "italic", background: "linear-gradient(135deg, #7C3AED 0%, #FF4D6D 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>for braid stylists.</em>
          </>
        }
        body="StyleSeat is one of the most familiar booking apps in the industry — but it costs $35/month, charges $1 every new client, and adds booking fees on top. Braid Boss Pro is $14.99 flat, no per-client fees, and you keep ownership of your client list and your money."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See pricing", href: "/pricing" }}
      />

      <Section eyebrow="At a glance" title="The numbers that matter">
        <ComparisonTable competitorName="StyleSeat" rows={rows} />
      </Section>

      <Section eyebrow="Where StyleSeat wins" title="Honest take" background="#FBFAFD">
        <p style={{ fontSize: 15.5, lineHeight: 1.7, color: "#3D3447", maxWidth: 720, margin: "0 auto" }}>
          StyleSeat&apos;s biggest advantage is its consumer marketplace — a lot of clients search styleseat.com to find a stylist nearby, so there&apos;s discovery built in. If you&apos;re brand new and have zero following, that marketplace pipeline can fill your book in week one. The trade-off: StyleSeat charges your clients a booking fee, takes $1 every new-client deposit, and holds your payouts. Once you have a stable client base, the per-client fees and the lack of ownership become real money walking out the door.
        </p>
      </Section>

      <Section eyebrow="Where Braid Boss Pro wins" title="You own everything">
        <p style={{ fontSize: 15.5, lineHeight: 1.7, color: "#3D3447", maxWidth: 720, margin: "0 auto" }}>
          With Braid Boss Pro, your clients are YOUR clients — exportable any time, no per-client fees, no booking fees added on top. Your booking link is /@yourhandle, not a sub-page of someone else&apos;s domain. Stripe Connect means deposits and balance payments land directly in your own Stripe account same-day; we never custody your funds. Pricing calculator + saved quotes for hair-included braid work, digital contracts with e-signature, retail storefront for selling hair products + edge control alongside your services, and a real analytics dashboard. All for less than half of what StyleSeat charges before the per-client fees even start.
        </p>
      </Section>

      <CtaFooter
        title="Keep your clients. Keep your money."
        body="The StyleSeat alternative built specifically for braiders. 14-day free trial, then $14.99/month flat."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See features", href: "/features" }}
      />
    </MarketingShell>
  );
}
