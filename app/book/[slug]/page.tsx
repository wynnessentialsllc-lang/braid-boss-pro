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
  // Phase B3 — month heatmap. visibleMonth tracks the month the
  // calendar is showing; monthCache memoises results per
  // (year, month, serviceId) so paging back to a recently-viewed
  // month doesn't re-hit the RPC.
  const today = new Date();
  const [visibleYear, setVisibleYear] = useState<number>(today.getFullYear());
  const [visibleMonth, setVisibleMonth] = useState<number>(today.getMonth() + 1);
  const [monthDays, setMonthDays] = useState<MonthDay[]>([]);
  const [monthLoading, setMonthLoading] = useState(false);
  const monthCacheRef = useRef<Map<string, MonthDay[]>>(new Map());

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
          .select("slug, user_id, business_name, intro, services, active")
          .eq("slug", slug)
          .maybeSingle();
        if (cancelled) return;
        if (error || !data) {
          setLinkError("This booking link isn't available.");
        } else if (!data.active) {
          setLinkError("This booking link is currently paused.");
        } else {
          setLink(data as LinkConfig);
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

  // Phase B3 — pull the per-day status for the visible month
  // whenever service, slug, or visible-month changes. Cached per
  // (year, month, serviceId) so paging back doesn't re-hit the RPC.
  useEffect(() => {
    if (!hasCatalog || !selectedCatalogService || !slug) return;
    const cacheKey = `${visibleYear}-${visibleMonth}-${selectedCatalogService.id}`;
    const cached = monthCacheRef.current.get(cacheKey);
    if (cached) { setMonthDays(cached); return; }
    let cancelled = false;
    setMonthLoading(true);
    (async () => {
      const result = await fetchPublicMonthAvailability({
        slug,
        year: visibleYear,
        month: visibleMonth,
        serviceId: selectedCatalogService.id,
        durationMinutes: Math.round((selectedCatalogService.duration_hours || 0) * 60),
      });
      if (cancelled) return;
      setMonthLoading(false);
      if (!result.ok) return;
      monthCacheRef.current.set(cacheKey, result.days);
      setMonthDays(result.days);
      if (link?.user_id) {
        void emitAnalyticsEvent({
          ownerUserId: link.user_id,
          type: "availability_loaded" as any,
          source: "public",
          payload: {
            slug,
            serviceId: selectedCatalogService.id,
            year: visibleYear,
            month: visibleMonth,
            availableDays: result.days.filter(d => d.status === "available" || d.status === "limited").length,
          },
        });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, hasCatalog, selectedCatalogService?.id, visibleYear, visibleMonth]);

  // Build a quick lookup: dayIso → MonthDay so the calendar grid
  // renders without scanning the array per cell.
  const monthByDate = useMemo(() => {
    const m = new Map<string, MonthDay>();
    for (const d of monthDays) m.set(d.dayIso, d);
    return m;
  }, [monthDays]);

  // Next available date for friction-reduction copy + auto-suggest.
  const nextAvailableDay = useMemo(() => {
    return monthDays.find(d => d.status === "available" || d.status === "limited") || null;
  }, [monthDays]);

  // Re-fetch slots whenever the user picks a different service or
  // date. Only runs when both a service AND a date are chosen on a
  // catalog-aware salon — legacy free-text links keep the manual
  // preferred-time input.
  useEffect(() => {
    if (!hasCatalog || !selectedCatalogService || !preferredDate) {
      setSlots([]);
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
        serviceId: selectedCatalogService.id,
        durationMinutes: Math.round((selectedCatalogService.duration_hours || 0) * 60),
        // Phase B3 — leave slotIntervalMinutes undefined so the RPC
        // falls back to the owner's availability_sensitivity setting.
      });
      if (cancelled) return;
      setSlotsLoading(false);
      if (!result.ok) { setSlotsError(result.error); return; }
      setSlots(result.slots);
      setHasFetchedSlots(true);
      // If the previously-chosen slot is no longer in the list,
      // clear it so the user picks a fresh one.
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
            serviceId: selectedCatalogService.id,
            date: preferredDate,
            slotCount: result.slots.length,
          },
        });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasCatalog, selectedCatalogService?.id, preferredDate, slug]);

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
      const ctx = collectPublicContext();
      const supabase = getSupabase();
      const { data: rpcId, error: rpcErr } = await supabase.rpc(
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
      if (!rpcErr && rpcId) {
        submittedOk = true;
      } else {
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
        <p style={{ textAlign: "center", letterSpacing: "0.22em", textTransform: "uppercase", fontSize: 10, fontWeight: 700, color: C.gold }}>
          Book your appointment
        </p>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 36, fontWeight: 600, color: C.espresso, textAlign: "center", lineHeight: 1.1, marginTop: 8 }}>
          {link?.business_name || "Braid Boss Pro"}
        </h1>
        {link?.intro && (
          <p style={{ textAlign: "center", color: C.muted, marginTop: 8, fontSize: 14 }}>
            {link.intro}
          </p>
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
            {hasCatalog ? (
              <>
                {/* Availability summary — surfaces the next opening
                    so a hesitant client always has a one-tap path. */}
                {selectedCatalogService && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: 12,
                      borderRadius: 14,
                      background: `linear-gradient(135deg, ${C.espresso}, ${C.coffee})`,
                      color: C.cream,
                      border: `1px solid ${C.goldDeep}`,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: C.gold }}>
                        Next opening
                      </p>
                      <p style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600, lineHeight: 1.1, marginTop: 4 }}>
                        {nextAvailableDay
                          ? new Date(nextAvailableDay.dayIso + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })
                          : monthLoading ? "Checking…" : "No openings this month"}
                      </p>
                    </div>
                    {nextAvailableDay && (
                      <button
                        type="button"
                        onClick={() => {
                          setPreferredDate(nextAvailableDay.dayIso);
                          setPreferredTime("");
                          if (link?.user_id) {
                            void emitAnalyticsEvent({
                              ownerUserId: link.user_id,
                              type: "next_available_clicked" as any,
                              source: "public",
                              payload: { slug, date: nextAvailableDay.dayIso },
                            });
                          }
                        }}
                        style={{
                          padding: "10px 14px",
                          borderRadius: 10,
                          background: `linear-gradient(180deg, ${C.gold}, ${C.goldDeep})`,
                          color: C.paper,
                          border: `1px solid ${C.goldDeep}`,
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: "pointer",
                          flexShrink: 0,
                        }}
                      >
                        Pick this day
                      </button>
                    )}
                  </div>
                )}

                {/* Heatmap calendar */}
                {selectedCatalogService && (
                  <BookingHeatmap
                    year={visibleYear}
                    month={visibleMonth}
                    monthByDate={monthByDate}
                    selected={preferredDate}
                    loading={monthLoading}
                    onPrevMonth={() => {
                      const m = visibleMonth - 1;
                      if (m < 1) { setVisibleMonth(12); setVisibleYear(visibleYear - 1); }
                      else setVisibleMonth(m);
                    }}
                    onNextMonth={() => {
                      const m = visibleMonth + 1;
                      if (m > 12) { setVisibleMonth(1); setVisibleYear(visibleYear + 1); }
                      else setVisibleMonth(m);
                    }}
                    onPickDay={(iso, status) => {
                      if (status === "off") return;
                      setPreferredDate(iso);
                      setPreferredTime("");
                      if (link?.user_id) {
                        void emitAnalyticsEvent({
                          ownerUserId: link.user_id,
                          type: "calendar_day_selected" as any,
                          source: "public",
                          payload: { slug, date: iso, status },
                        });
                      }
                    }}
                  />
                )}
                {selectedCatalogService && preferredDate && (
                  <div>
                    <span
                      style={{
                        display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase",
                        letterSpacing: "0.08em", color: C.coffee, marginBottom: 6,
                      }}
                    >
                      Available times
                    </span>
                    {slotsLoading && (
                      <p style={{ fontSize: 12, color: C.muted, padding: "12px 0" }}>
                        Checking availability…
                      </p>
                    )}
                    {!slotsLoading && slotsError && (
                      <p style={{ fontSize: 12, color: C.danger }}>{slotsError}</p>
                    )}
                    {!slotsLoading && !slotsError && hasFetchedSlots && slots.length === 0 && (
                      <div
                        style={{
                          padding: 14,
                          borderRadius: 12,
                          background: C.paper,
                          border: `1px solid ${C.hairline}`,
                          textAlign: "center",
                        }}
                      >
                        <p style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600, color: C.espresso }}>
                          No openings available for this date.
                        </p>
                        <p style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>
                          Pick another date — or join the waitlist below and we&apos;ll text you when something opens.
                        </p>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
                          <button
                            type="button"
                            onClick={() => { setPreferredDate(""); setPreferredTime(""); }}
                            style={{
                              padding: "10px", borderRadius: 10,
                              background: "transparent", color: C.coffee,
                              border: `1px solid ${C.hairline}`,
                              fontSize: 12, fontWeight: 600, cursor: "pointer",
                            }}
                          >
                            Choose another date
                          </button>
                          <button
                            type="button"
                            onClick={() => setWaitlistOpen(true)}
                            style={{
                              padding: "10px", borderRadius: 10,
                              background: `linear-gradient(180deg, ${C.gold}, ${C.goldDeep})`,
                              color: C.paper,
                              border: `1px solid ${C.goldDeep}`,
                              fontSize: 12, fontWeight: 700, cursor: "pointer",
                            }}
                          >
                            Join the waitlist
                          </button>
                        </div>
                      </div>
                    )}
                    {!slotsLoading && !slotsError && slots.length > 0 && (
                      <SlotRecommendations
                        slots={slots}
                        selected={preferredTime}
                        onPick={t => {
                          setPreferredTime(t);
                          if (link?.user_id) {
                            void emitAnalyticsEvent({
                              ownerUserId: link.user_id,
                              type: "slot_selected" as any,
                              source: "public",
                              payload: { slug, serviceId: selectedCatalogService?.id || null, date: preferredDate, time: t },
                            });
                          }
                        }}
                      />
                    )}
                    {!slotsLoading && !slotsError && slots.length > 0 && (
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))",
                          gap: 8,
                          marginTop: 12,
                        }}
                      >
                        {slots.map(s => {
                          const on = preferredTime === s.time;
                          return (
                            <button
                              type="button"
                              key={s.time}
                              onClick={() => {
                                setPreferredTime(s.time);
                                if (link?.user_id) {
                                  void emitAnalyticsEvent({
                                    ownerUserId: link.user_id,
                                    type: "slot_selected" as any,
                                    source: "public",
                                    payload: { slug, serviceId: selectedCatalogService?.id || null, date: preferredDate, time: s.time },
                                  });
                                }
                              }}
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
                {selectedCatalogService && !preferredDate && (
                  <p style={{ fontSize: 12, color: C.muted }}>
                    Pick a date to see available times.
                  </p>
                )}
                {!selectedCatalogService && (
                  <p style={{ fontSize: 12, color: C.muted }}>
                    Pick a service first to see open times.
                  </p>
                )}
              </>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="Preferred date">
                  <Input type="date" value={preferredDate} onChange={e => setPreferredDate(e.target.value)} />
                </Field>
                <Field label="Preferred time">
                  <Input type="time" value={preferredTime} onChange={e => setPreferredTime(e.target.value)} />
                </Field>
              </div>
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
                background: C.gold,
                color: C.espresso,
                border: `1.5px solid ${C.goldDeep}`,
                fontWeight: 700,
                fontSize: 15,
                letterSpacing: "0.02em",
                cursor: submitting ? "default" : "pointer",
                opacity: submitting ? 0.6 : 1,
              }}>
              {submitting ? "Sending…" : "Request appointment"}
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

// ---- Smart slot recommendations (Phase B3) ----------------------------
//
// Surfaces five chips above the slot grid so the client can land on
// a sensible slot without reading the whole list:
//   Best       earliest available (lowest fragmentation by design)
//   Morning    first slot ≤ 12:00
//   Afternoon  first slot 12:00..17:00
//   Evening    first slot ≥ 17:00
//
// Pure derivation from the slots[] already loaded — no new fetch.
const SlotRecommendations = ({
  slots, selected, onPick,
}: {
  slots: PublicSlot[];
  selected: string;
  onPick: (time: string) => void;
}) => {
  if (slots.length === 0) return null;
  const morning   = slots.find(s => s.startMinute <  12 * 60);
  const afternoon = slots.find(s => s.startMinute >= 12 * 60 && s.startMinute < 17 * 60);
  const evening   = slots.find(s => s.startMinute >= 17 * 60);
  const best      = slots[0];
  const recs: Array<{ key: string; label: string; slot: PublicSlot | undefined }> = [
    { key: "best",      label: "Best",      slot: best },
    { key: "morning",   label: "Morning",   slot: morning },
    { key: "afternoon", label: "Afternoon", slot: afternoon },
    { key: "evening",   label: "Evening",   slot: evening },
  ];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 4 }}>
      {recs.map(r => {
        if (!r.slot) return null;
        const on = selected === r.slot.time;
        return (
          <button
            type="button"
            key={r.key}
            onClick={() => onPick(r.slot!.time)}
            style={{
              padding: "6px 10px",
              borderRadius: 999,
              background: on ? C.espresso : C.ivory,
              color: on ? C.cream : C.coffee,
              border: `1px solid ${on ? C.espresso : C.hairline}`,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.04em",
              cursor: "pointer",
            }}
          >
            {r.label} · {r.slot.label}
          </button>
        );
      })}
    </div>
  );
};


