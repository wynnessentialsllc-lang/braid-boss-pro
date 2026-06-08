"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getSupabase } from "../../lib/supabase";
import BuildYourStyle from "../../components/booking/BuildYourStyle";
import { submitPublicWaitlistRequest, type WaitlistFlexibility, WAITLIST_FLEX_LABEL } from "../../lib/waitlist";
import { emitAnalyticsEvent } from "../../lib/analytics-events";
import { SMS_ENABLED } from "../../lib/features";
import {
  type PublicNoShowFee,
  fetchPublicNoShowFee,
  recordNoShowConsent,
} from "../../lib/policies";
import {
  type IntakeForm,
  type IntakeQuestion,
  fetchIntakeForm,
  attachIntakeAnswers,
  visibleQuestions,
} from "../../lib/intake";
import {
  fetchPublicServices,
  fetchPublicServiceCategories,
  fetchPublicAvailability,
  fetchPublicMonthAvailability,
  resolveVariationPricing,
  ACV_EXTRA_ID,
  ACV_EXTRA_KIND,
  CUSTOM_COLOR_EXTRA_ID,
  CUSTOM_COLOR_EXTRA_KIND,
  CUSTOM_COLOR_EXTRA_NAME,
  type PublicService,
  type PublicServiceCategory,
  type PublicSlot,
  type MonthDay,
  type MonthDayStatus,
} from "../../lib/services";
import { trackEvent } from "../../lib/track";
import { useModalA11y } from "../../lib/use-modal-a11y";
import {
  fetchPublicReviews,
  fetchPublicProducts,
  fetchPublicServiceRecommendations,
  type PublicReview,
  type PublicProduct,
} from "../../lib/storefront";
import { collectPublicContext } from "../../lib/waitlist";
import { fetchStylistReviews, type StylistReview } from "../../lib/marketplace";

// Local-date "YYYY-MM-DD" — never UTC-shifts so the calendar lines up
// with what the visitor sees on their phone.
const localDateISO = (d: Date): string => {
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${yr}-${mo}-${da}`;
};
const todayISO = (): string => localDateISO(new Date());

// Default slot duration in minutes when no service is selected. The
// calendar still works — slots come back with one-hour spacing.
const DEFAULT_DURATION_MIN = 60;

// Minimal palette — kept inline so this page never imports the main
// app shell (it's served to anonymous visitors).
const C = {
  espresso: "#15111A", coffee: "#3D3447", caramel: "#6F6477",
  cream: "#FFFFFF", ivory: "#F6F2EC", paper: "#FFFFFF",
  gold: "#7C3AED", goldDeep: "#5B21B6",
  muted: "#6F6477", hairline: "rgba(21, 17, 26, 0.12)",
  success: "#5C7C4A", danger: "#9C3D2E",
  // 2026 design system tokens (mirror of app/page.tsx). Public
  // booking page reads these for its primary CTA gradient + future
  // refresh sections.
  brandPrimary: "#7C3AED",
  brandPrimaryDeep: "#5B21B6",
  brandSecondary: "#FF4D6D",
  brandText: "#15111A",
  brandBorder: "#ECE7F2",
};
const GRADIENTS = {
  primary: "linear-gradient(135deg, #7C3AED 0%, #FF4D6D 100%)",
};
const SHADOWS = {
  primaryGlow: "0 10px 28px -10px rgba(124, 58, 237, 0.45), 0 4px 12px -4px rgba(255, 77, 109, 0.30)",
};
const FONT_DISPLAY = `"Cormorant Garamond", Georgia, serif`;
const FONT_BODY = `"DM Sans", "Inter", system-ui, sans-serif`;

// Shown until the real booking link resolves (or when it can't).
// Deliberately carries NO stylist data — no name, handle, avatar,
// banner, or tabs — so the visitor never sees a fake "Welcome /
// @randomslug" profile flash (worst inside the Instagram in-app
// browser). Just the Braid Boss Pro wordmark + a subtle loader, or
// a clean not-found message.
const BookingBootScreen = ({
  notFound = false,
  message,
}: { notFound?: boolean; message?: string }) => (
  <div
    style={{
      minHeight: "100vh",
      background: C.cream,
      fontFamily: FONT_BODY,
      color: C.espresso,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 18,
      padding: 24,
      textAlign: "center",
    }}
  >
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=DM+Sans:wght@500;600&display=swap');
      @keyframes bbpBootPulse { 0%,100% { opacity: .35; } 50% { opacity: 1; } }
      @media (prefers-reduced-motion: reduce) {
        .bbp-boot-dot { animation: none !important; opacity: .7 !important; }
      }
    `}</style>
    <p
      style={{
        margin: 0,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.32em",
        textTransform: "uppercase",
        color: C.goldDeep || C.gold,
      }}
    >
      Braid Boss Pro
    </p>
    {notFound ? (
      <>
        <h1 style={{ margin: 0, fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 600, color: C.espresso }}>
          Profile not found
        </h1>
        <p style={{ margin: 0, fontSize: 14, color: C.muted, maxWidth: 320, lineHeight: 1.5 }}>
          {message || "This booking link may be unavailable."}
        </p>
      </>
    ) : (
      <div aria-label="Loading" role="status" style={{ display: "flex", gap: 7 }}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="bbp-boot-dot"
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: C.gold,
              display: "inline-block",
              animation: "bbpBootPulse 1.1s ease-in-out infinite",
              animationDelay: `${i * 0.18}s`,
            }}
          />
        ))}
      </div>
    )}
  </div>
);

type LinkConfig = {
  slug: string;
  user_id?: string | null;
  business_name?: string | null;
  intro?: string | null;
  services?: any[] | null;
  active?: boolean;
  // Customization fields — added by 20260606 migration
  logo_url?: string | null;
  location_text?: string | null;
  phone?: string | null;
  policies?: string | null;
  accent_color?: string | null;
  // Gallery — added by 20260608 migration. Array of { url, path, sort }.
  // serviceId / label are optional per-photo "shop this look" metadata:
  // serviceId links the photo to a service (surfaces name + "from $X"
  // and lets "Book this look" pre-select it); label is a free-form
  // style name.
  gallery_photos?: Array<{ url: string; path?: string; sort?: number; serviceId?: string; label?: string }> | null;
  // Storefront profile fields — added by 20260617 migration. All
  // optional; the branded header gracefully drops sections that
  // aren't filled in.
  banner_image_url?: string | null;
  business_city?: string | null;
  business_state?: string | null;
  instagram_url?: string | null;
  tiktok_url?: string | null;
  website_url?: string | null;
  years_in_business?: number | null;
  // Header customization — added by 20260909 migration. header_theme
  // picks the hero layout ('classic' | 'editorial' | 'spotlight');
  // tagline is the specialty kicker shown in the hero; about is the
  // "Meet your stylist" bio rendered in the editorial / spotlight
  // heroes. All optional — the hero degrades to 'classic' and drops
  // empty sections.
  header_theme?: string | null;
  tagline?: string | null;
  about?: string | null;
  // Dedicated "Meet your stylist" portrait — a photo of the stylist
  // herself, distinct from logo_url (the studio brand mark). Added by
  // 20261010 migration. Optional; the hero/About panel falls back to
  // logo_url then the first gallery photo when empty.
  stylist_photo_url?: string | null;
  // Branded share handle (profiles.public_slug) — surfaces in the
  // /@handle storefront header as the @ display below the title.
  // Falls back to the canonical slug when not set.
  branded_slug?: string | null;
};

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://bjqazhplxqqhftekspfl.supabase.co";

const FUNCTIONS_URL = (() => {
  const host = SUPABASE_URL.replace("https://", "").replace(".supabase.co", "");
  return `https://${host}.functions.supabase.co`;
})();

