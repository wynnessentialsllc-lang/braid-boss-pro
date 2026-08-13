// Braider Academy — "how do I set this up?" carousel content.
//
// Pure data for the swipeable setup guide that sits on top of the
// Classes and Video Lessons screens. Kept out of AppRoot so the copy
// can be edited (and tested) without touching the UI, the same way
// growth-guide.ts holds the Boss Growth Guide content.
//
// Every slide describes a control that actually exists on those
// screens — if the editor changes, the matching slide changes with it.

export type AcademyGuideTopic = "classes" | "videos";

// Icon slots, resolved to lucide components by the carousel. Strings
// (not components) so this file stays JSX-free and importable anywhere.
export type AcademyGuideIcon =
  | "payouts"
  | "create"
  | "format"
  | "schedule"
  | "location"
  | "source"
  | "preview"
  | "price"
  | "cover"
  | "publish"
  | "share"
  | "roster";

export type AcademyGuideSlide = {
  key: string;
  icon: AcademyGuideIcon;
  /** Small label above the title — usually the step name. */
  eyebrow: string;
  title: string;
  body: string;
  /** Optional one-line reminders shown as a checklist under the body. */
  tips?: string[];
};

export type AcademyGuide = {
  topic: AcademyGuideTopic;
  /** Card heading, e.g. "How to set up classes". */
  title: string;
  subtitle: string;
  /** Label on the final slide's action button. */
  cta: string;
  slides: AcademyGuideSlide[];
};

const CLASSES_GUIDE: AcademyGuide = {
  topic: "classes",
  title: "How to set up classes",
  subtitle: "Eight steps from empty screen to paid sign-ups",
  cta: "Create my first class",
  slides: [
    {
      key: "payouts",
      icon: "payouts",
      eyebrow: "Before you start",
      title: "Turn on payouts",
      body:
        "Students pay by card when they sign up, so your Stripe payouts have to be connected first. Until they are, your class page shows students that sign-ups aren't open yet.",
      tips: [
        "Settings → Payments to connect or check your status",
        "You also need an active booking page — that's the @handle your class link lives on",
      ],
    },
    {
      key: "create",
      icon: "create",
      eyebrow: "Step 1",
      title: "Tap + and name it",
      body:
        "Tap + for a blank class. Title it the way a student would search for it, then use the description for what they'll learn, what to bring, and the skill level.",
      tips: [
        "Be specific: \"Beginner Knotless Intensive\" beats \"Braid Class\"",
        "Mention if models, hair, or tools are included",
      ],
    },
    {
      key: "format",
      icon: "format",
      eyebrow: "Step 2",
      title: "In person or virtual, and the price",
      body:
        "Pick the format, then set what a seat costs. The price is per seat — students can buy more than one at checkout, and the seat count comes off your capacity automatically.",
      tips: ["Virtual classes get a meeting link instead of an address"],
    },
    {
      key: "schedule",
      icon: "schedule",
      eyebrow: "Step 3",
      title: "Seats, length, and the date",
      body:
        "Capacity caps how many seats you'll sell — leave it blank for unlimited. Add the length in minutes and the start date and time so students know exactly what they're booking.",
      tips: [
        "Once seats sell out, new students land on your waitlist",
        "Times are shown to students in the timezone on the class",
      ],
    },
    {
      key: "location",
      icon: "location",
      eyebrow: "Step 4",
      title: "Where it happens stays private",
      body:
        "Fill in the address for an in-person class, or the Zoom/Meet link for a virtual one. Either way it's hidden on the public page and only revealed after a student pays.",
      tips: ["Paid students get it by email too — you can resend it any time"],
    },
    {
      key: "cover",
      icon: "cover",
      eyebrow: "Step 5",
      title: "Add a cover photo",
      body:
        "The cover is the first thing students see on your storefront card. Use a clean, well-lit shot of the style you're teaching — your own work sells the class better than a stock graphic.",
      tips: ["Landscape shots crop best on the class card"],
    },
    {
      key: "publish",
      icon: "publish",
      eyebrow: "Step 6",
      title: "Flip Published on",
      body:
        "Saving as a draft keeps the class private while you polish it. Turning Published on puts it live on your storefront and opens sign-ups right away.",
      tips: ["Draft first, publish when the date and price are locked in"],
    },
    {
      key: "share",
      icon: "share",
      eyebrow: "Step 7",
      title: "Share the link everywhere",
      body:
        "Every published class gets its own link. Tap Share to copy it, then drop it in your bio, your stories, and the DMs of students who keep asking when you're teaching.",
      tips: ["The link goes straight to the sign-up page — no app download"],
    },
    {
      key: "roster",
      icon: "roster",
      eyebrow: "Step 8",
      title: "Run the roster on the day",
      body:
        "Sign-ups shows who paid, seats sold, and what you've earned. You can resend a student's access email, or refund a seat to free it back up.",
      tips: [
        "Copy waitlist emails in one tap to invite them to the next class",
        "Turn on Academy reviews so students can vouch for you publicly",
      ],
    },
  ],
};

