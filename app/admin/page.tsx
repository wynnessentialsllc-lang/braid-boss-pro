"use client";

// Admin command center at /admin — the platform owner's home base.
//
// Surfaces the *business* KPIs from the product strategy: the North Star
// (deposited booking revenue per active braider), money moving through the
// platform, subscriptions/MRR, the activation funnel, and live demand.
// Data comes from /api/admin/command-center, which authenticates the caller
// and re-checks the single-owner allow-list inside the SECURITY DEFINER RPC.
//
// The deeper event-stream analytics live at /admin/analytics; this page
// links there rather than duplicating it.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getSupabase } from "../lib/supabase";
import { smsLiabilityUsd } from "../lib/sms-packs";
import {
  PreviewStyleCard,
  SectionEyebrow,
  StatusPill,
  MetricRow,
  MiniBarChart,
} from "../components/PreviewUI";

const C = {
  cream: "#FFFFFF",
  espresso: "#15111A",
  coffee: "#3D3447",
  gold: "#7C3AED",
  goldDeep: "#5B21B6",
  muted: "#6F6477",
  hairline: "rgba(21, 17, 26, 0.12)",
  hairlineSoft: "rgba(21, 17, 26, 0.06)",
  success: "#5C7C4A",
  danger: "#9C3D2E",
} as const;

const FONT_DISPLAY = "'Cormorant Garamond', 'Playfair Display', Georgia, serif";
const FONT_BODY = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

type Snapshot = {
  generated_at: string;
  window_days: number;
  window_start: string;
  north_star: {
    deposited_revenue: number;
    deposit_count: number;
    active_braiders: number;
    per_braider: number;
  };
  revenue: {
    booked_value: number;
    deposits_collected: number;
    deposits_at_booking: number;
    retail_gmv: number;
    retail_orders: number;
    platform_fee: number;
    sms_revenue: number;
    sms_credits_sold: number;
    sms_credits_outstanding: number;
    sms_accounts_holding_credits: number;
    booking_fee_revenue: number;
    booking_fee_charges: number;
  };
  subscriptions: {
    total_braiders: number;
    active: number;
    trialing: number;
    past_due: number;
    canceled: number;
    lifetime: number;
    founding: number;
    new_in_window: number;
    mrr_estimate: number;
    by_status: Record<string, number>;
  };
  bookings: {
    requests_total: number;
    requests_deposited: number;
    requests_pending: number;
    ai_quote_requests: number;
    no_show_fee_charges: number;
    appointments_total: number;
    appointments_completed: number;
    appointments_no_show: number;
    appointments_cancelled: number;
    public_booking_share: number;
  };
  activation: {
    accounts: number;
    stripe_connected: number;
    charges_enabled: number;
    took_booking: number;
    took_deposit: number;
  };
  stripe: { connected: number; charges_enabled: number; payouts_enabled: number };
  trend: {
    deposits_by_day: Array<{ day: string; amount: number }>;
    bookings_by_day: Array<{ day: string; n: number }>;
  };
  pending_approval: Array<{
    id: string;
    email: string | null;
    business_name: string | null;
    full_name: string | null;
    stripe_connect_account_id: string | null;
    stripe_connect_status: string | null;
    stripe_connect_charges_enabled: boolean;
    created_at: string;
  }>;
};

const usd = (n: number): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n >= 1000 ? 0 : 2,
  }).format(Number.isFinite(n) ? n : 0);

const num = (n: number): string => (Number.isFinite(n) ? n : 0).toLocaleString();

// ---- Skeleton primitive ------------------------------------------------
const Skeleton = ({ h = 14, w = "100%", mt = 0 }: { h?: number; w?: number | string; mt?: number }) => (
  <div
    aria-hidden
    style={{
      height: h, width: w, marginTop: mt,
      background: "linear-gradient(90deg, rgba(21,17,26,0.06), rgba(21,17,26,0.12), rgba(21,17,26,0.06))",
      backgroundSize: "200% 100%",
      animation: "bbp-skel 1.4s ease-in-out infinite",
      borderRadius: 6,
    }}
  />
);

