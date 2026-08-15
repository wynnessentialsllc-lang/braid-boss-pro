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
import { Users, ScrollText, Wrench, Palette, BarChart3, LayoutDashboard } from "lucide-react";

const SLUG = "business-management-software-for-braiders";
const PATH = featurePath(SLUG);

export const metadata: Metadata = {
  title: "Business Management Software for Braiders · Braid Boss Pro",
  description:
    "All-in-one business management software for braiders — clients, policies, services, availability, branding, notifications, analytics, billing, and a settings hub in one mobile-first dashboard. 14-day free trial.",
  alternates: { canonical: PATH },
  openGraph: {
    title: "Business Management Software for Braiders · Braid Boss Pro",
    description:
      "Clients, policies, services, branding, notifications, analytics, and billing — the whole back office for your braid business in one dashboard.",
    url: PATH,
    siteName: "Braid Boss Pro",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Business Management Software for Braiders · Braid Boss Pro",
    description: "All-in-one business management built specifically for professional braiders.",
  },
};

const FAQS: FaqEntry[] = [
  {
    q: "What does an all-in-one platform for braiders actually replace?",
    a: "Most braiders juggle a booking app, a payment app, a spreadsheet for clients, a notes app for policies, and a separate tool for products and messages. Braid Boss Pro brings bookings, clients, services, policies, payments, branding, notifications, and analytics into one mobile-first dashboard built specifically for braiders.",
  },
  {
    q: "Can I manage everything from my phone?",
    a: "Yes. The admin dashboard is mobile-first, so you can manage your calendar, clients, services, and settings from your phone between clients — and install Braid Boss Pro to your home screen for an app-like experience.",
  },
  {
    q: "Do I own my client list?",
    a: "Yes. Your clients live in your account with their visit history and contact details, and you can export them at any time. Your client list is yours, not locked behind the platform.",
  },
  {
    q: "What can I customize about my brand?",
    a: "You can set your studio name, logo, and booking-page branding so your booking microsite and client-facing pages reflect your business rather than generic software.",
  },
  {
    q: "Where do I see how my business is doing?",
    a: "The analytics view surfaces the numbers braiders run their business on — revenue, top services, retention, and deposit collection — without exporting anything to a spreadsheet.",
  },
  {
    q: "How does billing for Braid Boss Pro work?",
    a: "Braid Boss Pro is $14.99/month (or $149/year) after a 14-day free trial, with every feature unlocked. You manage your subscription from the settings hub through the Stripe billing portal and can cancel anytime.",
  },
];

export default function BusinessManagementPage() {
  return (
    <MarketingShell>
      <FeatureSchema
        path={PATH}
        breadcrumbName="Business Management Software for Braiders"
        faqs={FAQS}
        software={{
          name: "Braid Boss Pro — Business Management for Braiders",
          description:
            "All-in-one business management software for professional braiders: client management, policies, services, availability, branding, notifications, analytics, billing, and a settings hub.",
          featureList: [
            "Client management with visit history",
            "Booking policies",
            "Services and variations",
            "Availability management",
            "Branding and booking-page customization",
            "Notification controls",
            "Analytics dashboard",
            "Mobile-first admin dashboard",
            "Subscription billing",
            "Centralized settings hub",
          ],
        }}
      />
      <Breadcrumbs
        trail={[
          { label: "Home", href: "/" },
          { label: "Features", href: "/features" },
          { label: "Business management" },
        ]}
      />

      <MarketingHero
        eyebrow="Business management"
        title={
          <>
            Run the whole business <GradientText>from one dashboard.</GradientText>
          </>
        }
        body="Braid Boss Pro is an all-in-one business platform built specifically for professional braiders — clients, policies, services, availability, branding, notifications, analytics, and billing in a single mobile-first dashboard, so you stop stitching five apps together."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See pricing", href: "/pricing" }}
      />

      <Section
        eyebrow="Your back office"
        title="Everything that runs your chair, in one place."
        intro="Stop switching between apps. Clients, services, policies, and settings all live together and stay in sync."
      >
        <FeatureGrid>
          <FeatureCard
            tone="primary"
            icon={<Users size={22} />}
            title="Client management"
            body="Every client's visit history, contact details, and preferences on one card — and an exportable list you own."
            delay={0}
          />
          <FeatureCard
            tone="secondary"
            icon={<ScrollText size={22} />}
            title="Policies"
            body="Set cancellation windows, no-show rules, and grace periods once — they surface on your booking page so every client agrees up front."
            delay={100}
          />
          <FeatureCard
            tone="primary"
            icon={<Wrench size={22} />}
            title="Services & availability"
            body="Define your services and variations, then set the days and hours you work. Your booking calendar pulls from both in real time."
            delay={200}
          />
          <FeatureCard
            tone="primary"
            icon={<Palette size={22} />}
            title="Branding"
            body="Add your studio name and logo so your booking microsite and client-facing pages look like your business, not generic software."
            delay={300}
          />
        </FeatureGrid>
      </Section>

      <Section
        eyebrow="Visibility & control"
        title="See the numbers. Control the noise."
        background="#FBFAFD"
      >
        <FeatureGrid>
          <FeatureCard
            tone="soft-c"
            icon={<BarChart3 size={22} />}
            title="Analytics"
            body="Revenue, top services, retention, and deposit collection — the levers that grow a chair-based business, no spreadsheet required."
          />
          <FeatureCard
            tone="primary"
            icon={<LayoutDashboard size={22} />}
            title="Admin dashboard & settings hub"
            body="A mobile-first dashboard with a centralized settings hub for notifications, billing, and every preference — manage it all between clients."
            delay={100}
          />
        </FeatureGrid>
      </Section>

      <Section eyebrow="Everything in this feature" title="What's included with business management.">
        <CheckList
          items={[
            "Client management",
            "Booking policies",
            "Services and variations",
            "Availability management",
            "Branding and booking-page customization",
            "Notification controls",
            "Analytics dashboard",
            "Mobile-first admin dashboard",
            "Subscription billing",
            "Centralized settings hub",
          ]}
        />
      </Section>

      <Section eyebrow="FAQ" title="Business management questions, answered.">
        <FaqAccordion items={FAQS} />
      </Section>

      <Section eyebrow="Keep exploring" title="Related features" background="#FBFAFD">
        <RelatedFeatures pages={relatedFeaturePages(SLUG)} />
      </Section>

      <CtaFooter
        title="One platform for your whole braid business."
        body="Start a 14-day free trial — every feature unlocked. Then $14.99/month. No contracts, cancel anytime."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See pricing", href: "/pricing" }}
      />
    </MarketingShell>
  );
}
