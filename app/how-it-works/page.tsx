import type { Metadata } from "next";
import {
  UserPlus,
  Wrench,
  Clock,
  CreditCard,
  Share2,
  Smartphone,
  Sparkles,
  Share,
  Plus,
  MoreVertical,
  ChevronDown,
} from "lucide-react";
import {
  MarketingShell,
  MarketingHero,
  Section,
  CtaFooter,
} from "../components/marketing/MarketingShell";
import { StepCard, PhoneMockup } from "../components/marketing/StepCard";
import { C, FONT_DISPLAY, GRADIENTS, SHADOWS } from "../components/marketing/tokens";

export const metadata: Metadata = {
  title: "How It Works · Braid Boss Pro — the business OS for braiders",
  description:
    "How Braid Boss Pro works — the business operating system for braiders. Bookings, deposits, Stripe Connect, retail storefronts, PWA install on iPhone + Android. Set up in under 10 minutes.",
  alternates: { canonical: "/how-it-works" },
  keywords: [
    "braid business software",
    "braid business management app",
    "booking app for braiders",
    "braider booking software",
    "braider scheduling app",
    "braid Stripe Connect setup",
    "braid storefront app",
    "PWA install braider app",
  ],
  openGraph: {
    title: "How It Works · Braid Boss Pro",
    description:
      "How the business OS for braiders works — bookings, deposits, Stripe Connect, retail storefronts, and PWA install on iPhone + Android.",
    url: "/how-it-works",
    siteName: "Braid Boss Pro",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "How It Works · Braid Boss Pro",
    description:
      "How the business OS for braiders works — bookings, deposits, Stripe Connect, retail storefronts.",
  },
};

