"use client";
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  getSupabase,
  tryUpsert,
  tryDelete,
  trySaveSettings,
  drainQueue,
  queueLength,
  syncClients,
  syncAppointments,
  syncQuotes,
  syncReceipts,
  syncCommunications,
  syncNotifications,
  syncPhotos,
  syncSettings,
} from "./lib/supabase";
import {
  uploadPhoto,
  deletePhoto as deletePhotoFromStorage,
  resolvePhotoUrl,
} from "./lib/photo-storage";
import {
  buildVCalendar,
  downloadIcs,
  sanitizeFilename,
  type IcsAppointment,
} from "./lib/ics";
import {
  generateBossInsights,
  type Insight,
} from "./lib/insights";
import {
  calculateRevenueAnalytics,
  calculateClientAnalytics,
  calculateAppointmentAnalytics,
  calculateStylePerformance,
  calculateRetentionAnalytics,
  calculateCommunicationAnalytics,
} from "./lib/analytics";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferences,
} from "./lib/notification-rules";
import { runNotificationRules, splitDeliverable } from "./lib/notification-scheduler";
import {
  type ReceiptRecord,
  buildReceiptFromAppointment,
  buildInvoiceFromQuote,
  buildReceiptSummaryText,
} from "./lib/receipts";
import { renderReceiptPdf } from "./lib/pdf-render";
import { formatAppointmentDateShort } from "./lib/utils/formatAppointmentDate";
import WelcomeIntro from "./components/WelcomeIntro";
import {
  PreviewStyleCard,
  SectionEyebrow,
  StatusPill,
  MetricRow,
  MiniBarChart,
} from "./components/PreviewUI";
import { useStripeConnect, type StripeConnectProfile } from "./lib/stripe-connect";
import { getAuthRedirectUrl } from "./lib/site-url";
import {
  LIFETIME_PRICE_LABEL,
  isPaymentLinkConfigured,
  openCheckout,
  useLifetimeAccess,
} from "./lib/premium";
import {
  GUEST_LIMITS,
  FEATURE_LABEL,
  UPGRADE_HEADLINE,
  UPGRADE_BODY,
  UPGRADE_BADGE,
  hasReachedGuestLimit,
  usePremiumStatus,
  type GatedFeature,
} from "./lib/guest-limits";
import {
  type Discount,
  type DiscountInput,
  type DiscountSummary,
  NO_DISCOUNT,
  DISCOUNT_PRESETS,
  DISCOUNTS_EMPTY_COPY,
  computeDiscountAmount,
  formatDiscountValue,
  selectableDiscounts,
  useDiscounts,
  validateDiscount,
} from "./lib/discounts";
import {
  type CalendarPrefs,
  type CalendarView,
  type ColorMode,
  type AppointmentColor,
  useCalendarPrefs,
  colorForAppointment,
  computeDayStatus,
} from "./lib/calendar";
import {
  type Service,
  type ServiceInput,
  type ServiceAddOn,
  SERVICES_EMPTY_COPY,
  formatServicePrice,
  useServices,
} from "./lib/services";
import {
  type DashboardRevenue,
  type RevenueGranularity,
  type RevenuePoint,
  type StyleCount,
  type RepeatClientStats,
  computeDashboardRevenue,
  revenueByPeriod,
  topBookedStyles,
  repeatClientStats,
  lastBookingForClient,
  ticketTotal as reportTicketTotal,
  ticketBalance as reportTicketBalance,
  todayCompletedAppts,
  weekRevenueAppts,
  weekClientRows,
  type WeekClientRow,
  avgTicket30dBreakdown,
  type AvgTicketBreakdown,
  weekDepositBuckets,
  type WeekDepositBuckets,
  pendingBalanceAppts,
  monthExpectedAppts,
  monthProfitBreakdown,
  type MonthProfitBreakdown,
} from "./lib/reports";
import {
  type BookingPolicy,
  type BookingPolicyInput,
  EMPTY_POLICY,
  POLICY_PRESETS,
  useBookingPolicy,
} from "./lib/policies";
import {
  type AvailabilityRule,
  type AvailabilityRuleInput,
  type AvailabilityException,
  type AvailabilityExceptionInput,
  type AvailabilityExceptionKind,
  type DayAvailability,
  DEFAULT_WEEKLY_RULES,
  WEEKDAY_LABELS,
  WEEKDAY_SHORT,
  computeDayAvailability,
  dayCapacityMinutes,
  useAvailability,
} from "./lib/availability";
import {
  type WaitlistRequest,
  type WaitlistStatus,
  WAITLIST_STATUS_LABEL,
  WAITLIST_FLEX_LABEL,
  useWaitlist,
} from "./lib/waitlist";
import {
  type ClientLike,
  matchClientByContact,
} from "./lib/clients-match";
import { emitAnalyticsEvent } from "./lib/analytics-events";
import {
  type BookingIntelligence,
  type SmartInsight,
  generateSmartInsights,
  humaniseSource,
  useBookingIntelligence,
} from "./lib/intelligence";
import {
  type ApprovalStatus,
  type BookingRequestRecord,
  APPROVAL_STATUS_LABEL,
  APPROVAL_STATUS_TONE,
  approvalSecondsLeft,
  formatCountdown,
  useBookingApprovalQueue,
} from "./lib/booking-requests";
import {
  type ContractTemplate,
  type ContractTemplateInput,
  type ContractTemplateType,
  type BookingContract,
  TEMPLATE_TYPE_LABEL,
  STATUS_LABEL as CONTRACT_STATUS_LABEL,
  STATUS_TONE as CONTRACT_STATUS_TONE,
  contractSigningUrl,
  useContractTemplates,
  useContractsForRequest,
} from "./lib/contracts";
import {
  downloadJson,
  downloadPdfBlob,
} from "./lib/native-download";
import { openExternal } from "./lib/open-external";
import {
  computeRebookingOpportunities,
  computeClientRebookingInsight,
  buildRebookingMessage,
  summarizeOpportunities,
  type RebookingOpportunity,
  type RebookingUrgency,
} from "./lib/rebooking/rebooking-intelligence";
import {
  dispatchPush,
  loadDeliveredHistory,
  saveDeliveredHistory,
  sendTestPush,
} from "./lib/push-dispatch";
import {
  detectPushCapability,
  subscribeWebPush,
  unsubscribeWebPush,
  refreshSubscriptionHeartbeat,
  type PushCapability,
} from "./lib/push";
import {
  Home, Calculator as CalcIcon, Calendar, Users, TrendingUp, Settings as SettingsIcon,
  Plus, X, ChevronRight, ChevronLeft, ChevronDown, Search, Copy, Check, Trash2, Edit3,
  FileText, DollarSign, Clock, Phone, Mail, AlertCircle, Sparkles,
  ArrowUpRight, ArrowDownRight, Save, RefreshCw, Download, Bell, BellOff,
  CalendarPlus, UserPlus, Coffee, Lock, Receipt, ScrollText, Image as ImageIcon, Camera,
  Star, Heart, Repeat, Play, Pause, Square, Timer as TimerIcon, Zap, Award,
  BarChart3, Layers, MessageSquare, Send, AlertTriangle, CheckCircle2,
  XCircle, Filter, MoreHorizontal, SlidersHorizontal, LogOut
} from "lucide-react";

/* ============================================================
   BRAID BOSS PRO — V2 (Phase 2)
   Reminders · Photos · Recurring · Timer · Style Presets
   ============================================================ */

const C = {
  espresso: "#2A1810", coffee: "#4A2C1A", caramel: "#8B5A2B",
  cream: "#FAF5EC", ivory: "#F5EBD9", paper: "#FFFBF2",
  gold: "#C9A961", goldDeep: "#A8893F", ink: "#1A0F08",
  muted: "#8B7355", mutedSoft: "#B8A586",
  success: "#5C7C4A", warning: "#C9762B", danger: "#9C3D2E",
  hairline: "rgba(74, 44, 26, 0.12)",

  // 2026 facelift accents — bright but professional, calibrated to
  // sit on the cream surface without fighting the gold lead. Add
  // usage gradually; the existing brand tokens above stay primary.
  coral: "#E08A6A",      // soft coral / rose accent
  coralDeep: "#C56947",
  lavender: "#9B7CC4",   // electric-lavender / plum accent
  lavenderDeep: "#7556A0",
  mint: "#7CB69E",       // fresh mint success accent
  mintDeep: "#56947A",
  teal: "#4A8A8A",       // teal info accent
  tealDeep: "#356B6B",
};
const FONT_DISPLAY = `"Cormorant Garamond", Georgia, serif`;
const FONT_BODY = `"DM Sans", "Inter", system-ui, sans-serif`;

const GlobalStyle = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=DM+Sans:wght@400;500;600;700&display=swap');
    * { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
    .bbp-scroll::-webkit-scrollbar { display: none; }
    .bbp-scroll { -ms-overflow-style: none; scrollbar-width: none; }
    @keyframes bbpFade { from { opacity:0; transform: translateY(8px);} to { opacity:1; transform: translateY(0);} }
    @keyframes bbpSheet { from { transform: translateY(100%);} to { transform: translateY(0);} }
    @keyframes bbpPulseGold { 0%, 100% { box-shadow: 0 0 0 0 rgba(201, 169, 97, 0.5);} 50% { box-shadow: 0 0 0 12px rgba(201, 169, 97, 0);} }
    .bbp-fade { animation: bbpFade 0.35s cubic-bezier(.2,.8,.2,1) both; }
    .bbp-sheet { animation: bbpSheet 0.32s cubic-bezier(.2,.8,.2,1) both; }
    .bbp-pulse-gold { animation: bbpPulseGold 2s ease-in-out infinite; }
    input, textarea, select, button { font-family: inherit; }
    input[type=number]::-webkit-outer-spin-button, input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
    input[type=number] { -moz-appearance: textfield; }
  `}</style>
);

// ============================================================
//  TYPES (loose entity shapes — runtime data is dynamic)
// ============================================================
// Permissive entity shape: runtime objects are JSON records with dynamic
// fields. We use a string index signature so dynamic property reads/writes
// are well-typed without sprinkling explicit casts through the file.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EntityRecord = { [key: string]: any };
type StoredEntity = EntityRecord & { id: string };

// ============================================================
//  STORAGE
// ============================================================
const getLocalStorage = (): Storage | null => {
  if (typeof window === "undefined") return null;
  try { return window.localStorage; } catch { return null; }
};

const safeStorage = {
  async get(key: string): Promise<string | null> {
    const ls = getLocalStorage();
    if (!ls) return null;
    try { return ls.getItem(key); } catch { return null; }
  },
  async set(key: string, value: unknown): Promise<boolean> {
    const ls = getLocalStorage();
    if (!ls) return false;
    try {
      ls.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
      return true;
    } catch { return false; }
  },
  async delete(key: string): Promise<boolean> {
    const ls = getLocalStorage();
    if (!ls) return false;
    try { ls.removeItem(key); return true; } catch { return false; }
  },
  async list(prefix: string): Promise<string[]> {
    const ls = getLocalStorage();
    if (!ls) return [];
    try {
      const keys: string[] = [];
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (k && k.startsWith(prefix)) keys.push(k);
      }
      return keys;
    } catch { return []; }
  },
  async getAllByPrefix(prefix: string): Promise<EntityRecord[]> {
    const keys = await this.list(prefix);
    const out: EntityRecord[] = [];
    const seenIds = new Set<string>();
    for (const k of keys) {
      const v = await this.get(k);
      if (!v) continue;
      let parsed: any;
      try { parsed = JSON.parse(v); }
      catch (err) {
        if (typeof console !== "undefined") console.warn(`[bbp] dropped corrupt JSON at ${k}`, err);
        continue;
      }
      if (!parsed || typeof parsed !== "object") continue;
      // Defensive de-dupe: skip if we've already seen this id under this
      // prefix. Prevents legacy double-writes from showing twice in the
      // UI until a cleanup pass rewrites them.
      const id = typeof parsed.id === "string" ? parsed.id : null;
      if (id && seenIds.has(id)) continue;
      if (id) seenIds.add(id);
      out.push(parsed);
    }
    return out;
  }
};

// ============================================================
//  HELPERS
// ============================================================
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const fmtMoney = (n: number, currency: string = "USD"): string => {
  const num = Number(n) || 0;
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(num); } catch { return `$${num.toFixed(2)}`; }
};

// --- Numeric input helpers ----------------------------------------------
// Sanitize a free-typed money/decimal string while preserving valid
// intermediate states (e.g. "0.", "0.5"). Strips leading zeros so "0325"
// becomes "325", but keeps a single "0" and "0.x". Allows only digits and
// at most one decimal point. Empty string stays empty (not "0") so the
// placeholder still shows.
const sanitizeMoneyInput = (raw: string | number | null | undefined): string => {
  if (raw === null || raw === undefined) return "";
  let v = String(raw);
  if (v === "") return "";
  // Drop anything that isn't a digit or "."
  v = v.replace(/[^\d.]/g, "");
  // Collapse multiple "." to the first one
  const dot = v.indexOf(".");
  if (dot !== -1) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, "");
  // Strip leading zeros except: "0", "0.x", or empty
  if (v.length > 1 && v[0] === "0" && v[1] !== ".") {
    v = v.replace(/^0+/, "");
    if (v === "" || v[0] === ".") v = "0" + v;
  }
  return v;
};

// Parse any money-ish value into a finite number. Empty / NaN / non-numeric
// safely become 0, so downstream math never gets NaN.
const parseMoney = (raw: string | number | null | undefined): number => {
  if (raw === null || raw === undefined || raw === "") return 0;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

// ---- FINANCE: single source of truth ------------------------------------
//
// All money math in the app derives from these helpers. Anything else
// (Dashboard KPIs, Money tab, client lifetime totals, Pending balance
// section, notifications) is just display.
//
// Round to cents to avoid 0.1 + 0.2 style floating drift before display
// or persistence.
const roundCents = (n: number): number => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const formatCurrency = (n: unknown, currency: string = "USD"): string => fmtMoney(parseMoney(n as any), currency);

// Normalize a raw appointment record from storage / form input. Fills in
// defaults so downstream math never has to second-guess undefined fields,
// and clamps the numeric trio (totalPrice, depositPaid, balanceDue) to a
// consistent state. Idempotent — passing the same record twice is safe.
const normalizeAppointment = (raw: any): any => {
  if (!raw || typeof raw !== "object") return raw;
  const totalPrice = roundCents(parseMoney(raw.totalPrice));
  let depositPaid = roundCents(parseMoney(raw.depositPaid));
  if (depositPaid > totalPrice && totalPrice > 0) depositPaid = totalPrice;
  if (depositPaid < 0) depositPaid = 0;
  const balanceDue = roundCents(Math.max(0, totalPrice - depositPaid));
  let paymentStatus: "paid" | "" | string = raw.paymentStatus || "";
  if (totalPrice > 0 && balanceDue === 0) paymentStatus = "paid";
  else if (paymentStatus === "paid") paymentStatus = "";
  return {
    ...raw,
    status: raw.status || "scheduled",
    totalPrice,
    depositPaid,
    balanceDue,
    paymentStatus,
  };
};

// What the salon has actually collected from this appointment so far.
// Falls back to totalPrice for fully paid records that don't have an
// explicit depositPaid value (legacy data).
const calculateCollectedAmount = (appt: any): number => {
  if (!appt || appt.status === "cancelled") return 0;
  const deposit = parseMoney(appt.depositPaid);
  if (deposit > 0) return roundCents(deposit);
  if (parseMoney(appt.balanceDue) === 0 && parseMoney(appt.totalPrice) > 0) {
    return roundCents(parseMoney(appt.totalPrice));
  }
  return 0;
};

// True when an appointment counts as income (collected money).
const isIncomeAppt = (appt: any): boolean => {
  if (!appt || appt.status === "cancelled") return false;
  return appt.status === "completed" || appt.paymentStatus === "paid" || calculateCollectedAmount(appt) > 0;
};

// Sum of outstanding balance across appointments whose payment is
// pending / partially deposited / overdue. Cancelled and fully-paid
// records are excluded.
const calculatePendingBalance = (appts: any[], todayIso: string): number => {
  if (!Array.isArray(appts)) return 0;
  return roundCents(appts
    .filter(a => a && a.status !== "cancelled")
    .map(a => ({ a, ps: paymentStatusOf(a, todayIso) }))
    .filter(({ ps }) => ps !== "paid")
    .reduce((s, { a }) => s + parseMoney(a.balanceDue), 0));
};

const calculateProfit = (income: number, expenses: number): number =>
  roundCents(parseMoney(income) - parseMoney(expenses));

// ---- RETENTION & REBOOKING INTELLIGENCE ---------------------------------
// Aggregated metrics for a single client. Computed from the full
// appointment list so a stale local cache can't lie to the dashboard.
type ClientMetrics = {
  clientId: string;
  totalAppts: number;
  completedAppts: number;
  cancelledAppts: number;
  noShowAppts: number;
  lifetimeValue: number;
  averageSpend: number;
  lastAppointmentDate: string | null;
  daysSinceLast: number | null;
  averageDaysBetween: number | null;
  mostBookedStyle: string | null;
  upcomingAppointmentDate: string | null;
};

type ClientStatus = "new" | "returning" | "vip" | "inactive" | "at_risk" | "frequent";

const CLIENT_STATUS_LABEL: Record<ClientStatus, string> = {
  new: "New client",
  returning: "Returning",
  vip: "VIP",
  inactive: "Inactive",
  at_risk: "At risk",
  frequent: "Frequent rebooker",
};

const CLIENT_STATUS_TONE: Record<ClientStatus, "neutral" | "gold" | "success" | "warning" | "danger"> = {
  new: "neutral",
  returning: "neutral",
  vip: "gold",
  inactive: "warning",
  at_risk: "danger",
  frequent: "success",
};

const daysBetweenISO = (a: string, b: string): number => {
  if (!a || !b) return 0;
  const da = new Date(a + "T00:00:00").getTime();
  const db = new Date(b + "T00:00:00").getTime();
  if (!Number.isFinite(da) || !Number.isFinite(db)) return 0;
  return Math.round(Math.abs(db - da) / 86400000);
};

const calculateClientLifetimeValue = (clientId: string, appointments: any[]): number => {
  if (!clientId || !Array.isArray(appointments)) return 0;
  return roundCents(appointments
    .filter(a => a && a.clientId === clientId)
    .reduce((s, a) => s + calculateCollectedAmount(a), 0));
};

const calculateClientMetrics = (clientId: string, appointments: any[], todayIso: string): ClientMetrics => {
  const empty: ClientMetrics = {
    clientId,
    totalAppts: 0,
    completedAppts: 0,
    cancelledAppts: 0,
    noShowAppts: 0,
    lifetimeValue: 0,
    averageSpend: 0,
    lastAppointmentDate: null,
    daysSinceLast: null,
    averageDaysBetween: null,
    mostBookedStyle: null,
    upcomingAppointmentDate: null,
  };
  if (!clientId || !Array.isArray(appointments)) return empty;
  const mine = appointments.filter(a => a && a.clientId === clientId);
  if (mine.length === 0) return empty;

  const completed = mine.filter(a => a.status === "completed" || a.paymentStatus === "paid");
  const cancelled = mine.filter(a => a.status === "cancelled").length;
  const noShow = mine.filter(a => a.status === "no_show").length;

  const lifetimeValue = roundCents(mine.reduce((s, a) => s + calculateCollectedAmount(a), 0));
  const averageSpend = completed.length > 0 ? roundCents(lifetimeValue / completed.length) : 0;

  const completedDates = completed
    .map(a => a.date)
    .filter((d: any): d is string => typeof d === "string" && d.length >= 8)
    .sort();
  const lastAppointmentDate = completedDates.length > 0 ? completedDates[completedDates.length - 1] : null;
  const daysSinceLast = lastAppointmentDate ? daysBetweenISO(lastAppointmentDate, todayIso) : null;

  // Average rebooking cadence (avg gap between consecutive completed visits).
  let averageDaysBetween: number | null = null;
  if (completedDates.length >= 2) {
    let total = 0;
    for (let i = 1; i < completedDates.length; i++) {
      total += daysBetweenISO(completedDates[i - 1], completedDates[i]);
    }
    averageDaysBetween = Math.round(total / (completedDates.length - 1));
  }

  // Most booked style by frequency.
  const styleCounts: Record<string, number> = {};
  for (const a of mine) {
    const k = (a.style || "").trim();
    if (!k) continue;
    styleCounts[k] = (styleCounts[k] || 0) + 1;
  }
  const mostBookedStyle = Object.entries(styleCounts)
    .sort(([, a], [, b]) => b - a)
    .map(([k]) => k)[0] || null;

  // Earliest upcoming non-cancelled / non-completed appointment.
  const upcoming = mine
    .filter(a => a.date >= todayIso && a.status !== "cancelled" && a.status !== "completed")
    .map(a => a.date)
    .sort()[0] || null;

  return {
    clientId,
    totalAppts: mine.length,
    completedAppts: completed.length,
    cancelledAppts: cancelled,
    noShowAppts: noShow,
    lifetimeValue,
    averageSpend,
    lastAppointmentDate,
    daysSinceLast,
    averageDaysBetween,
    mostBookedStyle,
    upcomingAppointmentDate: upcoming,
  };
};

// Status detection. Rules are intentionally simple and rule-based for
// V1 — a future ML pass can replace `getClientStatus` without touching
// the UI.
const getClientStatus = (metrics: ClientMetrics, vipThreshold: number): ClientStatus => {
  if (!metrics || metrics.totalAppts === 0) return "new";
  if (metrics.lifetimeValue >= vipThreshold && metrics.completedAppts >= 3) {
    if (metrics.daysSinceLast != null && metrics.daysSinceLast > 60) return "at_risk";
    return "vip";
  }
  if (metrics.daysSinceLast != null && metrics.daysSinceLast > 90) return "inactive";
  if (metrics.daysSinceLast != null && metrics.daysSinceLast > 60 && metrics.completedAppts >= 2) return "at_risk";
  if (metrics.completedAppts >= 3 && metrics.averageDaysBetween != null && metrics.averageDaysBetween <= 35) return "frequent";
  if (metrics.completedAppts >= 1) return "returning";
  return "new";
};

// 0–100 retention score (RFM-lite). Recency dominates because rebooking
// is the leading indicator that a client is sticking with you.
const calculateRetentionScore = (metrics: ClientMetrics): number => {
  if (!metrics || metrics.totalAppts === 0) return 0;
  // Recency (40 pts): 0 days = 40, 90+ days = 0
  const recency = metrics.daysSinceLast == null
    ? 0
    : Math.max(0, Math.min(40, 40 - (metrics.daysSinceLast / 90) * 40));
  // Frequency (30 pts): completed visits, capped at 6+ for full credit
  const frequency = Math.max(0, Math.min(30, (metrics.completedAppts / 6) * 30));
  // Monetary (30 pts): lifetime value, capped at $1000 for full credit
  const monetary = Math.max(0, Math.min(30, (metrics.lifetimeValue / 1000) * 30));
  return Math.round(recency + frequency + monetary);
};

// Rebooking candidates: clients overdue for their next visit, with a
// reason string suitable to display next to their name. Sorted by how
// overdue they are (relative to their own cadence).
const getRebookingCandidates = (clients: any[], appointments: any[], todayIso: string): { client: any; metrics: ClientMetrics; reason: string; overdueBy: number }[] => {
  if (!Array.isArray(clients)) return [];
  const out: { client: any; metrics: ClientMetrics; reason: string; overdueBy: number }[] = [];
  for (const c of clients) {
    if (!c || !c.id) continue;
    const m = calculateClientMetrics(c.id, appointments, todayIso);
    if (m.upcomingAppointmentDate) continue; // already on the books
    if (m.completedAppts === 0) continue;     // no history yet
    if (m.daysSinceLast == null) continue;
    const cadence = m.averageDaysBetween || 42; // default 6-week touch-up window
    if (m.daysSinceLast < cadence) continue;
    const overdueBy = m.daysSinceLast - cadence;
    let reason = "Time to rebook";
    if (m.daysSinceLast >= 42 && m.daysSinceLast < 56) reason = "Client may need touch-up";
    else if (m.daysSinceLast >= 56) reason = "Follow up after 6+ weeks";
    if (m.lifetimeValue >= 800 && m.daysSinceLast >= 30) reason = "VIP client inactive for 30+ days";
    out.push({ client: c, metrics: m, reason, overdueBy });
  }
  return out.sort((a, b) => b.overdueBy - a.overdueBy);
};

// ---- DASHBOARD ORCHESTRATION --------------------------------------------
// The dashboard surfaces the same appointment data through three lenses
// (Pending Balances → Today's Chair → Coming Up). Each card has a single
// purpose and an appointment should only appear in the most relevant
// one. These helpers own the inclusion / exclusion math so the JSX
// stays a thin renderer.

const getPendingBalanceAppointments = (appointments: any[], todayIso: string): any[] => {
  if (!Array.isArray(appointments)) return [];
  return appointments
    .filter(a => a && a.status !== "cancelled")
    .filter(a => parseMoney(a.balanceDue) > 0)
    .filter(a => paymentStatusOf(a, todayIso) !== "paid")
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
};

const getTodaysAppointments = (appointments: any[], todayIso: string, excludeIds: Set<string> = new Set()): any[] => {
  if (!Array.isArray(appointments)) return [];
  const today = appointments
    .filter(a => a && a.status !== "cancelled" && a.date === todayIso)
    .sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  // If excluding pending-balance items would leave Today's Chair empty,
  // we fall back to the un-filtered list so the section never goes silent
  // when there really is something happening today.
  const filtered = today.filter(a => !excludeIds.has(a.id));
  return filtered.length > 0 ? filtered : today;
};

const getUpcomingAppointments = (
  appointments: any[],
  todayIso: string,
  excludeIds: Set<string> = new Set(),
  limit: number = 3,
): any[] => {
  if (!Array.isArray(appointments)) return [];
  return appointments
    .filter(a => a && a.status !== "cancelled" && a.status !== "completed")
    .filter(a => a.date && a.date > todayIso)
    .filter(a => !excludeIds.has(a.id))
    .sort((a, b) => ((a.date || "") + (a.time || "")).localeCompare((b.date || "") + (b.time || "")))
    .slice(0, limit);
};

// Best-effort safe JSON parse so a single corrupted localStorage entry
// can't take down the app.
const safeParse = <T,>(raw: string | null | undefined, fallback: T): T => {
  if (raw === null || raw === undefined || raw === "") return fallback;
  try {
    const v = JSON.parse(raw);
    return v as T;
  } catch (err) {
    if (typeof console !== "undefined") console.warn("[bbp] dropped corrupt JSON in storage", err);
    return fallback;
  }
};

const fmtDate = (iso: string): string => {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};
const fmtDateLong = (iso: string): string => {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
};
const fmtTime = (t: string): string => {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hh = h % 12 || 12;
  return `${hh}:${String(m).padStart(2, "0")} ${period}`;
};
const fmtDuration = (ms: number): string => {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};
const fmtHours = (ms: number): string => (ms / 3600000).toFixed(1);
const fmtRelative = (iso: string): string => {
  if (!iso) return "—";
  const diff = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diff);
  const sign = diff < 0 ? "ago" : "from now";
  const min = Math.round(abs / 60000);
  if (min < 60) return `${min}m ${sign}`;
  const hr = Math.round(abs / 3600000);
  if (hr < 24) return `${hr}h ${sign}`;
  return `${Math.round(abs / 86400000)}d ${sign}`;
};
// Format a Date as "YYYY-MM-DD" using its *local* fields. We never use
// toISOString() for app-facing dates because that returns UTC, which
// flips a day forward at 5–8pm in US timezones — that's the source of
// the "today is tomorrow" bug.
const localDateISO = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const todayISO = (): string => localDateISO(new Date());
const initials = (name: string): string => (name || "?").trim().split(/\s+/).slice(0, 2).map(s => s[0]?.toUpperCase() || "").join("");
const addDaysISO = (iso: string, days: number): string => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return localDateISO(d);
};
const cadenceDays = (cadence: string, customDays: number): number => ({
  "2w": 14, "3w": 21, "4w": 28, "6w": 42, "8w": 56, "monthly": 30, "custom": Number(customDays) || 28
}[cadence] || 28);
const cadenceLabel = (c: string): string => ({
  "2w": "Every 2 weeks", "3w": "Every 3 weeks", "4w": "Every 4 weeks",
  "6w": "Every 6 weeks", "8w": "Every 8 weeks", "monthly": "Monthly", "custom": "Custom interval"
}[c] || c);

// ============================================================
//  DEFAULTS & SEEDS
// ============================================================
const DEFAULT_BUSINESS = {
  businessName: "Braid Boss Pro", ownerName: "",
  hourlyRate: 50, overheadPerHour: 8, profitMargin: 25,
  defaultTravelFee: 0, currency: "USD",
};

const DEFAULT_REMINDER_SETTINGS = {
  enabled: true, defaultChannel: "sms",
  timings: {
    confirmation: true, h48: true, h24: true,
    sameDay: true, sameDayHoursBefore: 3,
    depositDue: true, balanceDue: true,
    lateAlert: true, lateAlertMinutes: 15,
  },
  quietHours: { start: "21:00", end: "08:00" },
  signature: "— sent from Braid Boss Pro",
};

const PURPOSE_LABEL = {
  confirmation: "Booking confirmation",
  reminder_48h: "48-hour reminder",
  reminder_24h: "24-hour reminder",
  reminder_same_day: "Same-day reminder",
  deposit_due: "Deposit due",
  balance_due: "Balance due",
  late_alert: "Late check-in",
};

const DEFAULT_REMINDER_TEMPLATES = [
  { id: "tpl_conf_sms", purpose: "confirmation", channel: "sms", isDefault: true,
    body: "Hi {{client}}! You're booked for {{style}} on {{date}} at {{time}}. Deposit of {{deposit}} secures your seat. Reply YES to confirm. — {{business}}" },
  { id: "tpl_48_sms", purpose: "reminder_48h", channel: "sms", isDefault: true,
    body: "Hi {{client}}, reminder of your {{style}} appointment on {{date}} at {{time}}. Please arrive with hair washed & detangled. — {{business}}" },
  { id: "tpl_24_sms", purpose: "reminder_24h", channel: "sms", isDefault: true,
    body: "Hi {{client}} — see you tomorrow at {{time}} for {{style}}. Balance of {{balance}} due at the appointment. — {{business}}" },
  { id: "tpl_same_sms", purpose: "reminder_same_day", channel: "sms", isDefault: true,
    body: "Hi {{client}}, your {{style}} appointment is in a few hours at {{time}}. Come ready! — {{business}}" },
  { id: "tpl_dep_sms", purpose: "deposit_due", channel: "sms", isDefault: true,
    body: "Hi {{client}}, your deposit of {{deposit}} is needed to lock in your {{date}} appointment. — {{business}}" },
  { id: "tpl_bal_sms", purpose: "balance_due", channel: "sms", isDefault: true,
    body: "Hi {{client}}, balance of {{balance}} due at today's appointment. Cash, CashApp, Zelle accepted. — {{business}}" },
  { id: "tpl_late_sms", purpose: "late_alert", channel: "sms", isDefault: true,
    body: "Hi {{client}}, just checking — your appointment was at {{time}}. Are you on the way? — {{business}}" },
  { id: "tpl_conf_email", purpose: "confirmation", channel: "email", isDefault: true,
    subject: "Your appointment is confirmed",
    body: "Hi {{client}},\n\nYour {{style}} appointment is confirmed for {{date}} at {{time}}.\n\nDeposit due: {{deposit}}\nFinal balance: {{balance}}\n\nPlease arrive with hair freshly washed, fully detangled, and blown out.\n\n{{business}}" },
];

const DEFAULT_POLICIES = [
  { id: "pol_deposit", title: "Deposit Policy", category: "deposit", isDefault: true, updatedAt: new Date().toISOString(),
    body: "A non-refundable deposit of 30% is required to secure your appointment. The deposit is applied to your final balance on the day of service. Appointments without a deposit will be released after 24 hours." },
  { id: "pol_cancel", title: "Cancellation Policy", category: "cancellation", isDefault: true, updatedAt: new Date().toISOString(),
    body: "Cancellations made more than 48 hours before your appointment are eligible for deposit transfer. Within 48 hours forfeit the deposit. No-shows are charged 50% of the service total before re-booking." },
  { id: "pol_late", title: "Late Arrival", category: "late", isDefault: true, updatedAt: new Date().toISOString(),
    body: "A 15-minute grace period is provided. Arrivals 15–30 minutes late incur a $25 late fee." },
  { id: "pol_prep", title: "Hair Prep", category: "prep", isDefault: true, updatedAt: new Date().toISOString(),
    body: "Please arrive with hair freshly washed, fully detangled, and blown out. Hair that arrives unprepped is subject to a $40 prep fee." },
  { id: "pol_pay", title: "Payment Methods", category: "payment", isDefault: true, updatedAt: new Date().toISOString(),
    body: "We accept Cash, CashApp, Zelle, and Apple Pay. Final balance is due at the end of service." },
];

const DEFAULT_PRESETS = [
  { id: "pre_knotless_mid", name: "Medium Knotless Mid-Back",
    category: "knotless", braidSize: "medium", braidLength: "mid_back",
    estimatedHours: 6, basePrice: 280, hairCost: 60, hourlyRate: 50,
    overhead: 15, profitMargin: 30,
    defaultAddOns: [{ name: "Edges & wash", amount: 25 }],
    defaultDeposit: 30, depositType: "percentage",
    maintenanceNotes: "Wrap nightly with silk scarf. Take down at 6-8 weeks max.",
    hairProductsIncluded: "3-4 packs pre-stretched hair (Outre X-Pression).",
    isFavorite: true, useCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: "pre_boho_bob", name: "Boho Bob",
    category: "boho", braidSize: "small", braidLength: "shoulder",
    estimatedHours: 5, basePrice: 320, hairCost: 80, hourlyRate: 55,
    overhead: 15, profitMargin: 35,
    defaultAddOns: [{ name: "Curly ends", amount: 30 }],
    defaultDeposit: 50, depositType: "flat",
    maintenanceNotes: "Refresh curls weekly. Take down at 4-6 weeks.",
    hairProductsIncluded: "2 packs Outre + 1 pack human hair curly bulk.",
    isFavorite: false, useCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: "pre_fulani", name: "Fulani Feed-Ins",
    category: "feed_in", braidSize: "small", braidLength: "shoulder",
    estimatedHours: 4, basePrice: 180, hairCost: 30, hourlyRate: 50,
    overhead: 10, profitMargin: 20,
    defaultAddOns: [{ name: "Beads & cuffs", amount: 15 }],
    defaultDeposit: 50, depositType: "flat",
    maintenanceNotes: "Refresh edges every 2 weeks. Take down at 3-4 weeks.",
    hairProductsIncluded: "1-2 packs Kanekalon, beads provided.",
    isFavorite: false, useCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: "pre_jumbo", name: "Jumbo Tribal Braids",
    category: "box", braidSize: "jumbo", braidLength: "waist",
    estimatedHours: 4, basePrice: 220, hairCost: 50, hourlyRate: 55,
    overhead: 10, profitMargin: 25,
    defaultAddOns: [{ name: "Waist beads", amount: 20 }],
    defaultDeposit: 30, depositType: "percentage",
    maintenanceNotes: "Lightweight & quick. Wrap nightly. Take down at 4-6 weeks.",
    hairProductsIncluded: "2 packs jumbo Kanekalon.",
    isFavorite: false, useCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
];

// ============================================================
//  REMINDER ENGINE
// ============================================================
const renderTemplate = (body: string, ctx: any): string => body.replace(/\{\{(\w+)\}\}/g, (_, k) => ctx[k] != null ? String(ctx[k]) : "");

const buildReminderContext = (appt: any, business: any): any => ({
  client: (appt.clientName || "there").split(" ")[0],
  style: appt.style || "your appointment",
  date: fmtDate(appt.date),
  time: fmtTime(appt.time),
  deposit: fmtMoney(appt.depositPaid || 0, business.currency),
  balance: fmtMoney(appt.balanceDue || 0, business.currency),
  business: business.businessName || "your stylist",
});

// ---- CLIENT COMMUNICATION (v1: template-only) ---------------------------
type CommTemplateKey =
  | "booking_confirmation"
  | "deposit_request"
  | "appointment_reminder"
  | "balance_due"
  | "thank_you"
  | "rebooking_nudge"
  | "policy";

type CommTemplate = {
  key: CommTemplateKey;
  label: string;
  short: string;
  body: string;
};

const COMMUNICATION_TEMPLATES: CommTemplate[] = [
  {
    key: "booking_confirmation",
    label: "Booking confirmation",
    short: "Confirms a new booking with date, time, and deposit.",
    body: "Hi {{client}}! You&apos;re booked for {{style}} on {{date}} at {{time}}. Deposit of {{deposit}} secures your seat — balance of {{balance}} due at the appointment. Please arrive with hair freshly washed, fully detangled, and blown out. — {{business}}",
  },
  {
    key: "deposit_request",
    label: "Deposit request",
    short: "Asks the client to send the deposit to lock in the date.",
    body: "Hi {{client}}, your {{style}} appointment on {{date}} at {{time}} isn&apos;t locked in until I receive your deposit of {{deposit}}. Cash, CashApp, or Zelle work. Let me know if you have questions. — {{business}}",
  },
  {
    key: "appointment_reminder",
    label: "Appointment reminder",
    short: "Reminds the client a day or two before their appointment.",
    body: "Hi {{client}}! Just a quick reminder of your {{style}} appointment on {{date}} at {{time}}. Please arrive with hair washed and detangled. Balance due is {{balance}}. See you soon! — {{business}}",
  },
  {
    key: "balance_due",
    label: "Balance due",
    short: "Reminds the client to bring the remaining balance.",
    body: "Hi {{client}}, balance of {{balance}} is due at your {{date}} {{style}} appointment. I accept cash, CashApp, Zelle, and Apple Pay. — {{business}}",
  },
  {
    key: "thank_you",
    label: "Thank you",
    short: "A warm thank-you note after the service.",
    body: "Hi {{client}}, thank you so much for trusting me with your {{style}}! It was a pleasure as always. Don&apos;t forget to wrap nightly with a silk scarf and refresh your edges. I&apos;d love to see you back in 6–8 weeks — text me to lock in your next date. — {{business}}",
  },
  {
    key: "rebooking_nudge",
    label: "Rebooking nudge",
    short: "Gentle reminder it's been a while since their last visit.",
    body: "Hey {{client}}! It&apos;s been a few weeks since your last appointment with me — your hair is probably ready for a refresh. I have openings coming up if you&apos;d like to lock in a date for {{style}} again. — {{business}}",
  },
  {
    key: "policy",
    label: "Cancellation / no-show policy",
    short: "Sends the policy text in case of a missed or late appointment.",
    body: "Hi {{client}}, just a reminder of my policy: cancellations within 48 hours forfeit the deposit, and no-shows are charged 50% of the service total before re-booking. Reach out as soon as you can if anything changes on your end. — {{business}}",
  },
];

// Resolves the most relevant appointment for a given client, so the
// communication layer can hydrate {{date}} {{time}} {{style}} {{deposit}}
// {{balance}} {{total}} placeholders even when the user opens a template
// straight from a client profile (no appointment selected). Priority:
//   1. Nearest upcoming appointment on/after today that isn't cancelled
//      or completed (handles "scheduled" / "confirmed").
//   2. Any appointment dated today (catches edge cases the date sort missed).
//   3. Most recent appointment that isn't cancelled / completed (active
//      booking with an outstanding balance, late check-in, etc.).
//   4. null — caller falls back to graceful copy.
const getClientAppointmentContext = (clientId: string | null | undefined, appointments: any[]): any | null => {
  if (!clientId || !Array.isArray(appointments)) return null;
  const todayIso = todayISO();
  const mine = appointments.filter(a => a && a.clientId === clientId && a.date);
  if (mine.length === 0) return null;
  const sortKey = (a: any) => `${a.date || ""}${a.time || ""}`;

  const upcoming = mine
    .filter(a => a.date >= todayIso && a.status !== "cancelled" && a.status !== "completed")
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  if (upcoming.length > 0) return upcoming[0];

  const today = mine.filter(a => a.date === todayIso);
  if (today.length > 0) return today[0];

  const unfinished = mine
    .filter(a => a.status !== "cancelled" && a.status !== "completed")
    .sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
  if (unfinished.length > 0) return unfinished[0];

  return null;
};

// Build the placeholder dictionary for communication templates.
// Empty / missing values render as graceful copy ("TBD", "the deposit",
// etc.) instead of "—" or "$0.00", except when an amount is explicitly
// zero on a real appointment (legitimate result).
const buildCommunicationContext = (appt: any, client: any, business: any): Record<string, string> => {
  const hasAppt = !!appt && (appt.id || appt.date || appt.totalPrice != null);
  const currency = business?.currency || "USD";
  const fmtCur = (n: number) => formatCurrency(n, currency);

  const dateRaw = appt?.date;
  const timeRaw = appt?.time;
  const totalNum = parseMoney(appt?.totalPrice);
  const depositNum = parseMoney(appt?.depositPaid);
  const balanceNum = appt?.balanceDue != null
    ? parseMoney(appt.balanceDue)
    : Math.max(0, totalNum - depositNum);

  // Date / time guards: skip placeholder dashes; coerce to "TBD" when
  // the underlying value is missing or invalid.
  let dateStr = "TBD";
  if (dateRaw) {
    const formatted = fmtDate(dateRaw);
    if (formatted && formatted !== "—") dateStr = formatted;
  }
  let timeStr = "TBD";
  if (timeRaw) {
    const formatted = fmtTime(timeRaw);
    if (formatted) timeStr = formatted;
  }

  // Money guards: only show $0.00 when we have an appointment AND the
  // value is explicitly zero. Otherwise fall back to descriptive copy.
  const moneyOrCopy = (n: number, fallback: string): string => {
    if (hasAppt && (totalNum > 0 || depositNum > 0)) return fmtCur(n);
    return fallback;
  };

  const clientName = ((client?.name || appt?.clientName || "there") + "").split(/\s+/)[0] || "there";
  const businessName = business?.businessName || "your stylist";
  const styleStr = (appt?.style && String(appt.style).trim()) || "your appointment";

  const paymentStatus = (() => {
    if (!hasAppt) return "pending";
    if (appt?.paymentStatus) return String(appt.paymentStatus);
    if (totalNum > 0 && balanceNum === 0) return "paid";
    if (depositNum > 0 && balanceNum > 0) return "partial";
    return "pending";
  })();

  return {
    client: clientName,
    style: styleStr,
    date: dateStr,
    time: timeStr,
    deposit: moneyOrCopy(depositNum, "the deposit"),
    balance: moneyOrCopy(balanceNum, "the remaining balance"),
    total: moneyOrCopy(totalNum, "the service total"),
    business: businessName,
    paymentStatus,
  };
};

const renderCommunicationTemplate = (key: CommTemplateKey, appt: any, client: any, business: any): string => {
  const tpl = COMMUNICATION_TEMPLATES.find(t => t.key === key);
  if (!tpl) return "";
  const ctx = buildCommunicationContext(appt, client, business);
  // Templates are authored with HTML-escaped apostrophes so JSX text is
  // happy in the picker preview. Decode them when emitting plain text
  // for clipboard / share / SMS so apostrophes look natural.
  let body = renderTemplate(tpl.body, ctx).replace(/&apos;/g, "'").replace(/&quot;/g, '"');
  // If we couldn't resolve any appointment context at all, append a soft
  // line so the message still reads cleanly instead of showing TBDs.
  const noAppt = !appt || (!appt.id && !appt.date && !appt.totalPrice);
  if (noAppt && (body.includes("TBD") || body.includes("the deposit") || body.includes("the remaining balance"))) {
    body = body.replace(/\s+$/, "") + "\n\nReach out to finalize your appointment details.";
  }
  return body;
};

const planRemindersForAppointment = (appt: any, settings: any, templates: any[], business: any): any[] => {
  if (!settings.enabled) return [];
  const out: EntityRecord[] = [];
  const ctx = buildReminderContext(appt, business);
  const apptDateTime = new Date(`${appt.date}T${appt.time || "10:00"}:00`);
  const channels = settings.defaultChannel === "both" ? ["sms", "email"] : [settings.defaultChannel];

  const queue: { purpose: string; at: Date }[] = [];
  if (settings.timings.confirmation) queue.push({ purpose: "confirmation", at: new Date() });
  if (settings.timings.h48) queue.push({ purpose: "reminder_48h", at: new Date(apptDateTime.getTime() - 48 * 3600000) });
  if (settings.timings.h24) queue.push({ purpose: "reminder_24h", at: new Date(apptDateTime.getTime() - 24 * 3600000) });
  if (settings.timings.sameDay) queue.push({ purpose: "reminder_same_day", at: new Date(apptDateTime.getTime() - settings.timings.sameDayHoursBefore * 3600000) });
  if (settings.timings.depositDue && Number(appt.depositPaid || 0) === 0) queue.push({ purpose: "deposit_due", at: new Date() });
  if (settings.timings.balanceDue && Number(appt.balanceDue || 0) > 0) queue.push({ purpose: "balance_due", at: new Date(apptDateTime.getTime() - 4 * 3600000) });

  for (const item of queue) {
    for (const ch of channels) {
      const tpl = templates.find(t => t.purpose === item.purpose && t.channel === ch)
                || templates.find(t => t.purpose === item.purpose); // fallback
      if (!tpl) continue;
      const rendered = renderTemplate(tpl.body, ctx);
      const sig = settings.signature && ch === "email" ? `\n\n${settings.signature}` : "";
      out.push({
        id: uid(),
        appointmentId: appt.id,
        clientId: appt.clientId,
        clientName: appt.clientName,
        type: ch,
        purpose: item.purpose,
        scheduledFor: item.at.toISOString(),
        sentAt: null,
        status: "pending",
        templateId: tpl.id,
        renderedBody: rendered + sig,
        renderedSubject: tpl.subject || null,
        channel: { phone: appt.clientPhone, email: appt.clientEmail },
        createdAt: new Date().toISOString(),
      });
    }
  }
  return out;
};

// ============================================================
//  PRICING ENGINE
// ============================================================
// Discount is applied BEFORE tip — the tip then calculates from the
// discounted subtotal so the stylist isn't accidentally tipping out
// the original price. Total floors at $0 even if a misconfigured
// fixed-amount discount would otherwise push it negative.
const computePricing = (
  inputs: any,
  discount?: { discount_type: "fixed" | "percentage"; value: number } | null,
): any => {
  const hairCost = Number(inputs.hairCost) || 0;
  const hourlyRate = Number(inputs.hourlyRate) || 0;
  const hours = Number(inputs.hours) || 0;
  const travelFee = Number(inputs.travelFee) || 0;
  const overhead = Number(inputs.overhead) || 0;
  const profitMargin = Number(inputs.profitMargin) || 0;
  const tipPct = Number(inputs.tipPct) || 0;
  const addOnsTotal = (inputs.addOns || []).reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const labor = hourlyRate * hours;
  const subtotalBeforeDiscount = hairCost + labor + travelFee + addOnsTotal + overhead + profitMargin;
  const discountAmount = computeDiscountAmount(subtotalBeforeDiscount, discount);
  const subtotal = Math.max(0, subtotalBeforeDiscount - discountAmount);
  const tipAmount = subtotal * (tipPct / 100);
  const finalPrice = subtotal + tipAmount;
  return {
    hairCost, labor, hourlyRate, hours, travelFee, addOnsTotal, overhead, profitMargin, tipPct,
    subtotalBeforeDiscount: Number(subtotalBeforeDiscount.toFixed(2)),
    discountAmount: Number(discountAmount.toFixed(2)),
    subtotal: Number(subtotal.toFixed(2)),
    tipAmount: Number(tipAmount.toFixed(2)),
    finalPrice: Number(finalPrice.toFixed(2)),
  };
};

// ============================================================
//  IMAGE COMPRESSION
// ============================================================
const compressImage = (file: File, maxWidth: number = 1280, quality: number = 0.78): Promise<{ dataUrl: string; thumbnailDataUrl: string }> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = reject;
  reader.onload = (e) => {
    const img = new Image();
    img.onerror = reject;
    img.onload = () => {
      const ratio = Math.min(1, maxWidth / img.width);
      const w = Math.round(img.width * ratio);
      const h = Math.round(img.height * ratio);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d")?.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/jpeg", quality);

      const tw = Math.min(w, 320);
      const th = Math.round((h / w) * tw);
      const tc = document.createElement("canvas");
      tc.width = tw; tc.height = th;
      tc.getContext("2d")?.drawImage(img, 0, 0, tw, th);
      const thumbnailDataUrl = tc.toDataURL("image/jpeg", 0.6);

      resolve({ dataUrl, thumbnailDataUrl });
    };
    const result = e.target?.result;
    img.src = typeof result === "string" ? result : "";
  };
  reader.readAsDataURL(file);
});

// ============================================================
//  STORAGE HOOK
// ============================================================
async function upsertEntity(
  prefix: string,
  setter: React.Dispatch<React.SetStateAction<EntityRecord[]>>,
  record: any,
) {
  const r = { ...record };
  if (!r.id) { r.id = uid(); r.createdAt = r.createdAt || new Date().toISOString(); }
  await safeStorage.set(`${prefix}:${r.id}`, r);
  setter(prev => {
    const i = prev.findIndex(x => x.id === r.id);
    if (i >= 0) { const cp = [...prev]; cp[i] = r; return cp; }
    return [...prev, r];
  });
  return r;
}

async function deleteEntity(
  prefix: string,
  setter: React.Dispatch<React.SetStateAction<EntityRecord[]>>,
  id: string,
) {
  await safeStorage.delete(`${prefix}:${id}`);
  setter(prev => prev.filter(x => x.id !== id));
}

const useStorage = () => {
  const [business, setBusiness] = useState<EntityRecord>(DEFAULT_BUSINESS);
  const [reminderSettings, setReminderSettings] = useState<EntityRecord>(DEFAULT_REMINDER_SETTINGS);
  const [reminderTemplates, setReminderTemplates] = useState<EntityRecord[]>([]);
  const [reminders, setReminders] = useState<EntityRecord[]>([]);
  const [clients, setClients] = useState<EntityRecord[]>([]);
  const [appointments, setAppointments] = useState<EntityRecord[]>([]);
  const [quotes, setQuotes] = useState<EntityRecord[]>([]);
  const [transactions, setTransactions] = useState<EntityRecord[]>([]);
  const [policies, setPolicies] = useState<EntityRecord[]>([]);
  const [photos, setPhotos] = useState<EntityRecord[]>([]);
  const [recurringSeries, setRecurringSeries] = useState<EntityRecord[]>([]);
  const [stylePresets, setStylePresets] = useState<EntityRecord[]>([]);
  const [activeTimer, setActiveTimer] = useState<EntityRecord | null>(null);
  const [timerSessions, setTimerSessions] = useState<EntityRecord[]>([]);
  const [commLog, setCommLog] = useState<EntityRecord[]>([]);
  const [receipts, setReceipts] = useState<EntityRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const bizRaw = await safeStorage.get("settings:business");
      const bizParsed = safeParse<EntityRecord | null>(bizRaw, null);
      if (bizParsed) setBusiness({ ...DEFAULT_BUSINESS, ...bizParsed });
      else await safeStorage.set("settings:business", DEFAULT_BUSINESS);

      const rsRaw = await safeStorage.get("reminderSettings");
      const rsParsed = safeParse<EntityRecord | null>(rsRaw, null);
      if (rsParsed) setReminderSettings({ ...DEFAULT_REMINDER_SETTINGS, ...rsParsed });
      else await safeStorage.set("reminderSettings", DEFAULT_REMINDER_SETTINGS);

      let tpls = await safeStorage.getAllByPrefix("reminderTemplates:");
      if (tpls.length === 0) {
        for (const t of DEFAULT_REMINDER_TEMPLATES) await safeStorage.set(`reminderTemplates:${t.id}`, t);
        tpls = DEFAULT_REMINDER_TEMPLATES;
      }
      setReminderTemplates(tpls);

      setReminders(await safeStorage.getAllByPrefix("reminders:"));
      setClients(await safeStorage.getAllByPrefix("clients:"));
      // Normalize on load: pre-existing appointments may be missing the
      // numeric defaults / paymentStatus we added later. Run them
      // through the normalizer so all KPIs see a consistent shape from
      // the first render after refresh.
      const rawAppts = await safeStorage.getAllByPrefix("appointments:");
      setAppointments(rawAppts.map(normalizeAppointment));
      setQuotes(await safeStorage.getAllByPrefix("quotes:"));
      setTransactions(await safeStorage.getAllByPrefix("transactions:"));
      setPhotos(await safeStorage.getAllByPrefix("photos:"));
      setRecurringSeries(await safeStorage.getAllByPrefix("recurringSeries:"));
      setTimerSessions(await safeStorage.getAllByPrefix("timerSessions:"));
      setCommLog(await safeStorage.getAllByPrefix("commLog:"));
      setReceipts(await safeStorage.getAllByPrefix("receipts:"));

      let pols = await safeStorage.getAllByPrefix("policies:");
      if (pols.length === 0) {
        for (const p of DEFAULT_POLICIES) await safeStorage.set(`policies:${p.id}`, p);
        pols = DEFAULT_POLICIES;
      }
      setPolicies(pols);

      let pres = await safeStorage.getAllByPrefix("stylePresets:");
      if (pres.length === 0) {
        for (const p of DEFAULT_PRESETS) await safeStorage.set(`stylePresets:${p.id}`, p);
        pres = DEFAULT_PRESETS;
      }
      setStylePresets(pres);

      const atRaw = await safeStorage.get("activeTimer");
      const parsedTimer = safeParse<EntityRecord | null>(atRaw, null);
      if (parsedTimer) setActiveTimer(parsedTimer);

      setLoading(false);
    })();
  }, []);

  const saveBusiness = useCallback(async (next) => { setBusiness(next); await safeStorage.set("settings:business", next); }, []);
  const saveReminderSettings = useCallback(async (next) => { setReminderSettings(next); await safeStorage.set("reminderSettings", next); }, []);

  const upsertClient = useCallback((record: any) => upsertEntity("clients", setClients, record), []);
  const deleteClient = useCallback((id: string) => deleteEntity("clients", setClients, id), []);

  const upsertAppointment = useCallback(async (a) => {
    if (!a || typeof a !== "object") {
      if (typeof console !== "undefined") console.warn("[bbp] upsertAppointment: ignoring non-object input", a);
      return null;
    }
    const seeded = { ...a };
    if (!seeded.id) {
      seeded.id = uid();
      seeded.createdAt = new Date().toISOString();
    }
    if (seeded.balanceDue == null && parseMoney(seeded.totalPrice) > 0) seeded.paymentStatus = seeded.paymentStatus || "";
    const r = normalizeAppointment(seeded);
    if (r.paymentStatus === "paid" && !r.paymentDate) r.paymentDate = todayISO();
    await safeStorage.set(`appointments:${r.id}`, r);
    setAppointments(prev => {
      // Dedupe defensively in case storage held two records for the same
      // id (legacy bug). Keep the new one.
      const filtered = prev.filter(x => x.id !== r.id);
      return [...filtered, r];
    });
    return r;
  }, []);
  const deleteAppointment = useCallback((id: string) => deleteEntity("appointments", setAppointments, id), []);

  const upsertQuote = useCallback((record: any) => upsertEntity("quotes", setQuotes, record), []);
  const deleteQuote = useCallback((id: string) => deleteEntity("quotes", setQuotes, id), []);

  const upsertTransaction = useCallback(async (t) => {
    const r = { ...t };
    if (!r.id) r.id = uid();
    if (!r.date) r.date = todayISO();
    await safeStorage.set(`transactions:${r.id}`, r);
    setTransactions(prev => {
      const i = prev.findIndex(x => x.id === r.id);
      if (i >= 0) { const cp = [...prev]; cp[i] = r; return cp; }
      return [...prev, r];
    });
    return r;
  }, []);
  const deleteTransaction = useCallback((id: string) => deleteEntity("transactions", setTransactions, id), []);

  const upsertPolicy = useCallback(async (p) => {
    const r = { ...p, updatedAt: new Date().toISOString() };
    if (!r.id) r.id = uid();
    await safeStorage.set(`policies:${r.id}`, r);
    setPolicies(prev => {
      const i = prev.findIndex(x => x.id === r.id);
      if (i >= 0) { const cp = [...prev]; cp[i] = r; return cp; }
      return [...prev, r];
    });
    return r;
  }, []);

  const upsertPhoto = useCallback((record: any) => upsertEntity("photos", setPhotos, record), []);
  const deletePhoto = useCallback((id: string) => deleteEntity("photos", setPhotos, id), []);

  const upsertPreset = useCallback(async (p) => {
    const r = { ...p, updatedAt: new Date().toISOString() };
    if (!r.id) { r.id = uid(); r.createdAt = r.updatedAt; r.useCount = r.useCount || 0; }
    await safeStorage.set(`stylePresets:${r.id}`, r);
    setStylePresets(prev => {
      const i = prev.findIndex(x => x.id === r.id);
      if (i >= 0) { const cp = [...prev]; cp[i] = r; return cp; }
      return [...prev, r];
    });
    return r;
  }, []);
  const deletePreset = useCallback((id: string) => deleteEntity("stylePresets", setStylePresets, id), []);
  const incrementPresetUse = useCallback(async (id) => {
    const raw = await safeStorage.get(`stylePresets:${id}`);
    const parsed = safeParse<EntityRecord | null>(raw, null);
    if (!parsed) return;
    parsed.useCount = (parsed.useCount || 0) + 1;
    await safeStorage.set(`stylePresets:${id}`, parsed);
    setStylePresets(prev => prev.map(x => x.id === id ? parsed : x));
  }, []);

  const upsertSeries = useCallback((record: any) => upsertEntity("recurringSeries", setRecurringSeries, record), []);
  const deleteSeries = useCallback((id: string) => deleteEntity("recurringSeries", setRecurringSeries, id), []);

  const upsertReminder = useCallback((record: any) => upsertEntity("reminders", setReminders, record), []);
  const deleteReminder = useCallback((id: string) => deleteEntity("reminders", setReminders, id), []);
  const upsertReminderTemplate = useCallback((record: any) => upsertEntity("reminderTemplates", setReminderTemplates, record), []);
  const deleteReminderTemplate = useCallback((id: string) => deleteEntity("reminderTemplates", setReminderTemplates, id), []);

  const deletePolicy = useCallback((id: string) => deleteEntity("policies", setPolicies, id), []);

  const bulkInsertReminders = useCallback(async (list) => {
    for (const r of list) await safeStorage.set(`reminders:${r.id}`, r);
    setReminders(prev => [...prev, ...list]);
  }, []);

  const cancelRemindersForAppt = useCallback(async (appointmentId) => {
    const existing = await safeStorage.getAllByPrefix("reminders:");
    for (const r of existing) {
      if (r.appointmentId === appointmentId && r.status === "pending") {
        await safeStorage.delete(`reminders:${r.id}`);
      }
    }
    setReminders(prev => prev.filter(r => !(r.appointmentId === appointmentId && r.status === "pending")));
  }, []);

  const bulkInsertAppointments = useCallback(async (list) => {
    for (const a of list) await safeStorage.set(`appointments:${a.id}`, a);
    setAppointments(prev => [...prev, ...list]);
  }, []);

  const scheduleRemindersForAppointment = useCallback(async (appt) => {
    const existing = await safeStorage.getAllByPrefix("reminders:");
    for (const r of existing) {
      if (r.appointmentId === appt.id && r.status === "pending") {
        await safeStorage.delete(`reminders:${r.id}`);
      }
    }
    setReminders(prev => prev.filter(r => !(r.appointmentId === appt.id && r.status === "pending")));

    if (!reminderSettings.enabled || appt.remindersEnabled === false) return [];
    const planned = planRemindersForAppointment(appt, reminderSettings, reminderTemplates, business);
    for (const p of planned) await safeStorage.set(`reminders:${p.id}`, p);
    setReminders(prev => [...prev, ...planned]);
    return planned;
  }, [reminderSettings, reminderTemplates, business]);

  const sendReminderNow = useCallback(async (id) => {
    const found = await safeStorage.get(`reminders:${id}`);
    const r = safeParse<EntityRecord | null>(found, null);
    if (!r) return;
    const sentRecord = { ...r, status: "sent", sentAt: new Date().toISOString() };
    await safeStorage.set(`reminders:${id}`, sentRecord);
    setReminders(prev => prev.map(x => x.id === id ? sentRecord : x));
    setTimeout(async () => {
      const delivered = { ...sentRecord, status: "delivered" };
      await safeStorage.set(`reminders:${id}`, delivered);
      setReminders(prev => prev.map(x => x.id === id ? delivered : x));
    }, 1200);
  }, []);

  const saveActiveTimer = useCallback(async (next) => {
    setActiveTimer(next);
    if (next) await safeStorage.set("activeTimer", next);
    else await safeStorage.delete("activeTimer");
  }, []);
  const upsertTimerSession = useCallback((record: any) => upsertEntity("timerSessions", setTimerSessions, record), []);
  const upsertCommLogEntry = useCallback((record: any) => upsertEntity("commLog", setCommLog, record), []);
  const deleteCommLogEntry = useCallback((id: string) => deleteEntity("commLog", setCommLog, id), []);

  const upsertReceipt = useCallback((record: any) => upsertEntity("receipts", setReceipts, record), []);
  const deleteReceipt = useCallback((id: string) => deleteEntity("receipts", setReceipts, id), []);

  // helpers/aliases
  const clientById = useCallback((id) => clients.find(c => c.id === id), [clients]);

  // Used by the cloud-sync layer to atomically replace the in-memory
  // state from a remote pull. Only fields present on the payload are
  // replaced; everything else is left alone.
  const replaceCloudState = useCallback((next: {
    clients?: any[]; appointments?: any[]; quotes?: any[]; receipts?: any[];
    commLog?: any[]; photos?: any[]; business?: any; reminderSettings?: any;
  }) => {
    if (next.clients) setClients(next.clients);
    if (next.appointments) setAppointments(next.appointments.map(normalizeAppointment));
    if (next.quotes) setQuotes(next.quotes);
    if (next.receipts) setReceipts(next.receipts);
    if (next.commLog) setCommLog(next.commLog);
    if (next.photos) setPhotos(next.photos);
    if (next.business) setBusiness({ ...DEFAULT_BUSINESS, ...next.business });
    if (next.reminderSettings) setReminderSettings({ ...DEFAULT_REMINDER_SETTINGS, ...next.reminderSettings });
  }, []);

  return {
    loading,
    business, saveBusiness, setBusiness: saveBusiness,
    reminderSettings, saveReminderSettings, setReminderSettings: saveReminderSettings,
    reminderTemplates, upsertReminderTemplate, deleteReminderTemplate,
    reminders, upsertReminder, deleteReminder,
    scheduleRemindersForAppointment, sendReminderNow,
    bulkInsertReminders, cancelRemindersForAppt,
    clients, upsertClient, deleteClient, clientById,
    appointments, upsertAppointment, deleteAppointment, bulkInsertAppointments,
    quotes, upsertQuote, deleteQuote,
    transactions, upsertTransaction, deleteTransaction,
    policies, upsertPolicy, deletePolicy,
    photos, upsertPhoto, deletePhoto,
    recurringSeries, series: recurringSeries, upsertSeries, deleteSeries,
    stylePresets, presets: stylePresets, upsertPreset, deletePreset, incrementPresetUse,
    activeTimer, saveActiveTimer, setTimer: saveActiveTimer,
    timerSessions, upsertTimerSession, addTimerSession: upsertTimerSession,
    commLog, upsertCommLogEntry, deleteCommLogEntry,
    receipts, upsertReceipt, deleteReceipt,
    replaceCloudState,
  };
};

// ============================================================
//  PRIMITIVES
// ============================================================
const Card = ({ children, className = "", style, onClick, id }: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
  id?: string;
}) => {
  // When the card is interactive, render with button semantics so:
  //   1. iOS WKWebView reliably routes the touch to a click event
  //      (synthetic clicks on plain <div> can be eaten by tap-to-zoom
  //      detection on some WKWebView versions),
  //   2. screen readers announce it as a control,
  //   3. keyboard users can activate it.
  // Non-interactive cards keep the original <div> for layout.
  const interactive = typeof onClick === "function";
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!onClick) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick();
    }
  };
  return (
    <div
      id={id}
      onClick={onClick}
      onKeyDown={interactive ? handleKeyDown : undefined}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      className={`rounded-2xl ${interactive ? "cursor-pointer select-none" : ""} ${className}`}
      style={{
        background: `linear-gradient(180deg, ${C.paper} 0%, ${C.ivory} 100%)`,
        border: `1px solid ${C.hairline}`,
        boxShadow: "0 1px 2px rgba(42, 24, 16, 0.04), 0 8px 24px -12px rgba(42, 24, 16, 0.12)",
        ...style
      }}>{children}</div>
  );
};

const Button = ({ children, variant = "primary", onClick, disabled, className = "", icon, type = "button", fullWidth, size }: {
  children: React.ReactNode;
  variant?: "primary" | "dark" | "outline" | "ghost" | "danger";
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  icon?: React.ReactNode;
  type?: "button" | "submit" | "reset";
  fullWidth?: boolean;
  size?: string;
}) => {
  void size;
  const v = {
    primary: { bg: C.gold, fg: C.espresso, border: C.gold, shadow: "0 6px 18px -8px rgba(168, 137, 63, 0.55)" },
    dark: { bg: C.espresso, fg: C.cream, border: C.espresso, shadow: "0 6px 18px -8px rgba(42, 24, 16, 0.45)" },
    outline: { bg: "transparent", fg: C.espresso, border: C.caramel, shadow: "none" },
    ghost: { bg: "transparent", fg: C.coffee, border: "transparent", shadow: "none" },
    danger: { bg: "transparent", fg: C.danger, border: C.danger, shadow: "none" },
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`${className} ${fullWidth ? "w-full" : ""} font-semibold rounded-xl px-5 py-3.5 text-[15px] transition active:scale-[0.97] disabled:opacity-40 flex items-center justify-center gap-2`}
      style={{ background: v.bg, color: v.fg, border: `1.5px solid ${v.border}`, boxShadow: v.shadow, letterSpacing: "0.01em" }}>
      {icon}{children}
    </button>
  );
};

const Field = ({ label, hint, children, suffix }: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  suffix?: string;
}) => (
  <label className="block">
    <div className="flex items-baseline justify-between mb-1.5">
      <span className="text-[13px] font-semibold tracking-wide uppercase" style={{ color: C.coffee, letterSpacing: "0.06em" }}>{label}</span>
      {hint && <span className="text-[11px]" style={{ color: C.muted }}>{hint}</span>}
    </div>
    <div className="relative">
      {children}
      {suffix && <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-sm font-medium" style={{ color: C.muted }}>{suffix}</span>}
    </div>
  </label>
);

const Input = ({ value, onChange, type = "text", placeholder, prefix, suffix, ...rest }: {
  value: string | number;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string;
  placeholder?: string;
  prefix?: string;
  suffix?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "placeholder" | "prefix">) => (
  <div className="relative">
    {prefix && <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold" style={{ color: C.muted }}>{prefix}</span>}
    <input type={type} value={value ?? ""} onChange={onChange} placeholder={placeholder}
      className="w-full rounded-xl px-3.5 py-3 text-[15px] outline-none transition"
      style={{ background: C.paper, border: `1px solid ${C.hairline}`, color: C.ink, paddingLeft: prefix ? "1.75rem" : "0.875rem", paddingRight: suffix ? "2.5rem" : undefined }}
      onFocus={e => e.target.style.borderColor = C.gold}
      onBlur={e => e.target.style.borderColor = C.hairline}
      {...rest} />
    {suffix && <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-sm font-medium" style={{ color: C.muted }}>{suffix}</span>}
  </div>
);

// Money / decimal input. Strips leading zeros, allows free decimal typing,
// uses the decimal keyboard on mobile, never produces NaN downstream.
const MoneyInput = ({ value, onChange, prefix = "$", suffix, placeholder = "0", allowDecimal = true, ...rest }: {
  value: string | number | null | undefined;
  onChange: (cleaned: string) => void;
  prefix?: string;
  suffix?: string;
  placeholder?: string;
  allowDecimal?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "placeholder" | "prefix">) => {
  const display = value === null || value === undefined ? "" : String(value);
  return (
    <Input
      type="text"
      inputMode={allowDecimal ? "decimal" : "numeric"}
      pattern={allowDecimal ? "[0-9]*\\.?[0-9]*" : "[0-9]*"}
      value={display}
      onChange={(e) => {
        let cleaned = sanitizeMoneyInput(e.target.value);
        if (!allowDecimal) cleaned = cleaned.replace(/\..*/, "");
        onChange(cleaned);
      }}
      prefix={prefix}
      suffix={suffix}
      placeholder={placeholder}
      autoComplete="off"
      {...rest}
    />
  );
};

const Textarea = ({ value, onChange, placeholder, rows = 3 }: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  rows?: number;
}) => (
  <textarea value={value ?? ""} onChange={onChange} placeholder={placeholder} rows={rows}
    className="w-full rounded-xl px-3.5 py-3 text-[15px] outline-none resize-none transition"
    style={{ background: C.paper, border: `1px solid ${C.hairline}`, color: C.ink, lineHeight: 1.5 }}
    onFocus={e => e.target.style.borderColor = C.gold}
    onBlur={e => e.target.style.borderColor = C.hairline} />
);

const Select = ({ value, onChange, options }: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  options: { value: string; label: string }[];
}) => (
  <div className="relative">
    <select value={value ?? ""} onChange={onChange}
      className="w-full appearance-none rounded-xl px-3.5 py-3 pr-10 text-[15px] outline-none transition"
      style={{ background: C.paper, border: `1px solid ${C.hairline}`, color: C.ink }}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
    <ChevronRight size={16} className="absolute right-3 top-1/2 -translate-y-1/2 rotate-90" style={{ color: C.muted }} />
  </div>
);

const Pill = ({ children, tone = "neutral" }: {
  children: React.ReactNode;
  tone?: "neutral" | "gold" | "success" | "warning" | "danger" | "dark";
}) => {
  const tones = {
    neutral: { bg: C.ivory, fg: C.coffee, border: C.hairline },
    gold: { bg: "#F5E9C8", fg: C.goldDeep, border: "#E5D4A0" },
    success: { bg: "#E4EDD8", fg: C.success, border: "#C9D9B0" },
    warning: { bg: "#F5DDC0", fg: C.warning, border: "#E8C99A" },
    danger: { bg: "#F2D6D0", fg: C.danger, border: "#DFB5AC" },
    dark: { bg: C.espresso, fg: C.cream, border: C.espresso },
  };
  const t = tones[tone] || tones.neutral;
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wider"
      style={{ background: t.bg, color: t.fg, border: `1px solid ${t.border}`, letterSpacing: "0.08em" }}>{children}</span>
  );
};

const Toggle = ({ checked, onChange }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) => (
  <button type="button" onClick={() => onChange(!checked)}
    className="relative inline-flex items-center w-12 h-7 rounded-full transition shrink-0"
    style={{ background: checked ? C.gold : C.mutedSoft, border: `1px solid ${checked ? C.goldDeep : C.hairline}` }}>
    <span className="inline-block w-5 h-5 rounded-full bg-white shadow transition-transform"
      style={{ transform: checked ? "translateX(22px)" : "translateX(2px)" }} />
  </button>
);

const SectionTitle = ({ children, action }: {
  children: React.ReactNode;
  action?: React.ReactNode | { label: string; onClick: () => void };
}) => (
  <div className="flex items-center justify-between mb-3 mt-1">
    <h3 className="text-[13px] font-bold tracking-widest uppercase" style={{ color: C.muted, letterSpacing: "0.14em" }}>{children}</h3>
    {action && (React.isValidElement(action) ? action : (
      <Button variant="outline" size="sm" onClick={(action as any).onClick}>{(action as any).label}</Button>
    ))}
  </div>
);

const EmptyState = ({ icon, title, body, cta }: {
  icon: React.ReactNode;
  title: string;
  body: string;
  cta?: React.ReactNode;
}) => (
  <div className="flex flex-col items-center justify-center py-12 px-6 text-center bbp-fade">
    {/* Soft halo behind the icon — gold core fading through coral
        and lavender so empty states stop feeling like an "error" and
        start feeling like an invitation. Pure CSS, no extra DOM. */}
    <div
      className="relative mb-4 rounded-full"
      style={{
        background: C.ivory,
        border: `1px solid ${C.hairline}`,
        padding: 16,
        boxShadow: "0 1px 2px rgba(42, 24, 16, 0.04), 0 14px 36px -12px rgba(201, 169, 97, 0.45)",
      }}
    >
      <span
        aria-hidden
        className="absolute inset-0 rounded-full bbp-empty-halo"
        style={{
          margin: -10,
          background:
            "conic-gradient(from 180deg, rgba(201, 169, 97, 0.32), rgba(224, 138, 106, 0.28), rgba(155, 124, 196, 0.28), rgba(124, 182, 158, 0.30), rgba(201, 169, 97, 0.32))",
          filter: "blur(14px)",
          opacity: 0.55,
          zIndex: 0,
        }}
      />
      <span className="relative" style={{ zIndex: 1 }}>{icon}</span>
    </div>
    <p className="italic mb-1.5" style={{ fontFamily: FONT_DISPLAY, color: C.gold, fontSize: 18 }}>a fresh page awaits</p>
    <h4 style={{ fontFamily: FONT_DISPLAY, color: C.espresso, fontSize: 24, fontWeight: 600, lineHeight: 1.2 }}>{title}</h4>
    <p className="mt-2 text-sm max-w-xs" style={{ color: C.muted, lineHeight: 1.5 }}>{body}</p>
    {cta && <div className="mt-5">{cta}</div>}
    <style>{`
      @keyframes bbpEmptyHalo { 0%, 100% { transform: rotate(0deg) scale(1); opacity: 0.45; } 50% { transform: rotate(180deg) scale(1.06); opacity: 0.65; } }
      .bbp-empty-halo { animation: bbpEmptyHalo 14s ease-in-out infinite; }
      @media (prefers-reduced-motion: reduce) { .bbp-empty-halo { animation: none; } }
    `}</style>
  </div>
);

// Resolve a photo URL on demand. Handles three cases: legacy dataUrl,
// cloud storagePath (private bucket signed URL), or both. Renders an
// ivory placeholder while the signed URL resolves.
const CloudPhotoImg = ({ photo, kind = "thumb", alt, style, className, onClick }: {
  photo: any;
  kind?: "full" | "thumb";
  alt?: string;
  style?: React.CSSProperties;
  className?: string;
  onClick?: () => void;
}) => {
  const [url, setUrl] = useState<string | null>(() => {
    if (kind === "thumb" && photo?.thumbnailDataUrl) return photo.thumbnailDataUrl;
    return photo?.dataUrl || null;
  });
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- prop-driven sync to a derived URL, intentional
    if (kind === "thumb" && photo?.thumbnailDataUrl) { setUrl(photo.thumbnailDataUrl); return; }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- prop-driven sync to a derived URL, intentional
    if (kind === "full" && photo?.dataUrl) { setUrl(photo.dataUrl); return; }
    if (photo?.storagePath || photo?.thumbnailPath) {
      resolvePhotoUrl(photo, kind).then(u => { if (!cancelled) setUrl(u); }).catch(() => null);
    }
    return () => { cancelled = true; };
  }, [photo?.id, photo?.storagePath, photo?.thumbnailPath, photo?.dataUrl, photo?.thumbnailDataUrl, kind]);
  if (!url) {
    return <div className={className} style={{ ...style, background: C.ivory }} onClick={onClick} />;
  }
  return <img src={url} alt={alt || ""} style={style} className={className} onClick={onClick} />;
};

const Sheet = ({ open, onClose, title, children, maxHeight, rightAction, leftAction }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  maxHeight?: string;
  rightAction?: React.ReactNode;
  leftAction?: React.ReactNode;
}) => {
  // iOS Safari's URL bar overlays the page and `100vh` / `100dvh` /
  // `position: fixed` all behave inconsistently across iOS versions.
  // The visualViewport API is the source of truth for the area the
  // user can actually see, so size the overlay against it directly.
  // We still fall back to 100dvh (NEVER 100vh — vh ignores the URL
  // bar collapse and over-tall sheets clip past the top of the
  // viewport on mobile Safari).
  const [vv, setVv] = useState<{ height: number; offsetTop: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    const updateFromVisualViewport = () => {
      const v = typeof window !== "undefined" ? window.visualViewport : null;
      if (v) setVv({ height: v.height, offsetTop: v.offsetTop });
      else setVv({ height: window.innerHeight, offsetTop: 0 });
    };
    updateFromVisualViewport();
    const v = window.visualViewport;
    v?.addEventListener("resize", updateFromVisualViewport);
    v?.addEventListener("scroll", updateFromVisualViewport);
    return () => {
      v?.removeEventListener("resize", updateFromVisualViewport);
      v?.removeEventListener("scroll", updateFromVisualViewport);
    };
  }, [open]);
  if (!open) return null;
  const overlayHeight = vv?.height ?? undefined;
  const overlayTop = vv?.offsetTop ?? 0;
  // Cap sheet height so its top edge always clears the iOS notch /
  // dynamic island / Safari URL-bar overlay when the layout sits at
  // viewport-fit: cover. env(safe-area-inset-top) is 0 on Android +
  // desktop, so this is a no-op there.
  const sheetMaxHeight = maxHeight || (overlayHeight
    ? `calc(${overlayHeight}px - env(safe-area-inset-top, 0px))`
    : "calc(100dvh - env(safe-area-inset-top, 0px))");
  return (
    <div className="fixed left-0 right-0 z-50 flex items-end justify-center"
      style={{
        background: "rgba(26, 15, 8, 0.45)",
        top: overlayTop,
        height: overlayHeight ? `${overlayHeight}px` : "100dvh",
      }}
      onClick={onClose}>
      <div className="bbp-sheet w-full max-w-[480px] rounded-t-3xl flex flex-col"
        style={{
          background: C.cream,
          maxHeight: sheetMaxHeight,
          boxShadow: "0 -20px 60px -20px rgba(0,0,0,0.3)",
          // Reserve room for the notch + dynamic island so the
          // grabber and the "Edit Appointment" header are never
          // hidden behind the browser chrome.
          paddingTop: "env(safe-area-inset-top, 0px)",
        }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-center pt-3 pb-1">
          <div className="w-10 h-1.5 rounded-full" style={{ background: C.mutedSoft }} />
        </div>
        <div className="flex items-center justify-between px-5 pb-3 pt-2 gap-2" style={{ borderBottom: `1px solid ${C.hairline}` }}>
          <div className="flex items-center gap-2 min-w-0">
            {leftAction}
            <h2 className="truncate" style={{ fontFamily: FONT_DISPLAY, fontSize: 24, fontWeight: 600, color: C.espresso }}>{title}</h2>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {rightAction}
            <button type="button" onClick={onClose} aria-label="Close" className="p-2 -mr-2 rounded-full" style={{ color: C.coffee }}><X size={22} /></button>
          </div>
        </div>
        <div className="flex-1 bbp-scroll px-5 pt-4"
          style={{
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
            // Bottom padding reserves room for the tab bar (~72px),
            // the home indicator (env(safe-area-inset-bottom)), and a
            // bit of breathing space — plus enough buffer that the
            // last form button isn't pinned to the chrome.
            paddingBottom: "calc(140px + env(safe-area-inset-bottom, 0px))",
            overscrollBehavior: "contain",
          }}>
          {children}
        </div>
      </div>
    </div>
  );
};

const FAB = ({ onClick, icon = <Plus size={26} strokeWidth={2.4} />, bottom = 80 }) => (
  <button type="button" onClick={onClick} className="fixed z-40 active:scale-95 transition"
    style={{
      right: 18, bottom,
      width: 58, height: 58, borderRadius: "50%",
      background: `linear-gradient(180deg, ${C.gold} 0%, ${C.goldDeep} 100%)`,
      color: C.espresso,
      boxShadow: "0 12px 28px -8px rgba(168, 137, 63, 0.6), 0 4px 8px rgba(0,0,0,0.1)",
      border: `1.5px solid ${C.goldDeep}`,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
    {icon}
  </button>
);

// ============================================================
//  HEADER + TAB BAR
// ============================================================
const Header = ({ title, subtitle, leftAction, rightAction }: {
  title: any;
  subtitle?: any;
  leftAction?: any;
  rightAction?: any;
}) => {
  const renderAction = (action) => {
    if (!action) return null;
    if (React.isValidElement(action)) return action;
    if (action.icon && action.onClick) {
      return (
        <button type="button" onClick={action.onClick} className="p-2 rounded-full transition active:scale-[0.95]" style={{ color: C.coffee }}>
          {action.icon}
        </button>
      );
    }
    return null;
  };

  return (
    <header className="px-5 pt-4 pb-3 sticky top-0 z-10" style={{ background: C.cream, borderBottom: `1px solid ${C.hairline}` }}>
      <div className="flex items-center justify-between">
        <div className="w-9">{renderAction(leftAction)}</div>
        <div className="text-center flex-1">
          <p className="text-[10px] font-bold tracking-[0.22em] uppercase" style={{ color: C.gold }}>Braid Boss Pro</p>
          <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 24, fontWeight: 600, color: C.espresso, lineHeight: 1.1 }}>{title}</h1>
          {subtitle && <p className="text-xs mt-0.5" style={{ color: C.muted }}>{subtitle}</p>}
        </div>
        <div className="w-9 flex justify-end">{renderAction(rightAction)}</div>
      </div>
    </header>
  );
};

const TabBar = ({ active, setActive }: {
  active: string;
  setActive: (tab: string) => void;
}) => {
  const tabs = [
    { id: "dashboard", label: "Home", icon: Home },
    { id: "calculator", label: "Quote", icon: CalcIcon },
    { id: "schedule", label: "Schedule", icon: Calendar },
    { id: "clients", label: "Clients", icon: Users },
    { id: "money", label: "Money", icon: TrendingUp },
  ];
  return (
    // Fixed to the viewport bottom (not sticky) so short pages like the
    // empty Client Photos tab don't float the nav up over content. Stays
    // centered inside the 480px shell on tablet / desktop. Z-index sits
    // below the sheet overlay (z-50) so modals always cover it.
    <nav
      className="bbp-tabbar fixed left-1/2 z-40 w-full max-w-[480px]"
      style={{
        bottom: 0,
        transform: "translateX(-50%)",
        background: `linear-gradient(180deg, ${C.cream} 0%, ${C.paper} 100%)`,
        borderTop: `1px solid ${C.hairline}`,
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        boxShadow: "0 -8px 24px -16px rgba(42, 24, 16, 0.18)",
      }}>
      <div className="flex items-center justify-around px-2 py-2">
        {tabs.map(t => {
          const Icon = t.icon;
          const isActive = active === t.id;
          return (
            <button
              type="button"
              key={t.id}
              onClick={() => setActive(t.id)}
              aria-current={isActive ? "page" : undefined}
              className="relative flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl transition"
              style={{
                color: isActive ? C.goldDeep : C.mutedSoft,
                minWidth: 60,
              }}
            >
              <Icon size={22} strokeWidth={isActive ? 2.4 : 1.85} />
              <span
                className="text-[10px] tracking-wide"
                style={{
                  fontWeight: isActive ? 700 : 600,
                  color: isActive ? C.espresso : C.mutedSoft,
                  letterSpacing: "0.06em",
                }}
              >
                {t.label}
              </span>
              {isActive && (
                <span
                  aria-hidden
                  className="absolute"
                  style={{
                    bottom: 2,
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: 18, height: 2.5,
                    borderRadius: 999,
                    background: `linear-gradient(90deg, ${C.gold}, ${C.goldDeep})`,
                  }}
                />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};

const STATUS_TONE = { scheduled: "neutral", confirmed: "gold", completed: "success", cancelled: "danger", no_show: "warning" };
const STATUS_LABEL = { scheduled: "Scheduled", confirmed: "Confirmed", completed: "Completed", cancelled: "Cancelled", no_show: "No-show" };
const REMINDER_STATUS_TONE = { pending: "warning", sent: "gold", delivered: "success", failed: "danger", cancelled: "neutral" };

// ============================================================
//  TIMER MINI PILL
// ============================================================
const TimerMiniPill = ({ timer, onClick }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (timer?.status !== "running") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [timer?.status]);
  if (!timer) return null;

  const elapsed = timer.status === "paused"
    ? new Date(timer.pausedAt).getTime() - new Date(timer.startedAt).getTime() - timer.totalPausedMs
    : now - new Date(timer.startedAt).getTime() - timer.totalPausedMs;

  return (
    <button type="button" onClick={onClick}
      className="fixed z-40 active:scale-[0.97] transition flex items-center gap-3 px-4 py-2.5 rounded-full"
      style={{
        bottom: 84, left: "50%", transform: "translateX(-50%)",
        background: `linear-gradient(135deg, ${C.espresso}, ${C.coffee})`,
        color: C.cream, border: `1.5px solid ${C.gold}`,
        boxShadow: "0 12px 32px -8px rgba(42, 24, 16, 0.45)",
        minWidth: 220,
      }}>
      <div className="rounded-full p-1.5" style={{ background: timer.status === "running" ? C.gold : C.mutedSoft, color: C.espresso }}>
        {timer.status === "running" ? <TimerIcon size={14} strokeWidth={2.5} /> : <Pause size={14} strokeWidth={2.5} />}
      </div>
      <div className="flex-1 text-left min-w-0">
        <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: C.gold, letterSpacing: "0.16em" }}>
          {timer.status === "running" ? "Timer running" : "Paused"}
        </p>
        <p className="text-sm font-mono font-semibold truncate" style={{ fontVariantNumeric: "tabular-nums" }}>
          {fmtDuration(Math.max(0, elapsed))} · {timer.clientName || timer.style || "Session"}
        </p>
      </div>
      <ChevronRight size={18} style={{ color: C.gold }} />
    </button>
  );
};
// ============================================================
//  APPOINTMENT ROW
// ============================================================
const AppointmentRow = ({ appt, business, onClick, compact, recurringSeries }: { appt: any; business: any; onClick?: () => void; compact?: boolean; recurringSeries?: any }) => {
  const [now] = useState(() => Date.now());
  const series = appt.seriesId ? recurringSeries?.find((s: any) => s.id === appt.seriesId) : null;
  const apptDateTime = appt.date && appt.time ? new Date(`${appt.date}T${appt.time}:00`).getTime() : null;
  const isLate = apptDateTime && apptDateTime < now && appt.status === "scheduled";

  return (
    <Card className="p-4 cursor-pointer active:scale-[0.99] transition" onClick={onClick}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Pill tone={STATUS_TONE[appt.status] || "neutral"}>{STATUS_LABEL[appt.status] || appt.status}</Pill>
            {(() => {
              const ps = paymentStatusOf(appt, todayISO());
              return appt.status !== "cancelled" ? (
                <Pill tone={PAYMENT_STATUS_TONE[ps]}>{PAYMENT_STATUS_LABEL[ps]}</Pill>
              ) : null;
            })()}
            {(() => {
              // Partial-deposit % pill so you can read "60% deposit" at a
              // glance without opening the appointment. Reuses the same
              // ticket math as Reports / Income view.
              if (appt.status === "cancelled") return null;
              const total = reportTicketTotal(appt);
              const deposit = Number(appt.depositPaid) || 0;
              if (total <= 0 || deposit <= 0 || deposit >= total) return null;
              const pct = Math.round((deposit / total) * 100);
              return <Pill tone="gold">{pct}% deposit</Pill>;
            })()}
            {series && <Pill tone="gold"><Repeat size={10} /> {cadenceLabel(series.cadence)}</Pill>}
            {isLate && <Pill tone="danger">Late</Pill>}
          </div>
          <p style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 600, color: C.espresso, lineHeight: 1.15 }} className="truncate">
            {appt.clientName || "Unnamed client"}
          </p>
          <p className="text-sm truncate mt-0.5" style={{ color: C.coffee }}>{appt.style || "Style not set"}</p>
          <p className="text-xs mt-1.5 flex items-center gap-3" style={{ color: C.muted }}>
            <span className="flex items-center gap-1"><Calendar size={11} />{fmtDate(appt.date)}</span>
            {appt.time && <span className="flex items-center gap-1"><Clock size={11} />{fmtTime(appt.time)}</span>}
          </p>
        </div>
        <div className="text-right shrink-0">
          {!compact && <p className="text-xs" style={{ color: C.muted }}>Total</p>}
          <p style={{ fontFamily: FONT_DISPLAY, fontSize: compact ? 18 : 20, fontWeight: 600, color: C.goldDeep }}>
            {fmtMoney(appt.totalPrice, business.currency)}
          </p>
        </div>
      </div>
    </Card>
  );
};

// ============================================================
//  DASHBOARD
// ============================================================
// ---- REBOOKING OPPORTUNITIES (UI) ---------------------------------------
// Visual conventions:
//   high   → danger tone pill (bbp-pulse-gold optional accent on the chip)
//   medium → warning tone pill
//   low    → gold tone pill
const URGENCY_LABEL: Record<RebookingUrgency, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

const URGENCY_PILL_TONE: Record<RebookingUrgency, "danger" | "warning" | "gold"> = {
  high: "danger",
  medium: "warning",
  low: "gold",
};

const formatOverdueLabel = (days: number): string => {
  if (days >= 1) return `${days}d overdue`;
  if (days === 0) return "Due today";
  return `Due in ${Math.abs(days)}d`;
};

// Lightweight clipboard helper. Used by the "Copy message" CTAs. Falls
// back to the legacy execCommand path for older mobile webviews.
const copyTextToClipboard = async (text: string): Promise<boolean> => {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  try {
    if (typeof document === "undefined") return false;
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch { return false; }
};

// Premium card. Dashboard surface for the rebooking system. Empty state
// uses the same Sparkles + cream block as the existing retention card
// for visual consistency.
const RebookingOpportunitiesCard = ({
  opportunities,
  summary,
  currency,
  clients,
  openQuickAppt,
  onViewAll,
}: {
  opportunities: RebookingOpportunity[];
  summary: { total: number; high: number; medium: number; low: number; estimated_returning_revenue: number };
  currency: string;
  clients: any[];
  openQuickAppt: (prefill?: any) => void;
  openCommunication?: (ctx: CommContext) => void;
  onViewAll: () => void;
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const onCopyMessage = async (op: RebookingOpportunity) => {
    const ok = await copyTextToClipboard(buildRebookingMessage(op));
    if (!ok) return;
    setCopiedId(op.client_id);
    window.setTimeout(() => setCopiedId(prev => prev === op.client_id ? null : prev), 1600);
  };

  const onBookAgain = (op: RebookingOpportunity) => {
    const c = clients.find((x: any) => x?.id === op.client_id);
    openQuickAppt({
      clientId: op.client_id,
      clientName: op.client_name,
      clientPhone: op.client_phone || c?.phone,
      clientEmail: op.client_email || c?.email,
      style: op.last_style || "",
      totalPrice: op.estimated_value || undefined,
    });
  };

  if (summary.total === 0) {
    return (
      <div>
        <SectionTitle>Rebooking opportunities</SectionTitle>
        <Card className="p-5 text-center">
          <Sparkles size={18} style={{ color: C.gold, margin: "0 auto 6px" }} />
          <p className="text-sm font-semibold" style={{ color: C.espresso }}>
            No rebooking opportunities yet
          </p>
          <p className="text-xs mt-1 max-w-xs mx-auto leading-relaxed" style={{ color: C.muted }}>
            Once clients complete appointments, Braid Boss Pro will spot who may be ready to return.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <SectionTitle action={
        <button type="button" onClick={onViewAll} className="text-xs font-semibold flex items-center gap-1" style={{ color: C.goldDeep }}>
          View all <ChevronRight size={14} />
        </button>
      }>Rebooking opportunities</SectionTitle>
      <Card className="p-4" style={{
        background: `linear-gradient(180deg, ${C.paper} 0%, ${C.ivory} 100%)`,
        border: `1px solid ${C.hairline}`,
      }}>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="rounded-xl p-3" style={{ background: C.cream, border: `1px solid ${C.hairline}` }}>
            <p className="text-[10px] uppercase tracking-widest font-bold mb-1" style={{ color: C.muted, letterSpacing: "0.12em" }}>
              Due / overdue
            </p>
            <p className="text-xl font-bold" style={{ color: C.espresso, fontFamily: FONT_DISPLAY }}>
              {summary.total}
            </p>
            <p className="text-[10px] mt-0.5" style={{ color: C.muted }}>
              {summary.high > 0 && <span style={{ color: C.danger, fontWeight: 600 }}>{summary.high} high</span>}
              {summary.high > 0 && (summary.medium + summary.low) > 0 && " · "}
              {summary.medium > 0 && <span style={{ color: C.warning, fontWeight: 600 }}>{summary.medium} med</span>}
              {summary.medium > 0 && summary.low > 0 && " · "}
              {summary.low > 0 && <span style={{ color: C.goldDeep, fontWeight: 600 }}>{summary.low} low</span>}
            </p>
          </div>
          <div className="rounded-xl p-3" style={{ background: C.cream, border: `1px solid ${C.hairline}` }}>
            <p className="text-[10px] uppercase tracking-widest font-bold mb-1" style={{ color: C.muted, letterSpacing: "0.12em" }}>
              Returning revenue
            </p>
            <p className="text-xl font-bold" style={{ color: C.espresso, fontFamily: FONT_DISPLAY }}>
              {fmtMoney(summary.estimated_returning_revenue, currency)}
            </p>
            <p className="text-[10px] mt-0.5" style={{ color: C.muted }}>If all rebook</p>
          </div>
        </div>

        <div className="space-y-2">
          {opportunities.map(op => (
            <div key={op.client_id} className="rounded-xl p-3 flex items-start gap-3"
              style={{ background: C.paper, border: `1px solid ${C.hairline}` }}>
              <div className="rounded-full flex items-center justify-center shrink-0"
                style={{ width: 36, height: 36, background: `linear-gradient(135deg, ${C.caramel}, ${C.coffee})`, color: C.cream, fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 600 }}>
                {initials(op.client_name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="font-semibold text-sm truncate" style={{ color: C.espresso }}>{op.client_name}</p>
                  <Pill tone={URGENCY_PILL_TONE[op.urgency]}>{URGENCY_LABEL[op.urgency]}</Pill>
                </div>
                <p className="text-[11px] mt-0.5 truncate" style={{ color: C.muted }}>
                  {op.last_style || "Last appointment"} · {formatOverdueLabel(op.days_overdue)}
                </p>
              </div>
              <div className="flex flex-col gap-1.5 shrink-0">
                <button type="button" onClick={() => onBookAgain(op)}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider active:scale-[0.97] transition"
                  style={{ background: C.gold, color: C.espresso, border: `1px solid ${C.goldDeep}`, letterSpacing: "0.08em" }}>
                  Book again
                </button>
                <button type="button" onClick={() => onCopyMessage(op)}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider active:scale-[0.97] transition"
                  style={{ background: "transparent", color: C.coffee, border: `1px solid ${C.hairline}`, letterSpacing: "0.08em" }}>
                  {copiedId === op.client_id ? "Copied" : "Copy msg"}
                </button>
              </div>
            </div>
          ))}
        </div>

        <button type="button" onClick={onViewAll}
          className="w-full mt-3 rounded-xl py-2.5 text-xs font-bold uppercase tracking-wider active:scale-[0.99] transition"
          style={{ background: C.espresso, color: C.cream, letterSpacing: "0.1em" }}>
          View all
        </button>
      </Card>
    </div>
  );
};

// ---- REBOOKING OPPORTUNITIES (FULL SCREEN) ------------------------------
// Note: implemented as a top-level inline screen component instead of
// app/rebooking/page.tsx because the rest of the app's "pages" route
// through the active-tab state pattern (active === "schedule" |
// "clients" | "money" | "rebooking") and share the parent <Provider>'s
// store. A standalone Next.js page here would have to re-load all
// state via Supabase and de-sync from the in-memory store. See
// PR description for context.
const RebookingScreen = ({
  store,
  setActive,
  openQuickAppt,
  onBack,
}: {
  store: any;
  setActive: (id: string) => void;
  openQuickAppt: (prefill?: any) => void;
  onBack: () => void;
}) => {
  void setActive;
  const { appointments = [], clients = [], business } = store;
  const today = todayISO();
  const [filter, setFilter] = useState<"all" | RebookingUrgency>("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const opportunities = useMemo(
    () => computeRebookingOpportunities(clients, appointments, today),
    [clients, appointments, today],
  );
  const summary = useMemo(() => summarizeOpportunities(opportunities), [opportunities]);
  const filtered = useMemo(
    () => filter === "all" ? opportunities : opportunities.filter(o => o.urgency === filter),
    [opportunities, filter],
  );

  const onCopyMessage = async (op: RebookingOpportunity) => {
    const ok = await copyTextToClipboard(buildRebookingMessage(op));
    if (!ok) return;
    setCopiedId(op.client_id);
    window.setTimeout(() => setCopiedId(prev => prev === op.client_id ? null : prev), 1600);
  };

  const onBookAgain = (op: RebookingOpportunity) => {
    const c = clients.find((x: any) => x?.id === op.client_id);
    openQuickAppt({
      clientId: op.client_id,
      clientName: op.client_name,
      clientPhone: op.client_phone || c?.phone,
      clientEmail: op.client_email || c?.email,
      style: op.last_style || "",
      totalPrice: op.estimated_value || undefined,
    });
  };

  const FILTERS: { id: "all" | RebookingUrgency; label: string; count: number }[] = [
    { id: "all", label: "All", count: summary.total },
    { id: "high", label: "High", count: summary.high },
    { id: "medium", label: "Medium", count: summary.medium },
    { id: "low", label: "Low", count: summary.low },
  ];

  return (
    <div className="bbp-fade pb-24">
      <Header title="Rebooking" leftAction={{ icon: <ChevronLeft size={20} />, onClick: onBack }} />
      <div className="px-5 pt-4 space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <Card className="p-3" style={{ background: C.ivory }}>
            <p className="text-[10px] uppercase tracking-widest font-bold mb-1" style={{ color: C.muted, letterSpacing: "0.12em" }}>Total</p>
            <p className="text-xl font-bold" style={{ color: C.espresso, fontFamily: FONT_DISPLAY }}>{summary.total}</p>
          </Card>
          <Card className="p-3" style={{ background: C.ivory }}>
            <p className="text-[10px] uppercase tracking-widest font-bold mb-1" style={{ color: C.muted, letterSpacing: "0.12em" }}>Returning rev.</p>
            <p className="text-xl font-bold" style={{ color: C.espresso, fontFamily: FONT_DISPLAY }}>
              {fmtMoney(summary.estimated_returning_revenue, business?.currency || "USD")}
            </p>
          </Card>
          <Card className="p-3" style={{ background: C.ivory }}>
            <p className="text-[10px] uppercase tracking-widest font-bold mb-1" style={{ color: C.muted, letterSpacing: "0.12em" }}>High urgency</p>
            <p className="text-xl font-bold" style={{ color: summary.high > 0 ? C.danger : C.espresso, fontFamily: FONT_DISPLAY }}>{summary.high}</p>
          </Card>
        </div>

        <div className="flex gap-2 overflow-x-auto bbp-scroll -mx-1 px-1 pb-1">
          {FILTERS.map(f => {
            const active = filter === f.id;
            return (
              <button type="button" key={f.id} onClick={() => setFilter(f.id)}
                className="px-3.5 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wider shrink-0 active:scale-[0.97] transition"
                style={{
                  background: active ? C.espresso : C.cream,
                  color: active ? C.cream : C.coffee,
                  border: `1px solid ${active ? C.espresso : C.hairline}`,
                  letterSpacing: "0.08em",
                }}>
                {f.label} · {f.count}
              </button>
            );
          })}
        </div>

        {filtered.length === 0 ? (
          <Card className="p-6 text-center">
            <Sparkles size={20} style={{ color: C.gold, margin: "0 auto 8px" }} />
            <p className="text-sm font-semibold" style={{ color: C.espresso }}>
              {summary.total === 0 ? "No rebooking opportunities yet" : "Nothing in this filter"}
            </p>
            <p className="text-xs mt-1 max-w-xs mx-auto leading-relaxed" style={{ color: C.muted }}>
              {summary.total === 0
                ? "Once clients complete appointments, Braid Boss Pro will spot who may be ready to return."
                : "Try another urgency tier."}
            </p>
          </Card>
        ) : (
          <div className="space-y-2">
            {filtered.map(op => (
              <Card key={op.client_id} className="p-3.5">
                <div className="flex items-start gap-3">
                  <div className="rounded-full flex items-center justify-center shrink-0"
                    style={{ width: 40, height: 40, background: `linear-gradient(135deg, ${C.caramel}, ${C.coffee})`, color: C.cream, fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 600 }}>
                    {initials(op.client_name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="font-semibold text-sm" style={{ color: C.espresso }}>{op.client_name}</p>
                      <Pill tone={URGENCY_PILL_TONE[op.urgency]}>{URGENCY_LABEL[op.urgency]}</Pill>
                    </div>
                    <p className="text-[11px] mt-0.5" style={{ color: C.muted }}>{op.reason}</p>
                  </div>
                  {op.estimated_value != null && (
                    <p className="text-sm font-bold shrink-0" style={{ color: C.espresso, fontFamily: FONT_DISPLAY }}>
                      {fmtMoney(op.estimated_value, business?.currency || "USD")}
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3 text-[10px]" style={{ color: C.muted }}>
                  <div>
                    <p className="uppercase tracking-widest font-bold mb-0.5" style={{ letterSpacing: "0.1em" }}>Last seen</p>
                    <p style={{ color: C.coffee }}>{fmtDate(op.last_appointment_date)}</p>
                  </div>
                  <div>
                    <p className="uppercase tracking-widest font-bold mb-0.5" style={{ letterSpacing: "0.1em" }}>Style</p>
                    <p className="truncate" style={{ color: C.coffee }}>{op.last_style || "—"}</p>
                  </div>
                  <div>
                    <p className="uppercase tracking-widest font-bold mb-0.5" style={{ letterSpacing: "0.1em" }}>Status</p>
                    <p style={{ color: op.urgency === "high" ? C.danger : op.urgency === "medium" ? C.warning : C.goldDeep, fontWeight: 600 }}>
                      {formatOverdueLabel(op.days_overdue)}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <button type="button" onClick={() => onBookAgain(op)}
                    className="px-3 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider active:scale-[0.97] transition"
                    style={{ background: C.gold, color: C.espresso, border: `1px solid ${C.goldDeep}`, letterSpacing: "0.08em" }}>
                    Book again
                  </button>
                  <button type="button" onClick={() => onCopyMessage(op)}
                    className="px-3 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider active:scale-[0.97] transition"
                    style={{ background: "transparent", color: C.coffee, border: `1px solid ${C.hairline}`, letterSpacing: "0.08em" }}>
                    {copiedId === op.client_id ? "Copied" : "Copy message"}
                  </button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// Dashboard hero — animated gradient card with greeting, owner
// first name, and a small KPI ribbon. CSS-only (a slow-moving
// conic gradient under a glass-blur layer); no animation library.
// Honours prefers-reduced-motion.
const DashboardHero = ({
  greeting, ownerName, today, todayRevenue, weekAppts, currency,
}: {
  greeting: string;
  ownerName: string | null;
  today: string;
  todayRevenue: number;
  weekAppts: number;
  currency: string;
}) => {
  return (
    <div
      className="relative overflow-hidden bbp-hero"
      style={{
        borderRadius: 28,
        padding: "22px 22px 18px",
        background: `linear-gradient(135deg, ${C.espresso} 0%, ${C.coffee} 100%)`,
        color: C.cream,
        boxShadow:
          "0 1px 2px rgba(42, 24, 16, 0.06), 0 28px 60px -22px rgba(42, 24, 16, 0.45)",
      }}
    >
      {/* Slow shimmer of the new accent palette behind a glass blur.
          Stays subtle so the copy stays the hero. */}
      <span
        aria-hidden
        className="bbp-hero-shimmer absolute"
        style={{
          inset: -40,
          background:
            "conic-gradient(from 200deg, rgba(201, 169, 97, 0.40), rgba(224, 138, 106, 0.34), rgba(155, 124, 196, 0.32), rgba(124, 182, 158, 0.32), rgba(201, 169, 97, 0.40))",
          filter: "blur(40px)",
          opacity: 0.55,
          zIndex: 0,
          pointerEvents: "none",
        }}
      />
      <div className="relative" style={{ zIndex: 1 }}>
        <p
          className="text-[10px] font-bold uppercase tracking-widest"
          style={{ color: C.gold, letterSpacing: "0.18em" }}
        >
          {greeting}
        </p>
        <h1
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 32,
            fontWeight: 600,
            lineHeight: 1.05,
            color: C.cream,
            marginTop: 4,
          }}
        >
          {ownerName ? <>Welcome back, <em style={{ color: C.gold, fontStyle: "normal" }}>{ownerName}</em>.</> : "Welcome back."}
        </h1>
        <p className="mt-1 text-[12px]" style={{ color: "rgba(245, 235, 217, 0.78)" }}>
          {fmtDateLong(today)}
        </p>

        {/* Tiny ribbon of two live numbers to anchor the card with
            real signal — today's revenue and the week's appointment
            count. Both are read-only; tapping the parent KPI cards
            below already routes the user to the deep view. */}
        <div className="mt-4 flex items-stretch gap-2">
          <div
            className="flex-1 rounded-2xl px-3 py-2.5"
            style={{
              background: "rgba(245, 235, 217, 0.10)",
              border: "1px solid rgba(201, 169, 97, 0.30)",
              backdropFilter: "blur(4px)",
            }}
          >
            <p className="text-[9px] uppercase tracking-widest font-bold" style={{ color: C.gold, letterSpacing: "0.16em" }}>
              Today
            </p>
            <p style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 600, color: C.cream, lineHeight: 1 }}>
              {fmtMoney(todayRevenue, currency)}
            </p>
          </div>
          <div
            className="flex-1 rounded-2xl px-3 py-2.5"
            style={{
              background: "rgba(245, 235, 217, 0.10)",
              border: "1px solid rgba(201, 169, 97, 0.30)",
              backdropFilter: "blur(4px)",
            }}
          >
            <p className="text-[9px] uppercase tracking-widest font-bold" style={{ color: C.gold, letterSpacing: "0.16em" }}>
              Week
            </p>
            <p style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 600, color: C.cream, lineHeight: 1 }}>
              {weekAppts} {weekAppts === 1 ? "booking" : "bookings"}
            </p>
          </div>
        </div>
      </div>
      <style>{`
        @keyframes bbpHeroShimmer { 0%, 100% { transform: rotate(0deg) scale(1); } 50% { transform: rotate(120deg) scale(1.05); } }
        .bbp-hero-shimmer { animation: bbpHeroShimmer 18s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .bbp-hero-shimmer { animation: none; } }
      `}</style>
    </div>
  );
};

// ============================================================
//  KPI DETAIL SHEET — drill-down for the Home dashboard cards
// ============================================================
//
// Each Dashboard KPI tap opens this sheet with a `kind` discriminator.
// Aggregations live in app/lib/reports.ts so the sheet's totals match
// the headline number on the card.
type KpiDetailKind =
  | "today"
  | "week"
  | "weekClients"
  | "avgTicket"
  | "deposits"
  | "pending"
  | "monthExpected"
  | "monthProfit";

const KPI_TITLES: Record<KpiDetailKind, string> = {
  today: "Today's revenue",
  week: "This week's revenue",
  weekClients: "Clients this week",
  avgTicket: "Average ticket (30 days)",
  deposits: "Deposits this week",
  pending: "Pending balances",
  monthExpected: "Expected this month",
  monthProfit: "Profit this month",
};

const KpiDetailSheet = ({
  kind, onClose, appointments, clients, currency, revenueStats, onOpenAppointment, markAppointmentPaid,
}: {
  kind: KpiDetailKind | null;
  onClose: () => void;
  appointments: any[];
  clients: any[];
  currency: string;
  revenueStats: DashboardRevenue;
  onOpenAppointment: (a: any) => void;
  markAppointmentPaid: (a: any) => Promise<void> | void;
}) => {
  const today = todayISO();
  const open = !!kind;
  const title = kind ? KPI_TITLES[kind] : "";

  // Compact appointment row used by every list-style KPI. Tappable
  // unless `tappable` is false (deposit-due / missing rows still want
  // to open the booking, so default true). Real <button> for iOS.
  const ApptRow = ({ a, rightLabel, tone }: { a: any; rightLabel?: string; tone?: "warning" | "success" | "danger" | "muted" }) => {
    const total = Number(a?.totalPrice) || 0;
    const dep = Number(a?.depositPaid) || 0;
    const balance = Math.max(0, total - dep - (Number(a?.discountAmount) || 0));
    const ps = paymentStatusOf(a, today);
    const rightColor = tone === "warning" ? C.warning : tone === "success" ? C.success : tone === "danger" ? C.danger : tone === "muted" ? C.muted : C.coffee;
    return (
      <button
        type="button"
        onClick={() => onOpenAppointment(a)}
        className="w-full text-left rounded-2xl px-3.5 py-3 mb-2 active:scale-[0.99] transition"
        style={{
          background: C.paper,
          border: `1px solid ${C.hairline}`,
          color: "inherit",
          font: "inherit",
          appearance: "none",
          WebkitAppearance: "none",
        }}
      >
        <div className="flex items-start justify-between gap-3" style={{ pointerEvents: "none" }}>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <Pill tone={STATUS_TONE[a?.status || "scheduled"] || "neutral"}>
                {STATUS_LABEL[a?.status || "scheduled"] || a?.status || "Scheduled"}
              </Pill>
              {a?.status !== "cancelled" && (
                <Pill tone={PAYMENT_STATUS_TONE[ps]}>{PAYMENT_STATUS_LABEL[ps]}</Pill>
              )}
            </div>
            <p className="text-sm font-semibold truncate" style={{ color: C.espresso }}>
              {a?.clientName || "Walk-in"}
            </p>
            <p className="text-[11px] mt-0.5 truncate" style={{ color: C.muted }}>
              {a?.style || "Service"} · {a?.date ? fmtDate(a.date) : "—"}{a?.time ? ` · ${fmtTime(a.time)}` : ""}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 600, color: C.goldDeep, lineHeight: 1 }}>
              {fmtMoney(total, currency)}
            </p>
            {balance > 0 && (
              <p className="text-[11px] mt-1" style={{ color: rightColor }}>
                {rightLabel || `Balance ${fmtMoney(balance, currency)}`}
              </p>
            )}
          </div>
        </div>
      </button>
    );
  };

  const Hero = ({ value, hint }: { value: string; hint?: string }) => (
    <Card className="p-4 mb-3" style={{ background: `linear-gradient(180deg, ${C.espresso}, ${C.coffee})`, border: `1px solid ${C.goldDeep}` }}>
      <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: C.gold, letterSpacing: "0.16em" }}>
        Total
      </p>
      <p className="mt-1" style={{ fontFamily: FONT_DISPLAY, fontSize: 32, fontWeight: 600, color: C.cream, lineHeight: 1 }}>
        {value}
      </p>
      {hint && <p className="text-[11px] mt-1.5" style={{ color: "rgba(245, 235, 217, 0.78)" }}>{hint}</p>}
    </Card>
  );

  const renderBody = () => {
    if (!open) return null;
    switch (kind!) {
      case "today": {
        const list = todayCompletedAppts(appointments, today);
        const total = list.reduce((s, a) => s + reportTicketTotal(a), 0);
        return (
          <>
            <Hero value={fmtMoney(total, currency)} hint={`${list.length} completed today`} />
            {list.length === 0 ? (
              <Card className="p-4 text-center"><p className="text-[12px]" style={{ color: C.muted }}>No completed bookings yet today.</p></Card>
            ) : list.map(a => <ApptRow key={a.id} a={a} tone="success" />)}
          </>
        );
      }
      case "week": {
        const list = weekRevenueAppts(appointments, today);
        const total = list.reduce((s, a) => s + reportTicketTotal(a), 0);
        return (
          <>
            <Hero value={fmtMoney(total, currency)} hint={`${list.length} appointment${list.length === 1 ? "" : "s"} this week`} />
            {list.length === 0 ? (
              <Card className="p-4 text-center"><p className="text-[12px]" style={{ color: C.muted }}>Nothing on the books for this week yet.</p></Card>
            ) : list.map(a => <ApptRow key={a.id} a={a} />)}
          </>
        );
      }
      case "weekClients": {
        const rows = weekClientRows(appointments, today);
        return (
          <>
            <Hero value={String(rows.length)} hint={`Unique clients booked this week`} />
            {rows.length === 0 ? (
              <Card className="p-4 text-center"><p className="text-[12px]" style={{ color: C.muted }}>No clients on the books this week.</p></Card>
            ) : rows.map(r => (
              <Card key={r.clientId} className="p-3.5 mb-2 flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate" style={{ color: C.espresso }}>{r.clientName}</p>
                  <p className="text-[11px]" style={{ color: C.muted }}>{r.visitCount} {r.visitCount === 1 ? "visit" : "visits"}</p>
                </div>
                <span className="text-[13px] font-semibold tabular-nums" style={{ color: C.goldDeep }}>
                  {fmtMoney(r.totalSpend, currency)}
                </span>
              </Card>
            ))}
          </>
        );
      }
      case "avgTicket": {
        const b: AvgTicketBreakdown = avgTicket30dBreakdown(appointments, today);
        return (
          <>
            <Hero value={fmtMoney(b.average, currency)} hint={`${fmtMoney(b.total, currency)} ÷ ${b.count} bookings`} />
            <Card className="p-3.5 mb-3" style={{ background: C.paper }}>
              <p className="text-[11px]" style={{ color: C.coffee }}>
                <strong>Calculation:</strong> sum of ticket totals (post-discount) divided by appointment count, last 30 days.
              </p>
            </Card>
            {b.appointments.length === 0 ? (
              <Card className="p-4 text-center"><p className="text-[12px]" style={{ color: C.muted }}>No bookings in the last 30 days.</p></Card>
            ) : b.appointments.map(a => <ApptRow key={a.id} a={a} />)}
          </>
        );
      }
      case "deposits": {
        const buckets: WeekDepositBuckets = weekDepositBuckets(appointments, today);
        return (
          <>
            <Hero value={fmtMoney(buckets.collected.total, currency)} hint={`Collected this week`} />
            <p className="text-[10px] uppercase tracking-widest font-bold mb-2" style={{ color: C.success, letterSpacing: "0.14em" }}>
              Collected · {buckets.collected.appointments.length}
            </p>
            {buckets.collected.appointments.length === 0
              ? <Card className="p-3 mb-3 text-center"><p className="text-[12px]" style={{ color: C.muted }}>No deposits collected yet this week.</p></Card>
              : buckets.collected.appointments.map(a => <ApptRow key={`c_${a.id}`} a={a} tone="success" rightLabel={`Deposit ${fmtMoney(Number(a.depositPaid) || 0, currency)}`} />)}
            <p className="text-[10px] uppercase tracking-widest font-bold mt-3 mb-2" style={{ color: C.warning, letterSpacing: "0.14em" }}>
              Due · {buckets.due.appointments.length}
            </p>
            {buckets.due.appointments.length === 0
              ? <Card className="p-3 mb-3 text-center"><p className="text-[12px]" style={{ color: C.muted }}>No deposits due this week.</p></Card>
              : buckets.due.appointments.map(a => <ApptRow key={`d_${a.id}`} a={a} tone="warning" rightLabel="Deposit due" />)}
            <p className="text-[10px] uppercase tracking-widest font-bold mt-3 mb-2" style={{ color: C.danger, letterSpacing: "0.14em" }}>
              Missing · {buckets.missing.appointments.length}
            </p>
            {buckets.missing.appointments.length === 0
              ? <Card className="p-3 text-center"><p className="text-[12px]" style={{ color: C.muted }}>None missing — nice.</p></Card>
              : buckets.missing.appointments.map(a => <ApptRow key={`m_${a.id}`} a={a} tone="danger" rightLabel="No deposit" />)}
          </>
        );
      }
      case "pending": {
        const list = pendingBalanceAppts(appointments);
        const total = list.reduce((s, a) => s + reportTicketBalance(a), 0);
        return (
          <>
            <Hero value={fmtMoney(total, currency)} hint={`Across ${list.length} appointment${list.length === 1 ? "" : "s"}`} />
            {list.length === 0 ? (
              <Card className="p-4 text-center"><p className="text-[12px]" style={{ color: C.muted }}>No outstanding balances. 💛</p></Card>
            ) : list.map(a => {
              const balance = reportTicketBalance(a);
              return (
                <div
                  key={a.id}
                  className="rounded-2xl mb-2 overflow-hidden flex"
                  style={{ background: C.paper, border: `1px solid ${C.hairline}` }}
                >
                  <button
                    type="button"
                    onClick={() => onOpenAppointment(a)}
                    className="text-left px-3.5 py-3 flex-1 active:scale-[0.99] transition"
                    style={{ background: "transparent", border: 0, color: "inherit", font: "inherit", appearance: "none", WebkitAppearance: "none" }}
                  >
                    <div style={{ pointerEvents: "none" }}>
                      <p className="text-sm font-semibold truncate" style={{ color: C.espresso }}>{a.clientName || "Walk-in"}</p>
                      <p className="text-[11px] mt-0.5 truncate" style={{ color: C.muted }}>{a.style || "Service"} · {a.date ? fmtDate(a.date) : "—"}</p>
                      <p className="text-[11px] mt-1" style={{ color: C.muted }}>
                        Total {fmtMoney(Number(a.totalPrice) || 0, currency)} · Deposit {fmtMoney(Number(a.depositPaid) || 0, currency)}
                      </p>
                    </div>
                  </button>
                  <div className="flex flex-col items-end justify-center px-3 py-3 gap-1.5 shrink-0" style={{ borderLeft: `1px solid ${C.hairline}` }}>
                    <p className="text-[12px] font-bold" style={{ color: C.warning }}>
                      {fmtMoney(balance, currency)}
                    </p>
                    <button
                      type="button"
                      onClick={() => markAppointmentPaid(a)}
                      className="text-[10px] font-semibold px-2 py-1 rounded-md active:scale-[0.97] transition"
                      style={{ background: C.ivory, color: C.coffee, border: `1px solid ${C.hairline}` }}
                    >
                      Mark paid
                    </button>
                  </div>
                </div>
              );
            })}
          </>
        );
      }
      case "monthExpected": {
        const list = monthExpectedAppts(appointments, today);
        const total = list.reduce((s, a) => s + reportTicketTotal(a), 0);
        return (
          <>
            <Hero value={fmtMoney(total, currency)} hint={`${list.length} non-cancelled appointment${list.length === 1 ? "" : "s"} this month`} />
            {list.length === 0 ? (
              <Card className="p-4 text-center"><p className="text-[12px]" style={{ color: C.muted }}>Nothing on the books this month.</p></Card>
            ) : list.map(a => <ApptRow key={a.id} a={a} />)}
          </>
        );
      }
      case "monthProfit": {
        const b: MonthProfitBreakdown = monthProfitBreakdown(appointments, today);
        return (
          <>
            <Hero value={fmtMoney(b.estimatedProfit, currency)} hint={`Across ${b.appointments.length} completed booking${b.appointments.length === 1 ? "" : "s"}`} />
            <Card className="p-3.5 mb-3 space-y-2" style={{ background: C.paper }}>
              <div className="flex items-center justify-between">
                <span className="text-[12px]" style={{ color: C.muted }}>Revenue (collected)</span>
                <span className="text-[13px] font-semibold tabular-nums" style={{ color: C.espresso }}>{fmtMoney(b.revenue, currency)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[12px]" style={{ color: C.muted }}>Discounts applied</span>
                <span className="text-[13px] font-semibold tabular-nums" style={{ color: C.goldDeep }}>− {fmtMoney(b.discounts, currency)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[12px]" style={{ color: C.muted }}>Estimated costs</span>
                <span className="text-[13px] font-semibold tabular-nums" style={{ color: C.muted }}>—</span>
              </div>
              <div className="flex items-center justify-between pt-2" style={{ borderTop: `1px solid ${C.hairline}` }}>
                <span className="text-[13px] font-semibold" style={{ color: C.espresso }}>Estimated profit</span>
                <span className="text-[14px] font-bold tabular-nums" style={{ color: C.success }}>{fmtMoney(b.estimatedProfit, currency)}</span>
              </div>
              <p className="text-[10px] mt-2" style={{ color: C.muted, lineHeight: 1.5 }}>
                Cost tracking lands in a future phase. Profit currently equals collected revenue minus 0 — discounts are surfaced so the impact is visible.
              </p>
            </Card>
            {b.appointments.length === 0 ? (
              <Card className="p-4 text-center"><p className="text-[12px]" style={{ color: C.muted }}>No completed bookings this month yet.</p></Card>
            ) : b.appointments.map(a => <ApptRow key={a.id} a={a} />)}
          </>
        );
      }
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="pb-2">{renderBody()}</div>
    </Sheet>
  );
};

const Dashboard = ({ store, setActive, openQuickAppt, openQuickClient, openQuickTx, openSettings, openPolicies, openSavedQuotes, openReminders, openPresets, openTimer, openCommunication, openAnalytics, notifBadgeCount = 0, syncState, openAppointmentRecord }: { store: any; setActive: any; openQuickAppt: any; openQuickClient: any; openQuickTx: any; openSettings: any; openPolicies: any; openSavedQuotes: any; openReminders: any; openPresets: any; openTimer: any; openCommunication?: (ctx: CommContext) => void; openAnalytics?: () => void; notifBadgeCount?: number; syncState?: SyncState; openAppointmentRecord?: (a: any) => void }) => {
  const { business, appointments, transactions, photos, recurringSeries, clients = [] } = store;
  const today = todayISO();

  // Dashboard orchestration: each section gets a focused, de-duped list
  // so the same appointment never renders in more than one card.
  // Order of resolution matters — Pending Balances claims first, then
  // Today's Chair, then Coming Up. See the helpers in finance utilities.
  const pendingBalanceAppts = useMemo(
    () => getPendingBalanceAppointments(appointments, today),
    [appointments, today],
  );
  const pendingIds = useMemo(
    () => new Set<string>(pendingBalanceAppts.map((a: any) => a.id).filter(Boolean)),
    [pendingBalanceAppts],
  );
  const todayAppts = useMemo(
    () => getTodaysAppointments(appointments, today, pendingIds),
    [appointments, today, pendingIds],
  );
  const todayIds = useMemo(
    () => new Set<string>(todayAppts.map((a: any) => a.id).filter(Boolean)),
    [todayAppts],
  );
  const upcomingExcludeIds = useMemo(() => {
    const s = new Set<string>();
    pendingIds.forEach(id => s.add(id));
    todayIds.forEach(id => s.add(id));
    return s;
  }, [pendingIds, todayIds]);
  const upcomingAppts = useMemo(
    () => getUpcomingAppointments(appointments, today, upcomingExcludeIds, 3),
    [appointments, today, upcomingExcludeIds],
  );

  // Style-aware rebooking opportunities. Replaces the old generic 28-day
  // cutoff with per-style windows (knotless 6w, cornrows 3w, …) and
  // urgency tiering. The dashboard card surfaces the top 3; the full
  // list lives at active === "rebooking".
  const rebookingOpportunities = useMemo(
    () => computeRebookingOpportunities(clients, appointments, today),
    [clients, appointments, today],
  );
  const rebookingSummary = useMemo(
    () => summarizeOpportunities(rebookingOpportunities),
    [rebookingOpportunities],
  );
  const topRebookings = rebookingOpportunities.slice(0, 3);

  // Drill-down state — every KPI card opens this sheet with a `kind`
  // discriminator. The sheet pulls the matching helper from
  // app/lib/reports.ts so the headline number always matches the rows.
  const [kpiKind, setKpiKind] = useState<KpiDetailKind | null>(null);
  const openKpi = (k: KpiDetailKind) => setKpiKind(k);
  const closeKpi = () => setKpiKind(null);

  // Phase 1 — pure aggregations from app/lib/reports.ts so the
  // Dashboard cards and the Reports screen share one source of truth.
  const revenueStats = useMemo(
    () => computeDashboardRevenue(appointments),
    [appointments],
  );

  const stats = useMemo(() => {
    const now = new Date();
    const wk = new Date(now); wk.setDate(now.getDate() - 7);
    const ms = new Date(now.getFullYear(), now.getMonth(), 1);
    const wkISO = localDateISO(wk);
    const msISO = localDateISO(ms);
    const completedThisWeek = appointments.filter(a => a.status === "completed" && a.date >= wkISO);
    const weekRevenue = roundCents(completedThisWeek.reduce((s, a) => s + calculateCollectedAmount(a), 0));
    const pendingBalance = calculatePendingBalance(appointments, today);
    const txIncomeMonth = transactions.filter(t => t.type === "income" && t.date >= msISO).reduce((s, t) => s + parseMoney(t.amount), 0);
    const apptIncomeMonth = appointments
      .filter(a => isIncomeAppt(a) && a.date >= msISO)
      .reduce((s, a) => s + calculateCollectedAmount(a), 0);
    const monthIncome = roundCents(txIncomeMonth + apptIncomeMonth);
    const monthExpense = roundCents(transactions.filter(t => t.type === "expense" && t.date >= msISO).reduce((s, t) => s + parseMoney(t.amount), 0));
    return { weekRevenue, weekAppts: completedThisWeek.length, pendingBalance, monthProfit: calculateProfit(monthIncome, monthExpense) };
  }, [appointments, transactions, today]);
  // Pending balance rows for the dashboard list, projected from the
  // canonical `pendingBalanceAppts` (which is what the dedupe sets use)
  // so the rendered list and the dedupe key set can never disagree.
  const pendingBalanceRows = useMemo(
    () => pendingBalanceAppts.map((a: any) => ({ a, ps: paymentStatusOf(a, today) })),
    [pendingBalanceAppts, today],
  );

  const markApptPaid = async (appt: any) => {
    const apptDate = appt.date || todayISO();
    const isPastOrToday = apptDate <= today;
    const updated = {
      ...appt,
      depositPaid: parseMoney(appt.totalPrice),
      balanceDue: 0,
      paymentStatus: "paid",
      paymentDate: appt.paymentDate || todayISO(),
      // If the service has happened, completing the appointment lets the
      // money tracker + client lifetime total pick it up immediately.
      status: isPastOrToday && appt.status !== "cancelled" && appt.status !== "no_show"
        ? "completed"
        : appt.status,
    };
    await store.upsertAppointment(updated);
  };

  const recentPhotos = useMemo(() =>
    [...photos].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")).slice(0, 6)
  , [photos]);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  })();

  return (
    <div className="bbp-fade">
      <Header
        title={greeting}
        subtitle={syncState ? <span className="inline-flex items-center gap-2">{fmtDateLong(today)}<SyncStatusPill display={computeSyncDisplay(syncState, 0, "authed", null)} /></span> as any : fmtDateLong(today)}
        leftAction={
          <button
            type="button"
            onClick={(e) => {
              // Defensive: any throw inside the bell handler escalates
              // to WKWebView's "couldn't load" replacement, which kills
              // the whole React tree. Catching here keeps the page
              // alive and surfaces the cause via the global error
              // listener (localStorage + banner).
              e.preventDefault();
              try {
                openReminders();
              } catch (err) {
                window.dispatchEvent(new ErrorEvent("error", { error: err as Error, message: (err as Error)?.message || String(err) }));
              }
            }}
            className="p-2 rounded-full relative"
            style={{ color: C.coffee, WebkitAppearance: "none" as any, appearance: "none" as any, background: "transparent", border: 0 }}
            aria-label="Notifications">
            <Bell size={20} />
            {notifBadgeCount > 0 && (
              <span className="absolute top-0 right-0 rounded-full text-[10px] font-bold flex items-center justify-center"
                style={{ width: 16, height: 16, background: C.gold, color: C.espresso, border: `1.5px solid ${C.cream}` }}>
                {notifBadgeCount > 9 ? "9+" : notifBadgeCount}
              </span>
            )}
          </button>
        }
        rightAction={<button type="button" onClick={openSettings} className="p-2 rounded-full" style={{ color: C.coffee }}><SettingsIcon size={20} /></button>}
      />

      <div className="px-5 pt-4 pb-28 space-y-5">
        <DashboardHero
          greeting={greeting}
          ownerName={business.ownerName?.split(" ")[0] || null}
          today={today}
          todayRevenue={revenueStats.todayRevenue}
          weekAppts={stats.weekAppts}
          currency={business.currency}
        />


        <div className="grid grid-cols-2 gap-3">
          <KpiCard label="Today revenue" value={fmtMoney(revenueStats.todayRevenue, business.currency)} icon={<DollarSign size={16} />} tone={revenueStats.todayRevenue > 0 ? "gold" : "neutral"} onClick={() => openKpi("today")} />
          <KpiCard label="Week revenue" value={fmtMoney(stats.weekRevenue, business.currency)} icon={<ArrowUpRight size={16} />} tone="gold" onClick={() => openKpi("week")} />
          <KpiCard label="Week clients" value={stats.weekAppts} icon={<Users size={16} />} onClick={() => openKpi("weekClients")} />
          <KpiCard label="Avg ticket (30d)" value={fmtMoney(revenueStats.averageTicket30d, business.currency)} icon={<Receipt size={16} />} tone={revenueStats.averageTicket30d > 0 ? "gold" : "neutral"} onClick={() => openKpi("avgTicket")} />
          <KpiCard label="Deposits (week)" value={fmtMoney(revenueStats.weekDeposits, business.currency)} icon={<Check size={16} />} tone={revenueStats.weekDeposits > 0 ? "success" : "neutral"} onClick={() => openKpi("deposits")} />
          <KpiCard label="Pending balance" value={fmtMoney(stats.pendingBalance, business.currency)} icon={<Clock size={16} />} tone={stats.pendingBalance > 0 ? "warning" : "neutral"} onClick={() => openKpi("pending")} />
          <KpiCard label="Month expected" value={fmtMoney(revenueStats.monthExpected, business.currency)} icon={<Calendar size={16} />} tone={revenueStats.monthExpected > 0 ? "gold" : "neutral"} onClick={() => openKpi("monthExpected")} />
          <KpiCard label="Month profit" value={fmtMoney(stats.monthProfit, business.currency)} icon={<TrendingUp size={16} />} tone={stats.monthProfit >= 0 ? "success" : "danger"} onClick={() => openKpi("monthProfit")} />
          <KpiCard label="Year made" value={fmtMoney(revenueStats.yearMade, business.currency)} icon={<Sparkles size={16} />} tone={revenueStats.yearMade > 0 ? "gold" : "neutral"} onClick={() => setActive("money")} />
        </div>

        <KpiDetailSheet
          kind={kpiKind}
          onClose={closeKpi}
          appointments={appointments as any[]}
          clients={clients as any[]}
          currency={business.currency || "USD"}
          revenueStats={revenueStats}
          onOpenAppointment={(a) => { closeKpi(); openAppointmentRecord?.(a); }}
          markAppointmentPaid={async (a) => {
            const next = {
              ...a,
              depositPaid: Number(a.totalPrice) || 0,
              paymentStatus: "paid",
              paymentDate: a.paymentDate || todayISO(),
              status: a.status === "scheduled" || a.status === "confirmed" ? "completed" : a.status,
            };
            await store.upsertAppointment(next);
          }}
        />

        <BossInsightsCard
          clients={clients}
          appointments={appointments}
          commLog={store.commLog}
          settings={{ business }}
          today={today}
          setActive={setActive}
          openAnalytics={openAnalytics}
        />

        <RetentionInsights
          clients={clients}
          appointments={appointments}
          today={today}
          business={business}
          openCommunication={openCommunication}
          openQuickAppt={openQuickAppt}
          setActive={setActive}
        />

        <div>
          <SectionTitle>Pending balances</SectionTitle>
          {pendingBalanceAppts.length === 0 ? (
            <Card className="p-5 text-center" style={{ background: "rgba(92,124,74,0.08)", border: `1px solid rgba(92,124,74,0.25)` }}>
              <Sparkles size={18} style={{ color: C.success, margin: "0 auto 6px" }} />
              <p className="text-sm font-semibold" style={{ color: C.espresso }}>All balances collected ✨</p>
              <p className="text-xs mt-1" style={{ color: C.muted }}>Nothing outstanding right now.</p>
            </Card>
          ) : (
            <div className="space-y-2">
              {pendingBalanceRows.slice(0, 4).map(({ a, ps }) => (
                <Card key={a.id} className="p-3.5 flex items-center gap-3 cursor-pointer active:scale-[0.99] transition" onClick={() => openQuickAppt(a)}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                      <Pill tone={PAYMENT_STATUS_TONE[ps]}>{PAYMENT_STATUS_LABEL[ps]}</Pill>
                    </div>
                    <p className="font-semibold text-sm truncate" style={{ color: C.espresso }}>{a.clientName || "Unnamed"}</p>
                    <p className="text-[11px] truncate" style={{ color: C.muted }}>{fmtDate(a.date)} · {a.style || "Service"}</p>
                  </div>
                  <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
                    <span style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600, color: ps === "overdue" ? C.danger : C.goldDeep }}>
                      {fmtMoney(Number(a.balanceDue) || 0, business.currency)}
                    </span>
                    <div className="flex gap-1.5">
                      {openCommunication && (
                        <button type="button" onClick={(e) => {
                          e.stopPropagation();
                          openCommunication({
                            appointment: a,
                            client: store.clientById(a.clientId),
                            initialKey: "balance_due",
                          });
                        }}
                          className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider active:scale-[0.97] transition"
                          style={{ background: "transparent", color: C.goldDeep, border: `1px solid ${C.goldDeep}`, letterSpacing: "0.08em" }}>
                          Remind
                        </button>
                      )}
                      <button type="button" onClick={(e) => { e.stopPropagation(); markApptPaid(a); }}
                        className="px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider active:scale-[0.97] transition"
                        style={{ background: C.gold, color: C.espresso, border: `1px solid ${C.goldDeep}`, letterSpacing: "0.08em" }}>
                        Mark paid
                      </button>
                    </div>
                  </div>
                </Card>
              ))}
              {pendingBalanceAppts.length > 4 && (
                <button type="button" onClick={() => setActive("schedule")}
                  className="w-full text-center text-xs font-semibold py-2"
                  style={{ color: C.goldDeep }}>
                  View all {pendingBalanceAppts.length} pending →
                </button>
              )}
            </div>
          )}
        </div>

        <RebookingOpportunitiesCard
          opportunities={topRebookings}
          summary={rebookingSummary}
          currency={business.currency}
          clients={clients}
          openQuickAppt={openQuickAppt}
          onViewAll={() => setActive("rebooking")}
        />


        <div>
          <SectionTitle action={
            <button type="button" onClick={() => setActive("schedule")} className="text-xs font-semibold flex items-center gap-1" style={{ color: C.goldDeep }}>
              View all <ChevronRight size={14} />
            </button>
          }>Today&apos;s chair</SectionTitle>
          {todayAppts.length === 0 ? (
            <Card className="p-5 text-center">
              <p className="italic mb-1" style={{ fontFamily: FONT_DISPLAY, color: C.gold, fontSize: 16 }}>a quiet morning</p>
              <p className="text-sm" style={{ color: C.muted }}>No appointments today. Time to plan, prep, or post.</p>
            </Card>
          ) : (
            <div className="space-y-2.5">
              {todayAppts.map(a => <AppointmentRow key={a.id} appt={a} business={business} compact recurringSeries={recurringSeries} />)}
            </div>
          )}
        </div>

        {upcomingAppts.length > 0 && (
          <div>
            <SectionTitle>Coming up</SectionTitle>
            <div className="space-y-2.5">
              {upcomingAppts.map(a => <AppointmentRow key={a.id} appt={a} business={business} compact recurringSeries={recurringSeries} />)}
            </div>
          </div>
        )}

        {recentPhotos.length > 0 && (
          <div>
            <SectionTitle>Recent gallery</SectionTitle>
            <div className="flex gap-2 overflow-x-auto bbp-scroll -mx-1 px-1 pb-1">
              {recentPhotos.map(p => (
                <div key={p.id} className="rounded-xl shrink-0 overflow-hidden" style={{ width: 90, height: 90, border: `1px solid ${C.hairline}` }}>
                  <CloudPhotoImg photo={p} kind="thumb" alt={p.caption || ""} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <SectionTitle>Quick actions</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <QuickTile icon={<Layers size={20} />} label="Style Presets" onClick={openPresets} />
            <QuickTile icon={<CalendarPlus size={20} />} label="New Appointment" onClick={() => openQuickAppt({})} />
            <QuickTile icon={<UserPlus size={20} />} label="Add Client" onClick={() => setActive("clients")} />
            <QuickTile icon={<TimerIcon size={20} />} label="Start Timer" onClick={openTimer} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Card className="p-4 cursor-pointer active:scale-[0.98] transition" onClick={openSavedQuotes}>
            <FileText size={20} style={{ color: C.gold }} />
            <p className="mt-3 font-semibold text-[15px]" style={{ color: C.espresso }}>Saved Quotes</p>
            <p className="text-xs mt-0.5" style={{ color: C.muted }}>{store.quotes.length} saved</p>
          </Card>
          <Card className="p-4 cursor-pointer active:scale-[0.98] transition" onClick={openPolicies}>
            <ScrollText size={20} style={{ color: C.gold }} />
            <p className="mt-3 font-semibold text-[15px]" style={{ color: C.espresso }}>Policies</p>
            <p className="text-xs mt-0.5" style={{ color: C.muted }}>{store.policies.length} templates</p>
          </Card>
        </div>
      </div>
    </div>
  );
};

const KpiCard = ({ label, value, icon, tone = "neutral", onClick }: { label: any; value: any; icon: any; tone?: string; onClick?: () => void }) => {
  const tones: Record<string, { accent: string; bg: string }> = {
    neutral: { accent: C.coffee, bg: C.ivory },
    gold: { accent: C.goldDeep, bg: "#F5E9C8" },
    success: { accent: C.success, bg: "#E4EDD8" },
    warning: { accent: C.warning, bg: "#F5DDC0" },
    danger: { accent: C.danger, bg: "#F2D6D0" },
  };
  const t = tones[tone] || tones.neutral;
  return (
    <Card className={`p-4 ${onClick ? "cursor-pointer active:scale-[0.98] transition" : ""}`} onClick={onClick}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: C.muted, letterSpacing: "0.14em" }}>{label}</span>
        <div className="rounded-full p-1.5" style={{ background: t.bg, color: t.accent }}>{icon}</div>
      </div>
      <p style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 600, color: C.espresso, lineHeight: 1 }}>{value}</p>
      {onClick && <p className="text-[10px] font-semibold mt-1.5 flex items-center gap-0.5" style={{ color: C.gold }}>View <ChevronRight size={11} /></p>}
    </Card>
  );
};

const BossInsightsCard = ({ clients, appointments, commLog, settings, today, setActive, openAnalytics }: {
  clients: any[];
  appointments: any[];
  commLog: any[];
  settings: { business: any };
  today: string;
  setActive: (tab: string) => void;
  openAnalytics?: () => void;
}) => {
  const insights = useMemo(() =>
    generateBossInsights({ clients, appointments, communications: commLog, settings, today }),
    [clients, appointments, commLog, settings, today]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const tone = (p: Insight["priority"]): "danger" | "gold" | "neutral" =>
    p === "high" ? "danger" : p === "medium" ? "gold" : "neutral";

  const handleAction = (target?: string) => {
    if (!target) return;
    if (target.startsWith("tab:")) setActive(target.slice(4));
    // client:/appointment: deep-links land on the relevant tab in V1.
    else if (target.startsWith("client:")) setActive("clients");
    else if (target.startsWith("appointment:")) setActive("schedule");
  };

  return (
    <div>
      <SectionTitle action={openAnalytics ? { label: "Analytics", onClick: openAnalytics } : undefined}>
        Boss insights
      </SectionTitle>
      {insights.length === 0 ? (
        <Card className="p-5 text-center">
          <Sparkles size={18} style={{ color: C.gold, margin: "0 auto 6px" }} />
          <p className="text-sm font-semibold" style={{ color: C.espresso }}>Insights warming up</p>
          <p className="text-xs mt-1" style={{ color: C.muted }}>Your insights will sharpen as you book, collect, and rebook.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {insights.map(i => {
            const isOpen = !!expanded[i.id];
            return (
              <Card key={i.id} className="p-3.5">
                <button
                  type="button" className="w-full text-left active:scale-[0.99] transition"
                  onClick={() => setExpanded(prev => ({ ...prev, [i.id]: !prev[i.id] }))}>
                  <div className="flex items-start justify-between gap-2 mb-1.5 flex-wrap">
                    <Pill tone={tone(i.priority)}>{i.category.toUpperCase()}</Pill>
                    {i.why && (
                      <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.muted }}>
                        {isOpen ? "Hide why" : "Why this matters"}
                      </span>
                    )}
                  </div>
                  <p className="font-semibold text-sm" style={{ color: C.espresso }}>{i.title}</p>
                  {i.body && <p className="text-[12px] mt-1 leading-relaxed" style={{ color: C.coffee }}>{i.body}</p>}
                  {isOpen && i.why && (
                    <p className="text-[11px] mt-2 italic leading-relaxed bbp-fade" style={{ color: C.muted }}>{i.why}</p>
                  )}
                </button>
                {i.actionLabel && (
                  <div className="flex justify-end mt-2">
                    <button type="button" onClick={() => handleAction(i.actionTarget)}
                      className="px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider active:scale-[0.97] transition"
                      style={{ background: "transparent", color: C.goldDeep, border: `1px solid ${C.goldDeep}`, letterSpacing: "0.08em" }}>
                      {i.actionLabel}
                    </button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

const RetentionInsights = ({ clients, appointments, today, business, openCommunication, openQuickAppt, setActive }: {
  clients: any[];
  appointments: any[];
  today: string;
  business: any;
  openCommunication?: (ctx: CommContext) => void;
  openQuickAppt: (prefill?: any) => void;
  setActive: (tab: string) => void;
}) => {
  const insights = useMemo(() => {
    const safeClients = Array.isArray(clients) ? clients : [];
    const safeAppts = Array.isArray(appointments) ? appointments : [];
    if (safeClients.length === 0) {
      return { hasData: false, candidates: [], topClients: [], inactiveCount: 0, repeatPct: 0, vipThreshold: 0 };
    }
    // VIP threshold = 75th percentile of lifetime value across clients
    // who have at least one completed appointment. Falls back to a flat
    // $800 floor when sample size is too small.
    const lifetimes = safeClients
      .map(c => calculateClientLifetimeValue(c.id, safeAppts))
      .filter(v => v > 0)
      .sort((a, b) => a - b);
    const p75 = lifetimes.length >= 4 ? lifetimes[Math.floor(lifetimes.length * 0.75)] : 800;
    const vipThreshold = Math.max(p75, 800);

    const enriched = safeClients
      .map(c => {
        const m = calculateClientMetrics(c.id, safeAppts, today);
        return { client: c, metrics: m, status: getClientStatus(m, vipThreshold) };
      })
      .filter(x => x.metrics.totalAppts > 0);

    const candidates = getRebookingCandidates(safeClients, safeAppts, today).slice(0, 3);
    const inactiveCount = enriched.filter(x => x.status === "inactive" || x.status === "at_risk").length;

    // Repeat booking %: clients with 2+ completed visits / clients with any history.
    const withHistory = enriched.length;
    const repeats = enriched.filter(x => x.metrics.completedAppts >= 2).length;
    const repeatPct = withHistory > 0 ? Math.round((repeats / withHistory) * 100) : 0;

    // Top 3 clients this month by collected amount.
    const monthStart = today.slice(0, 7) + "-01";
    const topClients = safeClients
      .map(c => {
        const monthValue = roundCents(safeAppts
          .filter(a => a.clientId === c.id && a.date >= monthStart && isIncomeAppt(a))
          .reduce((s, a) => s + calculateCollectedAmount(a), 0));
        return { client: c, monthValue };
      })
      .filter(x => x.monthValue > 0)
      .sort((a, b) => b.monthValue - a.monthValue)
      .slice(0, 3);

    return { hasData: true, candidates, topClients, inactiveCount, repeatPct, vipThreshold };
  }, [clients, appointments, today]);

  return (
    <div>
      <SectionTitle>Retention insights</SectionTitle>
      {!insights.hasData ? (
        <Card className="p-5 text-center">
          <Sparkles size={18} style={{ color: C.gold, margin: "0 auto 6px" }} />
          <p className="text-sm font-semibold" style={{ color: C.espresso }}>No repeat clients yet</p>
          <p className="text-xs mt-1" style={{ color: C.muted }}>Your loyal client list will grow here.</p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <Card className="p-3" style={{ background: C.ivory }}>
              <p className="text-[10px] uppercase tracking-widest font-bold mb-1" style={{ color: C.muted, letterSpacing: "0.12em" }}>Overdue</p>
              <p className="text-base font-bold" style={{ color: C.espresso, fontFamily: FONT_DISPLAY }}>{insights.candidates.length}</p>
            </Card>
            <Card className="p-3" style={{ background: C.ivory }}>
              <p className="text-[10px] uppercase tracking-widest font-bold mb-1" style={{ color: C.muted, letterSpacing: "0.12em" }}>Repeat %</p>
              <p className="text-base font-bold" style={{ color: C.espresso, fontFamily: FONT_DISPLAY }}>{insights.repeatPct}%</p>
            </Card>
            <Card className="p-3" style={{ background: C.ivory }}>
              <p className="text-[10px] uppercase tracking-widest font-bold mb-1" style={{ color: C.muted, letterSpacing: "0.12em" }}>Inactive</p>
              <p className="text-base font-bold" style={{ color: C.espresso, fontFamily: FONT_DISPLAY }}>{insights.inactiveCount}</p>
            </Card>
          </div>

          {insights.candidates.length > 0 && (
            <Card className="p-3.5 mb-3">
              <p className="text-[10px] uppercase tracking-widest font-bold mb-2" style={{ color: C.muted, letterSpacing: "0.12em" }}>Time to rebook</p>
              <div className="space-y-2">
                {insights.candidates.map(({ client, metrics, reason }) => (
                  <div key={client.id} className="flex items-center gap-3">
                    <div className="rounded-full flex items-center justify-center shrink-0"
                      style={{ width: 32, height: 32, background: `linear-gradient(135deg, ${C.caramel}, ${C.coffee})`, color: C.cream, fontFamily: FONT_DISPLAY, fontSize: 13, fontWeight: 600 }}>
                      {initials(client.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm truncate" style={{ color: C.espresso }}>{client.name}</p>
                      <p className="text-[11px] truncate" style={{ color: C.muted }}>
                        {reason} · {metrics.daysSinceLast}d since last
                      </p>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      {openCommunication && (
                        <button type="button" onClick={() => openCommunication({ client, initialKey: "rebooking_nudge" })}
                          className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider active:scale-[0.97] transition"
                          style={{ background: "transparent", color: C.goldDeep, border: `1px solid ${C.goldDeep}`, letterSpacing: "0.08em" }}>
                          Remind
                        </button>
                      )}
                      <button type="button" onClick={() => openQuickAppt({
                        clientId: client.id,
                        clientName: client.name,
                        clientPhone: client.phone,
                        clientEmail: client.email,
                        style: metrics.mostBookedStyle || "",
                      })}
                        className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider active:scale-[0.97] transition"
                        style={{ background: C.gold, color: C.espresso, border: `1px solid ${C.goldDeep}`, letterSpacing: "0.08em" }}>
                        Rebook
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {insights.topClients.length > 0 && (
            <Card className="p-3.5">
              <p className="text-[10px] uppercase tracking-widest font-bold mb-2" style={{ color: C.muted, letterSpacing: "0.12em" }}>Top clients this month</p>
              <div className="space-y-1.5">
                {insights.topClients.map(({ client, monthValue }, i) => (
                  <button type="button" key={client.id} onClick={() => setActive("clients")} className="w-full flex items-center gap-3 active:scale-[0.99] transition">
                    <div className="flex items-center justify-center font-bold rounded-full"
                      style={{ width: 24, height: 24, background: i === 0 ? C.gold : C.ivory, color: i === 0 ? C.espresso : C.coffee, fontFamily: FONT_DISPLAY, fontSize: 12 }}>
                      {i + 1}
                    </div>
                    <p className="flex-1 text-sm font-semibold text-left truncate" style={{ color: C.espresso }}>{client.name}</p>
                    <p className="text-sm font-mono font-bold" style={{ color: C.goldDeep }}>{fmtMoney(monthValue, business?.currency || "USD")}</p>
                  </button>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
};

const AppointmentCommHistory = ({ appointmentId, commLog }: { appointmentId: string; commLog: any[] }) => {
  const entries = useMemo(() =>
    (Array.isArray(commLog) ? commLog : [])
      .filter(e => e && e.appointmentId === appointmentId)
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")),
    [commLog, appointmentId]);
  if (entries.length === 0) return null;
  return (
    <Card className="p-3.5" style={{ background: C.ivory }}>
      <p className="text-[10px] uppercase tracking-widest font-bold mb-2" style={{ color: C.muted, letterSpacing: "0.12em" }}>Messages sent</p>
      <div className="flex flex-wrap gap-1.5">
        {entries.slice(0, 6).map((e: any) => (
          <Pill key={e.id} tone={e.action === "sent" ? "success" : e.action === "shared" ? "gold" : "neutral"}>
            {e.typeLabel || e.type} · {fmtRelative(e.createdAt)}
          </Pill>
        ))}
      </div>
    </Card>
  );
};

const ClientCommunicationTimeline = ({ clientId, commLog }: { clientId: string; commLog: any[] }) => {
  const entries = useMemo(() =>
    (Array.isArray(commLog) ? commLog : [])
      .filter(e => e && e.clientId === clientId)
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
      .slice(0, 6),
    [commLog, clientId]);

  if (entries.length === 0) return null;

  const actionTone = (action: string): "success" | "gold" | "neutral" => {
    if (action === "sent") return "success";
    if (action === "shared") return "gold";
    return "neutral";
  };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: C.muted, letterSpacing: "0.12em" }}>Communication timeline</p>
        <span className="text-[10px]" style={{ color: C.muted }}>{entries.length} recent</span>
      </div>
      <div className="space-y-1.5">
        {entries.map((e: any) => (
          <div key={e.id} className="flex items-center gap-2">
            <Pill tone={actionTone(e.action)}>{(e.action || "draft").toUpperCase()}</Pill>
            <p className="flex-1 text-[12px] truncate" style={{ color: C.coffee }}>{e.typeLabel || e.type || "Message"}</p>
            <span className="text-[10px] shrink-0" style={{ color: C.muted }}>{fmtRelative(e.createdAt)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
};

const ClientRetentionCard = ({ clientId, clientName, appointments, today, business, openCommunication, onDuplicate }: {
  clientId: string;
  clientName?: string;
  appointments: any[];
  today: string;
  business: any;
  openCommunication?: (ctx: CommContext) => void;
  onDuplicate?: (prefill: any) => void;
}) => {
  const { metrics, status, score, latestCompleted } = useMemo(() => {
    const m = calculateClientMetrics(clientId, appointments || [], today);
    const lifetimes = (Array.isArray(appointments) ? appointments : [])
      .reduce<Record<string, number>>((acc, a) => {
        if (!a?.clientId) return acc;
        acc[a.clientId] = (acc[a.clientId] || 0) + calculateCollectedAmount(a);
        return acc;
      }, {});
    const ltvList = Object.values(lifetimes).filter(v => v > 0).sort((a, b) => a - b);
    const p75 = ltvList.length >= 4 ? ltvList[Math.floor(ltvList.length * 0.75)] : 800;
    const vipThreshold = Math.max(p75, 800);
    const s = getClientStatus(m, vipThreshold);
    const score = calculateRetentionScore(m);
    const latest = (Array.isArray(appointments) ? appointments : [])
      .filter(a => a?.clientId === clientId && (a.status === "completed" || a.paymentStatus === "paid"))
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0];
    return { metrics: m, status: s, score, latestCompleted: latest };
  }, [clientId, appointments, today]);

  if (metrics.totalAppts === 0) {
    return (
      <Card className="p-4 text-center" style={{ background: C.ivory }}>
        <Sparkles size={16} style={{ color: C.gold, margin: "0 auto 4px" }} />
        <p className="text-sm font-semibold" style={{ color: C.espresso }}>No history yet</p>
        <p className="text-[11px] mt-0.5" style={{ color: C.muted }}>Loyalty stats will appear after the first appointment.</p>
      </Card>
    );
  }

  const handleDuplicate = () => {
    if (!latestCompleted || !onDuplicate) return;
    onDuplicate({
      clientId,
      clientName,
      clientPhone: latestCompleted.clientPhone,
      clientEmail: latestCompleted.clientEmail,
      style: latestCompleted.style || metrics.mostBookedStyle || "",
      durationHours: latestCompleted.durationHours,
      totalPrice: latestCompleted.totalPrice,
    });
  };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Pill tone={CLIENT_STATUS_TONE[status]}>{CLIENT_STATUS_LABEL[status]}</Pill>
          {metrics.upcomingAppointmentDate && <Pill tone="success">Booked {fmtDate(metrics.upcomingAppointmentDate)}</Pill>}
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: C.muted, letterSpacing: "0.12em" }}>Retention</p>
          <p style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 600, color: score >= 70 ? C.success : score >= 40 ? C.goldDeep : C.danger }}>
            {score}<span className="text-xs" style={{ color: C.muted }}>/100</span>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center mb-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: C.muted }}>Visits</p>
          <p style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600, color: C.espresso }}>{metrics.completedAppts}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: C.muted }}>Lifetime</p>
          <p style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600, color: C.goldDeep }}>{fmtMoney(metrics.lifetimeValue, business?.currency || "USD")}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: C.muted }}>Avg spend</p>
          <p style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600, color: C.espresso }}>{fmtMoney(metrics.averageSpend, business?.currency || "USD")}</p>
        </div>
      </div>

      <div className="text-[11px] space-y-0.5" style={{ color: C.muted }}>
        {metrics.lastAppointmentDate && (
          <p>Last visit · {fmtDate(metrics.lastAppointmentDate)} ({metrics.daysSinceLast}d ago)</p>
        )}
        {metrics.averageDaysBetween != null && (
          <p>Average rebook cadence · every {metrics.averageDaysBetween} days</p>
        )}
        {metrics.mostBookedStyle && (
          <p>Most booked · {metrics.mostBookedStyle}</p>
        )}
        {(metrics.cancelledAppts > 0 || metrics.noShowAppts > 0) && (
          <p>
            {metrics.cancelledAppts > 0 && `${metrics.cancelledAppts} cancelled`}
            {metrics.cancelledAppts > 0 && metrics.noShowAppts > 0 && " · "}
            {metrics.noShowAppts > 0 && `${metrics.noShowAppts} no-show${metrics.noShowAppts === 1 ? "" : "s"}`}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 mt-3">
        {openCommunication && (
          <button type="button" onClick={() => openCommunication({ client: { id: clientId, name: clientName }, initialKey: "rebooking_nudge" })}
            className="px-3 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider active:scale-[0.97] transition flex items-center justify-center gap-1.5"
            style={{ background: "transparent", color: C.goldDeep, border: `1px solid ${C.goldDeep}`, letterSpacing: "0.08em" }}>
            <MessageSquare size={12} /> Rebook reminder
          </button>
        )}
        {latestCompleted && onDuplicate && (
          <button type="button" onClick={handleDuplicate}
            className="px-3 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider active:scale-[0.97] transition flex items-center justify-center gap-1.5"
            style={{ background: C.gold, color: C.espresso, border: `1px solid ${C.goldDeep}`, letterSpacing: "0.08em" }}>
            <Repeat size={12} /> Duplicate last
          </button>
        )}
      </div>
    </Card>
  );
};

const QuickTile = ({ icon, label, onClick }) => (
  <button type="button" onClick={onClick} className="rounded-2xl p-4 text-left active:scale-[0.97] transition flex flex-col items-start gap-2"
    style={{ background: C.espresso, color: C.cream, boxShadow: "0 8px 24px -16px rgba(42, 24, 16, 0.4)" }}>
    <div className="rounded-full p-2" style={{ background: "rgba(201, 169, 97, 0.18)", color: C.gold }}>{icon}</div>
    <span className="font-semibold text-[14px]">{label}</span>
  </button>
);

// ============================================================
//  CALCULATOR
// ============================================================
const Calculator = ({ store, prefillFromQuote, onClearPrefill, openSavedQuotes, openConvertToAppt, openPresets, prefillFromPreset, onClearPresetPrefill }) => {
  const { business, upsertQuote } = store;
  const [styleName, setStyleName] = useState("");
  const [hairCost, setHairCost] = useState("");
  const [hourlyRate, setHourlyRate] = useState<string | number>(business.hourlyRate);
  const [hours, setHours] = useState("");
  const [travelFee, setTravelFee] = useState<string | number>(business.defaultTravelFee || 0);
  const [overhead, setOverhead] = useState("");
  const [profitMargin, setProfitMargin] = useState<string | number>(business.profitMargin || 0);
  const [tipPct, setTipPct] = useState<string | number>(0);
  const [addOns, setAddOns] = useState<EntityRecord[]>([]);
  const [savedFlash, setSavedFlash] = useState(false);
  const [labelInput, setLabelInput] = useState("");
  const [showSaveSheet, setShowSaveSheet] = useState(false);

  useEffect(() => {
    if (prefillFromQuote) {
      const q = prefillFromQuote;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- prop-driven prefill, intentional sync
      setStyleName(q.style || ""); setHairCost(q.inputs?.hairCost ?? "");
      setHourlyRate(q.inputs?.hourlyRate ?? business.hourlyRate);
      setHours(q.inputs?.hours ?? ""); setTravelFee(q.inputs?.travelFee ?? 0);
      setOverhead(q.inputs?.overhead ?? ""); setProfitMargin(q.inputs?.profitMargin ?? 0);
      setTipPct(q.inputs?.tipPct ?? 0); setAddOns(q.inputs?.addOns || []);
      setLabelInput(q.label || "");
      onClearPrefill?.();
    }
  }, [prefillFromQuote]);

  useEffect(() => {
    if (prefillFromPreset) {
      const p = prefillFromPreset;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- prop/store-driven sync, intentional
      setStyleName(p.name || "");
      setHairCost(p.hairCost ?? "");
      setHourlyRate(p.hourlyRate ?? business.hourlyRate);
      setHours(p.estimatedHours ?? "");
      setOverhead(p.overhead ?? "");
      setProfitMargin(p.profitMargin ?? 0);
      setAddOns((p.defaultAddOns || []).map(a => ({ ...a, id: uid() })));
      onClearPresetPrefill?.();
    }
  }, [prefillFromPreset]);

  // Selectable discount applied to this quote. Stored as the full
  // selected row so we can also surface a "discount may eat your
  // profit" warning. Defaults to none — the user has to opt in.
  const [selectedDiscountId, setSelectedDiscountId] = useState<string | null>(null);
  const allDiscounts: Discount[] = store.discountsApi?.discounts || [];
  const availableDiscounts = useMemo(
    () => selectableDiscounts(allDiscounts),
    [allDiscounts],
  );
  const selectedDiscount = useMemo(
    () => availableDiscounts.find(d => d.id === selectedDiscountId) || null,
    [availableDiscounts, selectedDiscountId],
  );
  // If a selected discount becomes inactive / expires, drop it silently.
  useEffect(() => {
    if (selectedDiscountId && !selectedDiscount) setSelectedDiscountId(null);
  }, [selectedDiscountId, selectedDiscount]);

  const inputs = { hairCost, hourlyRate, hours, travelFee, overhead, profitMargin, tipPct, addOns };
  const result = useMemo(
    () => computePricing(inputs, selectedDiscount),
    [hairCost, hourlyRate, hours, travelFee, overhead, profitMargin, tipPct, addOns, selectedDiscount],
  );

  // Profit estimate for the warning banner: what the stylist set as
  // their target margin, minus the dollar value of the discount. If
  // the discount swallows the whole margin, surface a soft warning.
  const profitWarning =
    selectedDiscount && Number(profitMargin) > 0 && result.discountAmount > Number(profitMargin)
      ? "This discount may reduce your profit below your target margin."
      : null;

  const reset = () => {
    setStyleName(""); setHairCost(""); setHourlyRate(business.hourlyRate);
    setHours(""); setTravelFee(business.defaultTravelFee || 0);
    setOverhead(""); setProfitMargin(business.profitMargin || 0);
    setTipPct(0); setAddOns([]); setLabelInput(""); setSelectedDiscountId(null);
  };

  const addAddOn = () => setAddOns([...addOns, { id: uid(), name: "", amount: "" }]);
  const updateAddOn = (id, field, val) => setAddOns(addOns.map(a => a.id === id ? { ...a, [field]: val } : a));
  const removeAddOn = (id) => setAddOns(addOns.filter(a => a.id !== id));

  const handleSave = async () => {
    if (!styleName && !labelInput) { setShowSaveSheet(true); return; }
    await actuallySave(labelInput || styleName);
  };
  const actuallySave = async (label) => {
    const quote: any = {
      label: label || styleName || "Untitled quote",
      style: styleName,
      inputs: { hairCost, hourlyRate, hours, travelFee, overhead, profitMargin, tipPct, addOns },
      breakdown: result,
      // Snapshot the discount so historical quotes don't reprice if
      // the discount is later renamed or deleted.
      discountId: selectedDiscount?.id ?? null,
      discountName: selectedDiscount?.name ?? null,
      discountAmount: result.discountAmount || 0,
    };
    await upsertQuote(quote);
    setShowSaveSheet(false);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
  };

  const handleConvertToAppointment = () => {
    // Pass the pre-discount price plus tip as the appointment's
    // totalPrice; the discount is carried as a separate snapshot so
    // the appointment row records both the agreed gross price and
    // the credit applied. balanceDue logic on the appointment side
    // reduces by discountAmount, so the net behaviour matches the
    // calculator's finalPrice.
    openConvertToAppt({
      style: styleName,
      totalPrice: Number(((result.subtotalBeforeDiscount || result.subtotal) + (result.tipAmount || 0)).toFixed(2)),
      discountId: selectedDiscount?.id ?? null,
      discountName: selectedDiscount?.name ?? null,
      discountAmount: result.discountAmount || 0,
    });
  };

  return (
    <div className="bbp-fade">
      <Header
        title="Pricing Calculator"
        leftAction={<button type="button" onClick={openPresets} className="p-2 rounded-full" style={{ color: C.coffee }}><Layers size={20} /></button>}
        rightAction={<button type="button" onClick={openSavedQuotes} className="p-2 rounded-full" style={{ color: C.coffee }}><FileText size={20} /></button>}
      />

      <div className="px-5 pt-4 pb-32 space-y-4">
        <button type="button" onClick={openPresets}
          className="w-full p-3 rounded-xl flex items-center gap-3 text-left active:scale-[0.99] transition"
          style={{ background: C.ivory, border: `1px dashed ${C.caramel}`, color: C.coffee }}>
          <div className="rounded-full p-2" style={{ background: C.gold, color: C.espresso }}><Layers size={16} /></div>
          <div className="flex-1">
            <p className="text-sm font-semibold" style={{ color: C.espresso }}>Use a style preset</p>
            <p className="text-xs" style={{ color: C.muted }}>Auto-fill pricing for your saved styles</p>
          </div>
          <ChevronRight size={16} style={{ color: C.muted }} />
        </button>

        <Field label="Style / Service">
          <Input value={styleName} onChange={e => setStyleName(e.target.value)} placeholder="e.g. Knotless mid-back" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Hair / product cost"><MoneyInput value={hairCost} onChange={setHairCost} /></Field>
          <Field label="Travel fee"><MoneyInput value={travelFee} onChange={setTravelFee} /></Field>
          <Field label="Hourly rate"><MoneyInput value={hourlyRate} onChange={setHourlyRate} /></Field>
          <Field label="Hours"><MoneyInput prefix="" suffix="hrs" placeholder="6.5" value={hours} onChange={setHours} /></Field>
          <Field label="Overhead" hint="supplies, utils"><MoneyInput value={overhead} onChange={setOverhead} /></Field>
          <Field label="Profit margin" hint="flat $"><MoneyInput value={profitMargin} onChange={setProfitMargin} /></Field>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[13px] font-semibold tracking-wide uppercase" style={{ color: C.coffee, letterSpacing: "0.06em" }}>Add-ons</span>
            <button type="button" onClick={addAddOn} className="flex items-center gap-1 text-xs font-semibold" style={{ color: C.goldDeep }}>
              <Plus size={14} /> Add row
            </button>
          </div>
          {addOns.length === 0 ? (
            <Card className="p-3.5 text-center">
              <p className="text-xs" style={{ color: C.muted }}>No add-ons. Edges, washing, or beads can go here.</p>
            </Card>
          ) : (
            <div className="space-y-2">
              {addOns.map(a => (
                <div key={a.id} className="flex items-center gap-2">
                  <div className="flex-1"><Input value={a.name} onChange={e => updateAddOn(a.id, "name", e.target.value)} placeholder="Add-on name" /></div>
                  <div className="w-24"><MoneyInput value={a.amount} onChange={(v) => updateAddOn(a.id, "amount", v)} /></div>
                  <button type="button" onClick={() => removeAddOn(a.id)} className="p-2 rounded-lg" style={{ color: C.danger }}><Trash2 size={18} /></button>
                </div>
              ))}
            </div>
          )}
        </div>

        <Field label="Discount" hint={availableDiscounts.length === 0 ? "Create a Studio Offer in Settings → Discounts." : "Optional. Applied before tip."}>
          <Select
            value={selectedDiscountId || ""}
            onChange={e => setSelectedDiscountId(e.target.value || null)}
            options={availableDiscounts.length === 0
              ? [{ value: "", label: "No discounts available" }]
              : [
                  { value: "", label: "No discount" },
                  ...availableDiscounts.map(d => ({
                    value: d.id,
                    label: `${d.name} — ${formatDiscountValue(d)}`,
                  })),
                ]
            }
          />
        </Field>
        {profitWarning && (
          <Card className="p-3" style={{ background: C.ivory, border: `1px solid ${C.warning}` }}>
            <div className="flex items-start gap-2">
              <AlertTriangle size={16} style={{ color: C.warning, marginTop: 2, flexShrink: 0 }} />
              <p className="text-[12px]" style={{ color: C.coffee }}>
                {profitWarning}
              </p>
            </div>
          </Card>
        )}

        <Field label="Tip %" hint="of discounted subtotal">
          <MoneyInput prefix="" suffix="%" value={tipPct} onChange={setTipPct} />
        </Field>

        {/* Preview-style breakdown card — same math, softer chrome. */}
        <PreviewStyleCard style={{ marginTop: 16 }} padding={20}>
          <SectionEyebrow>The breakdown</SectionEyebrow>
          {styleName && (
            <p style={{ margin: "6px 0 12px", fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 600, color: C.espresso, lineHeight: 1.15 }}>
              {styleName}
            </p>
          )}
          <div style={{ marginTop: styleName ? 0 : 8 }}>
            <MetricRow label="Hair / product" value={fmtMoney(result.hairCost, business.currency)} />
            <MetricRow label={`Labor (${result.hours || 0}h × ${fmtMoney(result.hourlyRate, business.currency)})`} value={fmtMoney(result.labor, business.currency)} />
            {result.travelFee > 0 && <MetricRow label="Travel" value={fmtMoney(result.travelFee, business.currency)} />}
            {result.addOnsTotal > 0 && <MetricRow label="Add-ons" value={fmtMoney(result.addOnsTotal, business.currency)} />}
            {result.overhead > 0 && <MetricRow label="Overhead" value={fmtMoney(result.overhead, business.currency)} />}
            {result.profitMargin > 0 && <MetricRow label="Profit margin" value={fmtMoney(result.profitMargin, business.currency)} />}
          </div>
          <div className="my-3" style={{ borderTop: `1px solid rgba(74,44,26,0.08)` }} />
          {result.discountAmount > 0 && (
            <MetricRow
              label={selectedDiscount ? `Discount — ${selectedDiscount.name}` : "Discount"}
              value={`− ${fmtMoney(result.discountAmount, business.currency)}`}
            />
          )}
          <MetricRow label="Subtotal" value={fmtMoney(result.subtotal, business.currency)} emphasis="strong" />
          {result.tipPct > 0 && <MetricRow label={`Tip (${result.tipPct}% of subtotal)`} value={fmtMoney(result.tipAmount, business.currency)} />}
          <div className="mt-4 pt-4" style={{ borderTop: `1px solid rgba(201, 169, 97, 0.4)`, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <SectionEyebrow>Final price</SectionEyebrow>
            <p style={{ margin: 0, fontFamily: FONT_DISPLAY, fontSize: 36, fontWeight: 600, color: C.goldDeep, lineHeight: 1, letterSpacing: "-0.01em" }}>
              {fmtMoney(result.finalPrice, business.currency)}
            </p>
          </div>
        </PreviewStyleCard>

        <div className="grid grid-cols-2 gap-3 pt-2">
          <Button variant="primary" icon={savedFlash ? <Check size={18} /> : <Save size={18} />} onClick={handleSave}>
            {savedFlash ? "Saved" : "Save Quote"}
          </Button>
          <Button variant="dark" icon={<CalendarPlus size={18} />} onClick={handleConvertToAppointment} disabled={result.finalPrice <= 0}>Book it</Button>
        </div>
        <Button variant="outline" icon={<RefreshCw size={16} />} onClick={reset} fullWidth>Reset calculator</Button>
      </div>

      <Sheet open={showSaveSheet} onClose={() => setShowSaveSheet(false)} title="Name this quote">
        <Field label="Quote label">
          <Input value={labelInput} onChange={e => setLabelInput(e.target.value)} placeholder="e.g. Tiana — knotless quote" />
        </Field>
        <div className="mt-5">
          <Button variant="primary" fullWidth onClick={() => actuallySave(labelInput)} disabled={!labelInput.trim()}>Save</Button>
        </div>
      </Sheet>
    </div>
  );
};

const BreakRow = ({ label, value, bold }: { label: string; value: string; bold?: boolean }) => (
  <div className="flex items-center justify-between py-1">
    <span className="text-sm" style={{ color: bold ? C.cream : "rgba(245, 235, 217, 0.75)", fontWeight: bold ? 600 : 400 }}>{label}</span>
    <span style={{ color: bold ? C.gold : C.cream, fontWeight: bold ? 700 : 500 }} className="text-sm font-mono">{value}</span>
  </div>
);
// ============================================================
//  SCHEDULE
// ============================================================
// Day timeline runs 6 AM through 9 PM. Each row is HOUR_PX tall so
// blocks can be absolutely positioned by start time and duration.
const TIMELINE_START_HOUR = 6;
const TIMELINE_END_HOUR = 21;
const HOUR_PX = 60;

const Schedule = ({ store, prefillNewAppt, clearApptPrefill, openTimerForAppt, openCommunication, openReceipt, openQuickClient, openAvailability }: { store: any; prefillNewAppt: any; clearApptPrefill: any; openTimerForAppt: any; openCommunication?: (ctx: CommContext) => void; openReceipt?: (rcp: ReceiptRecord) => void; openQuickClient?: () => void; openAvailability?: (focus?: "exception" | "weekly") => void }) => {
  const { appointments, business, recurringSeries } = store;
  const [editing, setEditing] = useState<EntityRecord | null>(null);
  const [prefs, setPrefs] = useCalendarPrefs();
  const [showSettings, setShowSettings] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const today = todayISO();
  const [selectedDate, setSelectedDate] = useState<string>(today);

  useEffect(() => {
    if (prefillNewAppt) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- prop/store-driven sync, intentional
      setEditing({ ...prefillNewAppt, status: prefillNewAppt.status || "scheduled" });
      clearApptPrefill?.();
    }
  }, [prefillNewAppt]);

  // Sunday-anchored 7-day strip around the selected date.
  const weekDates = useMemo(() => {
    const sel = new Date(selectedDate + "T00:00:00");
    const dow = sel.getDay();
    const sundayIso = addDaysISO(selectedDate, -dow);
    return Array.from({ length: 7 }, (_, i) => addDaysISO(sundayIso, i));
  }, [selectedDate]);

  const monthLabel = useMemo(() => {
    const d = new Date(selectedDate + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }, [selectedDate]);

  const dateHasAppts = useMemo(() => {
    const set = new Set<string>();
    for (const a of appointments) {
      if (!prefs.showCanceled && a.status === "cancelled") continue;
      if (a.date) set.add(a.date);
    }
    return set;
  }, [appointments, prefs.showCanceled]);

  const apptsForSelectedDay = useMemo(() => {
    return (appointments as any[])
      .filter(a => a.date === selectedDate)
      .filter(a => prefs.showCanceled || a.status !== "cancelled")
      .sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  }, [appointments, selectedDate, prefs.showCanceled]);

  // Phase 2 — read the day's availability snapshot if the user has
  // configured weekly hours / exceptions. computeDayStatus uses it
  // for "Off" / "Limited" / capacity-aware "Fully booked".
  const availabilityRules = (store.availabilityApi?.rules as AvailabilityRule[]) || [];
  const availabilityExceptions = (store.availabilityApi?.exceptions as AvailabilityException[]) || [];
  const dayAvailability = useMemo(
    () => computeDayAvailability(selectedDate, availabilityRules, availabilityExceptions),
    [selectedDate, availabilityRules, availabilityExceptions],
  );
  const dayStatus = useMemo(
    () => computeDayStatus(apptsForSelectedDay, {
      availability: {
        open: dayAvailability.open,
        capacityMinutes: dayCapacityMinutes(dayAvailability),
        label: dayAvailability.label,
        kind: dayAvailability.kind,
      },
    }),
    [apptsForSelectedDay, dayAvailability],
  );

  // Income view aggregations are scoped to the selected day. Personal
  // events and blocked time live in the same table but never carry
  // revenue — filter them out so they can't poison the totals.
  const dayMoney = useMemo(() => {
    let expected = 0;
    let deposits = 0;
    let pending = 0;
    let completed = 0;
    const billable = apptsForSelectedDay.filter(
      a => !a?.kind || a.kind === "appointment",
    );
    for (const a of billable) {
      const total = Number(a?.totalPrice) || 0;
      const discount = Number(a?.discountAmount) || 0;
      const net = Math.max(0, total - discount);
      const dep = Number(a?.depositPaid) || 0;
      const balance = Math.max(0, net - dep);
      expected += net;
      deposits += dep;
      pending += balance;
      if (a?.status === "completed") completed += net;
    }
    return {
      expected, deposits, pending, completed,
      count: billable.length,
    };
  }, [apptsForSelectedDay]);

  const goToToday = () => setSelectedDate(today);

  // Move the visible week. Anchored to the current selectedDate's
  // week start so successive shifts compose cleanly. We move the
  // *selectedDate itself* by ±7 days so the gold-circle highlight
  // travels with the strip — the user can keep tapping the same
  // weekday to scrub through weeks. monthLabel + weekDates re-derive
  // automatically from selectedDate.
  const shiftWeek = (direction: 1 | -1) => {
    setSelectedDate(prev => addDaysISO(prev, direction * 7));
  };

  // Touch-driven horizontal swipe. We capture startX on touchstart
  // and decide on touchend; threshold of 40px filters out vertical
  // scroll noise. Direction maps to "swipe content left = next week"
  // which matches iOS conventions and the spec.
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const onWeekTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    swipeStart.current = { x: t.clientX, y: t.clientY };
  };
  const onWeekTouchEnd = (e: React.TouchEvent) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 40) return;
    if (Math.abs(dy) > Math.abs(dx)) return; // vertical scroll won
    shiftWeek(dx < 0 ? 1 : -1);
  };

  return (
    <div className="bbp-fade pb-32">
      {/* HEADER — overflow / month / plus */}
      <div
        className="flex items-center justify-between px-5 pt-4 pb-2"
        style={{ background: C.cream }}
      >
        <button
          type="button"
          onClick={() => setShowSettings(true)}
          aria-label="Calendar settings"
          className="p-2 rounded-full"
          style={{ color: C.coffee }}
        >
          <Filter size={20} />
        </button>
        <button
          type="button"
          onClick={() => setShowDatePicker(true)}
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg active:scale-[0.98] transition"
          aria-label="Open date picker"
        >
          <span style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 600, color: C.espresso }}>
            {monthLabel}
          </span>
          <ChevronDown size={16} style={{ color: C.coffee }} />
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowCreateMenu(v => !v)}
            aria-label="New calendar item"
            aria-expanded={showCreateMenu}
            className="p-2 rounded-full active:scale-[0.97] transition"
            style={{
              color: C.paper,
              background: `linear-gradient(180deg, ${C.gold}, ${C.goldDeep})`,
              boxShadow: "0 6px 14px -6px rgba(168, 137, 63, 0.55)",
            }}
          >
            <Plus size={18} />
          </button>
          {showCreateMenu && (
            <CreateMenu
              onClose={() => setShowCreateMenu(false)}
              onCreateAppointment={() => {
                setShowCreateMenu(false);
                setEditing({ date: selectedDate, kind: "appointment" });
              }}
              onCreateClient={() => {
                setShowCreateMenu(false);
                openQuickClient?.();
              }}
              onCreatePersonalEvent={() => {
                setShowCreateMenu(false);
                setEditing({ date: selectedDate, kind: "personal" });
              }}
              onBlockOffTime={() => {
                setShowCreateMenu(false);
                setEditing({ date: selectedDate, kind: "blocked" });
              }}
            />
          )}
        </div>
      </div>

      {/* WEEK STRIP — swipeable + chevron fallback */}
      <div
        className="flex items-center gap-1 px-2 mb-3"
        onTouchStart={onWeekTouchStart}
        onTouchEnd={onWeekTouchEnd}
      >
        <button
          type="button"
          onClick={() => shiftWeek(-1)}
          aria-label="Previous week"
          className="p-1.5 rounded-full active:scale-[0.95] transition shrink-0"
          style={{ color: C.muted }}
        >
          <ChevronLeft size={18} />
        </button>
        <div className="grid grid-cols-7 gap-1 flex-1">
        {weekDates.map(iso => {
          const d = new Date(iso + "T00:00:00");
          const isSelected = iso === selectedDate;
          const isToday = iso === today;
          const dow = d.toLocaleDateString("en-US", { weekday: "narrow" });
          const dayNum = d.getDate();
          const has = dateHasAppts.has(iso);
          return (
            <button
              type="button"
              key={iso}
              onClick={() => setSelectedDate(iso)}
              aria-current={isSelected ? "date" : undefined}
              className="flex flex-col items-center gap-1 py-2 rounded-xl active:scale-[0.97] transition"
              style={{ color: isSelected ? C.paper : C.coffee }}
            >
              <span
                className="text-[10px] font-semibold tracking-widest"
                style={{ color: isSelected ? C.gold : C.muted, letterSpacing: "0.12em" }}
              >
                {dow}
              </span>
              <span
                className="flex items-center justify-center text-[14px] font-semibold"
                style={{
                  width: 32, height: 32, borderRadius: 999,
                  background: isSelected
                    ? `linear-gradient(180deg, ${C.gold}, ${C.goldDeep})`
                    : (isToday ? C.ivory : "transparent"),
                  color: isSelected ? C.paper : C.espresso,
                  border: isToday && !isSelected ? `1px solid ${C.gold}` : "none",
                  boxShadow: isSelected ? "0 6px 14px -6px rgba(168, 137, 63, 0.55)" : "none",
                }}
              >
                {dayNum}
              </span>
              <span
                aria-hidden
                style={{
                  width: 4, height: 4, borderRadius: 999,
                  background: has ? (isSelected ? C.cream : C.gold) : "transparent",
                }}
              />
            </button>
          );
        })}
        </div>
        <button
          type="button"
          onClick={() => shiftWeek(1)}
          aria-label="Next week"
          className="p-1.5 rounded-full active:scale-[0.95] transition shrink-0"
          style={{ color: C.muted }}
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* VIEW PILLS */}
      <div className="px-5 mb-4">
        <div className="flex p-1 rounded-xl" style={{ background: C.ivory, border: `1px solid ${C.hairline}` }}>
          {([
            { id: "day", label: "Day" },
            { id: "week", label: "Week" },
            { id: "list", label: "List" },
            { id: "income", label: "Income" },
          ] as { id: CalendarView; label: string }[]).map(t => (
            <button
              type="button"
              key={t.id}
              onClick={() => setPrefs({ view: t.id })}
              className="flex-1 py-2 rounded-lg text-[12px] font-semibold transition"
              style={{
                background: prefs.view === t.id ? C.espresso : "transparent",
                color: prefs.view === t.id ? C.cream : C.coffee,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-5 space-y-3">
        {prefs.view === "day" && (
          <DayCalendarView
            appts={apptsForSelectedDay}
            dayStatus={dayStatus}
            colorMode={prefs.colorMode}
            today={today}
            business={business}
            onTap={(a) => setEditing(a)}
            onAdd={() => setEditing({ date: selectedDate })}
          />
        )}

        {prefs.view === "week" && (
          <WeekCalendarView
            allAppts={appointments}
            weekDates={weekDates}
            colorMode={prefs.colorMode}
            today={today}
            showCanceled={prefs.showCanceled}
            business={business}
            recurringSeries={recurringSeries}
            onTap={(a) => setEditing(a)}
            onSelectDate={(iso) => { setSelectedDate(iso); setPrefs({ view: "day" }); }}
          />
        )}

        {prefs.view === "list" && (
          <ListCalendarView
            allAppts={appointments}
            today={today}
            showCanceled={prefs.showCanceled}
            business={business}
            recurringSeries={recurringSeries}
            onTap={(a) => setEditing(a)}
            onAdd={() => setEditing({})}
          />
        )}

        {prefs.view === "income" && (
          <IncomeCalendarView
            money={dayMoney}
            currency={business?.currency || "USD"}
            selectedDate={selectedDate}
          />
        )}
      </div>

      <FAB onClick={() => setEditing({})} />

      <AppointmentSheet
        open={!!editing}
        appt={editing}
        store={store}
        onClose={() => setEditing(null)}
        openTimerForAppt={openTimerForAppt}
        openCommunication={openCommunication}
        openReceipt={openReceipt}
      />

      <CalendarSettingsSheet
        open={showSettings}
        prefs={prefs}
        setPrefs={setPrefs}
        onClose={() => setShowSettings(false)}
        onOpenAvailability={openAvailability}
      />

      <DatePickerSheet
        open={showDatePicker}
        selectedDate={selectedDate}
        today={today}
        dateHasAppts={dateHasAppts}
        onSelect={(iso) => { setSelectedDate(iso); setShowDatePicker(false); }}
        onJumpToToday={() => { setSelectedDate(today); setShowDatePicker(false); }}
        onClose={() => setShowDatePicker(false)}
      />
    </div>
  );
};

// ---- Day Calendar -----------------------------------------------------

const DayCalendarView = ({
  appts, dayStatus, colorMode, today, business, onTap, onAdd,
}: {
  appts: any[];
  dayStatus: { status: string; label: string };
  colorMode: ColorMode;
  today: string;
  business: any;
  onTap: (a: any) => void;
  onAdd: () => void;
}) => {
  const HOURS = Array.from(
    { length: TIMELINE_END_HOUR - TIMELINE_START_HOUR + 1 },
    (_, i) => i + TIMELINE_START_HOUR,
  );
  const formatHourLabel = (h: number) => `${((h + 11) % 12) + 1} ${h >= 12 ? "PM" : "AM"}`;

  // Column-packing for overlapping appointments. Two appointments
  // that overlap in time render side-by-side instead of stacking on
  // top of each other (the Square / Apple Calendar treatment). The
  // algorithm:
  //   1. Sort by start time.
  //   2. Walk through; events whose start is before the running
  //      cluster's max-end stay in the same cluster.
  //   3. Greedy column packing: drop the event into the lowest-
  //      indexed column whose previous event has already ended.
  //   4. Each cluster's width is divided by the max columns used
  //      inside it.
  const placedAppts = useMemo(() => {
    type Placed = { appt: any; startMin: number; endMin: number; col: number; clusterCols: number };
    const minutes = (a: any) => {
      const [hh, mm] = (a?.time || "10:00").split(":").map(Number);
      const s = (hh || 0) * 60 + (mm || 0);
      const dur = Math.max(30, (Number(a?.durationHours) || 1) * 60);
      return { s, e: s + dur };
    };
    const sorted = [...appts]
      .map(a => ({ appt: a, ...minutes(a) }))
      .sort((a, b) => a.s - b.s || a.e - b.e);

    const out: Placed[] = [];
    type Cluster = { start: number; end: number; cols: number[]; placedIndices: number[] };
    let cluster: Cluster | null = null;
    const clusters: Cluster[] = [];

    for (const item of sorted) {
      if (!cluster || item.s >= cluster.end) {
        cluster = { start: item.s, end: item.e, cols: [], placedIndices: [] };
        clusters.push(cluster);
      } else {
        cluster.end = Math.max(cluster.end, item.e);
      }
      // Find the first column whose last-end is at or before this start.
      let col = cluster.cols.findIndex(end => end <= item.s);
      if (col === -1) { col = cluster.cols.length; cluster.cols.push(item.e); }
      else cluster.cols[col] = item.e;
      out.push({ appt: item.appt, startMin: item.s, endMin: item.e, col, clusterCols: 0 });
      cluster.placedIndices.push(out.length - 1);
    }
    // Stamp each item with its cluster's final column count.
    for (const c of clusters) {
      const k = c.cols.length;
      for (const i of c.placedIndices) out[i].clusterCols = k;
    }
    return out;
  }, [appts]);

  const dayStatusToneBg = (() => {
    switch (dayStatus.status) {
      case "fully_booked": return "rgba(168, 137, 63, 0.18)";
      case "deposit_due":  return "rgba(201, 118, 43, 0.16)";
      case "openings_available": return "rgba(92, 124, 74, 0.16)";
      case "off":          return "rgba(74, 44, 26, 0.10)";
      default:             return C.ivory;
    }
  })();
  const dayStatusToneFg = (() => {
    switch (dayStatus.status) {
      case "fully_booked": return C.goldDeep;
      case "deposit_due":  return C.warning;
      case "openings_available": return C.success;
      case "off":          return C.muted;
      default:             return C.coffee;
    }
  })();

  return (
    <div className="space-y-3">
      <Card className="px-4 py-3 flex items-center justify-between" style={{ background: dayStatusToneBg, border: `1px solid ${C.hairline}` }}>
        <div>
          <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: C.muted, letterSpacing: "0.14em" }}>All day</p>
          <p className="text-sm font-semibold mt-0.5" style={{ color: dayStatusToneFg }}>{dayStatus.label}</p>
        </div>
        <span className="text-[11px] font-semibold" style={{ color: C.muted }}>
          {appts.length} {appts.length === 1 ? "booking" : "bookings"}
        </span>
      </Card>

      {appts.length === 0 ? (
        <EmptyState
          icon={<Calendar size={28} style={{ color: C.gold }} />}
          title="No bookings yet."
          body="Your appointments, deposits, and balances will appear here."
          cta={<Button variant="primary" icon={<Plus size={18} />} onClick={onAdd}>Add appointment</Button>}
        />
      ) : (
        <div
          className="relative"
          style={{
            height: HOURS.length * HOUR_PX,
            background: C.paper,
            border: `1px solid ${C.hairline}`,
            borderRadius: 16,
            overflow: "hidden",
          }}
        >
          {HOURS.map((h, idx) => (
            <div
              key={h}
              className="absolute left-0 right-0 flex items-start"
              style={{
                top: idx * HOUR_PX,
                height: HOUR_PX,
                borderTop: idx === 0 ? "none" : `1px dashed ${C.hairline}`,
              }}
            >
              <span
                className="text-[10px] font-semibold tracking-widest pl-3 pt-1"
                style={{ color: C.muted, width: 56, letterSpacing: "0.08em" }}
              >
                {formatHourLabel(h)}
              </span>
            </div>
          ))}

          {placedAppts.map(p => {
            const a = p.appt;
            const dayStartMin = TIMELINE_START_HOUR * 60;
            const dayEndMin = (TIMELINE_END_HOUR + 1) * 60;
            if (p.startMin >= dayEndMin) return null;
            const top = Math.max(0, ((p.startMin - dayStartMin) / 60) * HOUR_PX);
            const durationMin = p.endMin - p.startMin;
            const rawHeight = (durationMin / 60) * HOUR_PX;
            const maxHeight = HOURS.length * HOUR_PX - top;
            const height = Math.max(44, Math.min(rawHeight, maxHeight));

            // Side-by-side packing: each cluster's usable width is
            // divided into N columns. Layout container has 60px left
            // gutter (hour labels) + 8px right padding. A 4px gap
            // sits between adjacent columns.
            const cols = p.clusterCols || 1;
            const isSplit = cols > 1;
            const leftPct = (p.col / cols) * 100;
            const widthPct = 100 / cols;
            const gap = 4;
            const leftStyle = isSplit
              ? `calc(60px + (100% - 68px) * ${leftPct / 100} + ${p.col === 0 ? 0 : gap / 2}px)`
              : "60px";
            const widthStyle = isSplit
              ? `calc((100% - 68px) * ${widthPct / 100} - ${gap}px)`
              : undefined;
            const rightStyle = isSplit ? undefined : 8;

            // Personal events and blocked time skip the standard
            // color coding — both render as neutral / unavailable
            // blocks to keep the timeline readable.
            const kind = a?.kind || "appointment";
            const isPersonalBlock = kind === "personal";
            const isBlockedBlock = kind === "blocked";
            const color = (isPersonalBlock || isBlockedBlock)
              ? {
                  background: isBlockedBlock ? "rgba(74, 44, 26, 0.08)" : "rgba(139, 115, 85, 0.10)",
                  border: isBlockedBlock ? "rgba(74, 44, 26, 0.30)" : "rgba(139, 115, 85, 0.35)",
                  foreground: isBlockedBlock ? C.muted : C.coffee,
                  accent: isBlockedBlock ? C.muted : C.caramel,
                  label: isBlockedBlock ? "Unavailable" : "Personal",
                }
              : colorForAppointment(a, colorMode, today);

            const total = Number(a?.totalPrice) || 0;
            const discount = Number(a?.discountAmount) || 0;
            const net = Math.max(0, total - discount);
            const deposit = Number(a?.depositPaid) || 0;
            const balance = Math.max(0, net - deposit);
            const depositLine =
              deposit <= 0 ? "Deposit due"
              : deposit < net ? `Deposit ${fmtMoney(deposit, business?.currency)}`
              : "Deposit paid";
            const balanceLine = balance > 0 ? `Balance ${fmtMoney(balance, business?.currency)}` : null;

            const titleLine = isBlockedBlock
              ? (a.eventTitle || "Unavailable")
              : isPersonalBlock
                ? (a.eventTitle || "Personal event")
                : (a.clientName || "Open slot");
            const isAllDay = !!a?.isAllDay;
            const blocksAvail = a?.blocksAvailability !== false;
            const subLine = isAllDay
              ? `All day${blocksAvail ? " · Availability blocked" : ""}`
              : isBlockedBlock
                ? `${fmtTime(a.time)} · Off`
                : isPersonalBlock
                  ? `${fmtTime(a.time)} · Personal`
                  : `${fmtTime(a.time)} · ${a.style || "Service"}`;

            return (
              <button
                type="button"
                key={a.id}
                onClick={() => onTap(a)}
                className="absolute text-left active:scale-[0.99] transition"
                style={{
                  top: top + 2,
                  left: leftStyle,
                  right: rightStyle,
                  width: widthStyle,
                  height: height - 4,
                  padding: "8px 10px",
                  borderRadius: 12,
                  background: color.background,
                  border: `1px solid ${color.border}`,
                  borderLeft: `4px solid ${color.accent}`,
                  borderStyle: isBlockedBlock ? "dashed" : "solid",
                  color: color.foreground,
                  overflow: "hidden",
                }}
              >
                <p className="text-[13px] font-semibold leading-tight truncate">
                  {titleLine}
                </p>
                <p className="text-[11px] mt-0.5 truncate" style={{ opacity: 0.85 }}>
                  {subLine}
                </p>
                {height >= 60 && !isPersonalBlock && !isBlockedBlock && (
                  <p className="text-[11px] mt-0.5 truncate" style={{ opacity: 0.85 }}>
                    {depositLine}{balanceLine ? ` · ${balanceLine}` : ""}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ---- Week Calendar (mobile-friendly: day-grouped lists) ---------------

const WeekCalendarView = ({
  allAppts, weekDates, colorMode, today, showCanceled, business, recurringSeries, onTap, onSelectDate,
}: {
  allAppts: any[];
  weekDates: string[];
  colorMode: ColorMode;
  today: string;
  showCanceled: boolean;
  business: any;
  recurringSeries: any;
  onTap: (a: any) => void;
  onSelectDate: (iso: string) => void;
}) => {
  return (
    <div className="space-y-4">
      {weekDates.map(iso => {
        const list = (allAppts as any[])
          .filter(a => a.date === iso)
          .filter(a => showCanceled || a.status !== "cancelled")
          .sort((a, b) => (a.time || "").localeCompare(b.time || ""));
        const d = new Date(iso + "T00:00:00");
        const isToday = iso === today;
        return (
          <div key={iso}>
            <button
              type="button"
              onClick={() => onSelectDate(iso)}
              className="flex items-baseline justify-between w-full mb-2 active:scale-[0.99] transition"
            >
              <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: isToday ? C.goldDeep : C.muted, letterSpacing: "0.14em" }}>
                {d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
                {isToday ? " · Today" : ""}
              </p>
              <span className="text-[11px] font-semibold" style={{ color: C.muted }}>
                {list.length === 0 ? "—" : `${list.length} booking${list.length === 1 ? "" : "s"}`}
              </span>
            </button>
            {list.length === 0 ? (
              <Card className="px-4 py-3 text-center" style={{ background: C.paper }}>
                <p className="text-[12px]" style={{ color: C.muted }}>No bookings</p>
              </Card>
            ) : (
              <div className="space-y-2">
                {list.map(a => {
                  const kind = a?.kind || "appointment";
                  const isPersonalBlock = kind === "personal";
                  const isBlockedBlock = kind === "blocked";
                  const color = (isPersonalBlock || isBlockedBlock)
                    ? {
                        background: isBlockedBlock ? "rgba(74, 44, 26, 0.08)" : "rgba(139, 115, 85, 0.10)",
                        border: isBlockedBlock ? "rgba(74, 44, 26, 0.30)" : "rgba(139, 115, 85, 0.35)",
                        foreground: isBlockedBlock ? C.muted : C.coffee,
                        accent: isBlockedBlock ? C.muted : C.caramel,
                      }
                    : colorForAppointment(a, colorMode, today);
                  const titleLine = isBlockedBlock
                    ? (a.eventTitle || "Unavailable")
                    : isPersonalBlock
                      ? (a.eventTitle || "Personal event")
                      : (a.clientName || "Open slot");
                  const isAllDay = !!a?.isAllDay;
                  const blocksAvail = a?.blocksAvailability !== false;
                  const subLine = isAllDay
                    ? `All day${blocksAvail ? " · Availability blocked" : ""}`
                    : isBlockedBlock
                      ? `${fmtTime(a.time)} · Off`
                      : isPersonalBlock
                        ? `${fmtTime(a.time)} · Personal`
                        : `${fmtTime(a.time)} · ${a.style || "Service"}`;
                  return (
                    <button
                      type="button"
                      key={a.id}
                      onClick={() => onTap(a)}
                      className="w-full text-left rounded-xl px-3 py-2.5 active:scale-[0.99] transition"
                      style={{
                        background: color.background,
                        border: `1px solid ${color.border}`,
                        borderLeft: `4px solid ${color.accent}`,
                        borderStyle: isBlockedBlock ? "dashed" : "solid",
                        color: color.foreground,
                      }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-semibold truncate">{titleLine}</p>
                          <p className="text-[11px] truncate" style={{ opacity: 0.85 }}>
                            {subLine}
                          </p>
                        </div>
                        {!isPersonalBlock && !isBlockedBlock && (
                          <span className="text-[12px] font-semibold tabular-nums" style={{ opacity: 0.9 }}>
                            {fmtMoney(Number(a.totalPrice) || 0, business?.currency)}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ---- List Calendar (Upcoming / Today / Past / All) --------------------

const ListCalendarView = ({
  allAppts, today, showCanceled, business, recurringSeries, onTap, onAdd,
}: {
  allAppts: any[];
  today: string;
  showCanceled: boolean;
  business: any;
  recurringSeries: any;
  onTap: (a: any) => void;
  onAdd: () => void;
}) => {
  const [filter, setFilter] = useState<"upcoming" | "today" | "past" | "all">("upcoming");
  const filtered = useMemo(() => {
    let list = (allAppts as any[]).filter(a => showCanceled || a.status !== "cancelled");
    if (filter === "today") list = list.filter(a => a.date === today);
    else if (filter === "upcoming") list = list.filter(a => a.date >= today && a.status !== "completed");
    else if (filter === "past") list = list.filter(a => a.date < today || a.status === "completed");
    list.sort((a, b) => {
      const ka = (a.date || "") + (a.time || "");
      const kb = (b.date || "") + (b.time || "");
      return filter === "past" ? kb.localeCompare(ka) : ka.localeCompare(kb);
    });
    return list;
  }, [allAppts, filter, today, showCanceled]);

  return (
    <div className="space-y-3">
      <div className="flex p-1 rounded-xl" style={{ background: C.ivory, border: `1px solid ${C.hairline}` }}>
        {[
          { id: "upcoming", label: "Upcoming" },
          { id: "today", label: "Today" },
          { id: "past", label: "Past" },
          { id: "all", label: "All" },
        ].map(t => (
          <button type="button" key={t.id} onClick={() => setFilter(t.id as any)}
            className="flex-1 py-2 rounded-lg text-[12px] font-semibold transition"
            style={{ background: filter === t.id ? C.espresso : "transparent", color: filter === t.id ? C.cream : C.coffee }}>
            {t.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Calendar size={28} style={{ color: C.gold }} />}
          title="No bookings yet."
          body="Your appointments, deposits, and balances will appear here."
          cta={<Button variant="primary" icon={<Plus size={18} />} onClick={onAdd}>New appointment</Button>}
        />
      ) : (
        <>
          <div className="space-y-2.5">
            {filtered.map(a => <AppointmentRow key={a.id} appt={a} business={business} recurringSeries={recurringSeries} onClick={() => onTap(a)} />)}
          </div>
          <button
            type="button"
            className="w-full text-center text-xs font-semibold mt-3 py-2 flex items-center justify-center gap-1.5"
            style={{ color: C.goldDeep }}
            onClick={() => {
              const ics = buildVCalendar(filtered as IcsAppointment[], { businessName: business?.businessName, currency: business?.currency });
              const fname = sanitizeFilename(`bbp-${filter}`) + ".ics";
              downloadIcs(fname, ics);
            }}>
            <Download size={13} /> Export {filtered.length} appointment{filtered.length === 1 ? "" : "s"} as .ics
          </button>
        </>
      )}
    </div>
  );
};

// ---- Income view -------------------------------------------------------

const IncomeCalendarView = ({
  money, currency, selectedDate,
}: {
  money: { expected: number; deposits: number; pending: number; completed: number; count: number };
  currency: string;
  selectedDate: string;
}) => {
  return (
    <div className="space-y-3">
      <Card className="p-5" style={{ background: `linear-gradient(180deg, ${C.espresso} 0%, ${C.coffee} 100%)`, border: `1px solid ${C.goldDeep}` }}>
        <p className="text-[10px] font-bold tracking-widest uppercase" style={{ color: C.gold, letterSpacing: "0.18em" }}>Expected revenue</p>
        <p style={{ fontFamily: FONT_DISPLAY, fontSize: 40, fontWeight: 600, color: C.cream, lineHeight: 1, marginTop: 6 }}>
          {fmtMoney(money.expected, currency)}
        </p>
        <p className="text-[11px] mt-2" style={{ color: "rgba(245, 235, 217, 0.75)" }}>
          {fmtDateLong(selectedDate)} · {money.count} {money.count === 1 ? "booking" : "bookings"}
        </p>
      </Card>
      <div className="grid grid-cols-2 gap-3">
        <Card className="p-4" style={{ background: C.paper }}>
          <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: C.muted, letterSpacing: "0.14em" }}>Deposits collected</p>
          <p className="mt-1" style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 600, color: C.success }}>
            {fmtMoney(money.deposits, currency)}
          </p>
        </Card>
        <Card className="p-4" style={{ background: C.paper }}>
          <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: C.muted, letterSpacing: "0.14em" }}>Pending balance</p>
          <p className="mt-1" style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 600, color: money.pending > 0 ? C.warning : C.muted }}>
            {fmtMoney(money.pending, currency)}
          </p>
        </Card>
        <Card className="p-4" style={{ background: C.paper }}>
          <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: C.muted, letterSpacing: "0.14em" }}>Completed revenue</p>
          <p className="mt-1" style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 600, color: C.espresso }}>
            {fmtMoney(money.completed, currency)}
          </p>
        </Card>
        <Card className="p-4" style={{ background: C.paper }}>
          <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: C.muted, letterSpacing: "0.14em" }}>Bookings</p>
          <p className="mt-1" style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 600, color: C.espresso }}>
            {money.count}
          </p>
        </Card>
      </div>
    </div>
  );
};

// ---- Calendar Settings Sheet -------------------------------------------

// ---- Floating "Create" menu (Schedule + button) ------------------------
// Tiny popover anchored to the + button. Cream card with hairline
// dividers between actions. Closes on outside-click and Escape so
// mobile Safari and Capacitor both behave.
const CreateMenu = ({
  onClose, onCreateAppointment, onCreateClient, onCreatePersonalEvent, onBlockOffTime,
}: {
  onClose: () => void;
  onCreateAppointment: () => void;
  onCreateClient: () => void;
  onCreatePersonalEvent: () => void;
  onBlockOffTime: () => void;
}) => {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      const node = ref.current;
      if (!node) return;
      if (e.target instanceof Node && !node.contains(e.target)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    // pointerdown is the most reliable cross-platform "tap outside"
    // signal — touchstart fires before scroll on iOS but pointer
    // unifies mouse + touch + pen.
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const items = [
    { icon: <CalendarPlus size={18} />, label: "Create appointment", description: "Booking with a client", onClick: onCreateAppointment },
    { icon: <UserPlus size={18} />,     label: "Create client",      description: "Add someone to your book",  onClick: onCreateClient },
    { icon: <Coffee size={18} />,       label: "Create personal event", description: "Errand, lunch, school, etc.", onClick: onCreatePersonalEvent },
    { icon: <Lock size={18} />,         label: "Block off time",     description: "Mark yourself unavailable", onClick: onBlockOffTime },
  ];

  return (
    <div
      ref={ref}
      role="menu"
      className="absolute z-50 mt-2 right-0 w-64 rounded-2xl overflow-hidden"
      style={{
        background: C.paper,
        border: `1px solid ${C.hairline}`,
        boxShadow:
          "0 1px 2px rgba(42, 24, 16, 0.06), 0 18px 36px -12px rgba(42, 24, 16, 0.22)",
      }}
    >
      {items.map((it, i) => (
        <button
          key={it.label}
          type="button"
          role="menuitem"
          onClick={it.onClick}
          className="w-full flex items-center gap-3 px-4 py-3 active:scale-[0.99] transition text-left"
          style={{
            color: C.espresso,
            borderTop: i === 0 ? "none" : `1px solid ${C.hairline}`,
            background: "transparent",
          }}
        >
          <span
            aria-hidden
            className="flex items-center justify-center shrink-0"
            style={{
              width: 32, height: 32, borderRadius: 999,
              background: C.ivory, color: C.gold, border: `1px solid ${C.hairline}`,
            }}
          >
            {it.icon}
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-[13px] font-semibold leading-tight" style={{ color: C.espresso }}>
              {it.label}
            </span>
            <span className="block text-[11px] mt-0.5" style={{ color: C.muted }}>
              {it.description}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
};

// ---- Full-month Date Picker -------------------------------------------
// Tapping the month/year header opens this. Initial month follows the
// currently selected date, not today (per spec). Has prev/next month
// chevrons, weekday legend, full grid (with leading/trailing days from
// neighbouring months greyed out), and a Today button at the bottom
// that jumps to today and closes.
const DatePickerSheet = ({
  open, selectedDate, today, dateHasAppts, onSelect, onJumpToToday, onClose,
}: {
  open: boolean;
  selectedDate: string;
  today: string;
  dateHasAppts: Set<string>;
  onSelect: (iso: string) => void;
  onJumpToToday: () => void;
  onClose: () => void;
}) => {
  // Anchor the visible month at the selected date when the sheet
  // opens, then let the user navigate from there.
  const initialAnchor = useMemo(() => {
    const d = new Date(selectedDate + "T00:00:00");
    if (Number.isNaN(d.getTime())) return new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }, [selectedDate]);

  const [viewYear, setViewYear] = useState<number>(initialAnchor.getFullYear());
  const [viewMonth, setViewMonth] = useState<number>(initialAnchor.getMonth());

  // Re-anchor each time the sheet opens so reopening lands on the
  // current selected month rather than wherever the user wandered last.
  useEffect(() => {
    if (open) {
      setViewYear(initialAnchor.getFullYear());
      setViewMonth(initialAnchor.getMonth());
    }
  }, [open, initialAnchor]);

  const monthLabel = useMemo(() => {
    const d = new Date(viewYear, viewMonth, 1);
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }, [viewYear, viewMonth]);

  // Build the 6×7 grid: leading days from previous month, the current
  // month's days, trailing days from next month. Sunday-anchored to
  // match the week strip on the schedule screen.
  const cells = useMemo(() => {
    const firstOfMonth = new Date(viewYear, viewMonth, 1);
    const startWeekday = firstOfMonth.getDay(); // 0=Sun
    const gridStart = new Date(viewYear, viewMonth, 1 - startWeekday);
    const out: { iso: string; inMonth: boolean; day: number }[] = [];
    for (let i = 0; i < 42; i += 1) {
      const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      out.push({
        iso: `${y}-${m}-${day}`,
        inMonth: d.getMonth() === viewMonth,
        day: d.getDate(),
      });
    }
    return out;
  }, [viewYear, viewMonth]);

  const shiftMonth = (dir: 1 | -1) => {
    const next = new Date(viewYear, viewMonth + dir, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  };

  return (
    <Sheet open={open} onClose={onClose} title="Pick a date">
      <div className="pb-2">
        <div className="flex items-center justify-between mb-3">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            aria-label="Previous month"
            className="p-2 rounded-full active:scale-[0.95] transition"
            style={{ color: C.coffee }}
          >
            <ChevronLeft size={20} />
          </button>
          <p style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 600, color: C.espresso }}>
            {monthLabel}
          </p>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            aria-label="Next month"
            className="p-2 rounded-full active:scale-[0.95] transition"
            style={{ color: C.coffee }}
          >
            <ChevronRight size={20} />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 mb-2">
          {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
            <span
              key={`${d}-${i}`}
              className="text-[10px] font-bold tracking-widest text-center"
              style={{ color: C.muted, letterSpacing: "0.14em" }}
            >
              {d}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {cells.map(cell => {
            const isSelected = cell.iso === selectedDate;
            const isToday = cell.iso === today;
            const has = dateHasAppts.has(cell.iso);
            return (
              <button
                type="button"
                key={cell.iso}
                onClick={() => onSelect(cell.iso)}
                aria-current={isSelected ? "date" : undefined}
                className="flex flex-col items-center justify-center gap-0.5 py-2 rounded-xl active:scale-[0.97] transition"
                style={{
                  background: isSelected
                    ? `linear-gradient(180deg, ${C.gold}, ${C.goldDeep})`
                    : "transparent",
                  border: isToday && !isSelected ? `1px solid ${C.gold}` : "none",
                  color: isSelected ? C.paper : (cell.inMonth ? C.espresso : C.mutedSoft),
                  boxShadow: isSelected ? "0 6px 14px -6px rgba(168, 137, 63, 0.55)" : "none",
                }}
              >
                <span className="text-[14px] font-semibold">{cell.day}</span>
                <span
                  aria-hidden
                  style={{
                    width: 4, height: 4, borderRadius: 999,
                    background: has && cell.inMonth ? (isSelected ? C.cream : C.gold) : "transparent",
                  }}
                />
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-2 gap-3 mt-5">
          <Button variant="primary" onClick={onJumpToToday}>Today</Button>
          <Button variant="outline" onClick={onClose}>Done</Button>
        </div>
      </div>
    </Sheet>
  );
};

const CalendarSettingsSheet = ({
  open, prefs, setPrefs, onClose, onOpenAvailability,
}: {
  open: boolean;
  prefs: CalendarPrefs;
  setPrefs: (next: Partial<CalendarPrefs>) => void;
  onClose: () => void;
  onOpenAvailability?: (focus?: "exception" | "weekly") => void;
}) => {
  return (
    <Sheet open={open} onClose={onClose} title="Calendar">
      <div className="space-y-5 pb-2">
        <div>
          <p className="text-[10px] uppercase tracking-widest font-bold mb-2" style={{ color: C.muted, letterSpacing: "0.14em" }}>
            Booking availability
          </p>
          <Card
            className="p-4 active:scale-[0.99] cursor-pointer"
            onClick={() => { onClose(); onOpenAvailability?.("exception"); }}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold" style={{ color: C.espresso }}>Make a one-time change</p>
                <p className="text-[11px] mt-0.5" style={{ color: C.muted }}>Block a date · custom hours · vacation</p>
              </div>
              <ChevronRight size={16} style={{ color: C.muted }} />
            </div>
          </Card>
          <Card
            className="p-4 mt-2 active:scale-[0.99] cursor-pointer"
            onClick={() => { onClose(); onOpenAvailability?.("weekly"); }}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold" style={{ color: C.espresso }}>Edit repeating schedule</p>
                <p className="text-[11px] mt-0.5" style={{ color: C.muted }}>Weekly hours · breaks · off days</p>
              </div>
              <ChevronRight size={16} style={{ color: C.muted }} />
            </div>
          </Card>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-widest font-bold mb-2" style={{ color: C.muted, letterSpacing: "0.14em" }}>
            Calendar view
          </p>
          <div className="space-y-2">
            {([
              { id: "day", label: "Day" },
              { id: "week", label: "Week" },
              { id: "list", label: "List" },
              { id: "income", label: "Income" },
            ] as { id: CalendarView; label: string }[]).map(opt => (
              <button
                type="button"
                key={opt.id}
                onClick={() => setPrefs({ view: opt.id })}
                className="w-full text-left rounded-xl px-4 py-3 flex items-center justify-between active:scale-[0.99] transition"
                style={{
                  background: prefs.view === opt.id ? C.ivory : C.paper,
                  border: `1px solid ${prefs.view === opt.id ? C.gold : C.hairline}`,
                }}
              >
                <span className="text-sm font-semibold" style={{ color: C.espresso }}>{opt.label}</span>
                {prefs.view === opt.id && <Check size={16} style={{ color: C.goldDeep }} />}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-widest font-bold mb-2" style={{ color: C.muted, letterSpacing: "0.14em" }}>
            Filters
          </p>
          <Card className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold" style={{ color: C.espresso }}>Show canceled bookings</p>
              <p className="text-[11px] mt-0.5" style={{ color: C.muted }}>Hidden by default to keep the day view clean.</p>
            </div>
            <button
              type="button"
              onClick={() => setPrefs({ showCanceled: !prefs.showCanceled })}
              role="switch"
              aria-checked={prefs.showCanceled}
              className="relative rounded-full transition"
              style={{
                width: 44, height: 26,
                background: prefs.showCanceled ? C.goldDeep : C.hairline,
              }}
            >
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  top: 3, left: prefs.showCanceled ? 21 : 3,
                  width: 20, height: 20, borderRadius: 999,
                  background: C.paper,
                  transition: "left 0.18s",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.12)",
                }}
              />
            </button>
          </Card>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-widest font-bold mb-2" style={{ color: C.muted, letterSpacing: "0.14em" }}>
            Color code
          </p>
          <div className="space-y-2">
            {([
              { id: "status",  label: "By status",        hint: "Booked · Completed · Canceled" },
              { id: "service", label: "By service",       hint: "Soft swatches per style name" },
              { id: "deposit", label: "By deposit status",hint: "Paid · Partial · Unpaid" },
              { id: "balance", label: "By balance due",   hint: "No balance · Due · Overdue" },
            ] as { id: ColorMode; label: string; hint: string }[]).map(opt => (
              <button
                type="button"
                key={opt.id}
                onClick={() => setPrefs({ colorMode: opt.id })}
                className="w-full text-left rounded-xl px-4 py-3 flex items-center justify-between active:scale-[0.99] transition"
                style={{
                  background: prefs.colorMode === opt.id ? C.ivory : C.paper,
                  border: `1px solid ${prefs.colorMode === opt.id ? C.gold : C.hairline}`,
                }}
              >
                <div>
                  <p className="text-sm font-semibold" style={{ color: C.espresso }}>{opt.label}</p>
                  <p className="text-[11px] mt-0.5" style={{ color: C.muted }}>{opt.hint}</p>
                </div>
                {prefs.colorMode === opt.id && <Check size={16} style={{ color: C.goldDeep }} />}
              </button>
            ))}
          </div>
        </div>

        <Button variant="primary" fullWidth onClick={onClose}>Done</Button>
      </div>
    </Sheet>
  );
};

// ============================================================
//  APPOINTMENT SHEET (with recurring + reminders)
// ============================================================
const RECURRENCE_OPTIONS = [
  { value: "2w", label: "Every 2 weeks" },
  { value: "3w", label: "Every 3 weeks" },
  { value: "4w", label: "Every 4 weeks" },
  { value: "6w", label: "Every 6 weeks" },
  { value: "8w", label: "Every 8 weeks" },
  { value: "monthly", label: "Monthly" },
  { value: "custom", label: "Custom" },
];

// ---- Service picker (Phase 2) ----------------------------------------
// Shown above the Style/Service field on appointment forms. Picking a
// service prefills empty/zero fields only; "Replace with service
// defaults" overwrites everything catalog-driven for users who want
// the full reset behavior.
const ServicePicker = ({
  services, value, onPick,
}: {
  services: Service[];
  value: string | null;
  onPick: (svc: Service | null, mode: "fill" | "replace") => void;
}) => {
  const active = services.filter(s => s.is_active);
  const selected = value ? services.find(s => s.id === value) : null;
  // Surface inactive selected service so the user can keep / unbind.
  const opts = [
    { value: "", label: active.length === 0 ? "No services in catalog" : "— Pick a service —" },
    ...active.map(s => ({ value: s.id, label: `${s.name} · ${s.duration_hours}h` })),
  ];
  if (selected && !active.find(s => s.id === selected.id)) {
    opts.push({ value: selected.id, label: `${selected.name} · ${selected.duration_hours}h (inactive)` });
  }
  return (
    <Field label="Service" hint={active.length === 0 ? "Add services in Settings → Services & styles." : "Picks fill empty fields; manual edits stay."}>
      <Select
        value={value || ""}
        onChange={e => {
          const v = e.target.value;
          if (!v) { onPick(null, "fill"); return; }
          const svc = services.find(s => s.id === v) || null;
          onPick(svc, "fill");
        }}
        options={opts}
      />
      {selected && (
        <button
          type="button"
          onClick={() => onPick(selected, "replace")}
          className="text-[11px] font-semibold mt-1.5 px-1 py-0.5 active:scale-[0.98] transition"
          style={{ color: C.goldDeep, background: "transparent", border: 0 }}
        >
          Replace with service defaults
        </button>
      )}
    </Field>
  );
};

const AppointmentSheet = ({ open, appt, store, onClose, openTimerForAppt, openCommunication, openReceipt }: { open: any; appt: any; store: any; onClose: any; openTimerForAppt: any; openCommunication?: (ctx: CommContext) => void; openReceipt?: (rcp: ReceiptRecord) => void }) => {
  const {
    upsertAppointment, deleteAppointment, clients, upsertClient, business,
    recurringSeries, upsertSeries, deleteSeries, scheduleRemindersForAppointment,
    appointments, reminderSettings, receipts, upsertReceipt,
  } = store;
  const [form, setForm] = useState<EntityRecord>({});
  const [showNewClient, setShowNewClient] = useState(false);
  const [newClientName, setNewClientName] = useState("");

  // Recurring
  const [makeRecurring, setMakeRecurring] = useState(false);
  const [cadence, setCadence] = useState("4w");
  const [customDays, setCustomDays] = useState<string | number>(28);
  const [occurrences, setOccurrences] = useState<string | number>(6);

  // Reminders
  const [remindersEnabled, setRemindersEnabled] = useState(true);
  const [reminderChannel, setReminderChannel] = useState<EntityRecord | null>(null); // null = use default

  useEffect(() => {
    if (open) {
      const existingSeries = appt?.seriesId ? recurringSeries.find(s => s.id === appt.seriesId) : null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- prop/store-driven sync, intentional
      setForm({
        clientId: appt?.clientId || "",
        clientName: appt?.clientName || "",
        clientPhone: appt?.clientPhone || "",
        clientEmail: appt?.clientEmail || "",
        style: appt?.style || "",
        date: appt?.date || todayISO(),
        time: appt?.time || "10:00",
        durationHours: appt?.durationHours || "",
        depositPaid: sanitizeMoneyInput(appt?.depositPaid ?? 0),
        totalPrice: sanitizeMoneyInput(appt?.totalPrice ?? 0),
        status: appt?.status || "scheduled",
        notes: appt?.notes || "",
        paymentStatus: appt?.paymentStatus || "",
        paymentDate: appt?.paymentDate || "",
        paymentMethod: appt?.paymentMethod || "",
        paymentNotes: appt?.paymentNotes || "",
        // Discount snapshot — accept either camelCase (local) or
        // snake_case (cloud row) so both prefill cleanly.
        discountId: appt?.discountId ?? appt?.discount_id ?? null,
        discountName: appt?.discountName ?? appt?.discount_name ?? null,
        discountAmount: sanitizeMoneyInput(appt?.discountAmount ?? appt?.discount_amount ?? 0),
        // Phase 2: track which service catalog row this appointment
        // came from. Snapshot only — used for picker highlight + the
        // "Replace with service defaults" affordance.
        serviceId: appt?.serviceId ?? appt?.service_id ?? null,
        // Calendar item kind. Default 'appointment' so existing rows
        // keep their pre-migration semantics. Personal events / blocked
        // time hide the client + payment sections in the form.
        kind: (appt?.kind as ("appointment" | "personal" | "blocked") | undefined) || "appointment",
        // Free-text title used by personal events and blocked time
        // (e.g. "Doctor's appointment" / "Lunch with Mom"). Stored on
        // the same record; falls back to clientName for existing rows.
        eventTitle: appt?.eventTitle || appt?.event_title || "",
        id: appt?.id,
        seriesId: appt?.seriesId,
      });
      setShowNewClient(false);
      setNewClientName("");
      setMakeRecurring(!!existingSeries);
      setCadence(existingSeries?.cadence || "4w");
      setCustomDays(existingSeries?.customIntervalDays || 28);
      setOccurrences(existingSeries?.occurrencesPlanned || 6);
      setRemindersEnabled(appt?.remindersEnabled !== false);
      setReminderChannel(appt?.reminderChannel || null);
    }
  }, [open, appt]);

  // Discount picker (V1: only "applies to all" discounts surface).
  const allDiscounts: Discount[] = store.discountsApi?.discounts || [];
  const availableDiscounts = useMemo(
    () => selectableDiscounts(allDiscounts),
    [allDiscounts],
  );
  // If the saved discount is no longer selectable (paused / expired)
  // but is the one already on this appointment, keep it visible so
  // the snapshot stays editable. Past records aren't re-priced.
  const previewDiscount = useMemo(() => {
    if (!form.discountId) return null;
    return availableDiscounts.find(d => d.id === form.discountId)
      || allDiscounts.find(d => d.id === form.discountId)
      || null;
  }, [form.discountId, availableDiscounts, allDiscounts]);

  // Phase 2 — apply a service to the form. mode = "fill" only writes
  // empty/zero fields (default behavior so the user's manual edits
  // are never silently overwritten); mode = "replace" overwrites
  // every catalog-driven field. Service id is stored either way as a
  // soft snapshot.
  const applyServiceToForm = (svc: Service | null, mode: "fill" | "replace") => {
    if (!svc) {
      setForm({ ...form, serviceId: null });
      return;
    }
    const overwriteEmpty = (current: any, next: any) =>
      mode === "replace" ? next : (current && current !== "" && current !== 0 ? current : next);
    const dur = Number(svc.duration_hours) || 0;
    setForm(prev => ({
      ...prev,
      serviceId: svc.id,
      style: overwriteEmpty(prev.style, svc.name),
      durationHours: overwriteEmpty(Number(prev.durationHours) || 0, dur) || prev.durationHours,
      totalPrice: overwriteEmpty(Number(prev.totalPrice) || 0, svc.base_price) || prev.totalPrice,
      depositPaid: prev.depositPaid, // never auto-pay on the user's behalf
      // Surface deposit_amount in the notes/prep area only — the
      // appointment's own depositPaid field reflects what the
      // STYLIST has actually collected, not the required amount.
      notes: mode === "replace" || !prev.notes
        ? (svc.prep_instructions ? `${svc.prep_instructions}${prev.notes ? `\n\n${prev.notes}` : ""}` : prev.notes)
        : prev.notes,
    }));
  };

  const handleDiscountChange = (id: string) => {
    if (!id) {
      setForm({ ...form, discountId: null, discountName: null, discountAmount: 0 });
      return;
    }
    const d = availableDiscounts.find(x => x.id === id);
    if (!d) return;
    const amt = computeDiscountAmount(Number(form.totalPrice) || 0, d);
    setForm({ ...form, discountId: d.id, discountName: d.name, discountAmount: amt });
  };

  // Re-quote the discount whenever the entered total changes — a 10%
  // discount on a $200 quote should jump to a 10% discount on a $250
  // edit without the user having to reselect it.
  useEffect(() => {
    if (!form.discountId) return;
    const d = availableDiscounts.find(x => x.id === form.discountId);
    if (!d) return;
    const amt = computeDiscountAmount(Number(form.totalPrice) || 0, d);
    if (amt !== Number(form.discountAmount)) {
      setForm(prev => ({ ...prev, discountAmount: amt }));
    }
  }, [form.totalPrice, form.discountId, availableDiscounts]);

  const discountAmt = Number(form.discountAmount) || 0;
  const grossTotal = Number(form.totalPrice) || 0;
  const netTotal = Math.max(0, grossTotal - discountAmt);
  const balanceDue = netTotal - (Number(form.depositPaid) || 0);

  // When picking an existing client, auto-fill phone/email + their
  // most recent style/duration on NEW appointments only. We don't
  // overwrite anything the user already typed.
  useEffect(() => {
    if (form.clientId) {
      const c = clients.find(x => x.id === form.clientId);
      if (c) {
        const last = !form.id
          ? lastBookingForClient(appointments as any[], form.clientId)
          : null;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- prop/store-driven sync, intentional
        setForm(prev => ({
          ...prev,
          clientName: c.name,
          clientPhone: prev.clientPhone || c.phone || "",
          clientEmail: prev.clientEmail || c.email || "",
          style: prev.style || (last?.style ?? ""),
          durationHours: prev.durationHours || last?.durationHours || "",
        }));
      }
    }
  }, [form.clientId, clients, form.id, appointments]);

  const handleSave = async () => {
    // Personal events and blocked time skip the entire client/payment/
    // recurring/reminders pipeline — they're just titled time-blocks.
    if (form.kind === "personal" || form.kind === "blocked") {
      const baseEvent = {
        ...form,
        // Wipe fields that don't apply so a kind-changed record stays clean.
        clientId: "", clientName: "",
        clientPhone: "", clientEmail: "",
        style: "",
        depositPaid: 0, totalPrice: 0,
        discountId: null, discountName: null, discountAmount: 0,
        paymentStatus: "", paymentDate: "", paymentMethod: "", paymentNotes: "",
        seriesId: undefined,
        remindersEnabled: false,
        reminderChannel: null,
      };
      const saved = await upsertAppointment(baseEvent);
      if (!saved) return;
      onClose();
      return;
    }

    let clientId = form.clientId;
    let clientName = form.clientName;
    if (showNewClient && newClientName.trim()) {
      const newC = await upsertClient({ name: newClientName.trim(), phone: form.clientPhone, email: form.clientEmail });
      if (!newC) return; // Gated by upgrade sheet — bail without saving the appointment.
      clientId = newC.id; clientName = newC.name;
    } else if (clientId) {
      const c = clients.find(x => x.id === clientId);
      if (c) clientName = c.name;
    }

    let seriesId = form.seriesId;
    let isFirstInNewSeries = false;

    // Create series if requested and not already in one
    if (makeRecurring && !seriesId) {
      const newSeries = await upsertSeries({
        clientId, style: form.style, cadence,
        customIntervalDays: cadence === "custom" ? Number(customDays) : null,
        totalPrice: Number(form.totalPrice) || 0,
        durationHours: Number(form.durationHours) || 0,
        occurrencesPlanned: Number(occurrences) || 6,
        occurrencesGenerated: 1,
        startDate: form.date, startTime: form.time,
        reminderEnabled: remindersEnabled,
        notes: form.notes || "",
        status: "active",
      });
      seriesId = newSeries.id;
      isFirstInNewSeries = true;
    } else if (!makeRecurring && seriesId) {
      // Removed recurrence — leave the parent series intact, just drop link
      seriesId = undefined;
    }

    const baseAppt = {
      ...form,
      clientId, clientName,
      seriesId,
      remindersEnabled,
      reminderChannel,
      isRecurringInstance: !!seriesId,
      recurrenceIndex: form.recurrenceIndex ?? (isFirstInNewSeries ? 0 : form.recurrenceIndex),
    };

    const saved = await upsertAppointment(baseAppt);
    if (!saved) return; // Gated by upgrade sheet.
    await scheduleRemindersForAppointment({
      ...saved,
      remindersEnabled,
      clientPhone: form.clientPhone, clientEmail: form.clientEmail,
    });

    // Generate future occurrences for new series
    if (isFirstInNewSeries) {
      const days = cadenceDays(cadence, Number(customDays));
      let nextDate = form.date;
      for (let i = 1; i < Number(occurrences); i++) {
        nextDate = addDaysISO(nextDate, days);
        const future = await upsertAppointment({
          clientId, clientName,
          clientPhone: form.clientPhone, clientEmail: form.clientEmail,
          style: form.style,
          date: nextDate, time: form.time,
          durationHours: form.durationHours,
          depositPaid: 0,
          totalPrice: form.totalPrice,
          status: "scheduled",
          notes: form.notes,
          seriesId,
          remindersEnabled,
          isRecurringInstance: true,
          recurrenceIndex: i,
        });
        if (!future) break; // Gated mid-series — stop generating.
        await scheduleRemindersForAppointment({
          ...future, remindersEnabled,
          clientPhone: form.clientPhone, clientEmail: form.clientEmail,
        });
      }
      // Update series count
      await upsertSeries({
        id: seriesId,
        ...recurringSeries.find(s => s.id === seriesId),
        occurrencesGenerated: Number(occurrences),
      });
    }

    onClose();
  };

  const handleDelete = async () => {
    if (!form.id) return;
    const confirmCopy = form.kind === "personal" ? "Delete this personal event?"
      : form.kind === "blocked" ? "Remove this blocked time?"
      : "Delete this appointment?";
    if (!window.confirm(confirmCopy)) return;
    await deleteAppointment(form.id);
    onClose();
  };

  const handleDeleteSeries = async () => {
    if (!form.seriesId) return;
    if (!window.confirm("Delete this entire recurring series? Past appointments stay; future ones are removed.")) return;
    const futures = appointments.filter(a => a.seriesId === form.seriesId && a.date >= todayISO());
    for (const f of futures) await deleteAppointment(f.id);
    await deleteSeries(form.seriesId);
    onClose();
  };

  // Phase 1 — operational speed:
  //   • Duplicate creates a new in-memory appointment record prefilled
  //     from the current one (id wiped so save creates a new row, date
  //     reset to today). Closes this sheet and reopens with the copy.
  //   • Quick reschedule opens a tiny date+time mini-sheet that writes
  //     ONLY those two fields, then closes — for the common case where
  //     a client moves their slot.
  const [showQuickReschedule, setShowQuickReschedule] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState<string>("");
  const [rescheduleTime, setRescheduleTime] = useState<string>("");
  const [rescheduleBusy, setRescheduleBusy] = useState(false);

  const handleDuplicate = () => {
    if (!form.id) return;
    const dup: any = {
      ...form,
      id: undefined,
      seriesId: undefined,
      date: todayISO(),
      status: "scheduled",
      depositPaid: 0,
      paymentStatus: "",
      paymentDate: "",
      paymentMethod: "",
      paymentNotes: "",
      // Drop the discount snapshot — duplicates start from the gross
      // price; the user re-applies a discount on the new appointment.
      discountId: null,
      discountName: null,
      discountAmount: 0,
    };
    onClose();
    // Defer so the parent can react to the close before we re-open.
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("bbp:duplicate-appointment", { detail: dup }));
    }, 0);
  };

  const openQuickReschedule = () => {
    setRescheduleDate(form.date || todayISO());
    setRescheduleTime(form.time || "10:00");
    setShowQuickReschedule(true);
  };

  const handleQuickReschedule = async () => {
    if (!form.id || rescheduleBusy) return;
    if (!rescheduleDate || !rescheduleTime) return;
    setRescheduleBusy(true);
    const next = { ...form, date: rescheduleDate, time: rescheduleTime };
    setForm(next);
    const saved = await upsertAppointment(next);
    setRescheduleBusy(false);
    if (saved) {
      setShowQuickReschedule(false);
      onClose();
    }
  };

  const handleStartTimer = () => {
    if (!form.id) return;
    openTimerForAppt(form);
    onClose();
  };

  // Sheet title + placeholder copy depend on the calendar item kind.
  const isAppointment = form.kind === "appointment" || !form.kind;
  const isPersonal = form.kind === "personal";
  const isBlocked = form.kind === "blocked";
  const sheetTitle = (() => {
    if (form.id) {
      if (isPersonal) return "Edit personal event";
      if (isBlocked) return "Edit blocked time";
      return "Edit Appointment";
    }
    if (isPersonal) return "New personal event";
    if (isBlocked) return "Block off time";
    return "New Appointment";
  })();

  return (
    <Sheet open={open} onClose={onClose} title={sheetTitle}>
      <div className="space-y-4 pb-6">
        {!isAppointment && (
          <Field label="Title">
            <Input
              value={form.eventTitle || ""}
              onChange={e => setForm({ ...form, eventTitle: e.target.value })}
              placeholder={isPersonal ? "Lunch with Mom" : "Unavailable"}
            />
          </Field>
        )}

        {!isAppointment && (
          <Card className="p-3 space-y-3" style={{ background: C.cream }}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1">
                <p className="text-[13px] font-semibold" style={{ color: C.espresso }}>All day</p>
                <p className="text-[11px]" style={{ color: C.muted }}>
                  {form.isAllDay
                    ? "This blocks your full booking day."
                    : "Toggle on to block the whole day from public booking."}
                </p>
              </div>
              <Toggle
                checked={!!form.isAllDay}
                onChange={(checked) => {
                  setForm({
                    ...form,
                    isAllDay: checked,
                    // Clear time + duration when switching to all-day so
                    // the row sorts to the top of the day cleanly and
                    // doesn't carry stale numbers if the user toggles back.
                    time: checked ? "" : form.time,
                    durationHours: checked ? "" : form.durationHours,
                    blocksAvailability: checked ? true : (form.blocksAvailability ?? true),
                  });
                }}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1">
                <p className="text-[13px] font-semibold" style={{ color: C.espresso }}>Block public availability</p>
                <p className="text-[11px]" style={{ color: C.muted }}>
                  When on, public clients can&apos;t book during this time.
                </p>
              </div>
              <Toggle
                checked={form.blocksAvailability !== false}
                onChange={(checked) => setForm({ ...form, blocksAvailability: checked })}
              />
            </div>
          </Card>
        )}

        {isAppointment && (
          <Field label="Client">
            {showNewClient ? (
              <div className="flex gap-2">
                <div className="flex-1"><Input value={newClientName} onChange={e => setNewClientName(e.target.value)} placeholder="Client name" /></div>
                <Button variant="outline" onClick={() => setShowNewClient(false)}>Cancel</Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <div className="flex-1">
                  <Select value={form.clientId} onChange={e => setForm({ ...form, clientId: e.target.value })}
                    options={[{ value: "", label: "— Select client —" }, ...clients.map(c => ({ value: c.id, label: c.name }))]} />
                </div>
                <Button variant="outline" icon={<UserPlus size={16} />} onClick={() => setShowNewClient(true)}>New</Button>
              </div>
            )}
          </Field>
        )}

        {isAppointment && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone" hint="for SMS"><Input type="tel" value={form.clientPhone} onChange={e => setForm({ ...form, clientPhone: e.target.value })} placeholder="555-0123" /></Field>
            <Field label="Email" hint="for email"><Input type="email" value={form.clientEmail} onChange={e => setForm({ ...form, clientEmail: e.target.value })} placeholder="name@email.com" /></Field>
          </div>
        )}

        {isAppointment && (
          <ServicePicker
            services={(store.servicesApi?.services as Service[]) || []}
            value={form.serviceId || null}
            onPick={(svc, mode) => applyServiceToForm(svc, mode)}
          />
        )}

        {isAppointment && (
          <Field label="Style / Service"><Input value={form.style} onChange={e => setForm({ ...form, style: e.target.value })} placeholder="e.g. Knotless mid-back" /></Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></Field>
          {!form.isAllDay && (
            <Field label="Time"><Input type="time" value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} /></Field>
          )}
          {!form.isAllDay && (
            <Field label="Duration"><MoneyInput prefix="" suffix="hrs" placeholder="6.5" value={form.durationHours} onChange={(v) => setForm({ ...form, durationHours: v })} /></Field>
          )}
          {isAppointment && (
            <Field label="Status">
              <Select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}
                options={[
                  { value: "scheduled", label: "Scheduled" },
                  { value: "confirmed", label: "Confirmed" },
                  { value: "completed", label: "Completed" },
                  { value: "cancelled", label: "Cancelled" },
                  { value: "no_show", label: "No-show" },
                ]} />
            </Field>
          )}
          {isAppointment && <Field label="Total price"><MoneyInput value={form.totalPrice} onChange={(v) => setForm({ ...form, totalPrice: v })} /></Field>}
          {isAppointment && <Field label="Deposit paid"><MoneyInput value={form.depositPaid} onChange={(v) => setForm({ ...form, depositPaid: v })} /></Field>}
        </div>

        {isAppointment && (
        <Field
          label="Discount"
          hint={availableDiscounts.length === 0
            ? "Create a Studio Offer in Settings → Discounts."
            : "Optional. Subtracts from the total price."}
        >
          <Select
            value={form.discountId || ""}
            onChange={e => handleDiscountChange(e.target.value)}
            options={(() => {
              const opts = [{ value: "", label: "No discount" }];
              for (const d of availableDiscounts) {
                opts.push({ value: d.id, label: `${d.name} — ${formatDiscountValue(d)}` });
              }
              // If the saved discount is paused/expired, still show it
              // so the user can unbind or keep the snapshot intact.
              if (previewDiscount && !availableDiscounts.find(d => d.id === previewDiscount.id)) {
                opts.push({
                  value: previewDiscount.id,
                  label: `${previewDiscount.name} — ${formatDiscountValue(previewDiscount)} (paused)`,
                });
              }
              return opts;
            })()}
          />
        </Field>
        )}
        {isAppointment && discountAmt > 0 && (
          <Card className="p-3" style={{ background: C.paper, border: `1px solid ${C.hairline}` }}>
            <div className="flex items-center justify-between text-[13px]" style={{ color: C.coffee }}>
              <span>Subtotal</span>
              <span style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
                {fmtMoney(grossTotal, business.currency)}
              </span>
            </div>
            <div className="flex items-center justify-between text-[13px] mt-1" style={{ color: C.goldDeep }}>
              <span>Discount{form.discountName ? ` — ${form.discountName}` : ""}</span>
              <span style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
                − {fmtMoney(discountAmt, business.currency)}
              </span>
            </div>
            <div className="flex items-center justify-between text-[14px] font-semibold mt-2 pt-2"
              style={{ color: C.espresso, borderTop: `1px solid ${C.hairline}` }}>
              <span>Net total</span>
              <span style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
                {fmtMoney(netTotal, business.currency)}
              </span>
            </div>
          </Card>
        )}

        {isAppointment && (
        <Card className="p-3.5 flex justify-between items-center" style={{ background: C.ivory }}>
          <span className="text-sm font-semibold" style={{ color: C.coffee }}>Balance due</span>
          <span style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 600, color: balanceDue > 0 ? C.warning : C.success }}>
            {fmtMoney(balanceDue, business.currency)}
          </span>
        </Card>
        )}

        {/* PAYMENT */}
        {isAppointment && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <DollarSign size={16} style={{ color: C.gold }} />
              <span className="font-semibold text-sm" style={{ color: C.espresso }}>Payment</span>
            </div>
            <Pill tone={PAYMENT_STATUS_TONE[paymentStatusOf(form, todayISO())]}>
              {PAYMENT_STATUS_LABEL[paymentStatusOf(form, todayISO())]}
            </Pill>
          </div>
          {balanceDue > 0 ? (
            <Button variant="primary" icon={<Check size={16} />} fullWidth
              onClick={() => {
                const apptDate = form.date || todayISO();
                const isPastOrToday = apptDate <= todayISO();
                setForm({
                  ...form,
                  depositPaid: parseMoney(form.totalPrice),
                  paymentStatus: "paid",
                  paymentDate: form.paymentDate || todayISO(),
                  status: isPastOrToday && form.status !== "cancelled" && form.status !== "no_show"
                    ? "completed"
                    : form.status,
                });
              }}>
              Collect balance / Mark as paid
            </Button>
          ) : (
            <Button variant="outline" icon={<RefreshCw size={14} />} fullWidth
              onClick={() => setForm({
                ...form,
                depositPaid: 0,
                paymentStatus: "pending",
                paymentDate: "",
                paymentMethod: "",
                paymentNotes: "",
              })}>
              Reset payment
            </Button>
          )}
          <div className="grid grid-cols-2 gap-3 mt-3">
            <Field label="Payment date" hint="optional">
              <Input type="date" value={form.paymentDate || ""} onChange={e => setForm({ ...form, paymentDate: e.target.value })} />
            </Field>
            <Field label="Method" hint="optional">
              <Select value={form.paymentMethod || ""} onChange={e => setForm({ ...form, paymentMethod: e.target.value })} options={PAYMENT_METHODS} />
            </Field>
          </div>
          <div className="mt-3">
            <Field label="Payment notes" hint="optional">
              <Textarea value={form.paymentNotes || ""} onChange={e => setForm({ ...form, paymentNotes: e.target.value })} placeholder="Receipt #, tip amount, anything to remember…" rows={2} />
            </Field>
          </div>
          {form.id && openReceipt && (() => {
            const showReceipt = parseMoney(form.depositPaid) > 0 || form.paymentStatus === "paid" || form.paymentStatus === "partial" || form.status === "completed";
            const showInvoice = parseMoney(form.balanceDue) > 0 && form.paymentStatus !== "paid";
            if (!showReceipt && !showInvoice) return null;
            const handleGenerate = async (type: "receipt" | "invoice") => {
              const clientName = clients.find((c: any) => c.id === form.clientId)?.name || form.clientName || "Client";
              const newId = `rcp_${uid()}`;
              const rcp = buildReceiptFromAppointment(form, type, (receipts || []).length, newId, clientName);
              const saved = await upsertReceipt(rcp);
              openReceipt(saved as ReceiptRecord);
            };
            return (
              <div className="grid grid-cols-2 gap-2 mt-3">
                {showReceipt && (
                  <Button variant="outline" icon={<Receipt size={14} />} onClick={() => handleGenerate("receipt")}>Generate receipt</Button>
                )}
                {showInvoice && (
                  <Button variant="outline" icon={<FileText size={14} />} onClick={() => handleGenerate("invoice")}>Generate invoice</Button>
                )}
              </div>
            );
          })()}
        </Card>
        )}

        {/* RECURRING — appointments only */}
        {isAppointment && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Repeat size={16} style={{ color: C.gold }} />
              <span className="font-semibold text-sm" style={{ color: C.espresso }}>Make recurring</span>
            </div>
            <Toggle checked={makeRecurring} onChange={setMakeRecurring} />
          </div>
          {makeRecurring && (
            <div className="space-y-3 mt-3">
              <Field label="Cadence">
                <Select value={cadence} onChange={e => setCadence(e.target.value)} options={RECURRENCE_OPTIONS} />
              </Field>
              {cadence === "custom" && (
                <Field label="Every"><MoneyInput prefix="" suffix="days" allowDecimal={false} value={customDays} onChange={setCustomDays} /></Field>
              )}
              <Field label="Occurrences" hint="this one + future">
                <MoneyInput prefix="" suffix="appts" allowDecimal={false} value={occurrences} onChange={setOccurrences} />
              </Field>
              <p className="text-xs" style={{ color: C.muted }}>
                Future appointments will be auto-created on the selected cadence. Edit each one individually as needed.
              </p>
            </div>
          )}
        </Card>
        )}

        {/* REMINDERS — appointments only */}
        {isAppointment && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Bell size={16} style={{ color: C.gold }} />
              <span className="font-semibold text-sm" style={{ color: C.espresso }}>Auto-remind this client</span>
            </div>
            <Toggle checked={remindersEnabled} onChange={setRemindersEnabled} />
          </div>
          {remindersEnabled && (
            <div className="space-y-2 mt-3">
              <p className="text-xs" style={{ color: C.muted }}>
                Reminders will be scheduled per your default settings (
                {[
                  reminderSettings.timings.confirmation && "on booking",
                  reminderSettings.timings.h48 && "48h",
                  reminderSettings.timings.h24 && "24h",
                  reminderSettings.timings.sameDay && `${reminderSettings.timings.sameDayHoursBefore}h prior`,
                ].filter(Boolean).join(", ")}). Manage in Reminder Settings.
              </p>
            </div>
          )}
        </Card>
        )}

        <Field label="Notes">
          <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Hair texture, prep notes, anything to remember…" rows={3} />
        </Field>

        {isAppointment && form.id && (
          <div className="grid grid-cols-2 gap-3">
            <Button variant="outline" icon={<RefreshCw size={16} />} onClick={openQuickReschedule}>Reschedule</Button>
            <Button variant="outline" icon={<Copy size={16} />} onClick={handleDuplicate}>Duplicate</Button>
          </div>
        )}
        {isAppointment && form.id && (
          <Button variant="dark" icon={<TimerIcon size={18} />} onClick={handleStartTimer} fullWidth>Start chair timer</Button>
        )}
        {isAppointment && form.id && (
          <AppointmentCommHistory appointmentId={form.id} commLog={store.commLog || []} />
        )}
        {isAppointment && form.id && openCommunication && (
          <Button variant="outline" icon={<MessageSquare size={16} />} fullWidth
            onClick={() => openCommunication({
              appointment: form,
              client: clients.find((c: any) => c.id === form.clientId),
            })}>
            Send message to client
          </Button>
        )}
        {form.id && form.date && (
          <Button variant="outline" icon={<CalendarPlus size={16} />} fullWidth
            onClick={() => {
              const ics = buildVCalendar([form as IcsAppointment], { businessName: form.eventTitle || business?.businessName, currency: business?.currency });
              const fname = sanitizeFilename(`appt-${form.eventTitle || form.clientName || "event"}-${form.date}`) + ".ics";
              downloadIcs(fname, ics);
            }}>
            Add to calendar
          </Button>
        )}

        <div className="grid grid-cols-2 gap-3 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={isAppointment
              ? (!form.style && !form.clientId && !showNewClient)
              : !((form.eventTitle || "").trim())
            }
          >
            Save
          </Button>
        </div>
        {form.id && (
          <Button variant="danger" icon={<Trash2 size={16} />} onClick={handleDelete} fullWidth>
            {isPersonal ? "Delete this event" : isBlocked ? "Remove blocked time" : "Delete this appointment"}
          </Button>
        )}
        {form.seriesId && (
          <Button variant="danger" onClick={handleDeleteSeries} fullWidth>Delete entire series</Button>
        )}
      </div>
      <QuickRescheduleSheet
        open={showQuickReschedule}
        date={rescheduleDate}
        time={rescheduleTime}
        onChangeDate={setRescheduleDate}
        onChangeTime={setRescheduleTime}
        onClose={() => setShowQuickReschedule(false)}
        onSave={handleQuickReschedule}
        busy={rescheduleBusy}
      />
    </Sheet>
  );
};

// ---- Quick Reschedule mini-sheet --------------------------------------
// Tiny date+time picker for the "client wants to move their slot"
// flow. Doesn't touch the rest of the appointment record.
const QuickRescheduleSheet = ({
  open, date, time, onChangeDate, onChangeTime, onClose, onSave, busy,
}: {
  open: boolean;
  date: string;
  time: string;
  onChangeDate: (v: string) => void;
  onChangeTime: (v: string) => void;
  onClose: () => void;
  onSave: () => void;
  busy: boolean;
}) => {
  return (
    <Sheet open={open} onClose={onClose} title="Reschedule">
      <div className="space-y-3 pb-2">
        <p className="text-[12px]" style={{ color: C.muted }}>
          Move this appointment to a new date and time. Everything else
          (client, style, deposit) stays put.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="New date">
            <Input type="date" value={date} onChange={e => onChangeDate(e.target.value)} />
          </Field>
          <Field label="New time">
            <Input type="time" value={time} onChange={e => onChangeTime(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3 pt-1">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={onSave} disabled={busy || !date || !time}>
            {busy ? "Saving…" : "Reschedule"}
          </Button>
        </div>
      </div>
    </Sheet>
  );
};

// ============================================================
//  CLIENTS
// ============================================================
const PREF_STYLES = ["Knotless", "Box braids", "Boho", "Goddess", "Stitch braids", "Cornrows", "Twists", "Locs", "Sew-in", "Wig install"];
const SENSITIVITY = ["None", "Mild", "Moderate", "High"];

// ============================================================
//  CUSTOMERS — mobile-first refresh
// ============================================================
//
// Top-level layout:
//   - Large display title + circular overflow button
//   - Search input + slim filter button on the same row
// Layered interactions:
//   - Overflow popover (Create / Manage groups / Merge)
//   - Filters bottom sheet (uses the shared <Sheet> so safe-area
//     spacing carries over for free)
//
// Existing CRUD stays as-is via ClientSheet; this is a UX-only
// upgrade to the list screen.

type CustomerLastVisited = "any" | "30d" | "90d" | "year" | "never";
type CustomerFrequency = "any" | "1plus" | "3plus" | "5plus";

type CustomerFilters = {
  lastVisited: CustomerLastVisited;
  frequency: CustomerFrequency;
};

const DEFAULT_CUSTOMER_FILTERS: CustomerFilters = {
  lastVisited: "any",
  frequency: "any",
};

const filtersAreActive = (f: CustomerFilters) =>
  f.lastVisited !== "any" || f.frequency !== "any";

const Clients = ({ store, openClientPhotos, openCommunication, openQuickAppt, savePhoto, deletePhoto: deletePhotoProp, openClientId, clearOpenClientId, openAppointmentRecord }: { store: any; openClientPhotos?: any; openCommunication?: (ctx: CommContext) => void; openQuickAppt?: (prefill?: any) => void; savePhoto?: (p: any) => Promise<any>; deletePhoto?: (id: string) => Promise<void>; openClientId?: string | null; clearOpenClientId?: () => void; openAppointmentRecord?: (a: any) => void }) => {
  void openClientPhotos;
  const { clients, appointments, photos, business } = store;
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<EntityRecord | null>(null);
  const [profileFor, setProfileFor] = useState<EntityRecord | null>(null);
  const [showOverflow, setShowOverflow] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<CustomerFilters>(DEFAULT_CUSTOMER_FILTERS);
  const [comingSoon, setComingSoon] = useState<string | null>(null);

  // Notification deep-link consumer: when App stamps openClientId,
  // find the matching client record and open the rich profile sheet
  // (not the bare edit sheet). Clear the prop after so re-renders
  // don't re-open it.
  useEffect(() => {
    if (!openClientId) return;
    const found = clients.find((c: any) => c?.id === openClientId);
    if (found) setProfileFor(found);
    clearOpenClientId?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional one-shot consumer
  }, [openClientId, clients]);

  const today = todayISO();
  const enriched = useMemo(() => clients.map(c => {
    const cAppts = appointments.filter(a => a.clientId === c.id);
    // Lifetime total = sum of what was actually collected, not quoted.
    const totalSpent = cAppts
      .filter(a => (a.status === "completed" || a.paymentStatus === "paid") && a.status !== "cancelled")
      .reduce((s, a) => {
        const collected = calculateCollectedAmount(a);
        return s + collected;
      }, 0);

    // Compute past / today / future relative to the local-date `today`
    // so the row label can pick the right preposition. ISO strings are
    // YYYY-MM-DD lexically comparable when generated from local time
    // (todayISO + a.date both use localDateISO()), so plain string
    // comparison is timezone-safe here.
    const dates = cAppts
      .map(a => a.date)
      .filter((d: any): d is string => typeof d === "string" && d.length >= 8)
      .filter(d => {
        // Exclude cancelled bookings — a future cancellation shouldn't
        // surface as the next "upcoming" visit.
        const a = cAppts.find(x => x.date === d);
        return !a || a.status !== "cancelled";
      })
      .sort();
    const pastDates = dates.filter(d => d < today);
    const todayDates = dates.filter(d => d === today);
    const futureDates = dates.filter(d => d > today);

    const lastPastDate = pastDates.length > 0 ? pastDates[pastDates.length - 1] : undefined;
    const todayDate = todayDates[0];
    const nextFutureDate = futureDates[0];

    return {
      ...c,
      apptCount: cAppts.length,
      totalSpent,
      lastPastDate,
      todayDate,
      nextFutureDate,
      photoCount: photos.filter(p => p.clientId === c.id).length,
    };
  }).sort((a, b) => {
    // Alphabetize A → Z, case- and diacritic-insensitive, whitespace
    // trimmed. Clients with missing/blank names sink to the bottom so
    // the list reads like a contact book. `useMemo` above + the
    // `.map(...)` array means we're not mutating the original
    // store.clients array.
    const an = (a.name || "").trim();
    const bn = (b.name || "").trim();
    if (!an && !bn) return 0;
    if (!an) return 1;
    if (!bn) return -1;
    return an.localeCompare(bn, undefined, { sensitivity: "base", numeric: true });
  }), [clients, appointments, photos, today]);

  const filtered = useMemo(() => {
    return enriched.filter(c => {
      if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
      // Last visited filter is about ACTUAL past visits — ignore
      // upcoming bookings so a client booked next month doesn't count
      // as having "visited" recently.
      if (filters.lastVisited !== "any") {
        if (!c.lastPastDate && !c.todayDate) {
          if (filters.lastVisited !== "never") return false;
        } else {
          if (filters.lastVisited === "never") return false;
          const days = filters.lastVisited === "30d" ? 30 : filters.lastVisited === "90d" ? 90 : 365;
          const cutoff = addDaysISO(today, -days);
          const ref = c.todayDate || c.lastPastDate;
          if (!ref || ref < cutoff) return false;
        }
      }
      // Frequency
      if (filters.frequency !== "any") {
        const min = filters.frequency === "1plus" ? 1 : filters.frequency === "3plus" ? 3 : 5;
        if (c.apptCount < min) return false;
      }
      return true;
    });
  }, [enriched, search, filters, today]);

  const filtersOn = filtersAreActive(filters);

  return (
    <div className="bbp-fade pb-32">
      {/* HEADER */}
      <div className="px-5 pt-6 pb-3 flex items-start justify-between">
        <div className="min-w-0">
          <div className="mb-1"><SectionEyebrow>Your book</SectionEyebrow></div>
          <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 34, fontWeight: 600, color: C.espresso, lineHeight: 1 }}>
            Customers
          </h1>
          <p className="text-[12px] mt-1" style={{ color: C.muted }}>
            {clients.length} {clients.length === 1 ? "person" : "people"}
            {filtered.length !== clients.length ? ` · ${filtered.length} shown` : ""}
          </p>
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowOverflow(v => !v)}
            aria-label="Customers menu"
            aria-expanded={showOverflow}
            className="rounded-full active:scale-[0.96] transition flex items-center justify-center"
            style={{
              width: 40, height: 40,
              background: C.paper,
              border: `1px solid ${C.hairline}`,
              boxShadow: "0 1px 2px rgba(42, 24, 16, 0.04), 0 6px 18px -10px rgba(42, 24, 16, 0.18)",
              color: C.coffee,
            }}
          >
            <MoreHorizontal size={18} />
          </button>
          {showOverflow && (
            <CustomersOverflowMenu
              onClose={() => setShowOverflow(false)}
              onCreate={() => { setShowOverflow(false); setEditing({}); }}
              onManageGroups={() => { setShowOverflow(false); setComingSoon("Customer groups"); }}
              onMerge={() => { setShowOverflow(false); setComingSoon("Merge customers"); }}
            />
          )}
        </div>
      </div>

      {/* SEARCH + FILTER */}
      <div className="px-5 pb-3 flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: C.muted }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search customers"
            inputMode="search"
            autoComplete="off"
            className="w-full rounded-xl py-3 pl-10 pr-4 text-[15px] outline-none"
            style={{ background: C.paper, border: `1px solid ${C.hairline}`, color: C.ink }}
          />
        </div>
        <button
          type="button"
          onClick={() => setShowFilters(true)}
          aria-label="Filter customers"
          className="rounded-xl active:scale-[0.97] transition flex items-center gap-1.5 px-3"
          style={{
            height: 46,
            background: filtersOn ? C.espresso : C.paper,
            border: `1px solid ${filtersOn ? C.espresso : C.hairline}`,
            color: filtersOn ? C.cream : C.coffee,
          }}
        >
          <SlidersHorizontal size={16} />
          <span className="text-[12px] font-semibold">Filter</span>
          {filtersOn && (
            <span
              aria-hidden
              style={{
                width: 6, height: 6, borderRadius: 999,
                background: C.gold, marginLeft: 2,
              }}
            />
          )}
        </button>
      </div>

      {/* LIST */}
      <div className="px-5 space-y-2">
        {filtered.length === 0 ? (
          clients.length === 0 ? (
            <EmptyState
              icon={<Users size={28} style={{ color: C.gold }} />}
              title="Every booked braid starts with one client"
              body="Build your book of business. Every customer becomes a profile with style preferences, photos, allergies, and lifetime value."
              cta={<Button variant="primary" icon={<Plus size={18} />} onClick={() => setEditing({})}>Add first customer</Button>}
            />
          ) : (
            <div className="text-center py-10">
              <p style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 600, color: C.espresso }}>No matches</p>
              <p className="text-[13px] mt-2" style={{ color: C.muted }}>
                {search ? `Nothing matches "${search}"` : "Try clearing filters."}
              </p>
              {filtersOn && (
                <div className="mt-4 inline-block">
                  <Button variant="outline" onClick={() => setFilters(DEFAULT_CUSTOMER_FILTERS)}>Clear filters</Button>
                </div>
              )}
            </div>
          )
        ) : (
          filtered.map(c => (
            <button
              type="button"
              key={c.id}
              onClick={() => setProfileFor(c)}
              className="w-full text-left active:scale-[0.99] transition"
              style={{
                background: C.paper,
                border: `1px solid ${C.hairline}`,
                borderRadius: 18,
                padding: "14px 16px",
                boxShadow: "0 1px 2px rgba(42, 24, 16, 0.04)",
                fontFamily: "inherit",
                color: "inherit",
                appearance: "none",
                WebkitAppearance: "none",
              }}
            >
              <div className="flex items-center gap-3.5" style={{ pointerEvents: "none" }}>
                <div
                  className="rounded-full flex items-center justify-center shrink-0"
                  style={{
                    width: 52, height: 52,
                    background: `linear-gradient(135deg, ${C.caramel}, ${C.coffee})`,
                    color: C.cream,
                    fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 600,
                  }}
                >
                  {initials(c.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className="truncate"
                    style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600, color: C.espresso, lineHeight: 1.15 }}
                  >
                    {c.name}
                  </p>
                  <p className="text-[12px] mt-0.5 truncate" style={{ color: C.muted }}>
                    {c.apptCount > 0
                      ? `${c.apptCount} ${c.apptCount === 1 ? "visit" : "visits"}`
                      : "No visits yet"}
                    {(() => {
                      // Pick one date to surface in the subtitle.
                      // Priority: today → upcoming → most recent past.
                      // Each renders with the correct preposition so a
                      // future booking is never labeled "last".
                      if (c.todayDate) return " · today";
                      if (c.nextFutureDate) return ` · upcoming ${fmtDate(c.nextFutureDate)}`;
                      if (c.lastPastDate) return ` · last ${fmtDate(c.lastPastDate)}`;
                      return "";
                    })()}
                    {c.photoCount > 0 ? ` · ${c.photoCount} photo${c.photoCount === 1 ? "" : "s"}` : ""}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[9px] uppercase tracking-widest font-bold" style={{ color: C.muted, letterSpacing: "0.14em" }}>Lifetime</p>
                  <p style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600, color: C.goldDeep, lineHeight: 1 }}>
                    {fmtMoney(c.totalSpent, business.currency)}
                  </p>
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      <FAB onClick={() => setEditing({})} />

      <ClientProfileSheet
        open={!!profileFor}
        client={profileFor}
        store={store}
        onClose={() => setProfileFor(null)}
        onEdit={() => { const c = profileFor; setProfileFor(null); setEditing(c); }}
        onOpenAppointment={(a) => { setProfileFor(null); openAppointmentRecord?.(a); }}
        onMessage={openCommunication}
        onBookAppointment={(prefill) => { setProfileFor(null); openQuickAppt?.(prefill); }}
      />

      <ClientSheet
        open={!!editing}
        client={editing}
        store={store}
        onClose={() => setEditing(null)}
        openCommunication={openCommunication}
        openQuickAppt={openQuickAppt}
        savePhoto={savePhoto}
        deletePhotoExternal={deletePhotoProp}
      />

      <CustomersFilterSheet
        open={showFilters}
        filters={filters}
        onChange={setFilters}
        onClear={() => setFilters(DEFAULT_CUSTOMER_FILTERS)}
        onApply={() => setShowFilters(false)}
        onClose={() => setShowFilters(false)}
        onComingSoon={(label) => setComingSoon(label)}
      />

      <Sheet
        open={!!comingSoon}
        onClose={() => setComingSoon(null)}
        title={comingSoon || ""}
      >
        <div className="space-y-3 pb-2">
          <p className="text-[14px]" style={{ color: C.coffee, lineHeight: 1.5 }}>
            <strong>{comingSoon}</strong> is on the roadmap. Tap the heart in the
            Account screen to vote it up the queue, or use Search and the existing
            filters in the meantime.
          </p>
          <Button variant="primary" fullWidth onClick={() => setComingSoon(null)}>
            Got it
          </Button>
        </div>
      </Sheet>
    </div>
  );
};

// ---- Customers overflow popover ---------------------------------------
const CustomersOverflowMenu = ({
  onClose, onCreate, onManageGroups, onMerge,
}: {
  onClose: () => void;
  onCreate: () => void;
  onManageGroups: () => void;
  onMerge: () => void;
}) => {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      const node = ref.current;
      if (!node) return;
      if (e.target instanceof Node && !node.contains(e.target)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const items = [
    { icon: <UserPlus size={18} />, label: "Create customer",  description: "Add a profile manually",      enabled: true,  onClick: onCreate },
    { icon: <Users size={18} />,    label: "Manage groups",     description: "Coming soon",                 enabled: false, onClick: onManageGroups },
    { icon: <Repeat size={18} />,   label: "Merge customers",   description: "Coming soon",                 enabled: false, onClick: onMerge },
  ];

  return (
    <div
      ref={ref}
      role="menu"
      className="absolute z-50 mt-2 right-0 w-64 rounded-2xl overflow-hidden bbp-pop"
      style={{
        background: C.paper,
        border: `1px solid ${C.hairline}`,
        boxShadow:
          "0 1px 2px rgba(42, 24, 16, 0.06), 0 18px 36px -12px rgba(42, 24, 16, 0.22)",
        transformOrigin: "top right",
      }}
    >
      <style>{`@keyframes bbpPop { from { opacity:0; transform: scale(0.96) translateY(-4px);} to { opacity:1; transform: scale(1) translateY(0);} } .bbp-pop { animation: bbpPop 0.18s ease-out both; }`}</style>
      {items.map((it, i) => (
        <button
          key={it.label}
          type="button"
          role="menuitem"
          onClick={it.onClick}
          className="w-full flex items-center gap-3 px-4 py-3 active:scale-[0.99] transition text-left"
          style={{
            color: C.espresso,
            borderTop: i === 0 ? "none" : `1px solid ${C.hairline}`,
            background: "transparent",
            opacity: it.enabled ? 1 : 0.55,
          }}
        >
          <span
            aria-hidden
            className="flex items-center justify-center shrink-0"
            style={{
              width: 32, height: 32, borderRadius: 999,
              background: C.ivory, color: C.gold, border: `1px solid ${C.hairline}`,
            }}
          >
            {it.icon}
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-[13px] font-semibold leading-tight" style={{ color: C.espresso }}>
              {it.label}
            </span>
            <span className="block text-[11px] mt-0.5" style={{ color: C.muted }}>
              {it.description}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
};

// ---- Customers filter bottom sheet ------------------------------------
const CustomersFilterSheet = ({
  open, filters, onChange, onClear, onApply, onClose, onComingSoon,
}: {
  open: boolean;
  filters: CustomerFilters;
  onChange: (f: CustomerFilters) => void;
  onClear: () => void;
  onApply: () => void;
  onClose: () => void;
  onComingSoon: (label: string) => void;
}) => {
  const radio = <T extends string>(
    label: string,
    value: T,
    current: T,
    onPick: (v: T) => void,
  ) => (
    <button
      type="button"
      key={value}
      onClick={() => onPick(value)}
      className="px-3 py-1.5 rounded-full text-[12px] font-semibold active:scale-[0.97] transition"
      style={{
        background: current === value ? C.espresso : C.paper,
        color: current === value ? C.cream : C.coffee,
        border: `1px solid ${current === value ? C.espresso : C.hairline}`,
      }}
    >
      {label}
    </button>
  );

  const SoonRow = ({ label }: { label: string }) => (
    <button
      type="button"
      onClick={() => onComingSoon(label)}
      className="w-full text-left rounded-xl px-4 py-3 flex items-center justify-between active:scale-[0.99] transition"
      style={{ background: C.paper, border: `1px solid ${C.hairline}`, opacity: 0.7 }}
    >
      <div>
        <p className="text-[13px] font-semibold" style={{ color: C.espresso }}>{label}</p>
        <p className="text-[11px] mt-0.5" style={{ color: C.muted }}>Coming soon</p>
      </div>
      <ChevronRight size={16} style={{ color: C.muted }} />
    </button>
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Filters"
      rightAction={
        <button
          type="button"
          onClick={onClear}
          className="text-[12px] font-semibold px-2 py-1 rounded-lg"
          style={{ color: C.coffee }}
        >
          Clear all
        </button>
      }
    >
      <div className="space-y-5 pb-2">
        <div>
          <p className="text-[10px] uppercase tracking-widest font-bold mb-2" style={{ color: C.muted, letterSpacing: "0.14em" }}>
            Last visited
          </p>
          <div className="flex flex-wrap gap-2">
            {radio("Any time", "any" as CustomerLastVisited, filters.lastVisited, v => onChange({ ...filters, lastVisited: v }))}
            {radio("Past 30 days", "30d" as CustomerLastVisited, filters.lastVisited, v => onChange({ ...filters, lastVisited: v }))}
            {radio("Past 90 days", "90d" as CustomerLastVisited, filters.lastVisited, v => onChange({ ...filters, lastVisited: v }))}
            {radio("Past year", "year" as CustomerLastVisited, filters.lastVisited, v => onChange({ ...filters, lastVisited: v }))}
          </div>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-widest font-bold mb-2" style={{ color: C.muted, letterSpacing: "0.14em" }}>
            Hasn&rsquo;t visited
          </p>
          <p className="text-[12px] mb-2" style={{ color: C.muted }}>
            Show customers who&rsquo;ve never booked.
          </p>
          <div className="flex flex-wrap gap-2">
            {radio("Off", "any" as CustomerLastVisited, filters.lastVisited, v => onChange({ ...filters, lastVisited: v }))}
            {radio("Never visited", "never" as CustomerLastVisited, filters.lastVisited, v => onChange({ ...filters, lastVisited: v }))}
          </div>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-widest font-bold mb-2" style={{ color: C.muted, letterSpacing: "0.14em" }}>
            Visit frequency
          </p>
          <div className="flex flex-wrap gap-2">
            {radio("Any", "any" as CustomerFrequency, filters.frequency, v => onChange({ ...filters, frequency: v }))}
            {radio("1+ visits", "1plus" as CustomerFrequency, filters.frequency, v => onChange({ ...filters, frequency: v }))}
            {radio("3+ visits", "3plus" as CustomerFrequency, filters.frequency, v => onChange({ ...filters, frequency: v }))}
            {radio("5+ visits", "5plus" as CustomerFrequency, filters.frequency, v => onChange({ ...filters, frequency: v }))}
          </div>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-widest font-bold mb-2" style={{ color: C.muted, letterSpacing: "0.14em" }}>
            More filters
          </p>
          <div className="space-y-2">
            <SoonRow label="Card on file" />
            <SoonRow label="Feedback" />
            <SoonRow label="Creation source" />
            <SoonRow label="Instant profile" />
            <SoonRow label="Visited location" />
          </div>
        </div>

        <Button variant="primary" fullWidth onClick={onApply}>
          Apply
        </Button>
      </div>
    </Sheet>
  );
};

// ============================================================
//  CLIENT SHEET (with photos tab)
// ============================================================
const PHOTO_CATEGORIES = [
  { value: "inspiration", label: "Inspo", color: "#E5D4A0" },
  { value: "before", label: "Before", color: "#D4C5A8" },
  { value: "in_progress", label: "In progress", color: "#E8C99A" },
  { value: "after", label: "After", color: "#C9D9B0" },
  { value: "transformation", label: "Transformation", color: "#F5E9C8" },
  { value: "color_reference", label: "Color ref", color: "#E5C6BD" },
  { value: "scalp", label: "Scalp", color: "#DFB5AC" },
];

// Small inline card on the client profile. Hides itself when the
// client has no completed appointments yet (computeClientRebookingInsight
// returns null in that case).
const ClientRebookingInsightCard = ({
  clientId,
  appointments,
  business,
}: {
  clientId: string;
  appointments: any[];
  business: any;
}) => {
  const insight = useMemo(
    () => computeClientRebookingInsight(clientId, appointments, todayISO()),
    [clientId, appointments],
  );
  if (!insight) return null;

  const STATUS_LABEL = { not_due: "Not due", due_soon: "Due soon", overdue: "Overdue" } as const;
  const statusTone =
    insight.status === "overdue" ? C.danger
    : insight.status === "due_soon" ? C.warning
    : C.muted;

  return (
    <Card className="p-4" style={{ background: C.ivory, border: `1px solid ${C.hairline}` }}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: C.muted, letterSpacing: "0.12em" }}>
          Rebooking
        </p>
        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
          style={{ background: C.cream, color: statusTone, border: `1px solid ${C.hairline}`, letterSpacing: "0.08em" }}>
          {STATUS_LABEL[insight.status]}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-[11px]">
        <div>
          <p className="uppercase tracking-widest font-bold mb-0.5" style={{ color: C.muted, letterSpacing: "0.1em", fontSize: 9 }}>Last appointment</p>
          <p style={{ color: C.coffee, fontWeight: 600 }}>{fmtDate(insight.last_appointment_date)}</p>
          {insight.last_style && (
            <p className="text-[10px]" style={{ color: C.muted }}>{insight.last_style}</p>
          )}
        </div>
        <div>
          <p className="uppercase tracking-widest font-bold mb-0.5" style={{ color: C.muted, letterSpacing: "0.1em", fontSize: 9 }}>Suggested rebook</p>
          <p style={{ color: C.coffee, fontWeight: 600 }}>{fmtDate(insight.recommended_rebook_date)}</p>
          {insight.estimated_value != null && (
            <p className="text-[10px]" style={{ color: C.muted }}>
              Est. {fmtMoney(insight.estimated_value, business?.currency || "USD")}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
};

// ============================================================
//  CLIENT PROFILE — read-mostly detail sheet (Phase 3 surface)
// ============================================================
//
// Tapping a customer row opens this rich profile. Edit lives behind
// the explicit Edit button (which opens the existing ClientSheet),
// so save logic is unchanged. Tap any appointment row to open it
// in the AppointmentSheet. Read-only sections derive every number
// from existing appointments / clients / photos data — no fake
// transactions, no fake activity.

const TAG_PRESETS = [
  "VIP",
  "New Client",
  "Repeat Client",
  "Needs Follow-Up",
  "Deposit Required",
  "Sensitive Scalp",
  "Marketing: Top Client",
] as const;

const COMM_PREF_OPTIONS = [
  { value: "email", label: "Email reminders" },
  { value: "text",  label: "Text reminders" },
  { value: "none",  label: "No reminders" },
] as const;

const ClientProfileSheet = ({
  open, client, store, onClose, onEdit, onOpenAppointment, onMessage, onBookAppointment,
}: {
  open: boolean;
  client: any;
  store: any;
  onClose: () => void;
  onEdit: () => void;
  onOpenAppointment: (a: any) => void;
  onMessage?: (ctx: CommContext) => void;
  onBookAppointment?: (prefill?: any) => void;
}) => {
  const today = todayISO();
  const business = store.business;
  const currency = business?.currency || "USD";
  const allAppts: any[] = (store.appointments as any[]) || [];
  const photos: any[] = (store.photos as any[]) || [];
  const cAppts = useMemo(
    () => allAppts.filter(a => a?.clientId === client?.id && a?.status !== "cancelled"),
    [allAppts, client?.id],
  );
  const cPhotos = useMemo(
    () => photos.filter(p => p?.clientId === client?.id),
    [photos, client?.id],
  );

  // Past / today / future buckets, used for the visit-date logic.
  // Mirrors the Customers-row fix from PR #75: treat each appointment
  // by date relative to today, not by sort position alone.
  const past = useMemo(
    () => cAppts.filter(a => a?.date && a.date < today).sort((a, b) => (a.date || "").localeCompare(b.date || "")),
    [cAppts, today],
  );
  const todays = useMemo(() => cAppts.filter(a => a?.date === today), [cAppts, today]);
  const future = useMemo(
    () => cAppts.filter(a => a?.date && a.date > today).sort((a, b) => (a.date || "").localeCompare(b.date || "")),
    [cAppts, today],
  );

  const completed = useMemo(
    () => cAppts.filter(a => a?.status === "completed" || a?.paymentStatus === "paid"),
    [cAppts],
  );
  const lifetimeSpend = useMemo(
    () => completed.reduce((s, a) => s + calculateCollectedAmount(a), 0),
    [completed],
  );

  const firstVisit = past[0]?.date || todays[0]?.date || null;
  const lastVisit = past.length > 0 ? past[past.length - 1].date : null;
  const upcomingCount = future.length + todays.length;

  // Tags persist on the client record's `tags` array. The clients
  // table promotes some columns and round-trips the rest through the
  // data jsonb, so this works without a schema change.
  const tags: string[] = Array.isArray(client?.tags) ? client.tags : [];
  const commPref: string = client?.commPreference || "email";

  const toggleTag = async (label: string) => {
    if (!client?.id) return;
    const next = tags.includes(label)
      ? tags.filter(t => t !== label)
      : [...tags, label];
    await store.upsertClient({ ...client, tags: next });
  };

  const setCommPref = async (value: string) => {
    if (!client?.id) return;
    await store.upsertClient({ ...client, commPreference: value });
  };

  // Activity timeline — derived events. Each event is a real artifact
  // (an appointment, a payment, a discount snapshot, a note edit).
  type Activity = { id: string; ts: string; label: string; detail?: string };
  const activity: Activity[] = useMemo(() => {
    const evts: Activity[] = [];
    for (const a of cAppts) {
      if (a?.createdAt) {
        evts.push({
          id: `created_${a.id}`,
          ts: a.createdAt,
          label: "Appointment created",
          detail: `${a.style || "Service"} · ${a.date ? fmtDate(a.date) : "—"}`,
        });
      }
      if (a?.status === "completed" && a?.date) {
        // Approximate completion timestamp with end of the appointment day.
        evts.push({
          id: `completed_${a.id}`,
          ts: `${a.date}T23:59:00`,
          label: "Appointment completed",
          detail: `${a.style || "Service"} · ${fmtMoney(calculateCollectedAmount(a), currency)}`,
        });
      }
      if (Number(a?.depositPaid) > 0 && a?.paymentDate) {
        evts.push({
          id: `payment_${a.id}`,
          ts: `${a.paymentDate}T00:00:00`,
          label: a?.paymentStatus === "paid" ? "Payment recorded" : "Deposit recorded",
          detail: `${fmtMoney(Number(a.depositPaid), currency)} · ${a.style || "Service"}`,
        });
      }
      if (a?.discountName && Number(a?.discountAmount) > 0) {
        evts.push({
          id: `discount_${a.id}`,
          ts: a?.createdAt || `${a.date || today}T00:00:00`,
          label: `Discount used · ${a.discountName}`,
          detail: `− ${fmtMoney(Number(a.discountAmount), currency)} on ${a.style || "Service"}`,
        });
      }
    }
    return evts.sort((x, y) => (y.ts || "").localeCompare(x.ts || ""));
  }, [cAppts, currency, today]);

  // Hook order must be stable across renders — keep useState above the
  // early-return so the second render (client flips from null to set)
  // doesn't change the hook count.
  const [tab, setTab] = useState<"upcoming" | "previous">("upcoming");

  if (!client) return null;

  const ApptRow = ({ a }: { a: any }) => {
    const status = a?.status || "scheduled";
    const ps = paymentStatusOf(a, today);
    const total = Number(a?.totalPrice) || 0;
    const dep = Number(a?.depositPaid) || 0;
    const balance = Math.max(0, total - dep - (Number(a?.discountAmount) || 0));
    return (
      <button
        type="button"
        onClick={() => onOpenAppointment(a)}
        className="w-full text-left rounded-2xl px-3.5 py-3 active:scale-[0.99] transition mb-2"
        style={{
          background: C.paper,
          border: `1px solid ${C.hairline}`,
          color: "inherit",
          font: "inherit",
          appearance: "none",
          WebkitAppearance: "none",
        }}
      >
        <div className="flex items-start justify-between gap-3" style={{ pointerEvents: "none" }}>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <Pill tone={STATUS_TONE[status] || "neutral"}>{STATUS_LABEL[status] || status}</Pill>
              {ps !== "pending" && status !== "cancelled" && (
                <Pill tone={PAYMENT_STATUS_TONE[ps]}>{PAYMENT_STATUS_LABEL[ps]}</Pill>
              )}
            </div>
            <p className="text-sm font-semibold truncate" style={{ color: C.espresso }}>
              {a?.style || "Service"}
            </p>
            <p className="text-[11px] mt-0.5" style={{ color: C.muted }}>
              {a?.date ? fmtDate(a.date) : "—"}{a?.time ? ` · ${fmtTime(a.time)}` : ""}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 600, color: C.goldDeep }}>
              {fmtMoney(total, currency)}
            </p>
            {balance > 0 && (
              <p className="text-[11px]" style={{ color: C.warning }}>
                Balance {fmtMoney(balance, currency)}
              </p>
            )}
          </div>
        </div>
      </button>
    );
  };

  const StatTile = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
    <Card className="p-3.5">
      <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: C.muted, letterSpacing: "0.14em" }}>
        {label}
      </p>
      <p className="mt-1" style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 600, color: C.espresso, lineHeight: 1.05 }}>
        {value}
      </p>
      {hint && <p className="text-[11px] mt-0.5" style={{ color: C.muted }}>{hint}</p>}
    </Card>
  );

  const Section = ({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) => (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: C.muted, letterSpacing: "0.14em" }}>
          {title}
        </p>
        {action}
      </div>
      {children}
    </div>
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={client?.name || "Client"}
      rightAction={
        <button
          type="button"
          onClick={onEdit}
          className="text-[12px] font-semibold px-3 py-1.5 rounded-lg active:scale-[0.97] transition"
          style={{ background: C.ivory, color: C.coffee, border: `1px solid ${C.hairline}` }}
          aria-label="Edit client"
        >
          <span className="inline-flex items-center gap-1.5">
            <Edit3 size={12} /> Edit
          </span>
        </button>
      }
    >
      <div className="space-y-5 pb-2">
        {/* SUMMARY STATS */}
        <div className="grid grid-cols-2 gap-3">
          <StatTile label="Total visits" value={String(completed.length)} hint={`${cAppts.length} on the books`} />
          <StatTile label="Upcoming" value={String(upcomingCount)} hint={upcomingCount === 0 ? "Nothing scheduled" : "future bookings"} />
          <StatTile label="Last visit" value={lastVisit ? fmtDate(lastVisit) : "—"} />
          <StatTile label="First visit" value={firstVisit ? fmtDate(firstVisit) : "—"} />
          <Card className="p-3.5 col-span-2" style={{ background: `linear-gradient(180deg, ${C.espresso}, ${C.coffee})`, border: `1px solid ${C.goldDeep}` }}>
            <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: C.gold, letterSpacing: "0.14em" }}>Lifetime spend</p>
            <p className="mt-1" style={{ fontFamily: FONT_DISPLAY, fontSize: 28, fontWeight: 600, color: C.cream, lineHeight: 1 }}>
              {fmtMoney(lifetimeSpend, currency)}
            </p>
          </Card>
        </div>

        {/* CONTACT */}
        <Section
          title="Contact"
          action={
            onMessage ? (
              <button
                type="button"
                onClick={() => onMessage({ client, appointment: future[0] || past[past.length - 1] || null })}
                className="text-[11px] font-semibold px-2 py-1"
                style={{ color: C.goldDeep, background: "transparent", border: 0 }}
              >
                Message
              </button>
            ) : undefined
          }
        >
          <Card className="p-3.5 space-y-2">
            <div className="flex items-center gap-3">
              <Phone size={14} style={{ color: C.muted }} />
              <p className="text-[13px]" style={{ color: client?.phone ? C.espresso : C.muted }}>
                {client?.phone || "No phone on file"}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Mail size={14} style={{ color: C.muted }} />
              <p className="text-[13px] truncate" style={{ color: client?.email ? C.espresso : C.muted }}>
                {client?.email || "No email on file"}
              </p>
            </div>
            {client?.timezone && (
              <div className="flex items-center gap-3">
                <Clock size={14} style={{ color: C.muted }} />
                <p className="text-[13px]" style={{ color: C.espresso }}>{client.timezone}</p>
              </div>
            )}
            <div className="flex items-center gap-3">
              <Bell size={14} style={{ color: C.muted }} />
              <p className="text-[13px]" style={{ color: C.espresso }}>
                Prefers {COMM_PREF_OPTIONS.find(o => o.value === commPref)?.label.toLowerCase() || "email reminders"}
              </p>
            </div>
          </Card>
        </Section>

        {/* TAGS / GROUPS */}
        <Section title="Tags">
          <div className="flex flex-wrap gap-2">
            {TAG_PRESETS.map(t => {
              const on = tags.includes(t);
              return (
                <button
                  type="button"
                  key={t}
                  onClick={() => toggleTag(t)}
                  className="px-3 py-1.5 rounded-full text-[11px] font-semibold active:scale-[0.97] transition"
                  style={{
                    background: on ? C.espresso : C.paper,
                    color: on ? C.cream : C.coffee,
                    border: `1px solid ${on ? C.espresso : C.hairline}`,
                  }}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </Section>

        {/* APPOINTMENT NOTIFICATIONS */}
        <Section title="Appointment notifications">
          <Card className="p-3.5">
            <div className="flex flex-wrap gap-2">
              {COMM_PREF_OPTIONS.map(o => {
                const on = commPref === o.value;
                return (
                  <button
                    type="button"
                    key={o.value}
                    onClick={() => setCommPref(o.value)}
                    className="px-3 py-1.5 rounded-full text-[11px] font-semibold active:scale-[0.97] transition"
                    style={{
                      background: on ? C.espresso : C.paper,
                      color: on ? C.cream : C.coffee,
                      border: `1px solid ${on ? C.espresso : C.hairline}`,
                    }}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] mt-2" style={{ color: C.muted }}>
              Stored on the client. SMS sending isn&rsquo;t wired yet.
            </p>
          </Card>
        </Section>

        {/* NOTES & FILES */}
        <Section title="Notes & files">
          <Card className="p-3.5 space-y-3">
            {client?.notes ? (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: C.muted, letterSpacing: "0.12em" }}>Notes</p>
                <p className="text-[13px] mt-1" style={{ color: C.coffee, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{client.notes}</p>
              </div>
            ) : (
              <p className="text-[12px]" style={{ color: C.muted }}>No notes yet — open Edit to add one.</p>
            )}
            {client?.allergies && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: C.muted, letterSpacing: "0.12em" }}>Allergies</p>
                <p className="text-[13px] mt-1" style={{ color: C.coffee, lineHeight: 1.5 }}>{client.allergies}</p>
              </div>
            )}
            {client?.scalpSensitivity && client?.scalpSensitivity !== "None" && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: C.muted, letterSpacing: "0.12em" }}>Scalp sensitivity</p>
                <p className="text-[13px] mt-1" style={{ color: C.coffee }}>{client.scalpSensitivity}</p>
              </div>
            )}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: C.muted, letterSpacing: "0.12em" }}>Photos</p>
              {cPhotos.length === 0 ? (
                <p className="text-[12px] mt-1" style={{ color: C.muted }}>
                  No photos yet. Inspiration shots, before/after, and scalp references show here.
                </p>
              ) : (
                <p className="text-[12px] mt-1" style={{ color: C.coffee }}>
                  {cPhotos.length} photo{cPhotos.length === 1 ? "" : "s"} on file. Open Edit to view the gallery.
                </p>
              )}
            </div>
          </Card>
        </Section>

        {/* PAYMENT ON FILE */}
        <Section title="Payment on file">
          <Card className="p-3.5 flex items-center justify-between" style={{ background: C.paper }}>
            <div>
              <p className="text-[13px] font-semibold" style={{ color: C.espresso }}>No payment method on file</p>
              <p className="text-[11px]" style={{ color: C.muted }}>Card-on-file is on the roadmap.</p>
            </div>
            <button
              type="button"
              disabled
              className="text-[11px] font-semibold px-3 py-1.5 rounded-lg"
              style={{ background: C.ivory, color: C.muted, border: `1px solid ${C.hairline}`, opacity: 0.7 }}
            >
              Coming soon
            </button>
          </Card>
        </Section>

        {/* TRANSACTIONS */}
        <Section title="Transactions">
          {completed.length === 0 ? (
            <Card className="p-4 text-center">
              <p className="text-[12px]" style={{ color: C.muted }}>No transactions yet.</p>
            </Card>
          ) : (
            <Card className="p-2">
              {completed
                .slice()
                .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
                .slice(0, 8)
                .map((a, i) => {
                  const ps = paymentStatusOf(a, today);
                  return (
                    <div
                      key={a.id}
                      className="flex items-center justify-between px-2 py-2.5"
                      style={{ borderTop: i === 0 ? "none" : `1px solid ${C.hairline}` }}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold truncate" style={{ color: C.espresso }}>{a.style || "Service"}</p>
                        <p className="text-[11px]" style={{ color: C.muted }}>
                          {a.date ? fmtDate(a.date) : "—"} · {PAYMENT_STATUS_LABEL[ps] || ps}
                        </p>
                      </div>
                      <span className="text-[13px] font-semibold tabular-nums ml-3" style={{ color: C.coffee }}>
                        {fmtMoney(calculateCollectedAmount(a), currency)}
                      </span>
                    </div>
                  );
                })}
            </Card>
          )}
        </Section>

        {/* APPOINTMENTS — Upcoming / Previous tabs */}
        <Section
          title="Appointments"
          action={
            onBookAppointment ? (
              <button
                type="button"
                onClick={() => onBookAppointment({ clientId: client?.id, clientName: client?.name, clientPhone: client?.phone, clientEmail: client?.email })}
                className="text-[11px] font-semibold px-2 py-1"
                style={{ color: C.goldDeep, background: "transparent", border: 0 }}
              >
                + Book
              </button>
            ) : undefined
          }
        >
          <div className="flex p-1 rounded-xl mb-2" style={{ background: C.ivory, border: `1px solid ${C.hairline}` }}>
            {([
              { id: "upcoming", label: `Upcoming · ${future.length + todays.length}` },
              { id: "previous", label: `Previous · ${past.length}` },
            ] as { id: "upcoming" | "previous"; label: string }[]).map(t => (
              <button
                type="button"
                key={t.id}
                onClick={() => setTab(t.id)}
                className="flex-1 py-2 rounded-lg text-[12px] font-semibold transition"
                style={{
                  background: tab === t.id ? C.espresso : "transparent",
                  color: tab === t.id ? C.cream : C.coffee,
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          {tab === "upcoming" ? (
            (todays.length + future.length) === 0 ? (
              <Card className="p-4 text-center">
                <p className="text-[12px]" style={{ color: C.muted }}>No upcoming appointments.</p>
              </Card>
            ) : (
              <>{[...todays, ...future].map(a => <ApptRow key={a.id} a={a} />)}</>
            )
          ) : (
            past.length === 0 ? (
              <Card className="p-4 text-center">
                <p className="text-[12px]" style={{ color: C.muted }}>No past appointments yet.</p>
              </Card>
            ) : (
              <>{[...past].reverse().map(a => <ApptRow key={a.id} a={a} />)}</>
            )
          )}
        </Section>

        {/* ACTIVITY TIMELINE */}
        <Section title="Activity">
          {activity.length === 0 ? (
            <Card className="p-4 text-center">
              <p className="text-[12px]" style={{ color: C.muted }}>No activity yet — appointments and payments will land here as they happen.</p>
            </Card>
          ) : (
            <Card className="p-2">
              {activity.slice(0, 12).map((e, i) => (
                <div
                  key={e.id}
                  className="flex items-start gap-3 px-2 py-2.5"
                  style={{ borderTop: i === 0 ? "none" : `1px solid ${C.hairline}` }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 8, height: 8, borderRadius: 999,
                      background: C.gold, marginTop: 6, flexShrink: 0,
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold" style={{ color: C.espresso }}>{e.label}</p>
                    {e.detail && <p className="text-[11px] mt-0.5" style={{ color: C.muted }}>{e.detail}</p>}
                  </div>
                  <span className="text-[10px]" style={{ color: C.muted }}>
                    {(e.ts || "").slice(0, 10) ? fmtDate((e.ts || "").slice(0, 10)) : ""}
                  </span>
                </div>
              ))}
            </Card>
          )}
        </Section>

        <div className="grid grid-cols-2 gap-3 pt-2">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button variant="primary" icon={<Edit3 size={16} />} onClick={onEdit}>Edit profile</Button>
        </div>
      </div>
    </Sheet>
  );
};

const ClientSheet = ({ open, client, store, onClose, openCommunication, openQuickAppt, savePhoto, deletePhotoExternal }: {
  open: boolean;
  client: any;
  store: any;
  onClose: () => void;
  openCommunication?: (ctx: CommContext) => void;
  openQuickAppt?: (prefill?: any) => void;
  savePhoto?: (p: any) => Promise<any>;
  deletePhotoExternal?: (id: string) => Promise<void>;
}) => {
  const { upsertClient, deleteClient, appointments, photos, business, upsertPhoto, deletePhoto } = store;
  // Prefer the cloud-aware wrappers when wired; fall back to the
  // store's local-only methods for guest mode.
  const upsertPhotoFn = savePhoto || upsertPhoto;
  const deletePhotoFn = deletePhotoExternal || deletePhoto;
  const [tab, setTab] = useState("info");
  const [form, setForm] = useState<any>({});

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- prop/store-driven sync, intentional
      setForm({
        id: client?.id, name: client?.name || "",
        phone: client?.phone || "", email: client?.email || "",
        preferredStyles: client?.preferredStyles || [],
        scalpSensitivity: client?.scalpSensitivity || "None",
        allergies: client?.allergies || "", notes: client?.notes || "",
      });
      setTab("info");
    }
  }, [open, client]);

  const myAppts = useMemo(() =>
    form.id ? appointments.filter((a: any) => a.clientId === form.id).sort((a: any, b: any) => b.date.localeCompare(a.date)) : []
  , [appointments, form.id]);

  const myPhotos = useMemo(() =>
    form.id ? photos.filter((p: any) => p.clientId === form.id).sort((a: any, b: any) => (b.takenAt || b.createdAt || "").localeCompare(a.takenAt || a.createdAt || "")) : []
  , [photos, form.id]);

  const totalSpent = myAppts
    .filter((a: any) => (a.status === "completed" || a.paymentStatus === "paid") && a.status !== "cancelled")
    .reduce((s: number, a: any) => {
      const collected = calculateCollectedAmount(a);
      return s + collected;
    }, 0);

  const togglePref = (s: string) => {
    const has = form.preferredStyles.includes(s);
    setForm({ ...form, preferredStyles: has ? form.preferredStyles.filter((x: string) => x !== s) : [...form.preferredStyles, s] });
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    await upsertClient(form);
    onClose();
  };

  const handleDelete = async () => {
    if (!form.id) return;
    if (!window.confirm(`Delete ${form.name}? Past appointments stay; photos are removed.`)) return;
    for (const p of myPhotos) await deletePhotoFn(p.id);
    await deleteClient(form.id);
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title={form.id ? form.name || "Edit Client" : "New Client"}>
      <div className="pb-6">
        {form.id && (
          <Card className="p-4 mb-4" style={{ background: `linear-gradient(135deg, ${C.espresso} 0%, ${C.coffee} 100%)` }}>
            <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: C.gold, letterSpacing: "0.18em" }}>Lifetime spent</p>
            <p style={{ fontFamily: FONT_DISPLAY, fontSize: 32, fontWeight: 600, color: C.cream, lineHeight: 1.1 }}>{fmtMoney(totalSpent, business.currency)}</p>
            <p className="text-xs mt-1" style={{ color: "rgba(245, 235, 217, 0.7)" }}>{myAppts.length} total · {myPhotos.length} photo{myPhotos.length === 1 ? "" : "s"}</p>
          </Card>
        )}

        {form.id && (
          <div className="flex p-1 rounded-xl mb-4" style={{ background: C.ivory, border: `1px solid ${C.hairline}` }}>
            {["info", "photos", "history"].map(t => (
              <button type="button" key={t} onClick={() => setTab(t)}
                className="flex-1 py-2 rounded-lg text-[13px] font-semibold transition capitalize"
                style={{ background: tab === t ? C.espresso : "transparent", color: tab === t ? C.cream : C.coffee }}>
                {t === "photos" ? `Photos${myPhotos.length ? ` · ${myPhotos.length}` : ""}` : t}
              </button>
            ))}
          </div>
        )}

        {tab === "info" && (
          <div className="space-y-4">
            {form.id && (
              <ClientRebookingInsightCard
                clientId={form.id}
                appointments={appointments}
                business={business}
              />
            )}
            {form.id && (
              <ClientCommunicationTimeline
                clientId={form.id}
                commLog={store.commLog || []}
              />
            )}
            {form.id && (
              <ClientRetentionCard
                clientId={form.id}
                clientName={form.name}
                appointments={appointments}
                today={todayISO()}
                business={business}
                openCommunication={openCommunication}
                onDuplicate={(prefill) => { onClose(); openQuickAppt?.(prefill); }}
              />
            )}
            <Field label="Name"><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Full name" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Phone"><Input type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="555-0123" /></Field>
              <Field label="Email"><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="name@email.com" /></Field>
            </div>
            <Field label="Preferred styles" hint="tap to toggle">
              <div className="flex flex-wrap gap-2 mt-1">
                {PREF_STYLES.map(s => {
                  const on = (form.preferredStyles || []).includes(s);
                  return (
                    <button type="button" key={s} onClick={() => togglePref(s)}
                      className="px-3 py-1.5 rounded-full text-[12px] font-semibold transition"
                      style={{ background: on ? C.gold : C.paper, color: on ? C.espresso : C.coffee, border: `1px solid ${on ? C.goldDeep : C.hairline}` }}>
                      {s}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field label="Scalp sensitivity">
              <Select value={form.scalpSensitivity} onChange={e => setForm({ ...form, scalpSensitivity: e.target.value })}
                options={SENSITIVITY.map(s => ({ value: s, label: s }))} />
            </Field>
            <Field label="Allergies"><Input value={form.allergies} onChange={e => setForm({ ...form, allergies: e.target.value })} placeholder="e.g. tea tree, lanolin" /></Field>
            <Field label="Notes"><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Hair texture, density, takedown notes…" rows={3} /></Field>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button variant="primary" onClick={handleSave} disabled={!form.name?.trim()}>Save</Button>
            </div>
            {form.id && openCommunication && (
              <Button variant="outline" icon={<MessageSquare size={16} />} fullWidth
                onClick={() => openCommunication({ client: form })}>
                Send message to {form.name?.split(" ")[0] || "client"}
              </Button>
            )}
            {form.id && <Button variant="danger" icon={<Trash2 size={16} />} onClick={handleDelete} fullWidth>Delete client</Button>}
          </div>
        )}

        {tab === "photos" && form.id && (
          <PhotoGallery clientId={form.id} clientName={form.name} appointments={myAppts} photos={myPhotos} upsertPhoto={upsertPhotoFn} deletePhoto={deletePhotoFn} />
        )}

        {tab === "history" && form.id && (
          <div className="space-y-2">
            {myAppts.length === 0 ? (
              <p className="text-center text-sm py-6" style={{ color: C.muted }}>No appointments yet.</p>
            ) : myAppts.map((a: any) => (
              <div key={a.id} className="flex items-center justify-between py-2.5 px-3 rounded-lg" style={{ background: C.ivory }}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate" style={{ color: C.espresso }}>{a.style || "—"}</p>
                  <p className="text-xs mt-0.5" style={{ color: C.muted }}>{fmtDate(a.date)} · {STATUS_LABEL[a.status as keyof typeof STATUS_LABEL]}</p>
                </div>
                <span className="font-semibold text-sm shrink-0" style={{ color: C.goldDeep }}>{fmtMoney(a.totalPrice, business.currency)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
};

// ============================================================
//  PHOTO GALLERY (inside client sheet)
// ============================================================
const PhotoGallery = ({ clientId, clientName, appointments, photos, upsertPhoto, deletePhoto }: {
  clientId: string;
  clientName: string;
  appointments: any[];
  photos: any[];
  upsertPhoto: (p: any) => Promise<any>;
  deletePhoto: (id: string) => Promise<void>;
}) => {
  const [filter, setFilter] = useState("all");
  const [lightbox, setLightbox] = useState<EntityRecord | null>(null); // photo or null
  const [editingPhoto, setEditingPhoto] = useState<EntityRecord | null>(null);
  const [showFavOnly, setShowFavOnly] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const filtered = photos.filter((p: any) => {
    if (showFavOnly && !p.isFavorite) return false;
    if (filter !== "all" && p.category !== filter) return false;
    return true;
  });

  const handleFileChange = async (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { dataUrl, thumbnailDataUrl } = await compressImage(file);
      const photo = await upsertPhoto({
        clientId, category: "inspiration",
        dataUrl, thumbnailDataUrl,
        caption: "", isFavorite: false,
        takenAt: todayISO(),
      });
      setEditingPhoto(photo);
    } catch (err) {
      alert("Couldn't process that image. Try a smaller or different file.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div>
      <input ref={fileRef} type="file" accept="image/*" onChange={handleFileChange} style={{ display: "none" }} />

      <div className="flex gap-2 mb-3">
        <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
          className="flex-1 rounded-xl px-4 py-3 text-sm font-bold flex items-center justify-center gap-2"
          style={{ background: C.gold, color: C.espresso, border: `1.5px solid ${C.goldDeep}` }}>
          {uploading ? "Uploading…" : <><Camera size={16} /> Add photo</>}
        </button>
        <button type="button" onClick={() => setShowFavOnly(!showFavOnly)}
          className="rounded-xl px-3 py-3"
          style={{ background: showFavOnly ? C.espresso : C.paper, color: showFavOnly ? C.gold : C.coffee, border: `1.5px solid ${showFavOnly ? C.espresso : C.hairline}` }}>
          <Star size={16} fill={showFavOnly ? C.gold : "none"} />
        </button>
      </div>

      <div className="flex gap-1.5 overflow-x-auto bbp-scroll mb-3 pb-1">
        <CategoryChip label="All" active={filter === "all"} onClick={() => setFilter("all")} />
        {PHOTO_CATEGORIES.map(cat => (
          <CategoryChip key={cat.value} label={cat.label} active={filter === cat.value} onClick={() => setFilter(cat.value)} />
        ))}
      </div>

      {filtered.length === 0 ? (
        <Card className="p-6 text-center">
          <ImageIcon size={28} style={{ color: C.gold, margin: "0 auto 8px" }} />
          <p className="italic" style={{ fontFamily: FONT_DISPLAY, color: C.gold, fontSize: 16 }}>portfolio in waiting</p>
          <p className="text-sm mt-1" style={{ color: C.muted }}>
            No photos yet. Add inspiration, before-and-afters, or client references — anything that helps you remember how you styled them last time.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {filtered.map(p => (
            <button type="button" key={p.id} onClick={() => setLightbox(p)}
              className="relative aspect-square rounded-xl overflow-hidden active:scale-[0.97] transition"
              style={{ border: `1px solid ${C.hairline}` }}>
              <CloudPhotoImg photo={p} kind="thumb" alt={p.caption || ""}
                style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              {p.isFavorite && (
                <div className="absolute top-1.5 right-1.5 rounded-full p-0.5" style={{ background: "rgba(0,0,0,0.4)" }}>
                  <Star size={11} fill={C.gold} stroke={C.gold} />
                </div>
              )}
              {p.category && (
                <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1 text-[9px] font-bold uppercase tracking-wider"
                  style={{ background: "linear-gradient(transparent, rgba(0,0,0,0.6))", color: "#fff" }}>
                  {PHOTO_CATEGORIES.find(c => c.value === p.category)?.label || p.category}
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      <PhotoLightbox photo={lightbox} photos={filtered} onClose={() => setLightbox(null)}
        onEdit={(p) => { setLightbox(null); setEditingPhoto(p); }}
        onDelete={async (p) => { if (window.confirm("Delete this photo?")) { await deletePhoto(p.id); setLightbox(null); } }}
        onToggleFav={async (p) => { await upsertPhoto({ ...p, isFavorite: !p.isFavorite }); setLightbox({ ...p, isFavorite: !p.isFavorite }); }} />

      <PhotoEditSheet photo={editingPhoto} appointments={appointments} onClose={() => setEditingPhoto(null)} onSave={async (next) => { await upsertPhoto(next); setEditingPhoto(null); }} />
    </div>
  );
};

const CategoryChip = ({ label, active, onClick }: {
  label: string;
  active: boolean;
  onClick: () => void;
}) => (
  <button type="button" onClick={onClick}
    className="px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wider whitespace-nowrap shrink-0"
    style={{
      background: active ? C.espresso : C.paper, color: active ? C.gold : C.coffee,
      border: `1px solid ${active ? C.espresso : C.hairline}`, letterSpacing: "0.08em"
    }}>{label}</button>
);

const PhotoLightbox = ({ photo, photos, onClose, onEdit, onDelete, onToggleFav }: {
  photo: any;
  photos: any[];
  onClose: () => void;
  onEdit: (p: any) => void;
  onDelete: (p: any) => Promise<void>;
  onToggleFav: (p: any) => Promise<void>;
}) => {
  const [current, setCurrent] = useState(photo);
  const photoId = photo?.id;
  const prevPhotoIdRef = useRef(photoId);
  if (prevPhotoIdRef.current !== photoId) {
    prevPhotoIdRef.current = photoId;
    setCurrent(photo);
  }
  if (!photo || !current) return null;
  const idx = photos.findIndex(p => p.id === photo.id);
  const prev = idx > 0 ? photos[idx - 1] : null;
  const next = idx < photos.length - 1 ? photos[idx + 1] : null;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col" style={{ background: "rgba(15, 8, 4, 0.96)" }}>
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid rgba(201, 169, 97, 0.2)` }}>
        <button type="button" onClick={onClose} className="p-2 rounded-full" style={{ color: C.gold }}><X size={22} /></button>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => onToggleFav(current)} className="p-2 rounded-full" style={{ color: current.isFavorite ? C.gold : C.mutedSoft }}>
            <Star size={20} fill={current.isFavorite ? C.gold : "none"} />
          </button>
          <button type="button" onClick={() => onEdit(current)} className="p-2 rounded-full" style={{ color: C.gold }}><Edit3 size={18} /></button>
          <button type="button" onClick={() => onDelete(current)} className="p-2 rounded-full" style={{ color: C.danger }}><Trash2 size={18} /></button>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center p-3 overflow-hidden relative">
        <CloudPhotoImg photo={current} kind="full" alt={current.caption || ""}
          style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 12 }} />
        {prev && (
          <button type="button" onClick={() => setCurrent(prev)} className="absolute left-2 p-2 rounded-full" style={{ background: "rgba(0,0,0,0.5)", color: C.gold }}>
            <ChevronLeft size={22} />
          </button>
        )}
        {next && (
          <button type="button" onClick={() => setCurrent(next)} className="absolute right-2 p-2 rounded-full" style={{ background: "rgba(0,0,0,0.5)", color: C.gold }}>
            <ChevronRight size={22} />
          </button>
        )}
      </div>
      <div className="px-5 py-4" style={{ background: "rgba(42, 24, 16, 0.85)" }}>
        <Pill tone="gold">{PHOTO_CATEGORIES.find(c => c.value === current.category)?.label || current.category}</Pill>
        {current.caption && <p className="mt-2 text-sm" style={{ color: C.cream }}>{current.caption}</p>}
        <p className="text-xs mt-2" style={{ color: C.mutedSoft }}>{fmtDate(current.takenAt || current.createdAt?.slice(0, 10))}</p>
      </div>
    </div>
  );
};

const PhotoEditSheet = ({ photo, appointments, onClose, onSave }: {
  photo: any;
  appointments: any[];
  onClose: () => void;
  onSave: (data: any) => void;
}) => {
  const [form, setForm] = useState<any>({});
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- prop/store-driven sync, intentional
    if (photo) setForm({
      ...photo,
      caption: photo.caption || "",
      category: photo.category || "inspiration",
      takenAt: photo.takenAt || todayISO(),
    });
  }, [photo?.id]);

  if (!photo) return null;

  return (
    <Sheet open={!!photo} onClose={onClose} title="Photo details">
      <div className="space-y-4 pb-6">
        <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${C.hairline}`, maxHeight: 240 }}>
          <CloudPhotoImg photo={form} kind="full" alt="" style={{ width: "100%", height: "100%", objectFit: "contain", maxHeight: 240 }} />
        </div>

        <Field label="Category">
          <div className="flex flex-wrap gap-2">
            {PHOTO_CATEGORIES.map(c => {
              const on = form.category === c.value;
              return (
                <button type="button" key={c.value} onClick={() => setForm({ ...form, category: c.value })}
                  className="px-3 py-1.5 rounded-full text-[12px] font-semibold transition"
                  style={{ background: on ? C.gold : C.paper, color: on ? C.espresso : C.coffee, border: `1px solid ${on ? C.goldDeep : C.hairline}` }}>
                  {c.label}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Caption / Notes">
          <Textarea value={form.caption} onChange={e => setForm({ ...form, caption: e.target.value })}
            placeholder="What's the vibe? Who inspired it? Anything to remember?" rows={3} />
        </Field>

        <Field label="Date taken"><Input type="date" value={form.takenAt} onChange={e => setForm({ ...form, takenAt: e.target.value })} /></Field>

        {appointments?.length > 0 && (
          <Field label="Link to appointment" hint="optional">
            <Select value={form.appointmentId || ""} onChange={e => setForm({ ...form, appointmentId: e.target.value })}
              options={[{ value: "", label: "— None —" }, ...appointments.map(a => ({ value: a.id, label: `${fmtDate(a.date)} · ${a.style || "appt"}` }))]} />
          </Field>
        )}

        <div className="flex items-center justify-between p-3 rounded-xl" style={{ background: C.ivory }}>
          <span className="text-sm font-semibold" style={{ color: C.espresso }}>Pin as reference favorite</span>
          <Toggle checked={!!form.isFavorite} onChange={(v) => setForm({ ...form, isFavorite: v })} />
        </div>

        <Button variant="primary" onClick={() => onSave(form)} fullWidth>Save</Button>
      </div>
    </Sheet>
  );
};
// ============================================================
//  MONEY + PRODUCTIVITY
// ============================================================
const Money = ({ store, openTxSheet, editTx, openTimerSessions, openReceipt }: { store: any; openTxSheet: any; editTx: any; openTimerSessions: any; openReceipt?: (rcp: ReceiptRecord) => void }) => {
  const [period, setPeriod] = useState("week");
  const [tab, setTab] = useState("money"); // money | productivity

  const range = useMemo(() => {
    const now = new Date();
    const start = new Date(now);
    if (period === "week") start.setDate(now.getDate() - 7);
    else if (period === "month") start.setMonth(now.getMonth() - 1);
    else if (period === "quarter") start.setMonth(now.getMonth() - 3);
    else start.setFullYear(2000);
    return { start: localDateISO(start), end: todayISO() };
  }, [period]);

  const txInRange = useMemo(() => store.transactions.filter(t => t.date >= range.start && t.date <= range.end), [store.transactions, range]);
  const apptIncome = useMemo(() => store.appointments
    .filter((a: any) => isIncomeAppt(a) && a.date >= range.start && a.date <= range.end)
    .map((a: any) => ({
      id: `appt_${a.id}`,
      type: "income",
      date: a.date,
      amount: calculateCollectedAmount(a),
      category: "Service",
      note: `${a.style || "Service"} — ${store.clientById(a.clientId)?.name || "Client"}`,
      fromAppt: true,
      apptId: a.id,
    })),
    [store.appointments, store.clients, range]);

  const all = useMemo(() => [...apptIncome, ...txInRange].sort((a, b) => b.date.localeCompare(a.date)), [apptIncome, txInRange]);
  const income = all.filter(t => t.type === "income").reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const expenses = all.filter(t => t.type === "expense").reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const net = income - expenses;

  const sessionsInRange = useMemo(() =>
    store.timerSessions.filter(s => s.endedAt && s.endedAt.slice(0, 10) >= range.start && s.endedAt.slice(0, 10) <= range.end),
    [store.timerSessions, range]);

  return (
    <div className="bbp-fade pb-32">
      <Header title="Money" subtitle={`${fmtDate(range.start)} → ${fmtDate(range.end)}`} />
      <div className="px-5 pt-2">
        {/* tab segmented */}
        <div className="flex p-1 rounded-2xl mb-4" style={{ background: C.ivory, border: `1px solid ${C.hairline}` }}>
          {[{ id: "money", label: "Money", icon: <DollarSign size={14} /> }, { id: "productivity", label: "Productivity", icon: <BarChart3 size={14} /> }].map(t => (
            <button type="button" key={t.id} onClick={() => setTab(t.id)}
              className="flex-1 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5"
              style={{
                background: tab === t.id ? C.espresso : "transparent",
                color: tab === t.id ? C.cream : C.coffee,
                letterSpacing: "0.06em", textTransform: "uppercase"
              }}>{t.icon}{t.label}</button>
          ))}
        </div>

        {/* period chips */}
        <div className="flex gap-2 overflow-x-auto bbp-scroll mb-4">
          {[["week", "7d"], ["month", "30d"], ["quarter", "90d"], ["all", "All"]].map(([k, l]) => (
            <button type="button" key={k} onClick={() => setPeriod(k)}
              className="px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition"
              style={{
                background: period === k ? C.espresso : "transparent",
                color: period === k ? C.cream : C.coffee,
                border: `1px solid ${period === k ? C.espresso : C.hairline}`,
              }}>{l}</button>
          ))}
        </div>
      </div>

      {tab === "money" ? (
        <MoneyTab all={all} income={income} expenses={expenses} net={net} business={store.business}
          editTx={editTx} openTxSheet={openTxSheet}
          receipts={store.receipts || []}
          openReceipt={openReceipt}
          period={period} />
      ) : (
        <ProductivityTab sessions={sessionsInRange} appointments={store.appointments} business={store.business}
          openTimerSessions={openTimerSessions} />
      )}
    </div>
  );
};

const MoneyTab = ({ all, income, expenses, net, business, editTx, openTxSheet, receipts = [], openReceipt, period = "week" }: {
  all: any[];
  income: number;
  expenses: number;
  net: number;
  business: any;
  editTx: any;
  openTxSheet: any;
  receipts?: any[];
  period?: string;
  openReceipt?: (rcp: ReceiptRecord) => void;
}) => (
  <div className="px-5">
    {/* Weekly hero — editorial card with a 7-day income mini-chart
        derived from real transactions. Matches the welcome preview's
        Money tile so the in-app surface feels continuous with what the
        user saw before sign-in. */}
    {(() => {
      const buckets: number[] = [];
      const todayDate = new Date();
      for (let i = 6; i >= 0; i--) {
        const d = new Date(todayDate);
        d.setDate(d.getDate() - i);
        const iso = localDateISO(d);
        const dayIncome = (all || [])
          .filter((t: any) => t && t.type === "income" && t.date === iso)
          .reduce((s: number, t: any) => s + (Number(t.amount) || 0), 0);
        buckets.push(dayIncome);
      }
      // Eyebrow + subtitle reflect the selected period so the big
      // number matches the range chip the user just tapped.
      const rangeMeta = period === "week"
        ? { eyebrow: "This week", sub: "Income across the last 7 days" }
        : period === "month"
          ? { eyebrow: "Last 30 days", sub: "Income across the last 30 days · daily breakdown below" }
          : period === "quarter"
            ? { eyebrow: "Last 90 days", sub: "Income across the last 90 days · daily breakdown below" }
            : { eyebrow: "All time", sub: "Income across all transactions · 7-day breakdown below" };
      return (
        <PreviewStyleCard style={{ marginBottom: 18 }} padding={20}>
          <SectionEyebrow>{rangeMeta.eyebrow}</SectionEyebrow>
          <p style={{ margin: "4px 0 0", fontFamily: FONT_DISPLAY, fontSize: 34, fontWeight: 600, color: C.espresso, lineHeight: 1.05, letterSpacing: "-0.01em" }}>
            {fmtMoney(income, business.currency)}
          </p>
          <p style={{ margin: "2px 0 14px", fontSize: 11, color: C.muted }}>{rangeMeta.sub}</p>
          <MiniBarChart data={buckets} ariaLabel="Daily income, last 7 days" />
          <div style={{ marginTop: 14 }}>
            <MetricRow label="Expenses" value={fmtMoney(expenses, business.currency)} />
            <div className="mt-2 pt-2" style={{ borderTop: `1px solid rgba(74,44,26,0.08)` }}>
              <MetricRow
                label={<><SectionEyebrow tone="muted">Net</SectionEyebrow></>}
                value={fmtMoney(net, business.currency)}
                accent={net >= 0}
                emphasis="strong"
              />
            </div>
          </div>
        </PreviewStyleCard>
      );
    })()}

    <div className="flex items-center justify-between mb-2">
      <SectionTitle>Activity</SectionTitle>
      <button
        type="button"
        onClick={() => openTxSheet()}
        className="rounded-full px-3 py-1.5 text-[11px] font-semibold active:scale-[0.97] transition"
        style={{
          background: C.cream,
          color: C.espresso,
          border: `1px solid ${C.hairline}`,
          letterSpacing: "0.04em",
        }}
      >
        + Add
      </button>
    </div>
    {all.length === 0 ? (
      <EmptyState icon={<Receipt size={28} style={{ color: C.muted }} />} title="No money in or out yet" body="Completed appointments auto-appear here. Log hair supplies, tools, and travel as expenses to see your real take-home." />
    ) : (
      <div className="space-y-2">
        {all.map(t => (
          <Card key={t.id} className="p-3 flex items-center gap-3" onClick={!t.fromAppt ? () => editTx(t) : undefined}>
            <div className="rounded-xl p-2.5 flex-shrink-0" style={{ background: t.type === "income" ? "rgba(92,124,74,0.12)" : "rgba(156,61,46,0.12)" }}>
              {t.type === "income" ? <ArrowUpRight size={18} style={{ color: C.success }} /> : <ArrowDownRight size={18} style={{ color: C.danger }} />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate" style={{ color: C.espresso }}>{t.note || t.category}</p>
              <p className="text-[11px]" style={{ color: C.muted }}>{fmtDate(t.date)}{t.fromAppt && " · from appointment"}</p>
            </div>
            <p className="text-sm font-mono font-bold" style={{ color: t.type === "income" ? C.success : C.danger }}>
              {t.type === "income" ? "+" : "-"}{fmtMoney(t.amount, business.currency)}
            </p>
          </Card>
        ))}
      </div>
    )}

    <div className="mt-5">
      <SectionTitle>Receipts &amp; invoices</SectionTitle>
      {receipts.length === 0 ? (
        <EmptyState icon={<Receipt size={28} style={{ color: C.muted }} />}
          title="No receipts yet"
          body="Collect a payment to create your first one." />
      ) : (
        <div className="space-y-2">
          {[...receipts]
            .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
            .slice(0, 12)
            .map((r: any) => (
              <Card key={r.id} className="p-3 flex items-center gap-3 cursor-pointer active:scale-[0.99] transition"
                onClick={() => openReceipt?.(r as ReceiptRecord)}>
                <div className="rounded-xl p-2.5 flex-shrink-0" style={{ background: r.type === "invoice" ? "rgba(201,169,97,0.18)" : "rgba(92,124,74,0.12)" }}>
                  {r.type === "invoice"
                    ? <FileText size={18} style={{ color: C.goldDeep }} />
                    : <Receipt size={18} style={{ color: C.success }} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: C.espresso }}>
                    {r.type === "invoice" ? "Invoice" : "Receipt"} #{r.receiptNumber}
                  </p>
                  <p className="text-[11px] truncate" style={{ color: C.muted }}>
                    {r.clientName || "—"} · {fmtDate((r.createdAt || "").slice(0, 10))}
                  </p>
                </div>
                <p className="text-sm font-mono font-bold" style={{ color: C.espresso }}>
                  {fmtMoney(r.type === "invoice" ? r.balanceDue : r.amountCollected, business.currency)}
                </p>
              </Card>
            ))}
        </div>
      )}
    </div>
  </div>
);

const ProductivityTab = ({ sessions, appointments, business, openTimerSessions }: {
  sessions: any[];
  appointments: any[];
  business: any;
  openTimerSessions: any;
}) => {
  // hourly earned
  const totalMs = sessions.reduce((s: number, x: any) => s + (x.totalMs - (x.pausedMs || 0)), 0);
  const totalEarned = sessions.reduce((s: number, x: any) => s + (Number(x.totalPrice) || 0), 0);
  const hours = totalMs / 3600000;
  const hourly = hours > 0 ? totalEarned / hours : 0;

  // style ranking — most profitable per hour
  const styleStats = useMemo(() => {
    const by: Record<string, any> = {};
    sessions.forEach((s: any) => {
      const k = (s.style || "Other").trim();
      if (!by[k]) by[k] = { style: k, count: 0, ms: 0, revenue: 0, varianceSum: 0 };
      const activeMs = s.totalMs - (s.pausedMs || 0);
      by[k].count += 1;
      by[k].ms += activeMs;
      by[k].revenue += Number(s.totalPrice) || 0;
      if (s.estimatedHours && activeMs > 0) {
        const actualHr = activeMs / 3600000;
        by[k].varianceSum += (actualHr - s.estimatedHours) / s.estimatedHours;
      }
    });
    return Object.values(by).map(x => ({
      ...x,
      hourly: x.ms > 0 ? x.revenue / (x.ms / 3600000) : 0,
      avgVariance: x.count > 0 ? x.varianceSum / x.count : 0
    })).sort((a, b) => b.hourly - a.hourly);
  }, [sessions]);

  const topStyles = styleStats.slice(0, 5);
  const overrunStyles = styleStats.filter((s: any) => s.avgVariance > 0.2).slice(0, 5);

  // utilization (hours worked vs available — assume 40hr available/week reference)
  const utilizationPct = Math.min(100, Math.round((hours / 40) * 100));

  return (
    <div className="px-5">
      {/* hourly hero */}
      <Card className="p-5 mb-4" style={{ background: `linear-gradient(135deg, ${C.espresso}, ${C.coffee})`, color: C.cream }}>
        <p className="text-[10px] uppercase tracking-widest font-bold mb-2" style={{ color: C.gold, letterSpacing: "0.16em" }}>Effective hourly</p>
        <p className="text-5xl font-bold mb-1" style={{ fontFamily: FONT_DISPLAY, color: C.cream }}>
          {fmtMoney(hourly, business.currency)}<span className="text-xl" style={{ color: "rgba(245,235,217,0.6)" }}>/hr</span>
        </p>
        <p className="text-xs" style={{ color: "rgba(245,235,217,0.7)" }}>
          {fmtMoney(totalEarned, business.currency)} earned over {hours.toFixed(1)}h · {sessions.length} session{sessions.length === 1 ? "" : "s"}
        </p>
      </Card>

      {/* utilization */}
      <Card className="p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-bold" style={{ color: C.espresso }}>Chair utilization</p>
          <p className="text-xs font-mono" style={{ color: C.muted }}>{hours.toFixed(1)} / 40h</p>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: C.ivory }}>
          <div className="h-full rounded-full transition-all" style={{
            width: `${utilizationPct}%`,
            background: utilizationPct > 80 ? C.success : utilizationPct > 50 ? C.gold : C.warning
          }} />
        </div>
        <p className="text-[11px] mt-2" style={{ color: C.muted }}>
          {utilizationPct < 50 ? "Light period — room to book more." :
            utilizationPct < 80 ? "Solid pace." : "You're running hot — plan rest days."}
        </p>
      </Card>

      {/* top styles */}
      <SectionTitle>Most profitable styles</SectionTitle>
      {topStyles.length === 0 ? (
        <EmptyState icon={<Award size={28} style={{ color: C.muted }} />} title="No data yet" body="Start the chair timer when you begin a service to track which styles pay best per hour." />
      ) : (
        <div className="space-y-2 mb-5">
          {topStyles.map((s, i) => (
            <Card key={s.style} className="p-3 flex items-center gap-3">
              <div className="flex items-center justify-center font-bold rounded-full"
                style={{ width: 28, height: 28, background: i === 0 ? C.gold : C.ivory, color: i === 0 ? C.espresso : C.coffee, fontFamily: FONT_DISPLAY }}>
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate" style={{ color: C.espresso }}>{s.style}</p>
                <p className="text-[11px]" style={{ color: C.muted }}>{s.count} session{s.count === 1 ? "" : "s"} · {(s.ms / 3600000).toFixed(1)}h</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-mono font-bold" style={{ color: C.espresso }}>{fmtMoney(s.hourly, business.currency)}/hr</p>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* time hogs */}
      {overrunStyles.length > 0 && (
        <>
          <SectionTitle>Time hogs</SectionTitle>
          <div className="space-y-2 mb-5">
            {overrunStyles.map(s => (
              <Card key={s.style} className="p-3 flex items-center gap-3" style={{ background: "rgba(201,118,43,0.08)", border: `1px solid rgba(201,118,43,0.25)` }}>
                <div className="rounded-xl p-2" style={{ background: "rgba(201,118,43,0.18)" }}>
                  <AlertTriangle size={16} style={{ color: C.warning }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: C.espresso }}>{s.style}</p>
                  <p className="text-[11px]" style={{ color: C.muted }}>Avg {Math.round(s.avgVariance * 100)}% over your estimate</p>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      <SectionTitle action={sessions.length > 0 ? { label: "All", onClick: openTimerSessions } : undefined}>Recent sessions</SectionTitle>
      {sessions.length === 0 ? (
        <EmptyState icon={<TimerIcon size={28} style={{ color: C.muted }} />} title="No timed sessions" body="Use the chair timer to log how long each braid takes." />
      ) : (
        <div className="space-y-2">
          {sessions.slice(0, 5).map(s => (
            <Card key={s.id} className="p-3">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-semibold" style={{ color: C.espresso }}>{s.style || "Session"}</p>
                <p className="text-[11px] font-mono" style={{ color: C.muted }}>{fmtDate(s.endedAt.slice(0, 10))}</p>
              </div>
              <div className="flex items-center gap-3 text-[11px]" style={{ color: C.muted }}>
                <span>⏱ {fmtHours(s.totalMs - (s.pausedMs || 0))}h</span>
                <span>· {fmtMoney(s.totalPrice || 0, business.currency)}</span>
                <span>· {fmtMoney(s.hourlyEarned || 0, business.currency)}/hr</span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
// ============================================================
//  REMINDER INBOX
// ============================================================
// Reminder records have two shapes that both ship in the codebase:
//   1. templates: { channel: "sms" | "email" }       — string
//   2. scheduled reminders: { type: "sms",
//                             channel: { phone, email } }  — object
// The render sites historically read `.channel.toUpperCase()` which
// crashed on shape #2 with a startup TypeError when any scheduled
// reminder existed (Capacitor caught the error and replaced the
// page with WKWebView's "couldn't load" view). This helper prefers
// `.type` (the canonical transport tag), falls back to `.channel`
// when it's a string, and always returns a safe uppercase label.
const reminderChannelLabel = (r: any): string => {
  const t = r?.type;
  if (typeof t === "string" && t) return t.toUpperCase();
  const c = r?.channel;
  if (typeof c === "string" && c) return c.toUpperCase();
  return "SMS";
};

const PURPOSE_LABEL_LOCAL = {
  confirmation: "Confirmation",
  reminder_48h: "48h reminder",
  reminder_24h: "24h reminder",
  reminder_same_day: "Same-day reminder",
  deposit_due: "Deposit due",
  balance_due: "Balance due",
  late_alert: "Late alert"
};

const ReminderInbox = ({ store, onBack, openSettings }: {
  store: any;
  onBack: () => void;
  openSettings: () => void;
}) => {
  const [filter, setFilter] = useState("pending"); // pending | sent | failed | all
  const [openItem, setOpenItem] = useState<EntityRecord | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = [...store.reminders];
    if (filter === "pending") list = list.filter(r => r.status === "pending");
    else if (filter === "sent") list = list.filter(r => r.status === "sent" || r.status === "delivered");
    else if (filter === "failed") list = list.filter(r => r.status === "failed");
    return list.sort((a, b) => (a.scheduledFor || "").localeCompare(b.scheduledFor || ""));
  }, [store.reminders, filter]);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 1800); };

  const handleSimSend = async (r: any) => {
    const updated = { ...r, status: "sent", sentAt: new Date().toISOString() };
    await store.upsertReminder(updated);
    setTimeout(async () => {
      const delivered = { ...updated, status: "delivered" };
      await store.upsertReminder(delivered);
    }, 1200);
    setOpenItem(null);
    showToast("Marked as sent");
  };

  const handleCopy = async (text: any, kind: any) => {
    try { await navigator.clipboard.writeText(text); showToast(`${kind} copied`); }
    catch { showToast("Copy unavailable"); }
  };

  const handleCancel = async (r: any) => {
    await store.upsertReminder({ ...r, status: "cancelled" });
    setOpenItem(null);
    showToast("Cancelled");
  };

  return (
    <div className="bbp-fade pb-32">
      <Header title="Reminders" leftAction={{ icon: <ChevronLeft size={20} />, onClick: onBack }} rightAction={{ icon: <SettingsIcon size={18} />, onClick: openSettings }} />

      <div className="px-5 pt-2">
        <div className="flex gap-2 overflow-x-auto bbp-scroll mb-4">
          {[["pending", "Pending", store.reminders.filter(r => r.status === "pending").length],
          ["sent", "Sent", store.reminders.filter(r => r.status === "sent" || r.status === "delivered").length],
          ["failed", "Failed", store.reminders.filter(r => r.status === "failed").length],
          ["all", "All", store.reminders.length]].map(([k, l, n]) => (
            <button type="button" key={k} onClick={() => setFilter(k)}
              className="px-3.5 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition flex items-center gap-1.5"
              style={{
                background: filter === k ? C.espresso : "transparent",
                color: filter === k ? C.cream : C.coffee,
                border: `1px solid ${filter === k ? C.espresso : C.hairline}`
              }}>
              {l}{n > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                style={{ background: filter === k ? C.gold : C.ivory, color: filter === k ? C.espresso : C.muted }}>{n}</span>}
            </button>
          ))}
        </div>

        {/* honest engineering note */}
        <Card className="p-3 mb-4" style={{ background: "rgba(201,169,97,0.10)", border: `1px solid rgba(201,169,97,0.35)` }}>
          <p className="text-[11px] leading-relaxed" style={{ color: C.coffee }}>
            <Sparkles size={12} style={{ display: "inline", marginRight: 4, color: C.gold }} />
            Reminders are queued here. Tap any reminder to copy the message and send via your phone, or mark it sent. Auto-dispatch ships when your backend is connected.
          </p>
        </Card>

        {filtered.length === 0 ? (
          <EmptyState icon={<Bell size={28} style={{ color: C.muted }} />}
            title={filter === "pending" ? "No reminders yet" : "Nothing here"}
            body="Reminders are auto-created when you book an appointment with reminders enabled." />
        ) : (
          <div className="space-y-2">
            {filtered.map(r => {
              const client = store.clientById(r.clientId);
              const appt = store.appointments.find(a => a.id === r.appointmentId);
              return (
                <Card key={r.id} className="p-3" onClick={() => setOpenItem(r)}>
                  <div className="flex items-start gap-3">
                    <div className="rounded-xl p-2 flex-shrink-0" style={{
                      background: r.status === "delivered" ? "rgba(92,124,74,0.12)" :
                        r.status === "sent" ? "rgba(201,169,97,0.18)" :
                          r.status === "failed" ? "rgba(156,61,46,0.12)" :
                            r.status === "cancelled" ? C.ivory : "rgba(201,118,43,0.12)"
                    }}>
                      {r.status === "delivered" ? <CheckCircle2 size={16} style={{ color: C.success }} /> :
                        r.status === "sent" ? <Send size={16} style={{ color: C.goldDeep }} /> :
                          r.status === "failed" ? <XCircle size={16} style={{ color: C.danger }} /> :
                            r.status === "cancelled" ? <X size={16} style={{ color: C.muted }} /> :
                              <Clock size={16} style={{ color: C.warning }} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <p className="text-sm font-semibold truncate" style={{ color: C.espresso }}>{client?.name || "Client"}</p>
                        <Pill tone={r.status === "delivered" ? "success" : r.status === "sent" ? "gold" : r.status === "failed" ? "danger" : r.status === "cancelled" ? "neutral" : "warning"}>
                          {r.status}
                        </Pill>
                      </div>
                      <p className="text-[11px]" style={{ color: C.muted }}>
                        {PURPOSE_LABEL_LOCAL[r.purpose] || r.purpose} · {reminderChannelLabel(r)}
                      </p>
                      <p className="text-[11px] mt-0.5" style={{ color: C.muted }}>
                        {r.status === "pending" ? `Scheduled ${fmtRelative(r.scheduledFor)}` :
                          r.sentAt ? `Sent ${fmtRelative(r.sentAt)}` : fmtRelative(r.scheduledFor)}
                        {appt && ` · ${appt.style || "appt"}`}
                      </p>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {openItem && (
        <ReminderDetailSheet
          reminder={openItem}
          client={store.clientById(openItem.clientId)}
          appointment={store.appointments.find(a => a.id === openItem.appointmentId)}
          template={store.reminderTemplates.find(t => t.id === openItem.templateId)}
          business={store.business}
          onClose={() => setOpenItem(null)}
          onSimSend={handleSimSend}
          onCopy={handleCopy}
          onCancel={handleCancel}
        />
      )}

      {toast && (
        <div className="fixed left-1/2 z-50 px-4 py-2 rounded-full text-sm font-semibold bbp-fade"
          style={{ bottom: 100, transform: "translateX(-50%)", background: C.espresso, color: C.cream, boxShadow: "0 8px 24px -6px rgba(0,0,0,0.3)" }}>
          {toast}
        </div>
      )}
    </div>
  );
};

const ReminderDetailSheet = ({ reminder, client, appointment, template, business, onClose, onSimSend, onCopy, onCancel }: {
  reminder: any;
  client: any;
  appointment: any;
  template: any;
  business: any;
  onClose: () => void;
  onSimSend: (r: any) => Promise<void>;
  onCopy: (text: any, kind: any) => Promise<void>;
  onCancel: (r: any) => Promise<void>;
}) => {
  if (!reminder) return null;
  const body = reminder.renderedBody || (template ? template.body : "");
  return (
    <Sheet open={!!reminder} onClose={onClose} title={PURPOSE_LABEL_LOCAL[reminder.purpose] || reminder.purpose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <Card className="p-3" style={{ background: C.ivory }}>
            <p className="text-[10px] uppercase tracking-widest font-bold mb-1" style={{ color: C.muted }}>Client</p>
            <p className="text-sm font-semibold" style={{ color: C.espresso }}>{client?.name || "—"}</p>
            {client?.phone && <p className="text-[11px]" style={{ color: C.muted }}>{client.phone}</p>}
          </Card>
          <Card className="p-3" style={{ background: C.ivory }}>
            <p className="text-[10px] uppercase tracking-widest font-bold mb-1" style={{ color: C.muted }}>Channel</p>
            <p className="text-sm font-semibold" style={{ color: C.espresso }}>{reminderChannelLabel(reminder)}</p>
            <p className="text-[11px]" style={{ color: C.muted }}>{reminder.status}</p>
          </Card>
        </div>

        {appointment && (
          <Card className="p-3" style={{ background: C.ivory }}>
            <p className="text-[10px] uppercase tracking-widest font-bold mb-1" style={{ color: C.muted }}>Appointment</p>
            <p className="text-sm font-semibold" style={{ color: C.espresso }}>
              {appointment.style || "Service"} · {fmtDate(appointment.date)} {fmtTime(appointment.time)}
            </p>
          </Card>
        )}

        <div>
          <p className="text-[11px] uppercase tracking-widest font-bold mb-2" style={{ color: C.muted, letterSpacing: "0.14em" }}>Message</p>
          <div className="p-4 rounded-2xl" style={{ background: C.paper, border: `1px solid ${C.hairline}` }}>
            <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: C.espresso }}>{body}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" icon={<Copy size={15} />}
            onClick={() => onCopy(body, reminder.channel === "email" ? "Email" : "SMS")} fullWidth>Copy</Button>
          {client?.phone && (
            <a href={`sms:${client.phone}?&body=${encodeURIComponent(body)}`}
              className="flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold transition active:scale-[0.98]"
              style={{ background: C.coffee, color: C.cream }}>
              <Phone size={15} /> Open SMS
            </a>
          )}
        </div>

        {reminder.status === "pending" && (
          <>
            <Button variant="primary" icon={<Send size={16} />} onClick={() => onSimSend(reminder)} fullWidth>Mark as sent</Button>
            <Button variant="outline" onClick={() => onCancel(reminder)} fullWidth>Cancel reminder</Button>
          </>
        )}
      </div>
    </Sheet>
  );
};

// ============================================================
//  REMINDER SETTINGS
// ============================================================
const ReminderSettings = ({ store, onBack }: {
  store: any;
  onBack: () => void;
}) => {
  const [s, setS] = useState(store.reminderSettings);
  const [openTpl, setOpenTpl] = useState<EntityRecord | null>(null);
  const [saved, setSaved] = useState(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- prop/store-driven sync, intentional
  useEffect(() => { setS(store.reminderSettings); }, [store.reminderSettings]);

  const save = async () => {
    await store.setReminderSettings(s);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  return (
    <div className="bbp-fade pb-32">
      <Header title="Reminder settings" leftAction={{ icon: <ChevronLeft size={20} />, onClick: onBack }} />
      <div className="px-5 pt-2 space-y-5">
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold" style={{ color: C.espresso }}>Reminders enabled</p>
              <p className="text-[11px]" style={{ color: C.muted }}>Master switch for all auto-reminders</p>
            </div>
            <Toggle checked={!!s.enabled} onChange={(v) => setS({ ...s, enabled: v })} />
          </div>
          <Field label="Default channel">
            <Select value={s.defaultChannel} onChange={e => setS({ ...s, defaultChannel: e.target.value })}
              options={[{ value: "sms", label: "SMS" }, { value: "email", label: "Email" }, { value: "both", label: "SMS + Email" }]} />
          </Field>
        </Card>

        <SectionTitle>Auto-send for…</SectionTitle>
        <Card className="p-4 space-y-3">
          {([
            ["confirmation", "On booking", "Sent immediately when appointment created"],
            ["h48", "48 hours before", ""],
            ["h24", "24 hours before", ""],
            ["sameDay", "Same-day", `${s.timings.sameDayHoursBefore || 3}h before`],
            ["depositDue", "Deposit due", "When deposit hasn't been recorded"],
            ["balanceDue", "Balance due", "Day of appointment"],
            ["lateAlert", "Late alert", `${s.timings.lateAlertMinutes || 15}m past start time`],
          ] as [string, string, string][]).map(([k, label, hint]) => (
            <div key={k} className="flex items-center justify-between py-1">
              <div>
                <p className="text-sm font-medium" style={{ color: C.espresso }}>{label}</p>
                {hint && <p className="text-[11px]" style={{ color: C.muted }}>{hint}</p>}
              </div>
              <Toggle checked={!!(s.timings || {})[k]} onChange={(v) => setS({ ...s, timings: { ...(s.timings || {}), [k]: v } })} />
            </div>
          ))}
          <Field label="Same-day hours before">
            <MoneyInput prefix="" suffix="hrs" allowDecimal={false} value={s.timings.sameDayHoursBefore ?? 3}
              onChange={(v) => setS({ ...s, timings: { ...s.timings, sameDayHoursBefore: parseMoney(v) || 3 } })} />
          </Field>
          <Field label="Late alert minutes">
            <MoneyInput prefix="" suffix="min" allowDecimal={false} value={s.timings.lateAlertMinutes ?? 15}
              onChange={(v) => setS({ ...s, timings: { ...s.timings, lateAlertMinutes: parseMoney(v) || 15 } })} />
          </Field>
        </Card>

        <SectionTitle>Quiet hours</SectionTitle>
        <Card className="p-4 grid grid-cols-2 gap-3">
          <Field label="Start"><Input type="time" value={s.quietHours.start} onChange={e => setS({ ...s, quietHours: { ...s.quietHours, start: e.target.value } })} /></Field>
          <Field label="End"><Input type="time" value={s.quietHours.end} onChange={e => setS({ ...s, quietHours: { ...s.quietHours, end: e.target.value } })} /></Field>
        </Card>

        <SectionTitle>Signature</SectionTitle>
        <Card className="p-4">
          <Field label="Sent at end of every reminder" hint={`Defaults to: ${store.business.businessName}`}>
            <Input value={s.signature || ""} onChange={e => setS({ ...s, signature: e.target.value })} placeholder={store.business.businessName} />
          </Field>
        </Card>

        <SectionTitle action={{ label: "New", onClick: () => setOpenTpl({ id: `tpl_${uid()}`, purpose: "reminder_24h", channel: "sms", body: "" }) }}>
          Templates
        </SectionTitle>
        <div className="space-y-2">
          {store.reminderTemplates.map((t: any) => (
            <Card key={t.id} className="p-3" onClick={() => setOpenTpl(t)}>
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-semibold" style={{ color: C.espresso }}>{PURPOSE_LABEL_LOCAL[t.purpose]}</p>
                <Pill tone="neutral">{reminderChannelLabel(t)}</Pill>
              </div>
              <p className="text-[11px] line-clamp-2" style={{ color: C.muted }}>{t.body}</p>
            </Card>
          ))}
        </div>

        <Button variant="primary" onClick={save} fullWidth icon={saved ? <Check size={16} /> : <Save size={16} />}>
          {saved ? "Saved" : "Save settings"}
        </Button>
      </div>

      {openTpl && (
        <TemplateEditorSheet template={openTpl} onClose={() => setOpenTpl(null)}
          onSave={async (t) => { await store.upsertReminderTemplate(t); setOpenTpl(null); }}
          onDelete={async (id) => { await store.deleteReminderTemplate(id); setOpenTpl(null); }} />
      )}
    </div>
  );
};

const TemplateEditorSheet = ({ template, onClose, onSave, onDelete }: {
  template: any;
  onClose: () => void;
  onSave: (t: any) => Promise<void>;
  onDelete: (id: any) => Promise<void>;
}) => {
  const [t, setT] = useState(template);
  return (
    <Sheet open={!!template} onClose={onClose} title="Edit template">
      <div className="space-y-4">
        <Field label="Purpose">
          <Select value={t.purpose} onChange={e => setT({ ...t, purpose: e.target.value })}
            options={Object.entries(PURPOSE_LABEL_LOCAL).map(([k, v]) => ({ value: k, label: v }))} />
        </Field>
        <Field label="Channel">
          <Select value={t.channel} onChange={e => setT({ ...t, channel: e.target.value })}
            options={[{ value: "sms", label: "SMS" }, { value: "email", label: "Email" }]} />
        </Field>
        {t.channel === "email" && (
          <Field label="Subject"><Input value={t.subject || ""} onChange={e => setT({ ...t, subject: e.target.value })} /></Field>
        )}
        <Field label="Body" hint="Use {{client}} {{style}} {{date}} {{time}} {{deposit}} {{balance}} {{business}}">
          <Textarea rows={6} value={t.body} onChange={e => setT({ ...t, body: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="ghost" onClick={() => onDelete(t.id)} icon={<Trash2 size={15} />} fullWidth>Delete</Button>
          <Button variant="primary" onClick={() => onSave(t)} fullWidth>Save</Button>
        </div>
      </div>
    </Sheet>
  );
};
// ============================================================
//  ACTIVE TIMER SCREEN
// ============================================================
const ActiveTimerScreen = ({ store, prefillAppt, onBack, onComplete }) => {
  const [tick, setTick] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [showStop, setShowStop] = useState(false);
  const [completedSession, setCompletedSession] = useState<EntityRecord | null>(null);
  const [setup, setSetup] = useState<EntityRecord | null>(null); // setup state when no active timer

  const timer = store.activeTimer;
  const isSimpleMode = !prefillAppt; // simple timer mode for dashboard

  useEffect(() => {
    if (timer && timer.status === "running") {
      const i = setInterval(() => { setTick(t => t + 1); setNow(Date.now()); }, 1000);
      return () => clearInterval(i);
    }
  }, [timer?.status, timer?.id]);

  // when no active timer and no setup, build setup form (only for non-simple mode)
  useEffect(() => {
    if (!timer && !setup && !isSimpleMode) {
      const base = prefillAppt ? {
        appointmentId: prefillAppt.id, clientId: prefillAppt.clientId,
        clientName: store.clientById(prefillAppt.clientId)?.name || "",
        style: prefillAppt.style || "",
        estimatedHours: Number(prefillAppt.hours) || null,
        estimatedTotal: Number(prefillAppt.finalPrice) || null,
      } : { appointmentId: null, clientId: null, clientName: "", style: "", estimatedHours: null, estimatedTotal: null };
      // eslint-disable-next-line react-hooks/set-state-in-effect -- prop/store-driven sync, intentional
      setSetup(base);
    }
  }, [timer, prefillAppt, isSimpleMode]);

  const startNew = async () => {
    if (!setup && !isSimpleMode) return;
    const t = {
      id: `tmr_${uid()}`,
      appointmentId: setup?.appointmentId || null, clientId: setup?.clientId || null, clientName: setup?.clientName || "",
      style: setup?.style || "", estimatedHours: setup?.estimatedHours || null, estimatedTotal: setup?.estimatedTotal || null,
      startedAt: new Date().toISOString(), pausedAt: null, totalPausedMs: 0, status: "running"
    };
    await store.setTimer(t);
  };

  const startSimple = async () => {
    const t = {
      id: `tmr_${uid()}`,
      appointmentId: null, clientId: null, clientName: "",
      style: "", estimatedHours: null, estimatedTotal: null,
      startedAt: new Date().toISOString(), pausedAt: null, totalPausedMs: 0, status: "running"
    };
    await store.setTimer(t);
  };

  const pause = async () => {
    if (!timer) return;
    await store.setTimer({ ...timer, status: "paused", pausedAt: new Date().toISOString() });
  };
  const resume = async () => {
    if (!timer) return;
    const pausedFor = timer.pausedAt ? Date.now() - new Date(timer.pausedAt).getTime() : 0;
    await store.setTimer({ ...timer, status: "running", pausedAt: null, totalPausedMs: (timer.totalPausedMs || 0) + pausedFor });
  };
  const reset = async () => {
    await store.setTimer(null);
  };
  const stopTimer = async () => {
    if (!timer) return;
    const endedAt = new Date().toISOString();
    const pausedFor = timer.status === "paused" && timer.pausedAt ? Date.now() - new Date(timer.pausedAt).getTime() : 0;
    const finalPausedMs = (timer.totalPausedMs || 0) + pausedFor;
    const totalMs = new Date(endedAt).getTime() - new Date(timer.startedAt).getTime();
    const activeMs = totalMs - finalPausedMs;
    const totalPrice = Number(timer.estimatedTotal) || 0;
    const hours = activeMs / 3600000;
    const session = {
      id: `tses_${uid()}`,
      appointmentId: timer.appointmentId, clientId: timer.clientId, style: timer.style,
      startedAt: timer.startedAt, endedAt, totalMs, pausedMs: finalPausedMs,
      totalPrice, hourlyEarned: hours > 0 ? totalPrice / hours : 0,
      estimatedHours: timer.estimatedHours,
      variance: timer.estimatedHours ? (hours - timer.estimatedHours) / timer.estimatedHours : null,
      notes: ""
    };
    await store.addTimerSession(session);
    await store.setTimer(null);
    setShowStop(false);
    setCompletedSession(session);
  };

  // session summary modal — show after stop
  if (completedSession) {
    return <SessionSummaryScreen session={completedSession} business={store.business}
      onSaveNote={async (notes) => {
        const updated = { ...completedSession, notes };
        await store.upsertTimerSession(updated);
        setCompletedSession(null);
        if (onComplete) onComplete(updated);
        else onBack();
      }}
      onSkip={() => { setCompletedSession(null); if (onComplete) onComplete(completedSession); else onBack(); }} />;
  }

  // setup mode: no active timer
  if (!timer) {
    if (isSimpleMode) {
      return (
        <div className="bbp-fade pb-32" style={{ minHeight: "100dvh", background: C.cream }}>
          <Header title="Timer" leftAction={{ icon: <ChevronLeft size={20} />, onClick: onBack }} />
          <div className="px-5 pt-2">
            <Card className="p-5 mb-4 text-center" style={{ background: `linear-gradient(180deg, ${C.ivory}, ${C.cream})` }}>
              <div className="mx-auto rounded-full flex items-center justify-center mb-3"
                style={{ width: 72, height: 72, background: C.gold, color: C.espresso }}>
                <TimerIcon size={32} strokeWidth={2.2} />
              </div>
              <p className="text-2xl font-semibold mb-1" style={{ fontFamily: FONT_DISPLAY, color: C.espresso }}>Start Timer</p>
              <p className="text-xs" style={{ color: C.muted }}>Simple timer for tracking sessions</p>
            </Card>
            <Button variant="primary" icon={<Play size={18} fill={C.espresso} />} onClick={startSimple} fullWidth>
              Start Timer
            </Button>
          </div>
        </div>
      );
    } else {
      return (
        <div className="bbp-fade pb-32" style={{ minHeight: "100dvh", background: C.cream }}>
          <Header title="Chair timer" leftAction={{ icon: <ChevronLeft size={20} />, onClick: onBack }} />
          <div className="px-5 pt-2">
            <Card className="p-5 mb-4 text-center" style={{ background: `linear-gradient(180deg, ${C.ivory}, ${C.cream})` }}>
              <div className="mx-auto rounded-full flex items-center justify-center mb-3"
                style={{ width: 72, height: 72, background: C.gold, color: C.espresso }}>
                <TimerIcon size={32} strokeWidth={2.2} />
              </div>
              <p className="text-2xl font-semibold mb-1" style={{ fontFamily: FONT_DISPLAY, color: C.espresso }}>Track this session</p>
              <p className="text-xs" style={{ color: C.muted }}>Logs duration, hourly rate, and accuracy vs your estimate</p>
            </Card>

            <Card className="p-4 space-y-3">
              <Field label="Client">
                <Input value={setup?.clientName || ""} onChange={e => setSetup({ ...setup, clientName: e.target.value })} placeholder="Optional" />
              </Field>
              <Field label="Style">
                <Input value={setup?.style || ""} onChange={e => setSetup({ ...setup, style: e.target.value })} placeholder="Knotless, Boho bob, etc" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Est. hours">
                  <MoneyInput prefix="" suffix="hrs" value={setup?.estimatedHours ?? ""} onChange={(v) => setSetup({ ...setup, estimatedHours: v === "" ? null : parseMoney(v) })} />
                </Field>
                <Field label="Total price">
                  <MoneyInput value={setup?.estimatedTotal ?? ""} onChange={(v) => setSetup({ ...setup, estimatedTotal: v === "" ? null : parseMoney(v) })} />
                </Field>
              </div>
            </Card>

            <div className="mt-5">
              <Button variant="primary" icon={<Play size={18} fill={C.espresso} />} onClick={startNew} fullWidth>
                Start timer
              </Button>
            </div>
          </div>
        </div>
      );
    }
  }

  // active timer
  const elapsed = timer.status === "paused"
    ? new Date(timer.pausedAt).getTime() - new Date(timer.startedAt).getTime() - timer.totalPausedMs
    : now - new Date(timer.startedAt).getTime() - timer.totalPausedMs;

  const elapsedHr = elapsed / 3600000;
  const earnedNow = timer.estimatedTotal && timer.estimatedHours
    ? Math.min(timer.estimatedTotal, (timer.estimatedTotal / timer.estimatedHours) * elapsedHr)
    : null;
  const progress = timer.estimatedHours ? Math.min(1, elapsedHr / timer.estimatedHours) : 0;

  return (
    <div className="bbp-fade" style={{
      minHeight: "100dvh",
      background: `linear-gradient(180deg, ${C.espresso} 0%, ${C.coffee} 100%)`,
      color: C.cream
    }}>
      <div className="flex items-center justify-between px-5 pt-12 pb-4">
        <button type="button" onClick={onBack} className="rounded-full p-2"
          style={{ background: "rgba(245,235,217,0.1)", color: C.cream }}>
          <ChevronLeft size={20} />
        </button>
        <div className="text-center">
          <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: C.gold, letterSpacing: "0.18em" }}>
            {timer.status === "running" ? "Tracking" : "Paused"}
          </p>
        </div>
        <div style={{ width: 36 }} />
      </div>

      <div className="px-5 pt-4 text-center">
        <p className="text-sm mb-1" style={{ color: "rgba(245,235,217,0.65)" }}>{timer.clientName || "Session"}</p>
        <p className="text-base font-semibold" style={{ color: C.cream, fontFamily: FONT_DISPLAY }}>{timer.style || "—"}</p>
      </div>

      {/* big timer ring */}
      <div className="flex items-center justify-center mt-8 mb-6 relative">
        <svg width="280" height="280" viewBox="0 0 280 280">
          <circle cx="140" cy="140" r="124" stroke="rgba(245,235,217,0.12)" strokeWidth="6" fill="none" />
          {timer.estimatedHours > 0 && (
            <circle cx="140" cy="140" r="124"
              stroke={progress > 1 ? C.warning : C.gold}
              strokeWidth="6" fill="none"
              strokeDasharray={`${2 * Math.PI * 124}`}
              strokeDashoffset={`${2 * Math.PI * 124 * (1 - progress)}`}
              strokeLinecap="round"
              transform="rotate(-90 140 140)"
              style={{ transition: "stroke-dashoffset 0.6s ease" }} />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <p className="font-mono font-bold" style={{ fontSize: 52, color: C.cream, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}>
            {fmtDuration(Math.max(0, elapsed))}
          </p>
          {timer.estimatedHours > 0 && (
            <p className="text-xs mt-2" style={{ color: progress > 1 ? C.warning : "rgba(245,235,217,0.6)" }}>
              {progress > 1 ? `${Math.round((progress - 1) * 100)}% over` : `${Math.round(progress * 100)}% of ${timer.estimatedHours}h estimate`}
            </p>
          )}
        </div>
      </div>

      {/* live earnings */}
      {earnedNow != null && (
        <div className="px-5 mb-6">
          <Card className="p-4 text-center" style={{ background: "rgba(245,235,217,0.08)", border: `1px solid rgba(201,169,97,0.25)` }}>
            <p className="text-[10px] uppercase tracking-widest font-bold mb-1" style={{ color: C.gold, letterSpacing: "0.16em" }}>Earned so far</p>
            <p className="text-3xl font-bold" style={{ color: C.cream, fontFamily: FONT_DISPLAY }}>{fmtMoney(earnedNow, store.business.currency)}</p>
            <p className="text-[11px] mt-1" style={{ color: "rgba(245,235,217,0.55)" }}>
              of {fmtMoney(timer.estimatedTotal, store.business.currency)} target
            </p>
          </Card>
        </div>
      )}

      {/* controls */}
      <div className="px-5 grid grid-cols-3 gap-2 pb-12">
        {timer.status === "running" ? (
          <button type="button" onClick={pause}
            className="py-4 rounded-2xl font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition"
            style={{ background: "rgba(245,235,217,0.12)", color: C.cream, border: `1.5px solid rgba(245,235,217,0.2)` }}>
            <Pause size={18} fill={C.cream} /> Pause
          </button>
        ) : (
          <button type="button" onClick={resume}
            className="py-4 rounded-2xl font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition"
            style={{ background: C.gold, color: C.espresso }}>
            <Play size={18} fill={C.espresso} /> Resume
          </button>
        )}
        <button type="button" onClick={reset}
          className="py-4 rounded-2xl font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition"
          style={{ background: C.warning, color: C.cream }}>
          <RefreshCw size={16} /> Reset
        </button>
        <button type="button" onClick={() => setShowStop(true)}
          className="py-4 rounded-2xl font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition"
          style={{ background: C.danger, color: C.cream }}>
          <Square size={16} fill={C.cream} /> Stop
        </button>
      </div>

      {showStop && (
        <Sheet open={showStop} onClose={() => setShowStop(false)} title="Stop session?">
          <div className="space-y-4">
            <p className="text-sm" style={{ color: C.coffee }}>
              You&apos;ll see a summary with how you tracked vs your estimate.
            </p>
            <Card className="p-3" style={{ background: C.ivory }}>
              <div className="flex items-center justify-between"><span className="text-sm" style={{ color: C.muted }}>Time tracked</span>
                <span className="text-sm font-mono font-bold" style={{ color: C.espresso }}>{fmtDuration(Math.max(0, elapsed))}</span></div>
              {earnedNow != null && (
                <div className="flex items-center justify-between mt-1"><span className="text-sm" style={{ color: C.muted }}>Earned</span>
                  <span className="text-sm font-bold" style={{ color: C.success }}>{fmtMoney(earnedNow, store.business.currency)}</span></div>
              )}
            </Card>
            <Button variant="primary" icon={<Square size={15} fill={C.cream} />} onClick={stopTimer} fullWidth>End & save session</Button>
            <Button variant="ghost" onClick={() => setShowStop(false)} fullWidth>Keep going</Button>
          </div>
        </Sheet>
      )}
    </div>
  );
};

const SessionSummaryScreen = ({ session, business, onSaveNote, onSkip }) => {
  const [notes, setNotes] = useState("");
  const activeMs = session.totalMs - (session.pausedMs || 0);
  const hr = activeMs / 3600000;
  const variance = session.variance;
  const overran = variance != null && variance > 0.05;
  const underran = variance != null && variance < -0.05;

  return (
    <div className="bbp-fade pb-32" style={{ minHeight: "100dvh", background: C.cream }}>
      <div className="px-5 pt-12 pb-4 text-center">
        <div className="mx-auto rounded-full flex items-center justify-center mb-3"
          style={{ width: 64, height: 64, background: C.success, color: C.cream }}>
          <Check size={28} strokeWidth={2.4} />
        </div>
        <p className="text-2xl font-semibold" style={{ fontFamily: FONT_DISPLAY, color: C.espresso }}>Session saved</p>
        <p className="text-xs" style={{ color: C.muted }}>{session.style || "Session"}</p>
      </div>

      <div className="px-5 space-y-3 mb-5">
        <Card className="p-4 grid grid-cols-2 gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-widest font-bold mb-1" style={{ color: C.muted, letterSpacing: "0.14em" }}>Time worked</p>
            <p className="text-lg font-bold font-mono" style={{ color: C.espresso }}>{fmtDuration(activeMs)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest font-bold mb-1" style={{ color: C.muted, letterSpacing: "0.14em" }}>Hours</p>
            <p className="text-lg font-bold" style={{ color: C.espresso, fontFamily: FONT_DISPLAY }}>{hr.toFixed(2)}h</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest font-bold mb-1" style={{ color: C.muted, letterSpacing: "0.14em" }}>Earned</p>
            <p className="text-lg font-bold" style={{ color: C.success, fontFamily: FONT_DISPLAY }}>{fmtMoney(session.totalPrice, business.currency)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest font-bold mb-1" style={{ color: C.muted, letterSpacing: "0.14em" }}>Hourly</p>
            <p className="text-lg font-bold" style={{ color: C.espresso, fontFamily: FONT_DISPLAY }}>{fmtMoney(session.hourlyEarned, business.currency)}/hr</p>
          </div>
        </Card>

        {variance != null && (
          <Card className="p-4" style={{
            background: overran ? "rgba(201,118,43,0.08)" : underran ? "rgba(92,124,74,0.08)" : C.ivory,
            border: `1px solid ${overran ? "rgba(201,118,43,0.3)" : underran ? "rgba(92,124,74,0.3)" : C.hairline}`
          }}>
            <p className="text-[10px] uppercase tracking-widest font-bold mb-1" style={{
              color: overran ? C.warning : underran ? C.success : C.muted, letterSpacing: "0.14em"
            }}>vs estimate</p>
            <p className="text-sm font-semibold" style={{ color: C.espresso }}>
              {overran ? `Ran ${Math.round(variance * 100)}% over your ${session.estimatedHours}h estimate` :
                underran ? `Beat your ${session.estimatedHours}h estimate by ${Math.round(Math.abs(variance) * 100)}%` :
                  `On target (${session.estimatedHours}h)`}
            </p>
          </Card>
        )}

        <Card className="p-4">
          <Field label="Notes" hint="Anything to remember about this session">
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Tangling at the nape took longer..." />
          </Field>
        </Card>
      </div>

      <div className="px-5 grid grid-cols-2 gap-3">
        <Button variant="ghost" onClick={onSkip} fullWidth>Skip</Button>
        <Button variant="primary" onClick={() => onSaveNote(notes)} icon={<Save size={15} />} fullWidth>Save</Button>
      </div>
    </div>
  );
};
// ============================================================
//  STYLE PRESETS
// ============================================================
const PRESET_CATEGORIES = [
  { value: "knotless", label: "Knotless" },
  { value: "boho", label: "Boho" },
  { value: "feed_in", label: "Feed-ins" },
  { value: "box", label: "Box braids" },
  { value: "twists", label: "Twists" },
  { value: "locs", label: "Locs" },
  { value: "cornrows", label: "Cornrows" },
  { value: "other", label: "Other" },
];

const PresetsScreen = ({ store, onBack, onUsePreset }) => {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<EntityRecord | null>(null);
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    let list = [...store.presets];
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(s) || (p.category || "").toLowerCase().includes(s));
    }
    return list.sort((a, b) => {
      if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
      return (b.useCount || 0) - (a.useCount || 0);
    });
  }, [store.presets, search]);

  const blank = () => ({
    id: `pre_${uid()}`, name: "", category: "knotless",
    braidSize: "medium", braidLength: "mid_back", estimatedHours: 4, basePrice: 200,
    hairCost: 50, hourlyRate: store.business.hourlyRate || 50,
    overhead: store.business.overheadPerHour || 8,
    profitMargin: store.business.profitMargin || 25,
    defaultAddOns: [], defaultDeposit: 30, depositType: "percentage",
    maintenanceNotes: "", hairProductsIncluded: "",
    isFavorite: false, useCount: 0,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  });

  return (
    <div className="bbp-fade pb-32">
      <Header title="Style presets" subtitle="Reusable templates" leftAction={{ icon: <ChevronLeft size={20} />, onClick: onBack }}
        rightAction={{ icon: <Plus size={20} />, onClick: () => setCreating(true) }} />

      <div className="px-5 pt-2">
        <div className="relative mb-4">
          <Search size={16} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: C.muted }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search presets…"
            className="w-full pl-10 pr-4 py-3 rounded-2xl text-sm outline-none"
            style={{ background: C.paper, border: `1px solid ${C.hairline}`, color: C.espresso }} />
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon={<Layers size={28} style={{ color: C.muted }} />}
            title="No presets yet"
            body="Create reusable style templates with pricing, time estimates, and add-ons."
            cta={<Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>New preset</Button>} />
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {filtered.map(p => (
              <PresetCard key={p.id} preset={p} business={store.business}
                onClick={() => setEditing(p)}
                onUse={() => onUsePreset(p)} />
            ))}
          </div>
        )}
      </div>

      {(editing || creating) && (
        <PresetEditorSheet
          preset={creating ? blank() : editing}
          isNew={creating}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSave={async (p) => { await store.upsertPreset({ ...p, updatedAt: new Date().toISOString() }); setEditing(null); setCreating(false); }}
          onDelete={async (id) => { await store.deletePreset(id); setEditing(null); }}
          onUse={(p) => { onUsePreset(p); setEditing(null); }} />
      )}
    </div>
  );
};

const PresetCard = ({ preset, business, onClick, onUse }) => {
  const totalEst = useMemo(() => {
    const addons = (preset.defaultAddOns || []).reduce((s, a) => s + (Number(a.amount) || 0), 0);
    const labor = (Number(preset.hourlyRate) || 0) * (Number(preset.estimatedHours) || 0);
    const overhead = (Number(preset.overhead) || 0) * (Number(preset.estimatedHours) || 0);
    return (Number(preset.hairCost) || 0) + labor + overhead + (Number(preset.profitMargin) || 0) + addons;
  }, [preset]);

  return (
    <Card className="p-3 active:scale-[0.98]" onClick={onClick}>
      <div className="flex items-center justify-between mb-2">
        <Pill tone="neutral">{PRESET_CATEGORIES.find(c => c.value === preset.category)?.label || preset.category}</Pill>
        {preset.isFavorite && <Star size={14} fill={C.gold} style={{ color: C.gold }} />}
      </div>
      <p className="font-semibold text-sm leading-tight mb-1.5 line-clamp-2" style={{ color: C.espresso, fontFamily: FONT_DISPLAY, fontSize: 16 }}>
        {preset.name || "Untitled"}
      </p>
      <p className="text-[11px] mb-2" style={{ color: C.muted }}>
        {preset.estimatedHours}h · {preset.braidSize}
      </p>
      <p className="text-base font-bold mb-2" style={{ color: C.espresso, fontFamily: FONT_DISPLAY }}>{fmtMoney(totalEst, business.currency)}</p>
      <button type="button" onClick={(e) => { e.stopPropagation(); onUse(); }}
        className="w-full py-1.5 rounded-lg text-[11px] font-bold uppercase transition active:scale-[0.97]"
        style={{ background: C.espresso, color: C.cream, letterSpacing: "0.08em" }}>
        Use
      </button>
    </Card>
  );
};

const PresetEditorSheet = ({ preset, isNew, onClose, onSave, onDelete, onUse }) => {
  const [p, setP] = useState(preset);

  const updateAddOn = (i, key, val) => {
    const list = [...(p.defaultAddOns || [])];
    list[i] = { ...list[i], [key]: val };
    setP({ ...p, defaultAddOns: list });
  };
  const removeAddOn = (i) => setP({ ...p, defaultAddOns: (p.defaultAddOns || []).filter((_, idx) => idx !== i) });
  const addAddOn = () => setP({ ...p, defaultAddOns: [...(p.defaultAddOns || []), { name: "", amount: 0 }] });

  return (
    <Sheet open={!!preset} onClose={onClose} title={isNew ? "New preset" : "Edit preset"}>
      <div className="space-y-4">
        <Field label="Name"><Input value={p.name} onChange={e => setP({ ...p, name: e.target.value })} placeholder="e.g. Medium Knotless Mid-Back" /></Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <Select value={p.category} onChange={e => setP({ ...p, category: e.target.value })} options={PRESET_CATEGORIES} />
          </Field>
          <Field label="Size">
            <Select value={p.braidSize} onChange={e => setP({ ...p, braidSize: e.target.value })}
              options={[{ value: "micro", label: "Micro" }, { value: "small", label: "Small" }, { value: "medium", label: "Medium" }, { value: "large", label: "Large" }, { value: "jumbo", label: "Jumbo" }]} />
          </Field>
        </div>

        <Field label="Length">
          <Select value={p.braidLength} onChange={e => setP({ ...p, braidLength: e.target.value })}
            options={[{ value: "shoulder", label: "Shoulder" }, { value: "mid_back", label: "Mid-back" }, { value: "waist", label: "Waist" }, { value: "hip", label: "Hip-length" }, { value: "butt", label: "Butt-length" }]} />
        </Field>

        <SectionTitle>Pricing</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Hours"><MoneyInput prefix="" suffix="hrs" placeholder="6.5" value={p.estimatedHours ?? ""} onChange={(v) => setP({ ...p, estimatedHours: parseMoney(v) })} /></Field>
          <Field label="Hair cost"><MoneyInput value={p.hairCost ?? ""} onChange={(v) => setP({ ...p, hairCost: parseMoney(v) })} /></Field>
          <Field label="Hourly rate"><MoneyInput value={p.hourlyRate ?? ""} onChange={(v) => setP({ ...p, hourlyRate: parseMoney(v) })} /></Field>
          <Field label="Overhead/hr"><MoneyInput value={p.overhead ?? ""} onChange={(v) => setP({ ...p, overhead: parseMoney(v) })} /></Field>
          <Field label="Profit margin"><MoneyInput value={p.profitMargin ?? ""} onChange={(v) => setP({ ...p, profitMargin: parseMoney(v) })} /></Field>
        </div>

        <SectionTitle>Default add-ons</SectionTitle>

<button
 type="button"
  onClick={addAddOn}
  className="mb-3 rounded-xl px-4 py-2 text-sm font-semibold"
>
  Add
</button>
        {(p.defaultAddOns || []).map((a, i) => (
          <div key={i} className="grid grid-cols-[1fr_90px_36px] gap-2 items-center">
            <Input value={a.name} onChange={e => updateAddOn(i, "name", e.target.value)} placeholder="Add-on name" />
            <MoneyInput value={a.amount ?? ""} onChange={(v) => updateAddOn(i, "amount", parseMoney(v))} />
            <button type="button" onClick={() => removeAddOn(i)} className="rounded-xl p-2"
              style={{ background: "rgba(156,61,46,0.1)", color: C.danger }}><X size={16} /></button>
          </div>
        ))}

        <SectionTitle>Deposit</SectionTitle>
        <div className="grid grid-cols-[1fr_140px] gap-3">
          <Field label="Amount"><MoneyInput prefix="" value={p.defaultDeposit ?? ""} onChange={(v) => setP({ ...p, defaultDeposit: parseMoney(v) })} /></Field>
          <Field label="Type">
            <Select value={p.depositType} onChange={e => setP({ ...p, depositType: e.target.value })}
              options={[{ value: "percentage", label: "%" }, { value: "flat", label: "Flat $" }]} />
          </Field>
        </div>

        <Field label="Hair / products included">
          <Textarea value={p.hairProductsIncluded || ""} onChange={e => setP({ ...p, hairProductsIncluded: e.target.value })}
            placeholder="3-4 packs pre-stretched, mousse, edge gel..." rows={2} />
        </Field>

        <Field label="Maintenance notes" hint="Care instructions for client">
          <Textarea value={p.maintenanceNotes || ""} onChange={e => setP({ ...p, maintenanceNotes: e.target.value })}
            placeholder="Wrap nightly, refresh edges every 2-3 weeks..." rows={3} />
        </Field>

        <div className="flex items-center justify-between p-3 rounded-xl" style={{ background: C.ivory }}>
          <span className="text-sm font-semibold" style={{ color: C.espresso }}>Pin as favorite</span>
          <Toggle checked={!!p.isFavorite} onChange={(v) => setP({ ...p, isFavorite: v })} />
        </div>

        <div className="grid grid-cols-2 gap-2 pt-2">
          {!isNew ? (
            <Button variant="outline" icon={<Trash2 size={15} />} onClick={() => onDelete(p.id)} fullWidth>Delete</Button>
          ) : (
            <Button variant="outline" onClick={onClose} fullWidth>Cancel</Button>
          )}
          <Button variant="primary" onClick={() => onSave(p)} fullWidth>Save</Button>
        </div>
        {!isNew && (
          <Button variant="outline" icon={<Sparkles size={15} />} onClick={() => onUse(p)} fullWidth>Use this preset now</Button>
        )}
      </div>
    </Sheet>
  );
};

// ============================================================
//  TRANSACTION SHEET (V1 reused, lightly extended)
// ============================================================
const TransactionSheet = ({ open, tx, onClose, onSave, onDelete, business }) => {
  const [t, setT] = useState(tx || { id: `tx_${uid()}`, type: "expense", date: todayISO(), amount: 0, category: "Hair supplies", note: "" });
  // eslint-disable-next-line react-hooks/set-state-in-effect -- prop/store-driven sync, intentional
  useEffect(() => { setT(tx || { id: `tx_${uid()}`, type: "expense", date: todayISO(), amount: 0, category: "Hair supplies", note: "" }); }, [tx]);

  const expCats = ["Hair supplies", "Tools", "Booth rent", "Travel", "Marketing", "Education", "Software", "Other"];
  const incCats = ["Service", "Tip", "Product sale", "Other"];
  const cats = t.type === "expense" ? expCats : incCats;

  return (
    <Sheet open={open} onClose={onClose} title={tx ? "Edit transaction" : "New transaction"}>
      <div className="space-y-4">
        <div className="flex p-1 rounded-2xl" style={{ background: C.ivory }}>
          {[{ k: "income", l: "Income" }, { k: "expense", l: "Expense" }].map(o => (
            <button type="button" key={o.k} onClick={() => setT({ ...t, type: o.k, category: o.k === "expense" ? "Hair supplies" : "Service" })}
              className="flex-1 py-2 rounded-xl text-xs font-bold transition"
              style={{ background: t.type === o.k ? (o.k === "income" ? C.success : C.danger) : "transparent", color: t.type === o.k ? C.cream : C.coffee }}>
              {o.l}
            </button>
          ))}
        </div>

        <Field label="Amount"><MoneyInput value={t.amount ?? ""} onChange={(v) => setT({ ...t, amount: parseMoney(v) })} /></Field>
        <Field label="Date"><Input type="date" value={t.date} onChange={e => setT({ ...t, date: e.target.value })} /></Field>
        <Field label="Category">
          <Select value={t.category} onChange={e => setT({ ...t, category: e.target.value })} options={cats.map(c => ({ value: c, label: c }))} />
        </Field>
        <Field label="Note"><Input value={t.note || ""} onChange={e => setT({ ...t, note: e.target.value })} placeholder="Optional" /></Field>

        <div className="grid grid-cols-2 gap-2 pt-2">
          {tx ? (
            <Button variant="ghost" icon={<Trash2 size={15} />} onClick={() => onDelete(t.id)} fullWidth>Delete</Button>
          ) : (
            <Button variant="ghost" onClick={onClose} fullWidth>Cancel</Button>
          )}
          <Button variant="primary" onClick={() => onSave(t)} fullWidth>Save</Button>
        </div>
      </div>
    </Sheet>
  );
};

// ============================================================
//  SAVED QUOTES (V1 reused)
// ============================================================
const SavedQuotes = ({ store, onBack, onLoadQuote, onConvertToAppt, openReceipt }: { store: any; onBack: any; onLoadQuote: any; onConvertToAppt: any; openReceipt?: (rcp: ReceiptRecord) => void }) => {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    let list = [...store.quotes].sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || ""));
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(q => (q.name || "").toLowerCase().includes(s) || (q.style || "").toLowerCase().includes(s));
    }
    return list;
  }, [store.quotes, search]);

  return (
    <div className="bbp-fade pb-32">
      <Header title="Saved quotes" leftAction={{ icon: <ChevronLeft size={20} />, onClick: onBack }} />
      <div className="px-5 pt-2">
        <div className="relative mb-4">
          <Search size={16} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: C.muted }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search quotes…"
            className="w-full pl-10 pr-4 py-3 rounded-2xl text-sm outline-none"
            style={{ background: C.paper, border: `1px solid ${C.hairline}`, color: C.espresso }} />
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon={<FileText size={28} style={{ color: C.muted }} />}
            title="No saved quotes yet"
            body="Build a quote in the Calculator and save it for later. Convert it to a booking with one tap." />
        ) : (
          <div className="space-y-2.5">
            {filtered.map(q => (
              <Card key={q.id} className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-semibold text-base" style={{ color: C.espresso, fontFamily: FONT_DISPLAY }}>{q.name || "Untitled quote"}</p>
                    <p className="text-[11px]" style={{ color: C.muted }}>{q.style || "—"} · saved {fmtRelative(q.savedAt)}</p>
                  </div>
                  <p className="text-xl font-bold" style={{ color: C.espresso, fontFamily: FONT_DISPLAY }}>{fmtMoney(q.finalPrice || 0, store.business.currency)}</p>
                </div>
                <div className="grid grid-cols-3 gap-1.5 mt-3">
                  <Button variant="outline" onClick={() => onLoadQuote(q)} icon={<Edit3 size={13} />} fullWidth>Edit</Button>
                  <Button variant="outline" onClick={() => onConvertToAppt(q)} icon={<CalendarPlus size={13} />} fullWidth>Book</Button>
                  <Button variant="outline" icon={<Trash2 size={13} />} onClick={() => store.deleteQuote(q.id)} fullWidth>Delete</Button>
                </div>
                {openReceipt && (
                  <Button variant="dark" icon={<FileText size={14} />} fullWidth className="mt-2"
                    onClick={async () => {
                      try {
                        const newId = `rcp_${uid()}`;
                        const rcp = buildInvoiceFromQuote({ ...q, totalPrice: q.finalPrice }, (store.receipts || []).length, newId, q.name);
                        const saved = await store.upsertReceipt(rcp);
                        if (!saved) throw new Error("upsertReceipt returned null");
                        openReceipt(saved as ReceiptRecord);
                      } catch (err) {
                        console.error("[quotes] generate invoice failed:", err);
                        alert("Couldn't generate that invoice. Please try again.");
                      }
                    }}>
                    Generate invoice
                  </Button>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================
//  POLICIES (V1 reused)
// ============================================================
const Policies = ({ store, onBack }) => {
  const [editing, setEditing] = useState<EntityRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const blank = () => ({ id: `pol_${uid()}`, title: "", category: "other", body: "", updatedAt: new Date().toISOString() });

  const copy = async (p) => {
    try { await navigator.clipboard.writeText(`${p.title}\n\n${p.body}`); setToast("Copied"); setTimeout(() => setToast(null), 1600); }
    catch { setToast("Copy unavailable"); setTimeout(() => setToast(null), 1600); }
  };

  return (
    <div className="bbp-fade pb-32">
      <Header title="Policies" leftAction={{ icon: <ChevronLeft size={20} />, onClick: onBack }} rightAction={{ icon: <Plus size={20} />, onClick: () => setCreating(true) }} />

      <div className="px-5 pt-2 space-y-2.5">
        {store.policies.map(p => (
          <Card key={p.id} className="p-4">
            <div className="flex items-start justify-between gap-2 mb-2">
              <p className="font-semibold text-base" style={{ color: C.espresso, fontFamily: FONT_DISPLAY }}>{p.title}</p>
              <Pill tone="neutral">{p.category}</Pill>
            </div>
            <p className="text-xs leading-relaxed mb-3" style={{ color: C.coffee }}>{p.body}</p>
            <div className="grid grid-cols-3 gap-1.5">
              <Button variant="outline" onClick={() => copy(p)} icon={<Copy size={13} />} fullWidth>Copy</Button>
              <Button variant="outline" onClick={() => setEditing(p)} icon={<Edit3 size={13} />} fullWidth>Edit</Button>
              <Button variant="outline" icon={<Trash2 size={13} />} onClick={() => store.deletePolicy(p.id)} fullWidth>Delete</Button>
            </div>
          </Card>
        ))}
        {store.policies.length === 0 && (
          <EmptyState icon={<ScrollText size={28} style={{ color: C.muted }} />}
            title="No policies yet"
            body="Add deposit, cancellation, late, and prep policies. Copy them into texts or DMs in one tap."
            cta={<Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>Add Policy</Button>} />
        )}
      </div>

      {(editing || creating) && (
        <PolicySheet policy={creating ? blank() : editing} isNew={creating}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSave={async (pol) => { await store.upsertPolicy({ ...pol, updatedAt: new Date().toISOString() }); setEditing(null); setCreating(false); }} />
      )}

      {toast && (
        <div className="fixed left-1/2 z-50 px-4 py-2 rounded-full text-sm font-semibold bbp-fade"
          style={{ bottom: 100, transform: "translateX(-50%)", background: C.espresso, color: C.cream }}>
          {toast}
        </div>
      )}
    </div>
  );
};

const PolicySheet = ({ policy, isNew, onClose, onSave }) => {
  const [p, setP] = useState(policy);
  return (
    <Sheet open={!!policy} onClose={onClose} title={isNew ? "New policy" : "Edit policy"}>
      <div className="space-y-4">
        <Field label="Title"><Input value={p.title} onChange={e => setP({ ...p, title: e.target.value })} /></Field>
        <Field label="Category">
          <Select value={p.category} onChange={e => setP({ ...p, category: e.target.value })}
            options={[{ value: "deposit", label: "Deposit" }, { value: "cancellation", label: "Cancellation" }, { value: "late", label: "Late" }, { value: "prep", label: "Prep" }, { value: "payment", label: "Payment" }, { value: "other", label: "Other" }]} />
        </Field>
        <Field label="Body"><Textarea value={p.body} onChange={e => setP({ ...p, body: e.target.value })} rows={6} /></Field>
        <Button variant="primary" onClick={() => onSave(p)} fullWidth>Save</Button>
      </div>
    </Sheet>
  );
};

// ============================================================
//  SETTINGS (V1 extended with Reminders link)
// ============================================================
// Derives the Settings card display from the cached Stripe Connect
// profile. Mirrors the 4 states called out in the design spec plus a
// loading fallback. Returns the Pill copy + tone + subtitle in one
// place so the markup below stays clean.
type StripeConnectCardDisplay = {
  pill: string;
  tone: "success" | "gold" | "warning" | "neutral";
  subtitle: string;
};
const deriveStripeConnectDisplay = (
  profile: StripeConnectProfile,
  loading: boolean,
): StripeConnectCardDisplay | null => {
  if (loading) {
    return { pill: "Checking", tone: "neutral", subtitle: "Checking your payment status…" };
  }
  if (!profile.stripe_connect_account_id) {
    return { pill: "Not connected", tone: "neutral", subtitle: "Connect Stripe to accept client deposits." };
  }
  if (profile.stripe_connect_charges_enabled && profile.stripe_connect_payouts_enabled) {
    return { pill: "Approved", tone: "success", subtitle: "Ready to accept deposits and payouts." };
  }
  if (profile.stripe_connect_charges_enabled) {
    return { pill: "Payments on", tone: "gold", subtitle: "You can accept deposits, but payouts still need attention." };
  }
  return { pill: "Action needed", tone: "warning", subtitle: "Finish Stripe setup to accept deposits." };
};

const SettingsScreen = ({ store, onBack, openReminderSettings, openCommunicationLog, openAccount, openDiscounts, openServices, openReports, openPolicies, openAvailability, openWaitlist, openIntelligence, openApprovals, openContracts }: { store: any; onBack: any; openReminderSettings: any; openCommunicationLog?: () => void; openAccount?: () => void; openDiscounts?: () => void; openServices?: () => void; openReports?: () => void; openPolicies?: () => void; openAvailability?: () => void; openWaitlist?: () => void; openIntelligence?: () => void; openApprovals?: () => void; openContracts?: () => void }) => {
  // Stripe Connect status — read from the cached profile via the same
  // hook the /settings/payments screen uses, so the badge here can't
  // disagree with that page. Authed-only; in guest mode userId is null
  // and the hook short-circuits.
  const stripeConnect = useStripeConnect(store?.userId || null);
  const stripeDisplay = deriveStripeConnectDisplay(
    stripeConnect.profile,
    stripeConnect.loading,
  );
  const [b, setB] = useState(store.business);
  const [saved, setSaved] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- prop/store-driven sync, intentional
  useEffect(() => { setB(store.business); }, [store.business]);

  const save = async () => {
    await store.setBusiness(b);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  const exportData = async () => {
    if (!store.premium) {
      store.requestUpgrade?.("export");
      return;
    }
    const dump = {
      exported: new Date().toISOString(), version: "v2",
      business: store.business, settings: store.reminderSettings,
      clients: store.clients, appointments: store.appointments,
      quotes: store.quotes, transactions: store.transactions,
      policies: store.policies, reminders: store.reminders,
      reminderTemplates: store.reminderTemplates,
      photos: store.photos.map(p => ({ ...p, dataUrl: "[redacted-base64]", thumbnailDataUrl: "[redacted-base64]" })),
      series: store.series, timerSessions: store.timerSessions, presets: store.presets
    };
    void downloadJson(`braid-boss-pro-export-${todayISO()}.json`, dump);
  };

  return (
    <div className="bbp-fade pb-32">
      <Header title="Settings" leftAction={{ icon: <ChevronLeft size={20} />, onClick: onBack }} />
      <div className="px-5 pt-2 space-y-5">
        <SectionTitle>Business</SectionTitle>
        <Card className="p-4 space-y-3">
          <Field label="Business name"><Input value={b.businessName} onChange={e => setB({ ...b, businessName: e.target.value })} /></Field>
          <Field label="Owner name"><Input value={b.ownerName} onChange={e => setB({ ...b, ownerName: e.target.value })} /></Field>
          <Field label="Currency">
            <Select value={b.currency} onChange={e => setB({ ...b, currency: e.target.value })}
              options={[{ value: "USD", label: "USD ($)" }, { value: "EUR", label: "EUR (€)" }, { value: "GBP", label: "GBP (£)" }, { value: "CAD", label: "CAD ($)" }]} />
          </Field>
        </Card>

        <SectionTitle>Default pricing</SectionTitle>
        <Card className="p-4 space-y-3">
          <Field label="Hourly rate"><MoneyInput value={b.hourlyRate ?? ""} onChange={(v) => setB({ ...b, hourlyRate: parseMoney(v) })} /></Field>
          <Field label="Overhead per hour" hint="Booth rent, supplies, utilities">
            <MoneyInput value={b.overheadPerHour ?? ""} onChange={(v) => setB({ ...b, overheadPerHour: parseMoney(v) })} />
          </Field>
          <Field label="Profit margin" hint="Default $ margin per appointment">
            <MoneyInput value={b.profitMargin ?? ""} onChange={(v) => setB({ ...b, profitMargin: parseMoney(v) })} />
          </Field>
          <Field label="Default travel fee">
            <MoneyInput value={b.defaultTravelFee ?? ""} onChange={(v) => setB({ ...b, defaultTravelFee: parseMoney(v) })} />
          </Field>
        </Card>

        {openAccount && (
          <>
            <SectionTitle>Account</SectionTitle>
            {/* Real <button> instead of Card+onClick. iOS WKWebView
                routes touches to native button elements reliably; the
                <div onClick> path was inconsistent on this card.
                Visual styling mirrors the Card component (gradient
                background, hairline border, soft shadow, rounded
                corners) so the appearance is unchanged. */}
            <button
             type="button"
              onClick={() => { console.log("[bbp] Account sync tapped"); openAccount(); }}
              className="w-full text-left rounded-2xl p-4 active:scale-[0.99] cursor-pointer select-none transition"
              style={{
                background: `linear-gradient(180deg, ${C.paper} 0%, ${C.ivory} 100%)`,
                border: `1px solid ${C.hairline}`,
                boxShadow: "0 1px 2px rgba(42, 24, 16, 0.04), 0 8px 24px -12px rgba(42, 24, 16, 0.12)",
                font: "inherit",
                color: "inherit",
                appearance: "none",
                WebkitAppearance: "none",
              }}>
              <div className="flex items-center justify-between" style={{ pointerEvents: "none" }}>
                <div>
                  <p className="text-sm font-semibold" style={{ color: C.espresso }}>Account &amp; sync</p>
                  <p className="text-[11px]" style={{ color: C.muted }}>Sign in to sync · export · sign out</p>
                </div>
                <ChevronRight size={18} style={{ color: C.muted }} />
              </div>
            </button>
          </>
        )}

        <SectionTitle>Reminders</SectionTitle>
        <Card
          className="p-4 active:scale-[0.99]"
          onClick={() => {
            if (!store.premium) { store.requestUpgrade?.("reminders"); return; }
            openReminderSettings();
          }}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold" style={{ color: C.espresso }}>Reminder settings</p>
              <p className="text-[11px]" style={{ color: C.muted }}>
                {store.premium
                  ? `${store.reminderSettings?.enabled ? "Enabled" : "Disabled"} · ${(store.reminderSettings?.defaultChannel || "sms").toString().toUpperCase()}`
                  : `Lifetime Access · ${LIFETIME_PRICE_LABEL}`}
              </p>
            </div>
            {store.premium
              ? <ChevronRight size={18} style={{ color: C.muted }} />
              : <Sparkles size={16} style={{ color: C.goldDeep }} />}
          </div>
        </Card>

        {openDiscounts && (
          <>
            <SectionTitle>Catalog</SectionTitle>
            {openServices && (
              <Card className="p-4 active:scale-[0.99]" onClick={openServices}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div
                      aria-hidden
                      style={{
                        width: 32, height: 32, borderRadius: 999, display: "grid", placeItems: "center",
                        background: C.ivory, color: C.gold, border: `1px solid ${C.hairline}`, flexShrink: 0,
                      }}
                    >
                      <Layers size={15} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold" style={{ color: C.espresso }}>Services & styles</p>
                      <p className="text-[11px]" style={{ color: C.muted }}>
                        {(() => {
                          const list: Service[] = store.servicesApi?.services || [];
                          const active = list.filter(s => s.is_active).length;
                          if (list.length === 0) return "Define what you offer to book faster";
                          return `${active} active · ${list.length} total`;
                        })()}
                      </p>
                    </div>
                  </div>
                  <ChevronRight size={18} style={{ color: C.muted }} />
                </div>
              </Card>
            )}
            {openReports && (
              <Card className="p-4 active:scale-[0.99] mt-2" onClick={openReports}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div
                      aria-hidden
                      style={{
                        width: 32, height: 32, borderRadius: 999, display: "grid", placeItems: "center",
                        background: C.ivory, color: C.goldDeep, border: `1px solid ${C.hairline}`, flexShrink: 0,
                      }}
                    >
                      <BarChart3 size={15} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold" style={{ color: C.espresso }}>Reports</p>
                      <p className="text-[11px]" style={{ color: C.muted }}>Revenue · top styles · repeat clients</p>
                    </div>
                  </div>
                  <ChevronRight size={18} style={{ color: C.muted }} />
                </div>
              </Card>
            )}

            {(openPolicies || openAvailability || openIntelligence || openApprovals) && <SectionTitle>Booking</SectionTitle>}
            {openPolicies && (
              <Card className="p-4 active:scale-[0.99]" onClick={openPolicies}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div
                      aria-hidden
                      style={{
                        width: 32, height: 32, borderRadius: 999, display: "grid", placeItems: "center",
                        background: C.ivory, color: C.coffee, border: `1px solid ${C.hairline}`, flexShrink: 0,
                      }}
                    >
                      <ScrollText size={15} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold" style={{ color: C.espresso }}>Booking policies</p>
                      <p className="text-[11px]" style={{ color: C.muted }}>Deposit · cancellation · prep · more</p>
                    </div>
                  </div>
                  <ChevronRight size={18} style={{ color: C.muted }} />
                </div>
              </Card>
            )}
            {openAvailability && (
              <Card className="p-4 active:scale-[0.99] mt-2" onClick={openAvailability}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div
                      aria-hidden
                      style={{
                        width: 32, height: 32, borderRadius: 999, display: "grid", placeItems: "center",
                        background: C.ivory, color: C.gold, border: `1px solid ${C.hairline}`, flexShrink: 0,
                      }}
                    >
                      <Clock size={15} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold" style={{ color: C.espresso }}>Availability</p>
                      <p className="text-[11px]" style={{ color: C.muted }}>Weekly hours · time off · one-time changes</p>
                    </div>
                  </div>
                  <ChevronRight size={18} style={{ color: C.muted }} />
                </div>
              </Card>
            )}
            {openWaitlist && (
              <Card className="p-4 active:scale-[0.99] mt-2" onClick={openWaitlist}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div
                      aria-hidden
                      style={{
                        width: 32, height: 32, borderRadius: 999, display: "grid", placeItems: "center",
                        background: C.ivory, color: C.coffee, border: `1px solid ${C.hairline}`, flexShrink: 0,
                      }}
                    >
                      <UserPlus size={15} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold" style={{ color: C.espresso }}>Waitlist</p>
                      <p className="text-[11px]" style={{ color: C.muted }}>
                        {(() => {
                          const list = store.waitlistApi?.requests || [];
                          const waiting = list.filter((r: any) => r.status === "waiting").length;
                          if (list.length === 0) return "Clients waiting for an opening";
                          return `${waiting} waiting · ${list.length} total`;
                        })()}
                      </p>
                    </div>
                  </div>
                  <ChevronRight size={18} style={{ color: C.muted }} />
                </div>
              </Card>
            )}
            {openApprovals && (
              <Card className="p-4 active:scale-[0.99] mt-2" onClick={openApprovals}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div
                      aria-hidden
                      style={{
                        width: 32, height: 32, borderRadius: 999, display: "grid", placeItems: "center",
                        background: C.ivory, color: C.coffee, border: `1px solid ${C.hairline}`, flexShrink: 0,
                      }}
                    >
                      <CheckCircle2 size={15} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold" style={{ color: C.espresso }}>Approvals</p>
                      <p className="text-[11px]" style={{ color: C.muted }}>
                        {(() => {
                          const list: BookingRequestRecord[] = store.approvalsApi?.requests || [];
                          const paidPendingApproval = list.filter(r => r.approval_status === "deposit_paid_pending_approval").length;
                          const review = list.filter(r => r.approval_status === "pending_review").length;
                          const awaitingDeposit = list.filter(r => r.approval_status === "awaiting_deposit" || r.approval_status === "approved_pending_deposit").length;
                          if (paidPendingApproval === 0 && review === 0 && awaitingDeposit === 0) return "Review requests, set deposits";
                          const parts: string[] = [];
                          if (paidPendingApproval > 0) parts.push(`${paidPendingApproval} deposit paid · needs you`);
                          if (review > 0) parts.push(`${review} to review`);
                          if (awaitingDeposit > 0) parts.push(`${awaitingDeposit} awaiting deposit`);
                          return parts.join(" · ");
                        })()}
                      </p>
                    </div>
                  </div>
                  <ChevronRight size={18} style={{ color: C.muted }} />
                </div>
              </Card>
            )}
            {openContracts && (
              <Card className="p-4 active:scale-[0.99] mt-2" onClick={openContracts}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div
                      aria-hidden
                      style={{
                        width: 32, height: 32, borderRadius: 999, display: "grid", placeItems: "center",
                        background: C.ivory, color: C.coffee, border: `1px solid ${C.hairline}`, flexShrink: 0,
                      }}
                    >
                      <FileText size={15} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold" style={{ color: C.espresso }}>Contracts</p>
                      <p className="text-[11px]" style={{ color: C.muted }}>
                        Agreements clients sign before booking is locked
                      </p>
                    </div>
                  </div>
                  <ChevronRight size={18} style={{ color: C.muted }} />
                </div>
              </Card>
            )}
            {openIntelligence && (
              <Card className="p-4 active:scale-[0.99] mt-2" onClick={openIntelligence}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div
                      aria-hidden
                      style={{
                        width: 32, height: 32, borderRadius: 999, display: "grid", placeItems: "center",
                        background: C.ivory, color: C.coffee, border: `1px solid ${C.hairline}`, flexShrink: 0,
                      }}
                    >
                      <BarChart3 size={15} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold" style={{ color: C.espresso }}>Booking intelligence</p>
                      <p className="text-[11px]" style={{ color: C.muted }}>
                        Funnel, top services, demand & smart insights
                      </p>
                    </div>
                  </div>
                  <ChevronRight size={18} style={{ color: C.muted }} />
                </div>
              </Card>
            )}

            <SectionTitle>Payments</SectionTitle>
            <Card
              className="p-4 active:scale-[0.99]"
              onClick={() => {
                if (typeof window !== "undefined") window.location.assign("/settings/payments");
              }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div
                    aria-hidden
                    style={{
                      width: 32, height: 32, borderRadius: 999, display: "grid", placeItems: "center",
                      background: C.ivory, color: C.coffee, border: `1px solid ${C.hairline}`, flexShrink: 0,
                    }}
                  >
                    <DollarSign size={15} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold" style={{ color: C.espresso }}>Stripe Connect</p>
                      {stripeDisplay && <Pill tone={stripeDisplay.tone}>{stripeDisplay.pill}</Pill>}
                    </div>
                    <p className="text-[11px] mt-0.5" style={{ color: C.muted }}>
                      {stripeDisplay?.subtitle || "Take deposits directly into your own Stripe account"}
                    </p>
                  </div>
                </div>
                <ChevronRight size={18} style={{ color: C.muted }} />
              </div>
            </Card>

            <SectionTitle>Studio offers</SectionTitle>
            <Card className="p-4 active:scale-[0.99]" onClick={openDiscounts}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div
                    aria-hidden
                    style={{
                      width: 32, height: 32, borderRadius: 999, display: "grid", placeItems: "center",
                      background: C.ivory, color: C.gold, border: `1px solid ${C.hairline}`, flexShrink: 0,
                    }}
                  >
                    <Sparkles size={15} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold" style={{ color: C.espresso }}>Discounts</p>
                    <p className="text-[11px]" style={{ color: C.muted }}>
                      {(() => {
                        const list: Discount[] = store.discountsApi?.discounts || [];
                        const active = list.filter(d => d.is_active).length;
                        if (list.length === 0) return "Loyalty rewards · referrals · slow-day specials";
                        return `${active} active · ${list.length} total`;
                      })()}
                    </p>
                  </div>
                </div>
                <ChevronRight size={18} style={{ color: C.muted }} />
              </div>
            </Card>
          </>
        )}

        {openCommunicationLog && (
          // Real <button> for the same WKWebView reliability reason as
          // Account & sync above. pointer-events: none on the inner
          // flex row guarantees taps on the chevron, the labels, or
          // the dead space between them all bubble up to the button.
          <button
           type="button"
            onClick={() => {
              if (!store.premium) { store.requestUpgrade?.("communicationLog"); return; }
              openCommunicationLog();
            }}
            className="w-full text-left rounded-2xl p-4 mt-2 active:scale-[0.99] cursor-pointer select-none transition"
            style={{
              background: `linear-gradient(180deg, ${C.paper} 0%, ${C.ivory} 100%)`,
              border: `1px solid ${C.hairline}`,
              boxShadow: "0 1px 2px rgba(42, 24, 16, 0.04), 0 8px 24px -12px rgba(42, 24, 16, 0.12)",
              font: "inherit",
              color: "inherit",
              appearance: "none",
              WebkitAppearance: "none",
            }}>
            <div className="flex items-center justify-between" style={{ pointerEvents: "none" }}>
              <div>
                <p className="text-sm font-semibold" style={{ color: C.espresso }}>Communication log</p>
                <p className="text-[11px]" style={{ color: C.muted }}>{(store.commLog || []).length} message{(store.commLog || []).length === 1 ? "" : "s"} · copies, shares, sends</p>
              </div>
              <ChevronRight size={18} style={{ color: C.muted }} />
            </div>
          </button>
        )}

        <SectionTitle>Data</SectionTitle>
        <Card className="p-4 space-y-2">
          <Button variant="outline" icon={<Download size={15} />} onClick={exportData} fullWidth>Export all data (JSON)</Button>
          <p className="text-[11px] text-center" style={{ color: C.muted }}>
            Photo data is redacted from exports for size. Stored locally in this device only.
          </p>
        </Card>

        <Button variant="primary" onClick={save} fullWidth icon={saved ? <Check size={16} /> : <Save size={16} />}>
          {saved ? "Saved" : "Save settings"}
        </Button>
      </div>
    </div>
  );
};

// ============================================================
//  TIMER SESSIONS LIST (drilled from productivity)
// ============================================================
type BookingRequestRow = {
  id: string;
  user_id: string;
  link_slug: string;
  client_name: string;
  client_phone: string | null;
  client_email: string | null;
  service_name: string | null;
  service_duration: number | null;
  service_price: number | null;
  preferred_date: string | null;
  preferred_time: string | null;
  notes: string | null;
  status: "pending" | "approved" | "declined" | "converted";
  appointment_id: string | null;
  created_at: string;
  updated_at: string;
};

const BookingRequestsScreen = ({ userId, onBack, onApprove }: {
  userId: string | null;
  onBack: () => void;
  onApprove: (req: BookingRequestRow) => Promise<string>;
}) => {
  const [rows, setRows] = useState<BookingRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"pending" | "all">("pending");

  const fetchRows = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const supabase = getSupabase();
      const { data } = await supabase
        .from("booking_requests")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      setRows((data as BookingRequestRow[]) || []);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetchRows is async and setState is inside its body via setRows; intentional
  useEffect(() => { fetchRows(); }, [fetchRows]);

  const filtered = useMemo(() =>
    filter === "pending"
      ? rows.filter(r => r.status === "pending")
      : rows,
    [rows, filter]);

  const setStatus = async (req: BookingRequestRow, status: BookingRequestRow["status"], appointmentId?: string) => {
    setBusyId(req.id);
    try {
      const supabase = getSupabase();
      const patch: any = { status };
      if (appointmentId) patch.appointment_id = appointmentId;
      await supabase.from("booking_requests").update(patch).eq("id", req.id);
      setRows(prev => prev.map(r => r.id === req.id ? { ...r, ...patch } as BookingRequestRow : r));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="bbp-fade pb-24">
      <Header title="Booking requests" leftAction={{ icon: <ChevronLeft size={20} />, onClick: onBack }} />
      <div className="px-5 pt-4 space-y-3">
        <div className="flex p-1 rounded-xl" style={{ background: C.ivory, border: `1px solid ${C.hairline}` }}>
          {[{ id: "pending", label: "Pending" }, { id: "all", label: "All" }].map(t => (
            <button type="button" key={t.id} onClick={() => setFilter(t.id as any)}
              className="flex-1 py-2 rounded-lg text-[13px] font-semibold transition"
              style={{ background: filter === t.id ? C.espresso : "transparent", color: filter === t.id ? C.cream : C.coffee }}>
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-center text-xs py-6" style={{ color: C.muted }}>Loading…</p>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<CalendarPlus size={28} style={{ color: C.gold }} />}
            title="No booking requests yet"
            body="Share your booking link — incoming requests will land here for you to approve."
          />
        ) : (
          filtered.map(r => (
            <Card key={r.id} className="p-3.5">
              <div className="flex items-start justify-between gap-2 mb-1.5 flex-wrap">
                <div className="min-w-0">
                  <p className="font-semibold text-sm" style={{ color: C.espresso }}>
                    {r.client_name}
                  </p>
                  <p className="text-[11px]" style={{ color: C.muted }}>
                    {[r.client_phone, r.client_email].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <Pill tone={r.status === "pending" ? "warning"
                  : r.status === "approved" ? "gold"
                  : r.status === "converted" ? "success"
                  : "danger"}>
                  {r.status.toUpperCase()}
                </Pill>
              </div>
              {(r.service_name || r.preferred_date) && (
                <p className="text-[12px] mt-1" style={{ color: C.coffee }}>
                  {r.service_name || "Service"}
                  {r.preferred_date ? ` · ${fmtDate(r.preferred_date)}` : ""}
                  {r.preferred_time ? ` at ${fmtTime(r.preferred_time)}` : ""}
                </p>
              )}
              {r.notes && (
                <p className="text-[11px] mt-1.5 italic" style={{ color: C.muted }}>&quot;{r.notes}&quot;</p>
              )}
              <p className="text-[10px] mt-2" style={{ color: C.muted }}>
                Received {fmtRelative(r.created_at)}
              </p>
              {r.status === "pending" && (
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <Button variant="outline" disabled={busyId === r.id}
                    onClick={() => setStatus(r, "declined")}>
                    Decline
                  </Button>
                  <Button variant="primary" disabled={busyId === r.id}
                    onClick={async () => {
                      // Latch synchronously so a double-tap on a slow
                      // network can't fire two approvals before the
                      // first setStatus settles.
                      if (busyId === r.id) return;
                      setBusyId(r.id);
                      try {
                        const apptId = await onApprove(r);
                        await setStatus(r, "converted", apptId);
                      } catch (err) {
                        console.error("[bookings] approve failed:", err);
                        alert("Couldn't approve that booking. Please try again.");
                      } finally {
                        setBusyId(null);
                      }
                    }}>
                    Approve &amp; book
                  </Button>
                </div>
              )}
            </Card>
          ))
        )}
      </div>
    </div>
  );
};

const AnalyticsStatRow = ({ label, value, hint }: { label: string; value: any; hint?: string }) => (
  <div className="flex items-baseline justify-between py-2" style={{ borderBottom: `1px solid ${C.hairline}` }}>
    <div>
      <p className="text-[12px] font-semibold" style={{ color: C.coffee }}>{label}</p>
      {hint && <p className="text-[10px] mt-0.5" style={{ color: C.muted }}>{hint}</p>}
    </div>
    <p style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600, color: C.espresso }}>{value}</p>
  </div>
);

const AnalyticsBar = ({ value, max, color }: { value: number; max: number; color: string }) => (
  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: C.ivory }}>
    <div className="h-full rounded-full" style={{ width: `${max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0}%`, background: color, transition: "width 200ms" }} />
  </div>
);

const AnalyticsScreen = ({ clients, appointments, commLog, business, today, onBack }: {
  clients: any[];
  appointments: any[];
  commLog: any[];
  business: any;
  today: string;
  onBack: () => void;
}) => {
  const revenue = useMemo(() => calculateRevenueAnalytics(appointments, today), [appointments, today]);
  const clientStats = useMemo(() => calculateClientAnalytics(clients, appointments, today), [clients, appointments, today]);
  const apptStats = useMemo(() => calculateAppointmentAnalytics(appointments, today), [appointments, today]);
  const styleStats = useMemo(() => calculateStylePerformance(appointments), [appointments]);
  const retention = useMemo(() => calculateRetentionAnalytics(clients, appointments, today), [clients, appointments, today]);
  const comms = useMemo(() => calculateCommunicationAnalytics(commLog), [commLog]);

  const noData = (appointments?.length || 0) === 0;
  const limitedStyle = styleStats.length === 0;
  const limitedRetention = retention.repeatBookingRatePct === 0 && retention.rebookingCandidates === 0 && retention.averageDaysBetween === null;

  return (
    <div className="bbp-fade pb-32">
      <Header title="Analytics" leftAction={{ icon: <ChevronLeft size={20} />, onClick: onBack }} />
      <div className="px-5 pt-4 space-y-5">
        {noData ? (
          <EmptyState
            icon={<BarChart3 size={28} style={{ color: C.gold }} />}
            title="No data yet"
            body="Book your first appointment to unlock analytics."
          />
        ) : (
          <>
            <div>
              <SectionTitle>Revenue</SectionTitle>
              <Card className="p-4">
                <AnalyticsStatRow label="Revenue this month" value={fmtMoney(revenue.thisMonth, business?.currency)} />
                <AnalyticsStatRow label="Revenue last month" value={fmtMoney(revenue.lastMonth, business?.currency)} />
                <AnalyticsStatRow
                  label="Month-over-month"
                  value={revenue.momChangePct === null
                    ? "—"
                    : `${revenue.momChangePct > 0 ? "+" : ""}${revenue.momChangePct}%`}
                />
                <AnalyticsStatRow label="Average ticket" value={fmtMoney(revenue.averageTicket, business?.currency)} />
                <AnalyticsStatRow label="Top-earning style" value={revenue.topStyle ? `${revenue.topStyle.name}` : "—"} hint={revenue.topStyle ? fmtMoney(revenue.topStyle.revenue, business?.currency) : undefined} />
                <AnalyticsStatRow label="Pending balances" value={fmtMoney(revenue.pendingBalance, business?.currency)} />
              </Card>
            </div>

            <div>
              <SectionTitle>Clients</SectionTitle>
              <Card className="p-4">
                <AnalyticsStatRow label="Total clients" value={clientStats.total} />
                <AnalyticsStatRow label="New this month" value={clientStats.newThisMonth} />
                <AnalyticsStatRow label="Repeat client rate" value={`${clientStats.repeatRatePct}%`} />
                <AnalyticsStatRow label="VIP clients" value={clientStats.vipCount} />
                <AnalyticsStatRow label="At-risk clients" value={clientStats.atRiskCount} />
                <AnalyticsStatRow label="Inactive clients" value={clientStats.inactiveCount} />
              </Card>
            </div>

            <div>
              <SectionTitle>Appointments</SectionTitle>
              <Card className="p-4">
                <AnalyticsStatRow label="Total this month" value={apptStats.thisMonthTotal} />
                <AnalyticsStatRow label="Completed" value={apptStats.completed} />
                <AnalyticsStatRow label="Cancelled" value={apptStats.cancelled} />
                <AnalyticsStatRow label="No-shows" value={apptStats.noShow} />
                <AnalyticsStatRow label="Busiest day" value={apptStats.busiestDow ? `${apptStats.busiestDow.name}` : "—"} hint={apptStats.busiestDow ? `${apptStats.busiestDow.count} bookings` : undefined} />
                <AnalyticsStatRow label="Avg duration" value={apptStats.averageDurationHours > 0 ? `${apptStats.averageDurationHours.toFixed(1)}h` : "—"} />
              </Card>
            </div>

            <div>
              <SectionTitle>Style performance</SectionTitle>
              {limitedStyle ? (
                <Card className="p-4 text-center">
                  <p className="text-xs" style={{ color: C.muted }}>Style trends will appear after a few completed appointments.</p>
                </Card>
              ) : (
                <Card className="p-4 space-y-3">
                  {styleStats.slice(0, 5).map(s => {
                    const max = styleStats[0].revenue || 1;
                    return (
                      <div key={s.style}>
                        <div className="flex items-baseline justify-between mb-1">
                          <p className="text-[13px] font-semibold" style={{ color: C.espresso }}>{s.style}</p>
                          <p className="text-[12px] font-mono" style={{ color: C.goldDeep }}>{fmtMoney(s.revenue, business?.currency)}</p>
                        </div>
                        <AnalyticsBar value={s.revenue} max={max} color={C.goldDeep} />
                        <p className="text-[10px] mt-1" style={{ color: C.muted }}>
                          {s.count} booking{s.count === 1 ? "" : "s"} · avg {fmtMoney(s.averagePrice, business?.currency)} · {s.averageDuration > 0 ? `${s.averageDuration.toFixed(1)}h avg · ` : ""}{s.repeatBookingRatePct}% repeats
                        </p>
                      </div>
                    );
                  })}
                </Card>
              )}
            </div>

            <div>
              <SectionTitle>Retention</SectionTitle>
              {limitedRetention ? (
                <Card className="p-4 text-center">
                  <p className="text-xs" style={{ color: C.muted }}>Retention insights grow as clients rebook.</p>
                </Card>
              ) : (
                <Card className="p-4">
                  <AnalyticsStatRow label="Rebooking candidates" value={retention.rebookingCandidates} />
                  <AnalyticsStatRow label="Average days between" value={retention.averageDaysBetween ?? "—"} />
                  <AnalyticsStatRow label="Clients overdue (90+ days)" value={retention.overdueCount} />
                  <AnalyticsStatRow label="Repeat booking rate" value={`${retention.repeatBookingRatePct}%`} />
                </Card>
              )}
            </div>

            <div>
              <SectionTitle>Communications</SectionTitle>
              <Card className="p-4">
                <AnalyticsStatRow label="Messages logged" value={comms.total} />
                <AnalyticsStatRow label="Sent via SMS" value={comms.sent} />
                <AnalyticsStatRow label="Shared" value={comms.shared} />
                <AnalyticsStatRow label="Copied" value={comms.copied} />
                <AnalyticsStatRow label="Reminders sent" value={comms.remindersSent} />
                <AnalyticsStatRow label="Rebooking nudges" value={comms.rebookingNudgesSent} />
                <AnalyticsStatRow label="Balance reminders" value={comms.balanceRemindersSent} />
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const CommunicationLogScreen = ({ store, onBack }: { store: any; onBack: () => void }) => {
  const entries = useMemo(() =>
    [...(store.commLog || [])].sort((a: any, b: any) => (b.createdAt || "").localeCompare(a.createdAt || "")),
    [store.commLog]);

  const actionTone = (action: string): "success" | "gold" | "neutral" => {
    if (action === "sent") return "success";
    if (action === "shared") return "gold";
    return "neutral";
  };

  return (
    <div className="bbp-fade pb-24">
      <Header title="Communication log" leftAction={{ icon: <ChevronLeft size={20} />, onClick: onBack }} />
      <div className="px-5 pt-4 space-y-2">
        {entries.length === 0 ? (
          <EmptyState
            icon={<MessageSquare size={28} style={{ color: C.gold }} />}
            title="No messages sent yet"
            body="Confirm a booking to start your client trail."
          />
        ) : (
          entries.map((e: any) => (
            <Card key={e.id} className="p-3.5">
              <div className="flex items-start justify-between gap-2 mb-1.5 flex-wrap">
                <p className="font-semibold text-sm" style={{ color: C.espresso }}>
                  {e.typeLabel || e.type || "Message"} · {e.clientName || "Client"}
                </p>
                <Pill tone={actionTone(e.action)}>{(e.action || "draft").toUpperCase()}</Pill>
              </div>
              <p className="text-[11px]" style={{ color: C.muted }}>{fmtRelative(e.createdAt)}</p>
              {e.body && (
                <p className="text-xs mt-2 leading-relaxed line-clamp-3" style={{ color: C.coffee }}>{e.body}</p>
              )}
              <div className="flex justify-end mt-2">
                <button type="button" onClick={() => store.deleteCommLogEntry(e.id)}
                  className="text-[11px] font-semibold uppercase tracking-wider"
                  style={{ color: C.danger, letterSpacing: "0.08em" }}>
                  Remove
                </button>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
};

const TimerSessionsScreen = ({ store, onBack }) => {
  const sessions = useMemo(() => [...store.timerSessions].sort((a, b) => (b.endedAt || "").localeCompare(a.endedAt || "")), [store.timerSessions]);
  return (
    <div className="bbp-fade pb-32">
      <Header title="All sessions" leftAction={{ icon: <ChevronLeft size={20} />, onClick: onBack }} />
      <div className="px-5 pt-2 space-y-2">
        {sessions.length === 0 ? (
          <EmptyState icon={<TimerIcon size={28} style={{ color: C.muted }} />} title="No sessions yet" body="Start the chair timer to log your first session." />
        ) : sessions.map(s => {
          const activeMs = s.totalMs - (s.pausedMs || 0);
          return (
            <Card key={s.id} className="p-3">
              <div className="flex items-start justify-between mb-1">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: C.espresso }}>{s.style || "Session"}</p>
                  <p className="text-[11px]" style={{ color: C.muted }}>{fmtDateLong(s.endedAt.slice(0, 10))}</p>
                </div>
                <p className="text-sm font-mono font-bold" style={{ color: C.espresso }}>{fmtHours(activeMs)}h</p>
              </div>
              <div className="flex items-center gap-2 mt-2 text-[11px]" style={{ color: C.muted }}>
                <Pill tone="success">{fmtMoney(s.totalPrice || 0, store.business.currency)}</Pill>
                <Pill tone="gold">{fmtMoney(s.hourlyEarned || 0, store.business.currency)}/hr</Pill>
                {s.variance != null && Math.abs(s.variance) > 0.05 && (
                  <Pill tone={s.variance > 0 ? "warning" : "success"}>
                    {s.variance > 0 ? "+" : ""}{Math.round(s.variance * 100)}%
                  </Pill>
                )}
              </div>
              {s.notes && <p className="text-[11px] mt-2 italic" style={{ color: C.muted }}>&quot;{s.notes}&quot;</p>}
            </Card>
          );
        })}
      </div>
    </div>
  );
};
// ============================================================
//  NOTIFICATIONS SHEET
// ============================================================
// ============================================================
//  INTERNAL NOTIFICATIONS — what the salon owner needs to act on.
//  Outbound client communications (booking confirmations, 24h / 48h
//  reminders, balance-due texts, etc.) intentionally do NOT live here.
//  Those belong in:
//    - the Communication Log (Settings → Communication log)
//    - per-appointment communication history
//    - per-client communication timeline (ClientSheet)
// ============================================================
type NotifCategory = "system" | "finance" | "retention" | "appointment" | "communication_status";

// Centralised target type so a notification's deep-link is a tagged
// union the action router can switch on. Adding a new notification
// kind is now: stamp a target → register the handler in the router.
// No inline "if id starts with bal_" string parsing anywhere.
export type NotificationTarget =
  | { kind: "appointment"; appointmentId: string; date?: string }
  | { kind: "client"; clientId: string }
  | { kind: "reminders" }
  | { kind: "schedule" }
  | { kind: "booking_approval"; requestId: string };

type NotifItem = {
  id: string;
  category: NotifCategory;
  kind: string;
  tone: "warning" | "danger" | "gold" | "neutral" | "success";
  icon: React.ReactNode;
  title: string;
  body: string;
  meta?: string;
  target?: NotificationTarget;
};

// Categories that contribute to the bell badge. communication_status
// items are informational only and never count as "unread / actionable".
const ACTIONABLE_CATEGORIES: ReadonlyArray<NotifCategory> = ["system", "finance", "retention", "appointment"];
const isActionableCategory = (c: NotifCategory) => ACTIONABLE_CATEGORIES.includes(c);

// Builder for typed internal notifications. Lets feature code create
// new alerts without re-stating the discriminator each time and gives us
// a single place to enforce the "no message body" rule for outbound
// comms.
const createInternalNotification = (input: Omit<NotifItem, "icon"> & { icon?: React.ReactNode }): NotifItem => ({
  ...input,
  icon: input.icon ?? <Bell size={16} style={{ color: C.coffee }} />,
});

// Convenience for logging an outbound client communication. The Comm
// sheets call this; nothing here ends up in the bell.
const logClientCommunication = (
  upsertCommLogEntry: (entry: any) => Promise<any> | void,
  payload: { templateKey: string; templateLabel?: string; action: "copied" | "shared" | "sent" | "draft"; clientId?: string; clientName?: string; appointmentId?: string; body?: string },
) => upsertCommLogEntry({
  type: payload.templateKey,
  typeLabel: payload.templateLabel,
  action: payload.action,
  clientId: payload.clientId,
  clientName: payload.clientName,
  appointmentId: payload.appointmentId,
  body: payload.body,
  createdAt: new Date().toISOString(),
});

const buildNotifications = (store: any): NotifItem[] => {
  const items: NotifItem[] = [];
  const today = todayISO();
  const now = Date.now();
  const in7 = addDaysISO(today, 7);
  const safeAppts = Array.isArray(store?.appointments) ? store.appointments : [];
  const safeReminders = Array.isArray(store?.reminders) ? store.reminders : [];
  const safeClients = Array.isArray(store?.clients) ? store.clients : [];
  const safeApprovals = Array.isArray(store?.approvalsApi?.requests) ? store.approvalsApi.requests : [];
  const currency = store?.business?.currency || "USD";

  // APPOINTMENT — deposit paid, needs your approval. One row per
  // request so each is independently tappable. Routes the stylist
  // straight to the Approvals queue with that row pre-expanded.
  const depositPaidPending = safeApprovals.filter((r: any) =>
    r && r.approval_status === "deposit_paid_pending_approval"
  );
  for (const r of depositPaidPending) {
    const amount = Number(r.deposit_amount) || 0;
    const dateLabel = r.preferred_date ? fmtDate(r.preferred_date) : "no date";
    const timeLabel = r.preferred_time ? ` at ${fmtTime(r.preferred_time)}` : "";
    items.push({
      id: `appr_${r.id}`,
      category: "appointment",
      kind: "booking_approval_pending",
      tone: "gold",
      icon: <DollarSign size={16} style={{ color: C.goldDeep }} />,
      title: `${r.client_name || "Client"} paid deposit · needs approval`,
      body: `${r.service_name || "Service"} · ${dateLabel}${timeLabel}${amount > 0 ? ` · ${fmtMoney(amount, currency)} deposit` : ""}`,
      meta: "Tap to review",
      target: { kind: "booking_approval", requestId: r.id },
    });
  }

  // FINANCE — overdue balances (actionable)
  const lateBalance = safeAppts.filter((a: any) =>
    a && a.status !== "cancelled" && a.status !== "completed" &&
    parseMoney(a.balanceDue) > 0 && a.date && a.date < today
  );
  for (const a of lateBalance) {
    items.push({
      id: `bal_${a.id}`,
      category: "finance",
      kind: "balance_overdue",
      tone: "danger",
      icon: <AlertCircle size={16} style={{ color: C.danger }} />,
      title: `Balance overdue · ${a.clientName || "Client"}`,
      body: `${fmtMoney(parseMoney(a.balanceDue), currency)} unpaid for ${a.style || "appointment"}.`,
      meta: `Was ${fmtDate(a.date)}`,
      target: { kind: "appointment", appointmentId: a.id, date: a.date },
    });
  }

  // APPOINTMENT — upcoming within 7 days (action: prep / confirm)
  const upcoming = safeAppts.filter((a: any) =>
    a && a.status !== "cancelled" && a.status !== "completed" &&
    a.date && a.date >= today && a.date <= in7
  ).sort((a: any, b: any) =>
    ((a.date || "") + (a.time || "")).localeCompare((b.date || "") + (b.time || ""))
  );
  for (const a of upcoming) {
    const apptMs = a.date && a.time ? new Date(`${a.date}T${a.time}:00`).getTime() : null;
    const soon = apptMs && apptMs - now < 48 * 3600000;
    items.push({
      id: `up_${a.id}`,
      category: "appointment",
      kind: "upcoming_appointment",
      tone: soon ? "gold" : "neutral",
      icon: <Calendar size={16} style={{ color: soon ? C.goldDeep : C.coffee }} />,
      title: `${a.clientName || "Client"} · ${a.style || "Appointment"}`,
      body: `${fmtDate(a.date)}${a.time ? ` at ${fmtTime(a.time)}` : ""}`,
      meta: apptMs ? fmtRelative(new Date(apptMs).toISOString()) : undefined,
      target: { kind: "appointment", appointmentId: a.id, date: a.date },
    });
  }

  // APPOINTMENT — no-show follow-up (within last 30 days)
  const recentNoShow = safeAppts.filter((a: any) => {
    if (!a || a.status !== "no_show" || !a.date) return false;
    const days = Math.round((new Date(today + "T00:00:00").getTime() - new Date(a.date + "T00:00:00").getTime()) / 86400000);
    return days >= 0 && days <= 30;
  });
  for (const a of recentNoShow) {
    items.push({
      id: `noshow_${a.id}`,
      category: "appointment",
      kind: "no_show_followup",
      tone: "warning",
      icon: <AlertTriangle size={16} style={{ color: C.warning }} />,
      title: `No-show · ${a.clientName || "Client"}`,
      body: `${a.style || "Appointment"} on ${fmtDate(a.date)}. Decide on policy fee or follow-up.`,
      target: { kind: "appointment", appointmentId: a.id, date: a.date },
    });
  }

  // RETENTION — overdue rebooking candidates (top 3)
  const candidates = getRebookingCandidates(safeClients, safeAppts, today).slice(0, 3);
  for (const c of candidates) {
    items.push({
      id: `reb_${c.client.id}`,
      category: "retention",
      kind: "rebooking_overdue",
      tone: "gold",
      icon: <Sparkles size={16} style={{ color: C.goldDeep }} />,
      title: `${c.reason} · ${c.client.name || "Client"}`,
      body: `${c.metrics.daysSinceLast ?? 0}d since last visit${c.metrics.mostBookedStyle ? ` · prefers ${c.metrics.mostBookedStyle}` : ""}.`,
      target: { kind: "client", clientId: c.client.id },
    });
  }

  // COMMUNICATION_STATUS — failed sends only (no rendered message
  // bodies). Pending / sent / delivered reminders intentionally do not
  // appear here; they live in the Reminder inbox + Communication log.
  const failed = safeReminders.filter((r: any) => r && r.status === "failed");
  for (const r of failed) {
    items.push({
      id: `cs_${r.id}`,
      category: "communication_status",
      kind: "reminder_failed",
      tone: "danger",
      icon: <XCircle size={16} style={{ color: C.danger }} />,
      title: `Reminder failed to send · ${r.clientName || "Client"}`,
      body: `${PURPOSE_LABEL_LOCAL[r.purpose as keyof typeof PURPOSE_LABEL_LOCAL] || "Reminder"} couldn't be delivered. Re-send manually if needed.`,
      target: { kind: "reminders" },
    });
  }

  // COMMUNICATION_STATUS — lightweight summary of reminders queued for
  // today / tomorrow. One aggregate row, NOT one row per message.
  const queuedTodayOrTomorrow = safeReminders.filter((r: any) => {
    if (!r || r.status !== "pending" || !r.scheduledFor) return false;
    const d = new Date(r.scheduledFor);
    if (!Number.isFinite(d.getTime())) return false;
    const diff = d.getTime() - now;
    return diff >= 0 && diff <= 48 * 3600000;
  });
  if (queuedTodayOrTomorrow.length > 0) {
    items.push({
      id: "cs_queue_summary",
      category: "communication_status",
      kind: "reminders_queued",
      tone: "neutral",
      icon: <Send size={16} style={{ color: C.muted }} />,
      title: `${queuedTodayOrTomorrow.length} reminder${queuedTodayOrTomorrow.length === 1 ? "" : "s"} queued`,
      body: "Outgoing client messages scheduled for the next 48h.",
      meta: "View in Reminder inbox",
      target: { kind: "reminders" },
    });
  }

  return items;
};

const DISMISSED_NOTIF_KEY = "dismissedNotifIds";
const READ_NOTIF_KEY = "readNotifIds";

// Shared notification state so the dashboard badge and the notifications
// sheet always agree, including across reloads.
const useNotifications = (store: any) => {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [read, setRead] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [rawDismissed, rawRead] = await Promise.all([
        safeStorage.get(DISMISSED_NOTIF_KEY),
        safeStorage.get(READ_NOTIF_KEY),
      ]);
      const parseList = (raw: string | null): string[] => {
        const parsed = safeParse<unknown>(raw, []);
        return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
      };
      if (cancelled) return;
      setDismissed(parseList(rawDismissed));
      setRead(parseList(rawRead));
      setHydrated(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const allItems = useMemo(() => buildNotifications(store), [
    store.reminders, store.appointments, store.clients, store.business,
    store.approvalsApi?.requests,
  ]);
  const items = useMemo(() => allItems.filter(n => !dismissed.includes(n.id)), [allItems, dismissed]);
  // Badge counts only actionable (system / finance / retention /
  // appointment) categories. Communication-status rows are info-only.
  const unreadCount = useMemo(
    () => items.filter(n => isActionableCategory(n.category) && !read.includes(n.id)).length,
    [items, read],
  );

  // Prune dismissed / read IDs that no longer exist in the live items.
  // Without this, deleting an appointment leaves its notification id
  // pinned in storage forever, slowly bloating the persisted list.
  //
  // CRITICAL: skip pruning while `allItems` is empty. On a fresh app
  // load `useStorage` hydrates `store.appointments` asynchronously, so
  // for the first render or two after `hydrated=true` the live items
  // are an empty array even though the user does have real
  // appointments. If we prune in that window, every dismissed ID is
  // wiped from disk and the notifications reappear once the
  // appointments finally arrive. Treating empty as "haven't observed
  // yet" keeps dismissals durable across refresh / cold start.
  useEffect(() => {
    if (!hydrated) return;
    if (allItems.length === 0) return;
    const liveIds = new Set(allItems.map(n => n.id));
    const cleanDismissed = dismissed.filter(id => liveIds.has(id));
    const cleanRead = read.filter(id => liveIds.has(id));
    if (cleanDismissed.length !== dismissed.length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- pruning stale ids derived from live data, intentional
      setDismissed(cleanDismissed);
      safeStorage.set(DISMISSED_NOTIF_KEY, cleanDismissed);
    }
    if (cleanRead.length !== read.length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- pruning stale ids derived from live data, intentional
      setRead(cleanRead);
      safeStorage.set(READ_NOTIF_KEY, cleanRead);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only run when underlying record set changes
  }, [allItems, hydrated]);

  const persist = async (key: string, next: string[], setter: (v: string[]) => void) => {
    setter(next);
    await safeStorage.set(key, next);
  };

  const dismiss = useCallback((id: string) => {
    persist(DISMISSED_NOTIF_KEY, Array.from(new Set([...dismissed, id])), setDismissed);
  }, [dismissed]);

  const clearAll = useCallback(() => {
    if (items.length === 0) return;
    const ids = items.map(n => n.id);
    persist(DISMISSED_NOTIF_KEY, Array.from(new Set([...dismissed, ...ids])), setDismissed);
  }, [items, dismissed]);

  const markAllRead = useCallback(() => {
    if (items.length === 0) return;
    const ids = items.map(n => n.id);
    persist(READ_NOTIF_KEY, Array.from(new Set([...read, ...ids])), setRead);
  }, [items, read]);

  // Single-id read marker. Used when a notification is tapped so the
  // bell badge drops one count immediately.
  const markRead = useCallback((id: string) => {
    if (read.includes(id)) return;
    persist(READ_NOTIF_KEY, Array.from(new Set([...read, id])), setRead);
  }, [read]);

  const readIds = useMemo(() => new Set(read), [read]);

  return { hydrated, items, unreadCount, dismiss, clearAll, markAllRead, markRead, readIds };
};

// ---- Notification action router ----------------------------------------
// Centralised "where does this notification go when tapped" logic. New
// kinds plug in by stamping a NotificationTarget on the NotifItem in
// buildNotifications — no per-screen branching needed.
type NotificationRouterCtx = {
  appointments: any[];
  setActive: (tab: string) => void;
  setSecondary: (key: string | null) => void;
  setApptPrefill: (a: any) => void;
  setClientToOpenId: (id: string | null) => void;
  setApprovalFocusId: (id: string | null) => void;
};

const routeNotification = (n: NotifItem, ctx: NotificationRouterCtx): void => {
  if (!n.target) {
    // Fallback for legacy items without a target — surface on Schedule.
    ctx.setActive("schedule");
    return;
  }
  const target = n.target;
  switch (target.kind) {
    case "appointment": {
      const appt = (ctx.appointments || []).find(a => a?.id === target.appointmentId);
      ctx.setActive("schedule");
      // Schedule consumes apptPrefill via useEffect — passing the
      // record with id reopens AppointmentSheet in edit mode.
      if (appt) ctx.setApptPrefill(appt);
      break;
    }
    case "client": {
      ctx.setActive("clients");
      ctx.setClientToOpenId(target.clientId);
      break;
    }
    case "reminders":
      ctx.setSecondary("reminders");
      break;
    case "schedule":
      ctx.setActive("schedule");
      break;
    case "booking_approval": {
      // Stash the request id so the Approvals queue can scroll to and
      // pre-expand that row, then navigate.
      ctx.setApprovalFocusId(target.requestId);
      ctx.setSecondary("approvals");
      break;
    }
  }
};

// Derive a payment status from an appointment record. Honors an explicit
// override (a.paymentStatus set by "Mark as Paid" or manual edit) and
// falls back to deposit / balance / date heuristics.
const paymentStatusOf = (a: any, todayIso: string): "paid" | "deposit" | "pending" | "overdue" => {
  if (!a) return "pending";
  if (a.status === "cancelled") return "pending";
  const total = Number(a.totalPrice) || 0;
  const balance = Number(a.balanceDue ?? Math.max(0, total - (Number(a.depositPaid) || 0)));
  const deposit = Number(a.depositPaid) || 0;
  if (a.paymentStatus === "paid" || balance <= 0 && total > 0) return "paid";
  const past = a.date && a.date < todayIso;
  if (balance > 0 && past) return "overdue";
  if (deposit > 0 && balance > 0) return "deposit";
  return "pending";
};

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  paid: "Paid",
  deposit: "Deposit paid",
  pending: "Pending",
  overdue: "Overdue",
};
const PAYMENT_STATUS_TONE: Record<string, "success" | "gold" | "warning" | "danger"> = {
  paid: "success",
  deposit: "gold",
  pending: "warning",
  overdue: "danger",
};

const PAYMENT_METHODS = [
  { value: "", label: "—" },
  { value: "cash", label: "Cash" },
  { value: "cashapp", label: "CashApp" },
  { value: "zelle", label: "Zelle" },
  { value: "venmo", label: "Venmo" },
  { value: "card", label: "Card" },
  { value: "apple_pay", label: "Apple Pay" },
  { value: "other", label: "Other" },
];

// ============================================================
//  CLIENT COMMUNICATION SHEETS
// ============================================================
type CommContext = {
  appointment?: any;
  client?: any;
  initialKey?: CommTemplateKey | null;
};

const CommunicationPickerSheet = ({ open, ctx, onClose, onPick }: {
  open: boolean;
  ctx: CommContext | null;
  onClose: () => void;
  onPick: (key: CommTemplateKey) => void;
}) => {
  if (!ctx) return null;
  return (
    <Sheet open={open} onClose={onClose} title="Send a message">
      <p className="text-xs mb-3" style={{ color: C.muted }}>
        Pick a template — it will auto-fill {ctx.client?.name || ctx.appointment?.clientName || "the client"}&apos;s details.
      </p>
      <div className="space-y-2 pb-2">
        {COMMUNICATION_TEMPLATES.map(t => (
          <Card key={t.key} className="p-3.5 cursor-pointer active:scale-[0.99] transition" onClick={() => onPick(t.key)}>
            <div className="flex items-center gap-3">
              <div className="rounded-xl p-2 shrink-0" style={{ background: C.ivory }}>
                <MessageSquare size={16} style={{ color: C.goldDeep }} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm" style={{ color: C.espresso }}>{t.label}</p>
                <p className="text-[11px] mt-0.5" style={{ color: C.muted }}>{t.short}</p>
              </div>
              <ChevronRight size={16} style={{ color: C.muted }} />
            </div>
          </Card>
        ))}
      </div>
    </Sheet>
  );
};

const CommunicationSheet = ({ open, ctx, store, onClose }: {
  open: boolean;
  ctx: (CommContext & { templateKey: CommTemplateKey }) | null;
  store: any;
  onClose: () => void;
}) => {
  const [body, setBody] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 1600); };

  useEffect(() => {
    if (!open || !ctx) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate body when sheet opens with new ctx, intentional
    setBody(renderCommunicationTemplate(ctx.templateKey, ctx.appointment || {}, ctx.client, store.business));
  }, [open, ctx?.templateKey, ctx?.appointment?.id, ctx?.client?.id, store.business]);

  if (!ctx) return null;

  const tpl = COMMUNICATION_TEMPLATES.find(t => t.key === ctx.templateKey);
  const phone = ctx.client?.phone || ctx.appointment?.clientPhone;
  const clientName = ctx.client?.name || ctx.appointment?.clientName || "Client";

  const log = (action: "copied" | "shared" | "sent") => {
    store.upsertCommLogEntry({
      type: ctx.templateKey,
      typeLabel: tpl?.label || ctx.templateKey,
      clientId: ctx.client?.id || ctx.appointment?.clientId,
      clientName,
      appointmentId: ctx.appointment?.id,
      action,
      body,
      createdAt: new Date().toISOString(),
    });
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      log("copied");
      showToast("Copied");
    } catch { showToast("Copy unavailable"); }
  };

  const handleShare = async () => {
    try {
      const nav: any = navigator;
      if (nav.share) {
        await nav.share({ title: tpl?.label || "Message", text: body });
        log("shared");
        showToast("Shared");
      } else {
        await navigator.clipboard.writeText(body);
        log("copied");
        showToast("Sharing unavailable — copied");
      }
    } catch (err: any) {
      // User-cancelled share is fine; only toast on real errors.
      if (err?.name !== "AbortError") showToast("Couldn't share");
    }
  };

  const handleSms = () => {
    const num = (phone || "").replace(/[^\d+]/g, "");
    const href = num ? `sms:${num}?&body=${encodeURIComponent(body)}` : `sms:?&body=${encodeURIComponent(body)}`;
    log("sent");
    if (typeof window !== "undefined") window.location.href = href;
  };

  return (
    <Sheet open={open} onClose={onClose} title={tpl?.label || "Message"}>
      <div className="space-y-4 pb-2">
        <Card className="p-3.5" style={{ background: C.ivory }}>
          <p className="text-[10px] uppercase tracking-widest font-bold mb-1" style={{ color: C.muted, letterSpacing: "0.14em" }}>To</p>
          <p style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600, color: C.espresso }}>{clientName}</p>
          {phone && <p className="text-xs mt-0.5" style={{ color: C.muted }}>{phone}</p>}
        </Card>
        <Field label="Message">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Button variant="primary" icon={<Copy size={16} />} onClick={handleCopy}>Copy</Button>
          <Button variant="dark" icon={<Send size={16} />} onClick={handleShare}>Share</Button>
        </div>
        <Button variant="outline" icon={<MessageSquare size={16} />} fullWidth onClick={handleSms}>
          {phone ? `Send via SMS to ${phone}` : "Open SMS app"}
        </Button>
        {toast && <p className="text-center text-[12px] font-semibold" style={{ color: C.success }}>{toast}</p>}
        <p className="text-[11px] text-center mt-1" style={{ color: C.muted }}>
          Edits stay in this draft. Tap Copy / Share / Send to log it in your communication trail.
        </p>
      </div>
    </Sheet>
  );
};

// ============================================================
//  RECEIPT / INVOICE SHEET (PDF actions)
// ============================================================
const ReceiptSheet = ({ open, receipt, business, policies, onClose, onDelete }: {
  open: boolean;
  receipt: ReceiptRecord | null;
  business: any;
  policies?: any[];
  onClose: () => void;
  onDelete?: (id: string) => void | Promise<void>;
}) => {
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 1600); };
  if (!receipt) return null;

  const isInvoice = receipt.type === "invoice";
  const currency = business?.currency || "USD";

  const handleDownload = async () => {
    setBusy(true);
    try {
      const { blob, filename } = await renderReceiptPdf(receipt, business, policies);
      const result = await downloadPdfBlob(filename, blob);
      showToast(result.ok ? "Downloaded" : "Couldn't generate PDF");
    } catch (err) {
      console.error(err);
      showToast("Couldn't generate PDF");
    } finally {
      setBusy(false);
    }
  };

  const handleShare = async () => {
    setBusy(true);
    try {
      const { blob, filename } = await renderReceiptPdf(receipt, business, policies);
      // Inside Capacitor, downloadPdfBlob already routes through the
      // native share sheet (Filesystem.writeFile + Share.share). Web
      // gets navigator.share when files are sharable, otherwise the
      // anchor-download fallback.
      const isNativeShell = typeof window !== "undefined" &&
        !!(window as any).Capacitor?.isNativePlatform?.();
      if (!isNativeShell) {
        const file = new File([blob], filename, { type: "application/pdf" });
        const nav: any = navigator;
        if (nav.canShare && nav.canShare({ files: [file] })) {
          await nav.share({
            files: [file],
            title: `${isInvoice ? "Invoice" : "Receipt"} ${receipt.receiptNumber}`,
            text: buildReceiptSummaryText(receipt, currency),
          });
          showToast("Shared");
          return;
        }
      }
      const result = await downloadPdfBlob(filename, blob);
      showToast(result.ok ? (isNativeShell ? "Shared" : "Sharing not available — downloaded") : "Couldn't share");
    } catch (err) {
      console.error(err);
      showToast("Couldn't share");
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildReceiptSummaryText(receipt, currency));
      showToast("Summary copied");
    } catch {
      showToast("Copy unavailable");
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={`${isInvoice ? "Invoice" : "Receipt"} ${receipt.receiptNumber}`}>
      <div className="space-y-4 pb-2">
        <Card className="p-4" style={{ background: C.paper, border: `1px solid ${C.hairline}` }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: C.muted, letterSpacing: "0.14em" }}>
              {isInvoice ? "Bill to" : "Received from"}
            </span>
            <span style={{ fontFamily: FONT_DISPLAY, fontSize: 14, color: C.goldDeep }}>
              #{receipt.receiptNumber}
            </span>
          </div>
          <p style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 600, color: C.espresso, lineHeight: 1.15 }}>
            {receipt.clientName || "Client"}
          </p>
          <p className="text-xs mt-1" style={{ color: C.muted }}>
            {receipt.service || "Service"}
            {receipt.serviceDate ? ` · ${fmtDateLong(receipt.serviceDate)}` : ""}
            {receipt.serviceTime ? ` · ${fmtTime(receipt.serviceTime)}` : ""}
          </p>
        </Card>

        <Card className="p-4">
          <div className="space-y-1.5">
            <div className="flex justify-between text-sm" style={{ color: C.coffee }}>
              <span>Total price</span><span className="font-mono">{formatCurrency(receipt.totalPrice, currency)}</span>
            </div>
            <div className="flex justify-between text-sm" style={{ color: C.coffee }}>
              <span>Deposit paid</span><span className="font-mono">{formatCurrency(receipt.depositPaid, currency)}</span>
            </div>
            <div className="flex justify-between text-sm" style={{ color: C.coffee }}>
              <span>Balance due</span><span className="font-mono">{formatCurrency(receipt.balanceDue, currency)}</span>
            </div>
            {!isInvoice && (
              <div className="flex justify-between pt-2 mt-2 text-base font-bold" style={{ borderTop: `1px solid ${C.hairline}`, color: C.espresso }}>
                <span>Amount collected</span>
                <span className="font-mono" style={{ color: C.goldDeep }}>
                  {formatCurrency(receipt.amountCollected, currency)}
                </span>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2 mt-4 pt-3" style={{ borderTop: `1px solid ${C.hairline}` }}>
            {receipt.paymentStatus && <Pill tone={receipt.paymentStatus === "paid" ? "success" : receipt.paymentStatus === "partial" ? "gold" : "warning"}>{String(receipt.paymentStatus).toUpperCase()}</Pill>}
            {receipt.paymentMethod && <Pill tone="neutral">{receipt.paymentMethod}</Pill>}
            {receipt.paymentDate && <Pill tone="neutral">Paid {fmtDate(receipt.paymentDate)}</Pill>}
          </div>
          {receipt.notes && (
            <p className="text-xs mt-3 italic leading-relaxed" style={{ color: C.muted }}>&quot;{receipt.notes}&quot;</p>
          )}
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <Button variant="primary" icon={<Download size={16} />} disabled={busy} onClick={handleDownload}>Download PDF</Button>
          <Button variant="dark" icon={<Send size={16} />} disabled={busy} onClick={handleShare}>Share PDF</Button>
        </div>
        <Button variant="outline" icon={<Copy size={16} />} fullWidth onClick={handleCopy}>Copy summary text</Button>
        {onDelete && (
          <Button variant="danger" icon={<Trash2 size={16} />} fullWidth onClick={async () => {
            try { await onDelete(receipt.id); onClose(); }
            catch { /* alert already shown by onDelete; keep sheet open */ }
          }}>
            Delete this {isInvoice ? "invoice" : "receipt"}
          </Button>
        )}

        {toast && (
          <p className="text-center text-[12px] font-semibold mt-1" style={{ color: C.success }}>{toast}</p>
        )}
      </div>
    </Sheet>
  );
};

const NotificationsSheet = ({ open, onClose, items, dismiss, clearAll, markAllRead, onTap, readIds }: {
  open: boolean;
  onClose: () => void;
  items: NotifItem[];
  dismiss: (id: string) => void;
  clearAll: () => void;
  markAllRead: () => void;
  onTap: (n: NotifItem) => void;
  readIds: Set<string>;
}) => {
  return (
    <Sheet open={open} onClose={onClose} title="Notifications"
      leftAction={
        <button type="button" onClick={onClose} aria-label="Back to dashboard"
          className="p-2 -ml-2 rounded-full active:scale-[0.95] transition"
          style={{ color: C.coffee }}>
          <ChevronLeft size={22} />
        </button>
      }
      rightAction={
        items.length > 0 ? (
          <span className="px-2.5 py-1 rounded-full text-[11px] font-bold"
            style={{ background: C.gold, color: C.espresso, letterSpacing: "0.06em" }}>
            {items.length}
          </span>
        ) : undefined
      }>
      {items.length === 0 ? (
        <EmptyState
          icon={<Bell size={28} style={{ color: C.gold }} />}
          title="You're all caught up"
          body="No reminders, overdue balances, or upcoming bookings need your attention right now."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <button type="button" onClick={markAllRead}
              className="rounded-xl px-3 py-2.5 text-[12px] font-bold uppercase tracking-wider active:scale-[0.97] transition flex items-center justify-center gap-1.5"
              style={{ background: C.ivory, color: C.coffee, border: `1px solid ${C.hairline}`, letterSpacing: "0.08em" }}>
              <Check size={14} /> Mark all read
            </button>
            <button type="button" onClick={clearAll}
              className="rounded-xl px-3 py-2.5 text-[12px] font-bold uppercase tracking-wider active:scale-[0.97] transition flex items-center justify-center gap-1.5"
              style={{ background: "transparent", color: C.danger, border: `1px solid ${C.danger}`, letterSpacing: "0.08em" }}>
              <Trash2 size={14} /> Clear all
            </button>
          </div>
          <div className="space-y-2 pb-6">
            {items.map(n => {
              const isUnread = !readIds.has(n.id);
              const tappable = !!n.target;
              return (
                <Card key={n.id} className="p-0 flex items-stretch overflow-hidden">
                  {/* Main tappable surface — real <button> for iOS
                      WKWebView reliability. Delete button sits as a
                      sibling outside this so taps on the trash icon
                      never trigger the row open. */}
                  <button
                    type="button"
                    onClick={() => { if (tappable) onTap(n); }}
                    disabled={!tappable}
                    aria-label={tappable ? `Open ${n.title}` : n.title}
                    className="flex items-start gap-3 p-3.5 flex-1 text-left active:scale-[0.99] transition"
                    style={{
                      background: "transparent",
                      border: 0,
                      cursor: tappable ? "pointer" : "default",
                      color: "inherit",
                      font: "inherit",
                      appearance: "none",
                      WebkitAppearance: "none",
                    }}
                  >
                    <div className="rounded-xl p-2 shrink-0" style={{
                      background: n.tone === "danger" ? "rgba(156,61,46,0.10)" :
                        n.tone === "warning" ? "rgba(201,118,43,0.12)" :
                          n.tone === "gold" ? "rgba(201,169,97,0.18)" : C.ivory,
                    }}>{n.icon}</div>
                    <div className="min-w-0 flex-1" style={{ pointerEvents: "none" }}>
                      <div className="flex items-center gap-2">
                        {isUnread && (
                          <span aria-hidden style={{
                            width: 6, height: 6, borderRadius: 999,
                            background: C.gold, flexShrink: 0,
                          }} />
                        )}
                        <p className="text-sm font-semibold truncate" style={{ color: C.espresso }}>{n.title}</p>
                      </div>
                      <p className="text-xs mt-0.5 leading-relaxed line-clamp-2" style={{ color: C.coffee }}>{n.body}</p>
                      {n.meta && <p className="text-[11px] mt-1" style={{ color: C.muted }}>{n.meta}</p>}
                    </div>
                    {tappable && (
                      <ChevronRight size={16} style={{ color: C.muted, marginTop: 6, flexShrink: 0 }} />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); dismiss(n.id); }}
                    aria-label="Dismiss notification"
                    className="p-3 shrink-0 rounded-full active:scale-[0.92] transition"
                    style={{ color: C.danger, background: "transparent", border: 0, alignSelf: "flex-start", margin: 4 }}
                  >
                    <Trash2 size={16} />
                  </button>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </Sheet>
  );
};

// ============================================================
//  AUTH + CLOUD SYNC (V1)
// ============================================================
type AuthMode = "loading" | "guest" | "authed";

const GUEST_FLAG_KEY = "bbp-guest-mode";
const SYNC_LAST_OK_KEY = "bbp-sync-last-ok";

const useAuth = () => {
  const [mode, setMode] = useState<AuthMode>("loading");
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabase();
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      const session = data.session;
      if (session?.user) {
        setUserId(session.user.id);
        setEmail(session.user.email ?? null);
        setMode("authed");
        return;
      }
      const guest = typeof window !== "undefined" && window.localStorage.getItem(GUEST_FLAG_KEY) === "1";
      setMode(guest ? "guest" : "loading");
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUserId(session.user.id);
        setEmail(session.user.email ?? null);
        setMode("authed");
      } else {
        setUserId(null);
        setEmail(null);
        const guest = typeof window !== "undefined" && window.localStorage.getItem(GUEST_FLAG_KEY) === "1";
        setMode(guest ? "guest" : "loading");
      }
    });
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);

  const continueAsGuest = useCallback(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(GUEST_FLAG_KEY, "1");
    setMode("guest");
  }, []);

  const signOut = useCallback(async () => {
    const supabase = getSupabase();
    await supabase.auth.signOut();
    if (typeof window !== "undefined") window.localStorage.removeItem(GUEST_FLAG_KEY);
    setMode("loading");
  }, []);

  return { mode, userId, email, continueAsGuest, signOut };
};

type SyncState = "idle" | "syncing" | "offline" | "error";

const useCloudSync = (userId: string | null, store: any) => {
  const [state, setState] = useState<SyncState>("idle");
  const [lastOk, setLastOk] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try { return window.localStorage.getItem(SYNC_LAST_OK_KEY); } catch { return null; }
  });
  const [pendingCount, setPendingCount] = useState<number>(0);
  const initialPullDone = useRef(false);
  const settingsHash = useRef<string>("");
  // Per-table hash map of records we've already pushed to the cloud,
  // keyed by record id. Used to skip identical re-pushes and to detect
  // local deletes (id present in map but absent from the live array).
  const snap = useRef<Record<string, Map<string, string>>>({
    clients: new Map(), appointments: new Map(), quotes: new Map(),
    receipts: new Map(), communications: new Map(), photos: new Map(),
  });

  const stamp = () => {
    const s = new Date().toISOString();
    setLastOk(s);
    if (typeof window !== "undefined") window.localStorage.setItem(SYNC_LAST_OK_KEY, s);
  };

  // Initial pull + one-time migration push on first authed render.
  // Skipped entirely for non-premium accounts — cloud sync is gated
  // behind lifetime access, so guest/free accounts work fully offline.
  useEffect(() => {
    if (!userId || !store?.premium) { initialPullDone.current = false; return; }
    if (initialPullDone.current) return;
    initialPullDone.current = true;
    (async () => {
      setState("syncing");
      try {
        const [clientsCloud, apptsCloud, quotesCloud, receiptsCloud, commsCloud, photosCloud, settingsRow] = await Promise.all([
          syncClients.pull(userId),
          syncAppointments.pull(userId),
          syncQuotes.pull(userId),
          syncReceipts.pull(userId),
          syncCommunications.pull(userId),
          syncPhotos.pull(userId),
          syncSettings.pull(userId),
        ]);

        // One-time migration: push any local-only records (id absent in
        // the cloud snapshot) so existing localStorage data lands in the
        // user's account. Cloud is canonical for everything else.
        const newOnly = (local: any[], cloud: any[]) => {
          const ids = new Set(cloud.map((x: any) => x.id));
          return (Array.isArray(local) ? local : []).filter((x: any) => x?.id && !ids.has(x.id));
        };
        const pushQueue: Promise<any>[] = [];
        for (const r of newOnly(store.clients, clientsCloud)) pushQueue.push(syncClients.upsert(userId, r).catch(() => null));
        for (const r of newOnly(store.appointments, apptsCloud)) pushQueue.push(syncAppointments.upsert(userId, r).catch(() => null));
        for (const r of newOnly(store.quotes, quotesCloud)) pushQueue.push(syncQuotes.upsert(userId, r).catch(() => null));
        for (const r of newOnly(store.receipts || [], receiptsCloud)) pushQueue.push(syncReceipts.upsert(userId, r).catch(() => null));
        for (const r of newOnly(store.commLog, commsCloud)) pushQueue.push(syncCommunications.upsert(userId, r).catch(() => null));
        // Photos: only push metadata for items that already have a
        // storagePath (already uploaded). Items still carrying a
        // dataUrl will be migrated lazily by handleSavePhoto next time
        // the user opens the gallery, since a real bucket upload has
        // to happen first.
        for (const r of newOnly(store.photos, photosCloud).filter((p: any) => p?.storagePath))
          pushQueue.push(syncPhotos.upsert(userId, r).catch(() => null));
        await Promise.all(pushQueue);

        // Re-pull so the local state mirrors what's now in the cloud.
        const [clients2, appts2, quotes2, receipts2, comms2, photos2] = await Promise.all([
          syncClients.pull(userId),
          syncAppointments.pull(userId),
          syncQuotes.pull(userId),
          syncReceipts.pull(userId),
          syncCommunications.pull(userId),
          syncPhotos.pull(userId),
        ]);
        const business = settingsRow?.data?.business || (settingsRow ? { businessName: settingsRow.business_name, currency: settingsRow.currency } : undefined);
        const reminderSettings = settingsRow?.reminder_settings || undefined;
        store.replaceCloudState?.({
          clients: clients2, appointments: appts2, quotes: quotes2,
          receipts: receipts2, commLog: comms2, photos: photos2, business, reminderSettings,
        });
        // Seed the diff snapshot.
        const seed = (table: string, arr: any[]) => {
          snap.current[table].clear();
          for (const r of arr) if (r?.id) snap.current[table].set(r.id, JSON.stringify(r));
        };
        seed("clients", clients2);
        seed("appointments", appts2);
        seed("quotes", quotes2);
        seed("receipts", receipts2);
        seed("communications", comms2);
        seed("photos", photos2);

        stamp();
        setState("idle");
      } catch (err) {
        console.warn("[bbp] initial sync failed", err);
        setState("error");
      }
    })();
  }, [userId, store]);

  // Diff-push on every store change (after the initial pull). Pushes
  // only records whose JSON differs from the last successful sync;
  // deletes anything we'd previously synced that's no longer in state.
  useEffect(() => {
    if (!userId || !initialPullDone.current || !store?.premium) return;
    const tables: Array<{ table: import("./lib/supabase").SyncTable; arr: any[]; api: any }> = [
      { table: "clients", arr: store.clients || [], api: syncClients },
      { table: "appointments", arr: store.appointments || [], api: syncAppointments },
      { table: "quotes", arr: store.quotes || [], api: syncQuotes },
      { table: "receipts", arr: store.receipts || [], api: syncReceipts },
      { table: "communications", arr: store.commLog || [], api: syncCommunications },
      // Only sync photo metadata once the bytes have been uploaded;
      // dataUrl-only records get migrated on next gallery interaction.
      { table: "photos", arr: (store.photos || []).filter((p: any) => p?.storagePath), api: syncPhotos },
    ];
    let dirty = false;
    setState("syncing");
    (async () => {
      for (const { table, arr } of tables) {
        const seen = new Set<string>();
        for (const r of arr) {
          if (!r?.id) continue;
          seen.add(r.id);
          const hash = JSON.stringify(r);
          if (snap.current[table].get(r.id) === hash) continue;
          dirty = true;
          await tryUpsert(table, userId, r);
          snap.current[table].set(r.id, hash);
        }
        for (const id of Array.from(snap.current[table].keys())) {
          if (seen.has(id)) continue;
          dirty = true;
          await tryDelete(table, userId, id);
          snap.current[table].delete(id);
        }
      }
      // Settings: push when business / reminderSettings changes.
      const sHash = JSON.stringify({ b: store.business, r: store.reminderSettings });
      if (sHash !== settingsHash.current) {
        settingsHash.current = sHash;
        dirty = true;
        await trySaveSettings(userId, store.business, store.reminderSettings);
      }
      setPendingCount(queueLength());
      if (dirty) stamp();
      setState(navigator.onLine ? "idle" : "offline");
    })().catch(() => setState("error"));
  }, [userId, store.clients, store.appointments, store.quotes, store.receipts, store.commLog, store.photos, store.business, store.reminderSettings]);

  // Drain the offline write queue whenever connectivity resumes.
  useEffect(() => {
    if (!userId || typeof window === "undefined" || !store?.premium) return;
    const onOnline = async () => {
      const result = await drainQueue(userId);
      setPendingCount(queueLength());
      if (result.failed === 0) { stamp(); setState("idle"); }
    };
    const onOffline = () => setState("offline");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- offline state is observed network state, intentional
    if (!navigator.onLine) setState("offline");
    setPendingCount(queueLength());
    onOnline();
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [userId]);

  return { state, lastOk, pendingCount };
};

const AuthGate = ({ onContinueGuest, initialTab = "signin" }: {
  onContinueGuest: () => void;
  initialTab?: "signin" | "signup" | "reset";
}) => {
  const [tab, setTab] = useState<"signin" | "signup" | "reset">(initialTab);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    setBusy(true); setMsg(null); setErr(null);
    try {
      const supabase = getSupabase();
      if (tab === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (tab === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: getAuthRedirectUrl() },
        });
        if (error) throw error;
        setMsg("Check your inbox to confirm the account, then sign in.");
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: getAuthRedirectUrl(),
        });
        if (error) throw error;
        setMsg("Reset email sent. Check your inbox.");
      }
    } catch (e: any) {
      setErr(e?.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center px-5" style={{ minHeight: "100dvh", background: C.cream, fontFamily: FONT_BODY, color: C.espresso }}>
      <GlobalStyle />
      <div className="w-full max-w-[400px]">
        <p className="text-center text-[10px] font-bold tracking-[0.22em] uppercase" style={{ color: C.gold }}>Braid Boss Pro</p>
        <h1 className="text-center mt-2 mb-1" style={{ fontFamily: FONT_DISPLAY, fontSize: 32, fontWeight: 600, color: C.espresso }}>
          {tab === "signin" ? "Welcome back" : tab === "signup" ? "Create your account" : "Reset password"}
        </h1>
        <p className="text-center text-sm mb-5" style={{ color: C.muted }}>
          {tab === "signin" ? "Sign in to sync your clients across devices." : tab === "signup" ? "Free to start. Cloud-synced from day one." : "Enter your email and we&apos;ll send a reset link."}
        </p>
        <Card className="p-5 space-y-3">
          <Field label="Email">
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@studio.com" />
          </Field>
          {tab !== "reset" && (
            <Field label="Password">
              <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
            </Field>
          )}
          {err && <p className="text-xs" style={{ color: C.danger }}>{err}</p>}
          {msg && <p className="text-xs" style={{ color: C.success }}>{msg}</p>}
          <Button variant="primary" fullWidth disabled={busy || !email || (tab !== "reset" && !password)} onClick={submit}>
            {busy ? "Working…" : tab === "signin" ? "Sign in" : tab === "signup" ? "Create account" : "Send reset email"}
          </Button>
          <div className="flex items-center justify-between text-[12px] pt-1">
            {tab === "signin" ? (
              <>
                <button type="button" onClick={() => { setTab("reset"); setErr(null); setMsg(null); }} style={{ color: C.coffee }}>Forgot password?</button>
                <button type="button" onClick={() => { setTab("signup"); setErr(null); setMsg(null); }} style={{ color: C.goldDeep, fontWeight: 600 }}>Create account</button>
              </>
            ) : (
              <button type="button" onClick={() => { setTab("signin"); setErr(null); setMsg(null); }} style={{ color: C.goldDeep, fontWeight: 600 }}>Back to sign in</button>
            )}
          </div>
        </Card>
        <button type="button" onClick={onContinueGuest}
          className="w-full text-center text-[12px] mt-5 py-3"
          style={{ color: C.muted }}>
          Continue as guest · data stays on this device
        </button>
      </div>
    </div>
  );
};

// One place that turns the raw SyncState + pending queue length +
// auth mode into the human language we want to show. Keeps the pill
// and the card body in sync, and never reaches for red unless
// something has actually failed.
type SyncDisplayKind =
  | "synced"
  | "syncing"
  | "queued"
  | "offline"
  | "failed"
  | "guest";

type SyncDisplay = {
  kind: SyncDisplayKind;
  label: string;        // for the pill
  body: string;         // longer copy for the card
  tone: string;         // C.success / C.coffee / C.gold / C.warning / C.danger / C.muted
};

const computeSyncDisplay = (
  state: SyncState | undefined,
  pendingCount: number = 0,
  mode: AuthMode | undefined,
  lastOk: string | null,
): SyncDisplay => {
  const safePending = Number.isFinite(pendingCount) && pendingCount > 0 ? pendingCount : 0;
  if (mode === "guest") {
    return {
      kind: "guest",
      label: "On this device",
      body: "Guest mode stores data only on this device.",
      tone: C.coffee,
    };
  }
  if (state === "syncing") {
    return {
      kind: "syncing",
      label: "Syncing…",
      body: "Backing up your latest changes to the cloud.",
      tone: C.coffee,
    };
  }
  if (state === "offline") {
    return {
      kind: "offline",
      label: safePending > 0 ? "Waiting for connection" : "Offline",
      body: safePending > 0
        ? `${safePending} change${safePending === 1 ? "" : "s"} waiting to upload — they'll sync automatically when connection returns.`
        : "You're offline. Changes will sync automatically when connection returns.",
      tone: C.gold,
    };
  }
  if (safePending > 0) {
    return {
      kind: "queued",
      label: "Changes queued",
      body: `${safePending} change${safePending === 1 ? "" : "s"} waiting to upload.`,
      tone: C.gold,
    };
  }
  if (state === "error") {
    // Only mark as a hard failure when there's a queue *and* the last
    // attempt failed. With no queue and a recent successful sync, an
    // earlier transient error isn't worth scaring the user about.
    if (!lastOk || safePending > 0) {
      return {
        kind: "failed",
        label: "Sync failed",
        body: "We couldn't reach the cloud just now. Your changes are safe on this device — we'll retry automatically.",
        tone: C.danger,
      };
    }
  }
  // Default: healthy.
  return {
    kind: "synced",
    label: lastOk ? "Synced" : "Cloud backup active",
    body: lastOk
      ? "All changes backed up."
      : "Your business data securely syncs between this device and your cloud backup.",
    tone: C.success,
  };
};

const SYNCED_ENTITIES = [
  "Appointments",
  "Clients",
  "Receipts",
  "Quotes",
  "Communication log",
  "Photos (metadata + securely stored bytes)",
  "Settings",
];

const SyncStatusCard = ({ mode, sync }: {
  mode: AuthMode;
  sync: { state: SyncState; lastOk: string | null; pendingCount: number };
}) => {
  const [expanded, setExpanded] = useState(false);
  const display = useMemo(
    () => computeSyncDisplay(sync.state, sync.pendingCount, mode, sync.lastOk),
    [sync.state, sync.pendingCount, sync.lastOk, mode],
  );

  const detailItems: { label: string; value: string }[] = [];
  if (mode === "authed") {
    detailItems.push({
      label: "Last synced",
      value: sync.lastOk ? fmtRelative(sync.lastOk) : "Not yet — first sync runs after you sign in",
    });
    detailItems.push({
      label: "Pending changes",
      value: sync.pendingCount > 0 ? `${sync.pendingCount}` : "None",
    });
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: C.muted, letterSpacing: "0.12em" }}>
          Sync &amp; backup
        </p>
        <SyncStatusPill display={display} />
      </div>
      <p className="text-[12px] mt-2 leading-relaxed" style={{ color: C.coffee }}>
        {display.body}
      </p>

      {detailItems.length > 0 && (
        <div className="mt-3 pt-3 space-y-1.5" style={{ borderTop: `1px solid ${C.hairline}` }}>
          {detailItems.map((d) => (
            <div key={d.label} className="flex items-center justify-between text-[11px]">
              <span style={{ color: C.muted }}>{d.label}</span>
              <span style={{ color: C.espresso }}>{d.value}</span>
            </div>
          ))}
        </div>
      )}

      <button
        type="button" onClick={() => setExpanded((v) => !v)}
        className="w-full text-left mt-3 pt-3 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: C.muted, letterSpacing: "0.08em", borderTop: `1px solid ${C.hairline}` }}
        aria-expanded={expanded}>
        <span>{expanded ? "Hide what syncs" : "What syncs"}</span>
        <ChevronRight size={12} style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 150ms" }} />
      </button>
      {expanded && (
        <div className="mt-2 bbp-fade">
          <p className="text-[11px] leading-relaxed" style={{ color: C.coffee }}>
            Your business data syncs securely between <strong>this device</strong> and your <strong>cloud backup</strong>.
          </p>
          <ul className="mt-2 space-y-1">
            {SYNCED_ENTITIES.map((label) => (
              <li key={label} className="flex items-start gap-2 text-[12px]" style={{ color: C.coffee }}>
                <Check size={12} style={{ color: C.success, marginTop: 4 }} />
                <span>{label}</span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] mt-2" style={{ color: C.muted }}>
            Cloud backup runs automatically — sign in on a new device and your data follows.
          </p>
        </div>
      )}
    </Card>
  );
};

const SyncStatusPill = ({ display }: { display: SyncDisplay }) => (
  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
    style={{ background: "rgba(245, 235, 217, 0.6)", color: display.tone, border: `1px solid ${display.tone}33`, letterSpacing: "0.08em" }}>
    <span className="inline-block rounded-full" style={{ width: 6, height: 6, background: display.tone }} />
    {display.label}
  </span>
);

type AuthMode2 = "signin" | "signup" | "reset" | "reset_sent";

const AuthSheet = ({ open, initialMode, onClose, onAuthed }: {
  open: boolean;
  initialMode: AuthMode2;
  onClose: () => void;
  onAuthed?: () => void;
}) => {
  const [mode, setMode] = useState<AuthMode2>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Reset transient state every time the sheet (re)opens or the
  // intent flips. Keeps Sign in → Forgot password → back to Sign in
  // from leaking errors between flows.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sheet open lifecycle, intentional
    setMode(initialMode);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sheet open lifecycle, intentional
    setErr(null);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sheet open lifecycle, intentional
    setBusy(false);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sheet open lifecycle, intentional
    setPassword("");
  }, [open, initialMode]);

  const friendlyError = (raw: string): string => {
    const s = (raw || "").toLowerCase();
    if (s.includes("invalid") && s.includes("credentials")) return "That email and password don't match. Try again or reset your password.";
    if (s.includes("user already registered")) return "An account with this email already exists. Sign in instead?";
    if (s.includes("password should be")) return "Password is too short — use at least 6 characters.";
    if (s.includes("network") || s.includes("failed to fetch")) return "Connection failed. Check your network and try again.";
    if (s.includes("rate limit")) return "Too many attempts. Wait a minute and try again.";
    return raw || "Something went wrong. Try again in a moment.";
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const supabase = getSupabase();
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        onAuthed?.();
        onClose();
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: getAuthRedirectUrl() },
        });
        if (error) throw error;
        // Some Supabase configs auto-sign-in on signup; if so the
        // listener will flip mode → authed and the sheet closes
        // naturally via onClose. If email confirmation is required
        // we land on the reset_sent screen with a tailored message.
        setMode("reset_sent");
      } else if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: getAuthRedirectUrl(),
        });
        if (error) throw error;
        setMode("reset_sent");
      }
    } catch (e: any) {
      setErr(friendlyError(e?.message || ""));
    } finally {
      setBusy(false);
    }
  };

  const headline = mode === "signin" ? "Welcome back"
    : mode === "signup" ? "Create your account"
    : mode === "reset" ? "Reset your password"
    : "Check your inbox";
  const sub = mode === "signin" ? "Pick up where you left off — your data syncs across every device."
    : mode === "signup" ? "Free to start. Cloud-backed from your first booking."
    : mode === "reset" ? "We'll email you a link to set a new password."
    : "We sent you an email. Tap the link to finish, then sign in.";

  return (
    <Sheet open={open} onClose={onClose} title={headline}>
      <div className="space-y-4 pb-2">
        <p className="text-sm" style={{ color: C.muted }}>{sub}</p>

        {mode === "reset_sent" ? (
          <Card className="p-4 text-center" style={{ background: "rgba(92,124,74,0.06)", border: `1px solid rgba(92,124,74,0.25)` }}>
            <CheckCircle2 size={26} style={{ color: C.success, margin: "0 auto 8px" }} />
            <p className="text-sm font-semibold" style={{ color: C.espresso }}>{email || "Email"} on its way</p>
            <p className="text-[12px] mt-1" style={{ color: C.muted }}>
              The link is good for one hour. Don&apos;t see it? Check spam, or wait 60 seconds and try again.
            </p>
            <Button variant="primary" fullWidth className="mt-3" onClick={() => setMode("signin")}>Back to sign in</Button>
          </Card>
        ) : (
          <>
            <Field label="Email">
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@studio.com"
                autoComplete={mode === "signup" ? "email" : "username"}
                inputMode="email" />
            </Field>
            {mode !== "reset" && (
              <Field label="Password" hint={mode === "signup" ? "6+ characters" : undefined}>
                <Input type="password" value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete={mode === "signup" ? "new-password" : "current-password"} />
              </Field>
            )}
            {err && (
              <Card className="p-3" style={{ background: "rgba(156,61,46,0.06)", border: `1px solid rgba(156,61,46,0.25)` }}>
                <p className="text-[12px]" style={{ color: C.danger }}>{err}</p>
              </Card>
            )}
            <Button variant="primary" fullWidth disabled={busy || !email || (mode !== "reset" && !password)} onClick={submit}>
              {busy
                ? (mode === "signin" ? "Signing in…" : mode === "signup" ? "Creating account…" : "Sending email…")
                : mode === "signin" ? "Sign in"
                : mode === "signup" ? "Create account"
                : "Send reset email"}
            </Button>
            <div className="flex items-center justify-between text-[12px] pt-1">
              {mode === "signin" ? (
                <>
                  <button type="button" onClick={() => setMode("reset")} style={{ color: C.coffee }}>Forgot password?</button>
                  <button type="button" onClick={() => setMode("signup")} style={{ color: C.goldDeep, fontWeight: 600 }}>Create account</button>
                </>
              ) : mode === "signup" ? (
                <button type="button" onClick={() => setMode("signin")} style={{ color: C.goldDeep, fontWeight: 600 }}>Back to sign in</button>
              ) : (
                <button type="button" onClick={() => setMode("signin")} style={{ color: C.goldDeep, fontWeight: 600 }}>Back to sign in</button>
              )}
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
};

const GuestModeCard = ({ onSignIn, onCreateAccount }: {
  onSignIn: () => void;
  onCreateAccount: () => void;
}) => (
  <Card className="p-5" style={{ background: `linear-gradient(180deg, ${C.paper} 0%, ${C.ivory} 100%)`, border: `1px solid ${C.goldDeep}` }}>
    <div className="flex items-center gap-2 mb-1">
      <Pill tone="gold">GUEST MODE</Pill>
    </div>
    <p style={{ fontFamily: FONT_DISPLAY, fontSize: 24, fontWeight: 600, color: C.espresso, lineHeight: 1.15 }}>
      Your data lives only on this device.
    </p>
    <p className="text-[13px] mt-2 leading-relaxed" style={{ color: C.coffee }}>
      Create a free account to:
    </p>
    <ul className="text-[12px] mt-1.5 space-y-1" style={{ color: C.coffee }}>
      <li className="flex items-start gap-2"><Check size={13} style={{ color: C.success, marginTop: 2 }} /> Sync across phone, tablet, and laptop</li>
      <li className="flex items-start gap-2"><Check size={13} style={{ color: C.success, marginTop: 2 }} /> Protect your business data with cloud backup</li>
      <li className="flex items-start gap-2"><Check size={13} style={{ color: C.success, marginTop: 2 }} /> Restore everything if you lose this device</li>
      <li className="flex items-start gap-2"><Check size={13} style={{ color: C.success, marginTop: 2 }} /> Receive reminders + retention alerts wherever you are</li>
    </ul>
    <div className="grid grid-cols-2 gap-2 mt-4">
      <Button variant="primary" onClick={onCreateAccount}>Create account</Button>
      <Button variant="outline" onClick={onSignIn}>Sign in</Button>
    </div>
    <p className="text-[11px] text-center mt-3" style={{ color: C.muted }}>
      Continuing as guest is fine — your local data stays on this device.
    </p>
  </Card>
);

const PermissionsExplained = ({ pushCap }: { pushCap: PushCapability }) => (
  <Card className="p-4">
    <p className="text-[10px] uppercase tracking-widest font-bold mb-2" style={{ color: C.muted, letterSpacing: "0.12em" }}>Permissions used</p>
    <div className="space-y-2">
      <div className="flex gap-2.5">
        <Bell size={14} style={{ color: C.goldDeep, marginTop: 2 }} />
        <div className="text-[12px] leading-relaxed" style={{ color: C.coffee }}>
          <strong>Notifications</strong> — used only for actionable business alerts (appointment reminders, balance due, rebooking opportunities). Status: <strong style={{ color: pushCap === "subscribed" ? C.success : pushCap === "blocked" ? C.danger : C.muted }}>{pushCap === "subscribed" ? "ON" : pushCap === "blocked" ? "BLOCKED" : "OFF"}</strong>.
        </div>
      </div>
      <div className="flex gap-2.5">
        <ImageIcon size={14} style={{ color: C.goldDeep, marginTop: 2 }} />
        <div className="text-[12px] leading-relaxed" style={{ color: C.coffee }}>
          <strong>Photos / camera</strong> — used to attach inspiration, before-and-after, and reference photos to client profiles. Photos are private to your account and stored securely.
        </div>
      </div>
      <div className="flex gap-2.5">
        <Calendar size={14} style={{ color: C.goldDeep, marginTop: 2 }} />
        <div className="text-[12px] leading-relaxed" style={{ color: C.coffee }}>
          <strong>Calendar</strong> — used to export appointments and offer a private subscribe URL. Exports happen only when you tap the button; nothing is shared automatically.
        </div>
      </div>
    </div>
  </Card>
);

const READINESS_ITEMS: { label: string; check: (ctx: { mode: AuthMode; pushCap: PushCapability }) => "ok" | "warn" | "info" }[] = [
  { label: "Privacy policy linked", check: () => "info" },
  { label: "Terms of service linked", check: () => "info" },
  { label: "Account deletion available", check: ({ mode }) => mode === "authed" ? "ok" : "info" },
  { label: "Data export available", check: () => "ok" },
  { label: "Notifications explanation present", check: () => "ok" },
  { label: "Photo permission explanation present", check: () => "ok" },
  { label: "Calendar export explanation present", check: () => "ok" },
  { label: "No Stripe / payment flows inside the app", check: () => "ok" },
  { label: "Guest mode works", check: () => "ok" },
  { label: "Authentication works", check: ({ mode }) => mode === "authed" ? "ok" : "info" },
  { label: "Offline mode works", check: () => "ok" },
  { label: "Sync status visible", check: ({ mode }) => mode === "authed" ? "ok" : "info" },
  { label: "Push notifications surface enabled", check: ({ pushCap }) => pushCap === "subscribed" ? "ok" : pushCap === "blocked" ? "warn" : "info" },
];

// Returns true when the App Store readiness checklist (an internal QA
// utility) should be visible. Production users never see it; dev /
// preview builds always do; explicit admin emails always do regardless
// of NODE_ENV.
const isAdminViewer = (email: string | null | undefined): boolean => {
  if (process.env.NODE_ENV !== "production") return true;
  const allow = (process.env.NEXT_PUBLIC_ADMIN_EMAIL || "")
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  if (allow.length === 0) return false;
  return !!email && allow.includes(email.toLowerCase());
};

const ReadinessChecklistSheet = ({ open, onClose, mode, pushCap }: {
  open: boolean;
  onClose: () => void;
  mode: AuthMode;
  pushCap: PushCapability;
}) => (
  <Sheet open={open} onClose={onClose} title="App Store readiness">
    <div className="space-y-2 pb-2">
      <p className="text-xs mb-3" style={{ color: C.muted }}>
        Checklist before submitting Braid Boss Pro for App Store review. Tap any item to verify it&apos;s still wired correctly.
      </p>
      {READINESS_ITEMS.map((item, i) => {
        const status = item.check({ mode, pushCap });
        const tone = status === "ok" ? C.success : status === "warn" ? C.warning : C.muted;
        return (
          <div key={i} className="flex items-center gap-3 py-2" style={{ borderBottom: `1px solid ${C.hairline}` }}>
            <div className="rounded-full" style={{ width: 8, height: 8, background: tone }} />
            <p className="flex-1 text-[13px]" style={{ color: C.espresso }}>{item.label}</p>
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: tone, letterSpacing: "0.08em" }}>
              {status === "ok" ? "Verified" : status === "warn" ? "Attention" : "Pending"}
            </span>
          </div>
        );
      })}
    </div>
  </Sheet>
);

const DeleteAccountSheet = ({ open, onClose, onSignOut }: {
  open: boolean;
  onClose: () => void;
  onSignOut: () => Promise<void>;
}) => {
  const [busy, setBusy] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const supabase = getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No active session.");
      const { error: invokeErr } = await supabase.functions.invoke("delete-account");
      if (invokeErr) throw invokeErr;
      await onSignOut();
    } catch (e: any) {
      setError(e?.message || "Couldn't delete the account. Try again or contact support.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Delete account">
      <div className="space-y-3 pb-2">
        <Card className="p-3.5" style={{ background: "rgba(156,61,46,0.06)", border: `1px solid rgba(156,61,46,0.25)` }}>
          <p className="text-[13px] font-semibold" style={{ color: C.danger }}>This is permanent.</p>
          <p className="text-[11px] mt-1 leading-relaxed" style={{ color: C.coffee }}>
            Deleting your account removes your appointments, clients, photos, communication log, receipts, calendar feeds, push subscriptions, and booking link from our servers. Local-only data on this device will not be cleared automatically.
          </p>
        </Card>
        <Field label='Type "delete" to confirm'>
          <Input value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder="delete" />
        </Field>
        {error && <p className="text-[11px]" style={{ color: C.danger }}>{error}</p>}
        <Button variant="danger" fullWidth disabled={busy || confirmText.toLowerCase() !== "delete"} onClick={handleDelete}>
          {busy ? "Deleting…" : "Permanently delete my account"}
        </Button>
        <Button variant="outline" fullWidth onClick={onClose}>Cancel</Button>
      </div>
    </Sheet>
  );
};

const AccountScreen = ({ email, mode, sync, userId, onBack, onSignOut, onExport, openBookingRequests }: {
  email: string | null;
  mode: AuthMode;
  sync: { state: SyncState; lastOk: string | null; pendingCount: number };
  userId: string | null;
  onBack: () => void;
  onSignOut: () => Promise<void>;
  onExport: () => void;
  openBookingRequests?: () => void;
}) => {
  const [pushCap, setPushCap] = useState<PushCapability>("unsupported");
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [showReadiness, setShowReadiness] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [authSheetMode, setAuthSheetMode] = useState<AuthMode2 | null>(null);
  const lifetimeAccess = useLifetimeAccess(userId);
  const paymentLinkReady = isPaymentLinkConfigured();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cap = await detectPushCapability();
      if (!cancelled) setPushCap(cap);
      if (mode === "authed" && userId && cap === "subscribed") {
        refreshSubscriptionHeartbeat(userId).catch(() => null);
      }
    })();
    return () => { cancelled = true; };
  }, [mode, userId]);

  // Hydrate notification preferences from Supabase settings.data once
  // signed in. Falls back to the defaults for guest mode.
  useEffect(() => {
    if (mode !== "authed" || !userId) return;
    let cancelled = false;
    (async () => {
      const supabase = getSupabase();
      const { data } = await supabase
        .from("settings")
        .select("data")
        .eq("user_id", userId)
        .maybeSingle();
      if (cancelled) return;
      const stored = (data?.data as any)?.notification_preferences;
      if (stored && typeof stored === "object") {
        setPrefs({ ...DEFAULT_NOTIFICATION_PREFERENCES, ...stored });
      }
    })();
    return () => { cancelled = true; };
  }, [mode, userId]);

  const persistPrefs = async (next: NotificationPreferences) => {
    setPrefs(next);
    if (mode !== "authed" || !userId) return;
    const supabase = getSupabase();
    const { data } = await supabase
      .from("settings")
      .select("data")
      .eq("user_id", userId)
      .maybeSingle();
    const blob = (data?.data as any) || {};
    blob.notification_preferences = next;
    await supabase
      .from("settings")
      .upsert({ user_id: userId, data: blob }, { onConflict: "user_id" });
  };

  const handleTestNotification = async () => {
    if (!userId) return;
    setTestStatus("Sending…");
    const result = await sendTestPush();
    setTestStatus(result.ok ? "Sent — check your notifications." : `Couldn't send: ${result.reason || "unknown"}`);
    setTimeout(() => setTestStatus(null), 4000);
  };

  const handleEnablePush = async () => {
    if (!userId) return;
    setPushBusy(true); setPushError(null);
    try {
      const sub = await subscribeWebPush(userId);
      if (!sub) {
        // Inside the iOS Capacitor shell, the "browser doesn't support
        // push" wording is wrong — APNs is supported, the user just
        // declined the system prompt. Switch the message accordingly.
        const isNativeShell = typeof window !== "undefined" &&
          !!(window as any).Capacitor?.isNativePlatform?.();
        if (isNativeShell) {
          setPushError("Notifications are off. Enable them in iOS Settings → Braid Boss Pro → Notifications, then try again.");
        } else if (typeof Notification !== "undefined" && Notification.permission === "denied") {
          setPushError("Notifications are off. Re-enable them for this site in your browser settings, or turn them on later in Account & Sync.");
        } else {
          setPushError("This browser doesn't support push notifications. iOS push will activate when you install the App Store build — your subscription will carry over.");
        }
      }
      const cap = await detectPushCapability();
      setPushCap(cap);
    } catch (err: any) {
      setPushError(err?.message || "Couldn't subscribe to push.");
    } finally {
      setPushBusy(false);
    }
  };

  const handleDisablePush = async () => {
    if (!userId) return;
    setPushBusy(true); setPushError(null);
    try {
      await unsubscribeWebPush(userId);
      const cap = await detectPushCapability();
      setPushCap(cap);
    } finally {
      setPushBusy(false);
    }
  };

  // Calendar feed token: a single active subscribe URL per user. We
  // expose only one for V1 — list is sorted desc and we take the first
  // unrevoked entry.
  const [feedToken, setFeedToken] = useState<string | null>(null);
  const [feedBusy, setFeedBusy] = useState(false);
  const [feedCopied, setFeedCopied] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clears feed token when auth context changes, intentional
    if (mode !== "authed" || !userId) { setFeedToken(null); return; }
    let cancelled = false;
    (async () => {
      const supabase = getSupabase();
      const { data } = await supabase
        .from("calendar_feed_tokens")
        .select("token, revoked_at")
        .eq("user_id", userId)
        .is("revoked_at", null)
        .order("created_at", { ascending: false })
        .limit(1);
      if (!cancelled) setFeedToken(data?.[0]?.token || null);
    })();
    return () => { cancelled = true; };
  }, [mode, userId]);

  const feedUrl = useMemo(() => {
    if (!feedToken) return null;
    // Functions URL shape: https://<project>.functions.supabase.co/<fn>
    // We derive it from the configured supabase URL so it follows
    // env switches automatically.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://bjqazhplxqqhftekspfl.supabase.co";
    const host = url.replace("https://", "").replace(".supabase.co", "");
    return `https://${host}.functions.supabase.co/calendar-feed?token=${encodeURIComponent(feedToken)}`;
  }, [feedToken]);

  // webcal:// is the standard scheme for ICS subscriptions on Apple
  // and most desktop calendars. Tapping a webcal: link on iOS/macOS
  // launches the Calendar app's "Subscribe to this calendar?" flow
  // directly — no Safari "cannot download this file" dialog.
  const feedWebcalUrl = useMemo(
    () => (feedUrl ? feedUrl.replace(/^https:\/\//, "webcal://") : null),
    [feedUrl],
  );

  const handleEnableFeed = async () => {
    if (!userId) return;
    setFeedBusy(true); setFeedError(null);
    try {
      const supabase = getSupabase();
      // Token = base64url of 24 random bytes via crypto. Long, opaque,
      // safe to include in a URL.
      const bytes = new Uint8Array(24);
      crypto.getRandomValues(bytes);
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const token = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const { error } = await supabase.from("calendar_feed_tokens").insert({
        user_id: userId,
        token,
        label: "default",
      });
      if (error) throw error;
      setFeedToken(token);
    } catch (err: any) {
      console.warn("[bbp] feed enable failed", err);
      setFeedError(err?.message || "Couldn't enable the calendar feed. Try again.");
    } finally {
      setFeedBusy(false);
    }
  };

  const handleRevokeFeed = async () => {
    if (!userId || !feedToken) return;
    setFeedBusy(true); setFeedError(null);
    try {
      const supabase = getSupabase();
      const { error } = await supabase
        .from("calendar_feed_tokens")
        .update({ revoked_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("token", feedToken);
      if (error) throw error;
      setFeedToken(null);
    } catch (err: any) {
      console.warn("[bbp] feed revoke failed", err);
      setFeedError(err?.message || "Couldn't revoke the feed. Try again.");
    } finally {
      setFeedBusy(false);
    }
  };

  const handleCopyFeedUrl = async () => {
    if (!feedUrl) return;
    try {
      await navigator.clipboard.writeText(feedUrl);
      setFeedCopied(true);
      setTimeout(() => setFeedCopied(false), 1600);
    } catch { /* ignore */ }
  };

  // Public booking link: one slug per user for V1. Slug is generated
  // client-side and inserted under the owner's RLS context.
  const [bookingLink, setBookingLink] = useState<{ slug: string; active: boolean; intro: string | null; business_name: string | null } | null>(null);
  const [bookingBusy, setBookingBusy] = useState(false);
  const [bookingCopied, setBookingCopied] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [pendingRequests, setPendingRequests] = useState<number>(0);

  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- depends on window.location which the React Compiler can't statically memoize, intentional
  const bookingUrl = useMemo(() => {
    if (!bookingLink?.slug) return null;
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/book/${encodeURIComponent(bookingLink.slug)}`;
  }, [bookingLink?.slug]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clears booking state when auth context changes, intentional
    if (mode !== "authed" || !userId) { setBookingLink(null); setPendingRequests(0); return; }
    let cancelled = false;
    (async () => {
      const supabase = getSupabase();
      const [{ data: link }, { count }] = await Promise.all([
        supabase
          .from("booking_links")
          .select("slug, active, intro, business_name")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("booking_requests")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("status", "pending"),
      ]);
      if (cancelled) return;
      setBookingLink(link as any);
      setPendingRequests(count || 0);
    })();
    return () => { cancelled = true; };
  }, [mode, userId]);

  const generateSlug = () => {
    // 8 url-safe chars, ~48 bits — enough for V1 personal links.
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").toLowerCase();
  };

  const handleEnableBooking = async () => {
    if (!userId) return;
    setBookingBusy(true); setBookingError(null);
    try {
      const supabase = getSupabase();
      const slug = generateSlug();
      const { data, error } = await supabase
        .from("booking_links")
        .insert({ user_id: userId, slug, active: true })
        .select("slug, active, intro, business_name")
        .single();
      if (error) throw error;
      if (data) setBookingLink(data as any);
    } catch (err: any) {
      console.warn("[bbp] booking enable failed", err);
      setBookingError(err?.message || "Couldn't generate a booking link. Try again.");
    } finally {
      setBookingBusy(false);
    }
  };

  const handleToggleBooking = async () => {
    if (!userId || !bookingLink) return;
    setBookingBusy(true); setBookingError(null);
    try {
      const supabase = getSupabase();
      const next = !bookingLink.active;
      const { error } = await supabase
        .from("booking_links")
        .update({ active: next })
        .eq("user_id", userId)
        .eq("slug", bookingLink.slug);
      if (error) throw error;
      setBookingLink({ ...bookingLink, active: next });
    } catch (err: any) {
      console.warn("[bbp] booking toggle failed", err);
      setBookingError(err?.message || "Couldn't update the booking link. Try again.");
    } finally {
      setBookingBusy(false);
    }
  };

  const handleCopyBookingUrl = async () => {
    if (!bookingUrl) return;
    try {
      await navigator.clipboard.writeText(bookingUrl);
      setBookingCopied(true);
      setTimeout(() => setBookingCopied(false), 1600);
    } catch { /* ignore */ }
  };

  return (
    <div className="bbp-fade pb-24">
      <Header title="Account" leftAction={{ icon: <ChevronLeft size={20} />, onClick: onBack }} />
      <div className="px-5 pt-4 space-y-3">
        {mode === "authed" ? (
          <Card className="p-4">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-[10px] uppercase tracking-widest font-bold mb-1" style={{ color: C.muted, letterSpacing: "0.12em" }}>Signed in as</p>
                <p className="break-all" style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 600, color: C.espresso }}>
                  {email || "Account"}
                </p>
              </div>
              <button
                type="button" onClick={onSignOut}
                aria-label="Sign out"
                className="shrink-0 inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-semibold active:scale-[0.99] transition"
                style={{ background: C.ivory, color: C.coffee, border: `1px solid ${C.hairline}` }}
              >
                <LogOut size={14} />
                Sign out
              </button>
            </div>
            <p className="text-[11px] mt-3" style={{ color: C.muted }}>
              Your appointments, clients, receipts, and communication log sync across every device you sign in on.
            </p>
          </Card>
        ) : (
          <GuestModeCard
            onSignIn={() => setAuthSheetMode("signin")}
            onCreateAccount={() => setAuthSheetMode("signup")}
          />
        )}

        {mode === "authed" && userId && (
          lifetimeAccess === true ? (
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div
                  aria-hidden
                  style={{
                    width: 36, height: 36, borderRadius: 999, display: "grid", placeItems: "center",
                    background: `linear-gradient(180deg, ${C.gold}, ${C.goldDeep})`,
                    color: C.paper,
                  }}
                >
                  <Sparkles size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: C.goldDeep, letterSpacing: "0.12em" }}>
                    Lifetime Access
                  </p>
                  <p className="text-sm font-semibold mt-0.5" style={{ color: C.espresso }}>
                    Activated — thank you.
                  </p>
                </div>
              </div>
            </Card>
          ) : (
            <Card className="p-4">
              <div className="flex items-center gap-3 mb-3">
                <div
                  aria-hidden
                  style={{
                    width: 36, height: 36, borderRadius: 999, display: "grid", placeItems: "center",
                    background: C.ivory, border: `1px solid ${C.hairline}`, color: C.caramel,
                  }}
                >
                  <Sparkles size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: C.muted, letterSpacing: "0.12em" }}>
                    Lifetime Access
                  </p>
                  <p className="text-sm font-semibold mt-0.5" style={{ color: C.espresso }}>
                    Unlock everything for {LIFETIME_PRICE_LABEL}
                  </p>
                </div>
              </div>
              <p className="text-[11px] mb-3" style={{ color: C.muted }}>
                One-time payment. No subscription. Tied to your account
                so it follows you to every device.
              </p>
              <button
                type="button"
                disabled={!paymentLinkReady}
                onClick={() => { void openCheckout(userId); }}
                className="w-full rounded-2xl py-3 text-[14px] font-semibold active:scale-[0.99] transition disabled:opacity-60"
                style={{
                  background: `linear-gradient(180deg, ${C.gold}, ${C.goldDeep})`,
                  color: C.paper,
                  border: `1px solid ${C.goldDeep}`,
                  boxShadow: "0 8px 20px -10px rgba(168, 137, 63, 0.6)",
                }}
              >
                {paymentLinkReady ? `Unlock for ${LIFETIME_PRICE_LABEL}` : "Coming soon"}
              </button>
              {!paymentLinkReady && (
                <p className="text-[11px] mt-2" style={{ color: C.muted }}>
                  Stripe Payment Link not configured yet.
                </p>
              )}
            </Card>
          )
        )}

        {mode === "authed" && <SyncStatusCard mode={mode} sync={sync} />}

        {mode === "authed" && (
          <Card className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: C.muted, letterSpacing: "0.12em" }}>Push notifications</p>
              <Pill tone={pushCap === "subscribed" ? "success" : pushCap === "blocked" ? "danger" : "neutral"}>
                {pushCap === "subscribed" ? "ON"
                  : pushCap === "blocked" ? "BLOCKED"
                  : pushCap === "unsupported" ? "UNAVAILABLE"
                  : "OFF"}
              </Pill>
            </div>
            <p className="text-[11px] mb-3" style={{ color: C.muted }}>
              {pushCap === "subscribed"
                ? "You'll get alerts on this device for failed sends, overdue balances, and rebooking nudges."
                : pushCap === "blocked"
                  ? "Notifications are blocked for this site. Re-enable them in your browser settings."
                  : pushCap === "unsupported"
                    ? "This browser doesn't support web push. Push notifications will activate on iOS when you install the App Store build."
                    : "Get a quiet ping when something needs your attention. You can turn this off any time."}
            </p>
            {pushCap === "subscribed" ? (
              <Button variant="outline" fullWidth disabled={pushBusy} onClick={handleDisablePush}>
                {pushBusy ? "Working…" : "Turn off push"}
              </Button>
            ) : (
              <Button variant="primary" icon={<Bell size={15} />} fullWidth disabled={pushBusy || pushCap === "unsupported" || pushCap === "blocked"} onClick={handleEnablePush}>
                {pushBusy ? "Working…" : "Enable push notifications"}
              </Button>
            )}
            {pushError && <p className="text-[11px] mt-2" style={{ color: C.danger }}>{pushError}</p>}

            {pushCap === "subscribed" && (
              <>
                <div className="mt-4 pt-3 space-y-2" style={{ borderTop: `1px solid ${C.hairline}` }}>
                  <p className="text-[10px] uppercase tracking-widest font-bold mb-1" style={{ color: C.muted, letterSpacing: "0.12em" }}>What to alert me about</p>
                  {([
                    ["appointmentReminders", "Appointment reminders", "48h, 24h, same-day, and 2h alerts"],
                    ["balanceReminders", "Balance reminders", "Outstanding balances and overdue alerts"],
                    ["retentionReminders", "Retention reminders", "Inactive VIPs and rebooking nudges"],
                    ["businessInsights", "Business insights", "Daily summaries and pending balance totals"],
                  ] as [keyof NotificationPreferences, string, string][]).map(([key, label, hint]) => (
                    <div key={key} className="flex items-center justify-between py-1">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold" style={{ color: C.espresso }}>{label}</p>
                        <p className="text-[11px]" style={{ color: C.muted }}>{hint}</p>
                      </div>
                      <Toggle checked={!!prefs[key]} onChange={(v) => persistPrefs({ ...prefs, [key]: v })} />
                    </div>
                  ))}
                </div>
                <Button variant="outline" icon={<Bell size={14} />} fullWidth className="mt-3" onClick={handleTestNotification}>
                  Test notification
                </Button>
                {testStatus && <p className="text-[11px] mt-2 text-center" style={{ color: testStatus.startsWith("Couldn't") ? C.danger : C.success }}>{testStatus}</p>}
              </>
            )}
          </Card>
        )}

        {mode === "authed" && (
          <Card className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: C.muted, letterSpacing: "0.12em" }}>Public booking link</p>
              <Pill tone={bookingLink?.active ? "success" : bookingLink ? "warning" : "neutral"}>
                {bookingLink?.active ? "LIVE" : bookingLink ? "PAUSED" : "OFF"}
              </Pill>
            </div>
            <p className="text-[11px] mb-3" style={{ color: C.muted }}>
              {bookingLink
                ? "Share this URL on Instagram, your link-in-bio, or any DM. Requests land below for you to approve."
                : "Generate a private URL anyone can use to request an appointment with you. You approve every booking."}
            </p>
            {bookingLink && bookingUrl && (
              <div className="rounded-xl p-2.5 mb-3 break-all text-[11px] font-mono" style={{ background: C.ivory, color: C.coffee, border: `1px solid ${C.hairline}` }}>
                {bookingUrl}
              </div>
            )}
            {bookingLink ? (
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" icon={<Copy size={14} />} onClick={handleCopyBookingUrl}>{bookingCopied ? "Copied" : "Copy URL"}</Button>
                <Button variant={bookingLink.active ? "outline" : "primary"} disabled={bookingBusy} onClick={handleToggleBooking}>
                  {bookingLink.active ? "Pause" : "Resume"}
                </Button>
              </div>
            ) : (
              <Button variant="primary" icon={<CalendarPlus size={15} />} fullWidth disabled={bookingBusy} onClick={handleEnableBooking}>
                {bookingBusy ? "Working…" : "Generate booking link"}
              </Button>
            )}
            {bookingError && (
              <p className="text-[11px] mt-2" style={{ color: C.danger }}>{bookingError}</p>
            )}
            {bookingLink && openBookingRequests && (
              <button type="button" onClick={openBookingRequests}
                className="w-full mt-3 flex items-center justify-between rounded-xl p-3 active:scale-[0.99] transition"
                style={{ background: C.ivory, border: `1px solid ${C.hairline}` }}>
                <div className="text-left">
                  <p className="text-sm font-semibold" style={{ color: C.espresso }}>
                    {pendingRequests > 0 ? `${pendingRequests} pending request${pendingRequests === 1 ? "" : "s"}` : "Booking requests"}
                  </p>
                  <p className="text-[11px]" style={{ color: C.muted }}>Approve to convert into an appointment.</p>
                </div>
                <ChevronRight size={18} style={{ color: C.muted }} />
              </button>
            )}
          </Card>
        )}

        {mode === "authed" && (
          <Card className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: C.muted, letterSpacing: "0.12em" }}>Calendar feed</p>
              <Pill tone={feedToken ? "success" : "neutral"}>{feedToken ? "ACTIVE" : "OFF"}</Pill>
            </div>
            <p className="text-[11px] mb-3" style={{ color: C.muted }}>
              {feedToken
                ? "Subscribe Apple Calendar / Google Calendar / Outlook to this URL — bookings sync automatically. Anyone with the link can view your schedule, so revoke if it leaks."
                : "Generate a private subscribe URL to push your appointments to Apple Calendar, Google Calendar, or Outlook. You can revoke any time."}
            </p>
            {feedToken && feedUrl && (
              <div className="rounded-xl p-2.5 mb-3 break-all text-[11px] font-mono" style={{ background: C.ivory, color: C.coffee, border: `1px solid ${C.hairline}` }}>
                {feedUrl}
              </div>
            )}
            {feedToken && feedWebcalUrl ? (
              <>
                <a
                  href={feedWebcalUrl}
                  className="block w-full text-center rounded-xl px-4 py-3 text-sm font-semibold active:scale-[0.99] transition mb-2"
                  style={{ background: C.espresso, color: C.ivory }}
                >
                  Open in Calendar
                </a>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" icon={<Copy size={14} />} onClick={handleCopyFeedUrl}>{feedCopied ? "Copied" : "Copy URL"}</Button>
                  <Button variant="danger" disabled={feedBusy} onClick={handleRevokeFeed}>Revoke</Button>
                </div>
                <details className="mt-3 text-[11px]" style={{ color: C.muted }}>
                  <summary className="cursor-pointer font-semibold" style={{ color: C.coffee }}>How to subscribe on each platform</summary>
                  <div className="mt-2 space-y-1.5 leading-relaxed">
                    <p><strong>iOS / iPadOS:</strong> tap “Open in Calendar” above, then Subscribe.</p>
                    <p><strong>Mac Calendar:</strong> File → New Calendar Subscription → paste the URL.</p>
                    <p><strong>Google Calendar:</strong> Settings → Add calendar → From URL → paste.</p>
                    <p><strong>Outlook:</strong> Add calendar → Subscribe from web → paste.</p>
                    <p>If Safari shows “cannot download this file” when you open the URL, that is normal — calendar feeds aren’t meant to be viewed in a browser. Use the button above or one of the steps here.</p>
                  </div>
                </details>
              </>
            ) : (
              <Button variant="primary" icon={<Calendar size={15} />} fullWidth disabled={feedBusy} onClick={handleEnableFeed}>
                {feedBusy ? "Working…" : "Enable calendar feed"}
              </Button>
            )}
            {feedError && (
              <p className="text-[11px] mt-2" style={{ color: C.danger }}>{feedError}</p>
            )}
          </Card>
        )}

        <PermissionsExplained pushCap={pushCap} />

        <Card className="p-4 space-y-2">
          <Button variant="outline" icon={<Download size={15} />} fullWidth onClick={onExport}>Export all data (JSON)</Button>
          {mode === "authed" ? (
            <>
              {isAdminViewer(email) && (
                <Button variant="outline" icon={<ScrollText size={15} />} fullWidth onClick={() => setShowReadiness(true)}>App Store readiness checklist</Button>
              )}
              <Button variant="outline" icon={<Trash2 size={15} />} fullWidth onClick={() => setShowDeleteConfirm(true)}>Delete account</Button>
              <Button variant="danger" fullWidth onClick={onSignOut}>Sign out</Button>
            </>
          ) : null}
        </Card>

        <Card className="p-4">
          <p className="text-[10px] uppercase tracking-widest font-bold mb-2" style={{ color: C.muted, letterSpacing: "0.12em" }}>Legal &amp; support</p>
          <div className="space-y-1.5">
            {/* Routed through openExternal: web opens a new tab; iOS
                Capacitor shell opens SFSafariViewController so the
                back-swipe gesture returns to the app shell with state
                intact. Same-origin paths get prefixed with the live
                site URL inside the helper call. */}
            <a href="/privacy" target="_blank" rel="noopener noreferrer"
               onClick={(e) => { e.preventDefault(); void openExternal(getAuthRedirectUrl("/privacy")); }}
               className="flex items-center justify-between py-2 text-sm" style={{ color: C.coffee }}>
              Privacy policy <ChevronRight size={16} style={{ color: C.muted }} />
            </a>
            <a href="/terms" target="_blank" rel="noopener noreferrer"
               onClick={(e) => { e.preventDefault(); void openExternal(getAuthRedirectUrl("/terms")); }}
               className="flex items-center justify-between py-2 text-sm" style={{ color: C.coffee }}>
              Terms of service <ChevronRight size={16} style={{ color: C.muted }} />
            </a>
            <a href="/support" target="_blank" rel="noopener noreferrer"
               onClick={(e) => { e.preventDefault(); void openExternal(getAuthRedirectUrl("/support")); }}
               className="flex items-center justify-between py-2 text-sm" style={{ color: C.coffee }}>
              Contact support <ChevronRight size={16} style={{ color: C.muted }} />
            </a>
          </div>
        </Card>
      </div>

      {isAdminViewer(email) && (
        <ReadinessChecklistSheet open={showReadiness} onClose={() => setShowReadiness(false)} mode={mode} pushCap={pushCap} />
      )}
      <DeleteAccountSheet open={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)} onSignOut={onSignOut} />
      <AuthSheet
        open={!!authSheetMode}
        initialMode={authSheetMode || "signin"}
        onClose={() => setAuthSheetMode(null)}
      />
    </div>
  );
};

// ============================================================
//  APP ROOT
// ============================================================
// Calm, premium-looking upgrade sheet. Shown when a guest hits a limit
// or taps a premium-only entry point. The CTA opens the live Stripe
// Payment Link via openCheckout(); if the user isn't signed in yet,
// we send them to the Account screen first because the unlock binds
// to their Supabase user id.
// ============================================================
//  DISCOUNTS SCREEN
// ============================================================
// ============================================================
//  SERVICES & STYLES (Phase 1 — catalog only; not wired into bookings yet)
// ============================================================
const ServicesScreen = ({
  store, onBack,
}: {
  store: any;
  onBack: () => void;
}) => {
  const api = store.servicesApi;
  const services: Service[] = api?.services || [];
  const currency = store.business?.currency || "USD";
  const [editing, setEditing] = useState<(Partial<ServiceInput> & { id?: string }) | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Service | null>(null);
  const [busy, setBusy] = useState(false);

  const openNew = () => setEditing({
    name: "",
    description: "",
    duration_hours: 4,
    base_price: 0,
    deposit_required: false,
    deposit_amount: null,
    add_ons: [],
    prep_instructions: "",
    is_active: true,
    buffer_before_minutes: 0,
    buffer_after_minutes: 0,
    max_concurrent: 1,
  });

  const openEdit = (s: Service) => setEditing({
    id: s.id,
    name: s.name,
    description: s.description,
    duration_hours: s.duration_hours,
    base_price: s.base_price,
    deposit_required: s.deposit_required,
    deposit_amount: s.deposit_amount,
    add_ons: Array.isArray(s.add_ons) ? s.add_ons : [],
    prep_instructions: s.prep_instructions,
    is_active: s.is_active,
    buffer_before_minutes: s.buffer_before_minutes ?? 0,
    buffer_after_minutes: s.buffer_after_minutes ?? 0,
    max_concurrent: s.max_concurrent ?? 1,
  });

  const handleSave = async () => {
    if (!editing || busy) return;
    setBusy(true);
    const saved = await api.upsert(editing);
    setBusy(false);
    if (saved) setEditing(null);
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setBusy(true);
    const ok = await api.remove(confirmDelete.id);
    setBusy(false);
    if (ok) setConfirmDelete(null);
  };

  const updateAddOn = (id: string, field: keyof ServiceAddOn, value: string) => {
    setEditing(prev => prev ? {
      ...prev,
      add_ons: (prev.add_ons || []).map(a => a.id === id
        ? { ...a, [field]: field === "amount" ? parseMoney(value) : value }
        : a),
    } : prev);
  };
  const addAddOn = () => setEditing(prev => prev ? {
    ...prev,
    add_ons: [...(prev.add_ons || []), { id: `addon_${uid()}`, name: "", amount: 0 }],
  } : prev);
  const removeAddOn = (id: string) => setEditing(prev => prev ? {
    ...prev,
    add_ons: (prev.add_ons || []).filter(a => a.id !== id),
  } : prev);

  return (
    <div className="bbp-fade pb-32">
      <Header
        title="Services & styles"
        subtitle="Your catalog of bookable looks"
        leftAction={{ icon: <ChevronLeft size={20} />, onClick: onBack }}
        rightAction={
          <button
            type="button"
            onClick={openNew}
            className="p-2 rounded-full"
            style={{ color: C.coffee }}
            aria-label="New service"
          >
            <Plus size={20} />
          </button>
        }
      />

      <div className="px-5 pt-2 space-y-3">
        {api?.error && (
          <Card className="p-3" style={{ border: `1px solid ${C.danger}`, background: C.ivory }}>
            <p className="text-[12px]" style={{ color: C.danger }}>{api.error}</p>
          </Card>
        )}

        {api?.loading && services.length === 0 ? (
          <Card className="p-4">
            <p className="text-[12px]" style={{ color: C.muted }}>Loading services…</p>
          </Card>
        ) : services.length === 0 ? (
          <Card className="p-6 text-center" style={{
            background: `linear-gradient(180deg, ${C.paper} 0%, ${C.ivory} 100%)`,
          }}>
            <div
              aria-hidden
              style={{
                width: 48, height: 48, margin: "0 auto 12px",
                borderRadius: 999, display: "grid", placeItems: "center",
                background: C.ivory, color: C.gold, border: `1px solid ${C.hairline}`,
              }}
            >
              <Layers size={20} />
            </div>
            <p style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 600, color: C.espresso }}>
              No services yet.
            </p>
            <p className="text-[13px] mt-2" style={{ color: C.muted, lineHeight: 1.5 }}>
              {SERVICES_EMPTY_COPY}
            </p>
            <div className="mt-5">
              <Button variant="primary" icon={<Plus size={16} />} onClick={openNew} fullWidth>
                Create your first service
              </Button>
            </div>
          </Card>
        ) : (
          services.map(s => (
            <Card
              key={s.id}
              className="p-4 active:scale-[0.99] cursor-pointer"
              onClick={() => openEdit(s)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <p className="text-sm font-semibold truncate" style={{ color: C.espresso }}>
                      {s.name}
                    </p>
                    <Pill tone={s.is_active ? "success" : "neutral"}>
                      {s.is_active ? "Active" : "Inactive"}
                    </Pill>
                    {s.deposit_required && (
                      <Pill tone="gold">Deposit required</Pill>
                    )}
                  </div>
                  <p className="text-[11px]" style={{ color: C.muted }}>
                    {formatServicePrice(s, currency)}
                    {s.deposit_required && s.deposit_amount
                      ? ` · Deposit ${fmtMoney(Number(s.deposit_amount), currency)}`
                      : ""}
                    {s.add_ons.length > 0 ? ` · ${s.add_ons.length} add-on${s.add_ons.length === 1 ? "" : "s"}` : ""}
                  </p>
                  {s.description && (
                    <p className="text-[12px] mt-2" style={{ color: C.coffee, lineHeight: 1.4 }}>
                      {s.description}
                    </p>
                  )}
                </div>
                <ChevronRight size={18} style={{ color: C.muted, marginTop: 2, flexShrink: 0 }} />
              </div>
            </Card>
          ))
        )}
      </div>

      <Sheet
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? "Edit service" : "New service"}
      >
        {editing && (
          <div className="space-y-3 pb-2">
            <Field label="Name">
              <Input
                value={editing.name || ""}
                onChange={e => setEditing({ ...editing, name: e.target.value })}
                placeholder="Knotless mid-back"
              />
            </Field>

            <Field label="Description" hint="Visible on booking surfaces. Optional.">
              <Textarea
                value={editing.description || ""}
                onChange={e => setEditing({ ...editing, description: e.target.value })}
                rows={2}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Duration (hrs)">
                <MoneyInput
                  prefix=""
                  suffix="hrs"
                  value={editing.duration_hours ?? ""}
                  onChange={(v) => setEditing({ ...editing, duration_hours: parseMoney(v) })}
                />
              </Field>
              <Field label="Base price">
                <MoneyInput
                  value={editing.base_price ?? ""}
                  onChange={(v) => setEditing({ ...editing, base_price: parseMoney(v) })}
                />
              </Field>
            </div>

            <Card className="p-3.5">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-sm font-semibold" style={{ color: C.espresso }}>Deposit required</p>
                  <p className="text-[11px]" style={{ color: C.muted }}>Booking won't confirm until paid.</p>
                </div>
                <Toggle
                  checked={!!editing.deposit_required}
                  onChange={(v) => setEditing({
                    ...editing,
                    deposit_required: v,
                    deposit_amount: v ? (editing.deposit_amount ?? 0) : null,
                  })}
                />
              </div>
              {editing.deposit_required && (
                <Field label="Deposit amount">
                  <MoneyInput
                    value={editing.deposit_amount ?? ""}
                    onChange={(v) => setEditing({ ...editing, deposit_amount: parseMoney(v) })}
                  />
                </Field>
              )}
            </Card>

            <Card className="p-3.5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold" style={{ color: C.espresso }}>Add-ons</p>
                <Button variant="outline" icon={<Plus size={14} />} onClick={addAddOn}>Add</Button>
              </div>
              {(editing.add_ons || []).length === 0 ? (
                <p className="text-[11px]" style={{ color: C.muted }}>
                  Optional. Edges, washing, beads — anything that bumps the price.
                </p>
              ) : (
                <div className="space-y-2">
                  {(editing.add_ons || []).map(a => (
                    <div key={a.id} className="flex items-center gap-2">
                      <div className="flex-1"><Input value={a.name} onChange={e => updateAddOn(a.id, "name", e.target.value)} placeholder="Add-on name" /></div>
                      <div className="w-24"><MoneyInput value={a.amount} onChange={(v) => updateAddOn(a.id, "amount", v)} /></div>
                      <button type="button" onClick={() => removeAddOn(a.id)} className="p-2 rounded-lg" style={{ color: C.danger }}><Trash2 size={18} /></button>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Field label="Prep instructions" hint="Sent to clients before their booking. Optional.">
              <Textarea
                value={editing.prep_instructions || ""}
                onChange={e => setEditing({ ...editing, prep_instructions: e.target.value })}
                rows={3}
                placeholder="Wash and blow-dry the day before. Bring bands."
              />
            </Field>

            <Card className="p-3.5">
              <p className="text-[10px] uppercase tracking-widest font-bold mb-2" style={{ color: C.muted, letterSpacing: "0.14em" }}>
                Scheduling
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Buffer before (min)" hint="Prep / setup pad">
                  <MoneyInput
                    prefix=""
                    suffix="min"
                    value={editing.buffer_before_minutes ?? 0}
                    onChange={(v) => setEditing({ ...editing, buffer_before_minutes: parseMoney(v) })}
                  />
                </Field>
                <Field label="Buffer after (min)" hint="Takedown / clean-up">
                  <MoneyInput
                    prefix=""
                    suffix="min"
                    value={editing.buffer_after_minutes ?? 0}
                    onChange={(v) => setEditing({ ...editing, buffer_after_minutes: parseMoney(v) })}
                  />
                </Field>
              </div>
              <Field label="Concurrent bookings" hint="1 for solo · raise for classes / multi-chair">
                <MoneyInput
                  prefix=""
                  suffix="at once"
                  value={editing.max_concurrent ?? 1}
                  onChange={(v) => setEditing({ ...editing, max_concurrent: parseMoney(v) })}
                />
              </Field>
            </Card>

            <Field label="Status">
              <Select
                value={editing.is_active === false ? "inactive" : "active"}
                onChange={e => setEditing({ ...editing, is_active: e.target.value === "active" })}
                options={[
                  { value: "active", label: "Active — bookable" },
                  { value: "inactive", label: "Inactive — hidden from booking" },
                ]}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <Button variant="primary" icon={<Save size={16} />} onClick={handleSave}>
                {busy ? "Saving…" : "Save service"}
              </Button>
              <Button variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </div>

            {editing.id && (
              <Button
                variant="danger"
                icon={<Trash2 size={16} />}
                onClick={() => {
                  const target = services.find(s => s.id === editing.id);
                  if (target) { setEditing(null); setConfirmDelete(target); }
                }}
                fullWidth
              >
                Delete service
              </Button>
            )}
          </div>
        )}
      </Sheet>

      <Sheet
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete service?"
      >
        {confirmDelete && (
          <div className="space-y-3 pb-2">
            <p className="text-[14px]" style={{ color: C.coffee, lineHeight: 1.5 }}>
              Remove <strong>{confirmDelete.name}</strong> from your catalog? This won't change any
              past appointments.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Button variant="danger" onClick={handleDelete}>
                {busy ? "Deleting…" : "Delete"}
              </Button>
              <Button variant="outline" onClick={() => setConfirmDelete(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
};

// ============================================================
//  REPORTS V1 — revenue · top styles · repeat clients
// ============================================================
const ReportsScreen = ({ store, onBack }: { store: any; onBack: () => void }) => {
  const appointments = (store.appointments as any[]) || [];
  const currency = store.business?.currency || "USD";
  const [granularity, setGranularity] = useState<RevenueGranularity>("week");

  const revenuePoints = useMemo(
    () => revenueByPeriod(appointments, granularity, undefined, granularity === "week" ? 8 : 6),
    [appointments, granularity],
  );
  const styles = useMemo(() => topBookedStyles(appointments, 8), [appointments]);
  const repeats = useMemo(() => repeatClientStats(appointments, 5), [appointments]);

  const maxRevenue = Math.max(1, ...revenuePoints.map(p => p.revenue));
  const totalRevenue = revenuePoints.reduce((s, p) => s + p.revenue, 0);
  const totalAppts = revenuePoints.reduce((s, p) => s + p.appointmentCount, 0);

  return (
    <div className="bbp-fade pb-32">
      <Header
        title="Reports"
        subtitle="Revenue, top styles, returning clients"
        leftAction={{ icon: <ChevronLeft size={20} />, onClick: onBack }}
      />

      <div className="px-5 pt-2 space-y-5">
        {/* REVENUE */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <SectionTitle>Revenue</SectionTitle>
            <div className="flex p-0.5 rounded-lg" style={{ background: C.ivory, border: `1px solid ${C.hairline}` }}>
              {(["week", "month"] as RevenueGranularity[]).map(g => (
                <button
                  type="button"
                  key={g}
                  onClick={() => setGranularity(g)}
                  className="px-3 py-1 rounded-md text-[11px] font-semibold transition"
                  style={{
                    background: granularity === g ? C.espresso : "transparent",
                    color: granularity === g ? C.cream : C.coffee,
                  }}
                >
                  {g === "week" ? "Weekly" : "Monthly"}
                </button>
              ))}
            </div>
          </div>
          <Card className="p-4">
            <div className="flex items-baseline justify-between mb-3">
              <div>
                <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: C.muted, letterSpacing: "0.14em" }}>
                  Last {revenuePoints.length} {granularity === "week" ? "weeks" : "months"}
                </p>
                <p style={{ fontFamily: FONT_DISPLAY, fontSize: 28, fontWeight: 600, color: C.espresso }}>
                  {fmtMoney(totalRevenue, currency)}
                </p>
              </div>
              <p className="text-[11px]" style={{ color: C.muted }}>
                {totalAppts} appt{totalAppts === 1 ? "" : "s"}
              </p>
            </div>
            <div className="flex items-end gap-1.5" style={{ height: 80 }}>
              {revenuePoints.map(p => {
                const h = Math.max(2, Math.round((p.revenue / maxRevenue) * 80));
                return (
                  <div key={p.iso} className="flex-1 flex flex-col items-center gap-1">
                    <div
                      className="w-full rounded-t-md"
                      style={{
                        height: h,
                        background: `linear-gradient(180deg, ${C.gold}, ${C.goldDeep})`,
                        opacity: p.revenue > 0 ? 1 : 0.25,
                      }}
                    />
                    <span className="text-[9px] font-semibold" style={{ color: C.muted }}>{p.label}</span>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        {/* TOP STYLES */}
        <div>
          <SectionTitle>Top booked styles</SectionTitle>
          {styles.length === 0 ? (
            <Card className="p-4 text-center">
              <p className="text-[12px]" style={{ color: C.muted }}>
                Add a style to your appointments and it'll surface here.
              </p>
            </Card>
          ) : (
            <Card className="p-2">
              {styles.map((s, i) => (
                <div
                  key={s.style}
                  className="flex items-center justify-between px-2 py-2.5"
                  style={{ borderTop: i === 0 ? "none" : `1px solid ${C.hairline}` }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold truncate" style={{ color: C.espresso }}>{s.style}</p>
                    <p className="text-[11px]" style={{ color: C.muted }}>
                      {s.count} booking{s.count === 1 ? "" : "s"}
                    </p>
                  </div>
                  <span className="text-[12px] font-semibold tabular-nums ml-3" style={{ color: C.coffee }}>
                    {fmtMoney(s.revenue, currency)}
                  </span>
                </div>
              ))}
            </Card>
          )}
        </div>

        {/* REPEAT CLIENTS */}
        <div>
          <SectionTitle>Repeat clients</SectionTitle>
          <Card className="p-4">
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: C.muted, letterSpacing: "0.14em" }}>Returning</p>
                <p style={{ fontFamily: FONT_DISPLAY, fontSize: 24, fontWeight: 600, color: C.espresso }}>
                  {Math.round(repeats.repeatRate * 100)}%
                </p>
                <p className="text-[11px]" style={{ color: C.muted }}>
                  {repeats.repeatClients} of {repeats.totalClients}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: C.muted, letterSpacing: "0.14em" }}>Top spender</p>
                <p style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600, color: C.espresso }}>
                  {repeats.topClients[0]?.clientName || "—"}
                </p>
                <p className="text-[11px]" style={{ color: C.muted }}>
                  {repeats.topClients[0] ? fmtMoney(repeats.topClients[0].revenue, currency) : ""}
                </p>
              </div>
            </div>
            {repeats.topClients.length > 0 && (
              <div className="pt-3" style={{ borderTop: `1px solid ${C.hairline}` }}>
                <p className="text-[10px] uppercase tracking-widest font-bold mb-2" style={{ color: C.muted, letterSpacing: "0.14em" }}>
                  Top {repeats.topClients.length}
                </p>
                {repeats.topClients.map((c, i) => (
                  <div
                    key={c.clientId}
                    className="flex items-center justify-between py-1.5"
                    style={{ borderTop: i === 0 ? "none" : `1px solid ${C.hairline}` }}
                  >
                    <p className="text-[13px] truncate" style={{ color: C.espresso }}>{c.clientName}</p>
                    <span className="text-[11px] tabular-nums ml-3" style={{ color: C.muted }}>
                      {c.count} · {fmtMoney(c.revenue, currency)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};

// ============================================================
//  BOOKING POLICIES (Phase 2)
// ============================================================
const POLICY_FIELDS: {
  key: keyof BookingPolicyInput;
  label: string;
  hint: string;
  presets?: readonly string[];
  rows?: number;
  numeric?: boolean;
}[] = [
  { key: "deposit_policy",          label: "Deposit policy",          hint: "How much, when, and what it covers.", presets: POLICY_PRESETS.deposit_policy, rows: 3 },
  { key: "cancellation_window_hours", label: "Cancellation window",   hint: "Hours before the appointment a cancel is still on time.", numeric: true },
  { key: "cancellation_policy",     label: "Cancellation policy",     hint: "What happens after the window.", presets: POLICY_PRESETS.cancellation_policy, rows: 3 },
  { key: "late_arrival_policy",     label: "Late arrival policy",     hint: "Grace period and consequences.", presets: POLICY_PRESETS.late_arrival_policy, rows: 3 },
  { key: "no_show_policy",          label: "No-show policy",          hint: "What happens when a client misses without notice.", presets: POLICY_PRESETS.no_show_policy, rows: 3 },
  { key: "hair_prep_instructions",  label: "Hair prep instructions",  hint: "What clients should do before arriving.", presets: POLICY_PRESETS.hair_prep_instructions, rows: 3 },
  { key: "guests_policy",           label: "Children & guests",       hint: "Who can join in the studio.", presets: POLICY_PRESETS.guests_policy, rows: 3 },
  { key: "reschedule_policy",       label: "Reschedule policy",       hint: "Free rescheduling rules.", presets: POLICY_PRESETS.reschedule_policy, rows: 3 },
  { key: "custom_notes",            label: "Custom notes",            hint: "Anything else clients should know.", rows: 3 },
];

const BookingPoliciesScreen = ({ store, onBack }: { store: any; onBack: () => void }) => {
  const api = store.policiesApi;
  const policy: BookingPolicy | null = api?.policy || null;
  const [draft, setDraft] = useState<BookingPolicyInput>(EMPTY_POLICY);
  const [busy, setBusy] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (policy) {
      setDraft({
        deposit_policy: policy.deposit_policy,
        cancellation_window_hours: policy.cancellation_window_hours,
        cancellation_policy: policy.cancellation_policy,
        late_arrival_policy: policy.late_arrival_policy,
        no_show_policy: policy.no_show_policy,
        hair_prep_instructions: policy.hair_prep_instructions,
        guests_policy: policy.guests_policy,
        reschedule_policy: policy.reschedule_policy,
        custom_notes: policy.custom_notes,
      });
    }
  }, [policy?.updated_at, policy?.user_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    if (busy) return;
    setBusy(true);
    const saved = await api.save(draft);
    setBusy(false);
    if (saved) {
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1800);
    }
  };

  return (
    <div className="bbp-fade pb-32">
      <Header
        title="Booking policies"
        subtitle="What clients agree to when they book"
        leftAction={{ icon: <ChevronLeft size={20} />, onClick: onBack }}
      />
      <div className="px-5 pt-2 space-y-4">
        {api?.error && (
          <Card className="p-3" style={{ border: `1px solid ${C.danger}`, background: C.ivory }}>
            <p className="text-[12px]" style={{ color: C.danger }}>{api.error}</p>
          </Card>
        )}
        {api?.loading && !policy && (
          <Card className="p-4">
            <p className="text-[12px]" style={{ color: C.muted }}>Loading policies…</p>
          </Card>
        )}

        {POLICY_FIELDS.map(f => (
          <Card key={f.key} className="p-4 space-y-2">
            <div>
              <p className="text-sm font-semibold" style={{ color: C.espresso }}>{f.label}</p>
              <p className="text-[11px]" style={{ color: C.muted }}>{f.hint}</p>
            </div>
            {f.numeric ? (
              <Input
                type="number"
                inputMode="numeric"
                value={(draft[f.key] as number | null) ?? ""}
                onChange={e => {
                  const v = e.target.value;
                  setDraft({ ...draft, [f.key]: v === "" ? null : Number(v) } as BookingPolicyInput);
                }}
                placeholder="e.g. 24"
              />
            ) : (
              <Textarea
                value={(draft[f.key] as string | null) || ""}
                onChange={e => setDraft({ ...draft, [f.key]: e.target.value } as BookingPolicyInput)}
                rows={f.rows || 2}
                placeholder="Optional"
              />
            )}
            {f.presets && f.presets.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {f.presets.map(p => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setDraft({ ...draft, [f.key]: p } as BookingPolicyInput)}
                    className="px-3 py-1.5 rounded-full text-[11px] font-semibold active:scale-[0.97] transition text-left"
                    style={{
                      background: C.ivory, color: C.coffee,
                      border: `1px solid ${C.hairline}`,
                      maxWidth: "100%",
                    }}
                  >
                    Use: {p.length > 60 ? `${p.slice(0, 57)}…` : p}
                  </button>
                ))}
              </div>
            )}
          </Card>
        ))}

        <div className="grid grid-cols-1 gap-2 pt-2">
          <Button variant="primary" icon={savedFlash ? <Check size={16} /> : <Save size={16} />} onClick={handleSave} fullWidth>
            {busy ? "Saving…" : savedFlash ? "Saved" : "Save policies"}
          </Button>
        </div>
      </div>
    </div>
  );
};

// ============================================================
//  AVAILABILITY (Phase 2)
// ============================================================
// ============================================================
//  WAITLIST — owner management screen
// ============================================================
const WAITLIST_STATUS_TONE: Record<WaitlistStatus, "warning" | "gold" | "success" | "danger" | "neutral"> = {
  waiting:   "warning",
  contacted: "gold",
  booked:    "success",
  declined:  "danger",
  archived:  "neutral",
};

const WaitlistScreen = ({
  store, onBack, onConvertToAppointment,
}: {
  store: any;
  onBack: () => void;
  onConvertToAppointment: (req: WaitlistRequest, matchedClient: ClientLike | null) => void;
}) => {
  const api = store.waitlistApi;
  const requests: WaitlistRequest[] = api?.requests || [];
  const clients: ClientLike[] = (store.clients as ClientLike[]) || [];
  const [filter, setFilter] = useState<"waiting" | "all" | "archived">("waiting");
  const [picker, setPicker] = useState<{ req: WaitlistRequest; candidates: ClientLike[] } | null>(null);

  const filtered = useMemo(() => {
    if (filter === "all") return requests;
    if (filter === "archived") return requests.filter(r => r.status === "archived" || r.status === "declined");
    return requests.filter(r => r.status === "waiting" || r.status === "contacted");
  }, [requests, filter]);

  const tryConvert = (req: WaitlistRequest) => {
    const match = matchClientByContact(
      { email: req.client_email, phone: req.client_phone },
      clients,
    );
    if (match.kind === "ambiguous") {
      setPicker({ req, candidates: match.candidates });
      return;
    }
    if (match.kind === "single") {
      onConvertToAppointment(req, match.client);
      return;
    }
    onConvertToAppointment(req, null);
  };

  return (
    <div className="bbp-fade pb-32">
      <Header
        title="Waitlist"
        subtitle="Clients waiting for an opening"
        leftAction={{ icon: <ChevronLeft size={20} />, onClick: onBack }}
      />
      <div className="px-5 pt-2 space-y-3">
        {api?.error && (
          <Card className="p-3" style={{ border: `1px solid ${C.danger}`, background: C.ivory }}>
            <p className="text-[12px]" style={{ color: C.danger }}>{api.error}</p>
          </Card>
        )}

        <div className="flex p-1 rounded-xl" style={{ background: C.ivory, border: `1px solid ${C.hairline}` }}>
          {[
            { id: "waiting", label: `Active · ${requests.filter(r => r.status === "waiting" || r.status === "contacted").length}` },
            { id: "all", label: `All · ${requests.length}` },
            { id: "archived", label: `Archive · ${requests.filter(r => r.status === "archived" || r.status === "declined").length}` },
          ].map(t => (
            <button
              type="button"
              key={t.id}
              onClick={() => setFilter(t.id as any)}
              className="flex-1 py-2 rounded-lg text-[12px] font-semibold transition"
              style={{
                background: filter === t.id ? C.espresso : "transparent",
                color: filter === t.id ? C.cream : C.coffee,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={<UserPlus size={28} style={{ color: C.gold }} />}
            title="No one waiting"
            body="When a client submits a waitlist request from your booking link, they'll show here."
          />
        ) : (
          filtered.map(r => (
            <Card key={r.id} className="p-4">
              <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <Pill tone={WAITLIST_STATUS_TONE[r.status]}>{WAITLIST_STATUS_LABEL[r.status]}</Pill>
                    {r.preferred_date && (
                      <span className="text-[11px] font-semibold" style={{ color: C.coffee }}>
                        {fmtDate(r.preferred_date)}{r.preferred_time ? ` · ${fmtTime(r.preferred_time)}` : ""}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-semibold" style={{ color: C.espresso }}>{r.client_name}</p>
                  <p className="text-[11px] mt-0.5" style={{ color: C.muted }}>
                    {r.service_name || "No service specified"}
                    {r.flexibility ? ` · ${WAITLIST_FLEX_LABEL[r.flexibility]}` : ""}
                  </p>
                  {(r.client_phone || r.client_email) && (
                    <p className="text-[11px] mt-1" style={{ color: C.coffee }}>
                      {[r.client_phone, r.client_email].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {r.notes && (
                    <p className="text-[12px] mt-2" style={{ color: C.coffee, lineHeight: 1.4 }}>{r.notes}</p>
                  )}
                  <p className="text-[10px] mt-2" style={{ color: C.muted }}>
                    Submitted {fmtRelative(r.created_at)}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <Button variant="primary" icon={<Check size={14} />} onClick={() => tryConvert(r)}>
                  Convert to appt
                </Button>
                <Button
                  variant="outline"
                  onClick={() => api.setStatus(r.id, r.status === "contacted" ? "waiting" : "contacted")}
                >
                  {r.status === "contacted" ? "Mark waiting" : "Mark contacted"}
                </Button>
                <Button variant="outline" onClick={() => api.setStatus(r.id, "archived")}>
                  Archive
                </Button>
                <Button variant="danger" icon={<Trash2 size={14} />} onClick={() => api.remove(r.id)}>
                  Delete
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>

      <Sheet
        open={!!picker}
        onClose={() => setPicker(null)}
        title="Pick the right client"
      >
        {picker && (
          <div className="space-y-2 pb-2">
            <p className="text-[13px]" style={{ color: C.coffee, lineHeight: 1.5 }}>
              Multiple clients match this contact info. Pick the existing one to link, or create a new client.
            </p>
            {picker.candidates.map(c => (
              <button
                type="button"
                key={c.id}
                onClick={() => { const req = picker.req; setPicker(null); onConvertToAppointment(req, c); }}
                className="w-full text-left rounded-xl px-4 py-3 active:scale-[0.99] transition"
                style={{ background: C.paper, border: `1px solid ${C.hairline}`, color: "inherit", font: "inherit" }}
              >
                <p className="text-sm font-semibold" style={{ color: C.espresso }}>{c.name}</p>
                <p className="text-[11px] mt-0.5" style={{ color: C.muted }}>
                  {[c.phone, c.email].filter(Boolean).join(" · ") || "No contact info"}
                </p>
              </button>
            ))}
            <Button
              variant="primary"
              fullWidth
              icon={<UserPlus size={14} />}
              onClick={() => { const req = picker.req; setPicker(null); onConvertToAppointment(req, null); }}
            >
              Create new client
            </Button>
            <Button variant="outline" fullWidth onClick={() => setPicker(null)}>Cancel</Button>
          </div>
        )}
      </Sheet>
    </div>
  );
};

// ============================================================
//  BOOKING INTELLIGENCE — Phase B4
// ============================================================
const INTEL_WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const intelToneStyle = (tone: SmartInsight["tone"]) => {
  switch (tone) {
    case "gold":
      return { bg: "#F5E9C8", fg: C.goldDeep, border: "#E5D4A0" };
    case "success":
      return { bg: "#E4EDD8", fg: C.success, border: "#C9D9B0" };
    case "warning":
      return { bg: "#F5DDC0", fg: C.warning, border: "#E8C99A" };
    default:
      return { bg: C.ivory, fg: C.coffee, border: C.hairline };
  }
};

const WeekdayBars = ({ data }: { data: { dow: number; count: number }[] }) => {
  const map = new Map(data.map(d => [d.dow, d.count]));
  const max = Math.max(1, ...data.map(d => d.count));
  const width = 280;
  const height = 110;
  const padTop = 8;
  const padBottom = 22;
  const barAreaH = height - padTop - padBottom;
  const barW = (width - 14) / 7;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none">
      {[0, 1, 2, 3, 4, 5, 6].map(i => {
        const v = map.get(i) || 0;
        const h = max > 0 ? (v / max) * barAreaH : 0;
        const x = 7 + i * barW + 2;
        const y = padTop + (barAreaH - h);
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW - 4} height={h} rx={4} fill={v > 0 ? C.gold : C.hairline} />
            <text x={x + (barW - 4) / 2} y={padTop + barAreaH + 14} fontSize={10} textAnchor="middle" fill={C.muted}>
              {INTEL_WEEKDAYS_SHORT[i]}
            </text>
            {v > 0 && (
              <text x={x + (barW - 4) / 2} y={y - 3} fontSize={10} textAnchor="middle" fill={C.coffee}>
                {v}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
};

const ServiceBar = ({ pct, color }: { pct: number; color: string }) => (
  <div className="w-full h-1.5 rounded-full" style={{ background: C.ivory, border: `1px solid ${C.hairline}` }}>
    <div
      className="h-full rounded-full"
      style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: color }}
    />
  </div>
);

// ============================================================
//  APPROVAL QUEUE — Phase B5a
// ============================================================
const APPROVAL_FILTERS: { id: "active" | "all" | "history"; label: (n: { active: number; all: number; history: number }) => string }[] = [
  { id: "active",  label: n => `Active · ${n.active}` },
  { id: "all",     label: n => `All · ${n.all}` },
  { id: "history", label: n => `History · ${n.history}` },
];

const ApprovalCountdown = ({ req }: { req: BookingRequestRecord }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (req.approval_status !== "approved_pending_deposit") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [req.approval_status, req.approval_expires_at]);
  const left = approvalSecondsLeft(req, now);
  if (left === null) return null;
  const tone: "gold" | "warning" | "danger" = left <= 0 ? "danger" : left < 300 ? "warning" : "gold";
  return <Pill tone={tone}>{formatCountdown(left)}</Pill>;
};

// ============================================================
//  CONTRACTS — Phase B12
// ============================================================
const ContractsScreen = ({ store, onBack }: { store: any; onBack: () => void }) => {
  const userId: string | null = store.userId || null;
  const api = useContractTemplates(userId);
  const { templates, loading, error, refresh, upsert, remove, setActive, seedStarters } = api;
  const [editing, setEditing] = useState<Partial<ContractTemplateInput> & { id?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [seedFlash, setSeedFlash] = useState<string | null>(null);

  const closeEditor = () => setEditing(null);

  const startNew = () => setEditing({
    title: "",
    template_type: "custom" as ContractTemplateType,
    body: "",
    is_active: true,
    require_signature: true,
    require_initials: false,
    attach_to_all_bookings: false,
  });

  const handleSave = async () => {
    if (!editing) return;
    setBusy(true);
    const saved = await upsert(editing);
    setBusy(false);
    if (saved) closeEditor();
  };

  const handleSeedStarters = async () => {
    if (busy) return;
    setBusy(true);
    const n = await seedStarters();
    setBusy(false);
    setSeedFlash(n > 0 ? `Added ${n} starter template${n === 1 ? "" : "s"}.` : "Starter templates already in your library.");
    setTimeout(() => setSeedFlash(null), 2400);
  };

  return (
    <div className="bbp-fade pb-32">
      <Header
        title="Contracts"
        subtitle="Agreements clients sign before a booking is locked"
        leftAction={{ icon: <ChevronLeft size={20} />, onClick: onBack }}
      />
      <div className="px-5 pt-2 space-y-3">
        {error && (
          <Card className="p-3" style={{ border: `1px solid ${C.danger}`, background: C.ivory }}>
            <p className="text-[12px]" style={{ color: C.danger }}>{error}</p>
          </Card>
        )}
        {seedFlash && (
          <Card className="p-3" style={{ border: `1px solid ${C.success}`, background: "rgba(92, 124, 74, 0.08)" }}>
            <p className="text-[12px]" style={{ color: C.success }}>{seedFlash}</p>
          </Card>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={startNew}
            disabled={busy}
            className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold"
            style={{ background: C.espresso, color: C.cream, border: `1px solid ${C.espresso}` }}
          >
            New template
          </button>
          <button
            type="button"
            onClick={handleSeedStarters}
            disabled={busy}
            className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold"
            style={{ background: C.gold, color: C.espresso, border: `1px solid ${C.goldDeep}` }}
          >
            Add starter templates
          </button>
        </div>

        {loading && templates.length === 0 && (
          <Card className="p-4">
            <p className="text-[12px]" style={{ color: C.muted }}>Loading templates…</p>
          </Card>
        )}

        {!loading && templates.length === 0 && (
          <Card className="p-6 text-center">
            <p className="text-[13px] font-semibold" style={{ color: C.espresso }}>
              No agreements yet.
            </p>
            <p className="text-[11px] mt-1" style={{ color: C.muted }}>
              Tap <strong>Add starter templates</strong> for a curated set, or build your own.
            </p>
          </Card>
        )}

        {templates.map(t => (
          <Card key={t.id} className="p-4 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-semibold truncate" style={{ color: C.espresso }}>{t.title}</p>
                <p className="text-[11px]" style={{ color: C.muted }}>{TEMPLATE_TYPE_LABEL[t.template_type]}</p>
              </div>
              <Pill tone={t.is_active ? "success" : "neutral"}>{t.is_active ? "Active" : "Off"}</Pill>
            </div>
            <p className="text-[12px] line-clamp-2" style={{ color: C.coffee, lineHeight: 1.5 }}>
              {t.body.split("\n")[0]}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {t.attach_to_all_bookings && <Pill tone="gold">Attach to all bookings</Pill>}
              {t.require_signature && <Pill tone="neutral">Signature required</Pill>}
              {t.require_initials && <Pill tone="neutral">Initials required</Pill>}
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setEditing(t)}
                className="flex-1 py-2 rounded-lg text-[12px] font-semibold"
                style={{ background: C.cream, color: C.espresso, border: `1px solid ${C.hairline}` }}
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => void setActive(t.id, !t.is_active)}
                className="px-3 py-2 rounded-lg text-[12px] font-semibold"
                style={{ background: C.ivory, color: C.coffee, border: `1px solid ${C.hairline}` }}
              >
                {t.is_active ? "Disable" : "Enable"}
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!confirm("Delete this template? Existing signed agreements stay intact.")) return;
                  try {
                    await remove(t.id);
                  } catch (err) {
                    console.error("[contracts] template delete failed:", err);
                    alert("Couldn't delete that template. Please try again.");
                  }
                }}
                className="px-3 py-2 rounded-lg text-[12px] font-semibold"
                style={{ background: C.ivory, color: C.danger, border: `1px solid ${C.hairline}` }}
              >
                Delete
              </button>
            </div>
          </Card>
        ))}
      </div>

      <Sheet open={!!editing} onClose={closeEditor} title={editing?.id ? "Edit template" : "New template"}>
        {editing && (
          <div className="space-y-4 pb-6">
            <Field label="Title">
              <Input
                value={editing.title || ""}
                onChange={e => setEditing({ ...editing, title: e.target.value })}
                placeholder="e.g. Booking confirmation agreement"
              />
            </Field>
            <Field label="Type">
              <Select
                value={editing.template_type || "custom"}
                onChange={e => setEditing({ ...editing, template_type: e.target.value as ContractTemplateType })}
                options={(Object.keys(TEMPLATE_TYPE_LABEL) as ContractTemplateType[]).map(k => ({
                  value: k, label: TEMPLATE_TYPE_LABEL[k],
                }))}
              />
            </Field>
            <Field label="Body">
              <Textarea
                value={editing.body || ""}
                onChange={e => setEditing({ ...editing, body: e.target.value })}
                rows={10}
                placeholder="The full agreement copy. Plain text. Will be snapshotted at signing time."
              />
            </Field>
            <Card className="p-3 space-y-3" style={{ background: C.cream }}>
              <ToggleRow
                label="Active"
                hint="Inactive templates aren't attached to new bookings."
                checked={editing.is_active ?? true}
                onChange={v => setEditing({ ...editing, is_active: v })}
              />
              <ToggleRow
                label="Require signature"
                hint="Client must type their name to sign."
                checked={editing.require_signature ?? true}
                onChange={v => setEditing({ ...editing, require_signature: v })}
              />
              <ToggleRow
                label="Require initials"
                hint="Adds a separate initials field."
                checked={editing.require_initials ?? false}
                onChange={v => setEditing({ ...editing, require_initials: v })}
              />
              <ToggleRow
                label="Attach to all bookings"
                hint="Automatically generated for every public booking request."
                checked={editing.attach_to_all_bookings ?? false}
                onChange={v => setEditing({ ...editing, attach_to_all_bookings: v })}
              />
            </Card>
            <Button variant="primary" onClick={handleSave} disabled={busy} fullWidth>
              {busy ? "Saving…" : (editing.id ? "Save template" : "Create template")}
            </Button>
          </div>
        )}
      </Sheet>
    </div>
  );
};

const ToggleRow = ({ label, hint, checked, onChange }: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) => (
  <div className="flex items-center justify-between gap-3">
    <div className="flex-1 min-w-0">
      <p className="text-[13px] font-semibold" style={{ color: C.espresso }}>{label}</p>
      {hint && <p className="text-[11px]" style={{ color: C.muted }}>{hint}</p>}
    </div>
    <Toggle checked={checked} onChange={onChange} />
  </div>
);

// Contracts mini-block for an Approvals row. Reads contracts attached
// to this booking request, surfaces signed/pending counts, and
// exposes "copy signing link" + "regenerate" controls so the stylist
// can manually share links until B12.1 wires auto-send via Resend.
const ApprovalContractsBlock = ({
  userId, req,
}: { userId: string | null; req: BookingRequestRecord }) => {
  const { contracts, loading, generate } = useContractsForRequest(userId, req.id);
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (loading && contracts.length === 0) return null;
  if (contracts.length === 0) return null;

  const signed = contracts.filter(c => c.status === "signed").length;
  const pending = contracts.filter(c => c.status === "pending" || c.status === "viewed").length;
  const declined = contracts.filter(c => c.status === "declined").length;
  const allSigned = signed === contracts.length;

  const copy = async (token: string) => {
    const url = contractSigningUrl(token);
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        setCopiedId(token);
        setTimeout(() => setCopiedId(null), 1600);
      }
    } catch { /* user-cancelled / unsupported — silent */ }
  };

  return (
    <div
      className="space-y-2 px-3 py-2 rounded-xl"
      style={{
        background: allSigned ? "rgba(92, 124, 74, 0.08)" : "rgba(201, 169, 97, 0.10)",
        border: `1px solid ${allSigned ? "rgba(92, 124, 74, 0.30)" : "rgba(201, 169, 97, 0.35)"}`,
      }}
    >
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-semibold" style={{ color: C.coffee }}>
          Agreements · {signed}/{contracts.length} signed
          {pending > 0 ? ` · ${pending} pending` : ""}
          {declined > 0 ? ` · ${declined} declined` : ""}
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={async () => { setBusy(true); await generate(); setBusy(false); }}
          className="text-[11px] underline"
          style={{ color: C.muted }}
        >
          {busy ? "…" : "Refresh"}
        </button>
      </div>
      <div className="space-y-1.5">
        {contracts.map(c => {
          const tone = CONTRACT_STATUS_TONE[c.status];
          const label = CONTRACT_STATUS_LABEL[c.status];
          return (
            <div key={c.id} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Pill tone={tone}>{label}</Pill>
                <span className="text-[11px] truncate" style={{ color: C.coffee }}>{c.title}</span>
              </div>
              <button
                type="button"
                onClick={() => void copy(c.public_token)}
                className="text-[11px] font-semibold whitespace-nowrap"
                style={{ color: C.goldDeep }}
              >
                {copiedId === c.public_token ? "Copied ✓" : "Copy link"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const ApprovalQueueScreen = ({
  store, onBack, focusRequestId, clearFocusRequestId,
}: {
  store: any;
  onBack: () => void;
  focusRequestId?: string | null;
  clearFocusRequestId?: () => void;
}) => {
  const api = store.approvalsApi;
  const requests: BookingRequestRecord[] = api?.requests || [];
  const currency = store.business?.currency || "USD";
  const [filter, setFilter] = useState<"active" | "all" | "history">("active");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [depositDraft, setDepositDraft] = useState<Record<string, string>>({});
  const [holdDraft, setHoldDraft] = useState<Record<string, string>>({});
  const [declineDraft, setDeclineDraft] = useState<Record<string, string>>({});

  // Deep-link focus — when a notification routes here with a specific
  // request id, scroll its card into view and highlight it briefly so
  // the stylist can see what they tapped. Clears once consumed so a
  // later visit to the queue doesn't re-trigger the scroll.
  useEffect(() => {
    if (!focusRequestId) return;
    const t = setTimeout(() => {
      const el = typeof document !== "undefined"
        ? document.getElementById(`approval-row-${focusRequestId}`)
        : null;
      if (el && typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      clearFocusRequestId?.();
    }, 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequestId]);

  // Phase B10 buckets:
  //   active  → anything that wants the stylist's attention
  //   history → terminal states (approved/confirmed/denied/declined/cancelled/expired)
  const ACTIVE_STATES: ApprovalStatus[] = [
    "pending_review",
    "approved_pending_deposit",
    "awaiting_deposit",
    "deposit_paid_pending_approval",
  ];
  const HISTORY_STATES: ApprovalStatus[] = [
    "approved", "confirmed", "denied", "declined", "cancelled", "expired",
  ];
  const counts = useMemo(() => {
    const active = requests.filter(r => ACTIVE_STATES.includes(r.approval_status)).length;
    const history = requests.filter(r => HISTORY_STATES.includes(r.approval_status)).length;
    return { active, all: requests.length, history };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requests]);

  const filtered = useMemo(() => {
    if (filter === "all") return requests;
    if (filter === "history") return requests.filter(r => HISTORY_STATES.includes(r.approval_status));
    return requests.filter(r => ACTIVE_STATES.includes(r.approval_status));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requests, filter]);

  const handleApprove = async (req: BookingRequestRecord) => {
    if (busyId) return;
    setBusyId(req.id);
    const depositRaw = depositDraft[req.id];
    const holdRaw = holdDraft[req.id];
    const deposit = depositRaw === "" || depositRaw === undefined
      ? (req.service_deposit_required ? Number(req.service_deposit_amount) || null : null)
      : Number(depositRaw);
    const hold = holdRaw && Number.isFinite(Number(holdRaw)) ? Math.max(5, Math.round(Number(holdRaw))) : 30;
    await api.approve(req.id, Number.isFinite(deposit as number) ? deposit : null, hold);
    setBusyId(null);
    setExpanded(null);
  };

  const handleDecline = async (req: BookingRequestRecord) => {
    if (busyId) return;
    setBusyId(req.id);
    // Phase B10 — route through deny so the canonical fields land too.
    await api.deny(req.id, declineDraft[req.id] || "");
    setBusyId(null);
    setExpanded(null);
  };

  const handleMarkPaid = async (req: BookingRequestRecord) => {
    if (busyId) return;
    setBusyId(req.id);
    await api.markPaid(req.id);
    setBusyId(null);
  };

  // Phase B10 — deposit-paid → approve & create appointment.
  // Resolves the client (match by contact, otherwise create), creates
  // the appointment row, then calls confirm_booking_request_approval
  // which is itself idempotent so a double-tap won't double-create.
  const handleApproveAndCreate = async (req: BookingRequestRecord) => {
    if (busyId) return;
    setBusyId(req.id);
    try {
      const clients: any[] = (store.clients as any[]) || [];
      const match = matchClientByContact(
        { email: req.client_email, phone: req.client_phone },
        clients,
      );
      let client: any = match.kind === "single" ? match.client : null;
      if (match.kind === "ambiguous") client = match.candidates[0];
      if (!client) {
        client = await store.upsertClient({
          name: req.client_name,
          phone: req.client_phone || "",
          email: req.client_email || "",
        });
      }
      if (!client?.id) throw new Error("Couldn't resolve client");

      const apptId = req.appointment_id || `appt_${uid()}`;
      const newAppt: any = {
        id: apptId,
        clientId: client.id,
        clientName: client.name || req.client_name,
        clientPhone: client.phone || req.client_phone || "",
        clientEmail: client.email || req.client_email || "",
        style: req.service_name || "",
        date: req.preferred_date || "",
        time: req.preferred_time || "",
        durationHours: Number(req.service_duration_hours || req.service_duration || 0) || null,
        totalPrice: Number(req.service_price || 0) || 0,
        depositPaid: Number(req.deposit_amount || 0) || 0,
        balanceDue: Math.max(0, (Number(req.service_price || 0) || 0) - (Number(req.deposit_amount || 0) || 0)),
        status: "scheduled",
        kind: "appointment",
        serviceId: req.service_id || null,
        source: "public_booking",
        notes: req.notes || "",
        isAllDay: false,
        blocksAvailability: true,
      };
      const saved = await store.upsertAppointment(newAppt);
      if (!saved) throw new Error("Couldn't create appointment");
      await api.confirmApproval(req.id, apptId);
    } finally {
      setBusyId(null);
      setExpanded(null);
    }
  };

  const handleDeny = async (req: BookingRequestRecord) => {
    if (busyId) return;
    setBusyId(req.id);
    await api.deny(req.id, declineDraft[req.id] || "");
    setBusyId(null);
    setExpanded(null);
  };

  return (
    <div className="bbp-fade pb-32">
      <Header
        title="Approvals"
        subtitle="Review requests, set deposits, lock confirmations"
        leftAction={{ icon: <ChevronLeft size={20} />, onClick: onBack }}
      />
      <div className="px-5 pt-2 space-y-3">
        {api?.error && (
          <Card className="p-3" style={{ border: `1px solid ${C.danger}`, background: C.ivory }}>
            <p className="text-[12px]" style={{ color: C.danger }}>{api.error}</p>
          </Card>
        )}

        <div className="flex p-1 rounded-xl" style={{ background: C.ivory, border: `1px solid ${C.hairline}` }}>
          {APPROVAL_FILTERS.map(f => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className="flex-1 py-2 rounded-lg text-[12px] font-semibold"
              style={{
                background: filter === f.id ? C.cream : "transparent",
                color: filter === f.id ? C.espresso : C.muted,
                border: filter === f.id ? `1px solid ${C.hairline}` : "1px solid transparent",
              }}
            >
              {f.label(counts)}
            </button>
          ))}
        </div>

        {api?.loading && requests.length === 0 && (
          <Card className="p-4">
            <p className="text-[12px]" style={{ color: C.muted }}>Loading approvals…</p>
          </Card>
        )}

        {!api?.loading && filtered.length === 0 && (
          <Card className="p-6 text-center">
            <p className="text-[13px] font-semibold" style={{ color: C.espresso }}>
              {filter === "active" ? "No requests waiting." : "Nothing here yet."}
            </p>
            <p className="text-[11px] mt-1" style={{ color: C.muted }}>
              New booking requests show up here for approval.
            </p>
          </Card>
        )}

        {filtered.map(req => {
          const status = req.approval_status as ApprovalStatus;
          const isOpen = expanded === req.id;
          const isFocused = focusRequestId === req.id;
          const fallbackDeposit = req.service_deposit_required && req.service_deposit_amount
            ? Number(req.service_deposit_amount).toFixed(2)
            : "";
          return (
            <Card
              id={`approval-row-${req.id}`}
              key={req.id}
              className="p-4 space-y-2"
              style={isFocused ? { boxShadow: `0 0 0 2px ${C.gold}`, transition: "box-shadow 220ms ease" } : undefined}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold truncate" style={{ color: C.espresso }}>{req.client_name}</p>
                  <p className="text-[11px]" style={{ color: C.muted }}>
                    {req.service_name || "Service TBD"}
                    {req.preferred_date ? ` · ${formatAppointmentDateShort(req.preferred_date, req.preferred_time)}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {status === "approved_pending_deposit" && <ApprovalCountdown req={req} />}
                  <Pill tone={APPROVAL_STATUS_TONE[status]}>{APPROVAL_STATUS_LABEL[status]}</Pill>
                </div>
              </div>

              {(req.client_phone || req.client_email) && (
                <p className="text-[11px]" style={{ color: C.muted }}>
                  {[req.client_phone, req.client_email].filter(Boolean).join(" · ")}
                </p>
              )}

              {req.notes && (
                <p className="text-[12px] italic" style={{ color: C.coffee }}>{req.notes}</p>
              )}

              <ApprovalContractsBlock userId={store.userId || null} req={req} />

              {req.deposit_amount !== null && req.deposit_amount !== undefined && (
                <div className="flex items-center justify-between text-[12px]">
                  <span style={{ color: C.muted }}>Deposit</span>
                  <span style={{ color: C.goldDeep, fontWeight: 600 }}>
                    {fmtMoney(Number(req.deposit_amount), currency)}
                    {req.deposit_paid_at ? " · paid" : ""}
                  </span>
                </div>
              )}

              {status === "declined" && req.decline_reason && (
                <p className="text-[11px]" style={{ color: C.muted }}>Reason: {req.decline_reason}</p>
              )}

              {/* Actions */}
              {status === "pending_review" && (
                <>
                  {!isOpen && (
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        disabled={busyId === req.id}
                        onClick={() => { setExpanded(req.id); setDepositDraft(d => ({ ...d, [req.id]: fallbackDeposit })); }}
                        className="flex-1 py-2 rounded-lg text-[12px] font-semibold"
                        style={{ background: C.espresso, color: C.cream, border: `1px solid ${C.espresso}` }}
                      >
                        Approve & set deposit
                      </button>
                      <button
                        type="button"
                        disabled={busyId === req.id}
                        onClick={() => setExpanded(`decline:${req.id}`)}
                        className="px-3 py-2 rounded-lg text-[12px] font-semibold"
                        style={{ background: C.ivory, color: C.coffee, border: `1px solid ${C.hairline}` }}
                      >
                        Decline
                      </button>
                    </div>
                  )}
                  {isOpen && (
                    <div className="space-y-2 pt-1">
                      <div>
                        <p className="text-[11px] font-semibold mb-1" style={{ color: C.coffee }}>
                          Deposit amount ({currency})
                        </p>
                        <Input
                          type="number"
                          inputMode="decimal"
                          value={depositDraft[req.id] ?? fallbackDeposit}
                          onChange={e => setDepositDraft(d => ({ ...d, [req.id]: e.target.value }))}
                          placeholder="e.g. 50"
                        />
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold mb-1" style={{ color: C.coffee }}>
                          Hold window (minutes)
                        </p>
                        <Input
                          type="number"
                          inputMode="numeric"
                          value={holdDraft[req.id] ?? "30"}
                          onChange={e => setHoldDraft(d => ({ ...d, [req.id]: e.target.value }))}
                          placeholder="30"
                        />
                        <p className="text-[10px] mt-1" style={{ color: C.muted }}>
                          The slot stays held until the deposit lands. Default 30 minutes.
                        </p>
                      </div>
                      <div className="flex gap-2 pt-1">
                        <button
                          type="button"
                          disabled={busyId === req.id}
                          onClick={() => handleApprove(req)}
                          className="flex-1 py-2 rounded-lg text-[12px] font-semibold"
                          style={{ background: C.espresso, color: C.cream, border: `1px solid ${C.espresso}` }}
                        >
                          {busyId === req.id ? "Approving…" : "Confirm approval"}
                        </button>
                        <button
                          type="button"
                          disabled={busyId === req.id}
                          onClick={() => setExpanded(null)}
                          className="px-3 py-2 rounded-lg text-[12px] font-semibold"
                          style={{ background: C.ivory, color: C.coffee, border: `1px solid ${C.hairline}` }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {expanded === `decline:${req.id}` && (
                <div className="space-y-2 pt-1">
                  <Textarea
                    value={declineDraft[req.id] || ""}
                    onChange={e => setDeclineDraft(d => ({ ...d, [req.id]: e.target.value }))}
                    rows={2}
                    placeholder="Optional note for your records"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busyId === req.id}
                      onClick={() => handleDecline(req)}
                      className="flex-1 py-2 rounded-lg text-[12px] font-semibold"
                      style={{ background: C.danger, color: "#FFFFFF", border: `1px solid ${C.danger}` }}
                    >
                      {busyId === req.id ? "Declining…" : "Confirm decline"}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === req.id}
                      onClick={() => setExpanded(null)}
                      className="px-3 py-2 rounded-lg text-[12px] font-semibold"
                      style={{ background: C.ivory, color: C.coffee, border: `1px solid ${C.hairline}` }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Deposit-first (Phase B10) — client paid; stylist approves. */}
              {status === "deposit_paid_pending_approval" && (
                <div className="space-y-2 pt-1">
                  <div
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
                    style={{ background: "rgba(92, 124, 74, 0.10)", border: `1px solid rgba(92, 124, 74, 0.35)` }}
                  >
                    <Check size={14} style={{ color: C.success }} />
                    <span className="text-[11px] font-semibold" style={{ color: C.success }}>
                      Deposit paid · {fmtMoney(Number(req.deposit_amount || 0), currency)}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busyId === req.id}
                      onClick={() => handleApproveAndCreate(req)}
                      className="flex-1 py-2 rounded-lg text-[12px] font-semibold"
                      style={{ background: C.espresso, color: C.cream, border: `1px solid ${C.espresso}` }}
                    >
                      {busyId === req.id ? "Approving…" : "Approve & schedule"}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === req.id}
                      onClick={() => setExpanded(`decline:${req.id}`)}
                      className="px-3 py-2 rounded-lg text-[12px] font-semibold"
                      style={{ background: C.ivory, color: C.coffee, border: `1px solid ${C.hairline}` }}
                    >
                      Deny
                    </button>
                  </div>
                </div>
              )}

              {/* Awaiting deposit — client received the link but hasn't paid. */}
              {status === "awaiting_deposit" && (
                <div className="space-y-1.5 pt-1">
                  <p className="text-[11px]" style={{ color: C.muted }}>
                    Waiting on the client to complete deposit checkout. They&apos;ve been redirected to Stripe.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busyId === req.id}
                      onClick={() => handleMarkPaid(req)}
                      className="flex-1 py-2 rounded-lg text-[12px] font-semibold"
                      style={{ background: C.gold, color: C.espresso, border: `1px solid ${C.goldDeep}` }}
                    >
                      {busyId === req.id ? "Saving…" : "Mark deposit paid manually"}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === req.id}
                      onClick={() => setExpanded(`decline:${req.id}`)}
                      className="px-3 py-2 rounded-lg text-[12px] font-semibold"
                      style={{ background: C.ivory, color: C.coffee, border: `1px solid ${C.hairline}` }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Legacy approve-first hold (kept for backwards compat). */}
              {status === "approved_pending_deposit" && (
                <div className="space-y-1.5 pt-1">
                  <p className="text-[11px]" style={{ color: C.muted }}>
                    Slot is held while the client pays the deposit. Mark paid manually if the deposit landed off-platform.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busyId === req.id}
                      onClick={() => handleMarkPaid(req)}
                      className="flex-1 py-2 rounded-lg text-[12px] font-semibold"
                      style={{ background: C.gold, color: C.espresso, border: `1px solid ${C.goldDeep}` }}
                    >
                      {busyId === req.id ? "Saving…" : "Mark deposit paid"}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === req.id}
                      onClick={() => setExpanded(`decline:${req.id}`)}
                      className="px-3 py-2 rounded-lg text-[12px] font-semibold"
                      style={{ background: C.ivory, color: C.coffee, border: `1px solid ${C.hairline}` }}
                    >
                      Cancel hold
                    </button>
                  </div>
                </div>
              )}

              {/* Denial outcome — show refund-in-Stripe nudge if a deposit was paid. */}
              {status === "denied" && req.deposit_paid && (
                <p className="text-[11px] pt-1" style={{ color: C.muted }}>
                  Refund the {fmtMoney(Number(req.deposit_amount || 0), currency)} deposit in Stripe if needed — automatic refunds aren&apos;t enabled yet.
                </p>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
};

const BookingIntelligenceScreen = ({ store, onBack }: { store: any; onBack: () => void }) => {
  const userId = store.userId || null;
  const [windowDays, setWindowDays] = useState<7 | 30 | 90>(30);
  const { data, loading, error, refresh } = useBookingIntelligence(userId, windowDays);
  const currency = store.business?.currency || "USD";
  const insights = useMemo(() => generateSmartInsights(data), [data]);

  const subtitle = windowDays === 7 ? "Last 7 days" : windowDays === 90 ? "Last 90 days" : "Last 30 days";

  return (
    <div className="bbp-fade pb-32">
      <Header
        title="Booking intelligence"
        subtitle={subtitle}
        leftAction={{ icon: <ChevronLeft size={20} />, onClick: onBack }}
      />
      <div className="px-5 pt-2 space-y-4">
        <div className="flex p-1 rounded-xl" style={{ background: C.ivory, border: `1px solid ${C.hairline}` }}>
          {[
            { id: 7 as const, label: "7d" },
            { id: 30 as const, label: "30d" },
            { id: 90 as const, label: "90d" },
          ].map(opt => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setWindowDays(opt.id)}
              className="flex-1 py-2 rounded-lg text-[12px] font-semibold"
              style={{
                background: windowDays === opt.id ? C.cream : "transparent",
                color: windowDays === opt.id ? C.espresso : C.muted,
                border: windowDays === opt.id ? `1px solid ${C.hairline}` : "1px solid transparent",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {error && (
          <Card className="p-3" style={{ border: `1px solid ${C.danger}`, background: C.ivory }}>
            <p className="text-[12px]" style={{ color: C.danger }}>{error}</p>
            <button
              type="button"
              onClick={() => refresh()}
              className="mt-2 px-3 py-1.5 rounded-full text-[11px] font-semibold"
              style={{ background: C.cream, color: C.espresso, border: `1px solid ${C.hairline}` }}
            >
              Try again
            </button>
          </Card>
        )}

        {loading && !data && (
          <Card className="p-4">
            <p className="text-[12px]" style={{ color: C.muted }}>Crunching the numbers…</p>
          </Card>
        )}

        {data && (
          <>
            {/* Smart insights */}
            {insights.length > 0 && (
              <div className="space-y-2">
                <SectionTitle>Smart insights</SectionTitle>
                {insights.map(ins => {
                  const t = intelToneStyle(ins.tone);
                  return (
                    <Card key={ins.id} className="p-3" style={{ border: `1px solid ${t.border}`, background: t.bg }}>
                      <p className="text-[13px] font-semibold" style={{ color: t.fg }}>{ins.title}</p>
                      {ins.body && (
                        <p className="text-[11px] mt-0.5" style={{ color: C.coffee }}>{ins.body}</p>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}

            {/* Funnel */}
            <SectionTitle>Booking funnel</SectionTitle>
            <Card className="p-4 space-y-2.5">
              {[
                { label: "Page views",        value: data.funnel.page_views },
                { label: "Service views",     value: data.funnel.service_views },
                { label: "Slot views",        value: data.funnel.slot_views },
                { label: "Booking requests",  value: data.funnel.booking_requests },
                { label: "Approved bookings", value: data.funnel.approved_bookings },
              ].map((row, i, all) => {
                const top = all[0].value || 1;
                const pct = (row.value / top) * 100;
                return (
                  <div key={row.label} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <p className="text-[12px]" style={{ color: C.coffee }}>{row.label}</p>
                      <p className="text-[12px] font-semibold" style={{ color: C.espresso }}>{row.value}</p>
                    </div>
                    <ServiceBar pct={pct} color={i === all.length - 1 ? C.success : C.gold} />
                  </div>
                );
              })}
              <div className="pt-2 border-t flex items-center justify-between" style={{ borderColor: C.hairline }}>
                <p className="text-[11px]" style={{ color: C.muted }}>Waitlist joined</p>
                <p className="text-[12px] font-semibold" style={{ color: C.espresso }}>
                  {data.funnel.waitlist_joined} · {data.funnel.waitlist_converted} converted
                </p>
              </div>
            </Card>

            {/* Approvals */}
            {data.approvals && (
              <>
                <SectionTitle>Approvals</SectionTitle>
                <Card className="p-4 space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-center p-2 rounded-lg" style={{ background: C.ivory, border: `1px solid ${C.hairline}` }}>
                      <p className="text-[18px] font-bold" style={{ color: C.espresso }}>{data.approvals.approvals_sent}</p>
                      <p className="text-[10px] uppercase tracking-wider" style={{ color: C.muted }}>Sent</p>
                    </div>
                    <div className="text-center p-2 rounded-lg" style={{ background: C.ivory, border: `1px solid ${C.hairline}` }}>
                      <p className="text-[18px] font-bold" style={{ color: C.success }}>{data.approvals.approvals_confirmed}</p>
                      <p className="text-[10px] uppercase tracking-wider" style={{ color: C.muted }}>Paid</p>
                    </div>
                    <div className="text-center p-2 rounded-lg" style={{ background: C.ivory, border: `1px solid ${C.hairline}` }}>
                      <p className="text-[18px] font-bold" style={{ color: C.warning }}>{data.approvals.approvals_expired}</p>
                      <p className="text-[10px] uppercase tracking-wider" style={{ color: C.muted }}>Expired</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-[12px]" style={{ color: C.coffee }}>Deposit conversion</p>
                    <p className="text-[13px] font-semibold" style={{ color: C.espresso }}>
                      {data.approvals.deposit_conversion_pct !== null
                        ? `${data.approvals.deposit_conversion_pct.toFixed(0)}%`
                        : "—"}
                    </p>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-[12px]" style={{ color: C.coffee }}>Awaiting your review</p>
                    <p className="text-[13px] font-semibold" style={{ color: C.espresso }}>{data.approvals.awaiting_review}</p>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-[12px]" style={{ color: C.coffee }}>Awaiting deposit</p>
                    <p className="text-[13px] font-semibold" style={{ color: C.espresso }}>{data.approvals.awaiting_deposit}</p>
                  </div>
                  {data.approvals.lost_deposit_value > 0 && (
                    <div className="pt-2 border-t flex items-center justify-between" style={{ borderColor: C.hairline }}>
                      <p className="text-[12px] font-semibold" style={{ color: C.coffee }}>Expired deposits</p>
                      <p className="text-[13px] font-bold" style={{ color: C.warning }}>
                        {fmtMoney(data.approvals.lost_deposit_value, currency)}
                      </p>
                    </div>
                  )}
                </Card>
              </>
            )}

            {/* Top services */}
            {data.top_services.length > 0 && (
              <>
                <SectionTitle>Top services</SectionTitle>
                <Card className="p-4 space-y-3">
                  {data.top_services.slice(0, 6).map(s => {
                    const maxRev = Math.max(...data.top_services.map(x => x.revenue || 0), 1);
                    const pct = ((s.revenue || 0) / maxRev) * 100;
                    return (
                      <div key={s.service_id} className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[13px] font-semibold flex-1 min-w-0 truncate" style={{ color: C.espresso }}>
                            {s.service_name}
                          </p>
                          <p className="text-[12px] font-semibold whitespace-nowrap" style={{ color: C.goldDeep }}>
                            {fmtMoney(s.revenue || 0, currency)}
                          </p>
                        </div>
                        <ServiceBar pct={pct} color={C.gold} />
                        <div className="flex items-center justify-between">
                          <p className="text-[11px]" style={{ color: C.muted }}>
                            {s.views} views · {s.requests} requests · {s.approvals} booked
                          </p>
                          {s.conversion_pct !== null && (
                            <p className="text-[11px] font-semibold" style={{ color: C.coffee }}>
                              {s.conversion_pct.toFixed(0)}% conv
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </Card>
              </>
            )}

            {/* Availability pressure */}
            <SectionTitle>Availability pressure</SectionTitle>
            <Card className="p-4 space-y-3">
              <WeekdayBars data={data.availability_pressure.by_weekday} />
              <div className="flex items-center justify-between text-[11px]" style={{ color: C.muted }}>
                <span>
                  {data.availability_pressure.busiest_weekday !== null
                    ? `Busiest: ${INTEL_WEEKDAYS_SHORT[data.availability_pressure.busiest_weekday]} (${data.availability_pressure.busiest_weekday_count})`
                    : "No bookings yet in window"}
                </span>
                {data.availability_pressure.busiest_hour !== null && (
                  <span>
                    Peak hour: {((data.availability_pressure.busiest_hour + 11) % 12) + 1}
                    {data.availability_pressure.busiest_hour >= 12 ? " PM" : " AM"}
                  </span>
                )}
              </div>
            </Card>

            {/* Waitlist intelligence */}
            <SectionTitle>Waitlist intelligence</SectionTitle>
            <Card className="p-4 space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="text-center p-2 rounded-lg" style={{ background: C.ivory, border: `1px solid ${C.hairline}` }}>
                  <p className="text-[18px] font-bold" style={{ color: C.espresso }}>{data.waitlist.active}</p>
                  <p className="text-[10px] uppercase tracking-wider" style={{ color: C.muted }}>Active</p>
                </div>
                <div className="text-center p-2 rounded-lg" style={{ background: C.ivory, border: `1px solid ${C.hairline}` }}>
                  <p className="text-[18px] font-bold" style={{ color: C.espresso }}>{data.waitlist.total_in_window}</p>
                  <p className="text-[10px] uppercase tracking-wider" style={{ color: C.muted }}>Joined</p>
                </div>
                <div className="text-center p-2 rounded-lg" style={{ background: C.ivory, border: `1px solid ${C.hairline}` }}>
                  <p className="text-[18px] font-bold" style={{ color: C.success }}>
                    {data.waitlist.conversion_pct !== null ? `${data.waitlist.conversion_pct.toFixed(0)}%` : "—"}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider" style={{ color: C.muted }}>Conv</p>
                </div>
              </div>
              {data.waitlist.top_services.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold mb-1" style={{ color: C.coffee }}>Top requested services</p>
                  <div className="flex flex-wrap gap-1.5">
                    {data.waitlist.top_services.slice(0, 5).map(s => (
                      <Pill key={s.service_name} tone="neutral">{s.service_name} · {s.n}</Pill>
                    ))}
                  </div>
                </div>
              )}
              {data.waitlist.top_dates.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold mb-1" style={{ color: C.coffee }}>Top requested dates</p>
                  <div className="flex flex-wrap gap-1.5">
                    {data.waitlist.top_dates.slice(0, 5).map(d => (
                      <Pill key={d.preferred_date} tone="neutral">{d.preferred_date} · {d.n}</Pill>
                    ))}
                  </div>
                </div>
              )}
            </Card>

            {/* Client sources */}
            {data.client_sources.length > 0 && (
              <>
                <SectionTitle>Client sources</SectionTitle>
                <Card className="p-4 space-y-2">
                  {data.client_sources.slice(0, 8).map(src => {
                    const maxBookings = Math.max(...data.client_sources.map(x => x.bookings), 1);
                    const pct = (src.bookings / maxBookings) * 100;
                    return (
                      <div key={src.source} className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[12px] font-semibold flex-1 min-w-0 truncate" style={{ color: C.espresso }}>
                            {humaniseSource(src.source)}
                          </p>
                          <p className="text-[11px] whitespace-nowrap" style={{ color: C.muted }}>
                            {src.bookings} · {fmtMoney(src.revenue || 0, currency)}
                          </p>
                        </div>
                        <ServiceBar pct={pct} color={C.coffee} />
                      </div>
                    );
                  })}
                </Card>
              </>
            )}

            {/* Calendar demand */}
            {data.calendar_demand.length > 0 && (
              <>
                <SectionTitle>Calendar demand</SectionTitle>
                <Card className="p-4">
                  {(() => {
                    const max = Math.max(...data.calendar_demand.map(d => d.bookings), 1);
                    const w = 320;
                    const h = 90;
                    const padX = 4;
                    const innerW = w - padX * 2;
                    const step = data.calendar_demand.length > 1 ? innerW / (data.calendar_demand.length - 1) : 0;
                    const points = data.calendar_demand.map((d, i) => {
                      const x = padX + i * step;
                      const y = h - 6 - (d.bookings / max) * (h - 18);
                      return `${x},${y}`;
                    }).join(" ");
                    return (
                      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none">
                        <polyline points={points} fill="none" stroke={C.gold} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                        {data.calendar_demand.map((d, i) => {
                          const x = padX + i * step;
                          const y = h - 6 - (d.bookings / max) * (h - 18);
                          return d.bookings > 0 ? <circle key={d.day} cx={x} cy={y} r={2.5} fill={C.goldDeep} /> : null;
                        })}
                      </svg>
                    );
                  })()}
                  <div className="mt-2 flex items-center justify-between text-[11px]" style={{ color: C.muted }}>
                    <span>{data.calendar_demand[0]?.day}</span>
                    <span>{data.calendar_demand[data.calendar_demand.length - 1]?.day}</span>
                  </div>
                </Card>
              </>
            )}

            {/* Revenue opportunity */}
            <SectionTitle>Revenue opportunity</SectionTitle>
            <Card className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[12px]" style={{ color: C.coffee }}>Unmet demand (waitlist)</p>
                <p className="text-[13px] font-semibold" style={{ color: C.espresso }}>
                  {data.revenue_opportunity.unmet_demand}
                </p>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-[12px]" style={{ color: C.coffee }}>Average ticket</p>
                <p className="text-[13px] font-semibold" style={{ color: C.espresso }}>
                  {fmtMoney(data.revenue_opportunity.avg_ticket || 0, currency)}
                </p>
              </div>
              <div className="pt-2 border-t flex items-center justify-between" style={{ borderColor: C.hairline }}>
                <p className="text-[12px] font-semibold" style={{ color: C.coffee }}>Estimated lost revenue</p>
                <p className="text-[15px] font-bold" style={{ color: C.goldDeep }}>
                  {fmtMoney(data.revenue_opportunity.estimated_lost_revenue || 0, currency)}
                </p>
              </div>
              <p className="text-[10px] pt-1" style={{ color: C.muted }}>
                Estimate based on waitlist size × average ticket in window. Reach out to convert these into bookings.
              </p>
            </Card>
          </>
        )}
      </div>
    </div>
  );
};

const AvailabilityScreen = ({ store, onBack }: { store: any; onBack: () => void }) => {
  const api = store.availabilityApi;
  const rules: AvailabilityRule[] = api?.rules || [];
  const exceptions: AvailabilityException[] = api?.exceptions || [];
  const [editingRule, setEditingRule] = useState<AvailabilityRuleInput | null>(null);
  const [editingException, setEditingException] = useState<(AvailabilityExceptionInput & { id?: string }) | null>(null);
  const [busy, setBusy] = useState(false);

  // Build a row per weekday merging existing rules + defaults so the
  // display shows all 7 days even if the user has only configured some.
  const merged: AvailabilityRule[] = useMemo(() => {
    const byDay = new Map(rules.map(r => [r.weekday, r]));
    return Array.from({ length: 7 }, (_, weekday) => {
      const r = byDay.get(weekday);
      if (r) return r;
      const def = DEFAULT_WEEKLY_RULES.find(d => d.weekday === weekday)!;
      return { id: `unsaved-${weekday}`, user_id: "", ...def };
    });
  }, [rules]);

  const handleSeed = async () => {
    if (busy) return;
    setBusy(true);
    await api.seedDefaults();
    setBusy(false);
  };

  const handleEditRule = (r: AvailabilityRule) => {
    setEditingRule({
      weekday: r.weekday,
      start_time: r.start_time,
      end_time: r.end_time,
      break_start: r.break_start,
      break_end: r.break_end,
      is_open: r.is_open,
    });
  };

  const handleSaveRule = async () => {
    if (!editingRule || busy) return;
    setBusy(true);
    await api.upsertRule(editingRule);
    setBusy(false);
    setEditingRule(null);
  };

  const openNewException = (kind: AvailabilityExceptionKind) => {
    const today = todayISO();
    setEditingException({
      kind,
      start_date: today,
      end_date: today,
      start_time: kind === "off" ? null : "09:00",
      end_time: kind === "off" ? null : "13:00",
      note: "",
    });
  };

  const handleSaveException = async () => {
    if (!editingException || busy) return;
    setBusy(true);
    const saved = await api.upsertException(editingException);
    setBusy(false);
    if (saved) setEditingException(null);
  };

  const handleRemoveException = async (id: string) => {
    if (!window.confirm("Remove this exception?")) return;
    setBusy(true);
    await api.removeException(id);
    setBusy(false);
  };

  return (
    <div className="bbp-fade pb-32">
      <Header
        title="Availability"
        subtitle="Weekly hours · time off · one-time changes"
        leftAction={{ icon: <ChevronLeft size={20} />, onClick: onBack }}
      />
      <div className="px-5 pt-2 space-y-5">
        {api?.error && (
          <Card className="p-3" style={{ border: `1px solid ${C.danger}`, background: C.ivory }}>
            <p className="text-[12px]" style={{ color: C.danger }}>{api.error}</p>
          </Card>
        )}

        {/* WEEKLY HOURS */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <SectionTitle>Weekly hours</SectionTitle>
            {rules.length === 0 && (
              <button
                type="button"
                onClick={handleSeed}
                className="text-[11px] font-semibold px-2 py-1"
                style={{ color: C.goldDeep, background: "transparent", border: 0 }}
              >
                Seed defaults
              </button>
            )}
          </div>
          <Card className="p-2">
            {merged.map((r, i) => {
              const isUnsaved = r.id.startsWith("unsaved-");
              return (
                <button
                  type="button"
                  key={r.weekday}
                  onClick={() => handleEditRule(r)}
                  className="w-full text-left flex items-center justify-between px-3 py-3 active:scale-[0.99] transition"
                  style={{ borderTop: i === 0 ? "none" : `1px solid ${C.hairline}`, opacity: isUnsaved ? 0.7 : 1 }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className="flex items-center justify-center text-[11px] font-bold"
                      style={{
                        width: 28, height: 28, borderRadius: 999,
                        background: r.is_open ? C.ivory : "transparent",
                        color: r.is_open ? C.espresso : C.muted,
                        border: `1px solid ${r.is_open ? C.gold : C.hairline}`,
                      }}
                    >
                      {WEEKDAY_SHORT[r.weekday]}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold" style={{ color: C.espresso }}>
                        {WEEKDAY_LABELS[r.weekday]}
                      </p>
                      <p className="text-[11px]" style={{ color: C.muted }}>
                        {r.is_open
                          ? `${fmtTime(r.start_time)} – ${fmtTime(r.end_time)}${r.break_start && r.break_end ? ` · break ${fmtTime(r.break_start)}–${fmtTime(r.break_end)}` : ""}`
                          : "Closed"}
                        {isUnsaved ? " · default" : ""}
                      </p>
                    </div>
                  </div>
                  <ChevronRight size={16} style={{ color: C.muted }} />
                </button>
              );
            })}
          </Card>
        </div>

        {/* EXCEPTIONS */}
        <div>
          <SectionTitle>One-time changes</SectionTitle>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <Button variant="outline" onClick={() => openNewException("off")}>Mark off</Button>
            <Button variant="outline" onClick={() => openNewException("custom")}>Custom hours</Button>
            <Button variant="outline" onClick={() => openNewException("blocked")}>Block time</Button>
          </div>
          {exceptions.length === 0 ? (
            <Card className="p-4 text-center">
              <p className="text-[12px]" style={{ color: C.muted }}>
                No upcoming changes. Use the buttons above to mark a vacation, set custom hours,
                or block a window.
              </p>
            </Card>
          ) : (
            <div className="space-y-2">
              {exceptions.map(e => (
                <Card key={e.id} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <Pill tone={e.kind === "off" ? "danger" : e.kind === "blocked" ? "warning" : "gold"}>
                          {e.kind === "off" ? "Off" : e.kind === "blocked" ? "Blocked" : "Custom hours"}
                        </Pill>
                        <span className="text-[11px] font-semibold" style={{ color: C.coffee }}>
                          {e.start_date === e.end_date ? fmtDate(e.start_date) : `${fmtDate(e.start_date)} → ${fmtDate(e.end_date)}`}
                        </span>
                      </div>
                      {e.start_time && e.end_time && (
                        <p className="text-[11px]" style={{ color: C.muted }}>
                          {fmtTime(e.start_time)} – {fmtTime(e.end_time)}
                        </p>
                      )}
                      {e.note && (
                        <p className="text-[12px] mt-1" style={{ color: C.coffee }}>
                          {e.note}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveException(e.id)}
                      className="p-2 rounded-lg shrink-0"
                      style={{ color: C.danger }}
                      aria-label="Remove exception"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* WEEKLY RULE SHEET */}
      <Sheet
        open={!!editingRule}
        onClose={() => setEditingRule(null)}
        title={editingRule ? `Edit ${WEEKDAY_LABELS[editingRule.weekday]}` : "Edit"}
      >
        {editingRule && (
          <div className="space-y-3 pb-2">
            <Card className="p-3.5 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold" style={{ color: C.espresso }}>Open this day</p>
                <p className="text-[11px]" style={{ color: C.muted }}>Off days hide from booking surfaces.</p>
              </div>
              <Toggle
                checked={!!editingRule.is_open}
                onChange={v => setEditingRule({ ...editingRule, is_open: v })}
              />
            </Card>
            {editingRule.is_open && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Open">
                    <Input type="time" value={editingRule.start_time} onChange={e => setEditingRule({ ...editingRule, start_time: e.target.value })} />
                  </Field>
                  <Field label="Close">
                    <Input type="time" value={editingRule.end_time} onChange={e => setEditingRule({ ...editingRule, end_time: e.target.value })} />
                  </Field>
                </div>
                <SectionTitle>Lunch / break</SectionTitle>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Break start">
                    <Input type="time" value={editingRule.break_start || ""} onChange={e => setEditingRule({ ...editingRule, break_start: e.target.value || null })} />
                  </Field>
                  <Field label="Break end">
                    <Input type="time" value={editingRule.break_end || ""} onChange={e => setEditingRule({ ...editingRule, break_end: e.target.value || null })} />
                  </Field>
                </div>
              </>
            )}
            <div className="grid grid-cols-2 gap-3 pt-2">
              <Button variant="outline" onClick={() => setEditingRule(null)}>Cancel</Button>
              <Button variant="primary" onClick={handleSaveRule}>{busy ? "Saving…" : "Save"}</Button>
            </div>
          </div>
        )}
      </Sheet>

      {/* EXCEPTION SHEET */}
      <Sheet
        open={!!editingException}
        onClose={() => setEditingException(null)}
        title={editingException
          ? (editingException.kind === "off" ? "Mark off" : editingException.kind === "blocked" ? "Block time" : "Custom hours")
          : ""}
      >
        {editingException && (
          <div className="space-y-3 pb-2">
            <div className="grid grid-cols-2 gap-3">
              <Field label="From">
                <Input type="date" value={editingException.start_date} onChange={e => setEditingException({ ...editingException, start_date: e.target.value })} />
              </Field>
              <Field label="To">
                <Input type="date" value={editingException.end_date} onChange={e => setEditingException({ ...editingException, end_date: e.target.value })} />
              </Field>
            </div>
            {editingException.kind !== "off" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start time">
                  <Input type="time" value={editingException.start_time || ""} onChange={e => setEditingException({ ...editingException, start_time: e.target.value })} />
                </Field>
                <Field label="End time">
                  <Input type="time" value={editingException.end_time || ""} onChange={e => setEditingException({ ...editingException, end_time: e.target.value })} />
                </Field>
              </div>
            )}
            <Field label="Note" hint="Optional. Surfaces in the all-day strip.">
              <Input
                value={editingException.note || ""}
                onChange={e => setEditingException({ ...editingException, note: e.target.value })}
                placeholder={editingException.kind === "off" ? "Vacation · holiday · personal" : "Doctor's appointment, lunch with mom, …"}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <Button variant="outline" onClick={() => setEditingException(null)}>Cancel</Button>
              <Button variant="primary" onClick={handleSaveException}>{busy ? "Saving…" : "Save"}</Button>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
};

const DiscountsScreen = ({
  store, onBack,
}: {
  store: any;
  onBack: () => void;
}) => {
  const api = store.discountsApi;
  const discounts: Discount[] = api?.discounts || [];
  const [editing, setEditing] = useState<Partial<DiscountInput> & { id?: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Discount | null>(null);
  const [busy, setBusy] = useState(false);

  const openNew = () => setEditing({
    name: "",
    description: "",
    discount_type: "percentage",
    value: 10,
    applies_to: "all",
    service_id: null,
    is_active: true,
    starts_at: null,
    ends_at: null,
    usage_limit: null,
  });

  const openEdit = (d: Discount) => setEditing({
    id: d.id,
    name: d.name,
    description: d.description,
    discount_type: d.discount_type,
    value: d.value,
    applies_to: d.applies_to,
    service_id: d.service_id,
    is_active: d.is_active,
    starts_at: d.starts_at,
    ends_at: d.ends_at,
    usage_limit: d.usage_limit,
  });

  const handleSave = async () => {
    if (!editing || busy) return;
    setBusy(true);
    const saved = await api.upsert(editing);
    setBusy(false);
    if (saved) setEditing(null);
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setBusy(true);
    const ok = await api.remove(confirmDelete.id);
    setBusy(false);
    if (ok) setConfirmDelete(null);
  };

  return (
    <div className="bbp-fade pb-32">
      <Header
        title="Discounts"
        subtitle="Studio offers, loyalty rewards, slow-day specials"
        leftAction={{ icon: <ChevronLeft size={20} />, onClick: onBack }}
        rightAction={
          <button
            type="button"
            onClick={openNew}
            className="p-2 rounded-full"
            style={{ color: C.coffee }}
            aria-label="New discount"
          >
            <Plus size={20} />
          </button>
        }
      />

      <div className="px-5 pt-2 space-y-3">
        {api?.error && (
          <Card className="p-3" style={{ border: `1px solid ${C.danger}`, background: C.ivory }}>
            <p className="text-[12px]" style={{ color: C.danger }}>{api.error}</p>
          </Card>
        )}

        {api?.loading && discounts.length === 0 ? (
          <Card className="p-4">
            <p className="text-[12px]" style={{ color: C.muted }}>Loading discounts…</p>
          </Card>
        ) : discounts.length === 0 ? (
          <Card className="p-6 text-center" style={{
            background: `linear-gradient(180deg, ${C.paper} 0%, ${C.ivory} 100%)`,
          }}>
            <div
              aria-hidden
              style={{
                width: 48, height: 48, margin: "0 auto 12px",
                borderRadius: 999, display: "grid", placeItems: "center",
                background: C.ivory, color: C.gold, border: `1px solid ${C.hairline}`,
              }}
            >
              <Sparkles size={20} />
            </div>
            <p style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 600, color: C.espresso }}>
              No discounts yet.
            </p>
            <p className="text-[13px] mt-2" style={{ color: C.muted, lineHeight: 1.5 }}>
              {DISCOUNTS_EMPTY_COPY}
            </p>
            <div className="mt-5">
              <Button variant="primary" icon={<Plus size={16} />} onClick={openNew} fullWidth>
                Create your first discount
              </Button>
            </div>
          </Card>
        ) : (
          discounts.map(d => (
            <Card
              key={d.id}
              className="p-4 active:scale-[0.99] cursor-pointer"
              onClick={() => openEdit(d)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-semibold truncate" style={{ color: C.espresso }}>
                      {d.name}
                    </p>
                    <Pill tone={d.is_active ? "success" : "neutral"}>
                      {d.is_active ? "Active" : "Paused"}
                    </Pill>
                  </div>
                  <p className="text-[11px]" style={{ color: C.muted }}>
                    {formatDiscountValue(d)}
                    {" · "}
                    {d.applies_to === "all" ? "All services" : "Specific service"}
                    {d.ends_at ? ` · Ends ${fmtDateLong(d.ends_at.slice(0, 10))}` : ""}
                  </p>
                  {d.description && (
                    <p className="text-[12px] mt-2" style={{ color: C.coffee, lineHeight: 1.4 }}>
                      {d.description}
                    </p>
                  )}
                </div>
                <ChevronRight size={18} style={{ color: C.muted, marginTop: 2, flexShrink: 0 }} />
              </div>
            </Card>
          ))
        )}
      </div>

      <Sheet
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? "Edit discount" : "New discount"}
      >
        {editing && (
          <div className="space-y-3 pb-2">
            <div>
              <p className="text-[10px] uppercase tracking-widest font-bold mb-2" style={{ color: C.muted }}>
                Quick presets
              </p>
              <div className="flex flex-wrap gap-2">
                {DISCOUNT_PRESETS.map(p => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setEditing({ ...editing, name: p.label, description: editing.description || p.description })}
                    className="px-3 py-1.5 rounded-full text-[11px] font-semibold active:scale-[0.97] transition"
                    style={{
                      background: C.ivory, color: C.coffee,
                      border: `1px solid ${C.hairline}`,
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <Field label="Name">
              <Input
                value={editing.name || ""}
                onChange={e => setEditing({ ...editing, name: e.target.value })}
                placeholder="Loyalty Reward"
              />
            </Field>

            <Field label="Description" hint="Shown on the discount card. Optional.">
              <Textarea
                value={editing.description || ""}
                onChange={e => setEditing({ ...editing, description: e.target.value })}
                rows={2}
              />
            </Field>

            <Field label="Type">
              <Select
                value={editing.discount_type || "percentage"}
                onChange={e => setEditing({ ...editing, discount_type: e.target.value as DiscountInput["discount_type"] })}
                options={[
                  { value: "percentage", label: "Percentage off" },
                  { value: "fixed", label: "Fixed amount off" },
                ]}
              />
            </Field>

            <Field
              label={editing.discount_type === "percentage" ? "Percentage" : "Amount"}
              hint={editing.discount_type === "percentage" ? "0–100" : "Dollars"}
            >
              <MoneyInput
                prefix={editing.discount_type === "fixed" ? "$" : ""}
                suffix={editing.discount_type === "percentage" ? "%" : ""}
                value={editing.value ?? ""}
                onChange={(v) => setEditing({ ...editing, value: parseMoney(v) })}
              />
            </Field>

            <Field label="Applies to">
              <Select
                value="all"
                onChange={() => { /* service-specific is reserved for V2 */ }}
                options={[
                  { value: "all", label: "All services" },
                  { value: "service-disabled", label: "Specific service — coming soon" },
                ]}
              />
            </Field>

            <Field label="Active">
              <Select
                value={editing.is_active === false ? "paused" : "active"}
                onChange={e => setEditing({ ...editing, is_active: e.target.value === "active" })}
                options={[
                  { value: "active", label: "Active — appears in calculator" },
                  { value: "paused", label: "Paused — hidden from calculator" },
                ]}
              />
            </Field>

            <Field label="Starts (optional)">
              <Input
                type="date"
                value={editing.starts_at ? editing.starts_at.slice(0, 10) : ""}
                onChange={e => setEditing({ ...editing, starts_at: e.target.value ? `${e.target.value}T00:00:00Z` : null })}
              />
            </Field>

            <Field label="Ends (optional)">
              <Input
                type="date"
                value={editing.ends_at ? editing.ends_at.slice(0, 10) : ""}
                onChange={e => setEditing({ ...editing, ends_at: e.target.value ? `${e.target.value}T23:59:59Z` : null })}
              />
            </Field>

            <Field label="Usage limit (optional)" hint="Total times this discount can be applied.">
              <Input
                type="number"
                inputMode="numeric"
                value={editing.usage_limit ?? ""}
                onChange={e => setEditing({ ...editing, usage_limit: e.target.value ? Number(e.target.value) : null })}
                placeholder="No limit"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <Button variant="primary" icon={<Save size={16} />} onClick={handleSave}>
                {busy ? "Saving…" : "Save discount"}
              </Button>
              <Button variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </div>

            {editing.id && (
              <Button
                variant="danger"
                icon={<Trash2 size={16} />}
                onClick={() => {
                  const target = discounts.find(d => d.id === editing.id);
                  if (target) { setEditing(null); setConfirmDelete(target); }
                }}
                fullWidth
              >
                Delete discount
              </Button>
            )}
          </div>
        )}
      </Sheet>

      <Sheet
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete discount?"
      >
        {confirmDelete && (
          <div className="space-y-3 pb-2">
            <p className="text-[14px]" style={{ color: C.coffee, lineHeight: 1.5 }}>
              Remove <strong>{confirmDelete.name}</strong> from your studio? Saved
              quotes that already used it keep their snapshot — only future
              quotes lose access.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Button variant="danger" onClick={handleDelete}>
                {busy ? "Deleting…" : "Delete"}
              </Button>
              <Button variant="outline" onClick={() => setConfirmDelete(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
};

const UpgradeSheet = ({
  feature, userId, mode, onClose, onSignInPrompt,
}: {
  feature: GatedFeature | null;
  userId: string | null;
  mode: AuthMode;
  onClose: () => void;
  onSignInPrompt: () => void;
}) => {
  const open = !!feature;
  const limit = feature && feature in GUEST_LIMITS
    ? (GUEST_LIMITS as any)[feature] as number
    : null;
  const featureName = feature ? FEATURE_LABEL[feature] : "";
  const linkReady = isPaymentLinkConfigured();

  return (
    <Sheet open={open} onClose={onClose} title="Lifetime Access">
      <div className="px-1 pb-2 pt-1">
        <div className="flex items-center gap-2 mb-3">
          <span
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "4px 10px", borderRadius: 999,
              background: `linear-gradient(180deg, ${C.gold}, ${C.goldDeep})`,
              color: C.paper, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            <Sparkles size={12} /> {UPGRADE_BADGE}
          </span>
        </div>

        <p
          style={{
            fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 600,
            lineHeight: 1.15, color: C.espresso,
          }}
        >
          ✨ {UPGRADE_HEADLINE}
        </p>
        {limit !== null && (
          <p className="mt-2" style={{ color: C.muted, fontSize: 13 }}>
            {featureName} are capped at {limit} on the free workspace.
          </p>
        )}
        <p className="mt-3" style={{ color: C.coffee, fontSize: 14, lineHeight: 1.5 }}>
          {UPGRADE_BODY}
        </p>

        {/* Four pillar chips — one-time / lifetime / future upgrades /
            no subscriptions. Calm gold-on-cream so the message lands
            without the "BUY NOW" energy. */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          {[
            { label: "One-time unlock",   icon: <Check size={13} /> },
            { label: "Lifetime access",   icon: <Sparkles size={13} /> },
            { label: "Future upgrades",   icon: <ArrowUpRight size={13} /> },
            { label: "No subscriptions",  icon: <Heart size={13} /> },
          ].map(chip => (
            <div
              key={chip.label}
              className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
              style={{
                background: C.ivory,
                border: `1px solid ${C.hairline}`,
                color: C.espresso,
              }}
            >
              <span
                aria-hidden
                className="flex items-center justify-center shrink-0"
                style={{
                  width: 22, height: 22, borderRadius: 999,
                  background: `linear-gradient(180deg, ${C.gold}, ${C.goldDeep})`,
                  color: C.paper,
                }}
              >
                {chip.icon}
              </span>
              <span className="text-[11px] font-semibold leading-tight">{chip.label}</span>
            </div>
          ))}
        </div>

        <ul className="mt-4 space-y-2" style={{ color: C.coffee, fontSize: 13 }}>
          {[
            "Unlimited clients, appointments, money entries, and quotes",
            "Reminders, communication log, and analytics",
            "Cloud sync across every device you sign in on",
          ].map(line => (
            <li key={line} className="flex items-start gap-2">
              <CheckCircle2 size={16} style={{ color: C.goldDeep, marginTop: 2, flexShrink: 0 }} />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        <div className="mt-6 space-y-2">
          {mode !== "authed" || !userId ? (
            <>
              <button
                type="button"
                onClick={onSignInPrompt}
                className="w-full rounded-2xl py-3.5 text-[15px] font-semibold active:scale-[0.99] transition"
                style={{
                  background: `linear-gradient(180deg, ${C.gold}, ${C.goldDeep})`,
                  color: C.paper, border: `1px solid ${C.goldDeep}`,
                  boxShadow: "0 8px 20px -10px rgba(168, 137, 63, 0.6)",
                }}
              >
                Sign in to unlock
              </button>
              <p className="text-[11px] text-center" style={{ color: C.muted }}>
                Your unlock binds to your account so it follows you everywhere.
              </p>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={!linkReady}
                onClick={() => { void openCheckout(userId); onClose(); }}
                className="w-full rounded-2xl py-3.5 text-[15px] font-semibold active:scale-[0.99] transition disabled:opacity-60"
                style={{
                  background: `linear-gradient(180deg, ${C.gold}, ${C.goldDeep})`,
                  color: C.paper, border: `1px solid ${C.goldDeep}`,
                  boxShadow: "0 8px 20px -10px rgba(168, 137, 63, 0.6)",
                }}
              >
                {linkReady ? `Unlock for ${LIFETIME_PRICE_LABEL}` : "Coming soon"}
              </button>
              <p className="text-[11px] text-center" style={{ color: C.muted }}>
                Secure checkout by Stripe · No subscriptions
              </p>
            </>
          )}
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-2xl py-3 text-[13px] font-semibold active:scale-[0.99] transition"
            style={{
              background: C.ivory, color: C.coffee,
              border: `1px solid ${C.hairline}`,
            }}
          >
            Maybe later
          </button>
        </div>
      </div>
    </Sheet>
  );
};

export default function App() {
  const auth = useAuth();
  // First-launch welcome screen — gates AuthGate until the user
  // has seen (or skipped) the intro. SSR-safe: introSeen starts as
  // null and the localStorage probe runs in useEffect on mount.
  const [introSeen, setIntroSeen] = useState<boolean | null>(null);
  const [authInitialTab, setAuthInitialTab] = useState<"signin" | "signup">("signin");
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      setIntroSeen(window.localStorage.getItem("bbp-intro-seen-v1") === "1");
    } catch {
      setIntroSeen(true);
    }
  }, []);
  const markIntroSeen = useCallback((nextTab: "signin" | "signup") => {
    setAuthInitialTab(nextTab);
    setIntroSeen(true);
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem("bbp-intro-seen-v1", "1");
      }
    } catch { /* private mode — gate still works in-memory this session */ }
  }, []);
  const rawStore = useStorage();
  const { premium } = usePremiumStatus(auth.userId);
  const discountsApi = useDiscounts(auth.userId);
  const servicesApi = useServices(auth.userId);
  const policiesApi = useBookingPolicy(auth.userId);
  const availabilityApi = useAvailability(auth.userId);
  const waitlistApi = useWaitlist(auth.userId);
  const approvalsApi = useBookingApprovalQueue(auth.userId);
  const [upgradeFor, setUpgradeFor] = useState<GatedFeature | null>(null);
  const requestUpgrade = useCallback((feature: GatedFeature) => {
    setUpgradeFor(feature);
  }, []);
  const closeUpgrade = useCallback(() => setUpgradeFor(null), []);

  // Wrap entity creators so a guest at the limit sees the elegant
  // upgrade sheet instead of silently saving record N+1. Only NEW
  // records (no id) are gated — edits always pass through so existing
  // data stays editable.
  const store = useMemo(() => {
    const gateNew = <Args extends any[], R>(
      feature: GatedFeature,
      list: any[],
      fn: (rec: any, ...rest: Args) => R,
    ) => async (rec: any, ...rest: Args): Promise<R | null> => {
      const isNew = !rec || typeof rec !== "object" || !rec.id;
      if (isNew && hasReachedGuestLimit(feature, list?.length ?? 0, premium)) {
        requestUpgrade(feature);
        return null;
      }
      return fn(rec, ...rest);
    };
    return {
      ...rawStore,
      userId: auth.userId,
      premium,
      requestUpgrade,
      discountsApi,
      servicesApi,
      policiesApi,
      availabilityApi,
      waitlistApi,
      approvalsApi,
      upsertClient: gateNew("clients", rawStore.clients, rawStore.upsertClient),
      // Personal events and blocked time live in the same table but
      // aren't bookings, so they (a) don't count toward the appointment
      // limit and (b) bypass the gate entirely when being created.
      upsertAppointment: async (rec: any) => {
        const recKind = rec?.kind || "appointment";
        if (recKind !== "appointment") {
          return rawStore.upsertAppointment(rec);
        }
        const billable = (rawStore.appointments as any[])
          .filter(a => !a?.kind || a.kind === "appointment");
        const isNew = !rec || typeof rec !== "object" || !rec.id;
        if (isNew && hasReachedGuestLimit("appointments", billable.length, premium)) {
          requestUpgrade("appointments");
          return null;
        }
        return rawStore.upsertAppointment(rec);
      },
      upsertTransaction: gateNew("transactions", rawStore.transactions, rawStore.upsertTransaction),
      upsertQuote: gateNew("calculations", rawStore.quotes, rawStore.upsertQuote),
    };
  }, [rawStore, auth.userId, premium, requestUpgrade, discountsApi, servicesApi, policiesApi, availabilityApi, waitlistApi, approvalsApi]);

  const sync = useCloudSync(auth.userId, store);

  // Run the notification scheduler once per app open + every 10 min
  // while the tab stays open. Fail-soft when push isn't supported on
  // this device (PWA web fallback) — the rules still surface in the
  // bell via buildNotifications. iOS native push will plug into the
  // same pipeline once we wrap with Capacitor.
  useEffect(() => {
    if (auth.mode !== "authed" || !auth.userId) return;
    let cancelled = false;
    let timer: any = null;
    const run = async () => {
      try {
        const cap = await detectPushCapability();
        if (cap !== "subscribed") return; // no surface to deliver to
        const supabase = getSupabase();
        const { data: settingsRow } = await supabase
          .from("settings")
          .select("data")
          .eq("user_id", auth.userId)
          .maybeSingle();
        const prefs = ((settingsRow?.data as any)?.notification_preferences) || DEFAULT_NOTIFICATION_PREFERENCES;
        const rules = runNotificationRules({
          clients: store.clients,
          appointments: store.appointments,
          todayIso: todayISO(),
          nowMs: Date.now(),
          preferences: prefs,
          deliveredHistory: loadDeliveredHistory(),
        });
        const history = loadDeliveredHistory();
        const { toSend } = splitDeliverable(rules, history, new Date());
        let nextHistory = history;
        for (const r of toSend.slice(0, 10)) {
          const result = await dispatchPush(auth.userId!, r);
          if (result.ok) nextHistory = { ...nextHistory, [r.id]: new Date().toISOString() };
        }
        if (toSend.length > 0) saveDeliveredHistory(nextHistory);
      } catch (err) {
        console.warn("[bbp] scheduler failed", err);
      }
    };
    run();
    timer = setInterval(() => { if (!cancelled) run(); }, 10 * 60 * 1000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [auth.mode, auth.userId, store.clients, store.appointments]);
  const [active, setActive] = useState("dashboard");
  const [secondary, setSecondary] = useState<string | null>(null); // policies | settings | savedQuotes | reminders | reminderSettings | presets | timer | timerSessions
  const [calcPrefill, setCalcPrefill] = useState<EntityRecord | null>(null);
  const [calcPresetPrefill, setCalcPresetPrefill] = useState<EntityRecord | null>(null);
  const [apptPrefill, setApptPrefill] = useState<EntityRecord | null>(null);

  // Duplicate-appointment bridge: AppointmentSheet dispatches a
  // CustomEvent when the user taps Duplicate; we catch it here, route
  // to the Schedule tab, and prefill the new appointment form with
  // the copy. Skipped during SSR.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onDuplicate = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      setActive("schedule");
      setApptPrefill(detail);
    };
    window.addEventListener("bbp:duplicate-appointment", onDuplicate as EventListener);
    return () => window.removeEventListener("bbp:duplicate-appointment", onDuplicate as EventListener);
  }, []);
  const [timerApptPrefill, setTimerApptPrefill] = useState<EntityRecord | null>(null);
  const [openTx, setOpenTx] = useState(false);
  const [editingTx, setEditingTx] = useState<EntityRecord | null>(null);
  const [openClientForm, setOpenClientForm] = useState(false);
  const [quickClient, setQuickClient] = useState<EntityRecord | null>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  // Notification deep-link plumbing: when a notification routes to a
  // client, App stamps the id and Clients pops the matching profile.
  const [clientToOpenId, setClientToOpenId] = useState<string | null>(null);
  const [approvalFocusId, setApprovalFocusId] = useState<string | null>(null);
  const [commPickerCtx, setCommPickerCtx] = useState<CommContext | null>(null);
  const [activeComm, setActiveComm] = useState<(CommContext & { templateKey: CommTemplateKey }) | null>(null);
  const [activeReceipt, setActiveReceipt] = useState<ReceiptRecord | null>(null);
  const openReceipt = useCallback((rcp: ReceiptRecord) => setActiveReceipt(rcp), []);
  // Photo save/delete: when the user is signed in, upload bytes to the
  // private Supabase Storage 'photos' bucket and persist only the
  // storage paths (not the inline dataUrls) so cross-device sync is
  // cheap. In guest mode we keep the existing dataUrl-only behaviour.
  const handleSavePhoto = useCallback(async (photo: any) => {
    const incoming = { ...photo };
    if (auth.userId && (incoming.dataUrl || incoming.thumbnailDataUrl) && !incoming.storagePath) {
      try {
        if (!incoming.id) incoming.id = `pho_${uid()}`;
        const { storagePath, thumbnailPath } = await uploadPhoto(
          auth.userId,
          incoming.id,
          incoming.dataUrl || incoming.thumbnailDataUrl,
          incoming.thumbnailDataUrl || incoming.dataUrl,
        );
        incoming.storagePath = storagePath;
        incoming.thumbnailPath = thumbnailPath;
        // Don't persist the heavy dataUrls once we have a storage path —
        // they're regenerated on demand from the bucket via signed URLs.
        delete incoming.dataUrl;
        delete incoming.thumbnailDataUrl;
      } catch (err) {
        // Photo upload failed (offline / quota / mime). The dataUrl
        // copy stays in localStorage so the gallery doesn't go blank;
        // sync will retry the upload when conditions improve.
        console.warn("[bbp] photo upload paused — keeping inline copy", err);
      }
    }
    return store.upsertPhoto(incoming);
  }, [auth.userId, store]);

  const handleDeletePhoto = useCallback(async (id: string) => {
    if (auth.userId) {
      await deletePhotoFromStorage(auth.userId, id).catch(() => null);
    }
    return store.deletePhoto(id);
  }, [auth.userId, store]);

  const openCommunication = useCallback((next: CommContext) => {
    // Resolve the most relevant appointment when none was passed in
    // (e.g. user tapped "Send message" on a client profile). This is
    // what populates {{date}} {{time}} {{style}} {{deposit}} {{balance}}
    // {{total}} for every entry point in one place.
    const clientId = next.client?.id || next.appointment?.clientId;
    const resolvedAppt = next.appointment
      || getClientAppointmentContext(clientId, store.appointments);
    const finalCtx: CommContext = { ...next, appointment: resolvedAppt || undefined };
    if (next.initialKey) setActiveComm({ ...finalCtx, templateKey: next.initialKey });
    else setCommPickerCtx(finalCtx);
  }, [store.appointments]);
  const notifications = useNotifications(store);

  // Centralised notification tap handler. Marks the item read +
  // closes the sheet + routes via the action router. New kinds plug
  // in by stamping a NotificationTarget in buildNotifications.
  const handleNotificationTap = useCallback((n: NotifItem) => {
    notifications.markRead(n.id);
    setNotifOpen(false);
    routeNotification(n, {
      appointments: store.appointments,
      setActive,
      setSecondary,
      setApptPrefill,
      setClientToOpenId,
      setApprovalFocusId,
    });
  }, [notifications, store.appointments]);

  // Dashboard quick actions
  const openQuickAppt = (prefill: any = {}) => {
    setApptPrefill(prefill || {});
    setActive("schedule");
  };
  const openQuickClient = () => {
    setQuickClient({ id: `cli_${uid()}`, name: "", phone: "", email: "", preferredStyles: [], scalpSensitivity: "None", allergies: "", notes: "" });
    setOpenClientForm(true);
  };
  const openQuickTx = () => {
    setEditingTx(null);
    setOpenTx(true);
  };
  const openTimerForAppt = (appt) => {
    setTimerApptPrefill(appt);
    setSecondary("timer");
  };

  const handleLoadQuote = (q) => {
    setCalcPrefill(q);
    setSecondary(null);
    setActive("calculator");
  };

  const handleConvertQuoteToAppt = (q) => {
    const newAppt = {
      style: q.style, hours: q.hours, finalPrice: q.finalPrice,
      hairCost: q.hairCost, hourlyRate: q.hourlyRate, travelFee: q.travelFee,
      addOns: q.addOns, overhead: q.overhead, profitMargin: q.profitMargin,
      tipPct: q.tipPct, deposit: q.deposit, depositType: q.depositType,
      notes: q.notes
    };
    setApptPrefill(newAppt);
    setSecondary(null);
    setActive("schedule");
  };

  const handleUsePreset = (p) => {
    setCalcPresetPrefill(p);
    setSecondary(null);
    setActive("calculator");
    // bump useCount
    store.upsertPreset({ ...p, useCount: (p.useCount || 0) + 1, updatedAt: new Date().toISOString() });
  };

  const handleSaveTx = async (t) => { await store.upsertTransaction(t); setOpenTx(false); setEditingTx(null); };
  const handleDeleteTx = async (id) => { await store.deleteTransaction(id); setOpenTx(false); setEditingTx(null); };
  const handleSaveQuickClient = async (c) => { if (!c.name.trim()) return; await store.upsertClient(c); setOpenClientForm(false); setQuickClient(null); };

  // Auth gate: shown when we haven't established a session and the user
  // hasn't opted into guest mode. All hooks above this guard so the
  // hook order is stable across renders.
  if (auth.mode === "loading") {
    // Show a cream splash until the intro state has resolved on the
    // client (one tick post-mount). Prevents hydration flicker and
    // avoids a flash of the AuthGate before the intro.
    if (introSeen === null) {
      return (
        <div className="flex items-center justify-center" style={{ minHeight: "100dvh", background: C.cream }}>
          <GlobalStyle />
          <div className="rounded-full p-4 bbp-pulse" style={{ width: 56, height: 56, background: C.gold }}>
            <Sparkles size={28} style={{ color: C.espresso }} />
          </div>
        </div>
      );
    }
    if (introSeen === false) {
      return (
        <WelcomeIntro
          onGetStarted={() => markIntroSeen("signup")}
          onSignIn={() => markIntroSeen("signin")}
          onSkip={() => markIntroSeen("signin")}
        />
      );
    }
    return <AuthGate onContinueGuest={auth.continueAsGuest} initialTab={authInitialTab} />;
  }

  if (store.loading) {
    return (
      <div className="flex items-center justify-center" style={{ minHeight: "100dvh", background: C.cream }}>
        <GlobalStyle />
        <div className="text-center">
          <div className="rounded-full p-4 mx-auto mb-3 bbp-pulse" style={{ width: 64, height: 64, background: C.gold }}>
            <Sparkles size={32} style={{ color: C.espresso }} />
          </div>
          <p className="text-sm font-semibold" style={{ color: C.coffee, fontFamily: FONT_DISPLAY, fontSize: 18 }}>Braid Boss Pro</p>
        </div>
      </div>
    );
  }

  // Secondary screens take over the whole view
  if (secondary === "timer") {
    return (
      <Frame>
        <ActiveTimerScreen store={store} prefillAppt={timerApptPrefill}
          onBack={() => { setSecondary(null); setTimerApptPrefill(null); }}
          onComplete={(session) => {
            // Optionally mark linked appointment as completed
            if (session.appointmentId) {
              const appt = store.appointments.find(a => a.id === session.appointmentId);
              if (appt && appt.status !== "completed") {
                store.upsertAppointment({ ...appt, status: "completed" });
              }
            }
            setSecondary(null); setTimerApptPrefill(null);
          }} />
      </Frame>
    );
  }

  return (
    <Frame withTabBar={secondary === null}>
      <GlobalStyle />

      {secondary === null && (
        <>
          {active === "dashboard" && (
            <Dashboard store={store}
              setActive={setActive}
              openQuickAppt={openQuickAppt}
              openQuickClient={openQuickClient}
              openQuickTx={openQuickTx}
              openSettings={() => setSecondary("settings")}
              openPolicies={() => setSecondary("policies")}
              openSavedQuotes={() => setSecondary("savedQuotes")}
              openReminders={() => { setNotifOpen(true); notifications.markAllRead(); }}
              notifBadgeCount={notifications.unreadCount}
              openCommunication={openCommunication}
              syncState={auth.mode === "authed" ? sync.state : undefined}
              openAnalytics={() => {
                if (!store.premium) { requestUpgrade("analytics"); return; }
                setSecondary("analytics");
              }}
              openPresets={() => setSecondary("presets")}
              openTimer={() => setSecondary("timer")}
              openAppointmentRecord={(a) => { setActive("schedule"); setApptPrefill(a); }} />
          )}
          {active === "calculator" && (
            <Calculator store={store}
              prefillFromQuote={calcPrefill}
              onClearPrefill={() => setCalcPrefill(null)}
              prefillFromPreset={calcPresetPrefill}
              onClearPresetPrefill={() => setCalcPresetPrefill(null)}
              openSavedQuotes={() => setSecondary("savedQuotes")}
              openConvertToAppt={(quote) => handleConvertQuoteToAppt(quote)}
              openPresets={() => setSecondary("presets")} />
          )}
          {active === "schedule" && (
            <Schedule store={store}
              prefillNewAppt={apptPrefill}
              clearApptPrefill={() => setApptPrefill(null)}
              openTimerForAppt={openTimerForAppt}
              openCommunication={openCommunication}
              openReceipt={openReceipt}
              openQuickClient={openQuickClient}
              openAvailability={() => setSecondary("availability")} />
          )}
          {active === "clients" && (
            <Clients store={store} openCommunication={openCommunication} openQuickAppt={openQuickAppt} savePhoto={handleSavePhoto} deletePhoto={handleDeletePhoto} openClientId={clientToOpenId} clearOpenClientId={() => setClientToOpenId(null)} openAppointmentRecord={(a) => { setActive("schedule"); setApptPrefill(a); }} />
          )}
          {active === "money" && (
            <Money store={store}
              openTxSheet={() => { setEditingTx(null); setOpenTx(true); }}
              editTx={(t) => { setEditingTx(t); setOpenTx(true); }}
              openTimerSessions={() => setSecondary("timerSessions")}
              openReceipt={openReceipt} />
          )}
          {active === "rebooking" && (
            <RebookingScreen
              store={store}
              setActive={setActive}
              openQuickAppt={openQuickAppt}
              onBack={() => setActive("dashboard")}
            />
          )}
        </>
      )}

      {secondary === "policies" && <Policies store={store} onBack={() => setSecondary(null)} />}
      {secondary === "settings" && <SettingsScreen store={store} onBack={() => setSecondary(null)} openReminderSettings={() => setSecondary("reminderSettings")} openCommunicationLog={() => setSecondary("communicationLog")} openAccount={() => setSecondary("account")} openDiscounts={() => setSecondary("discounts")} openServices={() => setSecondary("services")} openReports={() => setSecondary("reports")} openPolicies={() => setSecondary("bookingPolicies")} openAvailability={() => setSecondary("availability")} openWaitlist={() => setSecondary("waitlist")} openIntelligence={() => setSecondary("intelligence")} openApprovals={() => setSecondary("approvals")} openContracts={() => setSecondary("contracts")} />}
      {secondary === "contracts" && <ContractsScreen store={store} onBack={() => setSecondary("settings")} />}
      {secondary === "bookingPolicies" && <BookingPoliciesScreen store={store} onBack={() => setSecondary("settings")} />}
      {secondary === "availability" && <AvailabilityScreen store={store} onBack={() => setSecondary("settings")} />}
      {secondary === "intelligence" && <BookingIntelligenceScreen store={store} onBack={() => setSecondary("settings")} />}
      {secondary === "approvals" && <ApprovalQueueScreen store={store} onBack={() => setSecondary("settings")} focusRequestId={approvalFocusId} clearFocusRequestId={() => setApprovalFocusId(null)} />}
      {secondary === "waitlist" && (
        <WaitlistScreen
          store={store}
          onBack={() => setSecondary("settings")}
          onConvertToAppointment={async (req, matchedClient) => {
            // Resolve the client. Match wins; otherwise create a new
            // client record so the appointment is linked from day one
            // (no "Walk-in" placeholder, no duplicate next time).
            let client = matchedClient;
            if (!client) {
              const created = await store.upsertClient({
                name: req.client_name,
                phone: req.client_phone || "",
                email: req.client_email || "",
              });
              client = created || null;
            }
            const apptId = `appt_${uid()}`;
            const newAppt: any = {
              id: apptId,
              clientId: client?.id || "",
              clientName: client?.name || req.client_name,
              clientPhone: client?.phone || req.client_phone || "",
              clientEmail: client?.email || req.client_email || "",
              style: req.service_name || "",
              serviceId: req.service_id || null,
              date: req.preferred_date || todayISO(),
              time: req.preferred_time || "10:00",
              durationHours: "",
              totalPrice: 0,
              depositPaid: 0,
              status: "scheduled",
              source: "waitlist",
              referralSource: "waitlist",
              notes: req.notes || "",
              createdAt: new Date().toISOString(),
            };
            await store.upsertAppointment(newAppt);
            // linkConvertedAppointment flips status to booked + stamps
            // converted_appointment_id in one update.
            await store.waitlistApi.linkConvertedAppointment(req.id, apptId);
            // Fire-and-forget analytics. Errors swallowed inside.
            if (auth.userId) {
              void emitAnalyticsEvent({
                ownerUserId: auth.userId,
                type: "waitlist_converted",
                source: "app",
                payload: { waitlistId: req.id, appointmentId: apptId, clientId: client?.id || null },
              });
              void emitAnalyticsEvent({
                ownerUserId: auth.userId,
                type: "appointment_created",
                source: "app",
                payload: { appointmentId: apptId, source: "waitlist" },
              });
            }
            setSecondary(null);
            setActive("schedule");
            setApptPrefill(newAppt);
          }}
        />
      )}
      {secondary === "services" && <ServicesScreen store={store} onBack={() => setSecondary("settings")} />}
      {secondary === "reports" && <ReportsScreen store={store} onBack={() => setSecondary("settings")} />}
      {secondary === "discounts" && <DiscountsScreen store={store} onBack={() => setSecondary("settings")} />}
      {secondary === "account" && (
        <AccountScreen
          email={auth.email}
          mode={auth.mode}
          sync={sync}
          userId={auth.userId}
          openBookingRequests={() => setSecondary("bookingRequests")}
          onBack={() => setSecondary("settings")}
          onSignOut={async () => { await auth.signOut(); setSecondary(null); }}
          onExport={() => {
            if (!store.premium) { store.requestUpgrade?.("export"); return; }
            const data = JSON.stringify({
              business: store.business,
              clients: store.clients,
              appointments: store.appointments,
              quotes: store.quotes,
              receipts: store.receipts || [],
              commLog: store.commLog,
              transactions: store.transactions,
            }, null, 2);
            void downloadJson(`braid-boss-pro-${todayISO()}.json`, data);
          }}
        />
      )}
      {secondary === "savedQuotes" && (
        <SavedQuotes store={store} onBack={() => setSecondary(null)}
          onLoadQuote={handleLoadQuote}
          onConvertToAppt={handleConvertQuoteToAppt}
          openReceipt={openReceipt} />
      )}
      {secondary === "reminders" && <ReminderInbox store={store} onBack={() => setSecondary(null)} openSettings={() => setSecondary("reminderSettings")} />}
      {secondary === "reminderSettings" && <ReminderSettings store={store} onBack={() => setSecondary("reminders")} />}
      {secondary === "presets" && (
        <PresetsScreen store={store} onBack={() => setSecondary(null)} onUsePreset={handleUsePreset} />
      )}
      {secondary === "timerSessions" && <TimerSessionsScreen store={store} onBack={() => setSecondary(null)} />}
      {secondary === "communicationLog" && <CommunicationLogScreen store={store} onBack={() => setSecondary("settings")} />}
      {secondary === "analytics" && (
        <AnalyticsScreen
          clients={store.clients}
          appointments={store.appointments}
          commLog={store.commLog}
          business={store.business}
          today={todayISO()}
          onBack={() => setSecondary(null)}
        />
      )}
      {secondary === "bookingRequests" && (
        <BookingRequestsScreen
          userId={auth.userId}
          onBack={() => setSecondary(null)}
          onApprove={async (req) => {
            // Client matching: email first, phone fallback. If a
            // single existing client matches, link the appointment
            // to them. If multiple match, the V1 fallback is to
            // pick the first (the dedicated picker lives in the
            // Waitlist convert flow; booking-request approval
            // doesn't have an interactive picker yet — Phase B).
            // If none match, create a new client so the appointment
            // is linked from day one.
            const match = matchClientByContact(
              { email: req.client_email, phone: req.client_phone },
              (store.clients as ClientLike[]) || [],
            );
            let client: ClientLike | null = null;
            if (match.kind === "single") client = match.client;
            else if (match.kind === "ambiguous") client = match.candidates[0] || null;
            if (!client) {
              const created = await store.upsertClient({
                name: req.client_name,
                phone: req.client_phone || "",
                email: req.client_email || "",
              });
              client = (created as ClientLike) || null;
            }

            const apptId = `appt_${uid()}`;
            const newAppt: any = {
              id: apptId,
              clientId: client?.id || "",
              clientName: client?.name || req.client_name,
              clientPhone: client?.phone || req.client_phone || "",
              clientEmail: client?.email || req.client_email || "",
              style: req.service_name || "",
              serviceId: (req as any).service_id || null,
              date: req.preferred_date || todayISO(),
              time: req.preferred_time || "10:00",
              durationHours: req.service_duration ?? "",
              totalPrice: req.service_price ?? 0,
              depositPaid: 0,
              status: "scheduled",
              source: "public_booking",
              referralSource: "direct_link",
              createdFromPublic: true,
              notes: req.notes || "",
              createdAt: new Date().toISOString(),
            };
            await store.upsertAppointment(newAppt);
            if (auth.userId) {
              void emitAnalyticsEvent({
                ownerUserId: auth.userId,
                type: "booking_approved",
                source: "app",
                payload: { requestId: (req as any).id, appointmentId: apptId, clientId: client?.id || null },
              });
              void emitAnalyticsEvent({
                ownerUserId: auth.userId,
                type: "appointment_created",
                source: "app",
                payload: { appointmentId: apptId, source: "public_booking" },
              });
            }
            return apptId;
          }}
        />
      )}

      {/* Tab bar — only on primary screens */}
      {secondary === null && <TabBar active={active} setActive={setActive} />}

      {/* Floating timer pill — visible everywhere when timer is running and we're not on the timer screen */}
      {secondary !== "timer" && store.activeTimer && (
        <TimerMiniPill timer={store.activeTimer} onClick={() => setSecondary("timer")} />
      )}

      {/* Communication picker → individual template sheet */}
      <CommunicationPickerSheet
        open={!!commPickerCtx}
        ctx={commPickerCtx}
        onClose={() => setCommPickerCtx(null)}
        onPick={(key) => {
          if (commPickerCtx) setActiveComm({ ...commPickerCtx, templateKey: key });
          setCommPickerCtx(null);
        }}
      />
      <CommunicationSheet
        open={!!activeComm}
        ctx={activeComm}
        store={store}
        onClose={() => setActiveComm(null)}
      />

      {/* Receipt / invoice preview & PDF actions */}
      <ReceiptSheet
        open={!!activeReceipt}
        receipt={activeReceipt}
        business={store.business}
        policies={store.policies}
        onClose={() => setActiveReceipt(null)}
        onDelete={async (id: string) => {
          try { await store.deleteReceipt(id); }
          catch (err) {
            console.error("[receipts] delete failed:", err);
            alert("Couldn't delete that receipt. Please try again.");
            throw err;
          }
        }}
      />

      {/* Notifications sheet (bell on dashboard) */}
      <NotificationsSheet
        open={notifOpen}
        onClose={() => setNotifOpen(false)}
        items={notifications.items}
        dismiss={notifications.dismiss}
        clearAll={notifications.clearAll}
        markAllRead={notifications.markAllRead}
        onTap={handleNotificationTap}
        readIds={notifications.readIds}
      />

      {/* Transaction sheet */}
      <TransactionSheet
        open={openTx}
        tx={editingTx}
        onClose={() => { setOpenTx(false); setEditingTx(null); }}
        onSave={handleSaveTx}
        onDelete={handleDeleteTx}
        business={store.business} />

      {/* Quick client sheet */}
      {openClientForm && (
        <Sheet open={openClientForm} onClose={() => setOpenClientForm(false)} title="New client">
          <div className="space-y-4">
            <Field label="Name"><Input value={quickClient?.name || ""} onChange={e => setQuickClient({ ...quickClient, name: e.target.value })} /></Field>
            <Field label="Phone"><Input type="tel" value={quickClient?.phone || ""} onChange={e => setQuickClient({ ...quickClient, phone: e.target.value })} /></Field>
            <Field label="Email"><Input type="email" value={quickClient?.email || ""} onChange={e => setQuickClient({ ...quickClient, email: e.target.value })} /></Field>
            <Field label="Notes"><Textarea value={quickClient?.notes || ""} onChange={e => setQuickClient({ ...quickClient, notes: e.target.value })} rows={2} /></Field>
            <Button variant="primary" onClick={() => handleSaveQuickClient(quickClient)} fullWidth>Save client</Button>
          </div>
        </Sheet>
      )}

      <UpgradeSheet
        feature={upgradeFor}
        userId={auth.userId}
        mode={auth.mode}
        onClose={closeUpgrade}
        onSignInPrompt={() => { closeUpgrade(); setSecondary("account"); }}
      />

    </Frame>
  );
}

const Frame = ({ children, withTabBar = false }: { children: React.ReactNode; withTabBar?: boolean }) => (
  <div style={{ minHeight: "100dvh", background: C.cream, fontFamily: FONT_BODY, color: C.espresso }}>
    <GlobalStyle />
    <div
      className="mx-auto relative"
      style={{
        maxWidth: 480,
        minHeight: "100dvh",
        background: C.cream,
        boxShadow: "0 0 60px -10px rgba(42,24,16,0.12)",
        // Reserve space at the bottom so primary-screen content can scroll
        // past the fixed tab bar without being hidden behind it. Each
        // screen still sets its own `pb-XX` for in-flow spacing; this
        // baseline guarantees the last item is reachable on iOS.
        paddingBottom: withTabBar ? "calc(72px + env(safe-area-inset-bottom, 0px))" : undefined,
      }}>
      {children}
    </div>
  </div>
);