// ---- Money tile --------------------------------------------------------
const Tile = ({ label, value, sub, accent = false }: { label: string; value: string; sub?: string; accent?: boolean }) => (
  <div style={{ minWidth: 0 }}>
    <PreviewStyleCard padding={16}>
      <SectionEyebrow tone="muted">{label}</SectionEyebrow>
      <p style={{ margin: "4px 0 0", fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 600, color: accent ? C.goldDeep : C.espresso, lineHeight: 1.05, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {value}
      </p>
      {sub && <p style={{ margin: "2px 0 0", fontSize: 11, color: C.muted }}>{sub}</p>}
    </PreviewStyleCard>
  </div>
);

export default function AdminCommandCenter() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [windowDays, setWindowDays] = useState(30);
  const [reviewing, setReviewing] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const supabase = getSupabase();
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) { setErr("Sign in required."); setLoading(false); return; }
      const res = await fetch(`/api/admin/command-center?window=${windowDays}`, {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(body?.error || `status_${res.status}`); setLoading(false); return; }
      setData(body.data as Snapshot);
      setLoading(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't load the command center.");
      setLoading(false);
    }
  }, [windowDays]);

  useEffect(() => { void load(); }, [load]);

  // Approve or reject a stylist pending manual review. Optimistically
  // drops the row from the local list so the queue feels responsive,
  // then reloads to pick up any other change (e.g. their charges_
  // enabled flipping in the meantime).
  const reviewStylist = useCallback(async (userId: string, approved: boolean) => {
    setReviewing((prev) => ({ ...prev, [userId]: true }));
    try {
      const supabase = getSupabase();
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) { setErr("Sign in required."); return; }
      const res = await fetch("/api/admin/approve-stylist", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ user_id: userId, approved }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(body?.error || `status_${res.status}`); return; }
      setData((prev) =>
        prev
          ? { ...prev, pending_approval: prev.pending_approval.filter((s) => s.id !== userId) }
          : prev,
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't update that stylist.");
    } finally {
      setReviewing((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
    }
  }, []);

  // Deposit-revenue series padded to one bucket per day in the window.
  // Carries the day alongside each value so the chart can label its
  // axis and per-bar tooltips instead of showing anonymous bars.
  const depositSeries = useMemo((): { values: number[]; days: Date[] } => {
    if (!data?.trend?.deposits_by_day) return { values: [], days: [] };
    const map = new Map<string, number>();
    for (const r of data.trend.deposits_by_day) {
      const d = new Date(r.day);
      if (!Number.isNaN(d.getTime())) map.set(d.toISOString().slice(0, 10), r.amount);
    }
    const values: number[] = [];
    const days: Date[] = [];
    const now = new Date();
    for (let i = windowDays - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      values.push(map.get(d.toISOString().slice(0, 10)) || 0);
      days.push(d);
    }
    return { values, days };
  }, [data, windowDays]);

  // "Jul 11"-style day label for chart axis captions and tooltips.
  const fmtDay = (d: Date): string =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const ns = data?.north_star;
  const rev = data?.revenue;
  const subs = data?.subscriptions;
  const bk = data?.bookings;
  const act = data?.activation;

  // Activation funnel steps (all-time account progress).
  const funnel = act
    ? [
        { label: "Accounts created", n: act.accounts },
        { label: "Stripe connected", n: act.stripe_connected },
        { label: "Charges enabled", n: act.charges_enabled },
        { label: "Took a booking", n: act.took_booking },
        { label: "First deposit paid", n: act.took_deposit },
      ]
    : [];
  const funnelPeak = Math.max(1, ...funnel.map((s) => s.n));

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: C.cream,
        color: C.espresso,
        fontFamily: FONT_BODY,
        paddingTop: "max(20px, env(safe-area-inset-top))",
        paddingBottom: "max(40px, calc(env(safe-area-inset-bottom) + 24px))",
        paddingLeft: 18,
        paddingRight: 18,
      }}
    >
      <style>{`@keyframes bbp-skel {0%{background-position:100% 0;}100%{background-position:-100% 0;}}`}</style>

      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <Link
          href="/"
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "8px 14px", borderRadius: 99, background: "transparent",
            color: C.coffee, border: `1px solid ${C.hairline}`,
            fontSize: 12, fontWeight: 600, letterSpacing: "0.04em",
            textDecoration: "none", marginBottom: 14,
          }}
        >
          ← Back to app
        </Link>

        <header style={{ marginBottom: 18 }}>
          <SectionEyebrow>Admin · owner only</SectionEyebrow>
          <h1 style={{ margin: "6px 0 4px", fontFamily: FONT_DISPLAY, fontSize: 34, fontWeight: 600, letterSpacing: "-0.01em" }}>
            Command Center
          </h1>
          <p style={{ margin: 0, fontSize: 13, color: C.muted }}>
            The business at a glance — money, braiders, activation, and demand.
          </p>
        </header>

        {/* Window selector */}
        <div style={{ display: "flex", gap: 8, marginBottom: 14, overflowX: "auto" }}>
          {[7, 30, 90].map((d) => {
            const active = d === windowDays;
            return (
              <button
                key={d}
                type="button"
                onClick={() => setWindowDays(d)}
                style={{
                  appearance: "none", borderRadius: 99, padding: "8px 14px",
                  fontSize: 12, fontWeight: 600, letterSpacing: "0.04em",
                  background: active ? C.espresso : "transparent",
                  color: active ? C.cream : C.coffee,
                  border: `1px solid ${active ? C.espresso : C.hairline}`,
                  cursor: "pointer", whiteSpace: "nowrap",
                }}
              >
                Last {d}d
              </button>
            );
          })}
          <button
            type="button"
            onClick={load}
            style={{
              appearance: "none", borderRadius: 99, padding: "8px 14px",
              fontSize: 12, fontWeight: 600, letterSpacing: "0.04em",
              background: "transparent", color: C.goldDeep,
              border: `1px solid ${C.hairline}`, cursor: "pointer",
              whiteSpace: "nowrap", marginLeft: "auto",
            }}
          >
            Refresh
          </button>
        </div>

        {err && (
          <PreviewStyleCard padding={14} style={{ marginBottom: 14, borderColor: C.danger }}>
            <p style={{ margin: 0, fontSize: 12.5, color: C.danger }}>{err}</p>
          </PreviewStyleCard>
        )}

        {loading && !data && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <PreviewStyleCard padding={20}>
              <Skeleton h={10} w={120} />
              <Skeleton h={40} w={220} mt={12} />
              <Skeleton h={10} w={180} mt={12} />
            </PreviewStyleCard>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
              {[0, 1, 2].map((i) => (
                <PreviewStyleCard key={i} padding={16}>
                  <Skeleton h={10} w={60} />
                  <Skeleton h={24} w={90} mt={8} />
                </PreviewStyleCard>
              ))}
            </div>
          </div>
        )}

        {data && ns && rev && subs && bk && act && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* ---- North Star hero ---- */}
            <PreviewStyleCard tone="highlight" padding={22}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <SectionEyebrow>North Star · per active braider</SectionEyebrow>
                <StatusPill tone="gold">{windowDays}-day</StatusPill>
              </div>
              <p style={{ margin: "8px 0 0", fontFamily: FONT_DISPLAY, fontSize: 46, fontWeight: 600, color: C.goldDeep, lineHeight: 1 }}>
                {usd(ns.per_braider)}
              </p>
              <p style={{ margin: "6px 0 0", fontSize: 12.5, color: C.coffee }}>
                Deposited booking revenue per active braider. {usd(ns.deposited_revenue)} collected
                across {num(ns.deposit_count)} {ns.deposit_count === 1 ? "deposit" : "deposits"} from{" "}
                {num(ns.active_braiders)} active {ns.active_braiders === 1 ? "braider" : "braiders"}.
              </p>
              <div style={{ marginTop: 14 }}>
                <MiniBarChart
                  data={depositSeries.values}
                  height={64}
                  highlightIndex="last"
                  labels={depositSeries.days.map(fmtDay)}
                  valueFormat={usd}
                  startLabel={depositSeries.days.length ? fmtDay(depositSeries.days[0]) : undefined}
                  endLabel="Today"
                  ariaLabel={`Deposit revenue per day, last ${windowDays} days`}
                />
              </div>
            </PreviewStyleCard>

            {/* ---- Money moving through the platform ---- */}
            {/* auto-fit + minmax(0,…) lets the tiles reflow (3→2→1 columns)
                instead of overflowing the viewport on narrow phones. */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
              <Tile label="Booked value" value={usd(rev.booked_value)} sub="appointments made" accent />
              <Tile label="Deposits collected" value={usd(rev.deposits_collected)} sub="online booking flow" />
              <Tile label="Retail GMV" value={usd(rev.retail_gmv)} sub={`${num(rev.retail_orders)} orders`} />
            </div>

            <PreviewStyleCard padding={18}>
              <SectionEyebrow>Platform revenue</SectionEyebrow>
              <p style={{ margin: "4px 0 12px", fontSize: 11, color: C.muted }}>
                What Braid Boss Pro earns and processes in the window.
              </p>
              <MetricRow label="MRR (est. at $14.99 / active sub)" value={usd(subs.mrr_estimate)} accent emphasis="strong" />
              <MetricRow label="Storefront platform fee" value={usd(rev.platform_fee)} />
              <MetricRow
                label="Booking fees charged"
                value={`${usd(rev.booking_fee_revenue)} · ${num(rev.booking_fee_charges)}`}
              />
              <MetricRow label="SMS credit revenue" value={usd(rev.sms_revenue)} />
              <MetricRow label="SMS credits sold" value={num(rev.sms_credits_sold)} />
              {/* Prepaid credits are collected up front and delivered
                  later, so revenue alone overstates the position. This
                  is what is still owed in sending. */}
              <MetricRow
                label="Unredeemed credits (owed)"
                value={`${num(rev.sms_credits_outstanding)} · ${usd(smsLiabilityUsd(rev.sms_credits_outstanding))}`}
              />
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.hairline}` }}>
                <MetricRow label="Deposits taken at booking" value={usd(rev.deposits_at_booking)} />
                <MetricRow label="No-show fees charged" value={num(bk.no_show_fee_charges)} />
              </div>
            </PreviewStyleCard>

            {/* ---- Subscriptions / braiders ---- */}
            <PreviewStyleCard padding={18}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <SectionEyebrow>Braiders &amp; subscriptions</SectionEyebrow>
                <StatusPill tone="neutral">{num(subs.total_braiders)} total</StatusPill>
              </div>
              <div style={{ marginTop: 10 }}>
                <MetricRow label="Active subscriptions" value={num(subs.active)} accent emphasis="strong" />
                <MetricRow label="Trialing" value={num(subs.trialing)} />
                <MetricRow label="Past due" value={num(subs.past_due)} />
                <MetricRow label="Canceled" value={num(subs.canceled)} />
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.hairline}` }}>
                  <MetricRow label="Lifetime access" value={num(subs.lifetime)} />
                  <MetricRow label="Founding members" value={num(subs.founding)} />
                  <MetricRow label={`New braiders (last ${windowDays}d)`} value={num(subs.new_in_window)} accent />
                </div>
              </div>
            </PreviewStyleCard>

            {/* ---- Activation funnel ---- */}
            <PreviewStyleCard padding={18}>
              <SectionEyebrow>Activation funnel</SectionEyebrow>
              <p style={{ margin: "4px 0 14px", fontSize: 11, color: C.muted }}>
                All-time account progress toward first deposited booking.
              </p>
              {funnel.map((s) => {
                const pct = Math.round((s.n / funnelPeak) * 100);
                return (
                  <div key={s.label} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.coffee, marginBottom: 4 }}>
                      <span style={{ fontWeight: 600 }}>{s.label}</span>
                      <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo", color: C.espresso }}>{num(s.n)}</span>
                    </div>
                    <div style={{ height: 8, borderRadius: 99, background: C.hairlineSoft, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${Math.max(2, pct)}%`, background: `linear-gradient(90deg, ${C.gold} 0%, ${C.goldDeep} 100%)`, borderRadius: 99, transition: "width 600ms cubic-bezier(0.22,0.61,0.36,1)" }} />
                    </div>
                  </div>
                );
              })}
            </PreviewStyleCard>

            {/* ---- Demand ---- */}
            <PreviewStyleCard padding={18}>
              <SectionEyebrow>Demand &amp; bookings</SectionEyebrow>
              <p style={{ margin: "4px 0 12px", fontSize: 11, color: C.muted }}>
                Booking requests and appointments in the window.
              </p>
              <MetricRow label="Booking requests" value={num(bk.requests_total)} accent />
              <MetricRow label="· with deposit paid" value={num(bk.requests_deposited)} />
              <MetricRow label="· pending approval" value={num(bk.requests_pending)} />
              <MetricRow label="Build Your Style quotes (AI)" value={num(bk.ai_quote_requests)} accent emphasis="strong" />
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.hairline}` }}>
                <MetricRow label="Appointments created" value={num(bk.appointments_total)} />
                <MetricRow label="· completed" value={num(bk.appointments_completed)} />
                <MetricRow label="· no-show" value={num(bk.appointments_no_show)} />
                <MetricRow label="· cancelled" value={num(bk.appointments_cancelled)} />
                <MetricRow label="· booked via public page" value={num(bk.public_booking_share)} />
              </div>
            </PreviewStyleCard>

            {/* ---- Pending stylist approvals ---- */}
            {data.pending_approval.length > 0 && (
              <PreviewStyleCard padding={18} style={{ borderColor: C.danger }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <SectionEyebrow tone="muted">Pending stylist approval</SectionEyebrow>
                  <StatusPill tone="danger">{data.pending_approval.length} waiting</StatusPill>
                </div>
                <p style={{ margin: "4px 0 12px", fontSize: 11, color: C.muted }}>
                  Connected Stripe but not yet cleared to take real charges. Nothing on
                  their storefront can charge a card until you approve.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {data.pending_approval.map((s) => {
                    const busy = !!reviewing[s.id];
                    return (
                      <div
                        key={s.id}
                        style={{
                          display: "flex", justifyContent: "space-between", alignItems: "center",
                          gap: 10, padding: "10px 0", borderTop: `1px solid ${C.hairlineSoft}`,
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: C.espresso, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {s.business_name || s.full_name || s.email || s.id}
                          </p>
                          <p style={{ margin: "2px 0 0", fontSize: 11, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {s.email || "no email on file"} · {s.stripe_connect_status || "onboarding"}
                            {s.stripe_connect_charges_enabled ? " · charges enabled" : ""} ·{" "}
                            {new Date(s.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => reviewStylist(s.id, true)}
                            style={{
                              appearance: "none", borderRadius: 99, padding: "6px 12px",
                              fontSize: 11.5, fontWeight: 600, letterSpacing: "0.02em",
                              background: C.success, color: "#fff", border: "none",
                              cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
                            }}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => reviewStylist(s.id, false)}
                            style={{
                              appearance: "none", borderRadius: 99, padding: "6px 12px",
                              fontSize: 11.5, fontWeight: 600, letterSpacing: "0.02em",
                              background: "transparent", color: C.danger,
                              border: `1px solid ${C.danger}`,
                              cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
                            }}
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </PreviewStyleCard>
            )}

            {/* ---- Stripe readiness ---- */}
            <PreviewStyleCard padding={18}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <SectionEyebrow>Payment readiness</SectionEyebrow>
                <StatusPill tone={data.stripe.connected > 0 && data.stripe.charges_enabled === data.stripe.connected ? "success" : data.stripe.connected > 0 ? "gold" : "neutral"}>
                  {data.stripe.connected === 0 ? "No accounts" : data.stripe.charges_enabled === data.stripe.connected ? "All ready" : "Onboarding"}
                </StatusPill>
              </div>
              <div style={{ marginTop: 10 }}>
                <MetricRow label="Stripe connected" value={num(data.stripe.connected)} />
                <MetricRow label="Charges enabled" value={num(data.stripe.charges_enabled)} accent />
                <MetricRow label="Payouts enabled" value={num(data.stripe.payouts_enabled)} />
              </div>
            </PreviewStyleCard>

            {/* ---- Deep-dive link ---- */}
            <Link href="/admin/analytics" style={{ textDecoration: "none" }}>
              <PreviewStyleCard padding={16} style={{ cursor: "pointer" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <div>
                    <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: C.espresso }}>Event analytics →</p>
                    <p style={{ margin: "2px 0 0", fontSize: 11.5, color: C.muted }}>Activation events, feature usage, recent feed &amp; error log.</p>
                  </div>
                  <StatusPill tone="gold">Deep dive</StatusPill>
                </div>
              </PreviewStyleCard>
            </Link>

            <p style={{ margin: "2px 0 0", fontSize: 10.5, color: C.muted, textAlign: "center" }}>
              Generated {new Date(data.generated_at).toLocaleString()} · visible to the platform owner only.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
