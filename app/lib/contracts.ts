// Contract Templates V1 — reusable templates for services.
//
// Mirrors the services.ts pattern: types, validation, a Supabase-backed
// hook with CRUD + active toggle. Phase 1 only ships the catalog UI;
// Phase 2 will wire contracts into the appointment form so services
// can require signing.

import { useEffect, useState } from "react";
import { getSupabase } from "./supabase";

export type ContractTemplate = {
  id: string;
  user_id: string;
  title: string;
  content: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ContractTemplateInput = Pick<
  ContractTemplate,
  "title" | "content" | "is_active"
>;

// ---- Validation -------------------------------------------------------

export type ContractTemplateValidationError = {
  field: keyof ContractTemplateInput | "form";
  message: string;
};

export const validateContractTemplate = (
  draft: Partial<ContractTemplateInput>,
): ContractTemplateValidationError[] => {
  const errors: ContractTemplateValidationError[] = [];
  const title = (draft.title || "").trim();
  if (!title) {
    errors.push({ field: "title", message: "Title is required." });
  }
  const content = (draft.content || "").trim();
  if (!content) {
    errors.push({ field: "content", message: "Content is required." });
  }
  return errors;
};

// ---- Helpers ----------------------------------------------------------

export const CONTRACT_TEMPLATES_EMPTY_COPY =
  "No contract templates yet. Create reusable agreements for your services.";

// ---- Supabase data hook -----------------------------------------------

export const useContractTemplates = (
  userId: string | null,
): {
  contractTemplates: ContractTemplate[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  upsert: (draft: Partial<ContractTemplateInput> & { id?: string }) => Promise<ContractTemplate | null>;
  remove: (id: string) => Promise<boolean>;
  setActive: (id: string, isActive: boolean) => Promise<boolean>;
} => {
  const [contractTemplates, setContractTemplates] = useState<ContractTemplate[]>([]);
  const [loading, setLoading] = useState<boolean>(!!userId);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (!userId) { setContractTemplates([]); return; }
    setLoading(true);
    setError(null);
    const supabase = getSupabase();
    const { data, error: err } = await supabase
      .from("contract_templates")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setContractTemplates((data || []) as ContractTemplate[]);
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

  const upsert: ReturnType<typeof useContractTemplates>["upsert"] = async (draft) => {
    if (!userId) return null;
    const errs = validateContractTemplate(draft);
    if (errs.length > 0) {
      setError(errs[0].message);
      return null;
    }
    const supabase = getSupabase();
    const payload: Record<string, any> = {
      user_id: userId,
      title: (draft.title || "").trim(),
      content: (draft.content || "").trim(),
      is_active: draft.is_active ?? true,
    };
    const { data, error: err } = draft.id
      ? await supabase.from("contract_templates").update(payload).eq("id", draft.id).eq("user_id", userId).select("*").maybeSingle()
      : await supabase.from("contract_templates").insert(payload).select("*").maybeSingle();
    if (err || !data) {
      setError(err?.message || "Could not save the contract template.");
      return null;
    }
    setError(null);
    await refresh();
    return data as ContractTemplate;
  };

  const remove: ReturnType<typeof useContractTemplates>["remove"] = async (id) => {
    if (!userId) return false;
    const supabase = getSupabase();
    const { error: err } = await supabase
      .from("contract_templates")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);
    if (err) { setError(err.message); return false; }
    setContractTemplates(prev => prev.filter(s => s.id !== id));
    return true;
  };

  const setActive: ReturnType<typeof useContractTemplates>["setActive"] = async (id, isActive) => {
    if (!userId) return false;
    const supabase = getSupabase();
    const { error: err } = await supabase
      .from("contract_templates")
      .update({ is_active: isActive })
      .eq("id", id)
      .eq("user_id", userId);
    if (err) { setError(err.message); return false; }
    setContractTemplates(prev => prev.map(s => s.id === id ? { ...s, is_active: isActive } : s));
    return true;
  };

  return { contractTemplates, loading, error, refresh, upsert, remove, setActive };
};

// ---- Public access (none yet) -----------------------------------------

// No public RPCs for contract templates — they're internal only.