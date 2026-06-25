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
import { Smartphone, BellRing, Share2, Download, WifiOff, CalendarCheck } from "lucide-react";

const SLUG = "mobile-app-for-braiders";
const PATH = featurePath(SLUG);

export const metadata: Metadata = {
  title: "Mobile App for Braiders · Braid Boss Pro",
  description:
    "A mobile-first app experience for professional braiders — an iOS app with push notifications, native share, receipt and export downloads, an offline fallback, and client booking from any phone.",
  alternates: { canonical: PATH },
  keywords: [
    "mobile app for braiders",
    "iPhone app for braiders",
    "braider business app",
    "mobile booking app for braiders",
  ],
  openGraph: {
    title: "Mobile App for Braiders · Braid Boss Pro",
    description:
      "A mobile-first iOS app experience with push notifications, native share, receipt downloads, and an offline fallback.",
    url: PATH,
    siteName: "Braid Boss Pro",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Mobile App for Braiders · Braid Boss Pro",
    description: "A mobile-first app experience built for professional braiders.",
  },
};

const FAQS: FaqEntry[] = [
  {
    q: "Is there an iPhone app?",
    a: "Yes. Braid Boss Pro has an iOS app experience built for iPhone, with native capabilities like push notifications, sharing, and file downloads. It's mobile-first, so the whole dashboard is designed to run from your phone between clients.",
  },
  {
    q: "Will I get notifications on my phone?",
    a: "Yes. Push notifications keep you on top of new bookings and updates, so you don't have to keep checking the app to know what's happening.",
  },
  {
    q: "Can I share booking links and receipts easily?",
    a: "Yes. Native share lets you send your booking link or other content through your phone's share sheet, and you can download receipts and exports straight to your device.",
  },
  {
    q: "What happens if I lose signal?",
    a: "If your connection drops, an offline fallback screen lets you know rather than leaving you on a broken page — so the app fails gracefully when you're between bars.",
  },
  {
    q: "Can clients book from their phones too?",
    a: "Yes. Your booking page is mobile-first, so clients can book from any phone browser without downloading anything — and you can install Braid Boss Pro to your home screen for an app-like experience.",
  },
  {
    q: "Do I have to download from the App Store?",
    a: "Braid Boss Pro also runs as a Progressive Web App you can install to your home screen straight from your phone's browser — so you get an app-like experience without waiting on an app-store download.",
  },
];

export default function MobileAppPage() {
  return (
    <MarketingShell>
      <FeatureSchema
        path={PATH}
        breadcrumbName="Mobile App for Braiders"
        faqs={FAQS}
        software={{
          name: "Braid Boss Pro — Mobile App for Braiders",
          description:
            "A mobile-first app experience for professional braiders: an iOS app with push notifications, native share, receipt and export downloads, an offline fallback, and client booking from any phone.",
          featureList: [
            "iOS app experience",
            "Push notifications",
            "Native share",
            "Receipt and export downloads",
            "Offline fallback screen",
            "Mobile-first design",
            "Client booking from mobile",
          ],
        }}
      />
      <Breadcrumbs
        trail={[
          { label: "Home", href: "/" },
          { label: "Features", href: "/features" },
          { label: "Mobile app" },
        ]}
      />

      <MarketingHero
        eyebrow="Mobile app"
        title={
          <>
            Run your business <GradientText>from your phone.</GradientText>
          </>
        }
        body="Braid Boss Pro is mobile-first by design — an iOS app experience with push notifications, native share, and receipt downloads, built to run from your phone between clients. And your clients book from any phone with nothing to install."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See pricing", href: "/pricing" }}
      />

      <Section
        eyebrow="Native feel"
        title="An app that works like your phone does."
        intro="Notifications, sharing, and downloads that tap into what your phone already does well."
      >
        <FeatureGrid>
          <FeatureCard
            tone="primary"
            icon={<Smartphone size={22} />}
            title="iOS app experience"
            body="A mobile-first iOS app built for the chair — big tap targets, one-handed flows, and the whole dashboard in your pocket."
            delay={0}
          />
          <FeatureCard
            tone="secondary"
            icon={<BellRing size={22} />}
            title="Push notifications"
            body="Stay on top of new bookings and updates with push notifications, so you know what's happening without checking constantly."
            delay={100}
          />
          <FeatureCard
            tone="primary"
            icon={<Share2 size={22} />}
            title="Native share"
            body="Send your booking link and content through your phone's native share sheet in a tap."
            delay={200}
          />
          <FeatureCard
            tone="soft-c"
            icon={<Download size={22} />}
            title="Receipt & export downloads"
            body="Download receipts and exports straight to your device when you need a record in hand."
            delay={300}
          />
        </FeatureGrid>
      </Section>

      <Section
        eyebrow="Built for the real world"
        title="Reliable on the go, easy for clients."
        background="#FBFAFD"
      >
        <FeatureGrid>
          <FeatureCard
            tone="primary"
            icon={<WifiOff size={22} />}
            title="Offline fallback"
            body="Lose signal and you get a clear offline fallback screen instead of a broken page — the app fails gracefully between bars."
          />
          <FeatureCard
            tone="secondary"
            icon={<CalendarCheck size={22} />}
            title="Client booking from mobile"
            body="Your booking page is mobile-first, so clients book from any phone browser with nothing to download."
            delay={100}
          />
        </FeatureGrid>
      </Section>

      <Section eyebrow="Everything in this feature" title="What's included with the mobile app.">
        <CheckList
          items={[
            "iOS app experience",
            "Push notifications",
            "Native share",
            "Receipt and export downloads",
            "Offline fallback screen",
            "Mobile-first design",
            "Client booking from mobile",
          ]}
        />
      </Section>

      <Section eyebrow="FAQ" title="Mobile app questions, answered.">
        <FaqAccordion items={FAQS} />
      </Section>

      <Section eyebrow="Keep exploring" title="Related features" background="#FBFAFD">
        <RelatedFeatures pages={relatedFeaturePages(SLUG)} />
      </Section>

      <CtaFooter
        title="Your braid business, in your pocket."
        body="Start a 14-day free trial — every feature unlocked. Then $14.99/month. No contracts, cancel anytime."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See pricing", href: "/pricing" }}
      />
    </MarketingShell>
  );
}
