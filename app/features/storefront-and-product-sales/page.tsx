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
import { ShoppingBag, Gift, Truck, MapPin, PackageCheck, Layers } from "lucide-react";

const SLUG = "storefront-and-product-sales";
const PATH = featurePath(SLUG);

export const metadata: Metadata = {
  title: "Storefront & Product Sales for Braiders · Braid Boss Pro",
  description:
    "Sell hair, products, and gift cards from a branded storefront with multi-variant listings, a cart, pickup, local delivery, and Shippo shipping with live rates, labels, and public order tracking.",
  alternates: { canonical: PATH },
  openGraph: {
    title: "Storefront & Product Sales for Braiders · Braid Boss Pro",
    description:
      "Sell products and gift cards with multi-variant listings, pickup, local delivery, Shippo shipping, and public order tracking.",
    url: PATH,
    siteName: "Braid Boss Pro",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Storefront & Product Sales for Braiders · Braid Boss Pro",
    description: "A branded storefront to sell hair, products, and gift cards — built for braiders.",
  },
};

const FAQS: FaqEntry[] = [
  {
    q: "Can I sell products alongside my services?",
    a: "Yes. Your product storefront lets you sell braiding hair, edge control, and any retail product with multi-variant listings and a cart, right alongside the services on your booking page.",
  },
  {
    q: "Can I sell gift cards?",
    a: "Yes. You can offer gift cards customers buy online and redeem toward services or products — a simple way to bring in revenue and new clients.",
  },
  {
    q: "What fulfillment options are supported?",
    a: "You can offer pickup, local delivery, and shipping. Shipping is powered by Shippo with live carrier rates, printable labels, and return labels, so you fulfill orders without leaving the app.",
  },
  {
    q: "Can customers track their orders?",
    a: "Yes. Every order gets a public tracking page customers can open from their confirmation, so they can follow pickup, delivery, or shipping status without messaging you.",
  },
  {
    q: "Does the storefront keep inventory accurate?",
    a: "Yes. The storefront shares inventory with your stock tracking, so quantities update as products sell and you can see what's running low.",
  },
  {
    q: "How do customers pay?",
    a: "Checkout runs through Stripe, so card payments land in your own account. Buy-now-pay-later options are available at checkout for eligible orders, and sales tax can be calculated with Stripe Tax where it applies.",
  },
];

export default function StorefrontPage() {
  return (
    <MarketingShell>
      <FeatureSchema
        path={PATH}
        breadcrumbName="Storefront & Product Sales"
        faqs={FAQS}
        software={{
          name: "Braid Boss Pro — Storefront & Product Sales",
          description:
            "Ecommerce storefront for braiders: sell products and gift cards with multi-variant listings, a cart, pickup, local delivery, and Shippo shipping with live rates, labels, and public order tracking.",
          featureList: [
            "Product storefront",
            "Multi-variant products",
            "Cart and checkout",
            "Gift cards",
            "Pickup",
            "Local delivery",
            "Shipping with Shippo",
            "Live shipping rates",
            "Shipping and return labels",
            "Public order tracking",
          ],
        }}
      />
      <Breadcrumbs
        trail={[
          { label: "Home", href: "/" },
          { label: "Features", href: "/features" },
          { label: "Storefront & products" },
        ]}
      />

      <MarketingHero
        eyebrow="Storefront & products"
        title={
          <>
            Sell hair and products <GradientText>from your own store.</GradientText>
          </>
        }
        body="Turn the products you already recommend into revenue. A branded storefront with multi-variant listings, gift cards, pickup, local delivery, and Shippo shipping — plus public order tracking so customers never have to ask where their order is."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See pricing", href: "/pricing" }}
      />

      <Section
        eyebrow="Your store"
        title="A storefront built into your booking page."
        intro="List products, take a cart to checkout, and sell gift cards — all under your brand."
      >
        <FeatureGrid>
          <FeatureCard
            tone="primary"
            icon={<ShoppingBag size={22} />}
            title="Product storefront"
            body="A branded shop for braiding hair, edge control, and retail products, sitting right alongside your services."
            delay={0}
          />
          <FeatureCard
            tone="secondary"
            icon={<Layers size={22} />}
            title="Multi-variant products & cart"
            body="Offer colors, lengths, and sizes as variants, and let customers add multiple items to a cart before checking out through Stripe."
            delay={100}
          />
          <FeatureCard
            tone="primary"
            icon={<Gift size={22} />}
            title="Gift cards"
            body="Sell gift cards online that customers redeem toward services or products — easy revenue and a path to new clients."
            delay={200}
          />
        </FeatureGrid>
      </Section>

      <Section
        eyebrow="Fulfillment"
        title="Pickup, delivery, or shipped to the door."
        background="#FBFAFD"
      >
        <FeatureGrid>
          <FeatureCard
            tone="soft-c"
            icon={<MapPin size={22} />}
            title="Pickup & local delivery"
            body="Let customers grab orders in person or get them delivered locally — perfect for clients near your chair."
          />
          <FeatureCard
            tone="primary"
            icon={<Truck size={22} />}
            title="Shippo shipping"
            body="Live carrier rates at checkout, printable shipping labels, and return labels — fulfill orders without leaving the app."
            delay={100}
          />
          <FeatureCard
            tone="secondary"
            icon={<PackageCheck size={22} />}
            title="Public order tracking"
            body="Every order gets a public tracking page so customers follow status themselves instead of messaging you for updates."
            delay={200}
          />
        </FeatureGrid>
      </Section>

      <Section eyebrow="Everything in this feature" title="What's included with the storefront.">
        <CheckList
          items={[
            "Product storefront",
            "Multi-variant products",
            "Cart and checkout",
            "Gift cards",
            "Pickup",
            "Local delivery",
            "Shipping with Shippo",
            "Live shipping rates",
            "Shipping and return labels",
            "Public order tracking",
          ]}
        />
      </Section>

      <Section eyebrow="FAQ" title="Storefront questions, answered.">
        <FaqAccordion items={FAQS} />
      </Section>

      <Section eyebrow="Keep exploring" title="Related features" background="#FBFAFD">
        <RelatedFeatures pages={relatedFeaturePages(SLUG)} />
      </Section>

      <CtaFooter
        title="Turn product recommendations into revenue."
        body="Start a 14-day free trial — every feature unlocked. Then $14.99/month. No contracts, cancel anytime."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See pricing", href: "/pricing" }}
      />
    </MarketingShell>
  );
}
