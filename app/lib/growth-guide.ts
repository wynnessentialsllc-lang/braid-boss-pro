// Boss Growth Guide — rules-based seasonal coaching for braiders.
//
// v1 is intentionally deterministic: no AI calls, no social
// integrations, no image uploads. Given the current date (and,
// optionally, the stylist's services + booking history) it returns
// the season, what to promote, what to post, hooks/captions, pricing
// moves, profit-safe deals, and a weekly action plan.
//
// Everything degrades gracefully — with zero store data the guide
// still renders full general seasonal guidance.

export type SeasonKey = "spring" | "summer" | "fall" | "winter";

export type SocialPost = {
  idea: string;
  format: string; // "TikTok / Reel" | "Carousel" | "Story" | "Educational" | "Booking reminder"
  cta: string;
};

export type SeasonGuide = {
  key: SeasonKey;
  name: string;
  // One-liner the hero badge can show.
  tagline: string;
  // Short explanation of the season for a braid business.
  explanation: string;
  // What's going on in the client's head this time of year.
  customerMindset: string;
  // Recommended styles to promote, most seasonally relevant first.
  styles: string[];
  socialPosts: SocialPost[];
  hooks: string[];
  captionStarters: string[];
  pricingMoves: string[];
  smartDeals: string[];
  weeklyActionPlan: string[];
};

const SPRING: SeasonGuide = {
  key: "spring",
  name: "Spring",
  tagline: "Prom, graduation & soft-glam season",
  explanation:
    "Spring is event season. Prom, graduation, banquets and photo days drive a wave of bookings — clients want polished, photo-ready installs and aren't shy about premium work for a big moment.",
  customerMindset:
    "“I have an event and I need to look unforgettable.” Clients are date-driven and will book early to lock in their stylist before the rush.",
  styles: [
    "Soft Glam Knotless",
    "Color-Blend Knotless",
    "Sleek Braided Updos",
    "Goddess Braids",
    "Boho Knotless",
    "Tribal Braids",
    "Feed-In Braids",
  ],
  socialPosts: [
    { idea: "“3 prom-proof braid styles that last through every photo”", format: "TikTok / Reel", cta: "Prom dates fill first — book your slot now." },
    { idea: "Color-blend transformation: before / inspo / final", format: "Carousel", cta: "Want this blend? Tap to book your color consult." },
    { idea: "“Booking for graduation? Here's how early you need to come in.”", format: "Story", cta: "DM your grad date to claim a spot." },
    { idea: "Quick tip: how to protect a soft-glam install for 2+ weeks", format: "Educational", cta: "Save this for your next appointment." },
    { idea: "Only 3 event weekends left before prom — slots closing", format: "Booking reminder", cta: "Reserve your prom braid appointment today." },
  ],
  hooks: [
    "Prom braids are not a last-minute decision.",
    "Your graduation photos are forever — book the style that shows it.",
    "This is your sign to lock in your event stylist now.",
    "Soft glam is carrying spring.",
    "If your event weekends are filling up, your prices might be too low.",
  ],
  captionStarters: [
    "Event season is officially open —",
    "Booked & busy doesn't happen by accident —",
    "The girls who plan ahead get the best slots —",
    "Save this if you have a spring event coming —",
  ],
  pricingMoves: [
    "Consider a 5–10% event-season premium on soft-glam and color-blend installs.",
    "You may want to test weekend/event-date premium pricing while demand peaks.",
    "Require deposits on every long appointment to protect your prom and grad weekends.",
    "Based on demand, raise pricing on any style that consistently books out within a week.",
  ],
  smartDeals: [
    "$25 off Monday/Tuesday appointments only",
    "Free style-protection spray with every event install",
    "Priority booking for returning clients before prom dates open publicly",
    "One limited weekly squeeze-in slot for event emergencies",
    "Add-on discount only on premium event styles (not base services)",
  ],
  weeklyActionPlan: [
    "Promote one high-demand event style (soft glam or color blend)",
    "Post one educational tip on making an install last through photos",
    "Share one remaining event-weekend appointment slot",
    "Push one premium add-on (edges, beads, or color)",
    "Remind clients to book early for prom/graduation",
    "Review pricing for one event style that books out fast",
  ],
};

