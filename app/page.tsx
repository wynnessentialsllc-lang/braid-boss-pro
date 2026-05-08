"use client";
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Home, Calculator as CalcIcon, Calendar, Users, TrendingUp, Settings as SettingsIcon,
  Plus, X, ChevronRight, ChevronLeft, Search, Copy, Check, Trash2, Edit3,
  FileText, DollarSign, Clock, Phone, Mail, AlertCircle, Sparkles,
  ArrowUpRight, ArrowDownRight, Save, RefreshCw, Download, Bell, BellOff,
  CalendarPlus, UserPlus, Receipt, ScrollText, Image as ImageIcon, Camera,
  Star, Heart, Repeat, Play, Pause, Square, Timer as TimerIcon, Zap, Award,
  BarChart3, Layers, MessageSquare, Send, AlertTriangle, CheckCircle2,
  XCircle, Filter
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
const todayISO = (): string => new Date().toISOString().slice(0, 10);
const initials = (name: string): string => (name || "?").trim().split(/\s+/).slice(0, 2).map(s => s[0]?.toUpperCase() || "").join("");
const addDaysISO = (iso: string, days: number): string => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
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
const computePricing = (inputs: any): any => {
  const hairCost = Number(inputs.hairCost) || 0;
  const hourlyRate = Number(inputs.hourlyRate) || 0;
  const hours = Number(inputs.hours) || 0;
  const travelFee = Number(inputs.travelFee) || 0;
  const overhead = Number(inputs.overhead) || 0;
  const profitMargin = Number(inputs.profitMargin) || 0;
  const tipPct = Number(inputs.tipPct) || 0;
  const addOnsTotal = (inputs.addOns || []).reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const labor = hourlyRate * hours;
  const subtotal = hairCost + labor + travelFee + addOnsTotal + overhead + profitMargin;
  const tipAmount = subtotal * (tipPct / 100);
  const finalPrice = subtotal + tipAmount;
  return {
    hairCost, labor, hourlyRate, hours, travelFee, addOnsTotal, overhead, profitMargin, tipPct,
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

  // helpers/aliases
  const clientById = useCallback((id) => clients.find(c => c.id === id), [clients]);

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
  };
};

