"use client";

// Admin analytics dashboard at /admin/analytics.
//
// Fetches the aggregated summary from /api/admin/analytics (which
// itself authenticates the caller and re-checks admin allow-list in
// the SECURITY DEFINER RPC). Renders five sections matching the
// product spec: overview, activation funnel, feature usage, payment
// readiness, recent events, error log.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getSupabase } from "../../lib/supabase";
import {
  PreviewStyleCard,
  SectionEyebrow,
  StatusPill,
  MetricRow,
  MiniBarChart,
} from "../../components/PreviewUI";

const C = {
  cream: "#FFFFFF",
  paper: "#FFFFFF",
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

type Summary = {
  window_days: number;
  window_start: string;
  total_events: number;
  by_name: Record<string, number>;
  by_category: Record<string, number>;
  by_day: Array<{ day: string; n: number }>;
  recent: Array<{
    id: string;
    user_id: string | null;
    session_id: string | null;
    event_name: string;
    event_category: string | null;
    metadata: Record<string, unknown>;
    path: string | null;
    created_at: string;
  }>;
  errors: Array<{
    id: string;
    event_name: string;
    metadata: Record<string, unknown>;
    created_at: string;
  }>;
  stripe: {
    connected: number;
    charges_enabled: number;
    payouts_enabled: number;
  };
  totals: {
    unique_users: number;
    unique_sessions: number;
    // Added by migration 20260816000000. Optional so the dashboard
    // renders against an un-migrated database instead of blanking out.
    unique_visitors?: number;
    new_visitors?: number;
  };
  by_device?: Record<string, number>;
  by_referrer_type?: Record<string, number>;
  top_referrers?: Array<{ host: string; n: number }>;
  top_sources?: Array<{ source: string; n: number }>;
  top_pages?: Array<{ path: string; visitors: number; views: number }>;
};

// =====================================================================
// Animated counter — small, dependency-free
// =====================================================================
const useCounter = (target: number, duration = 700): number => {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined") { setV(target); return; }
    if (target === 0) { setV(0); return; }
    const start = performance.now();
    const from = 0;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setV(Math.round(from + (target - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return v;
};

// =====================================================================
// Skeleton primitive
// =====================================================================
const Skeleton = ({ h = 14, w = "100%", mt = 0 }: { h?: number; w?: number | string; mt?: number }) => (
  <div
    aria-hidden
    style={{
      height: h,
      width: w,
      marginTop: mt,
      background: "linear-gradient(90deg, rgba(21, 17, 26,0.06), rgba(21, 17, 26,0.12), rgba(21, 17, 26,0.06))",
      backgroundSize: "200% 100%",
      animation: "bbp-skel 1.4s ease-in-out infinite",
      borderRadius: 6,
    }}
  />
);

// =====================================================================
// Overview tiles
// =====================================================================
const OverviewTile = ({
  label, value, sub, accent = false,
}: { label: string; value: number; sub?: string; accent?: boolean }) => {
  const animated = useCounter(value);
  return (
    <PreviewStyleCard padding={16}>
      <SectionEyebrow tone="muted">{label}</SectionEyebrow>
      <p style={{
        margin: "4px 0 0",
        fontFamily: FONT_DISPLAY,
        fontSize: 28,
        fontWeight: 600,
        color: accent ? C.goldDeep : C.espresso,
        lineHeight: 1.05,
      }}>
        {animated.toLocaleString()}
      </p>
      {sub && (
        <p style={{ margin: "2px 0 0", fontSize: 11, color: C.muted }}>{sub}</p>
      )}
    </PreviewStyleCard>
  );
};

// =====================================================================
// Activation funnel — keys we expect from trackEvent call sites
// =====================================================================
const FUNNEL_STEPS: Array<{ name: string; label: string }> = [
  { name: "welcome_intro_view", label: "Welcome screen seen" },
  { name: "get_started_click", label: "Tapped Get Started" },
  { name: "account_created", label: "Account created" },
  { name: "first_client_added", label: "First client added" },
  { name: "first_service_added", label: "First service added" },
  { name: "first_quote_saved", label: "First quote saved" },
  { name: "first_appointment_created", label: "First appointment" },
  { name: "stripe_connect_started", label: "Stripe onboarding started" },
  { name: "stripe_connect_completed", label: "Stripe connected" },
  { name: "first_deposit_paid", label: "First deposit paid" },
];

const FUNNEL_MAX_BAR = 100;

const Funnel = ({ byName }: { byName: Record<string, number> }) => {
  const peak = Math.max(1, ...FUNNEL_STEPS.map((s) => byName[s.name] || 0));
  return (
    <PreviewStyleCard padding={18}>
      <SectionEyebrow>Activation funnel</SectionEyebrow>
      <p style={{ margin: "4px 0 14px", fontSize: 11, color: C.muted }}>
        Where users drop off between first visit and first deposit.
      </p>
      {FUNNEL_STEPS.map((s) => {
        const n = byName[s.name] || 0;
        const pct = peak > 0 ? Math.round((n / peak) * FUNNEL_MAX_BAR) : 0;
        return (
          <div key={s.name} style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.coffee, marginBottom: 4 }}>
              <span style={{ fontWeight: 600 }}>{s.label}</span>
              <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo", color: C.espresso }}>{n.toLocaleString()}</span>
            </div>
            <div style={{ height: 8, borderRadius: 99, background: C.hairlineSoft, overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${Math.max(2, pct)}%`,
                  background: `linear-gradient(90deg, ${C.gold} 0%, ${C.goldDeep} 100%)`,
                  borderRadius: 99,
                  transition: "width 600ms cubic-bezier(0.22, 0.61, 0.36, 1)",
                }}
              />
            </div>
          </div>
        );
      })}
    </PreviewStyleCard>
  );
};

// =====================================================================
// Feature usage table
// =====================================================================
const FEATURE_KEYS: Array<{ name: string; label: string }> = [
  { name: "pricing_calculator_open", label: "Pricing calculator opens" },
  { name: "quote_saved", label: "Quotes saved" },
  { name: "booking_link_share", label: "Booking link shares" },
  { name: "appointment_created", label: "Appointments created" },
  { name: "client_added", label: "Clients added" },
  { name: "service_added", label: "Services added" },
  { name: "money_tab_view", label: "Money tab views" },
  { name: "settings_view", label: "Settings views" },
  { name: "contracts_view", label: "Contracts views" },
  { name: "import_open", label: "Import opened" },
  { name: "import_success", label: "Import successes" },
  { name: "import_failure", label: "Import failures" },
];

const FeatureUsage = ({ byName }: { byName: Record<string, number> }) => (
  <PreviewStyleCard padding={18}>
    <SectionEyebrow>Feature usage</SectionEyebrow>
    <p style={{ margin: "4px 0 14px", fontSize: 11, color: C.muted }}>
      Counts of tracked feature events in the selected window.
    </p>
    {FEATURE_KEYS.map((f) => (
      <MetricRow key={f.name} label={f.label} value={(byName[f.name] || 0).toLocaleString()} />
    ))}
  </PreviewStyleCard>
);

// =====================================================================
// Payment readiness
// =====================================================================
const PaymentReadiness = ({
  stripe, byName,
}: {
  stripe: Summary["stripe"];
  byName: Record<string, number>;
}) => {
  const ready = stripe.connected > 0 && stripe.charges_enabled === stripe.connected;
  const tone = ready ? "success" : stripe.connected > 0 ? "gold" : "neutral";
  const label = stripe.connected === 0
    ? "No accounts yet"
    : ready
      ? "All connected accounts ready"
      : "Onboarding incomplete";
  return (
    <PreviewStyleCard padding={18}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <SectionEyebrow>Payment readiness</SectionEyebrow>
        <StatusPill tone={tone}>{label}</StatusPill>
      </div>
      <div style={{ marginTop: 10 }}>
        <MetricRow label="Stripe connected" value={stripe.connected.toLocaleString()} />
        <MetricRow label="Charges enabled" value={stripe.charges_enabled.toLocaleString()} accent />
        <MetricRow label="Payouts enabled" value={stripe.payouts_enabled.toLocaleString()} />
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.hairline}` }}>
          <MetricRow label="Onboarding started" value={(byName.stripe_connect_started || 0).toLocaleString()} />
          <MetricRow label="Deposits started" value={(byName.deposit_started || 0).toLocaleString()} />
          <MetricRow label="Deposits completed" value={(byName.deposit_completed || 0).toLocaleString()} accent />
          <MetricRow label="Failed deposit attempts" value={(byName.deposit_failed || 0).toLocaleString()} />
        </div>
      </div>
    </PreviewStyleCard>
  );
};

// =====================================================================
// Audience — who the visitors are and where they came from
// =====================================================================
const REFERRER_LABELS: Record<string, string> = {
  direct: "Direct / typed in",
  search: "Search engines",
  social: "Social",
  ai: "AI assistants",
  referral: "Other sites",
  internal: "Internal navigation",
  unknown: "Unknown",
};

const DEVICE_LABELS: Record<string, string> = {
  phone: "Phone",
  tablet: "Tablet",
  desktop: "Desktop",
  unknown: "Unknown",
};

const sortedEntries = (m: Record<string, number> | undefined): Array<[string, number]> =>
  Object.entries(m || {}).sort((a, b) => b[1] - a[1]);

const Audience = ({ data }: { data: Summary }) => {
  const devices = sortedEntries(data.by_device);
  const referrers = sortedEntries(data.by_referrer_type);
  const hosts = data.top_referrers || [];
  const sources = data.top_sources || [];
  const pages = data.top_pages || [];
  const anything =
    devices.length || referrers.length || hosts.length || sources.length || pages.length;

  return (
    <PreviewStyleCard padding={18}>
      <SectionEyebrow>Audience</SectionEyebrow>
      <p style={{ margin: "4px 0 12px", fontSize: 11, color: C.muted }}>
        Counted by unique visitor, not by event — one person refreshing a page ten times counts once.
      </p>
      {!anything ? (
        <p style={{ margin: 0, fontSize: 12, color: C.muted }}>
          No visitor context yet. Events recorded before the visitor-detail release
          don&apos;t carry it; new visits will populate this within minutes.
        </p>
      ) : (
        <>
          {devices.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 700, color: C.coffee }}>Devices</p>
              {devices.map(([k, n]) => (
                <MetricRow key={k} label={DEVICE_LABELS[k] || k} value={n.toLocaleString()} />
              ))}
            </div>
          )}
          {referrers.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 700, color: C.coffee }}>How they arrived</p>
              {referrers.map(([k, n]) => (
                <MetricRow
                  key={k}
                  label={REFERRER_LABELS[k] || k}
                  value={n.toLocaleString()}
                  accent={k === "ai"}
                />
              ))}
            </div>
          )}
          {hosts.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 700, color: C.coffee }}>Top referring sites</p>
              {hosts.map((r) => (
                <MetricRow key={r.host} label={r.host} value={r.n.toLocaleString()} />
              ))}
            </div>
          )}
          {sources.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 700, color: C.coffee }}>Campaign sources</p>
              {sources.map((r) => (
                <MetricRow key={r.source} label={r.source} value={r.n.toLocaleString()} />
              ))}
            </div>
          )}
          {pages.length > 0 && (
            <div>
              <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 700, color: C.coffee }}>Top pages</p>
              {pages.map((p) => (
                <MetricRow
                  key={p.path}
                  label={p.path}
                  value={`${p.visitors.toLocaleString()} · ${p.views.toLocaleString()} views`}
                />
              ))}
            </div>
          )}
        </>
      )}
    </PreviewStyleCard>
  );
};