const SUMMER: SeasonGuide = {
  key: "summer",
  name: "Summer",
  tagline: "Vacation, boho & humidity-proof season",
  explanation:
    "Summer is travel season. Clients want long-lasting, low-maintenance, humidity-friendly protective styles they can wear on vacation. Weekend demand spikes and boho work commands a premium.",
  customerMindset:
    "“I'm traveling and I don't want to think about my hair.” Clients value durability and vacation-readiness over everything.",
  styles: [
    "Boho Knotless",
    "Human Hair Boho Braids",
    "Vacation Braids",
    "Island Twists",
    "Braided Bobs",
    "Waist-Length Knotless",
    "Goddess Locs",
  ],
  socialPosts: [
    { idea: "“3 braid styles that survive vacation humidity”", format: "TikTok / Reel", cta: "Book your vacation braid appointment before the weekend fills." },
    { idea: "Boho knotless install: curl pattern + length options", format: "Carousel", cta: "Tap to book your boho install." },
    { idea: "“Going on vacation? Here's when to book before you fly.”", format: "Story", cta: "DM your travel date for a spot." },
    { idea: "How to keep boho braids fresh poolside and beachside", format: "Educational", cta: "Save this before your trip." },
    { idea: "Weekend slots almost gone — last vacation-prep openings", format: "Booking reminder", cta: "Grab your pre-trip appointment now." },
  ],
  hooks: [
    "Vacation braids are not optional this season.",
    "Boho braids are carrying summer.",
    "This is your sign to book the style that lasts.",
    "Your protective style should be cute AND vacation-planned.",
    "If your weekends are fully booked, your prices might be too low.",
  ],
  captionStarters: [
    "Vacation mode starts at the braid chair —",
    "Pack the bag, book the braids —",
    "Humidity-proof and vacation-ready —",
    "Save this before you fly —",
  ],
  pricingMoves: [
    "Consider increasing premium boho and human-hair services by 5–10% during peak travel demand.",
    "You may want to test weekend premium pricing through the summer.",
    "Require deposits for long boho and waist-length appointments.",
    "Based on demand, raise pricing on any vacation style that consistently books out.",
  ],
  smartDeals: [
    "$25 off Monday/Tuesday appointments only",
    "Free braid spray with every vacation-braid install",
    "Priority booking for returning clients on pre-trip weekends",
    "One limited weekly squeeze-in slot for last-minute travelers",
    "Add-on discount only on premium boho styles",
  ],
  weeklyActionPlan: [
    "Promote one high-demand vacation style (boho or island twists)",
    "Post one educational tip on humidity-proofing braids",
    "Share one available pre-weekend appointment slot",
    "Push one premium add-on (human hair, curl pattern, length)",
    "Remind clients to book before their travel dates",
    "Review pricing for one boho style that books out fast",
  ],
};

