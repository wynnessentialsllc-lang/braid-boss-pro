// Services & Styles V1 — studio catalog.
//
// Mirrors the discounts.ts pattern: types, validation, a Supabase-backed
// hook with CRUD + active toggle. Phase 1 only ships the catalog UI;
// Phase 2 will wire services into the appointment form so picking a
// service prefills duration / price / deposit). Phase 1 only ships the
// catalog UI; Phase 2 will wire services into the appointment form so
// picking a service prefills duration / price / deposit.

import { useEffect, useState } from "react";
import { getSupabase } from "./supabase";

// Service variations (legacy: "add-ons"). The jsonb column is still
// `add_ons` for back-compat, but each entry can now carry its own
// price, duration, and deposit so a single parent service can have
// multiple bookable flavors (e.g. "with human curly hair" $355 / $75
// deposit vs "standard install" $225 / $25 deposit).
//
// Legacy entries with only { id, name, amount } stay valid: the
// resolver in `resolveVariationPricing` falls back to the parent's
// base_price / duration / deposit when a per-variation field is null
// or undefined, so existing services keep working unchanged.
// Optional paid add-ons. Stacked on top of the picked base/variation
// at booking time. Stored in services.extras jsonb.
//   * price        — flat $ added per booking
//   * duration_hours_delta — added to the appointment length
//   * include_in_deposit   — when true, the add-on's price is rolled
//                            into the deposit due today. Defaults to
//                            false so picking add-ons doesn't quietly
//                            bump the deposit on the public page.
//   * active       — soft toggle; inactive add-ons hide from the
//                    public picker but stay editable.
export type ServiceExtra = {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  duration_hours_delta?: number | null;
  include_in_deposit?: boolean | null;
  active?: boolean | null;
  sort_order?: number | null;
  // Marks a managed, first-class optional that the editor surfaces as
  // its own labeled toggle instead of a generic add-on row (e.g. the
  // ACV hair treatment). Stored in the same services.extras jsonb so it
  // reuses the whole booking pipeline — pricing, deposit, anti-tamper
  // validation, and the appointment snapshot — for free. Plain add-ons
  // leave this null/undefined.
  kind?: string | null;
};

// The ACV (apple cider vinegar) hair treatment is a managed extra: a
// per-service optional the braider can show/hide and price (free when
// 0). It lives in services.extras tagged with this kind so it rides the
// existing add-on rails, but the editor renders it as its own toggle.
export const ACV_EXTRA_KIND = "acv";
export const ACV_EXTRA_ID = "acv_treatment";
export const ACV_EXTRA_NAME = "Apple cider vinegar (ACV) treatment";

export const findAcvExtra = (
  extras: ServiceExtra[] | null | undefined,
): ServiceExtra | null =>
  (extras || []).find(
    e => e?.kind === ACV_EXTRA_KIND || e?.id === ACV_EXTRA_ID,
  ) || null;

// Enabled = present AND not soft-disabled. Toggling off keeps the entry
// (so its configured price survives) but flips active to false, which
// hides it from the booking page exactly like an inactive add-on.
export const isAcvTreatmentEnabled = (
  s: Pick<Service, "extras"> | null | undefined,
): boolean => {
  const e = findAcvExtra(s?.extras);
  return !!e && e.active !== false;
};

// Customized braiding hair color — a managed extra that lets clients
// describe a color combo (e.g. "1B/30/27") and upload an inspiration
// photo. Default price is $25; the braider can edit it. Same managed-
// extra pattern as ACV so pricing/duration/deposit ride the existing
// add-on rails for free.
export const CUSTOM_COLOR_EXTRA_KIND = "custom_color";
export const CUSTOM_COLOR_EXTRA_ID = "custom_braiding_hair_color";
export const CUSTOM_COLOR_EXTRA_NAME = "Customized braiding hair color";
export const CUSTOM_COLOR_DEFAULT_PRICE = 25;

export const findCustomColorExtra = (
  extras: ServiceExtra[] | null | undefined,
): ServiceExtra | null =>
  (extras || []).find(
    e => e?.kind === CUSTOM_COLOR_EXTRA_KIND || e?.id === CUSTOM_COLOR_EXTRA_ID,
  ) || null;

export const isCustomColorEnabled = (
  s: Pick<Service, "extras"> | null | undefined,
): boolean => {
  const e = findCustomColorExtra(s?.extras);
  return !!e && e.active !== false;
};


export type ServiceAddOn = {
  id: string;
  name: string;
  amount: number;
  // Variation-level overrides. Null/undefined = inherit from the
  // parent service.
  variation_price?: number | null;
  variation_duration_hours?: number | null;
  variation_deposit_required?: boolean | null;
  variation_deposit_amount?: number | null;
  // Shown to clients on the booking page when this variation is
  // selected (e.g. what's included with this option).
  variation_description?: string | null;
};