// =====================================================================
// Recent events feed
// =====================================================================
const fmtTime = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

// Keys written by app/lib/analytics-context.ts (plus the owner id and
// the slug already shown elsewhere on the row). They render as the
// visitor line, so the detail line below shows only what's specific to
// the event — whatever the call site put in the payload.
const CONTEXT_KEYS = new Set([
  "visitor_id", "session_id", "is_new_visitor", "is_new_session",
  "device", "os", "browser", "installed_pwa", "viewport_w",
  "language", "timezone", "local_hour",
  "referrer_host", "referrer_type", "landing_path",
  "utm_source", "utm_medium", "utm_campaign",
  "owner_user_id", "slug",
]);

const asString = (m: Record<string, unknown>, k: string): string | null => {
  const v = m?.[k];
  return typeof v === "string" && v.trim() ? v : null;
};

/** Last 6 chars of an id — our ids end in the random half. */
const shortId = (v: string | null): string | null =>
  v ? v.slice(-6) : null;

const visitorLine = (e: Summary["recent"][number]): string => {
  const m = (e.metadata || {}) as Record<string, unknown>;
  const bits: string[] = [e.event_category || "uncategorized"];

  const visitor = shortId(asString(m, "visitor_id"));
  const session = shortId(asString(m, "session_id") || e.session_id);
  if (visitor) {
    // Returning vs first-seen matters more than the raw id: it's the
    // difference between one loyal client and ten new ones.
    bits.push(`visitor ${visitor}${m.is_new_visitor === true ? " (new)" : " (returning)"}`);
  } else if (session) {
    bits.push(`session ${session}`);
  } else if (e.user_id) {
    bits.push(`user ${e.user_id.slice(0, 6)}`);
  }

  const device = asString(m, "device");
  const browser = asString(m, "browser");
  if (device) bits.push(browser ? `${device} · ${browser}` : device);

  const host = asString(m, "referrer_host");
  const type = asString(m, "referrer_type");
  if (host) bits.push(`from ${host}`);
  else if (type && type !== "internal") bits.push(type === "direct" ? "direct" : `from ${type}`);

  const utm = asString(m, "utm_source");
  if (utm) bits.push(`?ref=${utm}`);

  return bits.join(" · ");
};

