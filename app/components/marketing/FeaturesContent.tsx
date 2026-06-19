"use client";

// Shared marketing "features" page body. Lives in its own component so
// it can power two surfaces from one source of truth:
//   1. the dedicated /features route (app/features/page.tsx), and
//   2. the logged-out home / welcome landing (app/page.tsx) — the
//      first thing visitors see now actually shows what Braid Boss Pro
//      does instead of a thin intro splash.
//
// CTAs point at /?signup=1 and /?signin=1 — the home page reads those
// query params on mount and drops the visitor straight into the
// signup / signin gate (see app/page.tsx).

import {
  Calendar,
  CalendarClock,
  Calculator,
  CreditCard,
  Users,
  FileText,
  ScrollText,
  TrendingUp,
  Sparkles,
  ShoppingBag,
  Bell,
  Mail,
  MessageSquare,
  Smartphone,
  Hourglass,
  Layers,
  DollarSign,
  Receipt,
  Share2,
  Wallet,
  Globe,
  BarChart3,
  Tag,
  RefreshCw,
} from "lucide-react";
import {
  MarketingShell,
  MarketingHero,
  Section,
  CtaFooter,
} from "./MarketingShell";
import { FeatureCard, FeatureGrid } from "./FeatureCard";
import {
  AppointmentActionShowcase,
  CalendarShowcase,
  SourceOrbitShowcase,
  ClientInfoShowcase,
} from "./ShowcaseSections";