// Resolved per-variation pricing. When `addonId` is null/unknown we
// return the parent service's defaults so the rest of the flow can
// treat "no variation" identically to "variation that inherits
// everything".
export type ResolvedVariation = {
  variationId: string | null;
  variationName: string | null;
  price: number;
  durationHours: number;
  depositRequired: boolean;
  depositAmount: number;
  balanceDue: number;
};

export const resolveVariationPricing = (
  service: Pick<Service, "base_price" | "duration_hours" | "deposit_required" | "deposit_amount" | "add_ons">,
  addonId: string | null | undefined,
): ResolvedVariation => {
  const basePrice = Number(service.base_price) || 0;
  const baseDuration = Number(service.duration_hours) || 0;
  const baseDepositRequired = !!service.deposit_required;
  const baseDepositAmount = Number(service.deposit_amount ?? 0);

  const variation = addonId
    ? (service.add_ons || []).find(a => a.id === addonId) || null
    : null;

  if (!variation) {
    const depositAmount = baseDepositRequired ? baseDepositAmount : 0;
    return {
      variationId: null,
      variationName: null,
      price: basePrice,
      durationHours: baseDuration,
      depositRequired: baseDepositRequired,
      depositAmount,
      balanceDue: Math.max(0, basePrice - depositAmount),
    };
  }

  const vPrice = variation.variation_price;
  const vDuration = variation.variation_duration_hours;
  const vDepReq = variation.variation_deposit_required;
  const vDepAmt = variation.variation_deposit_amount;

  // Variation price falls back to base + legacy add-on amount so
  // existing add-ons (price bumps) keep working.
  const price = (vPrice != null && Number.isFinite(vPrice))
    ? Number(vPrice)
    : basePrice + (Number(variation.amount) || 0);

  const durationHours = (vDuration != null && Number.isFinite(vDuration) && vDuration > 0)
    ? Number(vDuration)
    : baseDuration;

  // Variation deposit overrides the parent's. When the variation
  // toggle is explicitly off we honor that even if the parent
  // requires one. When undefined we inherit the parent.
  const depositRequired = (typeof vDepReq === "boolean")
    ? vDepReq
    : baseDepositRequired;
  let depositAmount = 0;
  if (depositRequired) {
    if (vDepAmt != null && Number.isFinite(vDepAmt) && vDepAmt > 0) {
      depositAmount = Number(vDepAmt);
    } else {
      depositAmount = baseDepositAmount;
    }
  }
  // Never charge a deposit larger than the price itself.
  depositAmount = Math.min(depositAmount, price);

  return {
    variationId: variation.id,
    variationName: (variation.name || "").trim() || null,
    price,
    durationHours,
    depositRequired: depositRequired && depositAmount > 0,
    depositAmount,
    balanceDue: Math.max(0, price - depositAmount),
  };
};

export type Service = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  duration_hours: number;
  base_price: number;
  deposit_required: boolean;
  deposit_amount: number | null;
  add_ons: ServiceAddOn[];
  // Optional paid add-ons stacked on top of the picked base/variation
  // (waist length, curly pieces, extra fullness, etc.). Distinct from
  // add_ons / variations — these don't replace the service, they
  // augment it. Stored in services.extras jsonb.
  extras: ServiceExtra[];
  prep_instructions: string | null;
  is_active: boolean;
  // Phase B1 — feed the slot engine when this service is booked:
  // buffer_before / buffer_after pad each booking so prep + takedown
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  max_concurrent: number;
  // Phase Contract Templates — optional contract to attach
  contract_template_id: string | null;
  // Service categories — optional parent group. Null = appears under
  // "Other Services" in the editor + on the public booking page.
  category_id: string | null;
  // Pinned to the top of the public booking page in a "Featured"
  // row. Defaults to false; stylist toggles per service.
  featured: boolean;
  // Optional cover image rendered on the service card. Object-cover
  // ratio kept consistent across the page; null = no image. A
  // future before/after slot uses before_after_image_url for the
  // "transformation" UI we'll ship in Phase 3.
  cover_image_url: string | null;
  before_after_image_url: string | null;
  // Style Customization (Client Portal update, Phase 1/2). All
  // additive + default-safe so existing services behave unchanged.
  hair_included: boolean;
  included_hair_description: string | null;
  allow_client_hair_color_selection: boolean;
  allowed_hair_colors: string[];
  allow_client_curl_pattern_selection: boolean;
  allowed_curl_patterns: string[];
  allow_style_notes: boolean;
  allow_inspiration_photos: boolean;
  included_details: string | null;
  customization_enabled: boolean;
  // Inventory V1 — typical materials consumed by this service.
  // Pre-fills the "Materials used" sheet on appointment completion;
  // stylist can confirm or edit before the inventory_apply_movement
  // RPC fires. Stored in services.default_materials jsonb.
  default_materials: ServiceMaterial[];
  // Marketing automation V1 — weeks after the appointment before
  // the client is "due for a refresh" and gets a rebook nudge email.
  // null = no auto-nudge (digital consults, one-off classes, etc.).
  rebook_after_weeks: number | null;
  // Mobile Services V1 — when true, this service is offered at the
  // client's address. Pricing rides one of four travel-fee models;
  // the public booking page geocodes the client address and either
  // quotes the trip or blocks "out of service area".
  mobile_service: boolean;
  mobile_fee_model: "flat" | "per_mile" | "hybrid" | "tiered";
  mobile_flat_fee: number;
  mobile_per_mile_fee: number;
  mobile_hybrid_free_miles: number;
  mobile_tiered_bands: Array<{ max_miles: number; fee: number }>;
  mobile_minimum_price: number | null;
  created_at: string;
  updated_at: string;
};