const VIDEOS_GUIDE: AcademyGuide = {
  topic: "videos",
  title: "How to set up video lessons",
  subtitle: "Eight steps to selling a tutorial on repeat",
  cta: "Add my first video lesson",
  slides: [
    {
      key: "payouts",
      icon: "payouts",
      eyebrow: "Before you start",
      title: "Turn on payouts",
      body:
        "Buyers pay by card and get access the moment the payment clears, so your Stripe payouts have to be connected first. Until they are, the buy button stays closed.",
      tips: [
        "Settings → Payments to connect or check your status",
        "You also need an active booking page — that's the @handle your video link lives on",
      ],
    },
    {
      key: "create",
      icon: "create",
      eyebrow: "Step 1",
      title: "Tap + and name the lesson",
      body:
        "The + button opens a blank lesson. Title it the way a student would search for it, then use the description to cover what's taught, how long it runs, and who it's for.",
      tips: ["\"Perfect Feed-In Braids — Full Tutorial\" tells buyers exactly what they get"],
    },
    {
      key: "source",
      icon: "source",
      eyebrow: "Step 2",
      title: "Paste a link or upload the file",
      body:
        "Upload an MP4, MOV, or WebM and we host it privately, or set the video to Unlisted on YouTube/Vimeo and paste that link.",
      tips: [
        "Uploads are capped at 500 MB — use a link for anything bigger",
        "Never paste a Public link: unlisted keeps it off search and your channel",
      ],
    },
    {
      key: "preview",
      icon: "preview",
      eyebrow: "Step 3",
      title: "Give them a free taste",
      body:
        "The optional preview link plays on the buy page before anyone pays. A 30–60 second clip of the hardest part of the technique is usually all it takes to close the sale.",
      tips: ["Skip it if the whole lesson is short — don't preview the payoff"],
    },
    {
      key: "price",
      icon: "price",
      eyebrow: "Step 4",
      title: "Price it — buy or rent",
      body:
        "Buy gives the student access forever. Rent gives them a window you set in days, which is handy for pricier masterclasses you'd rather not sell outright.",
      tips: ["Rentals start counting from the moment they pay"],
    },
    {
      key: "cover",
      icon: "cover",
      eyebrow: "Step 5",
      title: "Add a thumbnail",
      body:
        "The cover image is the thumbnail on your storefront grid. A crisp finished-style photo with the technique visible reads better at small sizes than a frame grabbed from the video.",
      tips: ["Keep faces and hairlines away from the very edges — the grid crops"],
    },
    {
      key: "publish",
      icon: "publish",
      eyebrow: "Step 6",
      title: "Flip Published on",
      body:
        "Drafts stay private while you finish uploading and pricing. Publishing puts the lesson on your storefront and opens it for purchase immediately.",
      tips: ["Watch your own preview once before you publish"],
    },
    {
      key: "share",
      icon: "share",
      eyebrow: "Step 7",
      title: "Share the link everywhere",
      body:
        "Each published lesson gets its own link. Tap Share to copy it and put it in your bio, your stories, and the reply to every \"do you teach this?\" comment.",
      tips: ["Buyers watch on a private, token-gated page — the raw video link never leaks"],
    },
    {
      key: "roster",
      icon: "roster",
      eyebrow: "Step 8",
      title: "Track sales and take care of buyers",
      body:
        "Sales lists everyone who bought. If someone lost their email you can resend access in one tap, and a refund sends the money back and revokes their access.",
      tips: [
        "A lesson sells while you're braiding — check back weekly",
        "Turn on Academy reviews so buyers can vouch for the lesson publicly",
      ],
    },
  ],
};

export const ACADEMY_SETUP_GUIDES: Record<AcademyGuideTopic, AcademyGuide> = {
  classes: CLASSES_GUIDE,
  videos: VIDEOS_GUIDE,
};

// localStorage flag — has this braider hidden the guide for this topic?
// Bump the version suffix to re-show the carousel after a content
// refresh, same convention as WELCOME_TOUR_KEY in AppRoot.
export const academyGuideStorageKey = (topic: AcademyGuideTopic): string =>
  `bbp-academy-guide-${topic}-v1`;
