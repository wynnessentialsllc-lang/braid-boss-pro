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
import { C } from "../../components/marketing/tokens";
import { BellRing, MessageSquare, Star, RefreshCw, Mail, Users } from "lucide-react";

const SLUG = "marketing-and-client-retention";
const PATH = featurePath(SLUG);

export const metadata: Metadata = {
  title: "Marketing & Client Retention for Braiders · Braid Boss Pro",
  description:
    "Confirmations, reminders, review requests, rebooking and win-back messages, newsletters, and segmented marketing blasts — opt-in SMS and email retention tools built for braiders.",
  alternates: { canonical: PATH },
  openGraph: {
    title: "Marketing & Client Retention for Braiders · Braid Boss Pro",
    description:
      "Confirmations, reminders, review requests, rebooking, win-back, newsletters, and segmented marketing — built for braiders.",
    url: PATH,
    siteName: "Braid Boss Pro",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Marketing & Client Retention for Braiders · Braid Boss Pro",
    description: "Reminders, reviews, rebooking, and retention tools built for braiders.",
  },
};

const FAQS: FaqEntry[] = [
  {
    q: "What reminders can Braid Boss Pro send?",
    a: "Braid Boss Pro can send appointment confirmations, reminder texts and emails, and web push notifications, plus review requests after a visit, rebooking reminders when a client is due, and win-back messages when someone goes quiet.",
  },
  {
    q: "Are text messages opt-in?",
    a: "Yes. SMS is strictly opt-in — clients choose to receive texts when they book, and every program includes clear opt-in and unsubscribe language. Clients can reply STOP to opt out at any time, and message and data rates may apply.",
  },
  {
    q: "Can I send marketing blasts?",
    a: "Yes. You can send marketing blasts to clients who have opted in, with built-in compliance language and an unsubscribe path on every message. Marketing texts only go to clients who agreed to receive them.",
  },
  {
    q: "How does SMS billing work?",
    a: "Texts run on prepaid SMS credit packs — you buy credits and each message uses them, so there are no surprise per-message bills. You stay in control of when texting is on.",
  },
  {
    q: "Can I target specific clients?",
    a: "Yes. Client segments let you group clients so the right message reaches the right people — for example, clients overdue for a rebooking or those who haven't visited in a while.",
  },
  {
    q: "How does this improve retention?",
    a: "Automated confirmations and reminders cut no-shows, review requests build your reputation, and rebooking and win-back messages bring clients back before they drift to another braider — so you keep the clients you've already earned.",
  },
];

export default function MarketingPage() {
  return (
    <MarketingShell>
      <FeatureSchema
        path={PATH}
        breadcrumbName="Marketing & Client Retention"
        faqs={FAQS}
        software={{
          name: "Braid Boss Pro — Marketing & Client Retention",
          description:
            "Marketing and client-retention tools for braiders: appointment confirmations, opt-in reminder texts and emails, push notifications, review requests, rebooking and win-back messages, newsletters, and segmented marketing blasts.",
          featureList: [
            "Appointment confirmations",
            "Reminder texts and emails (opt-in)",
            "Push notifications",
            "Review requests",
            "Rebooking reminders",
            "Win-back messages",
            "Newsletter",
            "SMS credit packs",
            "Marketing blasts with compliance language",
            "Client segments",
          ],
        }}
      />
      <Breadcrumbs
        trail={[
          { label: "Home", href: "/" },
          { label: "Features", href: "/features" },
          { label: "Marketing & retention" },
        ]}
      />

      <MarketingHero
        eyebrow="Marketing & retention"
        title={
          <>
            Keep the clients <GradientText>you&apos;ve already earned.</GradientText>
          </>
        }
        body="Confirmations and reminders that cut no-shows, review requests that build your name, and rebooking and win-back messages that bring clients back. Reach the right people with client segments — with opt-in SMS and unsubscribe built in from the start."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See pricing", href: "/pricing" }}
      />

      <Section
        eyebrow="Stay top of mind"
        title="Reminders and reviews, on autopilot."
        intro="Show up in your client's phone at exactly the right moments — confirmation, reminder, and the review request after."
      >
        <FeatureGrid>
          <FeatureCard
            tone="primary"
            icon={<MessageSquare size={22} />}
            title="Confirmations & reminders"
            body="Appointment confirmations and day-before and same-day reminders by text or email cut no-shows. Clients opt in to SMS at booking and can reply STOP anytime."
            delay={0}
          />
          <FeatureCard
            tone="secondary"
            icon={<BellRing size={22} />}
            title="Push notifications"
            body="Web push keeps clients in the loop on confirmations and updates without using a text credit."
            delay={100}
          />
          <FeatureCard
            tone="primary"
            icon={<Star size={22} />}
            title="Review requests"
            body="After a visit, automatically ask happy clients for a review to build your reputation and bring in new bookings."
            delay={200}
          />
        </FeatureGrid>
      </Section>

      <Section
        eyebrow="Bring them back"
        title="Win back the clients who drift."
        background="#FBFAFD"
      >
        <FeatureGrid>
          <FeatureCard
            tone="soft-c"
            icon={<RefreshCw size={22} />}
            title="Rebooking & win-back"
            body="Rebooking reminders nudge clients when they're due, and win-back messages re-engage clients who've gone quiet — before they book elsewhere."
          />
          <FeatureCard
            tone="primary"
            icon={<Mail size={22} />}
            title="Newsletter & blasts"
            body="Send a newsletter or a marketing blast to opted-in clients, with compliance language and an unsubscribe path on every message."
            delay={100}
          />
          <FeatureCard
            tone="secondary"
            icon={<Users size={22} />}
            title="Client segments"
            body="Group clients so the right message reaches the right people — overdue regulars, lapsed clients, or your VIPs."
            delay={200}
          />
        </FeatureGrid>
      </Section>

      <Section eyebrow="Everything in this feature" title="What's included with marketing & retention.">
        <CheckList
          items={[
            "Appointment confirmations",
            "Reminder texts and emails (opt-in)",
            "Push notifications",
            "Review requests",
            "Rebooking reminders",
            "Win-back messages",
            "Newsletter",
            "SMS credit packs",
            "Marketing blasts with compliance language",
            "Client segments",
          ]}
        />
      </Section>

      {/* SMS compliance note — surfaced on-page so the opt-in / STOP
          terms are explicit, matching the platform's A2P requirements. */}
      <Section eyebrow="SMS compliance" title="Texting clients, the right way">
        <p
          style={{
            fontSize: 14.5,
            lineHeight: 1.7,
            color: C.coffee,
            maxWidth: 720,
            margin: "0 auto",
            textAlign: "center",
          }}
        >
          SMS is strictly opt-in. Clients choose to receive texts when they book, every program
          includes clear opt-in and unsubscribe language, and clients can reply <strong>STOP</strong> to
          opt out at any time or <strong>HELP</strong> for help. Message and data rates may apply.
          Marketing messages only go to clients who have agreed to receive them, and texts run on
          prepaid SMS credits you control.
        </p>
      </Section>

      <Section eyebrow="FAQ" title="Marketing & retention questions, answered." background="#FBFAFD">
        <FaqAccordion items={FAQS} />
      </Section>

      <Section eyebrow="Keep exploring" title="Related features">
        <RelatedFeatures pages={relatedFeaturePages(SLUG)} />
      </Section>

      <CtaFooter
        title="Cut no-shows. Keep clients coming back."
        body="Start a 30-day free trial — every feature unlocked. Then $14.99/month. No contracts, cancel anytime."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See pricing", href: "/pricing" }}
      />
    </MarketingShell>
  );
}