export type ServiceMaterial = {
  inventory_item_id: string;
  quantity: number;
};

export type ServiceInput = Pick<
  Service,
  | "name"
  | "description"
  | "duration_hours"
  | "base_price"
  | "deposit_required"
  | "deposit_amount"
  | "add_ons"
  | "prep_instructions"
  | "is_active"
  | "buffer_before_minutes"
  | "buffer_after_minutes"
  | "max_concurrent"
  | "contract_template_id"
  | "category_id"
  | "extras"
  | "featured"
  | "cover_image_url"
  | "before_after_image_url"
  | "hair_included"
  | "included_hair_description"
  | "allow_client_hair_color_selection"
  | "allowed_hair_colors"
  | "allow_client_curl_pattern_selection"
  | "allowed_curl_patterns"
  | "allow_style_notes"
  | "allow_inspiration_photos"
  | "included_details"
  | "customization_enabled"
  | "default_materials"
  | "rebook_after_weeks"
  | "mobile_service"
  | "mobile_fee_model"
  | "mobile_flat_fee"
  | "mobile_per_mile_fee"
  | "mobile_hybrid_free_miles"
  | "mobile_tiered_bands"
  | "mobile_minimum_price"
>;

// ---- Validation -------------------------------------------------------

export type ServiceValidationError = {
  field: keyof ServiceInput | "form";
  message: string;
};

