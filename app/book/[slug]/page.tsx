"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
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
import { collectPublicContext } from "../../lib/waitlist";

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
  espresso: "#2A1810", coffee: "#4A2C1A", caramel: "#8B5A2B",
  cream: "#FAF5EC", ivory: "#F5EBD9", paper: "#FFFBF2",
  gold: "#C9A961", goldDeep: "#A8893F",
  muted: "#8B7355", hairline: "rgba(74, 44, 26, 0.12)",
  success: "#5C7C4A", danger: "#9C3D2E",
};
const FONT_DISPLAY = `"Cormorant Garamond", Georgia, serif`;
const FONT_BODY = `"DM Sans", "Inter", system-ui, sans-serif`;

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
};

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://bjqazhplxqqhftekspfl.supabase.co";

const FUNCTIONS_URL = (() => {
  const host = SUPABASE_URL.replace("https://", "").replace(".supabase.co", "");
  return `https://${host}.functions.supabase.co`;
})();

export default function PublicBookingPage() {
  const params = useParams();
  const slug = useMemo(() => {
    const raw = params?.slug;
    return Array.isArray(raw) ? raw[0] : raw || "";
  }, [params]);

  const [link, setLink] = useState<LinkConfig | null>(null);
  const [linkLoading, setLinkLoading] = useState(true);
  const [linkError, setLinkError] = useState<string | null>(null);
  // Tap-to-expand lightbox for the stylist's photo gallery. Stores
  // the active index into the sorted gallery_photos array so prev /
  // next swipes stay in order.
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

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
    if (!slug) return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from("booking_links")
          .select("slug, user_id, business_name, intro, services, active, logo_url, location_text, phone, policies, accent_color, gallery_photos")
          .eq("slug", slug)
          .maybeSingle();
        if (cancelled) return;
        if (error || !data) {
          setLinkError("This booking link isn't available.");
        } else if (!data.active) {
          setLinkError("This booking link is currently paused.");
        } else {
          // Personalization fallback: if the booking_links row
          // doesn't carry a business_name, ask the RPC for the
          // best display name (settings → profiles → other links).
          // Keeps the public booking page personalized even when
          // the stylist never explicitly named this link.
          let displayName = (data as LinkConfig).business_name;
          if (!displayName || !String(displayName).trim()) {
            try {
              const { data: studio } = await supabase
                .rpc("public_get_studio_name", { user_id_in: (data as any).user_id });
              if (typeof studio === "string" && studio.trim()) {
                displayName = studio.trim();
              }
            } catch { /* leave as null; UI falls back to "Braid Boss Pro" */ }
          }
          setLink({ ...(data as LinkConfig), business_name: displayName });
        }
      } catch {
        if (!cancelled) setLinkError("Couldn't load this booking link.");
      } finally {
        if (!cancelled) setLinkLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitError(null);
    if (!name.trim()) { setSubmitError("Please enter your name."); return; }
    if (!phone.trim() && !email.trim()) { setSubmitError("Phone or email is required."); return; }
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

  return (
    <div style={{ minHeight: "100dvh", background: C.cream, fontFamily: FONT_BODY, color: C.espresso }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=DM+Sans:wght@400;500;600;700&display=swap');
        * { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
        body { margin: 0; }
        input, textarea, select, button { font-family: inherit; }
      `}</style>
      <div
        className="mx-auto"
        style={{
          maxWidth: 480,
          padding: "32px 20px",
          // Generous bottom padding so the last button clears the
          // sticky CTA bar and the iPhone Safari home indicator.
          paddingBottom: "calc(120px + env(safe-area-inset-bottom, 0px))",
        }}
      >
        {/* Logo — rendered only when the stylist set logo_url. Uses
            a plain <img> so any public CDN URL works without
            configuring next/image domains. */}
        {link?.logo_url && (
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={link.logo_url}
              alt={link.business_name || "Studio logo"}
              style={{
                maxHeight: 96,
                maxWidth: 200,
                objectFit: "contain",
                borderRadius: 16,
              }}
            />
          </div>
        )}
        <p style={{ textAlign: "center", letterSpacing: "0.22em", textTransform: "uppercase", fontSize: 10, fontWeight: 700, color: accent }}>
          Book your appointment
        </p>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 36, fontWeight: 600, color: C.espresso, textAlign: "center", lineHeight: 1.1, marginTop: 8 }}>
          {link?.business_name || "Braid Boss Pro"}
        </h1>
        {/* Contact pills row — location + phone surface as small
            chips beneath the headline. Phone is tappable (tel: on
            mobile). */}
        {(link?.location_text || link?.phone) && (
          <div style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            {link?.location_text && (
              <span style={{ fontSize: 11, color: C.coffee, padding: "4px 10px", borderRadius: 99, background: C.cream, border: `1px solid ${C.hairline}` }}>
                {link.location_text}
              </span>
            )}
            {link?.phone && (
              <a href={`tel:${link.phone.replace(/\s/g, "")}`} style={{ fontSize: 11, color: C.coffee, padding: "4px 10px", borderRadius: 99, background: C.cream, border: `1px solid ${C.hairline}`, textDecoration: "none" }}>
                {link.phone}
              </a>
            )}
          </div>
        )}
        {link?.intro && (
          <p style={{ textAlign: "center", color: C.muted, marginTop: 10, fontSize: 14 }}>
            {link.intro}
          </p>
        )}
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
                background: "transparent",
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
            {hasCatalog ? (
              <>
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
                <Field label="Service">
                  <select
                    value={serviceId}
                    onChange={e => {
                      const id = e.target.value;
                      setServiceId(id);
                      setSelectedVariationId(""); // reset picker on service change
                      const svc = catalog.find(s => s.id === id);
                      // Keep serviceName in sync as the human-readable
                      // label submitted to the booking-request edge
                      // function (which still expects serviceName).
                      setServiceName(svc?.name || "");
                      // Phase B1 view tracking — anon allow-listed.
                      if (id && link?.user_id && svc) {
                        void emitAnalyticsEvent({
                          ownerUserId: link.user_id,
                          type: "public_service_viewed" as any,
                          source: "public",
                          payload: { slug, serviceId: id, serviceName: svc.name },
                        });
                      }
                    }}
                    style={selectStyle}
                  >
                    <option value="">— Pick a service —</option>
                    {filteredCatalog.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.name} · {s.duration_hours}h · ${s.base_price}
                      </option>
                    ))}
                  </select>
                </Field>
                {/* When the service has no variations, render a plain
                    summary card. When variations exist we hand off to
                    the unified picker below (base + every saved
                    variation as selectable options). */}
                {selectedCatalogService && !hasVariations && (
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 12,
                      background: C.paper,
                      border: `1px solid ${C.hairline}`,
                      fontSize: 12,
                      color: C.coffee,
                      lineHeight: 1.5,
                    }}
                  >
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
                )}
                {/* Parent-service header card. Sits above the variation
                    picker so the description belongs to the SERVICE,
                    not to any one option. Title → base price/duration →
                    description → prep instructions, in that order. */}
                {selectedCatalogService && hasVariations && (
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 12,
                      background: C.paper,
                      border: `1px solid ${C.hairline}`,
                      fontSize: 12,
                      color: C.coffee,
                      lineHeight: 1.5,
                    }}
                  >
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
                    resolved: ReturnType<typeof resolveVariationPricing>;
                  }> = [
                    {
                      id: "",
                      label: selectedCatalogService.name,
                      subLabel: "Standard",
                      resolved: baseResolved,
                    },
                    ...variations.map(v => ({
                      id: v.id,
                      label: (v.name || "").trim() || "Variation",
                      subLabel: null,
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
                {!slotsLoading && !slotsError && hasFetchedSlots && slots.length === 0 && (
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
                      No openings on this date.
                    </p>
                    <p style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>
                      Pick another day — or join the waitlist and we&apos;ll text you when something opens.
                    </p>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
                      <button
                        type="button"
                        onClick={() => { setPreferredDate(""); setPreferredTime(""); }}
                        style={ghostButtonStyle}
                      >
                        Choose another date
                      </button>
                      <button
                        type="button"
                        onClick={() => setWaitlistOpen(true)}
                        style={primaryButtonStyle}
                      >
                        Join the waitlist
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
              style={{
                marginTop: 6,
                padding: "14px 18px",
                borderRadius: 12,
                background: accent,
                color: C.espresso,
                border: `1.5px solid ${C.goldDeep}`,
                fontWeight: 700,
                fontSize: 15,
                letterSpacing: "0.02em",
                cursor: submitting ? "default" : "pointer",
                opacity: submitting ? 0.6 : 1,
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
          </form>
        )}

        {/* Waitlist alternate flow */}
        {!linkLoading && !linkError && !submitted && (
          <div style={{ marginTop: 24, padding: 16, borderRadius: 16, background: C.paper, border: `1px solid ${C.hairline}` }}>
            {!waitlistOpen && !waitlistDone && (
              <button
                type="button"
                onClick={() => setWaitlistOpen(true)}
                style={{
                  width: "100%", padding: "12px 14px", borderRadius: 12,
                  background: "transparent", color: C.coffee,
                  border: `1px solid ${C.hairline}`,
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
      </div>

      {/* Tap-to-expand lightbox. Self-contained — no portal needed
          because this page is its own scope with no parent
          transform / overflow that would trap fixed positioning. */}
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
        <Legend swatch={C.gold} label="Open" />
        <Legend swatch="#E5D4A0" label="Limited" />
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
    bg = "rgba(201, 169, 97, 0.18)";
    border = `1px solid rgba(201, 169, 97, 0.35)`;
  } else if (status === "limited") {
    bg = "rgba(229, 212, 160, 0.35)";
    border = `1px solid rgba(229, 212, 160, 0.55)`;
  } else if (status === "booked") {
    bg = C.cream;
    fg = C.muted;
  } else if (status === "off") {
    bg = "transparent";
    fg = "rgba(74, 44, 26, 0.35)";
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
