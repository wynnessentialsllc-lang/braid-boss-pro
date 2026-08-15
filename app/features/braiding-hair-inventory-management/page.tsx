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
import { Package, AlertTriangle, Calculator, BarChart3 } from "lucide-react";

const SLUG = "braiding-hair-inventory-management";
const PATH = featurePath(SLUG);

export const metadata: Metadata = {
  title: "Braiding Hair Inventory Management · Braid Boss Pro",
  description:
    "Track braiding hair by color, length, quantity, and cost, watch low-stock levels, and price products with a profit calculator. Inventory management built for braiders and retail products.",
  alternates: { canonical: PATH },
  openGraph: {
    title: "Braiding Hair Inventory Management · Braid Boss Pro",
    description:
      "Track braiding hair by color, length, quantity, and cost — plus low-stock visibility and a product-profit calculator.",
    url: PATH,
    siteName: "Braid Boss Pro",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Braiding Hair Inventory Management · Braid Boss Pro",
    description: "Inventory tracking for braiding hair and retail products, built for braiders.",
  },
};

const FAQS: FaqEntry[] = [
  {
    q: "How do I track braiding hair inventory?",
    a: "You can track braiding hair by color, length, quantity, and cost, so you always know what's on hand and what each pack costs you. The same inventory powers your product storefront, so stock stays accurate as you sell.",
  },
  {
    q: "Will it warn me before I run out?",
    a: "Yes. Low-stock visibility surfaces the items running low so you can reorder before a client's appointment — and avoid last-minute supply runs to the beauty store.",
  },
  {
    q: "Can it help me price products for profit?",
    a: "Yes. The product-profit calculator uses your cost and price to show the margin on each product, so you can set retail prices that actually make money instead of guessing.",
  },
  {
    q: "Does inventory connect to my storefront?",
    a: "Yes. Inventory is shared with your product storefront, so the quantity on hand reflects what you've sold and what's still available to buy.",
  },
  {
    q: "Can I see reports on my inventory?",
    a: "Yes. Inventory reports give you a clear view of stock and costs so you can make better ordering decisions and reduce overbuying.",
  },
  {
    q: "How does this save me money?",
    a: "Knowing real-time stock levels and per-product profit means you stop overbuying hair you don't need, avoid emergency supply runs, and price retail products with confidence.",
  },
];

export default function InventoryPage() {
  return (
    <MarketingShell>
      <FeatureSchema
        path={PATH}
        breadcrumbName="Braiding Hair Inventory Management"
        faqs={FAQS}
        software={{
          name: "Braid Boss Pro — Braiding Hair Inventory Management",
          description:
            "Inventory management software for braiding hair and retail products: track hair by color, length, quantity, and cost, with low-stock visibility, a product-profit calculator, and inventory reports.",
          featureList: [
            "Track braiding hair by color, length, quantity, and cost",
            "Product storefront inventory",
            "Low-stock visibility",
            "Product-profit calculator",
            "Inventory reports",
            "Better ordering decisions",
          ],
        }}
      />
      <Breadcrumbs
        trail={[
          { label: "Home", href: "/" },
          { label: "Features", href: "/features" },
          { label: "Inventory management" },
        ]}
      />

      <MarketingHero
        eyebrow="Inventory management"
        title={
          <>
            Know your hair stock <GradientText>down to the pack.</GradientText>
          </>
        }
        body="Track braiding hair by color, length, quantity, and cost, watch your stock levels, and price retail products for real profit — so you stop guessing, stop overbuying, and stop the last-minute runs to the beauty supply store."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See pricing", href: "/pricing" }}
      />

      <Section
        eyebrow="Always know your stock"
        title="Real-time inventory, not a guessing game."
        intro="Track what you carry and what it costs, and get a heads-up before you run out."
      >
        <FeatureGrid>
          <FeatureCard
            tone="primary"
            icon={<Package size={22} />}
            title="Track hair by the details"
            body="Color, length, quantity, and cost for every type of braiding hair you carry — an accurate picture of what's on hand and what it cost you."
            delay={0}
          />
          <FeatureCard
            tone="secondary"
            icon={<AlertTriangle size={22} />}
            title="Low-stock visibility"
            body="See what's running low before an appointment so you can reorder in time — no scrambling the morning of an install."
            delay={100}
          />
          <FeatureCard
            tone="primary"
            icon={<Calculator size={22} />}
            title="Product-profit calculator"
            body="Enter cost and price to see the margin on each product, so your retail prices actually make money instead of leaving it on the table."
            delay={200}
          />
          <FeatureCard
            tone="soft-c"
            icon={<BarChart3 size={22} />}
            title="Inventory reports"
            body="Reports on stock and cost give you the full picture, so you can make smarter ordering decisions and stop overbuying."
            delay={300}
          />
        </FeatureGrid>
      </Section>

      <Section eyebrow="Everything in this feature" title="What's included with inventory management." background="#FBFAFD">
        <CheckList
          items={[
            "Track braiding hair by color, length, quantity, and cost",
            "Product storefront inventory",
            "Low-stock visibility",
            "Product-profit calculator",
            "Inventory reports",
            "Better ordering decisions",
            "Reduce overbuying and last-minute supply runs",
          ]}
        />
      </Section>

      <Section eyebrow="FAQ" title="Inventory questions, answered.">
        <FaqAccordion items={FAQS} />
      </Section>

      <Section eyebrow="Keep exploring" title="Related features" background="#FBFAFD">
        <RelatedFeatures pages={relatedFeaturePages(SLUG)} />
      </Section>

      <CtaFooter
        title="Stop guessing your inventory levels."
        body="Start a 14-day free trial — every feature unlocked. Then $14.99/month. No contracts, cancel anytime."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See pricing", href: "/pricing" }}
      />
    </MarketingShell>
  );
}