export const validateService = (
  draft: Partial<ServiceInput>,
): ServiceValidationError[] => {
  const errors: ServiceValidationError[] = [];
  const name = (draft.name || "").trim();
  if (!name) {
    errors.push({ field: "name", message: "Name is required." });
  }
  if (name.length > 100) {
    errors.push({ field: "name", message: "Name must be 100 characters or less." });
  }
  const description = draft.description?.trim() || null;
  if (description && description.length > 500) {
    errors.push({ field: "description", message: "Description must be 500 characters or less." });
  }
  if (draft.duration_hours == null || draft.duration_hours <= 0 || draft.duration_hours > 48) {
    errors.push({ field: "duration_hours", message: "Duration must be between 0.25 and 48 hours." });
  }
  if (draft.base_price == null || draft.base_price < 0) {
    errors.push({ field: "base_price", message: "Base price can't be negative." });
  }
  if (draft.deposit_required && (draft.deposit_amount == null || draft.deposit_amount <= 0)) {
    errors.push({ field: "deposit_amount", message: "Deposit amount is required when deposit is required." });
  }
  if (draft.deposit_amount != null && draft.deposit_amount < 0) {
    errors.push({ field: "deposit_amount", message: "Deposit amount can't be negative." });
  }
  if (draft.base_price != null &&
draft.deposit_amount != null &&
draft.deposit_amount > draft.base_price) {
    errors.push({ field: "deposit_amount", message: "Deposit can't exceed the base price." });
  }
  draft.add_ons?.forEach((a, i) => {
    const aname = (a.name || "").trim();
    if (!aname) {
      errors.push({ field: "add_ons", message: `Add-on ${i + 1} needs a name.` });
      return;
    }
    if (aname.length > 50) {
      errors.push({ field: "add_ons", message: `Add-on ${i + 1} name must be 50 characters or less.` });
      return;
    }
    if (!Number.isFinite(a.amount) || a.amount < 0) {
      errors.push({ field: "add_ons", message: `Add-on ${i + 1} amount can't be negative.` });
      return;
    }
    if (a.variation_price != null && (!Number.isFinite(a.variation_price) || a.variation_price < 0)) {
      errors.push({ field: "add_ons", message: `Variation ${i + 1} price can't be negative.` });
      return;
    }
    if (a.variation_duration_hours != null
        && (!Number.isFinite(a.variation_duration_hours) || a.variation_duration_hours <= 0 || a.variation_duration_hours > 48)) {
      errors.push({ field: "add_ons", message: `Variation ${i + 1} duration must be between 0.25 and 48 hours.` });
      return;
    }
    if (a.variation_deposit_amount != null
        && (!Number.isFinite(a.variation_deposit_amount) || a.variation_deposit_amount < 0)) {
      errors.push({ field: "add_ons", message: `Variation ${i + 1} deposit can't be negative.` });
      return;
    }
    if (a.variation_deposit_required
        && (a.variation_deposit_amount == null || a.variation_deposit_amount <= 0)) {
      errors.push({ field: "add_ons", message: `Variation ${i + 1} needs a deposit amount when deposit is required.` });
      return;
    }
    // Variation deposit can never exceed its own price (or the
    // parent's base_price if the variation inherits).
    const vEffPrice = a.variation_price != null
      ? Number(a.variation_price)
      : ((Number(draft.base_price) || 0) + (Number(a.amount) || 0));
    if (a.variation_deposit_amount != null && Number(a.variation_deposit_amount) > vEffPrice) {
      errors.push({ field: "add_ons", message: `Variation ${i + 1} deposit can't exceed its price.` });
      return;
    }
  });
  draft.extras?.forEach((e, i) => {
    const name = (e.name || "").trim();
    if (!name) {
      errors.push({ field: "extras" as any, message: `Add-on ${i + 1} needs a name.` });
      return;
    }
    if (name.length > 60) {
      errors.push({ field: "extras" as any, message: `Add-on ${i + 1} name must be 60 characters or less.` });
      return;
    }
    if (!Number.isFinite(e.price) || e.price < 0) {
      errors.push({ field: "extras" as any, message: `Add-on ${i + 1} price can't be negative.` });
      return;
    }
    if (e.duration_hours_delta != null
        && (!Number.isFinite(e.duration_hours_delta) || e.duration_hours_delta < 0 || e.duration_hours_delta > 48)) {
      errors.push({ field: "extras" as any, message: `Add-on ${i + 1} extra time must be between 0 and 48 hours.` });
      return;
    }
    if (e.description && e.description.length > 280) {
      errors.push({ field: "extras" as any, message: `Add-on ${i + 1} description must be 280 characters or less.` });
      return;
    }
  });
  const prep = draft.prep_instructions?.trim() || null;
  if (prep && prep.length > 1000) {
    errors.push({ field: "prep_instructions", message: "Prep instructions must be 1000 characters or less." });
  }
  if (draft.buffer_before_minutes != null && (draft.buffer_before_minutes < 0 || draft.buffer_before_minutes > 240)) {
    errors.push({ field: "buffer_before_minutes", message: "Buffer before must be between 0 and 240 minutes." });
  }
  if (draft.buffer_after_minutes != null && (draft.buffer_after_minutes < 0 || draft.buffer_after_minutes > 240)) {
    errors.push({ field: "buffer_after_minutes", message: "Buffer after must be between 0 and 240 minutes." });
  }
  if (draft.max_concurrent != null && (draft.max_concurrent < 1 || draft.max_concurrent > 50)) {
    errors.push({ field: "max_concurrent", message: "Max concurrent must be between 1 and 50." });
  }
  return errors;
};

// ---- Helpers ----------------------------------------------------------

export const SERVICES_EMPTY_COPY =
  "No services yet. Define your braid styles, knotless options, or signature looks so booking is one tap.";