/** Everything the call site sent that isn't ambient visit context. */
const detailLine = (e: Summary["recent"][number]): string | null => {
  const m = (e.metadata || {}) as Record<string, unknown>;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(m)) {
    if (CONTEXT_KEYS.has(k)) continue;
    if (v === null || v === "" || typeof v === "object") continue;
    parts.push(`${k}: ${String(v).slice(0, 40)}`);
    if (parts.length === 4) break;
  }
  return parts.length ? parts.join(" · ") : null;
};

const RecentFeed = ({ recent }: { recent: Summary["recent"] }) => (
  <PreviewStyleCard padding={18}>
    <SectionEyebrow>Recent events</SectionEyebrow>
    <p style={{ margin: "4px 0 12px", fontSize: 11, color: C.muted }}>
      Last 100 events. Anonymous visitor and session IDs only — no PII.
    </p>
    {recent.length === 0 ? (
      <p style={{ margin: 0, fontSize: 12, color: C.muted }}>No events yet.</p>
    ) : (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {recent.slice(0, 40).map((e) => {
          const detail = detailLine(e);
          return (
            <div key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: C.espresso, lineHeight: 1.3 }}>
                  {e.event_name}
                </p>
                <p style={{ margin: "1px 0 0", fontSize: 10.5, color: C.muted, lineHeight: 1.4 }}>
                  {visitorLine(e)}
                </p>
                {detail && (
                  <p style={{
                    margin: "1px 0 0",
                    fontSize: 10.5,
                    color: C.coffee,
                    lineHeight: 1.4,
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo",
                    overflowWrap: "anywhere",
                  }}>
                    {detail}
                  </p>
                )}
                {e.path && (
                  <p style={{ margin: "1px 0 0", fontSize: 10, color: C.muted, lineHeight: 1.4 }}>{e.path}</p>
                )}
              </div>
              <span style={{ fontSize: 10.5, color: C.muted, whiteSpace: "nowrap" }}>{fmtTime(e.created_at)}</span>
            </div>
          );
        })}
      </div>
    )}
  </PreviewStyleCard>
);

