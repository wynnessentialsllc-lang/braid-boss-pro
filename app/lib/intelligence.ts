// Booking Intelligence — read-only fetch + types for Phase B4.
//
// Aggregations live entirely in the SQL `get_booking_intelligence`
// RPC so the dashboard does one round-trip and the client never
// touches RLS-protected raw rows beyond what it already has loaded.

import { useEffect, useState } from "react";
import { getSupabase } from "./supabase";

export type FunnelData = {
  page_views: number;
  service_views: number;
  slot_views: number;
  booking_requests: number;
  approved_bookings: number;
  waitlist_joined: number;
  waitlist_converted: number;
};

export type TopService = {
  service_id: string;
  service_name: string;
  views: number;
  requests: number;
  approvals: number;
  revenue: number;
  conversion_pct: number | null;
};

export type AvailabilityPressure = {
  by_weekday: { dow: number; count: number }[];
  busiest_weekday: number | null;
  busiest_weekday_count: number | null;
  busiest_hour: number | null;
  busiest_hour_count: number | null;
};

export type WaitlistIntelligence = {
  active: number;
  total_in_window: number;
  converted: number;
  conversion_pct: number | null;
  top_services: { service_name: string; n: number }[];
  top_dates: { preferred_date: string; n: number }[];
};

export type ClientSource = {
  source: string;
  bookings: number;
  revenue: number;
};

export type CalendarDemandPoint = {
  day: string;     // "YYYY-MM-DD"
  bookings: number;
  revenue: number;
};

export type RevenueOpportunity = {
  unmet_demand: number;
  avg_ticket: number;
  estimated_lost_revenue: number;
};

export type ApprovalsIntelligence = {
  approvals_sent: number;
  approvals_confirmed: number;
  approvals_expired: number;
  approvals_declined: number;
  awaiting_review: number;
  awaiting_deposit: number;
  deposit_conversion_pct: number | null;
  lost_deposit_value: number;
};

export type BookingIntelligence = {
  window: { start: string; end: string };
  funnel: FunnelData;
  top_services: TopService[];
  availability_pressure: AvailabilityPressure;
  waitlist: WaitlistIntelligence;
  client_sources: ClientSource[];
  calendar_demand: CalendarDemandPoint[];
  revenue_opportunity: RevenueOpportunity;
  approvals?: ApprovalsIntelligence;
};