// ---- Rebook window defaults -------------------------------------------
//
// Sensible per-style default for "weeks until the client is due for a
// refresh". Maps a service name to a typical maintenance window based
// on real braider knowledge — Knotless tends to wear cleanly for 8
// weeks, cornrows 4, retwists 5, etc. Match is case-insensitive +
// substring, so "Knotless Box Braids — Medium" still picks up the
// Knotless default.
//
// Returns null when nothing matches; the editor falls back to a
// generic 6-week suggestion in that case (or the stylist sets it
// manually).
const REBOOK_DEFAULTS: Array<{ pattern: RegExp; weeks: number }> = [
  // Most specific first — longer patterns win when both would match.
  { pattern: /faux\s*locs|goddess\s*locs/i,           weeks: 10 },
  { pattern: /knotless|box\s*braids?/i,               weeks: 8  },
  { pattern: /sew[\s-]*in|weave/i,                    weeks: 8  },
  { pattern: /micro\s*braids?|tribal\s*braids?/i,     weeks: 8  },
  { pattern: /crochet/i,                              weeks: 6  },
  { pattern: /twists?|two[\s-]*strand/i,              weeks: 6  },
  { pattern: /senegalese|passion\s*twists?/i,         weeks: 6  },
  { pattern: /lo[ck]s?\s*(retwist|re[\s-]*twist)/i,   weeks: 5  },
  { pattern: /retwist|re[\s-]*twist/i,                weeks: 5  },
  { pattern: /silk\s*press/i,                         weeks: 4  },
  { pattern: /cornrows?|stitch\s*braids?|fulani/i,    weeks: 4  },
  { pattern: /color|highlight|balayage/i,             weeks: 8  },
  { pattern: /wash\s*(and|&|n)?\s*style|wash\s*day/i, weeks: 3  },
  { pattern: /takedown|take[\s-]*down/i,              weeks: 8  },
];

export const suggestRebookWeeks = (serviceName: string | null | undefined): number | null => {
  const s = (serviceName || "").trim();
  if (!s) return null;
  for (const r of REBOOK_DEFAULTS) {
    if (r.pattern.test(s)) return r.weeks;
  }
  return null;
};

export const formatServicePrice = (
  s: Pick<Service, "base_price" | "duration_hours">,
  currency: string = "USD",
): string => {
  const price = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: s.base_price % 1 === 0 ? 0 : 2,
  }).format(s.base_price);
  return `${price} · ${s.duration_hours}h`;
};

export const activeServices = (
  list: Service[] | null | undefined,
): Service[] => (list || [])
  .filter(s => s.is_active)
  .sort((a, b) => a.name.localeCompare(b.name));

// ---- Supabase data hook -----------------------------------------------

