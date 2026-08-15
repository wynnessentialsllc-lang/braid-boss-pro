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
export type StoreImage = { src: string; alt: string };

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
  /**
   * PRIVATE Supabase Storage bucket that holds `digitalFilePath`. Defaults
   * to "store-files" (where the planner lives) when omitted, so existing
   * products need no change. Set this per-product when a file was uploaded
   * to a different private bucket. The download route reads it as the
   * authority and mints the signed URL from this bucket.
   */
  storageBucket?: string;

  /** Hero/card image — a path under /public (e.g. "/store/planner.png")
   *  or an absolute URL. Used by the landing card, OG image, Product
   *  JSON-LD, and as the first image in the product-page gallery. When
   *  absent, a branded placeholder renders. */
  image?: string;
  /** Alt text for the hero image. */
  imageAlt?: string;
  /** Additional images (beyond the hero) for the product-page gallery. */
  gallery?: StoreImage[];

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

    // Introductory launch price $19.00, anchored against the $29.00 regular
    // price (shown struck through on the storefront).
    priceCents: 1900,
    compareAtCents: 2900,
    currency: "usd",

    isDigital: true,
    // Object path in the private `store-files` bucket (uploaded via the
    // Supabase dashboard). digitalFileName is what the buyer's browser
    // saves it as (Content-Disposition), independent of the storage path.
    digitalFilePath: "Braid_Boss_Pro_Business_Planner_DIGITAL.pdf",
    digitalFileName: "The Braid Boss Pro Business Planner.pdf",

    // Real product mockups in /public/store/planner (2000×2000). Hero =
    // cover-on-iPad with the 111 pages / 2,200+ links / 12 months stat bar.
    image: "/store/planner/1_hero.jpg",
    imageAlt: "Braid Boss Pro Business Planner cover on an iPad",
    gallery: [
      { src: "/store/planner/2_hyperlinked.jpg", alt: "Tabbed navigation — tap a tab, land on the page" },
      { src: "/store/planner/3_write_on_it.jpg", alt: "Write directly on it with an Apple Pencil" },
      { src: "/store/planner/4_whats_inside.jpg", alt: "111 pages — what is inside the planner" },
      { src: "/store/planner/5_six_worksheets.jpg", alt: "Six worksheets built for 2026" },
      { src: "/store/planner/6_free_dashboard.jpg", alt: "Free Braid Boss Dashboard included" },
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

    featured: true,
    // LIVE: file ✓, price ✓ ($19 intro / $29 regular), images ✓.
    // The planner is purchasable — checkout charges the platform Stripe
    // account and delivers the PDF by email + secure signed URL.
    active: true,
  },

  // Second product: the Braid Boss Pro Sticker Pack — 34 designs, each in
  // 3 versions (102 transparent PNGs), delivered as one zip.
  {
    slug: "braid-boss-pro-sticker-pack",
    name: "Braid Boss Pro Sticker Pack",
    tagline:
      "34 digital planner stickers made for braiders — deposits, no-shows, rebookings, tax set-asides and the mindset ones — in transparent PNG for GoodNotes, Notability and Canva.",
    category: "Digital Stickers",
    badge: "New",

    // $8 in the shop (the copy's recommended shop price). Launch at full
    // price and run a discount rather than listing low, so no compareAt.
    priceCents: 800,
    currency: "usd",

    isDigital: true,
    // The sticker zip was uploaded to a dedicated PRIVATE bucket
    // ("sticker-bucket") rather than the shared store-files bucket.
    storageBucket: "sticker-bucket",
    // Object path inside sticker-bucket — the file was uploaded with NO
    // extension, so this matches it exactly (spaces are fine; supabase-js
    // encodes the path). digitalFileName still ends in .zip so the buyer's
    // browser saves a usable, correctly-named archive.
    digitalFilePath: "Braid Boss Pro Sticker Pack",
    digitalFileName: "Braid Boss Pro Sticker Pack.zip",

    // Preview sheet (2000×1600) — the 34-sticker lineup with the 3-versions
    // footer. Lives in /public/store/stickers, served as a static asset.
    image: "/store/stickers/1_hero.png",
    imageAlt:
      "Braid Boss Pro Digital Planner Sticker Pack — 34 stickers, 102 transparent PNGs, GoodNotes ready",

    shortDescription:
      "34 digital planner stickers made for braiders — deposits, no-shows, rebookings, tax set-asides and the mindset ones — in transparent PNG for GoodNotes, Notability and Canva.",
    longDescription: [
      "Generic planner stickers don't have a \"deposit paid.\" They definitely don't have a \"no show.\" That's the whole reason these exist.",
      "Every sticker pack out there has coffee cups and gym days. None of them have the things that actually happen in your week — the client who rescheduled twice, the deposit that finally cleared, the money you set aside for taxes before you were tempted to spend it. These do.",
      "34 stickers, built for how braiders actually plan: the status ones you'll reach for every week, label banners that organize a whole day, nav tabs that build your own sidebar, and the mindset ones that make a planner you actually enjoy opening.",
      "Every sticker comes three ways — die-cut with the classic white outline, borderless for layering over colored pages and photos, and full size for social posts. They're all true transparent PNGs: no white box behind them, so the page shows through.",
    ],
    highlights: [
      "34 stickers · 102 transparent PNGs · GoodNotes ready",
      "Every sticker in 3 versions — die-cut, borderless & full size",
      "Made for braiders — deposit paid, no show, tax set aside, rebooked",
      "True transparent PNGs — no white box behind them",
      "Aligned footprints — drop two on a page and they line up",
      "Instant download — buy once, use forever, never expires",
    ],
    whatsInside: [
      "13 Hype stickers — Braid Boss, Booked & Busy, Braids Pay Bills, My Chair My Rules, Counting My Coins & more",
      "8 Status stickers — Deposit Paid, Paid In Full, No Show, Rescheduled, Rebooked, Restock, Tax Set Aside, Goal Hit",
      "5 Label banners — Priority Today, Busy Braiding, Content Day, Appointments, Reminder",
      "8 Nav tabs — Home, Year, Goals, Monthly, Money, Clients, Grow, Notes",
      "3 versions of every design — die-cut, borderless & full size",
      "Aligned footprints — same category, same size, artwork centered, so they line up without nudging",
    ],
    whatYouGet: [
      "Instant download — one zip, delivered by email + secure signed link",
      "34 sticker designs, each in 3 versions = 102 transparent PNG files",
      "Organized into 4 folders: Hype (13), Status (8), Labels (5), Nav Tabs (8)",
      "A Start Here guide with step-by-step GoodNotes import instructions",
      "3 preview sheets for reference",
      "Terms of use — nothing is shipped, nothing is dated, nothing expires",
    ],
    requirements: [
      "A tablet or computer that can unzip a file (on iPad, tap the zip in the Files app and it opens)",
      "GoodNotes, Notability, Noteshelf, Canva, Procreate, Keynote, PowerPoint — or anything that accepts a PNG",
      "No fonts to install, no software to buy",
      "Works on iPad, Android tablet, Mac and Windows — in any digital planner, not just ours",
    ],
    whoItsFor:
      "Braiders, loticians and natural hair stylists who want a planner that speaks their language — built to sit nicely in the Braid Boss Pro Business Planner, but they're plain PNGs that work in any digital planner, from any shop, or a blank notebook.",
    policyNote:
      "Licence: for personal and business use by one braider — use them in your planner, your content and your marketing. Not for resale, redistribution or sharing as files. Because this is an instant digital download, all sales are final; if a file won't open or looks damaged, message us and we'll replace it.",
    faqs: [
      {
        q: "Do these only work with your planner?",
        a: "No. They're plain PNG files — they'll work in any digital planner, from any shop, or in a blank notebook. They're sized to sit nicely in the Braid Boss Pro Business Planner, but nothing is locked to it.",
      },
      {
        q: "Why does the sticker look like it has a white background?",
        a: "That white edge is the die-cut outline — it's part of the sticker design, like a real sticker's paper border. The file itself is fully transparent. If you'd rather not have it, use the Borderless folder, included with every sticker.",
      },
      {
        q: "Can I print these?",
        a: "Yes, for your own use. Print on sticker paper and cut along the white outline. They're built at a resolution that prints cleanly at normal sticker size.",
      },
      {
        q: "Will it expire? Is it dated?",
        a: "Neither. No dates anywhere. Use the same file this year, next year and the year after.",
      },
      {
        q: "Can I resize them?",
        a: "Scale down as much as you want. Scale up to about 1.5× before edges start to soften.",
      },
      {
        q: "Can I use these in my own business content?",
        a: "Yes — your posts, your Stories, your marketing, your own planner. What you can't do is resell the files themselves. Full terms are in the download.",
      },
      {
        q: "I bought it and I'm stuck.",
        a: "Message us. We'd rather spend five minutes helping you than have you sit with a file you can't open.",
      },
    ],

    // LIVE: file ✓ (sticker-bucket), price ✓ ($8), image ✓. Purchasable —
    // checkout charges the platform Stripe account and delivers the zip by
    // email + secure signed URL, same flow as the planner.
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