const FALL: SeasonGuide = {
  key: "fall",
  name: "Fall",
  tagline: "Back-to-school & protective-styling season",
  explanation:
    "Fall is reset season. Back-to-school drives kids' and student bookings, and adults shift to lower-maintenance protective styles in darker tones. Scalp-care messaging resonates strongly now.",
  customerMindset:
    "“I need something neat, durable and low-effort for a busy schedule.” Clients prioritize convenience and hair health.",
  styles: [
    "Medium Knotless",
    "Feed-In Braids",
    "Stitch Braids",
    "Protective Bob Styles",
    "Kids' Back-to-School Braids",
    "Low-Maintenance Knotless",
    "Boho Knotless (darker tones)",
  ],
  socialPosts: [
    { idea: "“Back-to-school braids that last the whole first term”", format: "TikTok / Reel", cta: "Book your back-to-school slot before the rush." },
    { idea: "Protective style lookbook in fall tones", format: "Carousel", cta: "Tap to book your fall refresh." },
    { idea: "“Parents: here's how early to book kids' styles.”", format: "Story", cta: "DM to reserve your child's appointment." },
    { idea: "Scalp-care routine between protective installs", format: "Educational", cta: "Save this for healthy hair this fall." },
    { idea: "Back-to-school week is almost full — limited slots", format: "Booking reminder", cta: "Lock in your appointment today." },
  ],
  hooks: [
    "Back-to-school braids book out faster than you think.",
    "Your protective style should be cute AND planned.",
    "This is your sign to give your hair a fall reset.",
    "Low-maintenance doesn't mean low-impact.",
    "If your week fills up by Tuesday, your prices might be too low.",
  ],
  captionStarters: [
    "New term, fresh braids —",
    "Protective + polished for a busy season —",
    "Healthy hair starts at the install —",
    "Save this for your fall reset —",
  ],
  pricingMoves: [
    "Consider a small premium on stitch and feed-in styles during the back-to-school surge.",
    "You may want to test weekday express pricing to capture busy parents.",
    "Require deposits on kids' group bookings to reduce no-shows.",
    "Based on demand, raise pricing on protective styles that consistently book out.",
  ],
  smartDeals: [
    "Free beads on kids' back-to-school styles",
    "$25 off Monday/Tuesday appointments only",
    "Priority booking for returning clients before school week",
    "One limited weekly squeeze-in slot for school-prep emergencies",
    "Add-on discount only on premium protective styles",
  ],
  weeklyActionPlan: [
    "Promote one high-demand protective style",
    "Post one educational scalp-care tip",
    "Share one available back-to-school slot",
    "Push one premium add-on (edges, tones, treatment)",
    "Remind parents to book kids' styles early",
    "Review pricing for one protective style that books out fast",
  ],
};

const WINTER: SeasonGuide = {
  key: "winter",
  name: "Winter",
  tagline: "Holiday glam & New-Year refresh season",
  explanation:
    "Winter is celebration season. Holiday parties, travel and New-Year resets drive demand for glam, long-lasting and moisture-focused protective styles. Clients book around dates and travel plans.",
  customerMindset:
    "“I have holiday plans and I want to look elevated while protecting my hair from the cold.” Clients want glam plus longevity.",
  styles: [
    "Holiday Glam Braids",
    "Long Knotless",
    "Stitch Ponytails",
    "Moisture-Protective Styles",
    "Goddess Braids",
    "Travel-Friendly Knotless",
    "Color-Accent Festive Braids",
  ],
  socialPosts: [
    { idea: "“Holiday braid styles that photograph like a dream”", format: "TikTok / Reel", cta: "Book your holiday glam before party season fills." },
    { idea: "Festive braid lookbook: party / travel / NYE", format: "Carousel", cta: "Tap to book your holiday install." },
    { idea: "“Traveling for the holidays? Book before these dates.”", format: "Story", cta: "DM your travel date to claim a slot." },
    { idea: "Winter moisture routine to protect braids in the cold", format: "Educational", cta: "Save this to keep hair healthy all winter." },
    { idea: "New Year, new install — January refresh slots open", format: "Booking reminder", cta: "Reserve your New-Year refresh now." },
  ],
  hooks: [
    "Holiday glam books out before the first party.",
    "Your New-Year refresh should already be on the calendar.",
    "This is your sign to book the style that lasts through the holidays.",
    "Cold weather is hard on hair — your style should protect it.",
    "If your December is fully booked, your prices might be too low.",
  ],
  captionStarters: [
    "Holiday-ready starts here —",
    "Glam, but make it protective —",
    "New year, fresh install —",
    "Save this before the holiday rush —",
  ],
  pricingMoves: [
    "Consider a holiday premium on glam and long-length installs through December.",
    "You may want to test premium pricing on the busiest party weekends.",
    "Require deposits on every long holiday appointment to protect peak dates.",
    "Based on demand, raise pricing on festive styles that consistently book out.",
  ],
  smartDeals: [
    "$25 off Monday/Tuesday appointments only",
    "Free moisture treatment add-on with long winter installs",
    "Priority booking for returning clients before holiday dates open",
    "One limited weekly squeeze-in slot for holiday emergencies",
    "Add-on discount only on premium festive styles",
  ],
  weeklyActionPlan: [
    "Promote one high-demand holiday glam style",
    "Post one educational winter moisture tip",
    "Share one available holiday-weekend slot",
    "Push one premium add-on (treatment, length, color accent)",
    "Remind clients to book around their travel/party dates",
    "Review pricing for one festive style that books out fast",
  ],
};