// Curl pattern only applies when the *selected* option/add-on
// actually includes human / curly / boho hair — braiding hair is
// included on every style, but curly human hair is opt-in. Detect it
// from the selection's NAME and DESCRIPTION (variations carry
// `variation_description`, extras carry `description`), with a
// metadata escape hatch. Negations ("curly hair is not included",
// "can be added if desired") always win so add-ons that merely offer
// curly hair as an upgrade don't trigger curl selection.
const isHumanHairIncludedSelection = (sel: any): boolean => {
  if (!sel) return false;
  if (sel.metadata && sel.metadata.human_hair_included === true) return true;
  if (sel.human_hair_included === true) return true;
  const txt = `${sel.name ?? ""} ${sel.label ?? ""} ${sel.title ?? ""} ${sel.subLabel ?? ""} ${sel.description ?? ""} ${sel.variation_description ?? ""}`.toLowerCase();
  if (!txt.trim()) return false;
  // Negations take precedence — never trigger on "not included".
  if (/not\s+included/.test(txt) || /isn'?t\s+included/.test(txt)) return false;
  if (txt.includes("human hair included")) return true;
  if (txt.includes("curly human hair")) return true;
  // "<boho|human|curly> … hair … included" (e.g. "Boho Hair Included")
  if (/\b(boho|human|curly)\b[^.]*\bhair\b[^.]*\bincluded\b/.test(txt)) return true;
  // "includes … <curly|human|boho> … hair" (e.g. description text)
  if (/\binclude[sd]?\b[^.]*\b(curly|human|boho)\b[^.]*\bhair\b/.test(txt)) return true;
  return false;
};


export default function PublicBookingPage() {
  const params = useParams();
  const router = useRouter();
  // Raw URL segment — could be either a legacy random booking_links.slug
  // OR a branded profiles.public_slug. The resolver below normalizes
  // this to the canonical random slug (`link.slug`) which the rest of
  // the page uses for every downstream RPC. That way availability /
  // services / submit endpoints don't need to know about branded slugs
  // — the resolver is the only entry point that does the lookup.
  const urlSlug = useMemo(() => {
    const raw = params?.slug;
    return Array.isArray(raw) ? raw[0] : raw || "";
  }, [params]);

  const [link, setLink] = useState<LinkConfig | null>(null);
  const [linkLoading, setLinkLoading] = useState(true);
  const [linkError, setLinkError] = useState<string | null>(null);
  // "Meet your stylist" → tap the hero card to expand the About panel
  // (portrait + full bio + details) in place, without leaving the page.
  const [aboutOpen, setAboutOpen] = useState(false);
  const aboutRef = useRef<HTMLDivElement | null>(null);
  useModalA11y(aboutOpen, () => setAboutOpen(false), aboutRef);
  // Canonical slug — `link.slug` once resolved, urlSlug as a fallback
  // during the first paint. Every downstream effect / RPC reads this
  // so a branded URL feeds the existing per-link queries without
  // requiring those RPCs to know about branded slugs.
  const slug = link?.slug || urlSlug;

  // Personalize the browser tab + share title so a branded URL reads
  // like the stylist's brand instead of the generic shell. Document
  // title is the lightest-touch SEO signal we have on this client
  // route — keep it cheap and reset to the shell title on unmount.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const businessName = link?.business_name?.trim();
    const title = businessName
      ? `${businessName} | Book Appointment | Braid Boss Pro`
      : "Book Appointment | Braid Boss Pro";
    document.title = title;

    // Open Graph + Twitter card meta — injected client-side. This
    // lightly polishes link previews for crawlers that execute JS
    // (Twitter, iMessage, Slack often do); fully server-rendered
    // metadata is a follow-up that needs a server-component split.
    const description = link?.intro?.trim()
      || (businessName ? `Book your next appointment with ${businessName}.` : "Book your next braiding appointment online.");
    const ogImage = link?.banner_image_url || link?.logo_url || null;
    const url = typeof window !== "undefined" ? window.location.href : "";

    const setMeta = (selector: string, attr: "name" | "property", key: string, content: string) => {
      let el = document.head.querySelector<HTMLMetaElement>(selector);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    };

    setMeta('meta[name="description"]', "name", "description", description);
    setMeta('meta[property="og:title"]', "property", "og:title", title);
    setMeta('meta[property="og:description"]', "property", "og:description", description);
    setMeta('meta[property="og:type"]', "property", "og:type", "website");
    if (url) setMeta('meta[property="og:url"]', "property", "og:url", url);
    if (ogImage) setMeta('meta[property="og:image"]', "property", "og:image", ogImage);
    setMeta('meta[name="twitter:card"]', "name", "twitter:card", ogImage ? "summary_large_image" : "summary");
    setMeta('meta[name="twitter:title"]', "name", "twitter:title", title);
    setMeta('meta[name="twitter:description"]', "name", "twitter:description", description);
    if (ogImage) setMeta('meta[name="twitter:image"]', "name", "twitter:image", ogImage);

    // Canonical URL — points at the branded slug when available so
    // SEO consolidates around the friendly URL even if the visitor
    // landed on the legacy random one.
    if (url) {
      let canon = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
      if (!canon) {
        canon = document.createElement("link");
        canon.setAttribute("rel", "canonical");
        document.head.appendChild(canon);
      }
      canon.setAttribute("href", url);
    }

    return () => {
      document.title = "Braid Boss Pro";
    };
  }, [link?.business_name, link?.intro, link?.banner_image_url, link?.logo_url]);
  // Tap-to-expand lightbox for the stylist's photo gallery. Stores
  // the active index into the sorted gallery_photos array so prev /
  // next swipes stay in order.
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  // Tap-to-zoom for a service cover image (single image, no gallery
  // navigation). Holds the image URL while the popout is open.
  const [coverZoom, setCoverZoom] = useState<string | null>(null);

  // Keyboard navigation when the lightbox is open. Mounted once and
  // gated on the open state inside the handler so we don't churn
  // listeners on every render.
  useEffect(() => {
    if (lightboxIndex === null) return;
    const total = Array.isArray(link?.gallery_photos)
      ? Math.min(8, link!.gallery_photos!.length)
      : 0;
    if (total === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxIndex(null);
      else if (e.key === "ArrowRight") setLightboxIndex((cur) => cur === null ? null : (cur + 1) % total);
      else if (e.key === "ArrowLeft") setLightboxIndex((cur) => cur === null ? null : (cur - 1 + total) % total);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxIndex, link?.gallery_photos]);

  // Escape closes the single-image cover popout.
  useEffect(() => {
    if (!coverZoom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCoverZoom(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [coverZoom]);

  // Touch-swipe navigation. Tracks the initial touch X and fires
  // prev/next when the horizontal delta exceeds a small threshold
  // and the gesture wasn't a vertical scroll.
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const onLightboxTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  };
  const onLightboxTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 40 || Math.abs(dy) > Math.abs(dx)) return;
    const total = Array.isArray(link?.gallery_photos)
      ? Math.min(8, link!.gallery_photos!.length)
      : 0;
    if (total === 0) return;
    if (dx < 0) setLightboxIndex((cur) => cur === null ? null : (cur + 1) % total);
    else setLightboxIndex((cur) => cur === null ? null : (cur - 1 + total) % total);
  };
  // Phase B1 — real services catalog from public_list_services RPC.
  // Falls back to legacy link.services if the RPC errors / is empty
  // so existing booking links keep working during the rollout.
  const [catalog, setCatalog] = useState<PublicService[]>([]);
  const [serviceId, setServiceId] = useState<string>("");
  // Picked variation (one of service.add_ons). "" = no variation
  // selected; the resolver then falls back to the parent service.
  const [selectedVariationId, setSelectedVariationId] = useState<string>("");
  // Picked add-ons. Distinct from variations: multiple can be
  // selected, and they stack on top of whichever variation/base is
  // currently picked. Cleared whenever the service changes so a
  // ghost pick from a prior service can't ride along.
  const [selectedExtraIds, setSelectedExtraIds] = useState<string[]>([]);
  // Service categories — populated alongside the catalog. When the
  // stylist has any active categories with services we surface a
  // category row above the service select; "" means "all services"
  // (default, so links without categories behave exactly as before).
  const [serviceCategories, setServiceCategories] = useState<PublicServiceCategory[]>([]);
  // Storefront commerce (Phases 3-5). Each list is independent so a
  // failed fetch in one section doesn't blank the others.
  const [reviews, setReviews] = useState<PublicReview[]>([]);
  // Client reviews tied to real appointments — the same data the
  // /discover marketplace card's star rating is drawn from, so the
  // rating is consistent between the marketplace and this page.
  const [clientReviews, setClientReviews] = useState<StylistReview[]>([]);
  const [reviewsOpen, setReviewsOpen] = useState(false);
  // Booking funnel: a ref on the booking form so the floating "Book"
  // bar can smooth-scroll the visitor straight to the service picker —
  // the page's primary action, which otherwise sits below the bio /
  // socials / gallery / reviews.
  const bookingFormRef = useRef<HTMLFormElement | null>(null);
  // Submit button ref — the sticky price summary (shown while the form
  // is on screen) scrolls here so a configured client can jump straight
  // to "Pay deposit & request".
  const bookingSubmitRef = useRef<HTMLButtonElement | null>(null);
  // Anchor at the top of the selected-service detail. Picking a service
  // collapses the tall menu, so we scroll here (not to page top) to keep
  // the client in the flow and land them on their service + options.
  const serviceDetailRef = useRef<HTMLDivElement | null>(null);
  // Sticky "Book" bar shows only while the form is OFF screen, so the
  // CTA is always one tap away without doubling up once the visitor is
  // already at the picker.
  const [bookingInView, setBookingInView] = useState(false);
  const scrollToBooking = useCallback(() => {
    bookingFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  const scrollToSubmit = useCallback(() => {
    bookingSubmitRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);
  // Watch the booking form so the sticky bar can hide once the picker
  // is on screen. Re-runs when the link resolves (the form mounts only
  // after that). Falls back to "always show" if IntersectionObserver
  // is unavailable.
  useEffect(() => {
    const el = bookingFormRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      ([entry]) => setBookingInView(entry.isIntersecting),
      { rootMargin: "0px 0px -45% 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [link?.slug]);
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [serviceRecs, setServiceRecs] = useState<PublicProduct[]>([]);
  const [activeCategoryId, setActiveCategoryId] = useState<string>("");
  // Phase B2 — live slot picker driven by public_list_availability.
  const [slots, setSlots] = useState<PublicSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [hasFetchedSlots, setHasFetchedSlots] = useState(false);

  // Phase B7 — interactive month heatmap. Cursor is the visible
  // year-month. monthCache is keyed by `${y}-${m}-${svcId|none}-${dur}`
  // so navigating back and forth doesn't refetch.
  const [monthCursor, setMonthCursor] = useState<{ year: number; month: number }>(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });
  const [monthDays, setMonthDays] = useState<MonthDay[]>([]);
  const [monthLoading, setMonthLoading] = useState(false);
  const [monthError, setMonthError] = useState<string | null>(null);
  const monthCache = useRef<Map<string, MonthDay[]>>(new Map());

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  // Who's this appointment for. Defaults to the booker themselves so
  // adults breeze through; only when they pick "someone else" do we
  // ask for the recipient's name (+ optional note like age).
  const [bookedForSelf, setBookedForSelf] = useState(true);
  const [recipientName, setRecipientName] = useState("");
  const [recipientNote, setRecipientNote] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [preferredDate, setPreferredDate] = useState("");
  const [preferredTime, setPreferredTime] = useState("");
  const [notes, setNotes] = useState("");
  // SMS reminders opt-in. Default on — most clients want a text
  // reminder; they can untick it. Threaded into the booking request
  // so the reminder scheduler knows whether to also send SMS.
  const [smsOptIn, setSmsOptIn] = useState(true);
  // Style customization (hair color + curl pattern) — only shown
  // when the selected service enables them. "Custom / Other" reveals
  // a small free-text field saved to customization_summary.
  const [hairColor, setHairColor] = useState("");
  const [customHairColor, setCustomHairColor] = useState("");
  const [curlPattern, setCurlPattern] = useState("");
  const [customCurlPattern, setCustomCurlPattern] = useState("");
  // Customized braiding hair color (managed extra, +$ price). The
  // client describes their combo and can attach an inspiration photo
  // which we upload via /api/booking-color-photo and stash by URL.
  const [customColorDescription, setCustomColorDescription] = useState("");
  const [customColorPhotoUrl, setCustomColorPhotoUrl] = useState<string | null>(null);
  const [customColorPhotoUploading, setCustomColorPhotoUploading] = useState(false);
  const [customColorPhotoError, setCustomColorPhotoError] = useState<string | null>(null);
  // Digital intake / consultation form. Loaded once the slug resolves
  // to a user_id; answers are keyed by question id and attached to the
  // booking request before the deposit step (optional / skippable).
  const [intakeForm, setIntakeForm] = useState<IntakeForm | null>(null);
  const [intakeAnswers, setIntakeAnswers] = useState<Record<string, string>>({});
  // No-show fee disclosure + consent. Shown only when the stylist has
  // no-show protection on AND the booking will save a card (deposit).
  const [noShowFee, setNoShowFee] = useState<PublicNoShowFee | null>(null);
  const [noShowConsent, setNoShowConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // When a submit error appears (failed validation or a server error),
  // bring the submit area + the (role=alert) message into view. The form
  // is long, so an error rendered at the bottom was easy to miss — it
  // read as a dead button. Screen readers get the alert; sighted users
  // get scrolled to it.
  useEffect(() => {
    if (submitError) scrollToSubmit();
  }, [submitError, scrollToSubmit]);
  // Pay-in-full BNPL choice. When the stylist opted in and the booking
  // takes a deposit, we pause after submit and let the client choose
  // between paying the deposit (card) or the full ticket (BNPL/card)
  // instead of auto-redirecting to the deposit checkout.
  const [paymentChoice, setPaymentChoice] = useState<{
    requestId: string;
    depositAmount: number;
    fullPrice: number;
  } | null>(null);
  const [choiceRedirecting, setChoiceRedirecting] = useState(false);

  // Kick off one of the two booking checkouts and redirect to Stripe.
  const startBookingCheckout = useCallback(
    async (endpoint: string, requestId: string) => {
      setSubmitError(null);
      setChoiceRedirecting(true);
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ request_id: requestId }),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok || !out?.url) {
          throw new Error(out?.error || "Couldn't start checkout. Please try again.");
        }
        if (typeof window !== "undefined") window.location.assign(String(out.url));
      } catch (err: any) {
        setSubmitError(
          err?.message
            ? `Couldn't start checkout: ${err.message}`
            : "Couldn't start checkout. Please try again.",
        );
        setChoiceRedirecting(false);
      }
    },
    [],
  );

  // Waitlist mode — when the client doesn't see a workable slot, they
  // can join the waitlist directly via the anon insert policy on
  // waitlist_requests. Phase B will surface this automatically when
  // the slot picker comes up empty.
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [waitlistFlex, setWaitlistFlex] = useState<WaitlistFlexibility>("anytime");
  const [waitlistSubmitting, setWaitlistSubmitting] = useState(false);
  const [waitlistDone, setWaitlistDone] = useState(false);
  const [waitlistError, setWaitlistError] = useState<string | null>(null);

  const submitWaitlist = async () => {
    if (waitlistSubmitting) return;
    setWaitlistError(null);
    if (!name.trim()) { setWaitlistError("Please enter your name."); return; }
    if (!link?.user_id) { setWaitlistError("This booking link is misconfigured."); return; }
    // Phase B1 — when the studio has a real catalog, every waitlist
    // entry must carry a service so the stylist knows what they're
    // matching against. Free-text legacy links keep their old
    // permissive behaviour.
    if (hasCatalog && !selectedCatalogService) {
      setWaitlistError("Please pick a service above before joining the waitlist.");
      return;
    }
    setWaitlistSubmitting(true);
    const selectedId = hasCatalog
      ? selectedCatalogService?.id || null
      : ((services as any[]).find((s: any) => s?.name === serviceName)?.id || null);
    const result = await submitPublicWaitlistRequest({
      ownerUserId: link.user_id,
      client_name: name.trim(),
      client_phone: phone.trim() || null,
      client_email: email.trim() || null,
      service_id: selectedId,
      service_name: serviceName || null,
      preferred_date: preferredDate || null,
      preferred_time: preferredTime || null,
      flexibility: waitlistFlex,
      notes: notes.trim() || null,
    });
    setWaitlistSubmitting(false);
    if (!result.ok) { setWaitlistError(result.error); return; }
    setWaitlistDone(true);
    if (link?.user_id) {
      void emitAnalyticsEvent({
        ownerUserId: link.user_id,
        type: "waitlist_joined",
        source: "public",
        payload: {
          slug,
          serviceName: serviceName || null,
          flexibility: waitlistFlex,
          preferredDate: preferredDate || null,
        },
      });
    }
  };

  useEffect(() => {
    if (!urlSlug) return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabase();
        // Branded slug support: the resolver RPC matches either the
        // legacy random booking_links.slug OR a profiles.public_slug
        // and returns the canonical booking_link row plus a flag for
        // whether a branded slug exists. Old random URLs keep working
        // unchanged; new branded URLs route to the same row.
        const { data: rows, error } = await supabase
          .rpc("public_resolve_booking_slug", { slug_in: urlSlug });
        if (cancelled) return;
        const row = Array.isArray(rows) ? rows[0] : (rows as any);
        if (error || !row || !row.link_id) {
          setLinkError("This booking link isn't available.");
        } else if (!row.active) {
          setLinkError("This booking link is currently paused.");
        } else {
          // If the visitor landed on the legacy random slug AND the
          // stylist has a branded slug, swap the URL in-place so the
          // address bar reads the friendly link and any subsequent
          // share-from-here uses the branded form. router.replace
          // (not push) avoids polluting browser history.
          if (
            row.matched_via === "legacy_random"
            && row.branded_slug
            && row.branded_slug !== urlSlug
          ) {
            try { router.replace(`/book/${row.branded_slug}`); } catch { /* SSR no-op */ }
          }
          // Personalization fallback: if the booking_links row
          // doesn't carry a business_name, ask the RPC for the
          // best display name (settings → profiles → other links).
          // Keeps the public booking page personalized even when
          // the stylist never explicitly named this link.
          let displayName = row.business_name as string | null;
          if (!displayName || !String(displayName).trim()) {
            try {
              const { data: studio } = await supabase
                .rpc("public_get_studio_name", { user_id_in: row.user_id });
              if (typeof studio === "string" && studio.trim()) {
                displayName = studio.trim();
              }
            } catch { /* leave as null; UI falls back to "Braid Boss Pro" */ }
          }
          // The rest of the page already keys off booking_links.slug
          // (services / availability RPCs, the submit RPC, etc.), so
          // expose row.slug as link.slug — never the URL slug, which
          // might be the branded form.
          const config: LinkConfig = {
            slug: row.slug,
            user_id: row.user_id,
            business_name: displayName,
            intro: row.intro,
            services: row.services,
            active: row.active,
            logo_url: row.logo_url,
            location_text: row.location_text,
            phone: row.phone,
            policies: row.policies,
            accent_color: row.accent_color,
            gallery_photos: row.gallery_photos,
            banner_image_url: row.banner_image_url ?? null,
            business_city: row.business_city ?? null,
            business_state: row.business_state ?? null,
            instagram_url: row.instagram_url ?? null,
            tiktok_url: row.tiktok_url ?? null,
            website_url: row.website_url ?? null,
            years_in_business: row.years_in_business ?? null,
            header_theme: (row.header_theme as string | null) ?? null,
            tagline: (row.tagline as string | null) ?? null,
            about: (row.about as string | null) ?? null,
            stylist_photo_url: (row.stylist_photo_url as string | null) ?? null,
            branded_slug: (row.branded_slug as string | null) ?? null,
          };
          setLink(config);
        }
      } catch {
        if (!cancelled) setLinkError("Couldn't load this booking link.");
      } finally {
        if (!cancelled) setLinkLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [urlSlug]);

  // Pull the catalog once the slug is known. The RPC is callable
  // anonymously and returns only is_active = true rows.
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    (async () => {
      const result = await fetchPublicServices(slug);
      if (cancelled) return;
      if (result.ok) setCatalog(result.services);
    })();
    return () => { cancelled = true; };
  }, [slug]);

  // Intake / consultation form. Loaded once the slug resolves to a
  // user_id. Renders before the deposit step when the stylist enabled it.
  useEffect(() => {
    const uid = link?.user_id;
    if (!uid) return;
    let cancelled = false;
    (async () => {
      const [form, fee] = await Promise.all([
        fetchIntakeForm(uid),
        fetchPublicNoShowFee(uid),
      ]);
      if (cancelled) return;
      setIntakeForm(form);
      setNoShowFee(fee);
    })();
    return () => { cancelled = true; };
  }, [link?.user_id]);

  // Categories load in parallel. The RPC only returns categories with
  // at least one active service, so we won't render ghost tabs.
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    (async () => {
      const result = await fetchPublicServiceCategories(slug);
      if (cancelled) return;
      if (result.ok) setServiceCategories(result.categories);
    })();
    return () => { cancelled = true; };
  }, [slug]);

  // Public reviews ("Client Love") — fired once per slug. Empty
  // array → section hides itself, so stylists with no reviews don't
  // see ghost UI.
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    (async () => {
      const r = await fetchPublicReviews(slug);
      if (cancelled) return;
      if (r.ok) setReviews(r.reviews);
    })();
    return () => { cancelled = true; };
  }, [slug]);

  // Appointment-tied client reviews — best-effort, independent of
  // the curated "Client Love" testimonials above.
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchStylistReviews(slug);
        if (!cancelled) setClientReviews(list);
      } catch { /* leave empty — section hides itself */ }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  // Storefront products ("Recommended Products") — same lazy pattern.
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    (async () => {
      const r = await fetchPublicProducts(slug);
      if (cancelled) return;
      if (r.ok) setProducts(r.products);
    })();
    return () => { cancelled = true; };
  }, [slug]);

  // Per-service recommendations. Refetch whenever the visitor picks
  // a different service so the "For your appointment" row stays in
  // sync with the picker.
  useEffect(() => {
    if (!slug || !serviceId) { setServiceRecs([]); return; }
    let cancelled = false;
    (async () => {
      const r = await fetchPublicServiceRecommendations(slug, serviceId);
      if (cancelled) return;
      if (r.ok) setServiceRecs(r.products);
    })();
    return () => { cancelled = true; };
  }, [slug, serviceId]);

  // Catalog wins; fall back to legacy free-form list if the RPC
  // returns nothing (older booking links that haven't migrated).
  const legacyServices = Array.isArray(link?.services) ? link!.services! : [];
  const hasCatalog = catalog.length > 0;
  // Filter the catalog by the active category when categories exist.
  // activeCategoryId === "" means "All" (or no categories defined).
  // "__other__" surfaces uncategorized services so links with mixed
  // categorized + uncategorized rows still expose everything.
  const filteredCatalog = hasCatalog && activeCategoryId
    ? (activeCategoryId === "__other__"
        ? catalog.filter(s => !s.category_id)
        : catalog.filter(s => s.category_id === activeCategoryId))
    : catalog;
  const hasCategories = serviceCategories.length > 0;
  const hasUncategorized = catalog.some(s => !s.category_id);
  const services = hasCatalog ? filteredCatalog : legacyServices;
  const selectedCatalogService = hasCatalog
    ? catalog.find(s => s.id === serviceId) || null
    : null;

  // Available variations for the picked service. When empty, we fall
  // through to the parent service's price/duration/deposit and skip
  // rendering the variation picker entirely (back-compat).
  const variations = selectedCatalogService?.add_ons || [];
  const hasVariations = variations.length > 0;

  // Resolved pricing for the CURRENT selection. Tells the rest of the
  // flow exactly what to charge / book / show — variation overrides
  // when picked, parent service otherwise. See lib/services.ts for
  // the inheritance rules.
  const baseResolved = useMemo(() => {
    if (!selectedCatalogService) return null;
    return resolveVariationPricing(
      selectedCatalogService,
      selectedVariationId || null,
    );
  }, [selectedCatalogService, selectedVariationId]);

  // Active (and picked) add-ons. We filter to active only for display
  // — server-side the RPC also rechecks the active flag so a stale
  // pick can't slip through. Each pick stacks price + duration on the
  // base/variation; only `include_in_deposit` flagged add-ons fold
  // into the deposit due today.
  const availableExtras = useMemo(() => {
    return (selectedCatalogService?.extras || []).filter(e => e.active !== false);
  }, [selectedCatalogService?.extras]);

  const pickedExtras = useMemo(() => {
    return availableExtras.filter(e => selectedExtraIds.includes(e.id));
  }, [availableExtras, selectedExtraIds]);

  // The ACV treatment is a managed extra surfaced as its own checkbox
  // right under the hair-color picker (so the flow reads "pick color →
  // opt into ACV"). Split it out of the generic add-ons list so it
  // isn't shown twice; pricing still flows through availableExtras /
  // pickedExtras, so the totals and the server submit are unchanged.
  const acvExtra = useMemo(
    () => availableExtras.find(e => (e as any).kind === ACV_EXTRA_KIND || e.id === ACV_EXTRA_ID) || null,
    [availableExtras],
  );
  const customColorExtra = useMemo(
    () => availableExtras.find(
      e => (e as any).kind === CUSTOM_COLOR_EXTRA_KIND || e.id === CUSTOM_COLOR_EXTRA_ID,
    ) || null,
    [availableExtras],
  );
  const genericExtras = useMemo(
    () => availableExtras.filter(
      e => (e as any).kind !== ACV_EXTRA_KIND && e.id !== ACV_EXTRA_ID
        && (e as any).kind !== CUSTOM_COLOR_EXTRA_KIND && e.id !== CUSTOM_COLOR_EXTRA_ID,
    ),
    [availableExtras],
  );
  const acvSelected = !!acvExtra && selectedExtraIds.includes(acvExtra.id);
  const toggleAcv = () => {
    if (!acvExtra) return;
    setSelectedExtraIds(prev =>
      prev.includes(acvExtra.id) ? prev.filter(x => x !== acvExtra.id) : [...prev, acvExtra.id],
    );
  };
  const customColorSelected = !!customColorExtra && selectedExtraIds.includes(customColorExtra.id);
  const toggleCustomColor = () => {
    if (!customColorExtra) return;
    setSelectedExtraIds(prev =>
      prev.includes(customColorExtra.id)
        ? prev.filter(x => x !== customColorExtra.id)
        : [...prev, customColorExtra.id],
    );
  };
  const uploadCustomColorPhoto = async (file: File) => {
    setCustomColorPhotoError(null);
    if (!file) return;
    if (file.size > 7 * 1024 * 1024) {
      setCustomColorPhotoError("Please use an image under 7 MB.");
      return;
    }
    setCustomColorPhotoUploading(true);
    try {
      const buf = await file.arrayBuffer();
      let binary = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = typeof window !== "undefined" ? window.btoa(binary) : "";
      const res = await fetch("/api/booking-color-photo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, image_base64: base64, media_type: file.type || "image/jpeg" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.url) {
        throw new Error(body?.error || "Upload failed");
      }
      setCustomColorPhotoUrl(String(body.url));
    } catch (e: any) {
      setCustomColorPhotoError(e?.message || "Couldn't upload that photo.");
    } finally {
      setCustomColorPhotoUploading(false);
    }
  };

  // True when the client's CURRENT selection includes human curly
  // hair — either the picked variation or any picked add-on. Drives
  // curl-pattern visibility/validation only; never touches pricing.
  const humanHairIncluded = useMemo(() => {
    const variation = variations.find((v: any) => v.id === selectedVariationId);
    if (isHumanHairIncludedSelection(variation)) return true;
    return pickedExtras.some(isHumanHairIncludedSelection);
  }, [variations, selectedVariationId, pickedExtras]);

  // Final resolved pricing including the picked add-ons. This is what
  // the summary box, deposit/balance lines, and the pay-button label
  // all read from.
  const resolved = useMemo(() => {
    if (!baseResolved) return null;
    const addonsPrice = pickedExtras.reduce((s, e) => s + (Number(e.price) || 0), 0);
    const addonsDuration = pickedExtras.reduce((s, e) => s + (Number(e.duration_hours_delta) || 0), 0);
    const addonsDepositExtra = pickedExtras
      .filter(e => e.include_in_deposit === true)
      .reduce((s, e) => s + (Number(e.price) || 0), 0);
    const price = baseResolved.price + addonsPrice;
    const durationHours = baseResolved.durationHours + addonsDuration;
    // Deposit rules:
    //   * If the base/variation already requires a deposit, add only
    //     the include_in_deposit add-ons to it.
    //   * If the base doesn't require one but an add-on does, the
    //     deposit becomes the sum of those flagged add-ons.
    let depositRequired = baseResolved.depositRequired;
    let depositAmount = baseResolved.depositAmount;
    if (depositRequired) {
      depositAmount = Math.min(price, depositAmount + addonsDepositExtra);
    } else if (addonsDepositExtra > 0) {
      depositRequired = true;
      depositAmount = Math.min(price, addonsDepositExtra);
    }
    return {
      ...baseResolved,
      price,
      durationHours,
      depositRequired,
      depositAmount,
      balanceDue: Math.max(0, price - depositAmount),
    };
  }, [baseResolved, pickedExtras]);

  // No-show consent is required to book whenever the stylist has no-show
  // protection on AND this booking will save a card (a deposit applies).
  // Single source of truth for the disclosure, the submit gate, and the
  // disabled state of the book button.
  const noShowConsentRequired = useMemo(() => {
    const depositApplies =
      (!!resolved && resolved.depositRequired && resolved.depositAmount > 0) ||
      (!!selectedCatalogService?.deposit_required &&
        Number(selectedCatalogService?.deposit_amount) > 0 && !hasVariations);
    return !!(noShowFee?.enabled && noShowFee.value && depositApplies);
  }, [noShowFee, resolved, selectedCatalogService, hasVariations]);

  // Reset picked add-ons whenever the service changes so a stale
  // pick from another service can't carry over.
  useEffect(() => {
    setSelectedExtraIds([]);
  }, [serviceId]);

  // Phase B7 — derived duration. When a catalog service is picked we
  // use its real duration; otherwise default to 60 minutes so the
  // calendar still surfaces meaningful slot counts. With variations,
  // the resolved duration wins (e.g. human-hair install adds time).
  const activeServiceId = selectedCatalogService?.id ?? null;
  // Clear style-customization picks when the chosen service changes
  // so a stale color/curl can't ride onto a different service.
  useEffect(() => {
    setHairColor("");
    setCustomHairColor("");
    setCurlPattern("");
    setCustomCurlPattern("");
  }, [activeServiceId]);
  // When the selection no longer includes human hair (e.g. switched
  // from a Human-Hair-Included option back to Standard), drop any
  // curl pattern so it doesn't get submitted while hidden, and clear
  // a stale custom value too. Switching back re-shows the dropdown
  // and re-requires a pick (validation gate).
  useEffect(() => {
    if (!humanHairIncluded) {
      setCurlPattern("");
      setCustomCurlPattern("");
    }
  }, [humanHairIncluded]);
  const activeServiceDurationHours =
    resolved?.durationHours ?? selectedCatalogService?.duration_hours ?? 0;
  const activeDurationMinutes = activeServiceId
    ? Math.max(15, Math.round((activeServiceDurationHours || 0) * 60))
    : DEFAULT_DURATION_MIN;

  // Re-fetch slots whenever the user picks a different date / service.
  // Now also runs without a catalog service (uses the default duration)
  // so a stylist who hasn't built services yet still gets a working
  // slot picker after the calendar selection.
  useEffect(() => {
    if (!preferredDate) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset on dep clear
      setSlots([]);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset on dep clear
      setHasFetchedSlots(false);
      return;
    }
    let cancelled = false;
    setSlotsLoading(true);
    setSlotsError(null);
    setHasFetchedSlots(false);
    (async () => {
      const result = await fetchPublicAvailability({
        slug,
        dateIso: preferredDate,
        serviceId: activeServiceId,
        durationMinutes: activeDurationMinutes,
        slotIntervalMinutes: 30,
      });
      if (cancelled) return;
      setSlotsLoading(false);
      if (!result.ok) { setSlotsError(result.error); return; }
      setSlots(result.slots);
      setHasFetchedSlots(true);
      if (preferredTime && !result.slots.find(s => s.time === preferredTime)) {
        setPreferredTime("");
      }
      if (link?.user_id) {
        void emitAnalyticsEvent({
          ownerUserId: link.user_id,
          type: "public_slot_viewed" as any,
          source: "public",
          payload: {
            slug,
            serviceId: activeServiceId,
            date: preferredDate,
            slotCount: result.slots.length,
          },
        });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferredDate, activeServiceId, activeDurationMinutes, slug]);

  // Phase B7 — month heatmap. Refetches when the visible month, the
  // selected service, or the duration changes. Cached per key so
  // navigating back to a previously-viewed month is instant.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch + cache hit pattern
  useEffect(() => {
    if (!slug) return;
    const key = `${monthCursor.year}-${monthCursor.month}-${activeServiceId || "none"}-${activeDurationMinutes}`;
    const cached = monthCache.current.get(key);
    if (cached) {
      setMonthDays(cached);
      setMonthLoading(false);
      setMonthError(null);
      return;
    }
    let cancelled = false;
    setMonthLoading(true);
    setMonthError(null);
    (async () => {
      const result = await fetchPublicMonthAvailability({
        slug,
        year: monthCursor.year,
        month: monthCursor.month,
        serviceId: activeServiceId,
        durationMinutes: activeDurationMinutes,
      });
      if (cancelled) return;
      setMonthLoading(false);
      if (!result.ok) { setMonthError(result.error); setMonthDays([]); return; }
      monthCache.current.set(key, result.days);
      setMonthDays(result.days);
    })();
    return () => { cancelled = true; };
  }, [slug, monthCursor.year, monthCursor.month, activeServiceId, activeDurationMinutes]);

  const monthHasAnyAvailability = useMemo(
    () => monthDays.some(d => d.status === "available" || d.status === "limited"),
    [monthDays],
  );

  // Derived empty-state gates. These keep the month-level and
  // day-level empty states mutually exclusive so the public booking
  // page never shows two "Join waitlist" prompts at once:
  //   - whole month empty  → month-level card only (has waitlist CTA)
  //   - month ok, day empty → day-level card only  (no waitlist CTA)
  const monthHasAvailability = monthHasAnyAvailability;
  const selectedDateHasAvailability =
    !!preferredDate && hasFetchedSlots && !slotsError && slots.length > 0;
  const showDateEmptyState =
    monthHasAvailability &&
    !!preferredDate && !slotsLoading && !slotsError &&
    hasFetchedSlots && !selectedDateHasAvailability;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitError(null);
    if (!name.trim()) { setSubmitError("Please enter your name."); return; }
    if (!phone.trim() && !email.trim()) { setSubmitError("Phone or email is required."); return; }
    // Catch a typo'd email before submit — it's often the stylist's only
    // way to send the confirmation, so a silent failure here loses the
    // booking. Light shape check only (don't reject unusual-but-valid).
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setSubmitError("That email doesn't look right — please double-check it.");
      return;
    }
    if (!preferredDate) { setSubmitError("Please pick a date for your appointment."); return; }
    if (!preferredTime) { setSubmitError("Please pick a time for your appointment."); return; }
    {
      const svc: any = hasCatalog ? selectedCatalogService : null;
      const custOn = svc && (svc.customization_enabled ?? true);
      const isOther = (v: string) => v.trim().toLowerCase().replace(/\s/g, "") === "custom/other";
      if (custOn && svc?.hair_included && svc?.allow_client_hair_color_selection) {
        if (!hairColor.trim()) { setSubmitError("Please select your braiding hair color."); return; }
        if (isOther(hairColor) && !customHairColor.trim()) {
          setSubmitError("Please tell your stylist the color you're looking for."); return;
        }
      }
      if (customColorSelected && !customColorDescription.trim() && !customColorPhotoUrl) {
        setSubmitError("Please describe your custom color or upload an inspiration photo.");
        return;
      }
      if (customColorPhotoUploading) {
        setSubmitError("Your inspiration photo is still uploading — please wait a moment.");
        return;
      }
      // Only require curl when the dropdown is actually visible
      // (selection enabled AND the picked option includes human hair).
      if (custOn && svc?.allow_client_curl_pattern_selection && humanHairIncluded) {
        if (!curlPattern.trim()) { setSubmitError("Please select your curl pattern."); return; }
        if (isOther(curlPattern) && !customCurlPattern.trim()) {
          setSubmitError("Please tell your stylist the curl pattern you're going for."); return;
        }
      }
    }
    // No-show fee consent gate — required when the stylist has no-show
    // protection on AND this booking will save a card (deposit).
    if (noShowConsentRequired && !noShowConsent) {
      setSubmitError("Please agree to the no-show fee policy to continue.");
      return;
    }
    setSubmitting(true);
    try {
      // When catalog is in play we send the real service snapshot
      // (id + duration in hours + base price). Legacy free-form
      // links keep the old shape — the edge function accepts both.
      const selected = hasCatalog
        ? selectedCatalogService
        : (services as any[]).find((s: any) => s?.name === serviceName);
      const dur = hasCatalog
        ? selectedCatalogService?.duration_hours
        : (selected as any)?.durationHours;
      const price = hasCatalog
        ? selectedCatalogService?.base_price
        : (selected as any)?.totalPrice;
      // Phase B1 — prefer the security-definer RPC so the booking
      // request lands with the full service snapshot (price /
      // duration / deposit / prep instructions), not just the id.
      // Falls back to the legacy edge function if the RPC isn't
      // deployed yet (older Supabase env) so existing booking links
      // never break.
      let submittedOk = false;
      let newRequestId: string | null = null;
      let needsDeposit = false;
      let offerBnpl = false;
      let bnplFullPrice = 0;
      let bnplDepositAmount = 0;
      const ctx = collectPublicContext();
      const supabase = getSupabase();
      // Phase B10 — the RPC now returns a TABLE with the new request
      // id, approval_status, and the deposit context the client needs
      // to redirect straight to Stripe Checkout.
      const { data: rpcRows, error: rpcErr } = await supabase.rpc(
        "public_submit_booking_request",
        {
          slug_in: slug,
          client_name_in: name.trim(),
          client_phone_in: phone.trim() || null,
          client_email_in: email.trim() || null,
          service_id_in: hasCatalog && selectedCatalogService ? selectedCatalogService.id : null,
          preferred_date_in: preferredDate || null,
          preferred_time_in: preferredTime || null,
          notes_in: notes.trim() || null,
          timezone_in: ctx.timezone,
          locale_in: ctx.locale,
          // New param — RPC resolves variation pricing server-side
          // against services.add_ons. Null = no variation picked.
          variation_id_in: hasCatalog && selectedVariationId ? selectedVariationId : null,
          // Pass picked add-on ids. The RPC resolves them server-side
          // against services.extras so a tampered payload can't invent
          // free upgrades — we only echo back what we trust.
          addon_ids_in: hasCatalog && selectedExtraIds.length > 0
            ? selectedExtraIds
            : null,
          // SMS reminder opt-in. The reminder scheduler only sends a
          // text when this is true AND a phone was given.
          sms_opt_in_in: SMS_ENABLED && smsOptIn && !!phone.trim(),
        },
      );
      if (!rpcErr && rpcRows) {
        const row = Array.isArray(rpcRows) ? rpcRows[0] : (rpcRows as any);
        if (row?.request_id) {
          submittedOk = true;
          newRequestId = String(row.request_id);
          needsDeposit = !!row.deposit_required && Number(row.deposit_amount) > 0;
          // Pay-in-full BNPL offer — the RPC only sets this true when the
          // stylist opted in AND the full ticket exceeds the deposit.
          offerBnpl = !!row.bnpl_enabled;
          bnplFullPrice = Number(row.service_price) || 0;
          bnplDepositAmount = Number(row.deposit_amount) || 0;
        }
      }
      if (!submittedOk) {
        // Legacy edge-function fallback. Only triggers when the
        // RPC isn't deployed (404) or returns null.
        const res = await fetch(`${FUNCTIONS_URL}/booking-request`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            slug,
            clientName: name.trim(),
            clientPhone: phone.trim() || null,
            clientEmail: email.trim() || null,
            serviceId: hasCatalog && selectedCatalogService ? selectedCatalogService.id : null,
            serviceName: serviceName || null,
            serviceDuration: dur ?? null,
            servicePrice: price ?? null,
            serviceDepositRequired: hasCatalog && selectedCatalogService ? selectedCatalogService.deposit_required : null,
            serviceDepositAmount: hasCatalog && selectedCatalogService ? selectedCatalogService.deposit_amount : null,
            preferredDate: preferredDate || null,
            preferredTime: preferredTime || null,
            notes: notes.trim() || null,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || "Couldn't send request");
        submittedOk = true;
      }
      if (!submittedOk) throw new Error("Couldn't send your request.");

      if (newRequestId) {
        // Phase B12.1a — enqueue notifications via the universal
        // queue. The public booking page runs as anon, which can't
        // call queue_notification directly (security: would let
        // anyone spam emails). Instead we call the SECURITY DEFINER
        // wrapper enqueue_public_booking_emails for the booking
        // confirmation only. Contract generation/signing emails are
        // intentionally delayed until owner approval.
        //
        // Deposit-first bookings hold ALL notifications until the
        // deposit actually clears — otherwise the client (and the
        // stylist) get pinged about a request that was never paid for.
        // The deposit webhook (app/api/booking-deposit/webhook) fires
        // the post-payment notifications instead. No-deposit bookings
        // have no payment gate, so we acknowledge immediately as before.
        if (!needsDeposit) {
          try {
            const base = typeof window !== "undefined" ? window.location.origin : null;
            await supabase.rpc("enqueue_public_booking_emails", {
              request_id_in: newRequestId,
              app_base_url_in: base,
            });
          } catch {
            // Stylist can always resend signing links manually from
            // the Approvals queue Contracts mini-card.
          }
        }

        // Who the appointment is for — best-effort, never blocks the
        // booking. Only attaches when the client booked for someone
        // else and gave a name; carried onto the appointment as the
        // dependent on approval.
        if (!bookedForSelf && recipientName.trim()) {
          try {
            await supabase.rpc("public_attach_booking_recipient", {
              request_id_in: newRequestId,
              booked_for_name_in: recipientName.trim(),
              booked_for_note_in: recipientNote.trim() || null,
            });
          } catch {
            /* booking already saved — recipient is non-fatal */
          }
        }

        // Style customization — best-effort, never blocks the
        // booking. "Custom / Other" free text rides in
        // customization_summary; the structured pick goes to
        // selected_hair_color / selected_curl_pattern.
        const isCustom = (v: string) =>
          v.trim().toLowerCase() === "custom / other" || v.trim().toLowerCase() === "custom/other";
        const hairPick = hairColor.trim();
        const curlPick = curlPattern.trim();
        // Pack a readable line for the stylist when the client opted
        // into the paid "Customized braiding hair color" extra. The
        // RPC trims to 300 chars; we keep both the description and
        // the inspiration photo URL so a manual review sees both.
        let customHairText: string | null =
          isCustom(hairPick) && customHairColor.trim() ? customHairColor.trim() : null;
        if (customColorSelected) {
          const parts: string[] = [];
          if (customColorDescription.trim()) parts.push(`Customized color: ${customColorDescription.trim()}`);
          else parts.push("Customized color requested");
          if (customColorPhotoUrl) parts.push(`Inspiration: ${customColorPhotoUrl}`);
          const combined = parts.join(" | ");
          customHairText = customHairText ? `${customHairText} | ${combined}` : combined;
        }
        if (hairPick || curlPick || customHairText) {
          try {
            await supabase.rpc("public_attach_booking_customization", {
              request_id_in: newRequestId,
              hair_color_in: hairPick || null,
              curl_pattern_in: curlPick || null,
              style_notes_in: null,
              custom_hair_color_in: customHairText,
              custom_curl_in:
                isCustom(curlPick) && customCurlPattern.trim() ? customCurlPattern.trim() : null,
            });
          } catch {
            /* booking already saved — customization is non-fatal */
          }
        }

        // Intake / consultation answers — attached before the deposit
        // step so they're on the request when the stylist approves and
        // ride into the confirmation email. Best-effort; never blocks.
        const askedQs = visibleQuestions(intakeForm);
        if (askedQs.length > 0) {
          const answers = askedQs
            .map((q) => ({ q: q.label, a: String(intakeAnswers[q.id] ?? "").trim() }))
            .filter((x) => x.a);
          if (answers.length > 0) {
            try {
              await attachIntakeAnswers(newRequestId, answers);
            } catch {
              /* booking already saved — intake is non-fatal */
            }
          }
        }

        // Stamp no-show-fee consent as proof, before the deposit step.
        if (noShowConsent && noShowFee?.enabled) {
          try {
            await recordNoShowConsent(newRequestId);
          } catch {
            /* booking already saved — consent stamp is non-fatal */
          }
        }
      }

      // Analytics — record that a per-variation deposit was used so
      // we can spot adoption of the new pricing model. Metadata-only;
      // no client name / email / phone / notes leak through.
      if (needsDeposit && resolved && selectedCatalogService) {
        const priceBucket = (() => {
          const p = resolved.price;
          if (p <= 50) return "0-50";
          if (p <= 100) return "51-100";
          if (p <= 200) return "101-200";
          if (p <= 350) return "201-350";
          if (p <= 500) return "351-500";
          return "500+";
        })();
        trackEvent("service_variation_deposit_used", {
          category: "booking",
          metadata: {
            has_variation: !!resolved.variationId,
            deposit_amount: resolved.depositAmount,
            price_bucket: priceBucket,
          },
        });
      }

      // Deposit-required path: kick the client straight to Stripe.
      // The success URL routes them to /booking/success which polls
      // the RPC until the webhook flips approval_status.
      if (needsDeposit && newRequestId) {
        // When the stylist offers pay-in-full BNPL, pause and let the
        // client pick deposit vs full instead of auto-redirecting.
        if (offerBnpl && bnplFullPrice > bnplDepositAmount) {
          setPaymentChoice({
            requestId: newRequestId,
            depositAmount: bnplDepositAmount,
            fullPrice: bnplFullPrice,
          });
          return;
        }
        const checkoutRes = await fetch("/api/booking-deposit/checkout", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ request_id: newRequestId }),
        });
        const checkoutBody = await checkoutRes.json().catch(() => ({}));
        if (!checkoutRes.ok || !checkoutBody?.url) {
          throw new Error(
            checkoutBody?.error || "Couldn't start checkout. Please try again.",
          );
        }
        // Full-page redirect to Stripe Checkout. Using assign() (instead
        // of href=) so the lint compiler doesn't flag the assignment.
        if (typeof window !== "undefined") window.location.assign(String(checkoutBody.url));
        return;
      }

      // A booking request was created on every non-deposit path — record
      // it before branching to the optional pay-now choice.
      if (link?.user_id) {
        void emitAnalyticsEvent({
          ownerUserId: link.user_id,
          type: "booking_requested",
          source: "public",
          payload: {
            slug,
            serviceName: serviceName || null,
            preferredDate: preferredDate || null,
            preferredTime: preferredTime || null,
          },
        });
      }

      // No-deposit service where the stylist offers pay-in-full BNPL. The
      // "request received" notifications already went out above (this is
      // the !needsDeposit branch), so the request stands on its own — we
      // just offer an optional "pay in full now" path. Choosing "continue
      // without paying" keeps the existing pay-later flow.
      if (!needsDeposit && offerBnpl && newRequestId && bnplFullPrice > 0) {
        setPaymentChoice({
          requestId: newRequestId,
          depositAmount: 0,
          fullPrice: bnplFullPrice,
        });
        return;
      }

      setSubmitted(true);
    } catch (err: any) {
      setSubmitError(
        err?.message
          ? `Couldn't send your request: ${err.message}. Please try again in a moment.`
          : "Couldn't send your request. Check your connection and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  // Per-link accent color from the customization fields, with the
  // brand gold as the default. The CHECK constraint on the column
  // guarantees this is a safe hex string before it lands in
  // production, so dropping it into inline `style` is fine.
  const accent = link?.accent_color || C.gold;

  // Display handle for the @ line under the title in the new
  // storefront-style header. Prefers the branded slug; falls back
  // to whatever URL the visitor arrived on.
  const displayHandle = (link?.branded_slug || slug || "").replace(/^@/, "");

  // Which hero layout the stylist picked. Anything we don't recognize
  // (including null on legacy links) falls back to 'classic' so the
  // header never breaks on an unexpected value — the DB CHECK already
  // whitelists these three, this is just defense in depth.
  const headerTheme: "classic" | "editorial" | "spotlight" =
    link?.header_theme === "editorial" || link?.header_theme === "spotlight"
      ? link.header_theme
      : "classic";
  const tagline = (link?.tagline || "").trim();
  const about = (link?.about || "").trim();
  // Portrait for the 'spotlight' "Meet your stylist" hero — prefer the
  // dedicated stylist photo (a picture of her), then the uploaded logo,
  // then the first gallery photo, else a tinted gradient placeholder so
  // the card never renders a broken image.
  const heroPortrait =
    link?.stylist_photo_url ||
    link?.logo_url ||
    (Array.isArray(link?.gallery_photos) && link!.gallery_photos!.length > 0
      ? link!.gallery_photos!.slice().sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))[0]?.url || ""
      : "") ||
    "";

  // Never render the profile chrome with placeholder data. Until the
  // real booking link resolves, show only the branded loader; if it
  // failed to resolve, show a clean not-found state. This kills the
  // "Welcome / @randomslug / gradient" flash (worst in the Instagram
  // in-app browser).
  if (linkLoading && !link) {
    return <BookingBootScreen />;
  }
  if (!link) {
    return (
      <BookingBootScreen
        notFound
        message={linkError || "This booking link may be unavailable."}
      />
    );
  }

  // Resolve a gallery photo's "shop this look" metadata. A photo can
  // be linked to a service (serviceId) and/or carry a free-form style
  // label. When linked, we surface the live service name + "from $X"
  // and let "Book this look" pre-select it. Defined here — after all
  // state is declared — so it can close over `catalog` safely.
  const resolvePhotoMeta = (photo: { serviceId?: string; label?: string }) => {
    const svc = photo.serviceId ? catalog.find((s) => s.id === photo.serviceId) : undefined;
    const title = (photo.label || "").trim() || svc?.name || "";
    const fromPrice = svc ? Number((svc as any).base_price) : null;
    return { svc, title, fromPrice };
  };

  return (
    <div style={{ minHeight: "100dvh", background: C.cream, fontFamily: FONT_BODY, color: C.espresso }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=DM+Sans:wght@400;500;600;700&display=swap');
        * { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
        body { margin: 0; }
        input, textarea, select, button { font-family: inherit; }
        /* Brand wordmark entrance — slides in from the left while
           fading + finishing on its wider letter-spacing. Mirrors
           the StorefrontShell animation so both surfaces play the
           same opening on first paint. */
        @keyframes bbpBrandSlideIn {
          0% {
            opacity: 0;
            transform: translateX(-36px);
            letter-spacing: 0.20em;
          }
          100% {
            opacity: 1;
            transform: translateX(0);
            letter-spacing: 0.34em;
          }
        }
        .bbp-brand-wordmark {
          animation: bbpBrandSlideIn 1.2s cubic-bezier(.2,.8,.2,1) both;
          animation-delay: 180ms;
        }
        @media (prefers-reduced-motion: reduce) {
          .bbp-brand-wordmark { animation: none; }
        }
        /* Visible scrollbar on the product rails so visitors know
           there are more items to swipe through. Kept thin + brand-
           tinted so it reads as polished UI, not OS chrome. Applied
           only to .bbp-rail elements; other horizontal scrollers
           (services, gallery) keep their hidden scrollbars. */
        .bbp-rail { scrollbar-width: thin; scrollbar-color: rgba(124, 58, 237, 0.40) transparent; }
        .bbp-rail::-webkit-scrollbar { height: 4px; }
        .bbp-rail::-webkit-scrollbar-track { background: transparent; }
        .bbp-rail::-webkit-scrollbar-thumb {
          background: linear-gradient(90deg, #7C3AED, #FF4D6D);
          border-radius: 99px;
        }
        /* Branded-hero entrance — the editorial / spotlight headers
           rise + fade their identity stack on first paint so the
           stylist's brand makes an entrance instead of snapping in.
           Each child is staggered via inline animation-delay. */
        @keyframes bbpHeroRise {
          0%   { opacity: 0; transform: translateY(16px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        .bbp-hero-rise {
          animation: bbpHeroRise 0.9s cubic-bezier(.2,.8,.2,1) both;
          will-change: transform, opacity;
        }
        @media (prefers-reduced-motion: reduce) {
          .bbp-hero-rise { animation: none; }
        }
        /* Featured "spotlight" — a soft, slowly-pulsing aura behind a
           featured service card so it reads as the hero pick instead
           of just another row. The glow color is driven by
           --bbp-accent (the stylist's storefront accent) so it always
           matches the theme rather than a hard-coded purple. The
           center brightens toward white on each pulse to read as lit /
           illuminated. Lives on a wrapper (not the card) because the
           card clips overflow for its cover image. */
        @keyframes bbpFeaturedGlow {
          0%, 100% { opacity: .5;  transform: scale(.985); }
          50%      { opacity: .95; transform: scale(1.025); }
        }
        .bbp-featured { position: relative; isolation: isolate; }
        .bbp-featured::before {
          content: "";
          position: absolute;
          inset: -7px;
          z-index: -1;
          border-radius: 24px;
          background:
            radial-gradient(58% 58% at 50% 42%,
              color-mix(in srgb, #FFFFFF 28%, var(--bbp-accent)) 0%,
              color-mix(in srgb, var(--bbp-accent) 60%, transparent) 38%,
              transparent 72%),
            radial-gradient(80% 80% at 50% 60%,
              color-mix(in srgb, var(--bbp-accent) 28%, transparent) 0%,
              transparent 75%);
          filter: blur(11px);
          animation: bbpFeaturedGlow 3s ease-in-out infinite;
          pointer-events: none;
        }
        @media (prefers-reduced-motion: reduce) {
          .bbp-featured::before { animation: none; opacity: .7; transform: none; }
        }
      `}</style>

      {/* Storefront-style hero — full-width gradient (or banner
          image) banner with the logo overlapping the bottom-left
          edge, the business name + @handle to the right, and a
          Profile / Shop tab nav underneath. Mirrors the visual
          shape of /@handle/shop so visitors see one consistent
          shell across booking + storefront. */}
      <div
        style={{
          // The branded heroes (editorial / spotlight) sit on a taller
          // banner so the overlapping identity has room to breathe.
          height: headerTheme === "classic" ? 156 : 190,
          background: link?.banner_image_url
            ? `url(${link.banner_image_url}) center / cover no-repeat`
            : "linear-gradient(160deg, #7C3AED 0%, #B14BE0 45%, #FF4D6D 100%)",
          position: "relative",
        }}
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.18) 100%)",
          }}
        />
        {/* Brand wordmark — sits in the upper portion of the banner
            so it doesn't collide with the logo overlap below. Only
            renders when the stylist hasn't uploaded a custom banner;
            stamping the wordmark over their photography would feel
            cheap. Matches the same treatment on the storefront shell
            so /book/<slug> and /@handle/shop share one identity. */}
        {!link?.banner_image_url && (
          <p
            aria-hidden
            className="bbp-brand-wordmark"
            style={{
              position: "absolute",
              top: 46,
              left: 0,
              right: 0,
              textAlign: "center",
              color: "rgba(255, 255, 255, 0.96)",
              fontSize: 15,
              fontWeight: 800,
              letterSpacing: "0.34em",
              textTransform: "uppercase",
              textShadow: "0 1px 10px rgba(21, 17, 26, 0.20)",
              willChange: "transform, opacity, letter-spacing",
              margin: 0,
            }}
          >
            Braid Boss Pro
          </p>
        )}
      </div>
      <div
        className="mx-auto"
        style={{ maxWidth: 480, padding: "0 20px", position: "relative" }}
      >
        {/* Identity block — theme-aware. 'classic' is the original
            banner-overlapping logo + name row (byte-for-byte, so every
            existing link is untouched). 'editorial' and 'spotlight' are
            the branded heroes: a centered serif lockup and a "Meet your
            stylist" portrait card respectively, each rising in on first
            paint. The -44/-52/-56 top margins pull each lockup up so it
            overlaps the banner's bottom edge. */}
        {headerTheme === "editorial" ? (
          <div
            className="bbp-hero-rise"
            style={{
              marginTop: -52,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: 104, height: 104, borderRadius: 999,
                background: C.paper, border: `4px solid ${C.cream}`,
                boxShadow: "0 14px 36px -14px rgba(21, 17, 26, 0.24)",
                overflow: "hidden", flexShrink: 0,
              }}
            >
              {link?.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={link.logo_url}
                  alt={link.business_name || "Studio logo"}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <div
                  aria-hidden
                  style={{ width: "100%", height: "100%", background: "linear-gradient(135deg, #7C3AED 0%, #FF4D6D 100%)" }}
                />
              )}
            </div>
            <h1
              style={{
                fontFamily: FONT_DISPLAY, fontSize: 32, fontWeight: 700,
                color: C.brandPrimary, lineHeight: 1.05, margin: "14px 0 0",
              }}
            >
              {link?.business_name || "Welcome"}
            </h1>
            {displayHandle && (
              <p style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>@{displayHandle}</p>
            )}
            {tagline && (
              <p
                style={{
                  fontFamily: FONT_DISPLAY, fontStyle: "italic", fontWeight: 500,
                  fontSize: 17, color: C.coffee, margin: "8px 0 0", lineHeight: 1.3,
                }}
              >
                {tagline}
              </p>
            )}
            {about && (
              <p style={{ fontSize: 14, lineHeight: 1.6, color: C.muted, margin: "10px auto 0", maxWidth: 360 }}>
                {about}
              </p>
            )}
          </div>
        ) : headerTheme === "spotlight" ? (
          <div className="bbp-hero-rise" style={{ marginTop: -56 }}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => setAboutOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setAboutOpen(true);
                }
              }}
              aria-haspopup="dialog"
              aria-label={`Meet your stylist — ${link?.business_name || "about the stylist"}`}
              style={{
                display: "flex", gap: 14, alignItems: "center",
                background: C.paper, border: `1px solid ${C.hairline}`,
                borderRadius: 20, padding: 14,
                boxShadow: "0 18px 44px -22px rgba(21, 17, 26, 0.30)",
                overflow: "hidden", cursor: "pointer",
              }}
            >
              <div
                style={{
                  width: 88, height: 88, borderRadius: 16, overflow: "hidden",
                  flexShrink: 0, border: `1px solid ${C.hairline}`,
                }}
              >
                {heroPortrait ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={heroPortrait}
                    alt={link?.business_name || "Studio"}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <div
                    aria-hidden
                    style={{ width: "100%", height: "100%", background: "linear-gradient(135deg, #7C3AED 0%, #FF4D6D 100%)" }}
                  />
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p
                  style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: "0.2em",
                    textTransform: "uppercase", color: accent, margin: 0,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}
                >
                  Meet your stylist
                </p>
                <h1
                  style={{
                    fontFamily: FONT_DISPLAY, fontWeight: 700,
                    fontSize: "clamp(18px, 5.5vw, 24px)",
                    color: C.brandPrimary, lineHeight: 1.1, margin: "4px 0 0",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}
                >
                  {link?.business_name || "Welcome"}
                </h1>
                {tagline ? (
                  <p
                    style={{
                      fontFamily: FONT_DISPLAY, fontStyle: "italic", fontWeight: 500,
                      fontSize: "clamp(13px, 3.8vw, 15px)",
                      color: C.coffee, margin: "2px 0 0",
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    }}
                  >
                    {tagline}
                  </p>
                ) : displayHandle ? (
                  <p style={{
                    fontSize: 12, color: C.muted, margin: "2px 0 0",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>@{displayHandle}</p>
                ) : null}
              </div>
              <span
                aria-hidden
                style={{
                  flexShrink: 0, alignSelf: "center", color: accent,
                  fontSize: 22, lineHeight: 1, fontWeight: 400,
                }}
              >
                ›
              </span>
            </div>
            {about && (
              <p style={{ fontSize: 14, lineHeight: 1.6, color: C.coffee, margin: "12px 2px 0" }}>
                {about}
              </p>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginTop: -44 }}>
            <div
              style={{
                width: 88, height: 88, borderRadius: 18,
                background: C.paper,
                border: `4px solid ${C.cream}`,
                boxShadow: "0 12px 32px -12px rgba(21, 17, 26, 0.18)",
                flexShrink: 0,
                overflow: "hidden",
              }}
            >
              {link?.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={link.logo_url}
                  alt={link.business_name || "Studio logo"}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <div
                  aria-hidden
                  style={{
                    width: "100%", height: "100%",
                    background: "linear-gradient(135deg, #7C3AED 0%, #FF4D6D 100%)",
                  }}
                />
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0, marginTop: 52 }}>
              {/* marginTop pushes the name + handle below the
                  banner's bottom edge so the title sits on the
                  white surface, not floating into the pink. With
                  alignItems: flex-start on the parent flex row,
                  this margin is applied from the top of the row
                  (which sits 44px above the banner bottom because
                  of the row's marginTop:-44 overlap) — i.e. text
                  starts ~8px below the banner edge.
                  Color shifts to brandPrimary (purple) at a heavier
                  weight + larger size per the user's design pass —
                  makes the name read as the page's anchor heading
                  instead of a small caption next to the logo. */}
              <h1
                style={{
                  fontFamily: FONT_DISPLAY, fontSize: 28, fontWeight: 700,
                  color: C.brandPrimary, lineHeight: 1.1, margin: 0,
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}
              >
                {link?.business_name || "Welcome"}
              </h1>
              {displayHandle && (
                <p
                  style={{
                    fontSize: 12, color: C.muted, marginTop: 4,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}
                >
                  @{displayHandle}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Profile / Shop tab nav. Profile is the active page —
            tapping it is a no-op. Shop links to the storefront
            grid using the canonical slug; the /@handle resolver
            accepts either branded or random slugs. */}
        <nav
          style={{
            marginTop: 20, display: "flex", gap: 8,
            borderBottom: `1px solid ${C.brandBorder}`,
          }}
        >
          {(["profile", "shop"] as const).map((tab) => {
            const isActive = tab === "profile";
            const onClick = () => {
              if (isActive) return;
              router.push(`/@${encodeURIComponent(displayHandle || slug)}/shop`);
            };
            return (
              <button
                key={tab}
                type="button"
                onClick={onClick}
                style={{
                  padding: "12px",
                  background: "transparent",
                  border: 0,
                  color: isActive ? C.brandPrimary : C.muted,
                  fontSize: 13,
                  fontWeight: 700,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  borderBottom: `2px solid ${isActive ? C.brandPrimary : "transparent"}`,
                  marginBottom: -1,
                  cursor: isActive ? "default" : "pointer",
                }}
              >
                {tab === "profile" ? "Profile" : "Shop"}
              </button>
            );
          })}
        </nav>
      </div>
      <div
        className="mx-auto"
        style={{
          maxWidth: 480,
          padding: "20px 20px",
          paddingBottom: "calc(120px + env(safe-area-inset-bottom, 0px))",
        }}
      >
        {/* Location + phone chips. Prefer the structured city/state
            pair when present, fall back to the free-form
            location_text. Phone stays its own tappable chip. */}
        {(() => {
          const city = (link?.business_city || "").trim();
          const state = (link?.business_state || "").trim();
          const composedLocation = (city && state) ? `${city}, ${state}` : (city || state || link?.location_text || "");
          if (!composedLocation && !link?.phone && !link?.years_in_business) return null;
          return (
            <div style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              {composedLocation && (
                <span style={{ fontSize: 11, color: C.coffee, padding: "4px 10px", borderRadius: 99, background: "#FFFFFF", border: `1px solid ${accent}` }}>
                  {composedLocation}
                </span>
              )}
              {link?.years_in_business != null && link.years_in_business > 0 && (
                <span style={{ fontSize: 11, color: C.coffee, padding: "4px 10px", borderRadius: 99, background: "#FFFFFF", border: `1px solid ${accent}` }}>
                  {link.years_in_business} {link.years_in_business === 1 ? "yr" : "yrs"} in business
                </span>
              )}
              {link?.phone && (
                <a href={`tel:${link.phone.replace(/\s/g, "")}`} style={{ fontSize: 11, color: C.coffee, padding: "4px 10px", borderRadius: 99, background: "#FFFFFF", border: `1px solid ${accent}`, textDecoration: "none" }}>
                  {link.phone}
                </a>
              )}
            </div>
          );
        })()}
        {link?.intro && (
          // Bolder + darker than before so the stylist's tagline
          // reads as a real statement, not a caption.
          <p
            style={{
              textAlign: "center",
              color: C.espresso,
              marginTop: 12,
              fontSize: 15,
              fontWeight: 600,
              lineHeight: 1.35,
              letterSpacing: "-0.005em",
            }}
          >
            {link.intro}
          </p>
        )}
        {/* Social + share row. Each social link is its own pill
            opening in a new tab; share uses navigator.share when
            available and falls back to clipboard copy so it always
            does *something*. Hidden entirely when the stylist hasn't
            set socials AND we have nothing useful to share. */}
        {(() => {
          const socials: Array<{ key: string; label: string; href: string }> = [];
          if (link?.instagram_url) socials.push({ key: "ig", label: "Instagram", href: link.instagram_url });
          if (link?.tiktok_url) socials.push({ key: "tt", label: "TikTok", href: link.tiktok_url });
          if (link?.website_url) socials.push({ key: "web", label: "Website", href: link.website_url });
          const showShare = typeof window !== "undefined";
          if (socials.length === 0 && !showShare && !link?.phone) return null;
          const handleShare = async () => {
            const url = typeof window !== "undefined" ? window.location.href : "";
            const title = link?.business_name ? `${link.business_name} — book an appointment` : "Book an appointment";
            try {
              if (navigator.share) {
                await navigator.share({ title, url });
                return;
              }
            } catch { /* user cancelled — fall through silently */ }
            try { await navigator.clipboard?.writeText(url); } catch { /* ignore */ }
          };
          // Compact circular icon button — lightens the connect row vs.
          // a stack of text pills. Each carries an aria-label/title so
          // the icon stays accessible.
          const iconBtnStyle: React.CSSProperties = {
            // Neutral ring so the full-color brand logos read cleanly
            // instead of fighting an accent-tinted border.
            width: 42, height: 42, borderRadius: 999, padding: 0,
            border: `1px solid ${C.hairline}`, background: "#FFFFFF", color: accent,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            textDecoration: "none", cursor: "pointer", flex: "0 0 auto",
            boxShadow: "0 1px 3px rgba(21, 17, 26, 0.06)",
            appearance: "none", WebkitAppearance: "none",
          };
          const svgProps = {
            width: 19, height: 19, viewBox: "0 0 24 24", fill: "none",
            stroke: "currentColor", strokeWidth: 1.8,
            strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
          };
          // Full-color brand logos so each icon reads as the real mark.
          const igGradId = "bbp-ig-grad";
          // TikTok note path, layered in cyan + red + black for the
          // official offset-glow look.
          const ttPath = "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z";
          const socialIcon = (key: string) => {
            if (key === "ig") return (
              <svg width={20} height={20} viewBox="0 0 24 24" fill="none" aria-hidden>
                <defs>
                  <linearGradient id={igGradId} x1="2" y1="22" x2="22" y2="2" gradientUnits="userSpaceOnUse">
                    <stop offset="0" stopColor="#FED576" />
                    <stop offset="0.26" stopColor="#F47133" />
                    <stop offset="0.61" stopColor="#BC3081" />
                    <stop offset="1" stopColor="#4C63D2" />
                  </linearGradient>
                </defs>
                <path fill={`url(#${igGradId})`} d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
              </svg>
            );
            if (key === "tt") return (
              <svg width={20} height={20} viewBox="-2 -2 28 28" aria-hidden>
                <path fill="#25F4EE" transform="translate(-1,0.6)" d={ttPath} />
                <path fill="#FE2C55" transform="translate(1,-0.6)" d={ttPath} />
                <path fill="#010101" d={ttPath} />
              </svg>
            );
            return (
              <svg {...svgProps}>
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
            );
          };
          return (
            <div
              style={{
                marginTop: 14,
                display: "flex",
                justifyContent: "center",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              {socials.map(s => (
                <a
                  key={s.key}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={s.label}
                  title={s.label}
                  style={iconBtnStyle}
                >
                  {socialIcon(s.key)}
                </a>
              ))}
              {showShare && (
                <button
                  type="button"
                  onClick={handleShare}
                  aria-label="Share profile"
                  title="Share profile"
                  style={iconBtnStyle}
                >
                  <svg width={19} height={19} viewBox="0 0 24 24" fill="#1D9BF6" aria-hidden>
                    <path d="M14 9V5l7 7-7 7v-4.1c-5 0-8.5 1.5-11 4.6 1-5 4-8.5 11-9.5z" />
                  </svg>
                </button>
              )}
              {/* Message icon lives in the same connect row as socials +
                  share so contact actions read as one tidy group. */}
              {link?.phone && (
                <a
                  href={`sms:${link.phone.replace(/\s/g, "")}`}
                  aria-label="Message"
                  title="Message"
                  style={iconBtnStyle}
                >
                  <svg width={19} height={19} viewBox="0 0 24 24" fill="#34C759" aria-hidden>
                    <path d="M12 2C6.486 2 2 5.94 2 10.5c0 2.42 1.27 4.6 3.29 6.09-.13 1.5-.74 3.18-1.62 4.32-.2.26 0 .63.32.57 2.4-.42 4.18-1.41 5.32-2.27.86.18 1.76.29 2.69.29 5.514 0 10-3.94 10-8.5S17.514 2 12 2z" />
                  </svg>
                </a>
              )}
            </div>
          );
        })()}
        {/* Policies — collapsible cream card so the headline stays
            uncluttered for browsing clients but power-users can read
            them before committing. */}
        {link?.policies && (
          <details
            style={{
              marginTop: 16,
              padding: "12px 14px",
              borderRadius: 14,
              background: C.paper,
              border: `1px solid ${C.hairline}`,
            }}
          >
            <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 600, letterSpacing: "0.04em", color: C.coffee, listStyle: "none", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span>Tap to see studio policies</span>
              <span aria-hidden style={{ fontSize: 14, color: C.muted, lineHeight: 1 }}>＋</span>
            </summary>
            <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.55, color: C.coffee, whiteSpace: "pre-wrap" }}>
              {link.policies}
            </p>
          </details>
        )}

        {/* Stylist work gallery — horizontal scroll-snap carousel
            rendered above the form. Cap of 8 photos is enforced both
            in the upload helper and at the DB level via a CHECK
            constraint on gallery_photos. Lazy-load every img so this
            block never blocks first paint of the form. */}
        {Array.isArray(link?.gallery_photos) && link!.gallery_photos!.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <p style={{
              fontSize: 11, fontWeight: 700, letterSpacing: "0.14em",
              textTransform: "uppercase", color: C.coffee, marginBottom: 8,
              textAlign: "center",
            }}>
              Recent work
            </p>
            <div
              style={{
                display: "flex",
                gap: 10,
                overflowX: "auto",
                overflowY: "hidden",
                scrollSnapType: "x mandatory",
                WebkitOverflowScrolling: "touch",
                // Negative margin escapes the page's horizontal padding
                // so the carousel can bleed to the screen edges; the
                // inner padding restores breathing room around photos.
                marginLeft: -20,
                marginRight: -20,
                paddingLeft: 20,
                paddingRight: 20,
                paddingBottom: 4,
                scrollbarWidth: "none",
              }}
            >
              {link!.gallery_photos!
                .slice()
                .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
                .slice(0, 8)
                .map((p, i) => {
                  const meta = resolvePhotoMeta(p);
                  return (
                  <button
                    key={p.url || i}
                    type="button"
                    onClick={() => setLightboxIndex(i)}
                    aria-label={meta.title ? `Open ${meta.title}` : `Open photo ${i + 1}`}
                    style={{
                      position: "relative",
                      flex: "0 0 auto",
                      appearance: "none",
                      WebkitAppearance: "none",
                      padding: 0,
                      border: `1px solid ${C.hairline}`,
                      borderRadius: 16,
                      background: C.paper,
                      cursor: "zoom-in",
                      scrollSnapAlign: "center",
                      overflow: "hidden",
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.url}
                      alt={meta.title || `${link?.business_name || "Studio"} — photo ${i + 1}`}
                      loading="lazy"
                      decoding="async"
                      style={{
                        display: "block",
                        width: 200,
                        height: 240,
                        objectFit: "cover",
                      }}
                    />
                    {/* "Shop this look" caption — only when the stylist
                        named the style or linked a service. Gradient
                        keeps the text legible over any photo. */}
                    {(meta.title || meta.fromPrice != null) && (
                      <div
                        style={{
                          position: "absolute",
                          left: 0, right: 0, bottom: 0,
                          padding: "20px 12px 10px",
                          textAlign: "left",
                          background: "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.62) 100%)",
                          color: "#FFFFFF",
                        }}
                      >
                        {meta.title && (
                          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, lineHeight: 1.25, textShadow: "0 1px 6px rgba(0,0,0,0.4)" }}>
                            {meta.title}
                          </p>
                        )}
                        {meta.fromPrice != null && (
                          <p style={{ margin: "2px 0 0", fontSize: 11, fontWeight: 600, opacity: 0.92 }}>
                            from ${meta.fromPrice.toFixed(0)}
                          </p>
                        )}
                      </div>
                    )}
                  </button>
                  );
                })}
            </div>
          </div>
        )}

        {/* Client reviews — appointment-tied star ratings. The
            header chip shows the average; tapping it expands the
            written reviews. Same data as the /discover marketplace
            card, so the rating is consistent across surfaces.
            Hides itself when there are no reviews. */}
        {clientReviews.length > 0 && (() => {
          const avg = clientReviews.reduce((s, r) => s + (r.stars || 0), 0) / clientReviews.length;
          const count = clientReviews.length;
          const fullStars = Math.max(0, Math.min(5, Math.round(avg)));
          return (
            <div style={{ marginTop: 28 }}>
              <button
                type="button"
                onClick={() => setReviewsOpen(o => !o)}
                style={{
                  width: "100%",
                  background: C.paper,
                  border: `1px solid ${C.hairline}`,
                  borderRadius: 16,
                  padding: "14px 16px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  cursor: "pointer",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <span style={{ color: accent, fontSize: 15, letterSpacing: 1 }} aria-hidden>
                    {"★".repeat(fullStars)}<span style={{ color: C.hairline }}>{"★".repeat(5 - fullStars)}</span>
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: C.espresso }}>{avg.toFixed(1)}</span>
                  <span style={{ fontSize: 13, color: C.muted }}>· {count} review{count === 1 ? "" : "s"}</span>
                </span>
                <span style={{ fontSize: 12, fontWeight: 700, color: accent, whiteSpace: "nowrap" }}>
                  {reviewsOpen ? "Hide" : "Read reviews"}
                </span>
              </button>
              {reviewsOpen && (
                <div style={{ marginTop: 10 }}>
                  {clientReviews.map((r, i) => {
                    const rf = Math.max(0, Math.min(5, Math.round(r.stars || 0)));
                    const when = (() => {
                      if (!r.submittedAt) return "";
                      const d = new Date(r.submittedAt);
                      return isNaN(d.getTime())
                        ? ""
                        : d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
                    })();
                    return (
                      <div
                        key={i}
                        style={{
                          padding: 14,
                          borderRadius: 14,
                          background: C.paper,
                          border: `1px solid ${C.hairline}`,
                          marginBottom: 8,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ color: accent, fontSize: 13, letterSpacing: 1 }} aria-label={`${rf} out of 5 stars`}>
                            {"★".repeat(rf)}<span style={{ color: C.hairline }}>{"★".repeat(5 - rf)}</span>
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: C.espresso }}>
                            {r.displayName || "Client"}
                          </span>
                          {when && <span style={{ fontSize: 12, color: C.muted }}>· {when}</span>}
                        </div>
                        {r.notes && (
                          <p style={{ margin: "6px 0 0", fontSize: 14, lineHeight: 1.5, color: C.coffee }}>
                            {r.notes}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}

        {/* Phase 3 — Client Love. Renders only when the stylist has
            at least one review. Featured-first sort already happens
            server-side; we just present the list. */}
        {reviews.length > 0 && (
          <div style={{ marginTop: 28 }}>
            <p
              style={{
                textAlign: "center",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                color: accent,
                margin: 0,
              }}
            >
              Client Love
            </p>
            <div
              role="list"
              aria-label="Client testimonials"
              style={{
                marginTop: 12,
                display: "flex",
                gap: 12,
                overflowX: "auto",
                WebkitOverflowScrolling: "touch",
                paddingBottom: 4,
                scrollbarWidth: "none",
                scrollSnapType: "x mandatory",
              }}
            >
              {reviews.map(r => (
                <div
                  key={r.id}
                  role="listitem"
                  style={{
                    flex: "0 0 280px",
                    scrollSnapAlign: "start",
                    padding: 16,
                    borderRadius: 16,
                    background: C.paper,
                    border: `1px solid ${C.hairline}`,
                    boxShadow: "0 4px 12px rgba(21, 17, 26, 0.04)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  {r.stars ? (
                    <p aria-label={`${r.stars} out of 5 stars`} style={{ margin: 0, fontSize: 14, letterSpacing: 2, color: accent }}>
                      {"★".repeat(r.stars)}<span style={{ color: C.hairline }}>{"★".repeat(5 - r.stars)}</span>
                    </p>
                  ) : null}
                  <p style={{ margin: 0, fontFamily: FONT_DISPLAY, fontSize: 18, lineHeight: 1.4, color: C.espresso, fontStyle: "italic" }}>
                    “{r.review_text}”
                  </p>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: "auto" }}>
                    {r.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.image_url}
                        alt={r.reviewer_name}
                        loading="lazy"
                        style={{ width: 36, height: 36, borderRadius: 999, objectFit: "cover", flexShrink: 0 }}
                      />
                    ) : (
                      <div
                        aria-hidden
                        style={{
                          width: 36, height: 36, borderRadius: 999, flexShrink: 0,
                          background: C.ivory, color: C.coffee,
                          display: "grid", placeItems: "center",
                          fontWeight: 700, fontSize: 13,
                          border: `1px solid ${C.hairline}`,
                        }}
                      >
                        {(r.reviewer_name || "?").slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: C.espresso }}>
                        {r.reviewer_name}
                      </p>
                      <p style={{ margin: 0, fontSize: 11, color: C.muted, lineHeight: 1.3 }}>
                        {r.service_name || "Verified guest"}
                        {r.is_verified_booking ? " · Verified booking" : ""}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {linkLoading && (
          <p style={{ textAlign: "center", marginTop: 32, color: C.muted, fontSize: 13 }}>Loading…</p>
        )}

        {!linkLoading && linkError && (
          <div style={{ marginTop: 32, padding: 20, borderRadius: 16, background: C.paper, border: `1px solid ${C.hairline}`, textAlign: "center" }}>
            <p style={{ fontFamily: FONT_DISPLAY, fontSize: 20, color: C.espresso, fontWeight: 600 }}>
              We couldn&apos;t open this page
            </p>
            <p style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>{linkError}</p>
          </div>
        )}

        {!linkLoading && !linkError && submitted && (
          <div style={{ marginTop: 32, padding: 24, borderRadius: 16, background: "rgba(92, 124, 74, 0.08)", border: `1px solid rgba(92, 124, 74, 0.35)`, textAlign: "center" }}>
            <p style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 600, color: C.espresso }}>
              Request sent ✨
            </p>
            <p style={{ fontSize: 14, color: C.coffee, marginTop: 8, lineHeight: 1.5 }}>
              {link?.business_name || "Your stylist"} will reach out shortly to confirm your appointment.
            </p>
          </div>
        )}

        {/* Pay-in-full BNPL choice — only shown when the stylist opted in
            and the booking takes a deposit. The client picks how to pay;
            both paths redirect to Stripe Checkout. */}
        {!linkLoading && !linkError && !submitted && paymentChoice && (
          <div style={{ marginTop: 32, display: "grid", gap: 14 }}>
            <div style={{ textAlign: "center" }}>
              <p style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 600, color: C.espresso }}>
                {paymentChoice.depositAmount > 0 ? "Almost there — choose how to pay" : "Want to pay now?"}
              </p>
              <p style={{ fontSize: 14, color: C.coffee, marginTop: 8, lineHeight: 1.5 }}>
                {paymentChoice.depositAmount > 0
                  ? "Secure your appointment with a deposit, or pay in full now — including Buy Now, Pay Later options at checkout."
                  : "Your request is in. You can pay the full price now — including Buy Now, Pay Later options — or settle up with your stylist later."}
              </p>
            </div>

            {/* Deposit option only exists when a deposit is actually due. */}
            {paymentChoice.depositAmount > 0 && (
              <button
                type="button"
                disabled={choiceRedirecting}
                onClick={() => void startBookingCheckout("/api/booking-deposit/checkout", paymentChoice.requestId)}
                style={{
                  padding: "16px 18px", borderRadius: 14, cursor: choiceRedirecting ? "default" : "pointer",
                  background: C.paper, color: C.espresso, border: `1px solid ${accent}`,
                  textAlign: "left", opacity: choiceRedirecting ? 0.6 : 1,
                }}
              >
                <span style={{ display: "block", fontSize: 15, fontWeight: 700 }}>
                  Pay deposit · ${paymentChoice.depositAmount.toFixed(2)}
                </span>
                <span style={{ display: "block", fontSize: 12, color: C.muted, marginTop: 2 }}>
                  ${(paymentChoice.fullPrice - paymentChoice.depositAmount).toFixed(2)} balance due at your appointment
                </span>
              </button>
            )}

            <button
              type="button"
              disabled={choiceRedirecting}
              onClick={() => void startBookingCheckout("/api/booking-full/checkout", paymentChoice.requestId)}
              style={{
                padding: "16px 18px", borderRadius: 14, cursor: choiceRedirecting ? "default" : "pointer",
                background: accent, color: C.paper, border: `1px solid ${accent}`,
                textAlign: "left", opacity: choiceRedirecting ? 0.6 : 1,
              }}
            >
              <span style={{ display: "block", fontSize: 15, fontWeight: 700 }}>
                {paymentChoice.depositAmount > 0 ? "Pay in full" : "Pay in full now"} · ${paymentChoice.fullPrice.toFixed(2)}
              </span>
              <span style={{ display: "block", fontSize: 12, color: "rgba(255,255,255,0.85)", marginTop: 2 }}>
                Split it over time with Affirm, Klarna, or Afterpay at checkout
              </span>
            </button>

            {/* No-deposit bookings can stand as a plain request — keep the
                existing pay-later flow one tap away. */}
            {paymentChoice.depositAmount === 0 && (
              <button
                type="button"
                disabled={choiceRedirecting}
                onClick={() => { setPaymentChoice(null); setSubmitted(true); }}
                style={{
                  padding: "12px 16px", borderRadius: 12, cursor: choiceRedirecting ? "default" : "pointer",
                  background: "transparent", color: C.muted, border: 0,
                  fontSize: 13, fontWeight: 600,
                }}
              >
                Continue without paying
              </button>
            )}

            {choiceRedirecting && (
              <p style={{ fontSize: 12, color: C.muted, textAlign: "center" }}>Opening secure checkout…</p>
            )}
          </div>
        )}

        {!linkLoading && !linkError && !submitted && !paymentChoice && link && (
          <form ref={bookingFormRef} onSubmit={handleSubmit} style={{ marginTop: 28, display: "grid", gap: 14 }}>
            {/* Booking funnel order: service menu → date/time → your
                details → consultation → deposit. Contact details used to
                sit here at the top; they now render after the calendar
                (see the "3 · Your details" block below) so the client
                configures their style and picks a time before being
                asked who they are. */}
            {hasCatalog ? (
              <>
                {/* The "Choose a service" heading lives below (after the
                    Featured row + category dropdown) so this section
                    isn't titled twice. */}
                {/* Featured services — pinned row above the category
                    chips. Only renders when at least one service has
                    `featured = true`. Tapping a card jumps straight
                    to that service in the picker (sets serviceId so
                    the existing flow takes over). */}
                {(() => {
                  const featured = catalog.filter(s => (s as any).featured === true);
                  if (featured.length === 0) return null;
                  return (
                    <Field label="Featured">
                      <div
                        style={{
                          display: "flex",
                          gap: 14,
                          overflowX: "auto",
                          WebkitOverflowScrolling: "touch",
                          // Breathing room so the featured spotlight aura
                          // (inset -7px + blur) isn't clipped by the
                          // rail's scroll overflow.
                          padding: "10px 12px 14px",
                          margin: "0 -12px",
                          scrollbarWidth: "none",
                        }}
                      >
                        {featured.map(s => (
                          <div
                            key={`feat_${s.id}`}
                            className="bbp-featured"
                            // Drives the spotlight aura color (see the
                            // .bbp-featured rule) off the storefront
                            // accent so it tracks the theme.
                            style={{ flex: "0 0 240px", ["--bbp-accent" as string]: accent } as React.CSSProperties}
                          >
                          <button
                            type="button"
                            onClick={() => {
                              setServiceId(s.id);
                              setSelectedVariationId("");
                              setServiceName(s.name || "");
                              if (s.category_id) setActiveCategoryId(s.category_id);
                              // Land on the selected service detail, not page top.
                              if (typeof window !== "undefined") {
                                requestAnimationFrame(() => {
                                  serviceDetailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                                });
                              }
                            }}
                            style={{
                              width: "100%",
                              padding: 0,
                              borderRadius: 18,
                              background: C.paper,
                              // Featured cards always carry an accent-
                              // tinted border (heavier once selected) so
                              // they read as the hero pick on the rail.
                              border: `1.5px solid ${serviceId === s.id ? accent : `color-mix(in srgb, ${accent} 40%, ${C.hairline})`}`,
                              boxShadow: serviceId === s.id
                                ? `0 0 0 3px ${C.cream}`
                                : `0 6px 18px -6px color-mix(in srgb, ${accent} 35%, transparent)`,
                              textAlign: "left",
                              font: "inherit",
                              color: "inherit",
                              cursor: "pointer",
                              appearance: "none",
                              WebkitAppearance: "none",
                              transition: "border-color 120ms ease, box-shadow 120ms ease",
                              overflow: "hidden",
                            }}
                          >
                            {/* Image-first layout when the stylist set
                                a cover. Falls back to a luxury text-
                                only card so empty / placeholder rows
                                still look intentional. */}
                            {(s as any).cover_image_url && (
                              <div
                                style={{
                                  aspectRatio: "4 / 3",
                                  background: C.ivory,
                                  overflow: "hidden",
                                }}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={(s as any).cover_image_url}
                                  alt={`${s.name} cover`}
                                  loading="lazy"
                                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                                />
                              </div>
                            )}
                            <div style={{ padding: 14 }}>
                              <p
                                style={{
                                  fontSize: 9.5,
                                  fontWeight: 700,
                                  letterSpacing: "0.18em",
                                  textTransform: "uppercase",
                                  color: accent,
                                  margin: 0,
                                }}
                              >
                                Signature
                              </p>
                              <p
                                style={{
                                  fontFamily: FONT_DISPLAY,
                                  fontSize: 18,
                                  fontWeight: 600,
                                  color: C.espresso,
                                  margin: "4px 0 0",
                                  lineHeight: 1.15,
                                }}
                              >
                                {s.name}
                              </p>
                              <p style={{ marginTop: 6, fontSize: 11, color: C.muted, lineHeight: 1.4 }}>
                                {s.duration_hours}h · ${Number(s.base_price).toFixed(0)}
                                {s.deposit_required && s.deposit_amount
                                  ? ` · $${Number(s.deposit_amount).toFixed(0)} deposit`
                                  : ""}
                              </p>
                            </div>
                          </button>
                          </div>
                        ))}
                      </div>
                    </Field>
                  );
                })()}

                {/* Category browse — a dropdown so a long category list
                    stays compact instead of a tall wall of pills. "All"
                    is the default; "Other" only appears when there are
                    uncategorized services. */}
                {hasCategories && (
                  <Field label="Browse by category">
                    <select
                      aria-label="Browse by category"
                      value={activeCategoryId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setActiveCategoryId(id);
                        // Clear the service pick if it falls outside the
                        // new filter — keeps the selection coherent.
                        const stillVisible = catalog.some(s => {
                          if (s.id !== serviceId) return false;
                          if (id === "") return true;
                          if (id === "__other__") return !s.category_id;
                          return s.category_id === id;
                        });
                        if (!stillVisible) {
                          setServiceId("");
                          setSelectedVariationId("");
                          setServiceName("");
                        }
                      }}
                      // inputStyle (not selectStyle) keeps the native
                      // dropdown chevron so it reads as a picker, matching
                      // the hair-color / consultation selects below.
                      style={{ ...inputStyle, padding: 12 }}
                    >
                      <option value="">All services</option>
                      {serviceCategories.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                      {hasUncategorized && <option value="__other__">Other</option>}
                    </select>
                  </Field>
                )}
                {/* Description card for the active category, when the
                    stylist wrote one. Sits between the chip row and
                    the service select so context flows top-down. */}
                {hasCategories && activeCategoryId && activeCategoryId !== "__other__" && (() => {
                  const c = serviceCategories.find(x => x.id === activeCategoryId);
                  if (!c?.description) return null;
                  return (
                    <p style={{ fontSize: 12, color: C.muted, marginTop: -4, lineHeight: 1.4 }}>
                      {c.description}
                    </p>
                  );
                })()}
                {/* Build your style — AI consultation for clients who
                    don't see the style they want. Sits between the
                    category browse and the service menu so a client who
                    scanned the categories and still didn't find their
                    look can build it before scrolling the full list. */}
                {link?.user_id && (
                  <BuildYourStyle slug={slug} userId={link.user_id} accent={accent} />
                )}
                {/* Acuity-style service menu. The dropdown was hidden
                    behind a tap; cards put every option in front of
                    the client with the cover photo, name, duration,
                    price, and deposit on the surface. Selecting a
                    card sets serviceId, which gates the rest of the
                    form below — name/contact, calendar, notes — so
                    the landing reads as a menu first, booking flow
                    second. The "back" affordance to return to the
                    menu sits above the selected-service card. */}
                {!serviceId && (
                  <Field label={filteredCatalog.length === 1 ? "Service" : "Choose a service"} labelColor={accent}>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr",
                        gap: 12,
                      }}
                    >
                      {filteredCatalog.map(s => {
                        const deposit = s.deposit_required && s.deposit_amount
                          ? `$${Number(s.deposit_amount).toFixed(0)} deposit`
                          : null;
                        return (
                          <button
                            key={`svc_card_${s.id}`}
                            type="button"
                            onClick={() => {
                              setServiceId(s.id);
                              setSelectedVariationId("");
                              setServiceName(s.name || "");
                              if (link?.user_id) {
                                void emitAnalyticsEvent({
                                  ownerUserId: link.user_id,
                                  type: "public_service_viewed" as any,
                                  source: "public",
                                  payload: { slug, serviceId: s.id, serviceName: s.name },
                                });
                              }
                              // Land the client on the selected service's
                              // detail + options, not the page top. Picking
                              // collapses the tall menu, so without this the
                              // viewport jumps up past the hero.
                              if (typeof window !== "undefined") {
                                requestAnimationFrame(() => {
                                  serviceDetailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                                });
                              }
                            }}
                            style={{
                              padding: 0,
                              border: `1px solid ${C.hairline}`,
                              borderRadius: 18,
                              background: C.paper,
                              textAlign: "left",
                              font: "inherit",
                              color: "inherit",
                              cursor: "pointer",
                              appearance: "none",
                              WebkitAppearance: "none",
                              overflow: "hidden",
                              boxShadow: "0 4px 14px rgba(21, 17, 26, 0.06)",
                              transition: "transform 120ms ease, box-shadow 120ms ease",
                            }}
                          >
                            {/* No cover image on the landing menu —
                                the photo is reserved for the detail
                                page so the menu reads cleanly as a
                                text list of services (Acuity flow). */}
                            <div style={{ padding: 16 }}>
                              <p
                                style={{
                                  fontFamily: FONT_DISPLAY,
                                  fontSize: 19,
                                  fontWeight: 600,
                                  color: C.espresso,
                                  margin: 0,
                                  lineHeight: 1.2,
                                }}
                              >
                                {s.name}
                              </p>
                              <p style={{ marginTop: 6, fontSize: 12, color: C.muted }}>
                                {s.duration_hours}h @ ${Number(s.base_price).toFixed(2)}
                                {deposit ? ` · ${deposit}` : ""}
                              </p>
                              {s.description && (
                                <p
                                  style={{
                                    marginTop: 10,
                                    fontSize: 12.5,
                                    color: C.coffee,
                                    lineHeight: 1.5,
                                    display: "-webkit-box",
                                    WebkitLineClamp: 3,
                                    WebkitBoxOrient: "vertical",
                                    overflow: "hidden",
                                  }}
                                >
                                  {s.description}
                                </p>
                              )}
                              <span
                                style={{
                                  display: "inline-block",
                                  marginTop: 14,
                                  padding: "8px 16px",
                                  borderRadius: 999,
                                  background: C.espresso,
                                  color: "#FFF",
                                  fontSize: 11,
                                  fontWeight: 700,
                                  letterSpacing: "0.14em",
                                  textTransform: "uppercase",
                                }}
                              >
                                Select
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </Field>
                )}
                {/* Scroll anchor — selection scrolls here so the client
                    lands on the selected service detail, not page top. */}
                {serviceId && <div ref={serviceDetailRef} aria-hidden style={{ scrollMarginTop: 12 }} />}
                {/* Back-to-menu affordance once a service is picked.
                    Resets serviceId + variation + customization so the
                    client can re-enter the flow cleanly. */}
                {serviceId && (
                  <button
                    type="button"
                    onClick={() => {
                      setServiceId("");
                      setSelectedVariationId("");
                      setServiceName("");
                      setSelectedExtraIds([]);
                      if (typeof window !== "undefined") {
                        requestAnimationFrame(() => {
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        });
                      }
                    }}
                    style={{
                      alignSelf: "flex-start",
                      padding: "8px 14px",
                      borderRadius: 999,
                      background: "transparent",
                      border: `1px solid ${C.hairline}`,
                      color: C.coffee,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                      appearance: "none",
                      WebkitAppearance: "none",
                      letterSpacing: "0.06em",
                    }}
                  >
                    ← View all services
                  </button>
                )}
                {/* When the service has no variations, render a plain
                    summary card. When variations exist we hand off to
                    the unified picker below (base + every saved
                    variation as selectable options). */}
                {selectedCatalogService && !hasVariations && (
                  <div
                    style={{
                      borderRadius: 12,
                      background: C.paper,
                      border: `1px solid ${C.hairline}`,
                      fontSize: 12,
                      color: C.coffee,
                      lineHeight: 1.5,
                      overflow: "hidden",
                    }}
                  >
                    {(selectedCatalogService as any).cover_image_url && (
                      <button
                        type="button"
                        onClick={() => setCoverZoom((selectedCatalogService as any).cover_image_url)}
                        aria-label="View full photo"
                        style={{
                          display: "block", width: "100%", padding: 0, border: 0,
                          appearance: "none", WebkitAppearance: "none",
                          background: C.ivory,
                          cursor: "zoom-in",
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={(selectedCatalogService as any).cover_image_url}
                          alt={`${selectedCatalogService.name} cover`}
                          loading="lazy"
                          style={{ width: "100%", height: "auto", display: "block" }}
                        />
                      </button>
                    )}
                    <div style={{ padding: 12 }}>
                    <strong style={{ color: C.espresso }}>{selectedCatalogService.name}</strong>
                    <br />
                    {(resolved?.durationHours ?? selectedCatalogService.duration_hours)}h
                    {" · $"}{(resolved?.price ?? selectedCatalogService.base_price).toFixed(2)}
                    {resolved && resolved.depositRequired && resolved.depositAmount > 0
                      ? ` · $${resolved.depositAmount.toFixed(2)} deposit due today`
                      : selectedCatalogService.deposit_required && selectedCatalogService.deposit_amount
                        ? ` · $${Number(selectedCatalogService.deposit_amount).toFixed(2)} deposit required`
                        : ""}
                    {/* Description sits directly under the title, where
                        the stylist's wording naturally belongs. Keeps
                        prep instructions visually separate. */}
                    {selectedCatalogService.description && (
                      <p style={{ marginTop: 8, color: C.coffee, fontSize: 12 }}>
                        {selectedCatalogService.description}
                      </p>
                    )}
                    {selectedCatalogService.prep_instructions && (
                      <p style={{ marginTop: 8, color: C.muted, fontSize: 11 }}>
                        {selectedCatalogService.prep_instructions}
                      </p>
                    )}
                    {resolved && resolved.depositRequired && resolved.depositAmount > 0 && resolved.balanceDue > 0 && (
                      <p style={{ marginTop: 6, color: C.muted, fontSize: 11 }}>
                        Remaining balance after deposit: ${resolved.balanceDue.toFixed(2)}
                      </p>
                    )}
                    </div>
                  </div>
                )}
                {/* Parent-service header card. Sits above the variation
                    picker so the description belongs to the SERVICE,
                    not to any one option. Title → base price/duration →
                    description → prep instructions, in that order. */}
                {selectedCatalogService && hasVariations && (
                  <div
                    style={{
                      borderRadius: 12,
                      background: C.paper,
                      border: `1px solid ${C.hairline}`,
                      fontSize: 12,
                      color: C.coffee,
                      lineHeight: 1.5,
                      overflow: "hidden",
                    }}
                  >
                    {/* Cover image shows the full photo (no crop) so
                        clients see exactly what they're booking. */}
                    {(selectedCatalogService as any).cover_image_url && (
                      <button
                        type="button"
                        onClick={() => setCoverZoom((selectedCatalogService as any).cover_image_url)}
                        aria-label="View full photo"
                        style={{
                          display: "block", width: "100%", padding: 0, border: 0,
                          appearance: "none", WebkitAppearance: "none",
                          background: C.ivory,
                          cursor: "zoom-in",
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={(selectedCatalogService as any).cover_image_url}
                          alt={`${selectedCatalogService.name} cover`}
                          loading="lazy"
                          style={{ width: "100%", height: "auto", display: "block" }}
                        />
                      </button>
                    )}
                    <div style={{ padding: 12 }}>
                    <strong style={{ color: C.espresso, fontSize: 14 }}>
                      {selectedCatalogService.name}
                    </strong>
                    <p style={{ margin: "2px 0 0", fontSize: 11, color: C.muted }}>
                      {selectedCatalogService.duration_hours}h
                      {" · $"}{Number(selectedCatalogService.base_price).toFixed(2)}
                      {selectedCatalogService.deposit_required && selectedCatalogService.deposit_amount
                        ? ` · $${Number(selectedCatalogService.deposit_amount).toFixed(2)} deposit`
                        : ""}
                    </p>
                    {selectedCatalogService.description && (
                      <p style={{ marginTop: 8, color: C.coffee, fontSize: 12 }}>
                        {selectedCatalogService.description}
                      </p>
                    )}
                    {selectedCatalogService.prep_instructions && (
                      <p style={{ marginTop: 8, color: C.muted, fontSize: 11 }}>
                        {selectedCatalogService.prep_instructions}
                      </p>
                    )}
                    </div>
                  </div>
                )}
                {/* Unified picker: the base service is the first
                    selectable option (variation_id = "" means book
                    the parent service unchanged), followed by every
                    saved variation in order. Each card shows the
                    fully-resolved price / duration / deposit so the
                    client can compare every option side-by-side.
                    Inherited values flow through resolveVariationPricing,
                    so a variation with no price/duration/deposit
                    override displays the parent's values. */}
                {hasVariations && selectedCatalogService && (() => {
                  // Build options: base first, then every variation.
                  // We pass `null` to the resolver for the base so it
                  // returns the parent service's price/duration/deposit
                  // straight — identical to picking no variation.
                  const baseResolved = resolveVariationPricing(selectedCatalogService, null);
                  const options: Array<{
                    id: string;       // "" for base, addon id for variations
                    label: string;
                    subLabel: string | null;
                    description: string | null;
                    resolved: ReturnType<typeof resolveVariationPricing>;
                  }> = [
                    {
                      id: "",
                      label: selectedCatalogService.name,
                      subLabel: "Standard",
                      description: null,
                      resolved: baseResolved,
                    },
                    ...variations.map(v => ({
                      id: v.id,
                      label: (v.name || "").trim() || "Variation",
                      subLabel: null,
                      description: ((v as any).variation_description || "").trim() || null,
                      resolved: resolveVariationPricing(selectedCatalogService, v.id),
                    })),
                  ];
                  return (
                    <Field label="Choose an option" labelColor={accent}>
                      <p style={{ margin: "0 0 8px", fontSize: 11, color: C.muted, lineHeight: 1.4 }}>
                        Tap any option to switch — your price, deposit, and balance update right away.
                      </p>
                      {/* radiogroup semantics so screen readers know
                          these cards are mutually-exclusive choices,
                          and the client can swap freely between them. */}
                      <div role="radiogroup" aria-label="Service options" style={{ display: "grid", gap: 8 }}>
                        {options.map(opt => {
                          // `picked` is purely derived from
                          // selectedVariationId; tapping any card
                          // — including the base — re-sets it. No
                          // disabled state, no irreversible writes,
                          // so the client can switch as many times
                          // as they want before submitting.
                          const picked = selectedVariationId === opt.id;
                          const r = opt.resolved;
                          return (
                            <button
                              key={opt.id || "__base__"}
                              type="button"
                              onClick={() => setSelectedVariationId(opt.id)}
                              role="radio"
                              aria-checked={picked}
                              aria-pressed={picked}
                              style={{
                                position: "relative",
                                textAlign: "left",
                                padding: 12,
                                borderRadius: 12,
                                background: picked ? C.cream : C.paper,
                                border: `1.5px solid ${picked ? C.goldDeep : C.hairline}`,
                                boxShadow: picked ? `0 0 0 3px ${C.cream}` : "none",
                                cursor: "pointer",
                                font: "inherit",
                                color: "inherit",
                                appearance: "none",
                                WebkitAppearance: "none",
                                transition: "background 120ms ease, border-color 120ms ease, box-shadow 120ms ease",
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                                <span style={{ fontWeight: 600, color: C.espresso, fontSize: 13 }}>
                                  {opt.label}
                                  {opt.subLabel && (
                                    <span style={{ fontWeight: 500, color: C.muted, fontSize: 11, marginLeft: 6 }}>
                                      · {opt.subLabel}
                                    </span>
                                  )}
                                </span>
                                <span style={{ fontWeight: 700, color: C.goldDeep, fontSize: 14, whiteSpace: "nowrap" }}>
                                  ${r.price.toFixed(2)}
                                </span>
                              </div>
                              <p style={{ marginTop: 4, fontSize: 11, color: C.muted, lineHeight: 1.4 }}>
                                {r.durationHours}h
                                {r.depositRequired && r.depositAmount > 0
                                  ? ` · $${r.depositAmount.toFixed(2)} deposit due today`
                                  : " · No deposit"}
                                {r.depositRequired && r.depositAmount > 0 && r.balanceDue > 0
                                  ? ` · Balance $${r.balanceDue.toFixed(2)}`
                                  : ""}
                              </p>
                              {opt.description && (
                                <p style={{ marginTop: 6, fontSize: 11.5, color: C.coffee, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>
                                  {opt.description}
                                </p>
                              )}
                              {picked && (
                                <span
                                  aria-hidden
                                  style={{
                                    position: "absolute",
                                    top: 10,
                                    right: 10,
                                    background: C.goldDeep,
                                    color: C.cream,
                                    fontSize: 9.5,
                                    fontWeight: 700,
                                    letterSpacing: "0.08em",
                                    padding: "2px 6px",
                                    borderRadius: 999,
                                    textTransform: "uppercase",
                                  }}
                                >
                                  Selected
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                      {/* Description + prep instructions live on the
                          parent-service header card above the picker
                          (they belong to the SERVICE, not to any one
                          variation). Don't duplicate them here. */}
                    </Field>
                  );
                })()}

                {/* Optional ADD-ONS picker. Multi-select; each pick
                    stacks price + duration on the base/variation.
                    Deposit only bumps if the add-on has
                    include_in_deposit = true. */}
                {selectedCatalogService && genericExtras.length > 0 && (
                  <Field label="Optional add-ons" labelColor={accent}>
                    <p style={{ margin: "0 0 8px", fontSize: 11, color: C.muted, lineHeight: 1.4 }}>
                      Pick any extras you want — your total updates as you tap.
                    </p>
                    <div style={{ display: "grid", gap: 8 }}>
                      {genericExtras.map(e => {
                        const picked = selectedExtraIds.includes(e.id);
                        const extraTime = Number(e.duration_hours_delta) || 0;
                        return (
                          <button
                            key={e.id}
                            type="button"
                            aria-pressed={picked}
                            onClick={() => setSelectedExtraIds(prev =>
                              prev.includes(e.id) ? prev.filter(x => x !== e.id) : [...prev, e.id],
                            )}
                            style={{
                              position: "relative",
                              textAlign: "left",
                              padding: 12,
                              borderRadius: 12,
                              background: picked ? C.cream : C.paper,
                              border: `1.5px solid ${picked ? C.goldDeep : C.hairline}`,
                              boxShadow: picked ? `0 0 0 3px ${C.cream}` : "none",
                              cursor: "pointer",
                              font: "inherit",
                              color: "inherit",
                              appearance: "none",
                              WebkitAppearance: "none",
                              transition: "background 120ms ease, border-color 120ms ease, box-shadow 120ms ease",
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                              <span style={{ fontWeight: 600, color: C.espresso, fontSize: 13 }}>
                                {e.name || "Add-on"}
                              </span>
                              <span style={{ fontWeight: 700, color: C.goldDeep, fontSize: 14, whiteSpace: "nowrap" }}>
                                {(Number(e.price) || 0) > 0 ? `+$${(Number(e.price) || 0).toFixed(2)}` : "Free"}
                              </span>
                            </div>
                            {(e.description || extraTime > 0 || e.include_in_deposit) && (
                              <p style={{ marginTop: 4, fontSize: 11, color: C.muted, lineHeight: 1.4 }}>
                                {e.description || ""}
                                {extraTime > 0
                                  ? `${e.description ? " · " : ""}+${extraTime}h`
                                  : ""}
                                {e.include_in_deposit
                                  ? `${e.description || extraTime > 0 ? " · " : ""}Added to deposit`
                                  : ""}
                              </p>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    {/* Live totals — recompute on every pick. */}
                    {resolved && pickedExtras.length > 0 && (
                      <div
                        style={{
                          marginTop: 10,
                          padding: 10,
                          borderRadius: 10,
                          background: C.paper,
                          border: `1px solid ${C.hairline}`,
                          fontSize: 12,
                          color: C.coffee,
                          lineHeight: 1.5,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span>Total</span>
                          <strong style={{ color: C.espresso }}>${resolved.price.toFixed(2)}</strong>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span>Duration</span>
                          <span>{resolved.durationHours}h</span>
                        </div>
                        {resolved.depositRequired && resolved.depositAmount > 0 && (
                          <>
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                              <span>Deposit due today</span>
                              <span style={{ color: C.goldDeep, fontWeight: 600 }}>
                                ${resolved.depositAmount.toFixed(2)}
                              </span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                              <span>Remaining balance</span>
                              <span>${resolved.balanceDue.toFixed(2)}</span>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </Field>
                )}
              </>
            ) : services.length > 0 ? (
              <Field label="Service">
                <select value={serviceName} onChange={e => setServiceName(e.target.value)}
                  style={selectStyle}>
                  <option value="">— Pick a service —</option>
                  {services.map((s: any, i: number) => (
                    <option key={s?.id || i} value={s?.name || ""}>{s?.name || "Service"}</option>
                  ))}
                </select>
              </Field>
            ) : (
              <>
                {/* Legacy free-form mode (no catalog) keeps the
                    build-your-style CTA it had before the reorder. */}
                {link?.user_id && (
                  <BuildYourStyle slug={slug} userId={link.user_id} accent={accent} />
                )}
                <Field label="Service / style you want">
                  <Input value={serviceName} onChange={e => setServiceName(e.target.value)} placeholder="e.g. Knotless mid-back" />
                </Field>
              </>
            )}
            {(() => {
              const svc: any = hasCatalog ? selectedCatalogService : null;
              if (!svc || (svc.customization_enabled ?? true) === false) return null;
              const showColor = !!svc.hair_included && !!svc.allow_client_hair_color_selection;
              const showCurl = !!svc.allow_client_curl_pattern_selection && humanHairIncluded;
              if (!svc.hair_included && !showColor && !showCurl && !acvExtra) return null;
              const colors: string[] = Array.isArray(svc.allowed_hair_colors) ? svc.allowed_hair_colors : [];
              const curls: string[] = Array.isArray(svc.allowed_curl_patterns) ? svc.allowed_curl_patterns : [];
              const isOther = (v: string) => v.trim().toLowerCase().replace(/\s/g, "") === "custom/other";
              return (
                <div style={{
                  border: `1px solid ${C.hairline}`, borderRadius: 16, padding: 16,
                  background: C.paper, display: "grid", gap: 14,
                }}>
                  <div>
                    <p style={{ margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: C.goldDeep }}>
                      Customize your style
                    </p>
                    {svc.hair_included ? (
                      <div style={{
                        display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8,
                        padding: "6px 12px", borderRadius: 999,
                        background: `linear-gradient(180deg, ${C.gold}, ${C.goldDeep})`, color: C.paper,
                        fontSize: 12, fontWeight: 700,
                      }}>
                        ✓ Hair included with this service
                      </div>
                    ) : (
                      <p style={{ margin: "6px 0 0", fontSize: 12, color: C.coffee }}>
                        Hair not included unless stated by the stylist.
                      </p>
                    )}
                    {svc.hair_included && svc.included_hair_description && (
                      <p style={{ margin: "6px 0 0", fontSize: 12, color: C.coffee, lineHeight: 1.5 }}>
                        {svc.included_hair_description}
                      </p>
                    )}
                  </div>

                  {svc.included_details && (
                    <div style={{ background: C.cream, borderRadius: 12, padding: 12 }}>
                      <span style={{ display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.coffee, marginBottom: 4 }}>
                        What&apos;s included
                      </span>
                      <p style={{ margin: 0, fontSize: 13, color: C.coffee, lineHeight: 1.5 }}>{svc.included_details}</p>
                    </div>
                  )}

                  {showColor && (
                    <div>
                      <Field label="Basic braiding hair color">
                        <select value={hairColor} onChange={e => setHairColor(e.target.value)}
                          style={{ ...inputStyle, padding: 12 }}>
                          <option value="">Select your braiding hair color</option>
                          {colors.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </Field>
                      <p style={{ margin: "6px 0 0", fontSize: 11, color: C.muted, lineHeight: 1.5 }}>
                        Braiding hair is included with this service. Please select the color for your style.
                      </p>
                      {isOther(hairColor) && (
                        <div style={{ marginTop: 10 }}>
                          <Field label="Custom color request">
                            <textarea value={customHairColor} onChange={e => setCustomHairColor(e.target.value)}
                              rows={2} placeholder="Tell your stylist the color you're looking for."
                              style={{ ...inputStyle, padding: 12, resize: "none", lineHeight: 1.5 }} />
                          </Field>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Customized braiding hair color — managed extra. Sits
                      between the basic-color picker and the ACV checkbox.
                      Stylist toggles + prices it in the editor; on the
                      booking page it's a paid checkbox that reveals a
                      description box and an inspiration photo upload. */}
                  {customColorExtra && (
                    <div>
                      <label
                        style={{
                          display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer",
                          border: `1.5px solid ${customColorSelected ? C.goldDeep : C.hairline}`,
                          borderRadius: 12, padding: 12,
                          background: customColorSelected ? C.cream : C.paper,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={customColorSelected}
                          onChange={toggleCustomColor}
                          style={{ marginTop: 2, width: 18, height: 18, accentColor: C.goldDeep, flex: "0 0 auto" }}
                        />
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                            <span style={{ fontWeight: 600, color: C.espresso, fontSize: 13 }}>
                              {customColorExtra.name || CUSTOM_COLOR_EXTRA_NAME}
                            </span>
                            <span style={{ fontWeight: 700, color: C.goldDeep, fontSize: 14, whiteSpace: "nowrap" }}>
                              {(Number(customColorExtra.price) || 0) > 0
                                ? `+$${(Number(customColorExtra.price) || 0).toFixed(2)}`
                                : "Free"}
                            </span>
                          </span>
                          <span style={{ display: "block", marginTop: 4, fontSize: 11, color: C.muted, lineHeight: 1.4 }}>
                            Describe your color combo (e.g. 1B/30/27) and leave an inspiration photo.
                          </span>
                        </span>
                      </label>
                      {customColorSelected && (
                        <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                          <Field label="Describe your color">
                            <textarea
                              value={customColorDescription}
                              onChange={e => setCustomColorDescription(e.target.value)}
                              rows={2}
                              placeholder="Example: 1B/30/27 mixed evenly throughout"
                              style={{ ...inputStyle, padding: 12, resize: "none", lineHeight: 1.5 }}
                            />
                          </Field>
                          <div>
                            <span style={{
                              display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase",
                              letterSpacing: "0.08em", color: C.coffee, marginBottom: 6,
                            }}>
                              Inspiration photo
                            </span>
                            {customColorPhotoUrl ? (
                              <div style={{
                                display: "flex", gap: 10, alignItems: "center",
                                border: `1px solid ${C.hairline}`, borderRadius: 12, padding: 10,
                                background: C.paper,
                              }}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={customColorPhotoUrl}
                                  alt="Inspiration"
                                  style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8 }}
                                />
                                <span style={{ flex: 1, fontSize: 12, color: C.muted }}>
                                  Photo attached.
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setCustomColorPhotoUrl(null)}
                                  style={{
                                    fontSize: 12, fontWeight: 600, color: C.goldDeep,
                                    background: "transparent", border: "none", cursor: "pointer", padding: 6,
                                  }}
                                >
                                  Remove
                                </button>
                              </div>
                            ) : (
                              <label style={{
                                display: "block", border: `1.5px dashed ${C.hairline}`, borderRadius: 12,
                                padding: 14, textAlign: "center", background: C.paper, cursor: "pointer",
                                fontSize: 12, color: C.muted,
                              }}>
                                <input
                                  type="file"
                                  accept="image/jpeg,image/png,image/webp,image/gif"
                                  onChange={e => {
                                    const f = e.target.files?.[0];
                                    if (f) uploadCustomColorPhoto(f);
                                    e.currentTarget.value = "";
                                  }}
                                  style={{ display: "none" }}
                                  disabled={customColorPhotoUploading}
                                />
                                {customColorPhotoUploading ? "Uploading…" : "Tap to upload an inspiration photo"}
                              </label>
                            )}
                            {customColorPhotoError && (
                              <p style={{ margin: "6px 0 0", fontSize: 11, color: C.danger }}>
                                {customColorPhotoError}
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ACV treatment — checkbox right after the color
                      picker: client picks their color, then opts in to
                      having that braiding hair treated with an apple
                      cider vinegar rinse. Free shows no price. */}
                  {acvExtra && (
                    <label
                      style={{
                        display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer",
                        border: `1.5px solid ${acvSelected ? C.goldDeep : C.hairline}`,
                        borderRadius: 12, padding: 12,
                        background: acvSelected ? C.cream : C.paper,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={acvSelected}
                        onChange={toggleAcv}
                        style={{ marginTop: 2, width: 18, height: 18, accentColor: C.goldDeep, flex: "0 0 auto" }}
                      />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                          <span style={{ fontWeight: 600, color: C.espresso, fontSize: 13 }}>
                            {acvExtra.name || "Apple cider vinegar (ACV) treatment"}
                          </span>
                          <span style={{ fontWeight: 700, color: C.goldDeep, fontSize: 14, whiteSpace: "nowrap" }}>
                            {(Number(acvExtra.price) || 0) > 0 ? `+$${(Number(acvExtra.price) || 0).toFixed(2)}` : "Free"}
                          </span>
                        </span>
                        <span style={{ display: "block", marginTop: 4, fontSize: 11, color: C.muted, lineHeight: 1.4 }}>
                          Have your braiding hair treated with an apple cider vinegar rinse to cleanse &amp; soften it.
                        </span>
                      </span>
                    </label>
                  )}

                  {showCurl && (
                    <div>
                      <Field label="Curl pattern">
                        <select value={curlPattern} onChange={e => setCurlPattern(e.target.value)}
                          style={{ ...inputStyle, padding: 12 }}>
                          <option value="">Select your curl pattern</option>
                          {curls.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </Field>
                      <p style={{ margin: "6px 0 0", fontSize: 11, color: C.muted, lineHeight: 1.5 }}>
                        Human curly hair is included with your selected option. Please choose your curl pattern.
                      </p>
                      {isOther(curlPattern) && (
                        <div style={{ marginTop: 10 }}>
                          <Field label="Custom curl pattern request">
                            <textarea value={customCurlPattern} onChange={e => setCustomCurlPattern(e.target.value)}
                              rows={2} placeholder="Tell your stylist the curl pattern or look you're going for."
                              style={{ ...inputStyle, padding: 12, resize: "none", lineHeight: 1.5 }} />
                          </Field>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
            {/* Calendar + details + submit only after a service is picked
                (or in legacy free-form mode), so the landing reads
                cleanly as a menu. */}
            {(serviceId || !hasCatalog) && <>
            {hasCatalog && <p style={{ ...stepHeaderStyle, color: accent }}>Pick a time</p>}
            <BookingCalendar
              monthCursor={monthCursor}
              setMonthCursor={setMonthCursor}
              monthDays={monthDays}
              monthLoading={monthLoading}
              monthError={monthError}
              monthHasAnyAvailability={monthHasAnyAvailability}
              hasCatalog={hasCatalog}
              hasService={!!selectedCatalogService}
              selectedDate={preferredDate}
              onSelectDate={(iso) => { setPreferredDate(iso); setPreferredTime(""); }}
              onJoinWaitlist={() => setWaitlistOpen(true)}
            />
            {preferredDate && (
              <div>
                <span
                  style={{
                    display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase",
                    letterSpacing: "0.08em", color: C.coffee, marginBottom: 8,
                  }}
                >
                  Available times · {formatPrettyDate(preferredDate)}
                </span>
                {slotsLoading && <SlotSkeleton />}
                {!slotsLoading && slotsError && (
                  <p style={{ fontSize: 12, color: C.danger }}>{slotsError}</p>
                )}
                {showDateEmptyState && (
                  <div
                    style={{
                      padding: 16,
                      borderRadius: 14,
                      background: C.paper,
                      border: `1px solid ${C.hairline}`,
                      textAlign: "center",
                    }}
                  >
                    <p style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600, color: C.espresso }}>
                      No openings on this date
                    </p>
                    <p style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>
                      Choose another date to see available times.
                    </p>
                    <div style={{ marginTop: 12 }}>
                      <button
                        type="button"
                        onClick={() => { setPreferredDate(""); setPreferredTime(""); }}
                        style={ghostButtonStyle}
                      >
                        Choose another date
                      </button>
                    </div>
                  </div>
                )}
                {!slotsLoading && !slotsError && slots.length > 0 && (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))",
                      gap: 8,
                    }}
                  >
                    {slots.map(s => {
                      const on = preferredTime === s.time;
                      return (
                        <button
                          type="button"
                          key={s.time}
                          onClick={() => setPreferredTime(s.time)}
                          style={{
                            padding: "12px 8px",
                            borderRadius: 12,
                            background: on
                              ? `linear-gradient(180deg, ${C.gold}, ${C.goldDeep})`
                              : C.paper,
                            color: on ? C.paper : C.coffee,
                            border: `1px solid ${on ? C.goldDeep : C.hairline}`,
                            fontSize: 13,
                            fontWeight: 600,
                            cursor: "pointer",
                            minHeight: 44,
                            transition: "background 120ms ease, transform 120ms ease",
                            transform: on ? "scale(1.02)" : "scale(1)",
                          }}
                        >
                          {s.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {/* 3 · Your details — relocated from the top of the form so
                contact info is collected only after the client has
                configured their style and picked a time. */}
            {hasCatalog && <p style={{ ...stepHeaderStyle, color: accent }}>Your details</p>}
            <Field label="Your name">
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Full name" autoComplete="name" required />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Phone">
                <Input type="tel" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="555-0123" autoComplete="tel" />
              </Field>
              <Field label="Email">
                <Input type="email" inputMode="email" autoCapitalize="none" spellCheck={false} value={email} onChange={e => setEmail(e.target.value)} placeholder="name@email.com" autoComplete="email" />
              </Field>
            </div>
            {/* Who's this appointment for — defaults to the booker.
                Picking "Someone else" reveals the recipient's name so
                a parent can book for their child. The booker stays the
                contact + payer. */}
            <Field label="Who's this appointment for?">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[
                  { v: true, label: "Myself" },
                  { v: false, label: "Someone else" },
                ].map((opt) => {
                  const active = bookedForSelf === opt.v;
                  return (
                    <button
                      key={String(opt.v)}
                      type="button"
                      onClick={() => {
                        setBookedForSelf(opt.v);
                        if (opt.v) { setRecipientName(""); setRecipientNote(""); }
                      }}
                      style={{
                        padding: "12px 14px",
                        borderRadius: 12,
                        fontSize: 14,
                        fontWeight: 600,
                        cursor: "pointer",
                        background: active ? C.espresso : C.paper,
                        color: active ? C.paper : C.espresso,
                        border: `1px solid ${active ? C.espresso : C.hairline}`,
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </Field>
            {!bookedForSelf && (
              <>
                <Field label="Who it's for">
                  <Input
                    value={recipientName}
                    onChange={e => setRecipientName(e.target.value)}
                    placeholder="e.g. Maya (daughter)"
                    autoComplete="off"
                  />
                </Field>
                <Field label="Anything to note? (optional)">
                  <Input
                    value={recipientNote}
                    onChange={e => setRecipientNote(e.target.value)}
                    placeholder="e.g. 7 years old, fine hair"
                    autoComplete="off"
                  />
                </Field>
              </>
            )}
            {SMS_ENABLED && phone.trim() && (
              <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={smsOptIn}
                  onChange={e => setSmsOptIn(e.target.checked)}
                  style={{ marginTop: 2, width: 18, height: 18, accentColor: C.espresso, flexShrink: 0 }}
                />
                <span style={{ fontSize: 12, color: C.coffee, lineHeight: 1.5 }}>
                  I agree to receive transactional SMS from Braid Boss Pro on behalf of my stylist about my appointment (confirmations, reminders, balance reminders, rebooking). Message frequency varies. Message and data rates may apply. Reply <strong>STOP</strong> to opt out, <strong>HELP</strong> for help. See our{" "}
                  <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: C.espresso, textDecoration: "underline" }}>Privacy Policy</a>{" "}
                  and{" "}
                  <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: C.espresso, textDecoration: "underline" }}>Terms</a>.
                </span>
              </label>
            )}
            {!hasCatalog && services.length === 0 && (
              <details
                style={{
                  padding: 12,
                  borderRadius: 12,
                  background: C.paper,
                  border: `1px solid ${C.hairline}`,
                  fontSize: 12,
                  color: C.muted,
                }}
              >
                <summary style={{ cursor: "pointer", fontWeight: 600, color: C.coffee }}>
                  Don&apos;t see a service that fits? Tell us what you want
                </summary>
                <div style={{ marginTop: 10 }}>
                  <Input
                    value={serviceName}
                    onChange={e => setServiceName(e.target.value)}
                    placeholder="e.g. Knotless mid-back"
                  />
                  <p style={{ marginTop: 6, fontSize: 11 }}>
                    The stylist will reach out to confirm details.
                  </p>
                </div>
              </details>
            )}
            <Field label="Notes">
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                placeholder="Hair length, anything you want me to know…"
                style={{ ...inputStyle, padding: 12, resize: "none", lineHeight: 1.5 }} />
            </Field>
            {(() => {
              const qs = visibleQuestions(intakeForm);
              if (qs.length === 0) return null;
              const studio = link?.business_name || "your stylist";
              const setAns = (id: string, v: string) =>
                setIntakeAnswers(prev => ({ ...prev, [id]: v }));
              return (
                <div style={{ borderTop: `1px solid ${C.hairline}`, paddingTop: 16, marginTop: 4, display: "grid", gap: 14 }}>
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 700, color: C.espresso, margin: 0 }}>Consultation</p>
                    <p style={{ fontSize: 11.5, color: C.muted, margin: "2px 0 0", lineHeight: 1.5 }}>
                      Optional — a few questions from {studio} so your appointment is tailored to you.
                    </p>
                  </div>
                  {qs.map((q: IntakeQuestion) => (
                    <Field key={q.id} label={q.label}>
                      {q.type === "textarea" ? (
                        <textarea
                          value={intakeAnswers[q.id] ?? ""}
                          onChange={e => setAns(q.id, e.target.value)}
                          rows={2}
                          placeholder="Your answer…"
                          style={{ ...inputStyle, padding: 12, resize: "none", lineHeight: 1.5 }}
                        />
                      ) : q.type === "yes_no" ? (
                        <select value={intakeAnswers[q.id] ?? ""} onChange={e => setAns(q.id, e.target.value)} style={{ ...inputStyle, padding: 12 }}>
                          <option value="">Select…</option>
                          <option value="Yes">Yes</option>
                          <option value="No">No</option>
                        </select>
                      ) : q.type === "choice" ? (
                        <select value={intakeAnswers[q.id] ?? ""} onChange={e => setAns(q.id, e.target.value)} style={{ ...inputStyle, padding: 12 }}>
                          <option value="">Select…</option>
                          {(q.options ?? []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      ) : q.type === "multichoice" ? (
                        <div style={{ display: "grid", gap: 8 }}>
                          {(q.options ?? []).map(opt => {
                            const current = (intakeAnswers[q.id] ?? "")
                              .split(",").map(s => s.trim()).filter(Boolean);
                            const checked = current.includes(opt);
                            return (
                              <label key={opt} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 14, color: C.coffee }}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    const next = checked
                                      ? current.filter(x => x !== opt)
                                      : [...current, opt];
                                    setAns(q.id, next.join(", "));
                                  }}
                                  style={{ width: 18, height: 18, accentColor: C.espresso, flexShrink: 0 }}
                                />
                                <span>{opt}</span>
                              </label>
                            );
                          })}
                        </div>
                      ) : (
                        <input
                          value={intakeAnswers[q.id] ?? ""}
                          onChange={e => setAns(q.id, e.target.value)}
                          placeholder="Your answer…"
                          style={{ ...inputStyle }}
                        />
                      )}
                    </Field>
                  ))}
                </div>
              );
            })()}
            {noShowConsentRequired && noShowFee && (() => {
              const feeText = (() => {
                if (noShowFee.type === "percent") {
                  const price = resolved?.price ?? Number(selectedCatalogService?.base_price) ?? 0;
                  const computed = price > 0 ? price * (Number(noShowFee.value) / 100) : 0;
                  return computed > 0
                    ? `$${computed.toFixed(2)} (${noShowFee.value}% of the service price)`
                    : `${noShowFee.value}% of the service price`;
                }
                return `$${Number(noShowFee.value).toFixed(2)}`;
              })();
              const studio = link?.business_name || "your stylist";
              // Highlight the box in red once the client has tried to
              // submit without agreeing.
              const unmet = !noShowConsent && !!submitError;
              return (
                <label style={{
                  display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer",
                  background: C.ivory, border: `1.5px solid ${unmet ? C.danger : C.hairline}`,
                  borderRadius: 12, padding: 12,
                }}>
                  <input
                    type="checkbox"
                    checked={noShowConsent}
                    onChange={e => setNoShowConsent(e.target.checked)}
                    required
                    style={{ marginTop: 2, width: 18, height: 18, accentColor: C.espresso, flexShrink: 0 }}
                  />
                  <span style={{ fontSize: 12, color: C.coffee, lineHeight: 1.5 }}>
                    <strong style={{ color: C.espresso }}>Required.</strong>{" "}
                    I understand a no-show fee of <strong>{feeText}</strong> may be charged to my card if I miss this
                    appointment without notice, per {studio}&apos;s policy, and I authorize my card to be saved for that purpose.
                  </span>
                </label>
              );
            })()}
            {submitError && (
              <p role="alert" aria-live="assertive" style={{ fontSize: 12, color: C.danger }}>{submitError}</p>
            )}
            <button ref={bookingSubmitRef} type="submit" disabled={submitting || (noShowConsentRequired && !noShowConsent)}
              // 2026 refresh: primary booking CTA now uses the brand
              // purple→coral gradient with a soft halo shadow. The
              // stylist's accent still drives borders/chips, but the
              // primary action gets the platform's hero treatment so
              // booking feels consistent across stylists.
              style={{
                marginTop: 6,
                padding: "16px 18px",
                borderRadius: 14,
                background: GRADIENTS.primary,
                backgroundColor: C.brandPrimary,
                color: "#FFFFFF",
                border: "0",
                fontWeight: 700,
                fontSize: 15,
                letterSpacing: "0.02em",
                boxShadow: submitting ? "none" : SHADOWS.primaryGlow,
                cursor: submitting || (noShowConsentRequired && !noShowConsent) ? "default" : "pointer",
                opacity: submitting || (noShowConsentRequired && !noShowConsent) ? 0.6 : 1,
                transition: "transform 120ms ease, box-shadow 120ms ease",
              }}>
              {submitting
                ? "Sending…"
                : resolved && resolved.depositRequired && resolved.depositAmount > 0
                  ? `Pay deposit & request appointment · $${resolved.depositAmount.toFixed(2)}`
                  : selectedCatalogService?.deposit_required
                      && (selectedCatalogService.deposit_amount || 0) > 0
                      && !hasVariations
                    ? `Pay deposit & request appointment · $${Number(selectedCatalogService.deposit_amount).toFixed(2)}`
                    : "Request appointment"}
            </button>
            <p style={{ fontSize: 11, color: C.muted, textAlign: "center", marginTop: 4 }}>
              You&apos;ll get a confirmation reply once your stylist reviews the request.
            </p>
            </>}
          </form>
        )}

        {/* Waitlist alternate flow */}
        {!linkLoading && !linkError && !submitted && !paymentChoice && (
          <div style={{ marginTop: 24, padding: 16, borderRadius: 16, background: C.paper, border: `1px solid ${C.hairline}` }}>
            {!waitlistOpen && !waitlistDone && (
              <button
                type="button"
                onClick={() => setWaitlistOpen(true)}
                // Cream / tan treatment so the waitlist CTA reads
                // visibly warmer than the surrounding white canvas
                // without competing with the stylist's accent button.
                style={{
                  width: "100%", padding: "12px 14px", borderRadius: 12,
                  background: "#F4E9D3", color: C.espresso,
                  border: `1px solid ${C.goldDeep}`,
                  fontSize: 14, fontWeight: 600, cursor: "pointer",
                }}
              >
                Don&apos;t see a time that works? · Join the waitlist
              </button>
            )}
            {waitlistOpen && !waitlistDone && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <p style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 600, color: C.espresso }}>
                  Join the waitlist
                </p>
                <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.5 }}>
                  We&apos;ll reach out the moment a matching opening appears. Fill in the appointment fields above first — we&apos;ll use those.
                </p>
                <Field label="When are you flexible?">
                  <select
                    value={waitlistFlex}
                    onChange={e => setWaitlistFlex(e.target.value as WaitlistFlexibility)}
                    style={selectStyle}
                  >
                    {(Object.keys(WAITLIST_FLEX_LABEL) as WaitlistFlexibility[]).map(k => (
                      <option key={k} value={k}>{WAITLIST_FLEX_LABEL[k]}</option>
                    ))}
                  </select>
                </Field>
                {waitlistError && (
                  <p style={{ fontSize: 12, color: C.danger }}>{waitlistError}</p>
                )}
                <button
                  type="button"
                  onClick={submitWaitlist}
                  disabled={waitlistSubmitting}
                  style={{
                    padding: "13px 14px", borderRadius: 14,
                    background: `linear-gradient(180deg, ${C.gold}, ${C.goldDeep})`,
                    color: C.paper, border: `1px solid ${C.goldDeep}`,
                    fontSize: 14, fontWeight: 700, cursor: "pointer",
                    opacity: waitlistSubmitting ? 0.7 : 1,
                  }}
                >
                  {waitlistSubmitting ? "Adding…" : "Join the waitlist"}
                </button>
                <button
                  type="button"
                  onClick={() => setWaitlistOpen(false)}
                  style={{
                    padding: "10px 14px", borderRadius: 12,
                    background: "transparent", color: C.muted, border: 0,
                    fontSize: 12, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
            {waitlistDone && (
              <div style={{ textAlign: "center" }}>
                <p style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 600, color: C.espresso }}>
                  You&apos;re on the waitlist
                </p>
                <p style={{ fontSize: 13, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
                  The stylist will contact you if an opening becomes available.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Phase 4 — Recommended Products. Lives below the waitlist
            CTA so the booking form (and the alternate waitlist flow)
            sit above the fold and the retail rail reads as a tail
            "before you go" prompt instead of competing with the
            booking decision. Hides itself when empty. */}
        {products.length > 0 && (
          <div style={{ marginTop: 28 }}>
            <p
              style={{
                textAlign: "center",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                color: accent,
                margin: 0,
              }}
            >
              Recommended Products
            </p>
            <p style={{ textAlign: "center", fontSize: 12, color: C.muted, marginTop: 4 }}>
              Complete your appointment
            </p>
            <div
              role="list"
              aria-label="Recommended products"
              className="bbp-rail"
              style={{
                marginTop: 12,
                display: "flex",
                gap: 12,
                overflowX: "auto",
                WebkitOverflowScrolling: "touch",
                paddingBottom: 10,
                scrollSnapType: "x mandatory",
              }}
            >
              {products.map(p => (
                <ProductCard key={p.id} product={p} accent={accent} handle={slug} />
              ))}
            </div>
          </div>
        )}

        {/* Phase 5 — Per-service recommendations. Renders only after
            the visitor has picked a service AND the stylist has
            mapped at least one product to that service. */}
        {serviceRecs.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <p
              style={{
                textAlign: "center",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                color: accent,
                margin: 0,
              }}
            >
              For Your Appointment
            </p>
            <p style={{ textAlign: "center", fontSize: 12, color: C.muted, marginTop: 4 }}>
              Hand-picked for {selectedCatalogService?.name || "this service"}
            </p>
            <div
              role="list"
              aria-label="Recommended for this service"
              className="bbp-rail"
              style={{
                marginTop: 12,
                display: "flex",
                gap: 12,
                overflowX: "auto",
                WebkitOverflowScrolling: "touch",
                paddingBottom: 10,
                scrollSnapType: "x mandatory",
              }}
            >
              {serviceRecs.map(p => (
                <ProductCard key={`rec_${p.id}`} product={p} accent={accent} handle={slug} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Sticky "Book" bar — keeps the primary action one tap away no
          matter how far the visitor has scrolled through the bio,
          gallery, and reviews. Slides out of view once the service
          picker itself is on screen so the CTA never doubles up. */}
      <div
        aria-hidden={bookingInView}
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 80,
          display: "flex",
          justifyContent: "center",
          // Taller top padding + a longer, softer white fade so content
          // (e.g. the Recent Work photos) dissolves gently under the bar
          // instead of being hard-cut by an abrupt edge.
          padding: "30px 16px calc(12px + env(safe-area-inset-bottom, 0px))",
          background: "linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.78) 50%, #FFFFFF 82%)",
          pointerEvents: bookingInView ? "none" : "auto",
          opacity: bookingInView ? 0 : 1,
          transform: bookingInView ? "translateY(110%)" : "translateY(0)",
          transition: "opacity 220ms ease, transform 260ms cubic-bezier(.2,.8,.2,1)",
        }}
      >
        <button
          type="button"
          onClick={scrollToBooking}
          style={{
            width: "100%",
            maxWidth: 480,
            padding: "15px 18px",
            borderRadius: 999,
            border: "none",
            cursor: "pointer",
            background: accent,
            color: "#FFFFFF",
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: "0.01em",
            boxShadow: "0 14px 30px -10px rgba(21, 17, 26, 0.55)",
            appearance: "none",
            WebkitAppearance: "none",
          }}
        >
          Book an appointment
        </button>
      </div>

      {/* Sticky price summary — the counterpart to the Book bar above.
          Shows while the form IS on screen and a service is selected, so
          the running total + deposit-due-today stay visible as the
          client stacks add-ons. Tapping jumps to the submit button. */}
      {(() => {
        const price = resolved?.price ?? (selectedCatalogService ? Number(selectedCatalogService.base_price) : null);
        const hasPrice = price != null && Number.isFinite(price);
        const show = bookingInView && !!serviceId && hasPrice;
        const deposit = resolved && resolved.depositRequired
          ? resolved.depositAmount
          : (selectedCatalogService?.deposit_required && !hasVariations
              ? Number(selectedCatalogService.deposit_amount || 0)
              : 0);
        return (
          <div
            aria-hidden={!show}
            style={{
              position: "fixed",
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 80,
              display: "flex",
              justifyContent: "center",
              padding: "30px 16px calc(12px + env(safe-area-inset-bottom, 0px))",
              background: "linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.78) 50%, #FFFFFF 82%)",
              pointerEvents: show ? "auto" : "none",
              opacity: show ? 1 : 0,
              transform: show ? "translateY(0)" : "translateY(110%)",
              transition: "opacity 220ms ease, transform 260ms cubic-bezier(.2,.8,.2,1)",
            }}
          >
            <button
              type="button"
              onClick={scrollToSubmit}
              style={{
                width: "100%",
                maxWidth: 480,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "12px 18px",
                borderRadius: 999,
                border: `1px solid ${C.hairline}`,
                cursor: "pointer",
                background: "#FFFFFF",
                color: C.espresso,
                boxShadow: "0 14px 30px -12px rgba(21, 17, 26, 0.40)",
                appearance: "none",
                WebkitAppearance: "none",
              }}
            >
              <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.2 }}>
                <span style={{ fontSize: 16, fontWeight: 800 }}>${hasPrice ? price!.toFixed(0) : "0"}</span>
                <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>
                  {deposit > 0 ? `$${deposit.toFixed(0)} deposit due today` : "No deposit due today"}
                </span>
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: accent, fontSize: 14, fontWeight: 700 }}>
                Review &amp; book
                <span aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>›</span>
              </span>
            </button>
          </div>
        );
      })()}

      {/* "Meet your stylist" → About panel. Expands in place from the
          spotlight hero card with a larger portrait + the full bio +
          a few details, then drops the visitor straight into booking.
          Degrades gracefully: shows whatever fields are populated. */}
      {aboutOpen && (() => {
        const aboutLocation =
          (link?.location_text || "").trim() ||
          [link?.business_city, link?.business_state].filter(Boolean).join(", ").trim();
        const years = link?.years_in_business;
        return (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`About ${link?.business_name || "your stylist"}`}
            onClick={() => setAboutOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(26, 15, 8, 0.78)",
              zIndex: 9999,
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
              padding: "max(24px, env(safe-area-inset-top)) 0 0",
            }}
          >
            <div
              ref={aboutRef}
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "100%", maxWidth: 480,
                maxHeight: "92vh", overflowY: "auto",
                background: C.paper,
                borderTopLeftRadius: 24, borderTopRightRadius: 24,
                boxShadow: "0 -16px 48px -16px rgba(21, 17, 26, 0.5)",
                padding: "20px 20px max(24px, env(safe-area-inset-bottom))",
                position: "relative",
              }}
            >
              <button
                type="button"
                onClick={() => setAboutOpen(false)}
                aria-label="Close"
                style={{
                  position: "absolute", top: 14, right: 14,
                  width: 36, height: 36, borderRadius: 999,
                  background: C.ivory, color: C.coffee,
                  border: `1px solid ${C.hairline}`,
                  fontSize: 20, lineHeight: 1, cursor: "pointer", padding: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                ×
              </button>

              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
                <div
                  style={{
                    width: 132, height: 132, borderRadius: 24, overflow: "hidden",
                    border: `1px solid ${C.hairline}`, flexShrink: 0,
                    boxShadow: "0 14px 36px -16px rgba(21, 17, 26, 0.3)",
                  }}
                >
                  {heroPortrait ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={heroPortrait}
                      alt={link?.business_name || "Your stylist"}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : (
                    <div
                      aria-hidden
                      style={{ width: "100%", height: "100%", background: "linear-gradient(135deg, #7C3AED 0%, #FF4D6D 100%)" }}
                    />
                  )}
                </div>
                <p
                  style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: "0.2em",
                    textTransform: "uppercase", color: accent, margin: "16px 0 0",
                  }}
                >
                  Meet your stylist
                </p>
                <h2
                  style={{
                    fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 28,
                    color: C.brandPrimary, lineHeight: 1.1, margin: "4px 0 0",
                  }}
                >
                  {link?.business_name || "Welcome"}
                </h2>
                {tagline ? (
                  <p
                    style={{
                      fontFamily: FONT_DISPLAY, fontStyle: "italic", fontWeight: 500,
                      fontSize: 16, color: C.coffee, margin: "4px 0 0", lineHeight: 1.3,
                    }}
                  >
                    {tagline}
                  </p>
                ) : displayHandle ? (
                  <p style={{ fontSize: 12, color: C.muted, margin: "4px 0 0" }}>@{displayHandle}</p>
                ) : null}
                {(aboutLocation || (typeof years === "number" && years > 0)) && (
                  <p style={{ fontSize: 12.5, color: C.muted, margin: "10px 0 0" }}>
                    {[
                      aboutLocation || null,
                      typeof years === "number" && years > 0
                        ? `${years} yr${years === 1 ? "" : "s"} in business`
                        : null,
                    ].filter(Boolean).join("  •  ")}
                  </p>
                )}
              </div>

              {about ? (
                <p
                  style={{
                    fontSize: 15, lineHeight: 1.7, color: C.coffee,
                    margin: "20px 0 0", whiteSpace: "pre-line",
                  }}
                >
                  {about}
                </p>
              ) : (
                <p style={{ fontSize: 14, lineHeight: 1.6, color: C.muted, margin: "20px 0 0", textAlign: "center" }}>
                  {link?.business_name || "Your stylist"} hasn&apos;t added a bio yet — tap below to book your appointment.
                </p>
              )}

              <button
                type="button"
                onClick={() => { setAboutOpen(false); scrollToBooking(); }}
                style={{
                  marginTop: 24, width: "100%", padding: "16px 20px",
                  borderRadius: 999, border: "none", cursor: "pointer",
                  background: accent, color: "#fff",
                  fontSize: 16, fontWeight: 800, letterSpacing: "0.01em",
                }}
              >
                Book an appointment
              </button>
            </div>
          </div>
        );
      })()}

      {/* Tap-to-expand lightbox. Self-contained — no portal needed
          because this page is its own scope with no parent
          transform / overflow that would trap fixed positioning. */}
      {coverZoom && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setCoverZoom(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(26, 15, 8, 0.92)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "max(24px, env(safe-area-inset-top)) 12px max(24px, env(safe-area-inset-bottom)) 12px",
          }}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setCoverZoom(null); }}
            aria-label="Close photo"
            style={{
              position: "absolute",
              top: "max(20px, env(safe-area-inset-top))",
              right: 16,
              width: 40, height: 40, borderRadius: 999,
              background: "rgba(0,0,0,0.5)", color: "#fff",
              border: "1px solid rgba(255,255,255,0.2)",
              fontSize: 22, fontWeight: 400, lineHeight: 1,
              cursor: "pointer", padding: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            ×
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={coverZoom}
            alt="Full photo"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
              borderRadius: 8,
              boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
            }}
          />
        </div>
      )}

      {lightboxIndex !== null && Array.isArray(link?.gallery_photos) && (() => {
        const photos = (link!.gallery_photos || [])
          .slice()
          .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
          .slice(0, 8);
        const i = Math.max(0, Math.min(lightboxIndex, photos.length - 1));
        const p = photos[i];
        if (!p) return null;
        const close = () => setLightboxIndex(null);
        const prev = () => setLightboxIndex((cur) => cur === null ? null : (cur - 1 + photos.length) % photos.length);
        const next = () => setLightboxIndex((cur) => cur === null ? null : (cur + 1) % photos.length);
        const meta = resolvePhotoMeta(p);
        return (
          <div
            role="dialog"
            aria-modal="true"
            onClick={close}
            onTouchStart={onLightboxTouchStart}
            onTouchEnd={onLightboxTouchEnd}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(26, 15, 8, 0.92)",
              zIndex: 9999,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "max(24px, env(safe-area-inset-top)) 12px max(24px, env(safe-area-inset-bottom)) 12px",
            }}
          >
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); close(); }}
              aria-label="Close photo"
              style={{
                position: "absolute",
                top: "max(20px, env(safe-area-inset-top))",
                right: 16,
                width: 40, height: 40, borderRadius: 999,
                background: "rgba(0,0,0,0.5)", color: "#fff",
                border: "1px solid rgba(255,255,255,0.2)",
                fontSize: 22, fontWeight: 400, lineHeight: 1,
                cursor: "pointer", padding: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              ×
            </button>

            {photos.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); prev(); }}
                  aria-label="Previous photo"
                  style={{
                    position: "absolute", left: 10, top: "50%",
                    transform: "translateY(-50%)",
                    width: 44, height: 44, borderRadius: 999,
                    background: "rgba(0,0,0,0.4)", color: "#fff",
                    border: "1px solid rgba(255,255,255,0.15)",
                    fontSize: 22, lineHeight: 1, cursor: "pointer",
                    padding: 0,
                  }}
                >‹</button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); next(); }}
                  aria-label="Next photo"
                  style={{
                    position: "absolute", right: 10, top: "50%",
                    transform: "translateY(-50%)",
                    width: 44, height: 44, borderRadius: 999,
                    background: "rgba(0,0,0,0.4)", color: "#fff",
                    border: "1px solid rgba(255,255,255,0.15)",
                    fontSize: 22, lineHeight: 1, cursor: "pointer",
                    padding: 0,
                  }}
                >›</button>
              </>
            )}

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={p.url}
              alt={`Photo ${i + 1} of ${photos.length}`}
              onClick={(e) => e.stopPropagation()}
              style={{
                maxWidth: "100%",
                maxHeight: "100%",
                objectFit: "contain",
                borderRadius: 8,
                boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
              }}
            />

            {photos.length > 1 && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: "absolute",
                  bottom: "max(28px, env(safe-area-inset-bottom))",
                  left: 0, right: 0,
                  display: "flex", justifyContent: "center", gap: 6,
                  pointerEvents: "none",
                }}
              >
                {photos.map((_, j) => (
                  <span
                    key={j}
                    style={{
                      width: j === i ? 18 : 6, height: 6, borderRadius: 99,
                      background: j === i ? "#fff" : "rgba(255,255,255,0.35)",
                      transition: "width 200ms ease",
                    }}
                  />
                ))}
              </div>
            )}

            {/* "Book this look" — turns the portfolio into the front
                door of the funnel. Closes the lightbox and scrolls
                straight to the service picker instead of leaving the
                photo as a dead end. Sits above the dot indicators.
                When the photo is linked to a service, the style name +
                "from $X" show above the button and the tap pre-selects
                that service. */}
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: "absolute",
                left: 0, right: 0,
                bottom: photos.length > 1
                  ? "max(52px, calc(env(safe-area-inset-bottom) + 52px))"
                  : "max(28px, env(safe-area-inset-bottom))",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
                padding: "0 16px",
              }}
            >
              {(meta.title || meta.fromPrice != null) && (
                <div style={{ textAlign: "center", color: "#FFFFFF", textShadow: "0 1px 8px rgba(0,0,0,0.6)" }}>
                  {meta.title && (
                    <p style={{ margin: 0, fontSize: 15, fontWeight: 700, lineHeight: 1.2 }}>{meta.title}</p>
                  )}
                  {meta.fromPrice != null && (
                    <p style={{ margin: "2px 0 0", fontSize: 12, fontWeight: 600, opacity: 0.92 }}>from ${meta.fromPrice.toFixed(0)}</p>
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  close();
                  // Pre-select the linked service (mirrors the
                  // featured-card handler) before scrolling to the
                  // picker. Falls back to a plain scroll when the
                  // photo isn't linked or the service is inactive.
                  if (meta.svc) {
                    setServiceId(meta.svc.id);
                    setSelectedVariationId("");
                    setServiceName(meta.svc.name || "");
                    if (meta.svc.category_id) setActiveCategoryId(meta.svc.category_id);
                  }
                  scrollToBooking();
                }}
                style={{
                  padding: "11px 22px",
                  borderRadius: 999,
                  border: "none",
                  cursor: "pointer",
                  background: meta.svc ? accent : "#FFFFFF",
                  color: meta.svc ? "#FFFFFF" : C.espresso,
                  fontSize: 13,
                  fontWeight: 700,
                  letterSpacing: "0.02em",
                  boxShadow: "0 10px 24px -8px rgba(0,0,0,0.6)",
                  appearance: "none",
                  WebkitAppearance: "none",
                }}
              >
                Book this look
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 12,
  border: `1px solid ${C.hairline}`,
  background: C.paper,
  color: C.espresso,
  fontSize: 15,
  outline: "none",
};
// Select style mirrors the inputs. We deliberately DON'T strip the
// native dropdown arrow (no `appearance: none`) so every <select> keeps
// a visible chevron and reads as a tappable picker.
const selectStyle: React.CSSProperties = { ...inputStyle };
// Numbered step header for the booking funnel — gives the long form a
// guided "1 · 2 · 3" rhythm instead of one endless scroll.
// Accent section heading for the booking funnel — matches the emphasized
// Field labels (Choose a service / option / add-ons). Callers override
// `color` with the stylist's accent.
const stepHeaderStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 800,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: C.brandPrimary,
  margin: "6px 0 -2px",
};

// Shared between the "Recommended Products" + "For Your Appointment"
// rails. Image on top, title + price below, optional external
// checkout link as a footer pill.
const ProductCard = ({ product, accent, handle }: { product: PublicProduct; accent: string; handle: string }) => {
  // Routing rules:
  //   1. external_checkout_url set → open the external store in a new
  //      tab (stylist explicitly redirected the product elsewhere).
  //   2. no external URL but the product has a slug → link to the
  //      in-app storefront detail page at /@<handle>/products/<slug>,
  //      which carries the Stripe Connect Buy Now flow.
  //   3. no slug (legacy row) → render as a non-interactive preview.
  // Either of (1) or (2) gives the visitor a way to actually buy.
  const hasExternal = !!product.external_checkout_url;
  const hasInternal = !!product.slug && !!handle;
  const purchasable = hasExternal || hasInternal;
  const body = (
    <>
      {product.image_url ? (
        <div style={{ aspectRatio: "1 / 1", background: C.ivory, overflow: "hidden" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={product.image_url}
            alt={product.title}
            loading="lazy"
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        </div>
      ) : (
        <div
          aria-hidden
          style={{
            aspectRatio: "1 / 1",
            background: `linear-gradient(180deg, ${C.cream}, ${C.ivory})`,
            display: "grid", placeItems: "center",
            color: C.muted, fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase",
          }}
        >
          Product
        </div>
      )}
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 4 }}>
        <p style={{ margin: 0, fontWeight: 600, fontSize: 13, color: C.espresso, lineHeight: 1.25 }}>
          {product.title}
        </p>
        {product.description && (
          <p style={{ margin: 0, fontSize: 11, color: C.muted, lineHeight: 1.4 }}>
            {product.description.length > 70 ? `${product.description.slice(0, 67)}…` : product.description}
          </p>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 4 }}>
          <span style={{ fontWeight: 700, color: C.goldDeep, fontSize: 14 }}>
            {product.price != null ? `$${product.price.toFixed(2)}` : "Ask"}
          </span>
          {product.local_pickup_available && (
            <span
              style={{
                fontSize: 9.5, fontWeight: 600, letterSpacing: "0.08em",
                textTransform: "uppercase", color: C.muted,
              }}
            >
              Local pickup
            </span>
          )}
        </div>
        {purchasable && (
          <span
            style={{
              marginTop: 6,
              fontSize: 11, fontWeight: 600, textAlign: "center",
              color: accent, border: `1px solid ${accent}`,
              borderRadius: 99, padding: "6px 10px", background: "#FFFFFF",
            }}
          >
            {hasExternal ? "Shop now" : "View & buy"}
          </span>
        )}
      </div>
    </>
  );
  const sharedStyle: React.CSSProperties = {
    flex: "0 0 200px",
    scrollSnapAlign: "start",
    borderRadius: 16,
    background: C.paper,
    border: `1px solid ${C.hairline}`,
    boxShadow: "0 4px 12px rgba(21, 17, 26, 0.04)",
    overflow: "hidden",
    color: "inherit",
    textDecoration: "none",
    cursor: purchasable ? "pointer" : "default",
  };
  if (hasExternal) {
    return (
      <a href={product.external_checkout_url!} target="_blank" rel="noopener noreferrer" style={sharedStyle}>
        {body}
      </a>
    );
  }
  if (hasInternal) {
    return (
      <a
        href={`/@${encodeURIComponent(handle)}/products/${encodeURIComponent(product.slug)}`}
        style={sharedStyle}
      >
        {body}
      </a>
    );
  }
  return <div style={sharedStyle}>{body}</div>;
};

const Field = ({ label, children, labelColor }: { label: string; children: React.ReactNode; labelColor?: string }) => (
  <label style={{ display: "block" }}>
    <span style={{ display: "block", fontSize: labelColor ? 13 : 11, fontWeight: labelColor ? 800 : 700, textTransform: "uppercase", letterSpacing: "0.08em", color: labelColor || C.coffee, marginBottom: 6 }}>{label}</span>
    {children}
  </label>
);

const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input {...props} style={inputStyle} />
);

// ---- Phase B7 — booking calendar -------------------------------------

const ghostButtonStyle: React.CSSProperties = {
  padding: 10,
  borderRadius: 10,
  background: "transparent",
  color: C.coffee,
  border: `1px solid ${C.hairline}`,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  minHeight: 40,
};
const primaryButtonStyle: React.CSSProperties = {
  padding: 10,
  borderRadius: 10,
  background: `linear-gradient(180deg, ${C.gold}, ${C.goldDeep})`,
  color: C.paper,
  border: `1px solid ${C.goldDeep}`,
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  minHeight: 40,
};

const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"] as const;
const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

const formatPrettyDate = (iso: string): string => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
};

const SlotSkeleton = () => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))",
      gap: 8,
    }}
  >
    {Array.from({ length: 6 }).map((_, i) => (
      <div
        key={i}
        style={{
          height: 44,
          borderRadius: 12,
          background: `linear-gradient(90deg, ${C.paper}, ${C.ivory}, ${C.paper})`,
          backgroundSize: "200% 100%",
          animation: "bbpShimmer 1.4s ease-in-out infinite",
          border: `1px solid ${C.hairline}`,
        }}
      />
    ))}
  </div>
);

type CalendarProps = {
  monthCursor: { year: number; month: number };
  setMonthCursor: (next: { year: number; month: number }) => void;
  monthDays: MonthDay[];
  monthLoading: boolean;
  monthError: string | null;
  monthHasAnyAvailability: boolean;
  hasCatalog: boolean;
  hasService: boolean;
  selectedDate: string;
  onSelectDate: (iso: string) => void;
  onJoinWaitlist: () => void;
};

const BookingCalendar = ({
  monthCursor, setMonthCursor, monthDays, monthLoading, monthError,
  monthHasAnyAvailability, hasCatalog, hasService, selectedDate,
  onSelectDate, onJoinWaitlist,
}: CalendarProps) => {
  const dayMap = useMemo(() => {
    const m = new Map<string, MonthDay>();
    for (const d of monthDays) m.set(d.day, d);
    return m;
  }, [monthDays]);

  // Build the visible grid: leading blanks for the weekday offset of
  // day 1, then every day of the month, padded so the grid is a
  // multiple of 7. SSR-safe — no Date.now() at render time outside
  // the cursor (which was set in lazy state init).
  const cells = useMemo(() => {
    const first = new Date(monthCursor.year, monthCursor.month - 1, 1);
    const lead = first.getDay(); // 0 = Sunday
    const daysInMonth = new Date(monthCursor.year, monthCursor.month, 0).getDate();
    const out: ({ iso: string; day: number } | null)[] = [];
    for (let i = 0; i < lead; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${monthCursor.year}-${String(monthCursor.month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      out.push({ iso, day: d });
    }
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [monthCursor]);

  const today = todayISO();

  const goPrev = () => {
    const m = monthCursor.month - 1;
    if (m < 1) setMonthCursor({ year: monthCursor.year - 1, month: 12 });
    else setMonthCursor({ year: monthCursor.year, month: m });
  };
  const goNext = () => {
    const m = monthCursor.month + 1;
    if (m > 12) setMonthCursor({ year: monthCursor.year + 1, month: 1 });
    else setMonthCursor({ year: monthCursor.year, month: m });
  };

  // Don't allow navigating to a month entirely in the past (the prev
  // arrow disables when the visible month is the current month).
  const now = new Date();
  const atCurrentMonth =
    monthCursor.year === now.getFullYear() && monthCursor.month === now.getMonth() + 1;

  const headerLabel = `${MONTH_LABELS[monthCursor.month - 1]} ${monthCursor.year}`;

  return (
    <div
      style={{
        padding: 14,
        borderRadius: 16,
        background: C.paper,
        border: `1px solid ${C.hairline}`,
      }}
    >
      <style>{`
        @keyframes bbpShimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        @keyframes bbpFadeIn { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: none; } }
      `}</style>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <button
          type="button"
          onClick={goPrev}
          disabled={atCurrentMonth}
          aria-label="Previous month"
          style={{
            ...ghostButtonStyle,
            minHeight: 36, padding: "6px 10px",
            opacity: atCurrentMonth ? 0.4 : 1,
            cursor: atCurrentMonth ? "default" : "pointer",
          }}
        >
          ←
        </button>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 18, color: C.espresso }}>
          {headerLabel}
        </div>
        <button
          type="button"
          onClick={goNext}
          aria-label="Next month"
          style={{ ...ghostButtonStyle, minHeight: 36, padding: "6px 10px" }}
        >
          →
        </button>
      </div>

      {!hasCatalog && (
        <p style={{ fontSize: 11, color: C.muted, marginBottom: 8, lineHeight: 1.5 }}>
          The stylist hasn&apos;t finished setting up their catalog. Pick any open day and we&apos;ll text you to confirm.
        </p>
      )}
      {hasCatalog && !hasService && (
        <p style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>
          Pick a service above for the most accurate openings — the calendar uses an hour by default until then.
        </p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4 }}>
        {WEEKDAY_LETTERS.map((w, i) => (
          <div
            key={`wk-${i}`}
            style={{
              fontSize: 10, fontWeight: 700, color: C.muted,
              textAlign: "center", textTransform: "uppercase", letterSpacing: "0.08em",
              padding: "4px 0",
            }}
          >
            {w}
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {cells.map((cell, idx) => {
          if (!cell) return <div key={`pad-${idx}`} style={{ minHeight: 44 }} />;
          const info = dayMap.get(cell.iso);
          const status: MonthDayStatus = info?.status ?? "off";
          const isPast = cell.iso < today;
          const isSelected = selectedDate === cell.iso;
          const disabled = isPast || status === "off" || status === "booked";
          return (
            <CalendarCell
              key={cell.iso}
              day={cell.day}
              status={status}
              loading={monthLoading && !info}
              disabled={disabled}
              selected={isSelected}
              onClick={() => { if (!disabled) onSelectDate(cell.iso); }}
            />
          );
        })}
      </div>

      <div style={{
        display: "flex", flexWrap: "wrap", gap: 10, marginTop: 12,
        fontSize: 10, color: C.muted, alignItems: "center",
      }}>
        <Legend swatch={C.brandPrimary} label="Open" />
        <Legend swatch="#FBBF24" label="Limited" />
        <Legend swatch={C.hairline} label="Booked" />
        <Legend swatch="transparent" border label="Closed" />
      </div>

      {monthError && (
        <p style={{ fontSize: 11, color: C.danger, marginTop: 10 }}>
          Couldn&apos;t load this month&apos;s availability. {monthError}
        </p>
      )}
      {!monthLoading && !monthError && monthDays.length > 0 && !monthHasAnyAvailability && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 12,
            background: C.cream,
            border: `1px solid ${C.hairline}`,
            textAlign: "center",
          }}
        >
          <p style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 600, color: C.espresso }}>
            Stylist is updating availability
          </p>
          <p style={{ fontSize: 11, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>
            No openings this month yet. Try the next month, or join the waitlist and we&apos;ll text you.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
            <button type="button" onClick={goNext} style={ghostButtonStyle}>
              See next month
            </button>
            <button type="button" onClick={onJoinWaitlist} style={primaryButtonStyle}>
              Join waitlist
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const Legend = ({ swatch, label, border }: { swatch: string; label: string; border?: boolean }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
    <span style={{
      display: "inline-block", width: 10, height: 10, borderRadius: 3,
      background: swatch, border: border ? `1px solid ${C.hairline}` : "none",
    }} />
    {label}
  </span>
);

type CellProps = {
  day: number;
  status: MonthDayStatus;
  loading: boolean;
  disabled: boolean;
  selected: boolean;
  onClick: () => void;
};

const CalendarCell = ({ day, status, loading, disabled, selected, onClick }: CellProps) => {
  // Visual treatment per status. Selected wins over status colors.
  let bg = C.paper;
  let fg = C.espresso;
  let border = `1px solid ${C.hairline}`;
  if (loading) {
    bg = `linear-gradient(90deg, ${C.paper}, ${C.ivory}, ${C.paper})`;
  } else if (selected) {
    bg = `linear-gradient(180deg, ${C.gold}, ${C.goldDeep})`;
    fg = C.paper;
    border = `1px solid ${C.goldDeep}`;
  } else if (status === "available") {
    bg = "rgba(124, 58, 237, 0.18)";
    border = `1px solid rgba(124, 58, 237, 0.35)`;
  } else if (status === "limited") {
    // brandWarning amber tint (instead of the old beige) so the
    // "limited availability" day reads in the same vocabulary as
    // the rest of the storefront.
    bg = "rgba(251, 191, 36, 0.22)";
    border = `1px solid rgba(251, 191, 36, 0.55)`;
  } else if (status === "booked") {
    bg = C.cream;
    fg = C.muted;
  } else if (status === "off") {
    bg = "transparent";
    fg = "rgba(21, 17, 26, 0.35)";
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      aria-label={`Day ${day}, ${status}`}
      style={{
        minHeight: 44, padding: 0,
        borderRadius: 10,
        background: bg as string,
        color: fg,
        border,
        fontSize: 13,
        fontWeight: selected ? 700 : 500,
        cursor: disabled ? "default" : "pointer",
        animation: loading ? "bbpShimmer 1.4s ease-in-out infinite" : "bbpFadeIn 180ms ease",
        backgroundSize: loading ? "200% 100%" : undefined,
        transition: "transform 120ms ease, background 120ms ease",
        transform: selected ? "scale(1.04)" : "scale(1)",
      }}
    >
      {day}
    </button>
  );
};