export const useServices = (
  userId: string | null,
): {
  services: Service[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  upsert: (draft: Partial<ServiceInput> & { id?: string }) => Promise<Service | null>;
  remove: (id: string) => Promise<boolean>;
  setActive: (id: string, isActive: boolean) => Promise<boolean>;
} => {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState<boolean>(!!userId);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (!userId) { setServices([]); return; }
    setLoading(true);
    setError(null);
    const supabase = getSupabase();
    const { data, error: err } = await supabase
      .from("services")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setServices((data || []) as Service[]);
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await refresh();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const upsert: ReturnType<typeof useServices>["upsert"] = async (draft) => {
    if (!userId) return null;
    const errs = validateService(draft);
    if (errs.length > 0) {
      setError(errs[0].message);
      return null;
    }
    const supabase = getSupabase();
    const payload: Record<string, any> = {
      user_id: userId,
      name: (draft.name || "").trim(),
      description: draft.description?.trim() || null,
      duration_hours: Number(draft.duration_hours) || 0,
      base_price: Number(draft.base_price) || 0,
      deposit_required: !!draft.deposit_required,
      deposit_amount: draft.deposit_required ? Number(draft.deposit_amount) || 0 : null,
      // Variation snapshot. The legacy { id, name, amount } shape is
      // preserved verbatim; the four optional override fields are
      // round-tripped explicitly so price / duration / deposit
      // overrides actually persist into services.add_ons jsonb.
      // Blank inputs → null (inherit from parent). 0 is treated as
      // an intentional override and saved as 0.
      add_ons: (draft.add_ons || []).map(a => {
        const out: Record<string, any> = {
          id: a.id || `addon_${Math.random().toString(36).slice(2, 8)}`,
          name: (a.name || "").trim(),
          amount: Number(a.amount) || 0,
        };
        // Helper: distinguish "blank (inherit)" from "0 (override
        // with zero)". null/undefined/"" all map to null. Anything
        // numeric — including 0 — round-trips as a number.
        const optNumber = (v: unknown): number | null => {
          if (v === null || v === undefined || v === "") return null;
          const n = typeof v === "number" ? v : Number(v);
          return Number.isFinite(n) ? n : null;
        };
        out.variation_price = optNumber(a.variation_price);
        out.variation_duration_hours = optNumber(a.variation_duration_hours);
        out.variation_deposit_amount = optNumber(a.variation_deposit_amount);
        // deposit_required is a tri-state: true / false / inherit.
        // We persist explicit booleans; missing/undefined inherits.
        out.variation_deposit_required =
          typeof a.variation_deposit_required === "boolean"
            ? a.variation_deposit_required
            : null;
        out.variation_description =
          (a.variation_description || "").trim().slice(0, 280) || null;
        return out;
      }),
      prep_instructions: draft.prep_instructions?.trim() || null,
      is_active: draft.is_active ?? true,
      buffer_before_minutes: Math.max(0, Math.min(240, Math.round(Number(draft.buffer_before_minutes) || 0))),
      buffer_after_minutes: Math.max(0, Math.min(240, Math.round(Number(draft.buffer_after_minutes) || 0))),
      max_concurrent: Math.max(1, Math.min(50, Math.round(Number(draft.max_concurrent) || 1))),
      contract_template_id: draft.contract_template_id || null,
      // Empty string from the editor dropdown means "no category".
      category_id: draft.category_id ? draft.category_id : null,
      featured: !!draft.featured,
      cover_image_url: draft.cover_image_url?.trim() || null,
      before_after_image_url: draft.before_after_image_url?.trim() || null,
      // Style Customization. Default-safe: undefined → schema default
      // (false for hair_included, true for the allow_* + enabled
      // flags) so legacy services keep their existing behavior.
      hair_included: !!draft.hair_included,
      included_hair_description: draft.included_hair_description?.trim() || null,
      allow_client_hair_color_selection: !!draft.allow_client_hair_color_selection,
      allowed_hair_colors: Array.isArray(draft.allowed_hair_colors)
        ? draft.allowed_hair_colors
            .map(c => String(c || "").trim())
            .filter(Boolean)
            .slice(0, 40)
        : [],
      allow_client_curl_pattern_selection: !!draft.allow_client_curl_pattern_selection,
      allowed_curl_patterns: Array.isArray(draft.allowed_curl_patterns)
        ? draft.allowed_curl_patterns
            .map(c => String(c || "").trim())
            .filter(Boolean)
            .slice(0, 40)
        : [],
      allow_style_notes: draft.allow_style_notes ?? true,
      allow_inspiration_photos: draft.allow_inspiration_photos ?? true,
      included_details: draft.included_details?.trim() || null,
      customization_enabled: draft.customization_enabled ?? true,
      // Default materials — array of { inventory_item_id, quantity }.
      // Drop rows missing an id or with a non-positive quantity so the
      // appointment-completion sheet never tries to deduct against a
      // ghost row.
      default_materials: Array.isArray(draft.default_materials)
        ? draft.default_materials
            .map(m => ({
              inventory_item_id: String((m as any)?.inventory_item_id || "").trim(),
              quantity: Number((m as any)?.quantity) || 0,
            }))
            .filter(m => m.inventory_item_id && m.quantity > 0)
        : [],
      // Mobile Services V1. mobile_service gates everything else; the
      // fee model + numeric fields persist regardless so a stylist can
      // toggle off + back on without losing their pricing config.
      mobile_service: !!(draft as any).mobile_service,
      mobile_fee_model: (() => {
        const m = String((draft as any).mobile_fee_model || "flat");
        return ["flat", "per_mile", "hybrid", "tiered"].includes(m) ? m : "flat";
      })(),
      mobile_flat_fee: Math.max(0, Number((draft as any).mobile_flat_fee) || 0),
      mobile_per_mile_fee: Math.max(0, Number((draft as any).mobile_per_mile_fee) || 0),
      mobile_hybrid_free_miles: Math.max(0, Number((draft as any).mobile_hybrid_free_miles) || 0),
      mobile_tiered_bands: Array.isArray((draft as any).mobile_tiered_bands)
        ? ((draft as any).mobile_tiered_bands as any[])
            .map(b => ({
              max_miles: Number(b?.max_miles) || 0,
              fee: Math.max(0, Number(b?.fee) || 0),
            }))
            .filter(b => b.max_miles > 0)
            .sort((a, b) => a.max_miles - b.max_miles)
            .slice(0, 12)
        : [],
      mobile_minimum_price: (() => {
        const v = (draft as any).mobile_minimum_price;
        if (v == null || v === "") return null;
        const n = Number(v);
        return Number.isFinite(n) && n >= 0 ? n : null;
      })(),
      // Marketing rebook window in weeks. Empty / 0 / non-number =>
      // null (no auto-nudge). Clamped to the DB check (1..52).
      rebook_after_weeks: (() => {
        const raw = (draft as any).rebook_after_weeks;
        if (raw == null || raw === "") return null;
        const n = Math.floor(Number(raw));
        if (!Number.isFinite(n) || n <= 0) return null;
        return Math.min(52, n);
      })(),
      // Round-trip the optional add-ons. Keep null/undefined sane and
      // coerce numeric fields so we never persist NaN. Each entry is
      // stored verbatim in services.extras jsonb.
      extras: (draft.extras || []).map(e => ({
        id: e.id || `extra_${Math.random().toString(36).slice(2, 8)}`,
        name: (e.name || "").trim(),
        description: e.description?.trim() || null,
        price: Number.isFinite(e.price) ? Number(e.price) : 0,
        duration_hours_delta: e.duration_hours_delta != null && Number.isFinite(e.duration_hours_delta)
          ? Number(e.duration_hours_delta)
          : 0,
        include_in_deposit: e.include_in_deposit === true,
        active: e.active === false ? false : true,
        sort_order: Number.isFinite(e.sort_order) ? Number(e.sort_order) : 0,
        // Preserve the managed-optional marker (e.g. "acv") so the
        // editor keeps surfacing it as a dedicated toggle on reload.
        kind: e.kind ? String(e.kind) : null,
      })),
    };
    const { data, error: err } = draft.id
      ? await supabase.from("services").update(payload).eq("id", draft.id).eq("user_id", userId).select("*").maybeSingle()
      : await supabase.from("services").insert(payload).select("*").maybeSingle();
    if (err || !data) {
      setError(err?.message || "Could not save the service.");
      return null;
    }
    setError(null);
    await refresh();
    return data as Service;
  };

  const remove: ReturnType<typeof useServices>["remove"] = async (id) => {
    if (!userId) return false;
    const supabase = getSupabase();
    const { error: err } = await supabase
      .from("services")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);
    if (err) { setError(err.message); return false; }
    setServices(prev => prev.filter(s => s.id !== id));
    return true;
  };

  const setActive: ReturnType<typeof useServices>["setActive"] = async (id, isActive) => {
    if (!userId) return false;
    const supabase = getSupabase();
    const { error: err } = await supabase
      .from("services")
      .update({ is_active: isActive })
      .eq("id", id)
      .eq("user_id", userId);
    if (err) { setError(err.message); return false; }
    setServices(prev => prev.map(s => s.id === id ? { ...s, is_active: isActive } : s));
    return true;
  };

  return { services, loading, error, refresh, upsert, remove, setActive };
};