// ============================================================
//  PRIMITIVES
// ============================================================
const Card = ({ children, className = "", style, onClick }: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
}) => (
  <div onClick={onClick} className={`rounded-2xl ${className}`}
    style={{
      background: `linear-gradient(180deg, ${C.paper} 0%, ${C.ivory} 100%)`,
      border: `1px solid ${C.hairline}`,
      boxShadow: "0 1px 2px rgba(42, 24, 16, 0.04), 0 8px 24px -12px rgba(42, 24, 16, 0.12)",
      ...style
    }}>{children}</div>
);

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
  <button onClick={() => onChange(!checked)}
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
    <div className="mb-4 rounded-full p-4" style={{ background: C.ivory, border: `1px solid ${C.hairline}` }}>{icon}</div>
    <p className="italic mb-1.5" style={{ fontFamily: FONT_DISPLAY, color: C.gold, fontSize: 18 }}>a fresh page awaits</p>
    <h4 style={{ fontFamily: FONT_DISPLAY, color: C.espresso, fontSize: 24, fontWeight: 600, lineHeight: 1.2 }}>{title}</h4>
    <p className="mt-2 text-sm max-w-xs" style={{ color: C.muted, lineHeight: 1.5 }}>{body}</p>
    {cta && <div className="mt-5">{cta}</div>}
  </div>
);

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
  // The visualViewport API is the only source of truth for the area
  // the user can actually see, so size the overlay against it directly.
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
  const sheetMaxHeight = maxHeight || (overlayHeight ? `${overlayHeight - 24}px` : "calc(100dvh - 24px)");
  return (
    <div className="fixed left-0 right-0 z-50 flex items-end justify-center"
      style={{
        background: "rgba(26, 15, 8, 0.45)",
        top: overlayTop,
        height: overlayHeight ? `${overlayHeight}px` : "100dvh",
      }}
      onClick={onClose}>
      <div className="bbp-sheet w-full max-w-[480px] rounded-t-3xl flex flex-col"
        style={{ background: C.cream, maxHeight: sheetMaxHeight, boxShadow: "0 -20px 60px -20px rgba(0,0,0,0.3)" }}
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
            <button onClick={onClose} className="p-2 -mr-2 rounded-full" style={{ color: C.coffee }}><X size={22} /></button>
          </div>
        </div>
        <div className="flex-1 bbp-scroll px-5 pt-4"
          style={{
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
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
  <button onClick={onClick} className="fixed z-40 active:scale-95 transition"
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
        <button onClick={action.onClick} className="p-2 rounded-full transition active:scale-[0.95]" style={{ color: C.coffee }}>
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
        background: C.paper,
        borderTop: `1px solid ${C.hairline}`,
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}>
      <div className="flex items-center justify-around px-2 py-2">
        {tabs.map(t => {
          const Icon = t.icon;
          const isActive = active === t.id;
          return (
            <button key={t.id} onClick={() => setActive(t.id)}
              className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition"
              style={{ color: isActive ? C.espresso : C.mutedSoft }}>
              <div className="relative">
                <Icon size={22} strokeWidth={isActive ? 2.4 : 1.8} />
                {isActive && <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full" style={{ background: C.gold }} />}
              </div>
              <span className="text-[10px] font-semibold tracking-wide" style={{ letterSpacing: "0.06em" }}>{t.label}</span>
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
    <button onClick={onClick}
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
const Dashboard = ({ store, setActive, openQuickAppt, openQuickClient, openQuickTx, openSettings, openPolicies, openSavedQuotes, openReminders, openPresets, openTimer, openCommunication, notifBadgeCount = 0 }: { store: any; setActive: any; openQuickAppt: any; openQuickClient: any; openQuickTx: any; openSettings: any; openPolicies: any; openSavedQuotes: any; openReminders: any; openPresets: any; openTimer: any; openCommunication?: (ctx: CommContext) => void; notifBadgeCount?: number }) => {
  const { business, appointments, transactions, photos, recurringSeries } = store;
  const today = todayISO();

  const todayAppts = useMemo(() =>
    appointments.filter(a => a.date === today && a.status !== "cancelled")
      .sort((a, b) => (a.time || "").localeCompare(b.time || ""))
  , [appointments, today]);

  const upcomingAppts = useMemo(() =>
    appointments.filter(a => a.date >= today && a.status !== "cancelled" && a.status !== "completed")
      .sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")))
      .slice(0, 3)
  , [appointments, today]);

  // Suggested rebooks: clients whose last completed appointment was longer ago than typical cadence (4 weeks)
  const suggestedRebooks = useMemo(() => {
    const byClient: Record<string, EntityRecord> = {};
    appointments.filter((a: EntityRecord) => a.status === "completed").forEach((a: EntityRecord) => {
      if (!a.clientId) return;
      if (!byClient[a.clientId] || a.date > byClient[a.clientId].date) byClient[a.clientId] = a;
    });
    const cutoff = addDaysISO(today, -28);
    const out = Object.values(byClient).filter((a) => a.date < cutoff && a.date >= addDaysISO(today, -90));
    return out.sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 3);
  }, [appointments, today]);

  const stats = useMemo(() => {
    const now = new Date();
    const wk = new Date(now); wk.setDate(now.getDate() - 7);
    const ms = new Date(now.getFullYear(), now.getMonth(), 1);
    const wkISO = wk.toISOString().slice(0, 10);
    const msISO = ms.toISOString().slice(0, 10);
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
  const pendingBalanceAppts = useMemo(() =>
    appointments
      .filter(a => a && a.status !== "cancelled")
      .map(a => ({ a, ps: paymentStatusOf(a, today) }))
      .filter(({ ps, a }) => ps !== "paid" && parseMoney(a.balanceDue) > 0)
      .sort((x, y) => (x.a.date || "").localeCompare(y.a.date || ""))
  , [appointments, today]);

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
        subtitle={fmtDateLong(today)}
        leftAction={
          <button onClick={openReminders} className="p-2 rounded-full relative" style={{ color: C.coffee }} aria-label="Notifications">
            <Bell size={20} />
            {notifBadgeCount > 0 && (
              <span className="absolute top-0 right-0 rounded-full text-[10px] font-bold flex items-center justify-center"
                style={{ width: 16, height: 16, background: C.gold, color: C.espresso, border: `1.5px solid ${C.cream}` }}>
                {notifBadgeCount > 9 ? "9+" : notifBadgeCount}
              </span>
            )}
          </button>
        }
        rightAction={<button onClick={openSettings} className="p-2 rounded-full" style={{ color: C.coffee }}><SettingsIcon size={20} /></button>}
      />

      <div className="px-5 pt-4 pb-28 space-y-5">
        {business.ownerName && (
          <p style={{ fontFamily: FONT_DISPLAY, fontSize: 28, color: C.espresso, fontWeight: 500, lineHeight: 1.15 }}>
            Welcome back, <em style={{ color: C.gold }}>{business.ownerName.split(" ")[0]}</em>.
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <KpiCard label="Week revenue" value={fmtMoney(stats.weekRevenue, business.currency)} icon={<ArrowUpRight size={16} />} tone="gold" onClick={() => setActive("money")} />
          <KpiCard label="Week clients" value={stats.weekAppts} icon={<Users size={16} />} onClick={() => setActive("schedule")} />
          <KpiCard label="Pending balance" value={fmtMoney(stats.pendingBalance, business.currency)} icon={<Clock size={16} />} tone={stats.pendingBalance > 0 ? "warning" : "neutral"} onClick={() => setActive("schedule")} />
          <KpiCard label="Month profit" value={fmtMoney(stats.monthProfit, business.currency)} icon={<TrendingUp size={16} />} tone={stats.monthProfit >= 0 ? "success" : "danger"} onClick={() => setActive("money")} />
        </div>

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
              {pendingBalanceAppts.slice(0, 4).map(({ a, ps }) => (
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
                        <button onClick={(e) => {
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
                      <button onClick={(e) => { e.stopPropagation(); markApptPaid(a); }}
                        className="px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider active:scale-[0.97] transition"
                        style={{ background: C.gold, color: C.espresso, border: `1px solid ${C.goldDeep}`, letterSpacing: "0.08em" }}>
                        Mark paid
                      </button>
                    </div>
                  </div>
                </Card>
              ))}
              {pendingBalanceAppts.length > 4 && (
                <button onClick={() => setActive("schedule")}
                  className="w-full text-center text-xs font-semibold py-2"
                  style={{ color: C.goldDeep }}>
                  View all {pendingBalanceAppts.length} pending →
                </button>
              )}
            </div>
          )}
        </div>

        {suggestedRebooks.length > 0 && (
          <div>
            <SectionTitle>Suggested rebooks</SectionTitle>
            <div className="space-y-2">
              {suggestedRebooks.map(a => (
                <Card key={a.id} className="p-3.5 flex items-center gap-3">
                  <div className="rounded-full flex items-center justify-center shrink-0"
                    style={{ width: 36, height: 36, background: `linear-gradient(135deg, ${C.caramel}, ${C.coffee})`, color: C.cream, fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 600 }}>
                    {initials(a.clientName)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate" style={{ color: C.espresso }}>{a.clientName}</p>
                    <p className="text-xs truncate" style={{ color: C.muted }}>Last seen {fmtDate(a.date)} · {a.style}</p>
                  </div>
                  <button onClick={() => openQuickAppt({ clientId: a.clientId, clientName: a.clientName, style: a.style, totalPrice: a.totalPrice })}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold shrink-0"
                    style={{ background: C.gold, color: C.espresso, border: `1px solid ${C.goldDeep}` }}>
                    Rebook
                  </button>
                </Card>
              ))}
            </div>
          </div>
        )}

        <div>
          <SectionTitle action={
            <button onClick={() => setActive("schedule")} className="text-xs font-semibold flex items-center gap-1" style={{ color: C.goldDeep }}>
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
                  <img src={p.thumbnailDataUrl || p.dataUrl} alt={p.caption || ""} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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

const QuickTile = ({ icon, label, onClick }) => (
  <button onClick={onClick} className="rounded-2xl p-4 text-left active:scale-[0.97] transition flex flex-col items-start gap-2"
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

  const inputs = { hairCost, hourlyRate, hours, travelFee, overhead, profitMargin, tipPct, addOns };
  const result = useMemo(() => computePricing(inputs), [hairCost, hourlyRate, hours, travelFee, overhead, profitMargin, tipPct, addOns]);

  const reset = () => {
    setStyleName(""); setHairCost(""); setHourlyRate(business.hourlyRate);
    setHours(""); setTravelFee(business.defaultTravelFee || 0);
    setOverhead(""); setProfitMargin(business.profitMargin || 0);
    setTipPct(0); setAddOns([]); setLabelInput("");
  };

  const addAddOn = () => setAddOns([...addOns, { id: uid(), name: "", amount: "" }]);
  const updateAddOn = (id, field, val) => setAddOns(addOns.map(a => a.id === id ? { ...a, [field]: val } : a));
  const removeAddOn = (id) => setAddOns(addOns.filter(a => a.id !== id));

  const handleSave = async () => {
    if (!styleName && !labelInput) { setShowSaveSheet(true); return; }
    await actuallySave(labelInput || styleName);
  };
  const actuallySave = async (label) => {
    const quote = {
      label: label || styleName || "Untitled quote",
      style: styleName,
      inputs: { hairCost, hourlyRate, hours, travelFee, overhead, profitMargin, tipPct, addOns },
      breakdown: result,
    };
    await upsertQuote(quote);
    setShowSaveSheet(false);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
  };

  const handleConvertToAppointment = () => {
    openConvertToAppt({ style: styleName, totalPrice: result.finalPrice });
  };

  return (
    <div className="bbp-fade">
      <Header
        title="Pricing Calculator"
        leftAction={<button onClick={openPresets} className="p-2 rounded-full" style={{ color: C.coffee }}><Layers size={20} /></button>}
        rightAction={<button onClick={openSavedQuotes} className="p-2 rounded-full" style={{ color: C.coffee }}><FileText size={20} /></button>}
      />

      <div className="px-5 pt-4 pb-32 space-y-4">
        <button onClick={openPresets}
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
          <Field label="Hours"><MoneyInput prefix={undefined} suffix="hrs" value={hours} onChange={setHours} /></Field>
          <Field label="Overhead" hint="supplies, utils"><MoneyInput value={overhead} onChange={setOverhead} /></Field>
          <Field label="Profit margin" hint="flat $"><MoneyInput value={profitMargin} onChange={setProfitMargin} /></Field>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[13px] font-semibold tracking-wide uppercase" style={{ color: C.coffee, letterSpacing: "0.06em" }}>Add-ons</span>
            <button onClick={addAddOn} className="flex items-center gap-1 text-xs font-semibold" style={{ color: C.goldDeep }}>
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
                  <button onClick={() => removeAddOn(a.id)} className="p-2 rounded-lg" style={{ color: C.danger }}><Trash2 size={18} /></button>
                </div>
              ))}
            </div>
          )}
        </div>

        <Field label="Tip %" hint="of subtotal">
          <MoneyInput prefix={undefined} suffix="%" value={tipPct} onChange={setTipPct} />
        </Field>

        <Card className="p-5 mt-4" style={{ background: `linear-gradient(180deg, ${C.espresso} 0%, ${C.coffee} 100%)`, border: `1px solid ${C.goldDeep}` }}>
          <p className="text-[10px] font-bold tracking-widest uppercase mb-3" style={{ color: C.gold, letterSpacing: "0.18em" }}>The breakdown</p>
          <BreakRow label="Hair / product" value={fmtMoney(result.hairCost, business.currency)} />
          <BreakRow label={`Labor (${result.hours || 0}h × ${fmtMoney(result.hourlyRate, business.currency)})`} value={fmtMoney(result.labor, business.currency)} />
          {result.travelFee > 0 && <BreakRow label="Travel" value={fmtMoney(result.travelFee, business.currency)} />}
          {result.addOnsTotal > 0 && <BreakRow label="Add-ons" value={fmtMoney(result.addOnsTotal, business.currency)} />}
          {result.overhead > 0 && <BreakRow label="Overhead" value={fmtMoney(result.overhead, business.currency)} />}
          {result.profitMargin > 0 && <BreakRow label="Profit margin" value={fmtMoney(result.profitMargin, business.currency)} />}
          <div className="my-2.5" style={{ borderTop: `1px dashed ${C.gold}`, opacity: 0.4 }} />
          <BreakRow label="Subtotal" value={fmtMoney(result.subtotal, business.currency)} bold />
          {result.tipPct > 0 && <BreakRow label={`Tip (${result.tipPct}% of subtotal)`} value={fmtMoney(result.tipAmount, business.currency)} />}
          <div className="mt-4 pt-4" style={{ borderTop: `1px solid rgba(201, 169, 97, 0.4)` }}>
            <p className="text-[10px] font-bold tracking-widest uppercase mb-1" style={{ color: C.gold, letterSpacing: "0.18em" }}>Final price</p>
            <p style={{ fontFamily: FONT_DISPLAY, fontSize: 44, fontWeight: 600, color: C.cream, lineHeight: 1 }}>{fmtMoney(result.finalPrice, business.currency)}</p>
          </div>
        </Card>

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
const Schedule = ({ store, prefillNewAppt, clearApptPrefill, openTimerForAppt, openCommunication }: { store: any; prefillNewAppt: any; clearApptPrefill: any; openTimerForAppt: any; openCommunication?: (ctx: CommContext) => void }) => {
  const { appointments, business, recurringSeries } = store;
  const [filter, setFilter] = useState("upcoming");
  const [editing, setEditing] = useState<EntityRecord | null>(null);

  useEffect(() => {
    if (prefillNewAppt) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- prop/store-driven sync, intentional
      setEditing({ ...prefillNewAppt, status: prefillNewAppt.status || "scheduled" });
      clearApptPrefill?.();
    }
  }, [prefillNewAppt]);

  const today = todayISO();
  const filtered = useMemo(() => {
    let list = [...appointments];
    if (filter === "today") list = list.filter(a => a.date === today);
    else if (filter === "upcoming") list = list.filter(a => a.date >= today && a.status !== "cancelled" && a.status !== "completed");
    else if (filter === "past") list = list.filter(a => a.date < today || a.status === "completed" || a.status === "cancelled");
    list.sort((a, b) => {
      const ka = (a.date || "") + (a.time || "");
      const kb = (b.date || "") + (b.time || "");
      return filter === "past" ? kb.localeCompare(ka) : ka.localeCompare(kb);
    });
    return list;
  }, [appointments, filter, today]);

  return (
    <div className="bbp-fade">
      <Header title="Schedule" />
      <div className="px-5 pt-4 pb-32 space-y-4">
        <div className="flex p-1 rounded-xl" style={{ background: C.ivory, border: `1px solid ${C.hairline}` }}>
          {[{ id: "upcoming", label: "Upcoming" }, { id: "today", label: "Today" }, { id: "past", label: "Past" }, { id: "all", label: "All" }].map(t => (
            <button key={t.id} onClick={() => setFilter(t.id)}
              className="flex-1 py-2 rounded-lg text-[13px] font-semibold transition"
              style={{ background: filter === t.id ? C.espresso : "transparent", color: filter === t.id ? C.cream : C.coffee }}>
              {t.label}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={<Calendar size={28} style={{ color: C.gold }} />}
            title="No appointments here"
            body="Tap the gold button below to add your first booking — or build a quote and convert it."
            cta={<Button variant="primary" icon={<Plus size={18} />} onClick={() => setEditing({})}>New appointment</Button>}
          />
        ) : (
          <div className="space-y-2.5">
            {filtered.map(a => <AppointmentRow key={a.id} appt={a} business={business} recurringSeries={recurringSeries} onClick={() => setEditing(a)} />)}
          </div>
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
      />
    </div>
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

const AppointmentSheet = ({ open, appt, store, onClose, openTimerForAppt, openCommunication }: { open: any; appt: any; store: any; onClose: any; openTimerForAppt: any; openCommunication?: (ctx: CommContext) => void }) => {
  const {
    upsertAppointment, deleteAppointment, clients, upsertClient, business,
    recurringSeries, upsertSeries, deleteSeries, scheduleRemindersForAppointment,
    appointments, reminderSettings,
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

  const balanceDue = (Number(form.totalPrice) || 0) - (Number(form.depositPaid) || 0);

  // When picking an existing client, auto-fill phone/email
  useEffect(() => {
    if (form.clientId) {
      const c = clients.find(x => x.id === form.clientId);
      if (c) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- prop/store-driven sync, intentional
        setForm(prev => ({
          ...prev,
          clientName: c.name,
          clientPhone: prev.clientPhone || c.phone || "",
          clientEmail: prev.clientEmail || c.email || "",
        }));
      }
    }
  }, [form.clientId, clients]);

  const handleSave = async () => {
    let clientId = form.clientId;
    let clientName = form.clientName;
    if (showNewClient && newClientName.trim()) {
      const newC = await upsertClient({ name: newClientName.trim(), phone: form.clientPhone, email: form.clientEmail });
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
    if (!window.confirm("Delete this appointment?")) return;
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

  const handleStartTimer = () => {
    if (!form.id) return;
    openTimerForAppt(form);
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title={form.id ? "Edit Appointment" : "New Appointment"}>
      <div className="space-y-4 pb-6">
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

        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone" hint="for SMS"><Input type="tel" value={form.clientPhone} onChange={e => setForm({ ...form, clientPhone: e.target.value })} placeholder="555-0123" /></Field>
          <Field label="Email" hint="for email"><Input type="email" value={form.clientEmail} onChange={e => setForm({ ...form, clientEmail: e.target.value })} placeholder="name@email.com" /></Field>
        </div>

        <Field label="Style / Service"><Input value={form.style} onChange={e => setForm({ ...form, style: e.target.value })} placeholder="e.g. Knotless mid-back" /></Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></Field>
          <Field label="Time"><Input type="time" value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} /></Field>
          <Field label="Duration"><MoneyInput prefix={undefined} suffix="hrs" value={form.durationHours} onChange={(v) => setForm({ ...form, durationHours: v })} /></Field>
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
          <Field label="Total price"><MoneyInput value={form.totalPrice} onChange={(v) => setForm({ ...form, totalPrice: v })} /></Field>
          <Field label="Deposit paid"><MoneyInput value={form.depositPaid} onChange={(v) => setForm({ ...form, depositPaid: v })} /></Field>
        </div>

        <Card className="p-3.5 flex justify-between items-center" style={{ background: C.ivory }}>
          <span className="text-sm font-semibold" style={{ color: C.coffee }}>Balance due</span>
          <span style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 600, color: balanceDue > 0 ? C.warning : C.success }}>
            {fmtMoney(balanceDue, business.currency)}
          </span>
        </Card>

        {/* PAYMENT */}
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
        </Card>

        {/* RECURRING */}
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
                <Field label="Every"><MoneyInput prefix={undefined} suffix="days" allowDecimal={false} value={customDays} onChange={setCustomDays} /></Field>
              )}
              <Field label="Occurrences" hint="this one + future">
                <MoneyInput prefix={undefined} suffix="appts" allowDecimal={false} value={occurrences} onChange={setOccurrences} />
              </Field>
              <p className="text-xs" style={{ color: C.muted }}>
                Future appointments will be auto-created on the selected cadence. Edit each one individually as needed.
              </p>
            </div>
          )}
        </Card>

        {/* REMINDERS */}
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

        <Field label="Notes">
          <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Hair texture, prep notes, anything to remember…" rows={3} />
        </Field>

        {form.id && (
          <Button variant="dark" icon={<TimerIcon size={18} />} onClick={handleStartTimer} fullWidth>Start chair timer</Button>
        )}
        {form.id && openCommunication && (
          <Button variant="outline" icon={<MessageSquare size={16} />} fullWidth
            onClick={() => openCommunication({
              appointment: form,
              client: clients.find((c: any) => c.id === form.clientId),
            })}>
            Send message to client
          </Button>
        )}

        <div className="grid grid-cols-2 gap-3 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={!form.style && !form.clientId && !showNewClient}>Save</Button>
        </div>
        {form.id && (
          <Button variant="danger" icon={<Trash2 size={16} />} onClick={handleDelete} fullWidth>Delete this appointment</Button>
        )}
        {form.seriesId && (
          <Button variant="danger" onClick={handleDeleteSeries} fullWidth>Delete entire series</Button>
        )}
      </div>
    </Sheet>
  );
};

// ============================================================
//  CLIENTS
// ============================================================
const PREF_STYLES = ["Knotless", "Box braids", "Boho", "Goddess", "Stitch braids", "Cornrows", "Twists", "Locs", "Sew-in", "Wig install"];
const SENSITIVITY = ["None", "Mild", "Moderate", "High"];

const Clients = ({ store, openClientPhotos, openCommunication }: { store: any; openClientPhotos?: any; openCommunication?: (ctx: CommContext) => void }) => {
  void openClientPhotos;
  const { clients, appointments, photos, business } = store;
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<EntityRecord | null>(null);

  const enriched = useMemo(() => clients.map(c => {
    const cAppts = appointments.filter(a => a.clientId === c.id);
    // Lifetime total = sum of what was actually collected, not quoted.
    const totalSpent = cAppts
      .filter(a => (a.status === "completed" || a.paymentStatus === "paid") && a.status !== "cancelled")
      .reduce((s, a) => {
        const collected = calculateCollectedAmount(a);
        return s + collected;
      }, 0);
    return {
      ...c,
      apptCount: cAppts.length,
      totalSpent,
      lastApptDate: cAppts.map(a => a.date).sort().reverse()[0],
      photoCount: photos.filter(p => p.clientId === c.id).length,
    };
  }).sort((a, b) => a.name.localeCompare(b.name)), [clients, appointments, photos]);

  const filtered = enriched.filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="bbp-fade">
      <Header title="Clients" subtitle={`${clients.length} ${clients.length === 1 ? "client" : "clients"}`} />
      <div className="px-5 pt-4 pb-32 space-y-3">
        <div className="relative">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: C.muted }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search clients"
            className="w-full rounded-xl py-3 pl-10 pr-4 text-[15px] outline-none"
            style={{ background: C.paper, border: `1px solid ${C.hairline}`, color: C.ink }} />
        </div>

        {filtered.length === 0 ? (
          clients.length === 0 ? (
            <EmptyState
              icon={<Users size={28} style={{ color: C.gold }} />}
              title="No clients yet"
              body="Build your book of business. Every client becomes a profile with style preferences, photos, allergies, and lifetime value."
              cta={<Button variant="primary" icon={<Plus size={18} />} onClick={() => setEditing({})}>Add first client</Button>}
            />
          ) : (
            <div className="text-center py-8 text-sm" style={{ color: C.muted }}>No matches for &quot;{search}&quot;</div>
          )
        ) : (
          <div className="space-y-2.5">
            {filtered.map(c => (
              <Card key={c.id} className="p-4 flex items-center gap-3 cursor-pointer active:scale-[0.99] transition" onClick={() => setEditing(c)}>
                <div className="rounded-full flex items-center justify-center shrink-0" style={{
                  width: 46, height: 46, background: `linear-gradient(135deg, ${C.caramel}, ${C.coffee})`,
                  color: C.cream, fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600,
                }}>{initials(c.name)}</div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[15px] truncate" style={{ color: C.espresso }}>{c.name}</p>
                  <p className="text-xs mt-0.5 flex items-center gap-2" style={{ color: C.muted }}>
                    <span>{c.apptCount > 0 ? `${c.apptCount} appt${c.apptCount > 1 ? "s" : ""}` : "No appointments"}</span>
                    {c.photoCount > 0 && <span className="flex items-center gap-1"><ImageIcon size={10} />{c.photoCount}</span>}
                    {c.lastApptDate && <span>· {fmtDate(c.lastApptDate)}</span>}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: C.muted, letterSpacing: "0.12em" }}>Lifetime</p>
                  <p style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600, color: C.goldDeep }}>{fmtMoney(c.totalSpent, business.currency)}</p>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
      <FAB onClick={() => setEditing({})} />
      <ClientSheet open={!!editing} client={editing} store={store} onClose={() => setEditing(null)} openCommunication={openCommunication} />
    </div>
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

const ClientSheet = ({ open, client, store, onClose, openCommunication }: {
  open: boolean;
  client: any;
  store: any;
  onClose: () => void;
  openCommunication?: (ctx: CommContext) => void;
}) => {
  const { upsertClient, deleteClient, appointments, photos, business, upsertPhoto, deletePhoto } = store;
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
    for (const p of myPhotos) await deletePhoto(p.id);
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
              <button key={t} onClick={() => setTab(t)}
                className="flex-1 py-2 rounded-lg text-[13px] font-semibold transition capitalize"
                style={{ background: tab === t ? C.espresso : "transparent", color: tab === t ? C.cream : C.coffee }}>
                {t === "photos" ? `Photos${myPhotos.length ? ` · ${myPhotos.length}` : ""}` : t}
              </button>
            ))}
          </div>
        )}

        {tab === "info" && (
          <div className="space-y-4">
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
                    <button key={s} onClick={() => togglePref(s)}
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
          <PhotoGallery clientId={form.id} clientName={form.name} appointments={myAppts} photos={myPhotos} upsertPhoto={upsertPhoto} deletePhoto={deletePhoto} />
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
        <button onClick={() => fileRef.current?.click()} disabled={uploading}
          className="flex-1 rounded-xl px-4 py-3 text-sm font-bold flex items-center justify-center gap-2"
          style={{ background: C.gold, color: C.espresso, border: `1.5px solid ${C.goldDeep}` }}>
          {uploading ? "Uploading…" : <><Camera size={16} /> Add photo</>}
        </button>
        <button onClick={() => setShowFavOnly(!showFavOnly)}
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
            Add inspiration photos, before/afters, scalp notes, or color references.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {filtered.map(p => (
            <button key={p.id} onClick={() => setLightbox(p)}
              className="relative aspect-square rounded-xl overflow-hidden active:scale-[0.97] transition"
              style={{ border: `1px solid ${C.hairline}` }}>
              <img src={p.thumbnailDataUrl || p.dataUrl} alt={p.caption || ""}
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
  <button onClick={onClick}
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
        <button onClick={onClose} className="p-2 rounded-full" style={{ color: C.gold }}><X size={22} /></button>
        <div className="flex items-center gap-3">
          <button onClick={() => onToggleFav(current)} className="p-2 rounded-full" style={{ color: current.isFavorite ? C.gold : C.mutedSoft }}>
            <Star size={20} fill={current.isFavorite ? C.gold : "none"} />
          </button>
          <button onClick={() => onEdit(current)} className="p-2 rounded-full" style={{ color: C.gold }}><Edit3 size={18} /></button>
          <button onClick={() => onDelete(current)} className="p-2 rounded-full" style={{ color: C.danger }}><Trash2 size={18} /></button>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center p-3 overflow-hidden relative">
        <img src={current.dataUrl} alt={current.caption || ""}
          style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 12 }} />
        {prev && (
          <button onClick={() => setCurrent(prev)} className="absolute left-2 p-2 rounded-full" style={{ background: "rgba(0,0,0,0.5)", color: C.gold }}>
            <ChevronLeft size={22} />
          </button>
        )}
        {next && (
          <button onClick={() => setCurrent(next)} className="absolute right-2 p-2 rounded-full" style={{ background: "rgba(0,0,0,0.5)", color: C.gold }}>
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
          <img src={form.dataUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", maxHeight: 240 }} />
        </div>

        <Field label="Category">
          <div className="flex flex-wrap gap-2">
            {PHOTO_CATEGORIES.map(c => {
              const on = form.category === c.value;
              return (
                <button key={c.value} onClick={() => setForm({ ...form, category: c.value })}
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
const Money = ({ store, openTxSheet, editTx, openTimerSessions }) => {
  const [period, setPeriod] = useState("week");
  const [tab, setTab] = useState("money"); // money | productivity

  const range = useMemo(() => {
    const now = new Date();
    const start = new Date(now);
    if (period === "week") start.setDate(now.getDate() - 7);
    else if (period === "month") start.setMonth(now.getMonth() - 1);
    else if (period === "quarter") start.setMonth(now.getMonth() - 3);
    else start.setFullYear(2000);
    return { start: start.toISOString().slice(0, 10), end: todayISO() };
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
            <button key={t.id} onClick={() => setTab(t.id)}
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
            <button key={k} onClick={() => setPeriod(k)}
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
          editTx={editTx} openTxSheet={openTxSheet} />
      ) : (
        <ProductivityTab sessions={sessionsInRange} appointments={store.appointments} business={store.business}
          openTimerSessions={openTimerSessions} />
      )}
    </div>
  );
};

const MoneyTab = ({ all, income, expenses, net, business, editTx, openTxSheet }: {
  all: any[];
  income: number;
  expenses: number;
  net: number;
  business: any;
  editTx: any;
  openTxSheet: any;
}) => (
  <div className="px-5">
    {/* totals */}
    <div className="grid grid-cols-3 gap-2 mb-5">
      <Card className="p-3" style={{ background: C.ivory }}>
        <p className="text-[10px] uppercase tracking-widest font-bold mb-1" style={{ color: C.success, letterSpacing: "0.12em" }}>In</p>
        <p className="text-base font-bold" style={{ color: C.espresso, fontFamily: FONT_DISPLAY }}>{fmtMoney(income, business.currency)}</p>
      </Card>
      <Card className="p-3" style={{ background: C.ivory }}>
        <p className="text-[10px] uppercase tracking-widest font-bold mb-1" style={{ color: C.danger, letterSpacing: "0.12em" }}>Out</p>
        <p className="text-base font-bold" style={{ color: C.espresso, fontFamily: FONT_DISPLAY }}>{fmtMoney(expenses, business.currency)}</p>
      </Card>
      <Card className="p-3" style={{ background: net >= 0 ? "#EFF4E8" : "#FBEAE5", border: `1px solid ${net >= 0 ? C.success : C.danger}` }}>
        <p className="text-[10px] uppercase tracking-widest font-bold mb-1" style={{ color: net >= 0 ? C.success : C.danger, letterSpacing: "0.12em" }}>Net</p>
        <p className="text-base font-bold" style={{ color: C.espresso, fontFamily: FONT_DISPLAY }}>{fmtMoney(net, business.currency)}</p>
      </Card>
    </div>

    <SectionTitle>Activity</SectionTitle>
<button onClick={() => openTxSheet()}>Add</button>
    {all.length === 0 ? (
      <EmptyState icon={<Receipt size={28} style={{ color: C.muted }} />} title="No activity yet" body="Completed appointments auto-appear here. Add manual transactions for hair supplies, tools, or anything else." />
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
            <button key={k} onClick={() => setFilter(k)}
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
            title={filter === "pending" ? "No reminders queued" : "Nothing here"}
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
                        {PURPOSE_LABEL_LOCAL[r.purpose] || r.purpose} · {r.channel.toUpperCase()}
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
            <p className="text-sm font-semibold" style={{ color: C.espresso }}>{reminder.channel.toUpperCase()}</p>
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
            <MoneyInput prefix={undefined} suffix="hrs" allowDecimal={false} value={s.timings.sameDayHoursBefore ?? 3}
              onChange={(v) => setS({ ...s, timings: { ...s.timings, sameDayHoursBefore: parseMoney(v) || 3 } })} />
          </Field>
          <Field label="Late alert minutes">
            <MoneyInput prefix={undefined} suffix="min" allowDecimal={false} value={s.timings.lateAlertMinutes ?? 15}
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
                <Pill tone="neutral">{t.channel.toUpperCase()}</Pill>
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
        <div className="bbp-fade pb-32" style={{ minHeight: "100vh", background: C.cream }}>
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
        <div className="bbp-fade pb-32" style={{ minHeight: "100vh", background: C.cream }}>
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
                  <MoneyInput prefix={undefined} suffix="hrs" value={setup?.estimatedHours ?? ""} onChange={(v) => setSetup({ ...setup, estimatedHours: v === "" ? null : parseMoney(v) })} />
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
      minHeight: "100vh",
      background: `linear-gradient(180deg, ${C.espresso} 0%, ${C.coffee} 100%)`,
      color: C.cream
    }}>
      <div className="flex items-center justify-between px-5 pt-12 pb-4">
        <button onClick={onBack} className="rounded-full p-2"
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
          <button onClick={pause}
            className="py-4 rounded-2xl font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition"
            style={{ background: "rgba(245,235,217,0.12)", color: C.cream, border: `1.5px solid rgba(245,235,217,0.2)` }}>
            <Pause size={18} fill={C.cream} /> Pause
          </button>
        ) : (
          <button onClick={resume}
            className="py-4 rounded-2xl font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition"
            style={{ background: C.gold, color: C.espresso }}>
            <Play size={18} fill={C.espresso} /> Resume
          </button>
        )}
        <button onClick={reset}
          className="py-4 rounded-2xl font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition"
          style={{ background: C.warning, color: C.cream }}>
          <RefreshCw size={16} /> Reset
        </button>
        <button onClick={() => setShowStop(true)}
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
    <div className="bbp-fade pb-32" style={{ minHeight: "100vh", background: C.cream }}>
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
      <button onClick={(e) => { e.stopPropagation(); onUse(); }}
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
          <Field label="Hours"><MoneyInput prefix={undefined} suffix="hrs" value={p.estimatedHours ?? ""} onChange={(v) => setP({ ...p, estimatedHours: parseMoney(v) })} /></Field>
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
            <button onClick={() => removeAddOn(i)} className="rounded-xl p-2"
              style={{ background: "rgba(156,61,46,0.1)", color: C.danger }}><X size={16} /></button>
          </div>
        ))}

        <SectionTitle>Deposit</SectionTitle>
        <div className="grid grid-cols-[1fr_140px] gap-3">
          <Field label="Amount"><MoneyInput prefix={undefined} value={p.defaultDeposit ?? ""} onChange={(v) => setP({ ...p, defaultDeposit: parseMoney(v) })} /></Field>
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
            <button key={o.k} onClick={() => setT({ ...t, type: o.k, category: o.k === "expense" ? "Hair supplies" : "Service" })}
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
const SavedQuotes = ({ store, onBack, onLoadQuote, onConvertToAppt }) => {
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
const SettingsScreen = ({ store, onBack, openReminderSettings, openCommunicationLog }: { store: any; onBack: any; openReminderSettings: any; openCommunicationLog?: () => void }) => {
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
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `braid-boss-pro-export-${todayISO()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
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

        <SectionTitle>Reminders</SectionTitle>
        <Card className="p-4 active:scale-[0.99]" onClick={openReminderSettings}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold" style={{ color: C.espresso }}>Reminder settings</p>
              <p className="text-[11px]" style={{ color: C.muted }}>{store.reminderSettings.enabled ? "Enabled" : "Disabled"} · {store.reminderSettings.defaultChannel.toUpperCase()}</p>
            </div>
            <ChevronRight size={18} style={{ color: C.muted }} />
          </div>
        </Card>

        {openCommunicationLog && (
          <Card className="p-4 active:scale-[0.99] mt-2" onClick={openCommunicationLog}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold" style={{ color: C.espresso }}>Communication log</p>
                <p className="text-[11px]" style={{ color: C.muted }}>{(store.commLog || []).length} message{(store.commLog || []).length === 1 ? "" : "s"} · copies, shares, sends</p>
              </div>
              <ChevronRight size={18} style={{ color: C.muted }} />
            </div>
          </Card>
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
                <button onClick={() => store.deleteCommLogEntry(e.id)}
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
type NotifItem = {
  id: string;
  kind: "reminder" | "balance" | "upcoming";
  tone: "warning" | "danger" | "gold" | "neutral";
  icon: React.ReactNode;
  title: string;
  body: string;
  meta?: string;
};

const buildNotifications = (store: any): NotifItem[] => {
  const items: NotifItem[] = [];
  const today = todayISO();
  const now = Date.now();
  const in7 = addDaysISO(today, 7);

  // Pending appointment reminders
  const pendingReminders = (store.reminders || []).filter((r: any) => r && r.status === "pending");
  for (const r of pendingReminders) {
    const client = store.clientById ? store.clientById(r.clientId) : null;
    items.push({
      id: `rem_${r.id}`,
      kind: "reminder",
      tone: "warning",
      icon: <Bell size={16} style={{ color: C.warning }} />,
      title: `${PURPOSE_LABEL_LOCAL[r.purpose as keyof typeof PURPOSE_LABEL_LOCAL] || "Reminder"} · ${client?.name || r.clientName || "Client"}`,
      body: r.renderedBody || "Reminder is queued.",
      meta: r.scheduledFor ? `Scheduled ${fmtRelative(r.scheduledFor)}` : undefined,
    });
  }

  // Late balance alerts: appointments past their date with balance > 0 and not cancelled
  const lateBalance = (store.appointments || []).filter((a: any) =>
    a && a.status !== "cancelled" && a.status !== "completed" &&
    Number(a.balanceDue) > 0 && a.date && a.date < today
  );
  for (const a of lateBalance) {
    items.push({
      id: `bal_${a.id}`,
      kind: "balance",
      tone: "danger",
      icon: <AlertCircle size={16} style={{ color: C.danger }} />,
      title: `Balance overdue · ${a.clientName || "Client"}`,
      body: `${fmtMoney(Number(a.balanceDue) || 0, store.business?.currency || "USD")} unpaid for ${a.style || "appointment"}.`,
      meta: `Was ${fmtDate(a.date)}`,
    });
  }

  // Upcoming bookings within 7 days
  const upcoming = (store.appointments || []).filter((a: any) =>
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
      kind: "upcoming",
      tone: soon ? "gold" : "neutral",
      icon: <Calendar size={16} style={{ color: soon ? C.goldDeep : C.coffee }} />,
      title: `${a.clientName || "Client"} · ${a.style || "Appointment"}`,
      body: `${fmtDate(a.date)}${a.time ? ` at ${fmtTime(a.time)}` : ""}`,
      meta: apptMs ? fmtRelative(new Date(apptMs).toISOString()) : undefined,
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
    store.reminders, store.appointments, store.clients, store.business
  ]);
  const items = useMemo(() => allItems.filter(n => !dismissed.includes(n.id)), [allItems, dismissed]);
  const unreadCount = useMemo(() => items.filter(n => !read.includes(n.id)).length, [items, read]);

  // Prune dismissed / read IDs that no longer exist in the live items.
  // Without this, deleting an appointment leaves its notification id
  // pinned in storage forever, slowly bloating the persisted list.
  useEffect(() => {
    if (!hydrated) return;
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

  return { hydrated, items, unreadCount, dismiss, clearAll, markAllRead };
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

const NotificationsSheet = ({ open, onClose, items, dismiss, clearAll, markAllRead }: {
  open: boolean;
  onClose: () => void;
  items: NotifItem[];
  dismiss: (id: string) => void;
  clearAll: () => void;
  markAllRead: () => void;
}) => {
  return (
    <Sheet open={open} onClose={onClose} title="Notifications"
      leftAction={
        <button onClick={onClose} aria-label="Back to dashboard"
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
            <button onClick={markAllRead}
              className="rounded-xl px-3 py-2.5 text-[12px] font-bold uppercase tracking-wider active:scale-[0.97] transition flex items-center justify-center gap-1.5"
              style={{ background: C.ivory, color: C.coffee, border: `1px solid ${C.hairline}`, letterSpacing: "0.08em" }}>
              <Check size={14} /> Mark all read
            </button>
            <button onClick={clearAll}
              className="rounded-xl px-3 py-2.5 text-[12px] font-bold uppercase tracking-wider active:scale-[0.97] transition flex items-center justify-center gap-1.5"
              style={{ background: "transparent", color: C.danger, border: `1px solid ${C.danger}`, letterSpacing: "0.08em" }}>
              <Trash2 size={14} /> Clear all
            </button>
          </div>
          <div className="space-y-2 pb-6">
            {items.map(n => (
              <Card key={n.id} className="p-3.5 flex items-start gap-3">
                <div className="rounded-xl p-2 shrink-0" style={{
                  background: n.tone === "danger" ? "rgba(156,61,46,0.10)" :
                    n.tone === "warning" ? "rgba(201,118,43,0.12)" :
                      n.tone === "gold" ? "rgba(201,169,97,0.18)" : C.ivory,
                }}>{n.icon}</div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate" style={{ color: C.espresso }}>{n.title}</p>
                  <p className="text-xs mt-0.5 leading-relaxed line-clamp-2" style={{ color: C.coffee }}>{n.body}</p>
                  {n.meta && <p className="text-[11px] mt-1" style={{ color: C.muted }}>{n.meta}</p>}
                </div>
                <button onClick={() => dismiss(n.id)} aria-label="Dismiss notification"
                  className="p-2 -mr-1 rounded-full shrink-0 active:scale-[0.92] transition"
                  style={{ color: C.danger }}>
                  <Trash2 size={16} />
                </button>
              </Card>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
};

// ============================================================
//  APP ROOT
// ============================================================
export default function App() {
  const store = useStorage();
  const [active, setActive] = useState("dashboard");
  const [secondary, setSecondary] = useState<string | null>(null); // policies | settings | savedQuotes | reminders | reminderSettings | presets | timer | timerSessions
  const [calcPrefill, setCalcPrefill] = useState<EntityRecord | null>(null);
  const [calcPresetPrefill, setCalcPresetPrefill] = useState<EntityRecord | null>(null);
  const [apptPrefill, setApptPrefill] = useState<EntityRecord | null>(null);
  const [timerApptPrefill, setTimerApptPrefill] = useState<EntityRecord | null>(null);
  const [openTx, setOpenTx] = useState(false);
  const [editingTx, setEditingTx] = useState<EntityRecord | null>(null);
  const [openClientForm, setOpenClientForm] = useState(false);
  const [quickClient, setQuickClient] = useState<EntityRecord | null>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [commPickerCtx, setCommPickerCtx] = useState<CommContext | null>(null);
  const [activeComm, setActiveComm] = useState<(CommContext & { templateKey: CommTemplateKey }) | null>(null);
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

  if (store.loading) {
    return (
      <div className="flex items-center justify-center" style={{ minHeight: "100vh", background: C.cream }}>
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
              openPresets={() => setSecondary("presets")}
              openTimer={() => setSecondary("timer")} />
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
              openCommunication={openCommunication} />
          )}
          {active === "clients" && (
            <Clients store={store} openCommunication={openCommunication} />
          )}
          {active === "money" && (
            <Money store={store}
              openTxSheet={() => { setEditingTx(null); setOpenTx(true); }}
              editTx={(t) => { setEditingTx(t); setOpenTx(true); }}
              openTimerSessions={() => setSecondary("timerSessions")} />
          )}
        </>
      )}

      {secondary === "policies" && <Policies store={store} onBack={() => setSecondary(null)} />}
      {secondary === "settings" && <SettingsScreen store={store} onBack={() => setSecondary(null)} openReminderSettings={() => setSecondary("reminderSettings")} openCommunicationLog={() => setSecondary("communicationLog")} />}
      {secondary === "savedQuotes" && (
        <SavedQuotes store={store} onBack={() => setSecondary(null)}
          onLoadQuote={handleLoadQuote}
          onConvertToAppt={handleConvertQuoteToAppt} />
      )}
      {secondary === "reminders" && <ReminderInbox store={store} onBack={() => setSecondary(null)} openSettings={() => setSecondary("reminderSettings")} />}
      {secondary === "reminderSettings" && <ReminderSettings store={store} onBack={() => setSecondary("reminders")} />}
      {secondary === "presets" && (
        <PresetsScreen store={store} onBack={() => setSecondary(null)} onUsePreset={handleUsePreset} />
      )}
      {secondary === "timerSessions" && <TimerSessionsScreen store={store} onBack={() => setSecondary(null)} />}
      {secondary === "communicationLog" && <CommunicationLogScreen store={store} onBack={() => setSecondary(null)} />}

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

      {/* Notifications sheet (bell on dashboard) */}
      <NotificationsSheet
        open={notifOpen}
        onClose={() => setNotifOpen(false)}
        items={notifications.items}
        dismiss={notifications.dismiss}
        clearAll={notifications.clearAll}
        markAllRead={notifications.markAllRead}
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
