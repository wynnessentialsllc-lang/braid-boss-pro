// Discounts V1 — fixed amount or percentage off the pre-tip subtotal.
//
// Service-specific discounts (applies_to = 'service') get a column in
// the schema but are not wired into the V1 picker because the app has
// no first-class services table — `appointment.style` is a free-text
// string. Only `applies_to = 'all'` discounts are surfaced today.
//
// All Supabase access goes through the user's own RLS-protected rows.
// `discounts_self_select` etc. enforce isolation server-side.

import { useEffect, useState } from "react";
import { getSupabase } from "./supabase";

export type DiscountType = "fixed" | "percentage";
export type DiscountAppliesTo = "all" | "service";

export type Discount = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  discount_type: DiscountType;
  value: number;
  applies_to: DiscountAppliesTo;
  service_id: string | null;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  usage_limit: number | null;
  times_used: number;
  created_at: string;
  updated_at: string;
};

export type DiscountInput = Pick<
  Discount,
  | "name"
  | "description"
  | "discount_type"
  | "value"
  | "applies_to"
  | "service_id"
  | "is_active"
  | "starts_at"
  | "ends_at"
  | "usage_limit"
>;

// Luxury microcopy presets — the form uses these as suggestion chips.
export const DISCOUNT_PRESETS: ReadonlyArray<{ label: string; description: string }> = [
  { label: "Studio Offer", description: "House-wide promotion" },
  { label: "Loyalty Reward", description: "Returning client thank-you" },
  { label: "Referral Credit", description: "When a client sends a friend" },
  { label: "Preferred Client Pricing", description: "VIP rate for top spenders" },
  { label: "Slow-Day Special", description: "Mid-week or off-peak incentive" },
];

export const DISCOUNTS_EMPTY_COPY =
  "No discounts yet. Create loyalty rewards, referral offers, or slow-day specials for your studio.";

// ---- Validation --------------------------------------------------------

export type DiscountValidationError = {
  field: keyof DiscountInput | "form";
  message: string;
};

export const validateDiscount = (
  draft: Partial<DiscountInput>,
): DiscountValidationError[] => {
  const errors: DiscountValidationError[] = [];
  const name = (draft.name || "").trim();
  if (!name) errors.push({ field: "name", message: "Name is required." });

  const type = draft.discount_type;
  const value = Number(draft.value);
  if (type !== "fixed" && type !== "percentage") {
    errors.push({ field: "discount_type", message: "Pick fixed or percentage." });
  } else if (!Number.isFinite(value) || value <= 0) {
    errors.push({
      field: "value",
      message: type === "fixed"
        ? "Amount must be greater than $0."
        : "Percentage must be greater than 0%.",
    });
  } else if (type === "percentage" && value > 100) {
    errors.push({ field: "value", message: "Percentage cannot exceed 100%." });
  }

  if (draft.applies_to === "service" && !draft.service_id) {
    errors.push({ field: "service_id", message: "Pick the service this applies to." });
  }

  if (draft.starts_at && draft.ends_at) {
    const s = new Date(draft.starts_at).getTime();
    const e = new Date(draft.ends_at).getTime();
    if (Number.isFinite(s) && Number.isFinite(e) && e <= s) {
      errors.push({ field: "ends_at", message: "End date must be after the start date." });
    }
  }

  if (draft.usage_limit != null && (draft.usage_limit as number) <= 0) {
    errors.push({ field: "usage_limit", message: "Usage limit must be at least 1." });
  }

  return errors;
};

// ---- Calculation ------------------------------------------------------

export type DiscountSummary = {
  id: string | null;
  name: string | null;
  amount: number;
};

export const NO_DISCOUNT: DiscountSummary = { id: null, name: null, amount: 0 };

// Compute the dollar amount a given discount removes from `subtotal`.
// Never returns more than the subtotal itself — the calculator wraps
// this with `max(0, subtotal - amount)` to guarantee non-negative
// totals even if the user later edits a discount to a wild value.
export const computeDiscountAmount = (
  subtotal: number,
  discount: Pick<Discount, "discount_type" | "value"> | null | undefined,
): number => {
  if (!discount) return 0;
  const sub = Number(subtotal) || 0;
  if (sub <= 0) return 0;
  const value = Number(discount.value) || 0;
  if (value <= 0) return 0;
  if (discount.discount_type === "percentage") {
    const pct = Math.min(100, Math.max(0, value));
    return Number(((sub * pct) / 100).toFixed(2));
  }
  return Number(Math.min(sub, value).toFixed(2));
};