// ---- Public booking page ----------------------------------------------

// Returns the active service catalog for a booking-link slug. Calls
// the security-definer `public_list_services` RPC (Phase B1 migration)
// so anonymous visitors can read services without granting them
// SELECT on the underlying RLS-protected table.
//

export type PublicService = Pick<
  Service,
  | "id"
  | "name"
  | "description"
  | "duration_hours"
  | "base_price"
  | "deposit_required"
  | "deposit_amount"
  | "add_ons"
  | "prep_instructions"
  | "buffer_before_minutes"
  | "buffer_after_minutes"
  | "max_concurrent"
  | "contract_template_id"
  | "category_id"
  | "extras"
  | "featured"
  | "cover_image_url"
  | "before_after_image_url"
  | "hair_included"
  | "included_hair_description"
  | "allow_client_hair_color_selection"
  | "allowed_hair_colors"
  | "allow_client_curl_pattern_selection"
  | "allowed_curl_patterns"
  | "allow_style_notes"
  | "allow_inspiration_photos"
  | "included_details"
  | "customization_enabled"
  | "mobile_service"
  | "mobile_fee_model"
  | "mobile_flat_fee"
  | "mobile_per_mile_fee"
  | "mobile_hybrid_free_miles"
  | "mobile_tiered_bands"
  | "mobile_minimum_price"
>;