export default function HowItWorksPage() {
  return (
    <MarketingShell>
      <MarketingHero
        eyebrow="How Braid Boss Pro works"
        title={
          <>
            From sign-up to deposits{" "}
            <em
              style={{
                fontStyle: "italic",
                background: "linear-gradient(135deg, #7C3AED 0%, #FF4D6D 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              in under 10 minutes.
            </em>
          </>
        }
        body="Braid Boss Pro is the business operating system for braiders — branded booking links, deposits, contracts, retail storefronts, and a mobile dashboard built around how braid stylists run their chairs. This is the path from a new account to a shareable booking link."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See the platform", href: "/features" }}
      />

      {/* Steps 1-5 */}
      <Section
        eyebrow="The setup checklist"
        title="Five steps to live."
        intro="Knock these out in order and your booking link is shareable by the end."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <StepCard
            number={1}
            icon={<UserPlus size={18} />}
            title="Create your account"
            body={
              <>
                Sign up with your email — the dashboard opens to a guided
                walkthrough. Start with a 14-day free trial; every feature
                unlocked from day one.
              </>
            }
            cta={{ label: "Sign up", href: "/" }}
            delay={0}
          />
          <StepCard
            number={2}
            icon={<Wrench size={18} />}
            title="Add your services"
            body={
              <>
                Settings → Services → +Add. Set the name, duration, base price,
                and any variations (length, density, hair-included). Attach a
                contract or a deposit per service.
              </>
            }
            delay={100}
          />
          <StepCard
            number={3}
            icon={<Clock size={18} />}
            title="Set your availability"
            body={
              <>
                Settings → Availability. Choose the days you work, the hours per
                day, and any blackout dates. The booking calendar pulls from
                here in real time.
              </>
            }
            delay={200}
          />
          <StepCard
            number={4}
            icon={<CreditCard size={18} />}
            title="Connect Stripe"
            body={
              <>
                Settings → Payments → Connect Stripe. Direct charges land in
                your Stripe balance — we don&apos;t sit between you and your money.
                Stripe handles deposits, balances, refunds, and 1099s.
              </>
            }
            delay={300}
          />
          <StepCard
            number={5}
            icon={<Share2 size={18} />}
            title="Share your booking link"
            body={
              <>
                Settings → Customize booking page → set your studio name + logo
                + handle. Your link becomes <strong>braidbosspro.app/@yourname</strong>{" "}
                — paste it into your Instagram and TikTok bios.
              </>
            }
            delay={400}
          />
        </div>
      </Section>

      {/* Step 6: PWA install — beautiful visual cards */}
      <Section
        id="install"
        eyebrow="Step 6 · Install on your phone"
        title="Make it feel like a real app."
        intro="Braid Boss Pro is a Progressive Web App — install it from your phone's browser and it launches like any native app, with no app-store wait. Choose your phone below."
        background="#FBFAFD"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <InstallCard
            tone="ios"
            label="iPhone · Safari"
            steps={[
              {
                icon: <Share size={18} />,
                copy: "Open braidbosspro.app in Safari. Tap the Share icon at the bottom of the screen.",
              },
              {
                icon: <Plus size={18} />,
                copy: "Scroll down in the share sheet and tap Add to Home Screen.",
              },
              {
                icon: <Sparkles size={18} />,
                copy: "Confirm the name and tap Add. The app icon lands on your home screen instantly.",
              },
            ]}
          />
          <InstallCard
            tone="android"
            label="Android · Chrome"
            steps={[
              {
                icon: <MoreVertical size={18} />,
                copy: "Open braidbosspro.app in Chrome. Tap the ⋮ menu in the top-right.",
              },
              {
                icon: <Plus size={18} />,
                copy: "Tap Install app (or Add to Home Screen on older versions of Chrome).",
              },
              {
                icon: <Sparkles size={18} />,
                copy: "Tap Install in the dialog. The app icon lands on your home screen.",
              },
            ]}
          />
        </div>
      </Section>

      {/* Step 7: tips */}
      <Section
        eyebrow="Step 7 · Best experience tips"
        title="A few things stylists wish they did from day one."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <StepCard
            number={7}
            icon={<Sparkles size={18} />}
            title="Use the home-screen install"
            body={
              <>
                The installed app gets faster load times, push-notification
                support, and a full-screen UI. Skip Safari/Chrome&apos;s URL bar
                forever.
              </>
            }
            delay={0}
          />
          <StepCard
            number={8}
            icon={<Smartphone size={18} />}
            title="Set a branded handle"
            body={
              <>
                In <strong>Customize booking page</strong>, set a public handle
                like <code>@sbwbraiding</code>. Your booking link and storefront
                URLs both use it.
              </>
            }
            delay={100}
          />
          <StepCard
            number={9}
            icon={<Wrench size={18} />}
            title="Turn on reminders"
            body={
              <>
                Settings → Reminders. The night-before text + day-of confirmation
                cuts no-shows by ~40% on average — the single best ROI button in
                the app.
              </>
            }
            delay={200}
          />
          <StepCard
            number={10}
            icon={<CreditCard size={18} />}
            title="Set your deposit policy"
            body={
              <>
                Settings → Booking policy. Most stylists require a 25–50%
                deposit; non-refundable deposits dramatically reduce no-shows
                and protect your time block.
              </>
            }
            delay={300}
          />
        </div>
      </Section>

      {/* FAQ */}
      <Section
        eyebrow="FAQ"
        title="Common questions, answered."
        background="#FBFAFD"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Faq q="Is Braid Boss Pro free?">
            Creating an account is free. You pay nothing for the dashboard or
            booking link. We charge a small platform fee on bookings + retail
            orders that pay through Stripe; you can see exact pricing in the
            app before connecting Stripe.
          </Faq>
          <Faq q="Do I need an app-store download?">
            No. Braid Boss Pro runs in your phone&apos;s browser and installs to your
            home screen as a PWA. Step 6 above shows how — iPhone Safari and
            Android Chrome both support it natively.
          </Faq>
          <Faq q="Who holds my money?">
            You do. Stripe Connect routes payments directly to your own Stripe
            account — we never custody your funds. You see deposits and balances
            in your Stripe dashboard the same day.
          </Faq>
          <Faq q="Can I import my existing clients?">
            Yes. Settings → Clients → Import. Paste names + numbers + emails
            from a spreadsheet and we&apos;ll de-duplicate against your existing
            book.
          </Faq>
          <Faq q="What if I don't take deposits yet?">
            Deposits are optional per service. You can run the entire calendar
            + client + retail workflow without a single deposit.
          </Faq>
          <Faq q="Does the storefront need Stripe?">
            Only if you want to take card payments. You can list products as
            external-checkout (we redirect to Shopify, Etsy, etc.) or
            local-pickup-only without connecting Stripe.
          </Faq>
        </div>
      </Section>

      <CtaFooter
        title="Ten minutes to live. Try it free for 14 days."
        body="Every feature unlocked from day one. Then $14.99/month. No contracts, cancel anytime."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "Browse features", href: "/features" }}
      />
    </MarketingShell>
  );
}

