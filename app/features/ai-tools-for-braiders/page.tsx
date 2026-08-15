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
import { Brain, Megaphone, RefreshCw, Wand2, Sparkles, Calculator } from "lucide-react";

const SLUG = "ai-tools-for-braiders";
const PATH = featurePath(SLUG);

export const metadata: Metadata = {
  title: "AI Tools for Braiders · Braid Boss Pro",
  description:
    "AI-powered tools built for braiding businesses — an AI Business Coach, Social Media Studio, rebooking and win-back assistant, style consultant, booking concierge, and AI quotes for Build Your Style.",
  alternates: { canonical: PATH },
  openGraph: {
    title: "AI Tools for Braiders · Braid Boss Pro",
    description:
      "An AI Business Coach, Social Media Studio, rebooking assistant, style consultant, and booking concierge for braiding businesses.",
    url: PATH,
    siteName: "Braid Boss Pro",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Tools for Braiders · Braid Boss Pro",
    description: "AI-powered tools built specifically for braiding businesses.",
  },
};

const FAQS: FaqEntry[] = [
  {
    q: "What AI tools does Braid Boss Pro include?",
    a: "Braid Boss Pro includes an AI Business Coach, an AI Social Media Studio, an AI rebooking and win-back assistant, an AI Style Consultant, an AI Booking Concierge on your booking page, and AI ballpark quotes for Build Your Style requests — all built around how braiders work.",
  },
  {
    q: "How does the AI Business Coach help me?",
    a: "The AI Business Coach reviews your business activity and gives you practical, plain-language guidance — what to focus on, who to follow up with, and where to grow — so you have a coach in your corner without hiring one.",
  },
  {
    q: "Can AI help me with social media?",
    a: "Yes. The AI Social Media Studio helps you generate captions and post content for your braiding business, so promoting your work takes minutes instead of staring at a blank caption box.",
  },
  {
    q: "How does the AI rebooking assistant work?",
    a: "The AI rebooking and win-back assistant identifies clients who are due to come back or have gone quiet and helps you draft outreach to bring them in, so repeat business doesn't slip through the cracks.",
  },
  {
    q: "What does the AI Booking Concierge do?",
    a: "The AI Booking Concierge sits on your booking page and helps clients pick the right service and answer common questions before they book, smoothing the path from interest to a confirmed appointment.",
  },
  {
    q: "Can AI help me quote custom styles?",
    a: "Yes. For Build Your Style requests, AI can produce a ballpark quote based on the look a client describes, giving them a realistic starting estimate while you stay in control of the final price.",
  },
];

export default function AiToolsPage() {
  return (
    <MarketingShell>
      <FeatureSchema
        path={PATH}
        breadcrumbName="AI Tools for Braiders"
        faqs={FAQS}
        software={{
          name: "Braid Boss Pro — AI Tools for Braiders",
          description:
            "AI-powered tools for braiding businesses: an AI Business Coach, Social Media Studio, rebooking and win-back assistant, style consultant, booking concierge, and AI quotes for Build Your Style.",
          featureList: [
            "AI Business Coach",
            "AI Social Media Studio",
            "AI Rebooking / Win-back Assistant",
            "AI Style Consultant",
            "AI Booking Concierge",
            "AI ballpark quotes for Build Your Style",
          ],
        }}
      />
      <Breadcrumbs
        trail={[
          { label: "Home", href: "/" },
          { label: "Features", href: "/features" },
          { label: "AI tools" },
        ]}
      />

      <MarketingHero
        eyebrow="AI tools"
        title={
          <>
            AI in your corner, <GradientText>trained on your chair.</GradientText>
          </>
        }
        body="Braid Boss Pro puts AI to work for braiding businesses — a business coach, a social media studio, a rebooking assistant, a style consultant, a booking concierge, and ballpark quotes for custom styles. Practical help with the work that eats your time."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See pricing", href: "/pricing" }}
      />

      <Section
        eyebrow="Grow & promote"
        title="Coaching and content, on demand."
        intro="The strategic and marketing help most braiders never have time for — now a tap away."
      >
        <FeatureGrid>
          <FeatureCard
            tone="primary"
            icon={<Brain size={22} />}
            title="AI Business Coach"
            body="Plain-language guidance on what to focus on, who to follow up with, and where to grow — a coach in your corner without the price tag."
            delay={0}
          />
          <FeatureCard
            tone="secondary"
            icon={<Megaphone size={22} />}
            title="AI Social Media Studio"
            body="Generate captions and post content for your braiding business in minutes, so promoting your work never stalls on a blank caption box."
            delay={100}
          />
          <FeatureCard
            tone="primary"
            icon={<RefreshCw size={22} />}
            title="AI Rebooking & win-back"
            body="Surfaces clients due to return or gone quiet and helps you draft the outreach to bring them back, so repeat business doesn't slip away."
            delay={200}
          />
        </FeatureGrid>
      </Section>

      <Section
        eyebrow="Book & quote"
        title="Help clients say yes — faster."
        background="#FBFAFD"
      >
        <FeatureGrid>
          <FeatureCard
            tone="soft-c"
            icon={<Wand2 size={22} />}
            title="AI Style Consultant"
            body="Helps clients explore styles that fit what they're after, guiding them toward a service that's right for them — and for your chair."
          />
          <FeatureCard
            tone="primary"
            icon={<Sparkles size={22} />}
            title="AI Booking Concierge"
            body="On your booking page, it answers common questions and helps clients choose the right service before they book."
            delay={100}
          />
          <FeatureCard
            tone="secondary"
            icon={<Calculator size={22} />}
            title="AI ballpark quotes"
            body="For Build Your Style requests, AI generates a realistic starting estimate from the look a client describes — you set the final price."
            delay={200}
          />
        </FeatureGrid>
      </Section>

      <Section eyebrow="Everything in this feature" title="What's included with AI tools.">
        <CheckList
          items={[
            "AI Business Coach",
            "AI Social Media Studio",
            "AI Rebooking / Win-back Assistant",
            "AI Style Consultant",
            "AI Booking Concierge",
            "AI ballpark quotes for Build Your Style",
          ]}
        />
      </Section>

      <Section eyebrow="FAQ" title="AI tools questions, answered." background="#FBFAFD">
        <FaqAccordion items={FAQS} />
      </Section>

      <Section eyebrow="Keep exploring" title="Related features">
        <RelatedFeatures pages={relatedFeaturePages(SLUG)} />
      </Section>

      <CtaFooter
        title="Put AI to work for your braid business."
        body="Start a 14-day free trial — every feature unlocked. Then $14.99/month. No contracts, cancel anytime."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See pricing", href: "/pricing" }}
      />
    </MarketingShell>
  );
}