export default function FeaturesContent() {
  return (
    <MarketingShell>
      <MarketingHero
        eyebrow="The business OS for braiders"
        title={
          <>
            Built for braiders.{" "}
            <em
              style={{
                fontStyle: "italic",
                background: "linear-gradient(135deg, #7C3AED 0%, #FF4D6D 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              Only braiders.
            </em>
          </>
        }
        body="Braid Boss Pro is a premium business operating system for braid stylists — branded booking links, deposits, contracts, retail storefronts, analytics, and creator-economy tools built around how braiders actually run their chairs. Not generic salon software."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "How it works", href: "/how-it-works" }}
      />

      {/* Booking & Scheduling */}
      <Section
        eyebrow="Booking & Scheduling"
        title="A booking link your clients actually want to use."
        intro="Your own /@handle URL with a branded booking page, real-time calendar, deposits, and a waitlist that converts cancellations into bookings."
      >
        <FeatureGrid>
          <FeatureCard
            tone="primary"
            icon={<Share2 size={22} />}
            title="Public booking links"
            body="Custom /@handle URLs for Instagram + TikTok bios. Branded with your logo, banner, services, and policies."
            delay={0}
          />
          <FeatureCard
            tone="primary"
            icon={<Calendar size={22} />}
            title="Real-time calendar"
            body="Slot availability updates as you book — clients see exactly what's open, with the right service length and prep time built in."
            delay={100}
          />
          <FeatureCard
            tone="secondary"
            icon={<Hourglass size={22} />}
            title="Smart waitlist"
            body="When the calendar is full, clients join the waitlist with preferred dates. You convert openings into bookings with a tap."
            delay={200}
          />
          <FeatureCard
            tone="primary"
            icon={<CalendarClock size={22} />}
            title="Approval workflow"
            body="Requests land in your approval queue so you can vet new clients before confirming — no double-bookings, no surprises."
            delay={300}
          />
        </FeatureGrid>
      </Section>

      {/* Spotlight — action sheet + customizable calendar */}
      <AppointmentActionShowcase />
      <CalendarShowcase />

      {/* Pricing & Income */}
      <Section
        eyebrow="Pricing & Income Tools"
        title="Quote, collect, and reconcile in one flow."
        intro="From the pricing calculator that builds the quote to the Stripe Connect dashboard that pays it out — money moves through one polished pipeline."
        background="#FBFAFD"
      >
        <FeatureGrid>
          <FeatureCard
            tone="primary"
            icon={<Calculator size={22} />}
            title="Pricing calculator"
            body="Base price + variations + add-ons + length + density. Build a quote in 20 seconds, save it, and send it as a booking link."
          />
          <FeatureCard
            tone="primary"
            icon={<DollarSign size={22} />}
            title="Deposits at booking"
            body="Collect a deposit when the appointment is confirmed. Required, optional, or service-by-service — your call."
            delay={100}
          />
          <FeatureCard
            tone="secondary"
            icon={<CreditCard size={22} />}
            title="Stripe Connect"
            body="Direct charges land in your Stripe balance — no intermediaries. We handle the platform, you keep the money."
            delay={200}
          />
          <FeatureCard
            tone="primary"
            icon={<Receipt size={22} />}
            title="Saved quotes"
            body="Convert any quote into an appointment, a contract, or a deposit link. One source of truth from estimate to receipt."
            delay={300}
          />
        </FeatureGrid>
      </Section>

      {/* Client Management */}
      <Section
        eyebrow="Client Management"
        title="Every client, every visit, every dollar."
      >
        <FeatureGrid>
          <FeatureCard
            tone="soft-c"
            icon={<Users size={22} />}
            title="Client profiles"
            body="Visit history, preferences, lifetime spend, last hairstyle photo, contact info — all on one card."
          />
          <FeatureCard
            tone="primary"
            icon={<Sparkles size={22} />}
            title="VIP signals"
            body="Lifetime value, repeat-visit %, and inactivity alerts surface the clients who need rebooking outreach."
            delay={100}
          />
          <FeatureCard
            tone="secondary"
            icon={<RefreshCw size={22} />}
            title="Rebooking opportunities"
            body="A dashboard ranks the clients overdue for their next service — one tap pre-fills a draft text."
            delay={200}
          />
        </FeatureGrid>
      </Section>

      {/* Spotlight — easy access to client info */}
      <ClientInfoShowcase />

      {/* Policies & Contracts */}
      <Section
        eyebrow="Policies & Contracts"
        title="Set the rules once. Hold the line every time."
        background="#FBFAFD"
      >
        <FeatureGrid>
          <FeatureCard
            tone="primary"
            icon={<ScrollText size={22} />}
            title="Booking policies"
            body="Cancellation windows, no-show rules, late grace periods — surfaced on the booking page so every client agrees up front."
          />
          <FeatureCard
            tone="secondary"
            icon={<FileText size={22} />}
            title="E-sign contracts"
            body="Attach contracts to specific services or all of them. Clients sign on their phone — you get a PDF and a timestamp."
            delay={100}
          />
          <FeatureCard
            tone="primary"
            icon={<Tag size={22} />}
            title="Service variations"
            body="Different lengths, densities, hair-included pricing — each variation carries its own deposit and contract."
            delay={200}
          />
        </FeatureGrid>
      </Section>

      {/* Business Growth Tools */}
      <Section
        eyebrow="Business Growth Tools"
        title="Sell retail. See the trends. Get paid more."
      >
        <FeatureGrid>
          <FeatureCard
            tone="secondary"
            icon={<ShoppingBag size={22} />}
            title="Retail storefront"
            body="Your /@handle/shop with featured products, categories, variants, and per-variant stock. Customers check out via Stripe directly."
          />
          <FeatureCard
            tone="primary"
            icon={<TrendingUp size={22} />}
            title="Revenue dashboard"
            body="Today, this week, month profit, year made — the numbers stylists actually run their business on, no spreadsheet required."
            delay={100}
          />
          <FeatureCard
            tone="soft-c"
            icon={<BarChart3 size={22} />}
            title="Analytics insights"
            body="Top services, retention rates, average ticket, deposit collection rate — the levers that grow a chair-based business."
            delay={200}
          />
          <FeatureCard
            tone="primary"
            icon={<Wallet size={22} />}
            title="Boss Insights"
            body="Daily action prompts: who to follow up with, what's missing a deposit, which appointment to confirm — your AI assistant chair-side."
            delay={300}
          />
        </FeatureGrid>
      </Section>

      {/* Spotlight — track appointments by source */}
      <SourceOrbitShowcase />

      {/* Automation & Communication */}
      <Section
        eyebrow="Automation & Communication"
        title="Reminders that send themselves."
        background="#FBFAFD"
      >
        <FeatureGrid>
          <FeatureCard
            tone="primary"
            icon={<MessageSquare size={22} />}
            title="Text reminders (SMS)"
            body="Booking confirmations, a day-before and 2-hour reminder, balance nudges, and a post-visit review request — sent by text. Clients opt in at booking; you control it with one switch and prepaid credits."
          />
          <FeatureCard
            tone="secondary"
            icon={<Bell size={22} />}
            title="Reminder rules"
            body="Confirm the day of. Nudge a balance the morning after. Choose email, text, or both — set it once and it runs."
            delay={100}
          />
          <FeatureCard
            tone="primary"
            icon={<Mail size={22} />}
            title="Email automation"
            body="Order confirmations, deposit receipts, fulfillment updates — all on your brand, sent automatically."
            delay={200}
          />
          <FeatureCard
            tone="soft-c"
            icon={<Layers size={22} />}
            title="Style presets"
            body="Re-usable templates for the styles you book most. One tap pre-fills duration, price, and the contract."
            delay={300}
          />
        </FeatureGrid>
      </Section>

      {/* Mobile App Experience */}
      <Section
        eyebrow="Mobile App Experience"
        title="It feels like a native app, because it acts like one."
      >
        <FeatureGrid>
          <FeatureCard
            tone="primary"
            icon={<Smartphone size={22} />}
            title="PWA install"
            body="Add to home screen on iPhone or Android — the app launches without the browser bar, works offline, and looks like a native install."
          />
          <FeatureCard
            tone="secondary"
            icon={<Globe size={22} />}
            title="Pull to refresh"
            body="Pull-down gesture syncs your calendar, clients, and orders the moment you want a fresh look."
            delay={100}
          />
          <FeatureCard
            tone="primary"
            icon={<Sparkles size={22} />}
            title="Built for the chair"
            body="Big tap targets, no desktop-only menus, one-handed flows — the dashboard that runs your day fits in one hand."
            delay={200}
          />
        </FeatureGrid>
      </Section>

      <CtaFooter
        title="Run your braid business like a brand."
        body="Start with a 14-day free trial — every feature unlocked. Then $14.99/month. No contracts, cancel anytime."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "How it works", href: "/how-it-works" }}
      />
    </MarketingShell>
  );
}