export const fetchPublicServices = async (
  slug: string,
): Promise<{ ok: true; services: PublicService[] } | { ok: false; error: string }> => {
  if (!slug) return { ok: false, error: "Missing booking slug." };
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("public_list_services", { slug_in: slug });
  if (error) return { ok: false, error: error.message };
  const services = ((data || []) as any[]).map(s => ({
    id: s.id,
    name: s.name,
    description: s.description,
    duration_hours: Number(s.duration_hours) || 0,
    base_price: Number(s.base_price) || 0,
    deposit_required: !!s.deposit_required,
    deposit_amount: s.deposit_amount == null ? null : Number(s.deposit_amount),
    add_ons: Array.isArray(s.add_ons) ? s.add_ons : [],
    prep_instructions: s.prep_instructions ?? null,
    buffer_before_minutes: Number(s.buffer_before_minutes) || 0,
    buffer_after_minutes: Number(s.buffer_after_minutes) || 0,
    max_concurrent: Number(s.max_concurrent) || 1,
    contract_template_id: s.contract_template_id ?? null,
    category_id: s.category_id ?? null,
    extras: Array.isArray(s.extras) ? s.extras : [],
    featured: !!s.featured,
    cover_image_url: s.cover_image_url ?? null,
    before_after_image_url: s.before_after_image_url ?? null,
    hair_included: !!s.hair_included,
    included_hair_description: s.included_hair_description ?? null,
    allow_client_hair_color_selection: !!s.allow_client_hair_color_selection,
    allowed_hair_colors: Array.isArray(s.allowed_hair_colors) ? s.allowed_hair_colors : [],
    allow_client_curl_pattern_selection: !!s.allow_client_curl_pattern_selection,
    allowed_curl_patterns: Array.isArray(s.allowed_curl_patterns) ? s.allowed_curl_patterns : [],
    allow_style_notes: s.allow_style_notes ?? true,
    allow_inspiration_photos: s.allow_inspiration_photos ?? true,
    included_details: s.included_details ?? null,
    customization_enabled: s.customization_enabled ?? true,
    mobile_service: !!s.mobile_service,
    mobile_fee_model: (["flat", "per_mile", "hybrid", "tiered"].includes(s.mobile_fee_model)
      ? s.mobile_fee_model
      : "flat") as Service["mobile_fee_model"],
    mobile_flat_fee: Number(s.mobile_flat_fee) || 0,
    mobile_per_mile_fee: Number(s.mobile_per_mile_fee) || 0,
    mobile_hybrid_free_miles: Number(s.mobile_hybrid_free_miles) || 0,
    mobile_tiered_bands: Array.isArray(s.mobile_tiered_bands)
      ? (s.mobile_tiered_bands as any[]).map(b => ({
          max_miles: Number(b?.max_miles) || 0,
          fee: Number(b?.fee) || 0,
        }))
      : [],
    mobile_minimum_price: s.mobile_minimum_price == null ? null : Number(s.mobile_minimum_price),
  }));
  return { ok: true, services };
};

// Public-facing category, fetched alongside services so /book/<slug>
// can render category tabs/cards above the service picker.
export type PublicServiceCategory = {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  image_url: string | null;
  sort_order: number;
};

export const fetchPublicServiceCategories = async (
  slug: string,
): Promise<{ ok: true; categories: PublicServiceCategory[] } | { ok: false; error: string }> => {
  if (!slug) return { ok: false, error: "Missing booking slug." };
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("public_list_service_categories", { slug_in: slug });
  if (error) return { ok: false, error: error.message };
  const categories = ((data || []) as any[]).map(c => ({
    id: String(c.id),
    name: String(c.name || ""),
    slug: c.slug ?? null,
    description: c.description ?? null,
    image_url: c.image_url ?? null,
    sort_order: Number(c.sort_order) || 0,
  }));
  return { ok: true, categories };
};

export type PublicSlot = {
  time: string;
  label: string;
  start_minute: number;
};

export type MonthDayStatus = "available" | "limited" | "booked" | "off";

export type MonthDay = {
  day: string;
  slot_count: number;
  status: MonthDayStatus;
};

export const fetchPublicAvailability = async ({
  slug,
  dateIso,
  durationMinutes,
  serviceId,
  slotIntervalMinutes = 30,
}: {
  slug: string;
  dateIso: string;
  durationMinutes?: number | null;
  serviceId?: string | null;
  slotIntervalMinutes?: number | null;
}): Promise<{ ok: true; slots: PublicSlot[] } | { ok: false; error: string }> => {
  if (!slug || !dateIso) return { ok: false, error: "Missing booking details." };
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("public_list_availability", {
    slug_in: slug,
    date_in: dateIso,
    duration_minutes_in: durationMinutes ?? null,
    service_id_in: serviceId || null,
    slot_interval_minutes_in: slotIntervalMinutes ?? 30,
  });
  if (error) return { ok: false, error: error.message };
  const slots = ((data || []) as any[]).map(row => ({
    time: String(row.slot_time || ""),
    label: String(row.slot_label || row.slot_time || ""),
    start_minute: Number(row.start_minute) || 0,
  }));
  return { ok: true, slots };
};

export const fetchPublicMonthAvailability = async ({
  slug,
  year,
  month,
  durationMinutes,
  serviceId,
}: {
  slug: string;
  year: number;
  month: number;
  durationMinutes?: number | null;
  serviceId?: string | null;
}): Promise<{ ok: true; days: MonthDay[] } | { ok: false; error: string }> => {
  if (!slug || !year || !month) return { ok: false, error: "Missing calendar details." };
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("public_get_month_availability", {
    slug_in: slug,
    year_in: year,
    month_in: month,
    service_id_in: serviceId || null,
    duration_minutes_in: durationMinutes ?? null,
  });
  if (error) return { ok: false, error: error.message };
  const days = ((data || []) as any[]).map(row => ({
    day: String(row.day_iso || ""),
    slot_count: Number(row.slot_count) || 0,
    status: (["available", "limited", "booked", "off"].includes(String(row.status))
      ? String(row.status)
      : "off") as MonthDayStatus,
  }));
  return { ok: true, days };
};