const SEASONS: Record<SeasonKey, SeasonGuide> = {
  spring: SPRING,
  summer: SUMMER,
  fall: FALL,
  winter: WINTER,
};

// Northern-hemisphere meteorological seasons by month. Months are
// 0-indexed from Date.getMonth(): Dec/Jan/Feb winter, Mar–May spring,
// Jun–Aug summer, Sep–Nov fall.
export const seasonForDate = (d: Date = new Date()): SeasonKey => {
  const m = d.getMonth();
  if (m === 11 || m === 0 || m === 1) return "winter";
  if (m >= 2 && m <= 4) return "spring";
  if (m >= 5 && m <= 7) return "summer";
  return "fall";
};

export const getSeasonGuide = (d: Date = new Date()): SeasonGuide =>
  SEASONS[seasonForDate(d)];

// ---- Personalization (best-effort, fully optional) ------------------

export type GrowthPersonalization = {
  // Stylist's own services that match the season's recommended styles,
  // so the UI can surface "you already offer this — promote it".
  matchingServices: string[];
  // Booking-pattern nudges derived from history. Empty when there's
  // not enough data — the page still renders general guidance.
  nudges: string[];
};

type PersonalizationInput = {
  serviceNames?: string[];
  topBookedStyles?: { style: string; count: number }[];
  busiestWeekday?: string | null;
  avgTicket?: number | null;
  repeatRate?: number | null; // 0..1
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

export const buildPersonalization = (
  season: SeasonGuide,
  input: PersonalizationInput = {},
): GrowthPersonalization => {
  const services = (input.serviceNames || []).filter(Boolean);
  const seasonTokens = season.styles.map(norm);

  // A service "matches" the season when its name shares a strong
  // keyword with a recommended style (boho, knotless, stitch, etc.).
  const KEYWORDS = [
    "boho", "knotless", "stitch", "feedin", "goddess", "island",
    "twist", "bob", "glam", "color", "tribal", "loc", "ponytail",
    "kids", "protective", "vacation",
  ];
  const matchingServices: string[] = [];
  for (const svc of services) {
    const n = norm(svc);
    const hit =
      seasonTokens.some(t => t.includes(n) || n.includes(t)) ||
      KEYWORDS.some(k => n.includes(k) && seasonTokens.some(t => t.includes(k)));
    if (hit) matchingServices.push(svc);
  }

  const nudges: string[] = [];
  const top = input.topBookedStyles || [];
  if (top.length > 0 && top[0]?.style) {
    nudges.push(
      `“${top[0].style}” is your most-booked style — pair it with a seasonal post this week.`,
    );
  }
  if (input.busiestWeekday) {
    nudges.push(
      `${input.busiestWeekday} is your busiest day — protect it with deposits and steer flexible clients to slower days.`,
    );
  }
  if (typeof input.avgTicket === "number" && input.avgTicket > 0) {
    nudges.push(
      `Your average ticket is around $${Math.round(input.avgTicket)} — a 5–10% seasonal premium on premium installs is roughly $${Math.round(input.avgTicket * 0.075)} more per client.`,
    );
  }
  if (typeof input.repeatRate === "number") {
    if (input.repeatRate >= 0.4) {
      nudges.push(
        `Strong repeat rate (${Math.round(input.repeatRate * 100)}%) — open priority booking to returning clients before public slots.`,
      );
    } else if (input.repeatRate > 0) {
      nudges.push(
        `Repeat rate is ${Math.round(input.repeatRate * 100)}% — a returning-client priority slot could lift rebooking this season.`,
      );
    }
  }
  if (matchingServices.length > 0) {
    nudges.push(
      `You already offer ${matchingServices.length} style${matchingServices.length === 1 ? "" : "s"} that match this season — lead with ${matchingServices.length === 1 ? "it" : "them"}.`,
    );
  }

  return { matchingServices, nudges };
};
