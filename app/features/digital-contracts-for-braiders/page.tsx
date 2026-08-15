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
import { FileSignature, PenLine, ShieldCheck, ListChecks } from "lucide-react";

const SLUG = "digital-contracts-for-braiders";
const PATH = featurePath(SLUG);

export const metadata: Metadata = {
  title: "Digital Contracts for Braiders · Braid Boss Pro",
  description:
    "Send tokenized, e-signature agreements clients sign from their phone — typed name, signature, optional initials, agree checkbox, and decline-with-reason, with a clear status lifecycle that protects your policies.",
  alternates: { canonical: PATH },
  openGraph: {
    title: "Digital Contracts for Braiders · Braid Boss Pro",
    description:
      "Tokenized e-sign agreements with typed name, signature, optional initials, decline-with-reason, and a full status lifecycle.",
    url: PATH,
    siteName: "Braid Boss Pro",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Digital Contracts for Braiders · Braid Boss Pro",
    description: "Contracts and e-signatures built for braiders.",
  },
};

const FAQS: FaqEntry[] = [
  {
    q: "How do clients sign a contract?",
    a: "Clients open a secure, tokenized signing link and sign right from their phone — typing their name, drawing or entering a signature, adding optional initials, and checking the agree box. No printing, scanning, or app download required.",
  },
  {
    q: "What if a client doesn't agree to the terms?",
    a: "Clients can decline and provide a reason, so you have a clear record either way. Nothing gets buried — you can see who signed, who declined, and why.",
  },
  {
    q: "Can I see the status of each agreement?",
    a: "Yes. Each contract moves through a clear status lifecycle so you always know whether an agreement is outstanding, signed, or declined.",
  },
  {
    q: "How does this protect my policies?",
    a: "A signed agreement documents that the client accepted your policies and terms before their appointment, giving you client policy protection and a record to point back to if there's ever a dispute.",
  },
  {
    q: "Can I attach contracts to specific services?",
    a: "Yes. You can require an agreement for specific services or appointments, so the right terms are signed for the work being booked.",
  },
  {
    q: "Are e-signatures secure?",
    a: "Signing happens through a unique tokenized link tied to the specific agreement, and the signed record is stored on the client's history, so you have a dependable record of what was agreed and when.",
  },
];

export default function ContractsPage() {
  return (
    <MarketingShell>
      <FeatureSchema
        path={PATH}
        breadcrumbName="Digital Contracts for Braiders"
        faqs={FAQS}
        software={{
          name: "Braid Boss Pro — Digital Contracts for Braiders",
          description:
            "Contracts and e-signatures for braiders: tokenized agreement signing with typed name, signature, optional initials, agree checkbox, decline-with-reason, and a clear status lifecycle.",
          featureList: [
            "Tokenized agreement signing",
            "Typed name",
            "Signature",
            "Optional initials",
            "Agree checkbox",
            "Decline with reason",
            "Status lifecycle",
            "Client policy protection",
          ],
        }}
      />
      <Breadcrumbs
        trail={[
          { label: "Home", href: "/" },
          { label: "Features", href: "/features" },
          { label: "Digital contracts" },
        ]}
      />

      <MarketingHero
        eyebrow="Digital contracts"
        title={
          <>
            Get it in writing, <GradientText>signed from the phone.</GradientText>
          </>
        }
        body="Send a secure agreement and let clients sign it from their phone before they sit down — typed name, signature, optional initials, and an agree checkbox. Every contract has a clear status, so your policies are protected on every appointment."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See pricing", href: "/pricing" }}
      />

      <Section
        eyebrow="Signing"
        title="A signing flow clients actually finish."
        intro="Clear, mobile-friendly, and tokenized — no printing, no app, no friction."
      >
        <FeatureGrid>
          <FeatureCard
            tone="primary"
            icon={<FileSignature size={22} />}
            title="Tokenized signing"
            body="Each agreement gets a unique, secure signing link tied to that contract — clients open it and sign on their phone in seconds."
            delay={0}
          />
          <FeatureCard
            tone="secondary"
            icon={<PenLine size={22} />}
            title="Name, signature & initials"
            body="Clients type their name, add a signature, include optional initials where needed, and check the agree box to accept your terms."
            delay={100}
          />
          <FeatureCard
            tone="primary"
            icon={<ListChecks size={22} />}
            title="Decline with reason"
            body="If a client doesn't agree, they can decline and leave a reason — so you have a clean record whether they sign or not."
            delay={200}
          />
          <FeatureCard
            tone="soft-c"
            icon={<ShieldCheck size={22} />}
            title="Status lifecycle & protection"
            body="Track each agreement from sent to signed or declined, with a stored record that documents the client accepted your policies."
            delay={300}
          />
        </FeatureGrid>
      </Section>

      <Section eyebrow="Everything in this feature" title="What's included with digital contracts." background="#FBFAFD">
        <CheckList
          items={[
            "Tokenized agreement signing",
            "Typed name",
            "Signature",
            "Optional initials",
            "Agree checkbox",
            "Decline with reason",
            "Status lifecycle",
            "Client policy protection",
          ]}
        />
      </Section>

      <Section eyebrow="FAQ" title="Contract questions, answered.">
        <FaqAccordion items={FAQS} />
      </Section>

      <Section eyebrow="Keep exploring" title="Related features" background="#FBFAFD">
        <RelatedFeatures pages={relatedFeaturePages(SLUG)} />
      </Section>

      <CtaFooter
        title="Protect your policies on every appointment."
        body="Start a 30-day free trial — every feature unlocked. Then $14.99/month. No contracts, cancel anytime."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See pricing", href: "/pricing" }}
      />
    </MarketingShell>
  );
}
