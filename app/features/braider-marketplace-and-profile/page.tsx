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
import { UserCircle, Link2, Image as ImageIcon, Star, Compass } from "lucide-react";

const SLUG = "braider-marketplace-and-profile";
const PATH = featurePath(SLUG);

export const metadata: Metadata = {
  title: "Braider Marketplace & Public Profile · Braid Boss Pro",
  description:
    "A public stylist profile and link-in-bio page with your bio, services, gallery, reviews, shop, and a book-now CTA — plus a discover marketplace that helps clients find braiders.",
  alternates: { canonical: PATH },
  keywords: [
    "braider marketplace",
    "find braiders",
    "braid stylist directory",
    "public profile for hairstylists",
  ],
  openGraph: {
    title: "Braider Marketplace & Public Profile · Braid Boss Pro",
    description:
      "A public stylist profile and link-in-bio page with bio, services, gallery, reviews, shop, and a book-now CTA — plus a discover marketplace.",
    url: PATH,
    siteName: "Braid Boss Pro",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Braider Marketplace & Public Profile · Braid Boss Pro",
    description: "Public stylist profile and discovery built for braiders.",
  },
};

const FAQS: FaqEntry[] = [
  {
    q: "What is the public stylist profile?",
    a: "Your public profile is a link-in-bio page for your braiding business — your bio, services, a gallery of your work, reviews, your shop, and a clear book-now button, all on one branded page you can drop into your Instagram or TikTok bio.",
  },
  {
    q: "How does the discover marketplace work?",
    a: "The discover marketplace is a place where clients can browse braiders, so your profile can be found by people looking for a stylist — extra discovery beyond your own social following.",
  },
  {
    q: "Can clients book directly from my profile?",
    a: "Yes. Your profile includes a book-now CTA that takes clients straight into your booking flow, so discovery turns into a confirmed appointment without extra steps.",
  },
  {
    q: "Can I show off my work?",
    a: "Yes. Upload portfolio photos to your gallery so visitors can see your styles, which builds trust and helps clients picture what you'll do for them.",
  },
  {
    q: "Do reviews show on my profile?",
    a: "Yes. Client reviews appear on your public profile, giving new visitors social proof from people you've already braided.",
  },
  {
    q: "Can I sell products from my profile?",
    a: "Yes. Your profile links to your shop, so visitors can browse and buy your products right alongside booking a service.",
  },
];

export default function MarketplacePage() {
  return (
    <MarketingShell>
      <FeatureSchema
        path={PATH}
        breadcrumbName="Braider Marketplace & Profile"
        faqs={FAQS}
        software={{
          name: "Braid Boss Pro — Braider Marketplace & Profile",
          description:
            "Public stylist profile and discovery for braiders: a link-in-bio page with bio, services, gallery, reviews, shop, and a book-now CTA, plus a discover marketplace and portfolio uploads.",
          featureList: [
            "Public stylist profile",
            "Link-in-bio page",
            "Bio",
            "Services",
            "Gallery",
            "Reviews",
            "Shop",
            "Book-now CTA",
            "Discover marketplace",
            "Portfolio uploads",
          ],
        }}
      />
      <Breadcrumbs
        trail={[
          { label: "Home", href: "/" },
          { label: "Features", href: "/features" },
          { label: "Marketplace & profile" },
        ]}
      />

      <MarketingHero
        eyebrow="Marketplace & profile"
        title={
          <>
            One link that <GradientText>does it all.</GradientText>
          </>
        }
        body="Give clients a single branded profile — your bio, services, gallery, reviews, and shop, with a book-now button front and center. Then get discovered by new clients browsing the marketplace for a braider."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See pricing", href: "/pricing" }}
      />

      <Section
        eyebrow="Your profile"
        title="A link-in-bio page that books appointments."
        intro="Everything a new client needs to choose you — and a button that turns interest into a booking."
      >
        <FeatureGrid>
          <FeatureCard
            tone="primary"
            icon={<UserCircle size={22} />}
            title="Public stylist profile"
            body="Your bio, services, and brand on one page — the professional front door for your braiding business."
            delay={0}
          />
          <FeatureCard
            tone="secondary"
            icon={<Link2 size={22} />}
            title="Link-in-bio with book-now"
            body="A single link for your Instagram and TikTok bios, with a book-now CTA that takes clients straight into your calendar."
            delay={100}
          />
          <FeatureCard
            tone="primary"
            icon={<ImageIcon size={22} />}
            title="Gallery & portfolio uploads"
            body="Upload photos of your work so visitors can see your styles and picture what you'll create for them."
            delay={200}
          />
          <FeatureCard
            tone="soft-c"
            icon={<Star size={22} />}
            title="Reviews & shop"
            body="Client reviews give new visitors social proof, and your shop lets them buy products right from your profile."
            delay={300}
          />
        </FeatureGrid>
      </Section>

      <Section
        eyebrow="Get discovered"
        title="Be found by clients looking for a braider."
        background="#FBFAFD"
      >
        <FeatureGrid>
          <FeatureCard
            tone="primary"
            icon={<Compass size={22} />}
            title="Discover marketplace"
            body="Your profile can be browsed in the discover marketplace, putting your work in front of clients searching for a stylist — discovery beyond your own following."
          />
        </FeatureGrid>
      </Section>

      <Section eyebrow="Everything in this feature" title="What's included with marketplace & profile.">
        <CheckList
          items={[
            "Public stylist profile",
            "Link-in-bio page",
            "Bio",
            "Services",
            "Gallery",
            "Reviews",
            "Shop",
            "Book-now CTA",
            "Discover marketplace",
            "Portfolio uploads",
          ]}
        />
      </Section>

      <Section eyebrow="FAQ" title="Profile & marketplace questions, answered." background="#FBFAFD">
        <FaqAccordion items={FAQS} />
      </Section>

      <Section eyebrow="Keep exploring" title="Related features">
        <RelatedFeatures pages={relatedFeaturePages(SLUG)} />
      </Section>

      <CtaFooter
        title="Your whole business behind one link."
        body="Start a 14-day free trial — every feature unlocked. Then $14.99/month. No contracts, cancel anytime."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See pricing", href: "/pricing" }}
      />
    </MarketingShell>
  );
}