// ---- Booking heatmap (Phase B3) --------------------------------------
//
// 6×7 grid coloured by per-day status. monthByDate is a lookup
// produced by the parent so each cell renders in O(1). Days outside
// the visible month render with low opacity. Off / past-date cells
// are non-tappable.
const HEATMAP_TONES: Record<MonthDayStatus, { bg: string; fg: string; border: string; label: string }> = {
  available: { bg: "rgba(201, 169, 97, 0.42)", fg: "#2A1810", border: "#A8893F", label: "Open" },
  limited:   { bg: "rgba(201, 118, 43, 0.32)", fg: "#4A2C1A", border: "#C9762B", label: "Limited" },
  booked:    { bg: "rgba(139, 115, 85, 0.20)", fg: "#8B7355", border: "rgba(139, 115, 85, 0.45)", label: "Booked" },
  off:       { bg: "rgba(74, 44, 26, 0.06)",   fg: "#B8A586", border: "rgba(74, 44, 26, 0.10)", label: "Off" },
};

const BookingHeatmap = ({
  year, month, monthByDate, selected, loading,
  onPrevMonth, onNextMonth, onPickDay,
}: {
  year: number;
  month: number;
  monthByDate: Map<string, MonthDay>;
  selected: string;
  loading: boolean;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onPickDay: (iso: string, status: MonthDayStatus) => void;
}) => {
  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString("en-US", {
    month: "long", year: "numeric",
  });
  const firstOfMonth = new Date(year, month - 1, 1);
  const startWeekday = firstOfMonth.getDay(); // 0=Sun
  const todayIso = new Date().toISOString().slice(0, 10);

  // Touch swipe — small horizontal threshold so vertical scroll wins
  // unambiguously. Same UX as the internal Schedule strip.
  const swipeStart = useRef<{ x: number; y: number } | null>(null);

  // 42 cells = 6 weeks; covers any month layout. Cells outside the
  // visible month are filled but non-tappable.
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(year, month - 1, 1 - startWeekday + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { date: d, iso, day: d.getDate(), inMonth: d.getMonth() === month - 1 };
  });

  return (
    <div
      onTouchStart={e => { const t = e.touches[0]; swipeStart.current = { x: t.clientX, y: t.clientY }; }}
      onTouchEnd={e => {
        const start = swipeStart.current;
        swipeStart.current = null;
        if (!start) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        if (Math.abs(dx) < 40 || Math.abs(dy) > Math.abs(dx)) return;
        if (dx < 0) onNextMonth(); else onPrevMonth();
      }}
      style={{
        background: C.paper,
        border: `1px solid ${C.hairline}`,
        borderRadius: 16,
        padding: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <button
          type="button"
          onClick={onPrevMonth}
          style={{
            width: 32, height: 32, borderRadius: 999,
            background: "transparent", color: C.coffee, border: `1px solid ${C.hairline}`,
            fontSize: 18, lineHeight: 1, cursor: "pointer",
          }}
        >
          ‹
        </button>
        <p style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600, color: C.espresso }}>
          {monthLabel}
        </p>
        <button
          type="button"
          onClick={onNextMonth}
          style={{
            width: 32, height: 32, borderRadius: 999,
            background: "transparent", color: C.coffee, border: `1px solid ${C.hairline}`,
            fontSize: 18, lineHeight: 1, cursor: "pointer",
          }}
        >
          ›
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4 }}>
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <span
            key={`${d}-${i}`}
            style={{
              fontSize: 9, fontWeight: 700, textAlign: "center",
              letterSpacing: "0.14em", color: C.muted, padding: "4px 0",
            }}
          >
            {d}
          </span>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {cells.map(c => {
          const md = monthByDate.get(c.iso);
          const status: MonthDayStatus = md ? md.status : "off";
          const tone = HEATMAP_TONES[status];
          const isPast = c.iso < todayIso;
          const isOff = status === "off" || isPast;
          const isSelected = c.iso === selected;
          const inMonthOpacity = c.inMonth ? 1 : 0.32;
          return (
            <button
              type="button"
              key={c.iso}
              onClick={() => { if (!isOff) onPickDay(c.iso, status); }}
              disabled={isOff}
              aria-label={`${c.iso} ${tone.label}`}
              style={{
                position: "relative",
                minHeight: 44,
                padding: 4,
                borderRadius: 10,
                background: isSelected
                  ? `linear-gradient(180deg, ${C.gold}, ${C.goldDeep})`
                  : tone.bg,
                color: isSelected ? C.paper : tone.fg,
                border: `1px solid ${isSelected ? C.goldDeep : tone.border}`,
                fontSize: 13,
                fontWeight: 600,
                cursor: isOff ? "default" : "pointer",
                opacity: inMonthOpacity,
                transition: "transform 0.12s ease, opacity 0.12s ease",
              }}
            >
              <span style={{ fontFamily: FONT_DISPLAY }}>{c.day}</span>
              {md && md.slotCount > 0 && c.inMonth && (
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    bottom: 4, left: "50%", transform: "translateX(-50%)",
                    width: 4, height: 4, borderRadius: 999,
                    background: isSelected ? C.cream : C.goldDeep,
                  }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Legend + loading shimmer */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10, fontSize: 10, color: C.muted }}>
        {(["available", "limited", "booked", "off"] as MonthDayStatus[]).map(k => (
          <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span
              aria-hidden
              style={{
                width: 10, height: 10, borderRadius: 3,
                background: HEATMAP_TONES[k].bg,
                border: `1px solid ${HEATMAP_TONES[k].border}`,
              }}
            />
            {HEATMAP_TONES[k].label}
          </span>
        ))}
        {loading && (
          <span style={{ marginLeft: "auto", fontStyle: "italic" }}>Updating…</span>
        )}
      </div>
    </div>
  );
};