// Filter to discounts that are usable right now: active, within any
// configured date window, and (if a usage_limit is set) not yet
// exhausted. Sorted by name.
//
// usage_limit enforcement: the app has no single "finalize" event to
// safely increment a stored counter, so usage is DERIVED from how many
// live appointments reference the discount (passed in as a map keyed by
// discount id — see discountUsageFromAppointments). A derived count is
// always accurate: it can't drift or double-count across offline devices,
// and it auto-corrects when an appointment is cancelled. Falls back to
// the stored times_used when no map is supplied.
export const selectableDiscounts = (
  list: Discount[] | null | undefined,
  nowMs: number = Date.now(),
  usageByDiscountId?: Map<string, number> | null,
): Discount[] => {
  const out: Discount[] = [];
  for (const d of list || []) {
    if (!d.is_active) continue;
    // V1 picker only surfaces "applies to all" — the schema reserves
    // service-specific entries for a follow-up release.
    if (d.applies_to !== "all") continue;
    if (d.starts_at && new Date(d.starts_at).getTime() > nowMs) continue;
    if (d.ends_at && new Date(d.ends_at).getTime() <= nowMs) continue;
    if (d.usage_limit != null) {
      const used = Math.max(d.times_used || 0, usageByDiscountId?.get(d.id) ?? 0);
      if (used >= d.usage_limit) continue;
    }
    out.push(d);
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
};

// Derive how many times each discount has been used from the live
// appointment list: one count per non-cancelled appointment that carries
// the discount. Used to enforce usage_limit without a stored counter.
export const discountUsageFromAppointments = (
  appointments: ReadonlyArray<{ discountId?: string | null; status?: string | null }> | null | undefined,
): Map<string, number> => {
  const m = new Map<string, number>();
  for (const a of appointments || []) {
    const id = a?.discountId;
    if (!id) continue;
    const s = String(a?.status || "").toLowerCase();
    if (s === "cancelled" || s === "canceled") continue;
    m.set(id, (m.get(id) ?? 0) + 1);
  }
  return m;
};

// Pretty-print "$25 off" or "10% off".
export const formatDiscountValue = (
  d: Pick<Discount, "discount_type" | "value">,
): string => {
  if (d.discount_type === "percentage") return `${Number(d.value)}% off`;
  return `$${Number(d.value).toFixed(2)} off`;
};

// ---- Supabase data hook ------------------------------------------------

export const useDiscounts = (
  userId: string | null,
): {
  discounts: Discount[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  upsert: (draft: Partial<DiscountInput> & { id?: string }) => Promise<Discount | null>;
  remove: (id: string) => Promise<boolean>;
  setActive: (id: string, isActive: boolean) => Promise<boolean>;
} => {
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [loading, setLoading] = useState<boolean>(!!userId);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (!userId) { setDiscounts([]); return; }
    setLoading(true);
    setError(null);
    const supabase = getSupabase();
    const { data, error: err } = await supabase
      .from("discounts")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setDiscounts((data || []) as Discount[]);
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await refresh();
    })();
    return () => { cancelled = true; };
    // refresh is stable per userId — re-running on every render would
    // thrash the network. Inline closure with userId in deps is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const upsert: ReturnType<typeof useDiscounts>["upsert"] = async (draft) => {
    if (!userId) return null;
    const errs = validateDiscount(draft);
    if (errs.length > 0) {
      setError(errs[0].message);
      return null;
    }
    const supabase = getSupabase();
    const payload: Record<string, any> = {
      user_id: userId,
      name: (draft.name || "").trim(),
      description: draft.description?.trim() || null,
      discount_type: draft.discount_type,
      value: Number(draft.value),
      applies_to: draft.applies_to || "all",
      service_id: draft.applies_to === "service" ? draft.service_id : null,
      is_active: draft.is_active ?? true,
      starts_at: draft.starts_at || null,
      ends_at: draft.ends_at || null,
      usage_limit: draft.usage_limit ?? null,
    };
    const { data, error: err } = draft.id
      ? await supabase.from("discounts").update(payload).eq("id", draft.id).eq("user_id", userId).select("*").maybeSingle()
      : await supabase.from("discounts").insert(payload).select("*").maybeSingle();
    if (err || !data) {
      setError(err?.message || "Could not save the discount.");
      return null;
    }
    setError(null);
    await refresh();
    return data as Discount;
  };

  const remove: ReturnType<typeof useDiscounts>["remove"] = async (id) => {
    if (!userId) return false;
    const supabase = getSupabase();
    const { error: err } = await supabase
      .from("discounts")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);
    if (err) { setError(err.message); return false; }
    setDiscounts(prev => prev.filter(d => d.id !== id));
    return true;
  };

  const setActive: ReturnType<typeof useDiscounts>["setActive"] = async (id, isActive) => {
    if (!userId) return false;
    const supabase = getSupabase();
    const { error: err } = await supabase
      .from("discounts")
      .update({ is_active: isActive })
      .eq("id", id)
      .eq("user_id", userId);
    if (err) { setError(err.message); return false; }
    setDiscounts(prev => prev.map(d => d.id === id ? { ...d, is_active: isActive } : d));
    return true;
  };

  return { discounts, loading, error, refresh, upsert, remove, setActive };
};

// TODO: when a quote/appointment finalisation flow exists, increment
// `times_used` here. Today there is no single "finalize" event in the
// app, so we leave the column at its default and revisit when invoices
// or completed-appointment flows land. Do not fake usage counts.
