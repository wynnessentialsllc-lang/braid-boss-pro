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
import { CreditCard, DollarSign, ShieldCheck, Smartphone, Receipt, Percent } from "lucide-react";

const SLUG = "payments-and-deposits";
const PATH = featurePath(SLUG);

export const metadata: Metadata = {
  title: "Payments & Deposits for Braiders · Braid Boss Pro",
  description:
    "Accept deposits online, collect balances and tips, protect against no-shows, and track every transaction. Stripe Connect, Tap to Pay on iPhone, BNPL, Stripe Tax, and a full ledger built for braiders.",
  alternates: { canonical: PATH },
  keywords: [
    "deposit software for braiders",
    "payment software for braiders",
    "accept deposits online",
    "no-show protection for braiders",
    "Stripe Connect for braiders",
  ],
  openGraph: {
    title: "Payments & Deposits for Braiders · Braid Boss Pro",
    description:
      "Stripe Connect deposits, balances, tips, no-show protection, Tap to Pay, BNPL, and a full transactions ledger you own.",
    url: PATH,
    siteName: "Braid Boss Pro",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Payments & Deposits for Braiders · Braid Boss Pro",
    description: "Accept deposits online and protect your time — payment tools built for braiders.",
  },
};

const FAQS: FaqEntry[] = [
  {
    q: "How do deposits work for braiders?",
    a: "You can require a deposit when an appointment is confirmed — required, optional, or service by service. The deposit is collected through Stripe, applied to the balance, and tracked automatically, so you never have to chase a screenshot again.",
  },
  {
    q: "Who holds my money?",
    a: "You do. Braid Boss Pro uses Stripe Connect to route every payment directly to your own Stripe account — we never custody your funds. Deposits, balances, and product sales land in your Stripe dashboard the same day they're charged.",
  },
  {
    q: "How does no-show protection work?",
    a: "Clients can save a card on file at booking, so a no-show fee can be charged against your policy if they don't show. Combined with non-refundable deposits, it protects the long time blocks braid appointments require.",
  },
  {
    q: "Can clients pay over time?",
    a: "Yes. Buy-now-pay-later options including Affirm, Klarna, and Afterpay are available through Stripe at checkout, so clients can split larger installs while you still get paid up front.",
  },
  {
    q: "Can I take payments in person?",
    a: "Yes. Boss Checkout lets you ring up a sale on the spot, and Tap to Pay on iPhone accepts contactless cards and phones directly on a supported iPhone — no extra hardware required.",
  },
  {
    q: "How do I track income and taxes?",
    a: "Every deposit, balance, tip, and sale is recorded in a payments and transactions ledger you can export to CSV or XLS. Stripe Tax can calculate sales tax on eligible storefront orders so the numbers are ready at tax time.",
  },
];