// =====================================================================
// Error log
// =====================================================================
const ErrorLog = ({ errors }: { errors: Summary["errors"] }) => (
  <PreviewStyleCard padding={18}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <SectionEyebrow>Error log</SectionEyebrow>
      <StatusPill tone={errors.length === 0 ? "success" : "danger"}>
        {errors.length === 0 ? "All clear" : `${errors.length} recent`}
      </StatusPill>
    </div>
    <p style={{ margin: "4px 0 12px", fontSize: 11, color: C.muted }}>
      Events tagged with category=error in the selected window.
    </p>
    {errors.length === 0 ? (
      <p style={{ margin: 0, fontSize: 12, color: C.muted }}>No errors logged.</p>
    ) : (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {errors.slice(0, 20).map((e) => (
          <div key={e.id} style={{ padding: "8px 10px", borderRadius: 10, background: "rgba(156,61,46,0.06)", border: `1px solid rgba(156,61,46,0.18)` }}>
            <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: C.danger, lineHeight: 1.3 }}>
              {e.event_name}
            </p>
            <p style={{ margin: "2px 0 0", fontSize: 10.5, color: C.coffee, lineHeight: 1.4, fontFamily: "ui-monospace, SFMono-Regular, Menlo" }}>
              {JSON.stringify(e.metadata).slice(0, 160)}
            </p>
            <p style={{ margin: "2px 0 0", fontSize: 10, color: C.muted }}>{fmtTime(e.created_at)}</p>
          </div>
        ))}
      </div>
    )}
  </PreviewStyleCard>
);

