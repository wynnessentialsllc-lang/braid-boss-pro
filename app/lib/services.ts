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
  created_at: string;
  updated_at: string;
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