// ---- Local-only components -------------------------------------------------

// Install card — phone mockup + numbered substeps. Different label
// for the PhoneMockup notch shape (iOS pill vs Android dot).
const InstallCard = ({
  tone,
  label,
  steps,
}: {
  tone: "ios" | "android";
  label: string;
  steps: Array<{ icon: React.ReactNode; copy: React.ReactNode }>;
}) => (
  <article
    className="bbp-reveal"
    style={{
      background: C.paper,
      border: `1px solid ${C.brandBorder}`,
      borderRadius: 24,
      padding: 24,
      boxShadow: SHADOWS.card,
      display: "flex",
      gap: 20,
      alignItems: "flex-start",
      flexWrap: "wrap",
    }}
  >
    <div style={{ width: 140, flexShrink: 0 }}>
      <PhoneMockup tone={tone} label={label} />
    </div>
    <div style={{ flex: 1, minWidth: 220 }}>
      <p
        style={{
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: C.brandPrimary,
          margin: 0,
        }}
      >
        {label}
      </p>
      <h3
        style={{
          fontFamily: FONT_DISPLAY,
          fontWeight: 700,
          fontSize: 22,
          color: C.ink,
          margin: "6px 0 14px",
          lineHeight: 1.15,
        }}
      >
        Three taps to install
      </h3>
      <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        {steps.map((s, i) => (
          <li key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span
              aria-hidden
              style={{
                flexShrink: 0,
                width: 30,
                height: 30,
                borderRadius: 10,
                background: GRADIENTS.softA,
                display: "grid",
                placeItems: "center",
                color: C.brandPrimary,
              }}
            >
              {s.icon}
            </span>
            <p style={{ color: C.coffee, fontSize: 13.5, lineHeight: 1.55, margin: 0 }}>
              <span style={{ fontWeight: 700, color: C.ink, marginRight: 4 }}>
                {String(i + 1).padStart(2, "0")}.
              </span>
              {s.copy}
            </p>
          </li>
        ))}
      </ol>
    </div>
  </article>
);

// FAQ row — native <details> for free expand/collapse without state.
const Faq = ({ q, children }: { q: string; children: React.ReactNode }) => (
  <details
    className="bbp-reveal bbp-faq"
    style={{
      background: C.paper,
      border: `1px solid ${C.brandBorder}`,
      borderRadius: 16,
      padding: "16px 18px",
      boxShadow: SHADOWS.card,
    }}
  >
    <summary
      style={{
        cursor: "pointer",
        listStyle: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        fontWeight: 700,
        fontSize: 15,
        color: C.ink,
      }}
    >
      <span>{q}</span>
      <ChevronDown size={16} className="bbp-faq-chevron" style={{ color: C.muted, flexShrink: 0, transition: "transform 200ms ease" }} />
    </summary>
    <div style={{ marginTop: 10, color: C.coffee, fontSize: 14, lineHeight: 1.6 }}>{children}</div>
    <style>{`
      details.bbp-faq[open] .bbp-faq-chevron { transform: rotate(180deg); }
      details.bbp-faq summary::-webkit-details-marker { display: none; }
    `}</style>
  </details>
);