// =====================================================================
// Page
// =====================================================================
export default function AdminAnalyticsPage() {
  const [data, setData] = useState<Summary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [windowDays, setWindowDays] = useState(30);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const supabase = getSupabase();
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) {
        setErr("Sign in required.");
        setLoading(false);
        return;
      }
      const res = await fetch(`/api/admin/analytics?window=${windowDays}`, {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(body?.error || `status_${res.status}`);
        setLoading(false);
        return;
      }
      setData(body.data as Summary);
      setLoading(false);
    } catch (e: any) {
      setErr(e?.message || "Couldn't load analytics.");
      setLoading(false);
    }
  }, [windowDays]);

  useEffect(() => { void load(); }, [load]);

  // Day series, padded to 30 buckets so the bar chart looks complete
  // even when traffic is sparse.
  const daySeries = useMemo((): number[] => {
    if (!data?.by_day) return [];
    const map = new Map<string, number>();
    for (const r of data.by_day) {
      const d = new Date(r.day);
      if (!Number.isNaN(d.getTime())) map.set(d.toISOString().slice(0, 10), r.n);
    }
    const out: number[] = [];
    const now = new Date();
    for (let i = windowDays - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      out.push(map.get(key) || 0);
    }
    return out;
  }, [data, windowDays]);

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
      <style>{`
        @keyframes bbp-skel {
          0%   { background-position: 100% 0; }
          100% { background-position: -100% 0; }
        }
      `}</style>

      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        {/* Back to app — pill button at the top so the admin can
            return to the main shell without using the browser back
            button (which doesn't exist in the installed PWA). */}
        <Link
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 14px",
            borderRadius: 99,
            background: "transparent",
            color: C.coffee,
            border: `1px solid ${C.hairline}`,
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: "0.04em",
            textDecoration: "none",
            marginBottom: 14,
          }}
        >
          ← Back to app
        </Link>

        <header style={{ marginBottom: 18 }}>
          <SectionEyebrow>Admin</SectionEyebrow>
          <h1 style={{ margin: "6px 0 4px", fontFamily: FONT_DISPLAY, fontSize: 34, fontWeight: 600, letterSpacing: "-0.01em" }}>
            Analytics
          </h1>
          <p style={{ margin: 0, fontSize: 13, color: C.muted }}>
            Pre-launch dashboard. Counts only — no client PII, no payment data.
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
                  appearance: "none",
                  borderRadius: 99,
                  padding: "8px 14px",
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  background: active ? C.espresso : "transparent",
                  color: active ? C.cream : C.coffee,
                  border: `1px solid ${active ? C.espresso : C.hairline}`,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
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
              appearance: "none",
              borderRadius: 99,
              padding: "8px 14px",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.04em",
              background: "transparent",
              color: C.goldDeep,
              border: `1px solid ${C.hairline}`,
              cursor: "pointer",
              whiteSpace: "nowrap",
              marginLeft: "auto",
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

        {/* Skeletons while loading */}
        {loading && !data && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {[0, 1, 2, 3].map((i) => (
                <PreviewStyleCard key={i} padding={16}>
                  <Skeleton h={10} w={70} />
                  <Skeleton h={26} w={120} mt={8} />
                </PreviewStyleCard>
              ))}
            </div>
            <PreviewStyleCard padding={18}>
              <Skeleton h={12} w={160} />
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} h={10} mt={12} />
              ))}
            </PreviewStyleCard>
          </div>
        )}

        {/* Real content */}
        {data && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Overview */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <OverviewTile label="Total events" value={data.total_events || 0} accent />
              <OverviewTile
                label="Unique visitors"
                value={data.totals.unique_visitors ?? data.totals.unique_sessions ?? 0}
                sub={
                  data.totals.new_visitors != null
                    ? `${data.totals.new_visitors.toLocaleString()} first-time`
                    : "Anonymous browsers"
                }
                accent
              />
              <OverviewTile label="Visits" value={data.totals.unique_sessions || 0} sub="30-min sessions" />
              <OverviewTile label="Signed-in users" value={data.totals.unique_users || 0} />
              <OverviewTile label="Stripe-ready accounts" value={data.stripe.charges_enabled || 0} />
            </div>

            {/* Daily activity */}
            <PreviewStyleCard padding={18}>
              <SectionEyebrow>Daily activity</SectionEyebrow>
              <p style={{ margin: "4px 0 12px", fontSize: 11, color: C.muted }}>
                Events per day over the last {windowDays} days.
              </p>
              <MiniBarChart data={daySeries} height={80} highlightIndex="last" ariaLabel={`Daily events for the last ${windowDays} days`} />
            </PreviewStyleCard>

            <Audience data={data} />
            <Funnel byName={data.by_name || {}} />
            <FeatureUsage byName={data.by_name || {}} />
            <PaymentReadiness stripe={data.stripe} byName={data.by_name || {}} />
            <RecentFeed recent={data.recent || []} />
            <ErrorLog errors={data.errors || []} />
          </div>
        )}
      </div>
    </div>
  );
}
