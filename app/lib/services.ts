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
  // Phase B1 — feed the slot engine when this service is booked:
  // buffer_before / buffer_after pad each booking so prep + takedown
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  max_concurrent: number;
  // Phase Contract Templates — optional contract to attach
  contract_template_id: string | null;
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
      add_ons: (draft.add_ons || []).map(a => ({
        id: a.id || `addon_${Math.random().toString(36).slice(2, 8)}`,
        name: (a.name || "").trim(),
        amount: Number(a.amount) || 0,
      })),
      prep_instructions: draft.prep_instructions?.trim() || null,
      is_active: draft.is_active ?? true,
      buffer_before_minutes: Math.max(0, Math.min(240, Math.round(Number(draft.buffer_before_minutes) || 0))),
      buffer_after_minutes: Math.max(0, Math.min(240, Math.round(Number(draft.buffer_after_minutes) || 0))),
      max_concurrent: Math.max(1, Math.min(50, Math.round(Number(draft.max_concurrent) || 1))),
      contract_template_id: draft.contract_template_id || null,
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
  }));
  return { ok: true, services };
};