# Braid Boss Pro — Product Strategy

*Prepared by the product team · 2026-06-15*

> **One-liner:** Braid Boss Pro is the **business operating system for braiders** — the
> one app that books the client, quotes the style, takes the deposit, signs the contract,
> runs the chair, and tells the braider what they actually made.

This document is the strategic frame for the next 12–18 months. It is grounded in the
product as it exists today (see `docs/build_your_style_and_profit.md`,
`docs/b12_*` notification specs, and `docs/tap_to_pay_*`), not on a blank page.

---

## 1. Where we are today (honest baseline)

Braid Boss Pro is already a deep, shipped product — not a prototype. Core surface area:

- **Booking** — branded `/@handle` page, real-time availability, waitlist, approval/vetting,
  service variations (length/density/hair-included), custom intake, ICS export.
- **Payments** — Stripe Connect (deposits, balances, no-show fees, same-day payout),
  Stripe Tax, and **Tap to Pay on iPhone** (Apple entitlement granted, Case-ID 20421391;
  repo-complete, pending App Review submission).
- **Money intelligence** — hair/supply **recipe costing**, auto-inventory deduction on
  appointment completion, and a **profit-per-hour** ranking of styles.
- **Contracts** — reusable templates, e-sign by token, full lifecycle + audit trail (B12.0).
- **Retail** — public storefront, variants/stock, Shippo labels + tracking.
- **Comms** — email queue live (Resend); SMS fully coded, gated on Twilio A2P 10DLC setup.
- **AI suite (Claude)** — Booking Concierge, **Build Your Style** vision quoting,
  Rebooking/win-back composer, Social Content Studio, daily Business Coach briefing.
- **Distribution** — PWA + Capacitor iOS wrapper; SEO compare pages vs Square/StyleSeat/Vagaro.

**Pricing today:** 14-day trial → **$14.99/mo or $149/yr**, no per-staff fees;
SMS sold as prepaid credit packs; optional `PLATFORM_FEE_BPS` on payments.

**The strategic reality:** we have built more product than we have built *market*. The
next phase is less about new surface area and more about **proving the wedge, monetizing
the value we already deliver, and acquiring braiders repeatably.**

---

## 2. Market & customer

### Who we serve (ICP)
The **independent, profitability-conscious braider** — solo or micro-team (1–4 chairs),
often home/suite/mobile-based, acquiring clients through Instagram and TikTok DMs, and
currently running the business on a tangle of DMs, a Cash App tag, a paper book or
Google Calendar, and a calculator app.

**Segments, in priority order:**
1. **The serious solo pro** (primary) — full or near-full books, treats braiding as a
   business, feels the pain of no-shows, unpaid deposits, and "did I actually make money?"
2. **The rising creator-braider** — strong social following, inconsistent ops, wants to
   look professional and convert DMs into booked deposits.
3. **The small braiding studio / booth-rental shop** (expansion) — 2–4 braiders, needs
   light multi-stylist coordination. *Not* the initial wedge, but the upsell ceiling.

### Why this market is attractive
- **Underserved vertical.** Generic salon tools (Square, Vagaro, GlossGenius, Fresha,
  StyleSeat) treat braiding as a generic "service." Braiding is quoted differently
  (style + length + density + hair included), costs differently (you buy the hair), and
  is sold differently (inspo photos in DMs). Horizontal tools paper over all three.
- **High frequency + high ticket.** Multi-hour appointments, $100–$400+ tickets, recurring
  6–10 week rebooking cadence — strong unit economics for both the braider and us.
- **Cash + DM leakage.** Money and bookings live in DMs and Cash App today. Every dollar
  we move onto rails is measurable, monetizable, and sticky.

### The core customer pains we uniquely answer
| Pain | Today's hack | Braid Boss Pro |
| --- | --- | --- |
| "What's this style cost?" 40 DMs/day | Manual back-and-forth | **Build Your Style** AI vision quote, catalog-anchored |
| No-shows & ghosting | "Deposit to my Cash App" | Deposit-at-booking + contracts + no-show charge |
| "Did I actually make money?" | Gut feel | Recipe cost → **profit-per-hour** report |
| Forgetting to rebook clients | Memory | Rebooking dashboard + AI win-back |
| Looking unprofessional | Linktree + DMs | Branded booking page + storefront |

---

## 3. Positioning & the wedge

**Positioning statement:**
> For independent braiders who run their entire business out of their DMs, Braid Boss Pro
> is the business operating system that turns inspo-photo inquiries into paid, contracted
> bookings — and shows you the profit on every style. Unlike generic salon software, it
> speaks braiding natively: photo-to-quote, hair-cost recipes, and profit-per-hour.

