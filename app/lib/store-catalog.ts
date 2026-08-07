// Braid Boss Pro Store — first-party product catalog.
//
// This is the SINGLE SOURCE OF TRUTH for the platform's own store (the
// "Braid Boss Pro Store" of braider essentials — distinct from the
// multi-tenant braider shops at /@handle/shop). It's a small, curated
// catalog, so a typed config file beats a database table: prices, copy,
// images, FAQ, and the downloadable file path all live here and are read
// by the storefront pages, the checkout route, and the download route.
//
// SECURITY NOTE: the checkout route reads `priceCents` from THIS file as
// the authority — the client never sends a price. The download route
// reads `digitalFilePath` from here (not from the order row) so a product
// edited after a sale stops delivering, exactly like the tenant shop's
// live-product check.
//
// ─────────────────────────────────────────────────────────────────────
// TO GO LIVE with a product, fill in the fields marked `TODO`:
//   1. priceCents        — real price in cents (e.g. 1900 = $19.00)
//   2. image / gallery   — drop files in /public/store and reference them
//   3. digitalFilePath   — upload the file to the private `store-files`
//                          Supabase bucket, then put its object path here
//   4. active: true      — flip on when everything above is set
// ─────────────────────────────────────────────────────────────────────

export type StoreFaq = { q: string; a: string };

export type StoreProduct = {
  /** URL slug: /store/<slug>. Stable — it's referenced by orders. */
  slug: string;
  name: string;
  /** One-line hook shown under the name. */
  tagline: string;
  category: string;
  /** Optional pill shown on the card/hero (e.g. "New", "Bestseller"). */
  badge?: string;

  /** Price in cents. The checkout route trusts THIS, never the client. */
  priceCents: number;
  /** Optional strikethrough "was" price in cents. */
  compareAtCents?: number;
  currency: "usd";

  /** Downloadable product (delivered via signed URL + email). */
  isDigital: boolean;
  /**
   * Object path in the PRIVATE `store-files` Supabase bucket, e.g.
   * "planner/braid-boss-pro-business-planner.pdf". Required to actually
   * deliver a digital product; leave undefined until the file is uploaded.
   */
  digitalFilePath?: string;
  /** Filename the buyer's browser saves it as (Content-Disposition). */
  digitalFileName?: string;

  /** Hero/card image — a path under /public (e.g. "/store/planner.png")
   *  or an absolute URL. When absent, a branded placeholder renders. */
  image?: string;
  /** Extra images for the product-page gallery. */
  gallery?: string[];

  shortDescription: string;
  /** Long description, one string per paragraph. */
  longDescription: string[];
  /** Short benefit bullets (chips + spotlight list). */
  highlights: string[];
  /** "What's inside" checklist. */
  whatsInside?: string[];
  /** "What you get" delivery list (files, bonuses). */
  whatYouGet?: string[];
  /** "What you'll need" requirements. */
  requirements?: string[];
  /** Short "who it's for" blurb. */
  whoItsFor?: string;
  /** License / refund / fine-print note. */
  policyNote?: string;
  /** Product FAQ — also emitted as FAQPage JSON-LD for SEO. */
  faqs?: StoreFaq[];
  /** SEO keywords for the product page. */
  keywords?: string[];

  /** Featured on the store landing hero. */
  featured?: boolean;
  /** Only `active` products are purchasable / listed. */
  active: boolean;
};

