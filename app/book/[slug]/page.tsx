"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { getSupabase } from "../../lib/supabase";
import { submitPublicWaitlistRequest, type WaitlistFlexibility, WAITLIST_FLEX_LABEL } from "../../lib/waitlist";
import { emitAnalyticsEvent } from "../../lib/analytics-events";
import {
  fetchPublicServices,
  fetchPublicAvailability,
  fetchPublicMonthAvailability,
  type PublicService,
  type PublicSlot,
  type MonthDay,
  type MonthDayStatus,
} from "../../lib/services";
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
  // Phase B1 — real services catalog from public_list_services RPC.
  // Falls back to legacy link.services if the RPC errors / is empty
  // so existing booking links keep working during the rollout.
  const [catalog, setCatalog] = useState<PublicService[]>([]);
  const [serviceId, setServiceId] = useState<string>("");
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
          .select("slug, user_id, business_name, intro, services, active, logo_url, location_text, phone, policies, accent_color")
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

  // Catalog wins; fall back to legacy free-form list if the RPC
  // returns nothing (older booking links that haven't migrated).
  const legacyServices = Array.isArray(link?.services) ? link!.services! : [];
  const hasCatalog = catalog.length > 0;
  const services = hasCatalog ? catalog : legacyServices;
  const selectedCatalogService = hasCatalog
    ? catalog.find(s => s.id === serviceId) || null
    : null;

  // Phase B7 — derived duration. When a catalog service is picked we
  // use its real duration; otherwise default to 60 minutes so the
  // calendar still surfaces meaningful slot counts.
  const activeServiceId = selectedCatalogService?.id ?? null;
  const activeServiceDurationHours = selectedCatalogService?.duration_hours ?? 0;
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

      // Phase B12 — generate booking contracts attached to this
      // service (or any template flagged attach_to_all_bookings).
      // Idempotent server-side; safe if no templates apply or if the
      // legacy edge-function path created the request (newRequestId
      // will be null in that case and we just skip).
      if (newRequestId) {
        try {
          await supabase.rpc("generate_booking_contracts", {
            booking_request_id_in: newRequestId,
          });
        } catch {
          // Don't block submission if contract generation hiccups —
          // the stylist can still resend signing links from Approvals.
        }

        // Phase B12.1a — enqueue notifications via the universal
        // queue. The public booking page runs as anon, which can't
        // call queue_notification directly (security: would let
        // anyone spam emails). Instead we call the SECURITY DEFINER
        // wrapper enqueue_public_booking_emails, scoped to the
        // request id we just submitted; it looks up the row server-
        // side and enqueues the right rows. Failures are
        // best-effort and never block the submit.
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
                <Field label="Service">
                  <select
                    value={serviceId}
                    onChange={e => {
                      const id = e.target.value;
                      setServiceId(id);
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
                    {catalog.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.name} · {s.duration_hours}h · ${s.base_price}
                      </option>
                    ))}
                  </select>
                </Field>
                {selectedCatalogService && (
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
                    {selectedCatalogService.duration_hours}h · ${selectedCatalogService.base_price.toFixed(2)}
                    {selectedCatalogService.deposit_required && selectedCatalogService.deposit_amount
                      ? ` · ${`$${selectedCatalogService.deposit_amount.toFixed(2)} deposit required`}`
                      : ""}
                    {selectedCatalogService.prep_instructions && (
                      <p style={{ marginTop: 8, color: C.muted, fontSize: 11 }}>
                        {selectedCatalogService.prep_instructions}
                      </p>
                    )}
                  </div>
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
                : selectedCatalogService?.deposit_required && (selectedCatalogService.deposit_amount || 0) > 0
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