export default function PaymentsPage() {
  return (
    <MarketingShell>
      <FeatureSchema
        path={PATH}
        breadcrumbName="Payments & Deposits"
        faqs={FAQS}
        software={{
          name: "Braid Boss Pro — Payments & Deposits for Braiders",
          description:
            "Payment and deposit software for professional braiders: Stripe Connect deposits, balances, tips, no-show protection, Tap to Pay on iPhone, BNPL, Stripe Tax, and a full transactions ledger.",
          featureList: [
            "Stripe Connect payouts you own",
            "Appointment deposits",
            "Saved card for no-show protection",
            "Balance payments",
            "Tipping",
            "No-show fees",
            "Pay-in-full",
            "BNPL with Affirm, Klarna, and Afterpay",
            "Boss Checkout for in-person sales",
            "Tap to Pay on iPhone",
            "Stripe Tax on eligible orders",
            "Payments and transactions ledger with CSV/XLS export",
          ],
        }}
      />
      <Breadcrumbs
        trail={[
          { label: "Home", href: "/" },
          { label: "Features", href: "/features" },
          { label: "Payments & deposits" },
        ]}
      />

      <MarketingHero
        eyebrow="Payments & deposits"
        title={
          <>
            Get paid up front, <GradientText>protect every block.</GradientText>
          </>
        }
        body="Accept deposits online, collect balances and tips, and protect the long time blocks braid work requires — all on Stripe Connect, so the money lands in your own account. Deposits are tracked automatically, no more searching for screenshots."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See pricing", href: "/pricing" }}
      />

      <Section
        eyebrow="Money in"
        title="Deposits, balances, and tips — handled."
        intro="From the deposit that locks the appointment to the balance and tip on the day, money moves through one clean pipeline."
      >
        <FeatureGrid>
          <FeatureCard
            tone="primary"
            icon={<DollarSign size={22} />}
            title="Appointment deposits"
            body="Collect a deposit when the appointment is confirmed — required, optional, or per service. It's applied to the balance and tracked automatically."
            delay={0}
          />
          <FeatureCard
            tone="secondary"
            icon={<CreditCard size={22} />}
            title="Stripe Connect"
            body="Direct charges land in your own Stripe balance — no intermediary holding your money. Deposits, balances, refunds, and 1099s run through Stripe."
            delay={100}
          />
          <FeatureCard
            tone="primary"
            icon={<ShieldCheck size={22} />}
            title="No-show protection"
            body="Clients can save a card at booking so a no-show fee can apply against your policy — protecting the hours a braid install takes."
            delay={200}
          />
          <FeatureCard
            tone="primary"
            icon={<Percent size={22} />}
            title="Tips & balances"
            body="Collect the remaining balance and a tip in the same flow, plus pay-in-full when a client wants to settle the whole ticket up front."
            delay={300}
          />
        </FeatureGrid>
      </Section>

      <Section
        eyebrow="Flexible checkout"
        title="Take payment any way the client wants."
        background="#FBFAFD"
      >
        <FeatureGrid>
          <FeatureCard
            tone="secondary"
            icon={<Smartphone size={22} />}
            title="Tap to Pay & Boss Checkout"
            body="Ring up an in-person sale with Boss Checkout and accept contactless cards or phones with Tap to Pay on a supported iPhone — no extra hardware."
          />
          <FeatureCard
            tone="primary"
            icon={<CreditCard size={22} />}
            title="Buy now, pay later"
            body="Affirm, Klarna, and Afterpay are available through Stripe at checkout, so clients can split larger installs while you get paid up front."
            delay={100}
          />
          <FeatureCard
            tone="soft-c"
            icon={<Receipt size={22} />}
            title="Ledger & tax"
            body="Every transaction is recorded in a ledger you can export to CSV or XLS, with Stripe Tax calculating sales tax on eligible storefront orders."
            delay={200}
          />
        </FeatureGrid>
      </Section>

      <Section eyebrow="Everything in this feature" title="What's included with payments & deposits.">
        <CheckList
          items={[
            "Stripe Connect payouts you own",
            "Appointment deposits",
            "Saved card for no-show protection",
            "Balance payments",
            "Tipping",
            "No-show fees",
            "Pay-in-full",
            "BNPL with Affirm, Klarna, and Afterpay",
            "Boss Checkout for in-person sales",
            "Tap to Pay on iPhone",
            "Stripe Tax on eligible orders",
            "Payments and transactions ledger with CSV/XLS export",
          ]}
        />
      </Section>

      <Section eyebrow="FAQ" title="Payment & deposit questions, answered.">
        <FaqAccordion items={FAQS} />
      </Section>

      <Section eyebrow="Keep exploring" title="Related features" background="#FBFAFD">
        <RelatedFeatures pages={relatedFeaturePages(SLUG)} />
      </Section>

      <CtaFooter
        title="Stop chasing deposit screenshots."
        body="Start a 14-day free trial — every feature unlocked. Then $14.99/month. No contracts, cancel anytime."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See pricing", href: "/pricing" }}
      />
    </MarketingShell>
  );
}
