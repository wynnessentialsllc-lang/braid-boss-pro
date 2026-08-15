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
import { CalendarClock, Globe, Layers, Sparkles, FileText, RefreshCw } from "lucide-react";

const SLUG = "booking-software-for-braiders";
const PATH = featurePath(SLUG);

export const metadata: Metadata = {
  title: "Booking Software for Braiders · Braid Boss Pro",
  description:
    "Booking and scheduling software built for braiders — a branded booking microsite, real-time availability calendar, service variations, digital intake forms, and self-service rescheduling. Start a 30-day free trial.",
  alternates: { canonical: PATH },
  openGraph: {
    title: "Booking Software for Braiders · Braid Boss Pro",
    description:
      "A branded booking microsite, availability calendar, intake forms, and self-service rescheduling built for the braid chair.",
    url: PATH,
    siteName: "Braid Boss Pro",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Booking Software for Braiders · Braid Boss Pro",
    description: "Online booking and scheduling built specifically for professional braiders.",
  },
};

const FAQS: FaqEntry[] = [
  {
    q: "What makes this booking software different for braiders?",
    a: "Generic salon booking treats every appointment like a 60-minute clinical visit. Braid Boss Pro is built around braid work — service variations for length and density, hair-included pricing, long-appointment deposits, intake forms, and Build Your Style requests with a reference-photo upload. Your booking page lives at your own branded link and reflects how you actually run your chair.",
  },
  {
    q: "Can clients reschedule or cancel without texting me?",
    a: "Yes. Clients manage their own appointments from the client portal — they can reschedule or cancel within the windows you set in your booking policy. Your availability calendar updates in real time, so the freed slot reopens for the next client automatically.",
  },
  {
    q: "Do clients have to download an app to book?",
    a: "No. Your booking microsite opens in any phone or desktop browser from your link — there is nothing for clients to install. Braiders can also install Braid Boss Pro to the home screen as an app for managing the calendar on the go.",
  },
  {
    q: "Can I require approval before an appointment is confirmed?",
    a: "Yes. You can route requests through an approval workflow so new bookings land in a queue for you to confirm or decline before they hold a slot — useful for vetting new clients or reviewing custom Build Your Style requests.",
  },
  {
    q: "Does it support mobile or travel appointments?",
    a: "Yes. You can offer mobile and travel services so clients book appointments at their location, with the details captured at booking alongside your in-chair services.",
  },
  {
    q: "Can I export appointments to my personal calendar?",
    a: "Yes. Appointments can be exported as calendar files so they show up in the calendar app you already use, keeping your personal and booking schedules in sync.",
  },
];

export default function BookingSoftwarePage() {
  return (
    <MarketingShell>
      <FeatureSchema
        path={PATH}
        breadcrumbName="Booking Software for Braiders"
        faqs={FAQS}
        software={{
          name: "Braid Boss Pro — Booking Software for Braiders",
          description:
            "Online booking and scheduling software for professional braiders: a branded booking microsite, real-time availability calendar, service variations, intake forms, and self-service rescheduling.",
          featureList: [
            "Public booking microsite at your branded link",
            "Real-time availability calendar",
            "Service variations and add-ons",
            "Digital intake forms",
            "Build Your Style requests with reference-photo upload",
            "Approval workflow",
            "Client appointment portal with self-service cancel and reschedule",
            "Calendar export",
            "Mobile and travel services",
            "AI Booking Concierge",
          ],
        }}
      />
      <Breadcrumbs
        trail={[
          { label: "Home", href: "/" },
          { label: "Features", href: "/features" },
          { label: "Booking software" },
        ]}
      />

      <MarketingHero
        eyebrow="Booking & scheduling"
        title={
          <>
            Booking software <GradientText>built for braiders.</GradientText>
          </>
        }
        body="Braid Boss Pro gives you a branded booking microsite, a real-time availability calendar, intake forms, and self-service rescheduling — an all-in-one booking system designed around how professional braiders run their chairs, not generic salon appointments."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See pricing", href: "/pricing" }}
      />

      <Section
        eyebrow="Your booking page"
        title="A booking microsite clients actually want to use."
        intro="Your own branded booking page shows your services, policies, and live availability — and takes the deposit when the appointment is confirmed."
      >
        <FeatureGrid>
          <FeatureCard
            tone="primary"
            icon={<Globe size={22} />}
            title="Public booking microsite"
            body="A branded page at your own link with your services, photos, and policies — paste it into your Instagram and TikTok bios."
            delay={0}
          />
          <FeatureCard
            tone="primary"
            icon={<CalendarClock size={22} />}
            title="Availability calendar"
            body="Slots update in real time as you book, with each service's length and prep time built in so clients only see what's truly open."
            delay={100}
          />
          <FeatureCard
            tone="secondary"
            icon={<Layers size={22} />}
            title="Service variations & add-ons"
            body="Lengths, densities, hair-included pricing, and add-ons — each variation carries its own price and time so quotes are accurate at booking."
            delay={200}
          />
          <FeatureCard
            tone="primary"
            icon={<Sparkles size={22} />}
            title="AI Booking Concierge"
            body="An AI concierge on your booking page helps clients find the right service and answers common questions before they book."
            delay={300}
          />
        </FeatureGrid>
      </Section>

      <Section
        eyebrow="Custom requests"
        title="Build Your Style, with the details up front."
        intro="Capture exactly what a client wants before they sit down — so there are no surprises on appointment day."
        background="#FBFAFD"
      >
        <FeatureGrid>
          <FeatureCard
            tone="secondary"
            icon={<FileText size={22} />}
            title="Digital intake forms"
            body="Collect the details you need — scalp sensitivities, prior styles, expectations — as part of the booking flow, stored on the client's record."
          />
          <FeatureCard
            tone="primary"
            icon={<Sparkles size={22} />}
            title="Build Your Style requests"
            body="Clients describe the look they want and upload a custom hair-color reference photo, so you can quote and prep before the chair."
            delay={100}
          />
          <FeatureCard
            tone="primary"
            icon={<RefreshCw size={22} />}
            title="Approval workflow"
            body="New requests land in a queue for you to review, approve, or decline before they hold a slot on your calendar."
            delay={200}
          />
        </FeatureGrid>
      </Section>

      <Section
        eyebrow="Everything in this feature"
        title="What's included with booking & scheduling."
      >
        <CheckList
          items={[
            "Public booking microsite on your branded link",
            "Real-time availability calendar",
            "Service variations and add-ons",
            "Digital intake forms",
            "Build Your Style requests",
            "Custom hair-color photo upload",
            "Approval workflow for new requests",
            "Calendar export to your own calendar app",
            "Client appointment portal",
            "Self-service cancel and reschedule",
            "Mobile and travel services",
            "AI Booking Concierge",
          ]}
        />
      </Section>

      <Section eyebrow="FAQ" title="Booking software questions, answered." background="#FBFAFD">
        <FaqAccordion items={FAQS} />
      </Section>

      <Section eyebrow="Keep exploring" title="Related features">
        <RelatedFeatures pages={relatedFeaturePages(SLUG)} />
      </Section>

      <CtaFooter
        title="Give clients a booking link they'll love."
        body="Start a 30-day free trial — every feature unlocked. Then $14.99/month. No contracts, cancel anytime."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See pricing", href: "/pricing" }}
      />
    </MarketingShell>
  );
}