// ── The catalog ──────────────────────────────────────────────────────
// First product: the digital planner. Placeholders are marked TODO and
// are safe to ship — the storefront shows a "Coming soon" state and the
// checkout route refuses to sell an inactive or unpriced product, so a
// half-configured product can never take money.
export const STORE_PRODUCTS: StoreProduct[] = [
  {
    slug: "braid-boss-business-planner",
    name: "The Braid Boss Pro Business Planner",
    tagline:
      "A fully hyperlinked digital planner built for professional braiders — bookings, income, clients, taxes and growth in one tappable file for GoodNotes and iPad.",
    category: "Digital Planners",
    badge: "New",

    // Introductory launch price $19.00, anchored against the $39.99 regular
    // price (shown struck through on the storefront).
    priceCents: 1900,
    compareAtCents: 3999,
    currency: "usd",

    isDigital: true,
    // Object path in the private `store-files` bucket (uploaded via the
    // Supabase dashboard). digitalFileName is what the buyer's browser
    // saves it as (Content-Disposition), independent of the storage path.
    digitalFilePath: "Braid_Boss_Pro_Business_Planner_DIGITAL.pdf",
    digitalFileName: "The Braid Boss Pro Business Planner.pdf",

    // Real product mockups in /public/store. Hero = cover-on-iPad with the
    // 111 pages / 2,200+ links / 12 months stat bar.
    image: "/store/planner-hero.jpg",
    gallery: [
      "/store/planner-tap-to-jump.jpg",
      "/store/planner-write-on-it.jpg",
      "/store/planner-pages-overview.jpg",
      "/store/planner-worksheets.jpg",
      "/store/planner-dashboard-bonus.jpg",
    ],

    shortDescription:
      "A fully hyperlinked digital planner built for professional braiders — bookings, income, clients, taxes and growth in one tappable file for GoodNotes and iPad.",
    longDescription: [
      "You are not disorganized. You have just been running a real business out of your DMs, your notes app and your head.",
      "This is the planner I wish I'd had. Not a pretty calendar with a hair graphic slapped on it — an actual business system, built by a braider, for the way braiding actually works. Nine-hour installs. Deposits that walk. Cash tips nobody logs. A February so slow it makes you question everything.",
      "It is fully hyperlinked, so it works like an app. Tap a tab, land on the page. No scrolling, no hunting, no page-flipping through 111 pages to find October.",
      "You write in your own dates, so you can start today, start in June, and use it again next year. It never expires.",
    ],
    highlights: [
      "111 pages, fully hyperlinked — tap a tab, land on the page",
      "Over 2,200 working links — it works like an app",
      "Write-in dates — start any month, reuse every year, never expires",
      "Built for GoodNotes, Notability & Noteshelf on iPad (Xodo/Noteshelf on Android)",
      "FREE bonus: the live Braid Boss Dashboard (Google Sheets & Excel)",
      "Instant download — buy once, use forever, no subscription",
    ],
    whatsInside: [
      "Home dashboard — every section one tap away",
      "Year at a glance — all 12 months, goals vs. actuals, tax set aside",
      "Annual goals & blueprint — quarterly targets, your vision, your why",
      "7 pages per month: overview + 4 weekly spreads + money page + reflection",
      "Client profiles — scalp sensitivities, patch-test dates, photo consent",
      "Client intake & consent — including the under-18 guardian section",
      "Booking & cancellation policy builder",
      "Pricing calculator — the formula, plus five styles side by side",
      "Slow-season planner — find your slow months, plan them 60 days early",
      "Hair safety & supplier log — protocol, vetting questions, patch-test log",
      "The six numbers — revenue per hour, rebook rate, service profitability",
      "Retail, classes & digital income · mileage, tips & tax",
      "Booking platform & tech audit · content planner · self-care check-in",
      "8 note pages — lined and dot grid",
    ],
    whatYouGet: [
      "The planner — 111 pages, hyperlinked, write-in dates, instant download",
      "FREE bonus — the Braid Boss Dashboard, a live spreadsheet that does the maths for you (Google Sheets & Excel)",
      "A Start Here guide — how to import it and how the tabs work",
      "This is a digital product. Nothing is shipped — you download it immediately after purchase.",
    ],
    requirements: [
      "A tablet — an iPad with an Apple Pencil is ideal; Android tablets work too",
      "A note-taking app: GoodNotes, Notability or Noteshelf (iPad), or Xodo or Noteshelf (Android)",
      "A stylus (a finger works, but writing will feel rough)",
      "Not designed for a phone — the screen is too small to write on comfortably",
    ],
    whoItsFor:
      "Braiders, loticians, natural hair stylists and stylists who take clients — whether you work from a home studio, a suite, a salon or out of your car. Works whether you're taking your third client or your three-hundredth.",
    policyNote:
      "Licence: for personal use by one braider. Not for resale, redistribution or sharing. Because this is an instant digital download, all sales are final — please check the “What you'll need” list before you buy, and if anything gives you trouble getting set up, message us and we'll help. This planner is standalone: it does not require a Braid Boss Pro subscription and nothing in it stops working. Buy it once, use it forever.",
    faqs: [
      {
        q: "Does this work on my iPhone?",
        a: "It will open, but you won't enjoy it. This is built for a tablet screen. On a phone you'll spend the whole time pinching and zooming.",
      },
      {
        q: "Does it work on Android?",
        a: "Yes. Use Xodo or Noteshelf. The hyperlinks work in both.",
      },
      {
        q: "Will it expire?",
        a: "No. You write your own dates into the calendar boxes, so you can start any month of any year and use the same file again next year.",
      },
      {
        q: "Can I print it?",
        a: "Yes — any page prints at 11 x 8.5 landscape if you want a paper copy of a worksheet.",
      },
      {
        q: "Do the tabs really work?",
        a: "Yes. Over 2,200 working links. If a tab does nothing, you're viewing the file in a PDF reader like Files or Books instead of a note-taking app — that's the number one setup issue, and the Start Here guide walks you through it.",
      },
      {
        q: "Can I use this if I'm not a braider?",
        a: "Absolutely. Loticians, natural hair stylists and anyone who takes appointments will use nearly all of it. A few worksheets are braid-specific.",
      },
      {
        q: "Can I resell or share it?",
        a: "No. The licence is for personal use by one braider — not for resale, redistribution or sharing. Please send your friend the link instead of the file.",
      },
      {
        q: "Do I need a Braid Boss Pro subscription to use this?",
        a: "No. It's a standalone product and works completely on its own.",
      },
    ],
    keywords: [
      "digital planner",
      "goodnotes planner",
      "hair braider",
      "braiding business",
      "reusable planner",
      "ipad planner",
      "hyperlinked planner",
      "salon planner",
      "stylist planner",
      "hairstylist business",
      "natural hair",
      "client tracker",
      "income tracker",
      "small business planner",
    ],

    featured: true,
    // LIVE: file ✓, price ✓ ($19 intro / $39.99 anchor), images ✓.
    // The planner is purchasable — checkout charges the platform Stripe
    // account and delivers the PDF by email + secure signed URL.
    active: true,
  },
];