**The wedge is two braider-native capabilities competitors do not have:**
1. **Build Your Style** — client uploads an inspiration photo, AI returns a quote anchored
   to *this braider's* real catalog. This is the top-of-funnel magnet and the most
   demo-able, shareable hook.
2. **Profit-per-hour costing** — because braiders supply the hair, gross revenue lies.
   We turn the recipe data we already collect into the one number that changes behavior.

Everything else (booking, payments, contracts, retail) is **table stakes we already have**
and must be best-in-class — but the wedge is what gets a braider to switch and tell a friend.

**Strategic principle:** *Win on the two things only a braiding-native product can do; reach
parity on everything else; never out-feature horizontal incumbents on their own turf.*

---

## 4. Strategic pillars (next 12–18 months)

### Pillar 1 — Make the wedge undeniable (Acquisition)
Build Your Style is our front door. Optimize it as a standalone, shareable, viral-friendly
experience: fast, accurate quotes; a branded "get your quote" link a braider drops in their
IG bio; quote-to-deposit conversion as the headline metric. Every quote is a lead.

### Pillar 2 — Own the money (Monetization & retention)
We already touch deposits, balances, no-show fees, and Tap to Pay. The strategy is to make
Braid Boss Pro the place the money *moves through*, not just where it's scheduled. Ship
Tap to Pay to the App Store, light up payments revenue, and make profit reporting the
weekly habit that makes churn feel like flying blind.

### Pillar 3 — Activate and retain, not just acquire (Lifecycle)
A solo braider who imports clients, takes one deposited booking, and runs one profit report
is activated and likely to stay. Instrument and engineer that path. Turn the AI Business
Coach and rebooking tools into the weekly re-engagement loop.

### Pillar 4 — Earn the right to expand (Studio & ecosystem)
Once we own the solo braider, expand *up* (micro-studios, booth rental) and *sideways*
(a discovery/marketplace surface, hair/supply commerce). Do not start here — it dilutes the
wedge — but design the data model so it's the obvious next chapter.

---

## 5. North Star & metric tree

**North Star Metric:** **Booked, deposited revenue processed per active braider per month.**
It captures the whole value chain — a braider only grows this if they acquire clients
(Build Your Style), convert them (booking + deposit), and keep them (rebooking) — and it
correlates directly with our own monetization.

**Supporting metrics:**
- *Acquisition:* Build Your Style quotes generated → quote-to-booking rate.
- *Activation:* % of new accounts reaching **"first deposited booking"** within 14 days
  (proposed activation milestone — instrument this if not already tracked).
- *Engagement:* weekly active braiders viewing a profit/coach report.
- *Monetization:* paid conversion off trial; payments GPV; SMS credit attach.
- *Retention:* logo churn; net revenue retention (paid plan + payments + SMS).

---

## 6. Roadmap — Now / Next / Later

### NOW (0–3 months) — unblock revenue & prove the wedge
1. **Ship Tap to Pay to the App Store.** It's repo-complete; remaining work is operational
   (Xcode SDK wiring, device testing, demo videos, remove dev restriction, submit). This
   unlocks in-person payments revenue and a marquee differentiator.
2. **Light up SMS (Twilio A2P 10DLC).** Reminders are the single biggest no-show lever and
   the code is shipped — only carrier registration blocks it. High ROI, low build cost.
3. **Instrument the funnel.** Define and track activation ("first deposited booking"),
   quote→booking, and trial→paid. We cannot optimize what we don't measure.
4. **Productize Build Your Style as a shareable link** with a clean "get a quote" CTA for
   IG bios. Make the wedge a standalone growth surface.

### NEXT (3–9 months) — monetize value & introduce tiers
5. **Pricing & packaging refresh** (see §7). Introduce tiers; price the wedge and the money
   features for what they're worth.
6. **Activation & onboarding overhaul** — guided setup (catalog + recipes + first booking
   link) so a braider reaches value in one sitting; client CSV import front-and-center.
7. **Profit habit loop** — weekly "your numbers" digest (email/SMS/push) powered by the
   Business Coach; make profit-per-hour the reason they open the app every week.
8. **Referral program** — braider-to-braider is the cheapest channel in this community.

### LATER (9–18 months) — expand the ceiling
9. **Studio mode** — light multi-braider scheduling, booth-rental splits, role permissions.
10. **Discovery/marketplace** — a curated braider directory (the existing `/discover`
    surface) that turns our braider supply into client demand — a true network effect.
