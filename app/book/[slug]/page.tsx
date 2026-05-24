"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getSupabase } from "../../lib/supabase";
import { submitPublicWaitlistRequest, type WaitlistFlexibility, WAITLIST_FLEX_LABEL } from "../../lib/waitlist";
import { emitAnalyticsEvent } from "../../lib/analytics-events";
import {
  fetchPublicServices,
  fetchPublicServiceCategories,
  fetchPublicAvailability,
  fetchPublicMonthAvailability,
  resolveVariationPricing,
  type PublicService,
  type PublicServiceCategory,
  type PublicSlot,
  type MonthDay,
  type MonthDayStatus,
} from "../../lib/services";
import { trackEvent } from "../../lib/track";
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
  gallery_photos?: Array<{ url: string; path?: string; sort?: number }> | null;
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
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

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
      // Only require curl when the dropdown is actually visible
      // (selection enabled AND the picked option includes human hair).
      if (custOn && svc?.allow_client_curl_pattern_selection && humanHairIncluded) {
        if (!curlPattern.trim()) { setSubmitError("Please select your curl pattern."); return; }
        if (isOther(curlPattern) && !customCurlPattern.trim()) {
          setSubmitError("Please tell your stylist the curl pattern you're going for."); return;
        }
      }
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
          sms_opt_in_in: smsOptIn && !!phone.trim(),
        },
      );
      if (!rpcErr && rpcRows) {
        const row = Array.isArray(rpcRows) ? rpcRows[0] : (rpcRows as any);
        if (row?.request_id) {
          submittedOk = true;
          newRequestId = String(row.request_id);
          needsDeposit = !!row.deposit_required && Number(row.deposit_amount) > 0;
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

        // Style customization — best-effort, never blocks the
        // booking. "Custom / Other" free text rides in
        // customization_summary; the structured pick goes to
        // selected_hair_color / selected_curl_pattern.
        const isCustom = (v: string) =>
          v.trim().toLowerCase() === "custom / other" || v.trim().toLowerCase() === "custom/other";
        const hairPick = hairColor.trim();
        const curlPick = curlPattern.trim();
        if (hairPick || curlPick) {
          try {
            await supabase.rpc("public_attach_booking_customization", {
              request_id_in: newRequestId,
              hair_color_in: hairPick || null,
              curl_pattern_in: curlPick || null,
              style_notes_in: null,
              custom_hair_color_in:
                isCustom(hairPick) && customHairColor.trim() ? customHairColor.trim() : null,
              custom_curl_in:
                isCustom(curlPick) && customCurlPattern.trim() ? customCurlPattern.trim() : null,
            });
          } catch {
            /* booking already saved — customization is non-fatal */
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

      setSubmitted(true);
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
      `}</style>

      {/* Storefront-style hero — full-width gradient (or banner
          image) banner with the logo overlapping the bottom-left
          edge, the business name + @handle to the right, and a
          Profile / Shop tab nav underneath. Mirrors the visual
          shape of /@handle/shop so visitors see one consistent
          shell across booking + storefront. */}
      <div
        style={{
          height: 156,
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
        style={{ maxWidth: 480, padding: "0 20px", marginTop: -44, position: "relative" }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
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
                of the outer marginTop:-44 overlap) — i.e. text
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
        <p style={{ textAlign: "center", letterSpacing: "0.22em", textTransform: "uppercase", fontSize: 10, fontWeight: 700, color: accent }}>
          Book your appointment
        </p>
        {/* Contact pills row — location + phone surface as small
            chips beneath the headline. Phone is tappable (tel: on
            mobile). */}
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
          if (socials.length === 0 && !showShare) return null;
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
          return (
            <div
              style={{
                marginTop: 14,
                display: "flex",
                justifyContent: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              {socials.map(s => (
                <a
                  key={s.key}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  // Outline + label colored by the stylist's accent
                  // so the social row reads as a cohesive set with
                  // Share / Send-a-message rather than two visual
                  // styles fighting on the same row.
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: "0.04em",
                    color: accent,
                    textDecoration: "none",
                    padding: "6px 12px",
                    borderRadius: 99,
                    background: "#FFFFFF",
                    border: `1px solid ${accent}`,
                  }}
                >
                  {s.label}
                </a>
              ))}
              {showShare && (
                <button
                  type="button"
                  onClick={handleShare}
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: "0.04em",
                    color: accent,
                    background: "#FFFFFF",
                    border: `1px solid ${accent}`,
                    padding: "6px 12px",
                    borderRadius: 99,
                    cursor: "pointer",
                    appearance: "none",
                    WebkitAppearance: "none",
                  }}
                >
                  Share profile
                </button>
              )}
            </div>
          );
        })()}
        {/* Send-a-message CTA — uses sms: when phone is set, mailto:
            falls through to a future stylist contact email. Shown
            only when at least one channel is available. */}
        {link?.phone && (
          <div style={{ textAlign: "center", marginTop: 14 }}>
            <a
              href={`sms:${link.phone.replace(/\s/g, "")}`}
              style={{
                display: "inline-block",
                fontSize: 12,
                fontWeight: 600,
                color: accent,
                textDecoration: "none",
                padding: "8px 14px",
                borderRadius: 99,
                background: "#FFFFFF",
                border: `1px solid ${accent}`,
                letterSpacing: "0.04em",
              }}
            >
              Send {link.business_name || "the studio"} a message
            </a>
          </div>
        )}
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
                .map((p, i) => (
                  <button
                    key={p.url || i}
                    type="button"
                    onClick={() => setLightboxIndex(i)}
                    aria-label={`Open photo ${i + 1}`}
                    style={{
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
                      alt={`${link?.business_name || "Studio"} — photo ${i + 1}`}
                      loading="lazy"
                      decoding="async"
                      style={{
                        display: "block",
                        width: 200,
                        height: 240,
                        objectFit: "cover",
                      }}
                    />
                  </button>
                ))}
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

        {!linkLoading && !linkError && !submitted && link && (
          <form onSubmit={handleSubmit} style={{ marginTop: 28, display: "grid", gap: 14 }}>
            {/* Personal info gates on having picked a service when a
                catalog exists — the landing should read as a menu
                (Acuity flow). Legacy/free-form bookings keep the
                old "name first" layout because there's no service
                grid above. */}
            {(serviceId || !hasCatalog) && (
              <>
                <Field label="Your name">
                  <Input value={name} onChange={e => setName(e.target.value)} placeholder="Full name" autoComplete="name" required />
                </Field>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Field label="Phone">
                    <Input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="555-0123" autoComplete="tel" />
                  </Field>
                  <Field label="Email">
                    <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@email.com" autoComplete="email" />
                  </Field>
                </div>
                {phone.trim() && (
                  <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={smsOptIn}
                      onChange={e => setSmsOptIn(e.target.checked)}
                      style={{ marginTop: 2, width: 18, height: 18, accentColor: C.espresso, flexShrink: 0 }}
                    />
                    <span style={{ fontSize: 13, color: C.coffee, lineHeight: 1.45 }}>
                      Text me appointment reminders. Standard message rates may apply.
                    </span>
                  </label>
                )}
              </>
            )}
            {hasCatalog ? (
              <>
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
                          gap: 10,
                          overflowX: "auto",
                          WebkitOverflowScrolling: "touch",
                          paddingBottom: 4,
                          scrollbarWidth: "none",
                        }}
                      >
                        {featured.map(s => (
                          <button
                            key={`feat_${s.id}`}
                            type="button"
                            onClick={() => {
                              setServiceId(s.id);
                              setSelectedVariationId("");
                              setServiceName(s.name || "");
                              if (s.category_id) setActiveCategoryId(s.category_id);
                            }}
                            style={{
                              flex: "0 0 240px",
                              padding: 0,
                              borderRadius: 18,
                              background: C.paper,
                              border: `1.5px solid ${serviceId === s.id ? accent : C.hairline}`,
                              boxShadow: serviceId === s.id
                                ? `0 0 0 3px ${C.cream}`
                                : "0 4px 14px rgba(21, 17, 26, 0.06)",
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
                        ))}
                      </div>
                    </Field>
                  );
                })()}

                {/* Category browse — a horizontal-scrolling chip row
                    above the service select. "All" is always present.
                    "Other" only when there are uncategorized services,
                    so the row stays clean for stylists who haven't
                    categorized everything yet. */}
                {hasCategories && (
                  <Field label="Browse by category">
                    <div
                      role="tablist"
                      aria-label="Service categories"
                      style={{
                        // Wrap onto multiple lines instead of forcing
                        // a sideways scroll. Keeps every category
                        // visible on mobile and lets the row breathe
                        // naturally on wider screens.
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 8,
                        justifyContent: "flex-start",
                      }}
                    >
                      {[
                        { id: "", label: "All" },
                        ...serviceCategories.map(c => ({ id: c.id, label: c.name })),
                        ...(hasUncategorized ? [{ id: "__other__", label: "Other" }] : []),
                      ].map(tab => {
                        const active = activeCategoryId === tab.id;
                        return (
                          <button
                            key={tab.id || "__all__"}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            onClick={() => {
                              setActiveCategoryId(tab.id);
                              // Clear the service pick if it falls
                              // outside the new filter — keeps the
                              // select dropdown's value coherent.
                              const stillVisible = catalog.some(s => {
                                if (s.id !== serviceId) return false;
                                if (tab.id === "") return true;
                                if (tab.id === "__other__") return !s.category_id;
                                return s.category_id === tab.id;
                              });
                              if (!stillVisible) {
                                setServiceId("");
                                setSelectedVariationId("");
                                setServiceName("");
                              }
                            }}
                            style={{
                              // Intrinsic width so each chip hugs its
                              // own label; the wrapped row handles
                              // multi-line layout. Don't grow / shrink
                              // — chips of different lengths should
                              // size to their content.
                              flex: "0 0 auto",
                              padding: "8px 14px",
                              borderRadius: 999,
                              background: active ? C.espresso : C.paper,
                              color: active ? C.cream : C.coffee,
                              border: `1px solid ${active ? C.espresso : C.hairline}`,
                              fontSize: 12,
                              fontWeight: 600,
                              letterSpacing: "0.01em",
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                              transition: "background 120ms ease, color 120ms ease, border-color 120ms ease",
                              appearance: "none",
                              WebkitAppearance: "none",
                            }}
                          >
                            {tab.label}
                          </button>
                        );
                      })}
                    </div>
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
                  <Field label={filteredCatalog.length === 1 ? "Service" : "Choose a service"}>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr",
                        gap: 12,
                      }}
                    >
                      {filteredCatalog.map(s => {
                        const cover = (s as any).cover_image_url as string | undefined;
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
                              // Scroll the picked service to the top
                              // so the client lands on its photo and
                              // details, not back at the menu.
                              if (typeof window !== "undefined") {
                                requestAnimationFrame(() => {
                                  window.scrollTo({ top: 0, behavior: "smooth" });
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
                            {cover && (
                              <div
                                style={{
                                  aspectRatio: "4 / 3",
                                  background: C.ivory,
                                  overflow: "hidden",
                                }}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={cover}
                                  alt={`${s.name} cover`}
                                  loading="lazy"
                                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                                />
                              </div>
                            )}
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
                          aspectRatio: "16 / 9", background: C.ivory,
                          cursor: "zoom-in", overflow: "hidden",
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={(selectedCatalogService as any).cover_image_url}
                          alt={`${selectedCatalogService.name} cover`}
                          loading="lazy"
                          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
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
                    {/* Cover image on the parent header — same
                        object-cover treatment as the featured cards
                        so the page reads as one design system. */}
                    {(selectedCatalogService as any).cover_image_url && (
                      <button
                        type="button"
                        onClick={() => setCoverZoom((selectedCatalogService as any).cover_image_url)}
                        aria-label="View full photo"
                        style={{
                          display: "block", width: "100%", padding: 0, border: 0,
                          appearance: "none", WebkitAppearance: "none",
                          aspectRatio: "16 / 9", background: C.ivory,
                          cursor: "zoom-in", overflow: "hidden",
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={(selectedCatalogService as any).cover_image_url}
                          alt={`${selectedCatalogService.name} cover`}
                          loading="lazy"
                          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
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
                    <Field label="Choose an option">
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
                {selectedCatalogService && availableExtras.length > 0 && (
                  <Field label="Optional add-ons">
                    <p style={{ margin: "0 0 8px", fontSize: 11, color: C.muted, lineHeight: 1.4 }}>
                      Pick any extras you want — your total updates as you tap.
                    </p>
                    <div style={{ display: "grid", gap: 8 }}>
                      {availableExtras.map(e => {
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
                                +${(Number(e.price) || 0).toFixed(2)}
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
              <Field label="Service / style you want">
                <Input value={serviceName} onChange={e => setServiceName(e.target.value)} placeholder="e.g. Knotless mid-back" />
              </Field>
            )}
            {(() => {
              const svc: any = hasCatalog ? selectedCatalogService : null;
              if (!svc || (svc.customization_enabled ?? true) === false) return null;
              const showColor = !!svc.hair_included && !!svc.allow_client_hair_color_selection;
              const showCurl = !!svc.allow_client_curl_pattern_selection && humanHairIncluded;
              if (!svc.hair_included && !showColor && !showCurl) return null;
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
                        What's included
                      </span>
                      <p style={{ margin: 0, fontSize: 13, color: C.coffee, lineHeight: 1.5 }}>{svc.included_details}</p>
                    </div>
                  )}

                  {showColor && (
                    <div>
                      <Field label="Braiding hair color">
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
            {/* Calendar + notes + submit only after a service is picked
                (or in legacy free-form mode), so the landing reads
                cleanly as a menu. */}
            {(serviceId || !hasCatalog) && <>
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
            {submitError && (
              <p style={{ fontSize: 12, color: C.danger }}>{submitError}</p>
            )}
            <button type="submit" disabled={submitting}
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
                cursor: submitting ? "default" : "pointer",
                opacity: submitting ? 0.6 : 1,
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
        {!linkLoading && !linkError && !submitted && (
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
const selectStyle: React.CSSProperties = { ...inputStyle, appearance: "none" };

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

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label style={{ display: "block" }}>
    <span style={{ display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.coffee, marginBottom: 6 }}>{label}</span>
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