// ── Lookups & helpers ────────────────────────────────────────────────

/** All products meant to be shown on the storefront (active OR featured
 *  "coming soon" launch items). */
export const listStoreProducts = (): StoreProduct[] =>
  STORE_PRODUCTS.filter((p) => p.active || p.featured);

/** Only products that can actually be sold right now. */
export const listPurchasableProducts = (): StoreProduct[] =>
  STORE_PRODUCTS.filter(isPurchasable);

export const getStoreProduct = (slug: string): StoreProduct | undefined =>
  STORE_PRODUCTS.find((p) => p.slug === slug);

/** A product is purchasable only when it's active AND fully configured —
 *  priced, and (if digital) has a file to deliver. This is the gate the
 *  checkout route enforces so a placeholder can never charge a card. */
export const isPurchasable = (p: StoreProduct | undefined): p is StoreProduct =>
  !!p &&
  p.active &&
  Number.isFinite(p.priceCents) &&
  p.priceCents > 0 &&
  (!p.isDigital || !!p.digitalFilePath);

/** Effective unit price in cents (kept trivial now; leaves room for
 *  future variants/sale windows without touching call sites). */
export const unitPriceCents = (p: StoreProduct): number => p.priceCents;

/** Format cents as USD, e.g. 2700 → "$27". Whole-dollar amounts drop the
 *  ".00" for a cleaner storefront look; anything with cents keeps them. */
export const formatPrice = (cents: number, currency = "usd"): string => {
  const dollars = cents / 100;
  const hasCents = Math.round(cents) % 100 !== 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(dollars);
};
