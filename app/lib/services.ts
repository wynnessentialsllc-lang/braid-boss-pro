// Services & Styles V1 — studio catalog.
//
// Mirrors the discounts.ts pattern: types, validation, a Supabase-backed
// hook with CRUD + active toggle. Phase 1 only ships the catalog UI;
// Phase 2 will wire services into the appointment form so picking a
// service prefills duration / price / deposit-required.

import { useEffect, useState } from "react";
import { getSupabase } from "./supabase";

export type ServiceAddOn = {
  id: string;
  name: string;
  amount: number;
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
  prep_instructions: string | null;
  is_active: boolean;
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
  if (!name) errors.push({ field: "name", message: "Name is required." });

  const duration = Number(draft.duration_hours);
  if (!Number.isFinite(duration) || duration <= 0) {
    errors.push({ field: "duration_hours", message: "Duration must be greater than 0 hours." });
  } else if (duration > 48) {
    errors.push({ field: "duration_hours", message: "Duration can't exceed 48 hours." });
  }

  const price = Number(draft.base_price);
  if (!Number.isFinite(price) || price < 0) {
    errors.push({ field: "base_price", message: "Price can't be negative." });
  }

  if (draft.deposit_required) {
    const amt = Number(draft.deposit_amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      errors.push({ field: "deposit_amount", message: "Set the required deposit amount." });
    }
  }

  for (const a of draft.add_ons || []) {
    const aname = (a?.name || "").trim();
    const aamount = Number(a?.amount);
    if (!aname) {
      errors.push({ field: "add_ons", message: "Each add-on needs a name." });
      break;
    }
    if (!Number.isFinite(aamount) || aamount < 0) {
      errors.push({ field: "add_ons", message: "Add-on amounts can't be negative." });
      break;
    }
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
      add_ons: (draft.add_ons || []).map(a => ({
        id: a.id || `addon_${Math.random().toString(36).slice(2, 8)}`,
        name: (a.name || "").trim(),
        amount: Number(a.amount) || 0,
      })),
      prep_instructions: draft.prep_instructions?.trim() || null,
      is_active: draft.is_active ?? true,
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