11. **Commerce expansion** — hair/supply ordering tied to recipes & low-stock alerts
    (we already track inventory); a path to product/affiliate margin.

---

## 7. Monetization strategy

**Today:** one flat $14.99/mo plan + SMS credits + optional payment fee. Simple, but it
**leaves money on the table** — the heaviest users (full books, high GPV, multi-stylist) pay
the same as a hobbyist, and our most differentiated value (AI, profit, payments) isn't priced.

**Recommended evolution — value-metric tiering plus payments take-rate:**

| Tier | Target | Indicative price | Headline value |
| --- | --- | --- | --- |
| **Starter** | New / part-time braider | ~$14.99/mo (today's price) | Booking page, deposits, contracts, basic reminders |
| **Pro** *(flagship)* | Serious solo pro | ~$29–39/mo | Everything + full AI suite (Build Your Style, win-back, content), profit reports, Tap to Pay, priority SMS |
| **Studio** | 2–4 braiders | ~$59–79/mo + per-extra-seat | Multi-stylist, splits, advanced analytics |

Plus two usage layers that scale with the value we deliver:
- **Payments** — a modest platform fee on processed volume (`PLATFORM_FEE_BPS` already
  exists). This is the line that grows with the customer's success and is the long-term
  margin engine. Price it transparently and keep it fair.
- **SMS credits** — keep as metered add-on; bundle an allowance into Pro/Studio.

**Sequencing:** don't re-tier before §6-NOW lands. First make the AI/payments/profit value
*visible and habitual*, then introduce tiers so the upgrade is obviously worth it. Grandfather
existing/founding members to protect goodwill in a tight-knit community.

---

## 8. Go-to-market

- **Creator-led / community-led is the channel.** Braiders trust other braiders. Seed
  with respected braider-creators; arm them with Build Your Style links and referral codes.
  Word-of-mouth and "what booking app do you use?" comments are the flywheel.
- **Content & SEO** — the `/compare` and `/guides` pages are a real asset; expand
  comparison and "how to price/quote braids" content that ranks and converts.
- **The product is the demo.** Build Your Style is inherently shareable — a braider posting
  "get your quote here" *is* our marketing. Lean into product-led growth over paid ads.
- **Migration on-ramp** — frictionless client import + booking-link setup so switching from
  DMs/StyleSeat is a 20-minute job, not a weekend.

---

## 9. Risks & mitigations

| Risk | Severity | Mitigation |
| --- | --- | --- |
| **Tap to Pay App Review** delays in-person payments | High | Treat as a NOW priority with a clear checklist owner; payments revenue gated on it |
| **TCPA / A2P 10DLC** SMS compliance | High | Already engineered defensively (opt-in, STOP, per-user master switch); complete carrier registration before scaling sends |
| **AI cost & accuracy** (vision quoting at scale) | Medium | Catalog-anchored pricing (no invented prices), rate limits + cost guards already in place; monitor unit cost per quote |
| **Incumbent response** (GlossGenius/StyleSeat ship braider features) | Medium | Move fast on the wedge + community moat; depth of recipe/profit data is hard to copy quickly |
| **Solo-braider churn / seasonality** | Medium | Drive activation depth (deposits, profit habit, payments lock-in) so the tool is mission-critical, not seasonal |
| **Single flat price undermonetizes** | Medium | Tiering + payments take-rate (§7) |
| **Key-person / ops concentration** (Apple entitlement, Stripe, Twilio under one LLC) | Medium | Document operational dependencies; ensure continuity on the regulated accounts |

---

## 10. The 90-day plan in one paragraph

Ship Tap to Pay to the App Store and turn on SMS — both are built and only operationally
blocked, and both directly unlock revenue and retention. Instrument the funnel end-to-end and
define activation as *first deposited booking*. Productize Build Your Style as a shareable
quote link and make it the top of the funnel. With those in place, we'll have a measured,
monetizable loop — acquire via the wedge, convert via deposits, retain via profit — and the
data to confidently introduce tiered pricing and a payments take-rate next.

---

### Appendix — strategic bets, stated plainly
1. **Braiding-native beats horizontal.** The wedge (photo-to-quote + profit-per-hour) is
   defensible *because* it's specific. We will not win by being a cheaper Square.
2. **Owning the money is the moat.** Scheduling is copyable; being the rails the deposits
   and payments flow through is sticky and compounding.
3. **The community is the channel.** Braiders sell Braid Boss Pro to braiders. The product,
   not the ad account, is the growth engine.