// ---- Smart insights (rules) -------------------------------------------
// Pure derivations from a BookingIntelligence payload. No AI calls,
// no fake numbers — every line is grounded in a concrete metric.
export type SmartInsight = {
  id: string;
  title: string;
  body?: string;
  tone: "neutral" | "gold" | "success" | "warning";
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const fmtHour = (h: number): string => {
  const period = h >= 12 ? "PM" : "AM";
  const hh = ((h + 11) % 12) + 1;
  return `${hh} ${period}`;
};

export const generateSmartInsights = (b: BookingIntelligence | null): SmartInsight[] => {
  if (!b) return [];
  const out: SmartInsight[] = [];

  // Busiest weekday
  if (b.availability_pressure.busiest_weekday !== null && (b.availability_pressure.busiest_weekday_count || 0) >= 2) {
    out.push({
      id: "busiest_weekday",
      title: `${WEEKDAYS[b.availability_pressure.busiest_weekday]}s are your highest-demand day.`,
      body: `${b.availability_pressure.busiest_weekday_count} bookings landed on that weekday in the window.`,
      tone: "gold",
    });
  }

  // Busiest hour
  if (b.availability_pressure.busiest_hour !== null && (b.availability_pressure.busiest_hour_count || 0) >= 2) {
    out.push({
      id: "busiest_hour",
      title: `${fmtHour(b.availability_pressure.busiest_hour)} slots fill fastest.`,
      body: `${b.availability_pressure.busiest_hour_count} bookings opened the chair at ${fmtHour(b.availability_pressure.busiest_hour)} in the window.`,
      tone: "neutral",
    });
  }

  // Top conversion service
  const topConvert = b.top_services
    .filter(s => s.conversion_pct !== null && s.views >= 10)
    .sort((a, b) => (b.conversion_pct! - a.conversion_pct!))[0];
  if (topConvert) {
    out.push({
      id: "top_convert",
      title: `${topConvert.service_name} converts ${topConvert.conversion_pct?.toFixed(0)}% of viewers into bookings.`,
      body: `${topConvert.approvals} bookings from ${topConvert.views} views.`,
      tone: "success",
    });
  }

  // Top revenue source
  const topSource = (b.client_sources || []).sort((a, b) => b.bookings - a.bookings)[0];
  if (topSource && topSource.bookings >= 3) {
    out.push({
      id: "top_source",
      title: `${humaniseSource(topSource.source)} is bringing in your strongest traffic.`,
      body: `${topSource.bookings} bookings · $${topSource.revenue.toFixed(0)} in the window.`,
      tone: "gold",
    });
  }

  // Waitlist pressure
  if (b.waitlist.active >= 3) {
    out.push({
      id: "waitlist_pressure",
      title: `${b.waitlist.active} clients are actively waiting for an opening.`,
      body: "Reach out today — every contact lands you a likely booking.",
      tone: "warning",
    });
  }

  // Approval queue pressure
  if (b.approvals && b.approvals.awaiting_review >= 3) {
    out.push({
      id: "awaiting_review",
      title: `${b.approvals.awaiting_review} requests are awaiting your approval.`,
      body: "Tap into the approval queue to keep momentum — clients are most likely to pay the deposit while the request is fresh.",
      tone: "warning",
    });
  }

  // Deposit drop-off
  if (b.approvals && b.approvals.approvals_sent >= 5 && b.approvals.deposit_conversion_pct !== null && b.approvals.deposit_conversion_pct < 50) {
    out.push({
      id: "deposit_dropoff",
      title: `Only ${b.approvals.deposit_conversion_pct.toFixed(0)}% of approvals turn into paid deposits.`,
      body: `${b.approvals.approvals_expired} holds expired without payment. Consider lowering the deposit or shortening the wait between approval and link.`,
      tone: "warning",
    });
  }

  // Funnel drop-off
  const f = b.funnel;
  if (f.service_views > 20 && f.booking_requests / Math.max(1, f.service_views) < 0.1) {
    out.push({
      id: "funnel_dropoff",
      title: "Service views aren't converting to requests.",
      body: `${f.service_views} viewed services, only ${f.booking_requests} requests. Consider lowering deposit or adding more open slots.`,
      tone: "warning",
    });
  }

  return out;
};

export const humaniseSource = (raw: string): string => {
  const map: Record<string, string> = {
    instagram: "Instagram",
    tiktok: "TikTok",
    google: "Google",
    direct_link: "Direct link",
    returning_client: "Returning clients",
    waitlist: "Waitlist",
    referral: "Referral",
    other: "Other",
  };
  if (map[raw]) return map[raw];
  return raw.charAt(0).toUpperCase() + raw.slice(1);
};

// ---- Hook -------------------------------------------------------------

export const useBookingIntelligence = (
  userId: string | null,
  windowDays: number = 30,
): {
  data: BookingIntelligence | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} => {
  const [data, setData] = useState<BookingIntelligence | null>(null);
  const [loading, setLoading] = useState<boolean>(!!userId);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (!userId) { setData(null); return; }
    setLoading(true);
    setError(null);
    const supabase = getSupabase();
    const end = new Date();
    const start = new Date(end);
    start.setDate(end.getDate() - windowDays);
    const { data: row, error: err } = await supabase.rpc("get_booking_intelligence", {
      start_in: start.toISOString().slice(0, 10),
      end_in: end.toISOString().slice(0, 10),
    });
    if (err) { setError(err.message); setLoading(false); return; }
    if ((row as any)?.error) { setError((row as any).error); setLoading(false); return; }
    setData(row as BookingIntelligence);
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => { if (!cancelled) await refresh(); })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, windowDays]);

  return { data, loading, error, refresh };
};
