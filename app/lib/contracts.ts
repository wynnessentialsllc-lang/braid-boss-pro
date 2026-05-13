// Contract Templates — reusable agreements and generated signing records.

import { useEffect, useState } from "react";
import { getSupabase } from "./supabase";

export type ContractTemplateType =
  | "booking_agreement"
  | "deposit_agreement"
  | "cancellation_policy"
  | "no_show_policy"
  | "hair_prep_agreement"
  | "photo_video_consent"
  | "liability_waiver"
  | "consultation_agreement"
  | "custom";

export type ContractTemplate = {
  id: string;
  user_id: string;
  title: string;
  template_type: ContractTemplateType;
  body: string;
  is_active: boolean;
  require_signature: boolean;
  require_initials: boolean;
  attach_to_all_bookings: boolean;
  created_at: string;
  updated_at: string;
};

export type ContractTemplateInput = Pick<
  ContractTemplate,
  | "title"
  | "template_type"
  | "body"
  | "is_active"
  | "require_signature"
  | "require_initials"
  | "attach_to_all_bookings"
>;

export type ContractStatus = "pending" | "viewed" | "signed" | "declined" | "expired" | "void";

export type BookingContract = {
  id: string;
  user_id: string;
  client_id: string | null;
  booking_request_id: string;
  contract_template_id: string | null;
  title: string;
  body_snapshot: string;
  client_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  public_token: string;
  status: ContractStatus;
  viewed_at: string | null;
  signed_at: string | null;
  declined_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

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
  const body = (draft.body || "").trim();
  if (!body) {
    errors.push({ field: "body", message: "Body is required." });
  }
  return errors;
};

// ---- Helpers ----------------------------------------------------------

export const CONTRACT_TEMPLATES_EMPTY_COPY =
  "No contract templates yet. Create reusable agreements for your services.";

export const TEMPLATE_TYPE_LABEL: Record<ContractTemplateType, string> = {
  booking_agreement: "Booking agreement",
  deposit_agreement: "Deposit agreement",
  cancellation_policy: "Cancellation policy",
  no_show_policy: "No-show policy",
  hair_prep_agreement: "Hair prep agreement",
  photo_video_consent: "Photo/video consent",
  liability_waiver: "Liability waiver",
  consultation_agreement: "Consultation agreement",
  custom: "Custom",
};

export const STATUS_LABEL: Record<ContractStatus, string> = {
  pending: "Pending",
  viewed: "Viewed",
  signed: "Signed",
  declined: "Declined",
  expired: "Expired",
  void: "Void",
};

export const STATUS_TONE: Record<ContractStatus, "gold" | "success" | "danger" | "neutral" | "warning"> = {
  pending: "gold",
  viewed: "warning",
  signed: "success",
  declined: "danger",
  expired: "neutral",
  void: "neutral",
};

const STARTER_TEMPLATES: ContractTemplateInput[] = [
  {
    title: "Booking Confirmation Agreement",
    template_type: "booking_agreement",
    body: "I confirm the appointment details, service selection, arrival expectations, and salon policies shared for this booking.",
    is_active: true,
    require_signature: true,
    require_initials: false,
    attach_to_all_bookings: true,
  },
  {
    title: "Deposit Agreement",
    template_type: "deposit_agreement",
    body: "I understand deposits secure the appointment time and may be non-refundable or transferable only under the stylist's stated policy.",
    is_active: true,
    require_signature: true,
    require_initials: false,
    attach_to_all_bookings: false,
  },
  {
    title: "Hair Prep Agreement",
    template_type: "hair_prep_agreement",
    body: "I agree to arrive with hair prepared according to the service instructions unless the stylist has confirmed otherwise.",
    is_active: true,
    require_signature: true,
    require_initials: true,
    attach_to_all_bookings: false,
  },
];

// ---- Supabase data hook -----------------------------------------------

export const useContractTemplates = (
  userId: string | null,
): {
  templates: ContractTemplate[];
  contractTemplates: ContractTemplate[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  upsert: (draft: Partial<ContractTemplateInput> & { id?: string }) => Promise<ContractTemplate | null>;
  remove: (id: string) => Promise<boolean>;
  setActive: (id: string, isActive: boolean) => Promise<boolean>;
  seedStarters: () => Promise<number>;
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
      template_type: draft.template_type || "custom",
      body: (draft.body || "").trim(),
      is_active: draft.is_active ?? true,
      require_signature: draft.require_signature ?? true,
      require_initials: draft.require_initials ?? false,
      attach_to_all_bookings: draft.attach_to_all_bookings ?? false,
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

  const seedStarters: ReturnType<typeof useContractTemplates>["seedStarters"] = async () => {
    if (!userId) return 0;
    await refresh();
    let added = 0;
    const existingTitles = new Set(contractTemplates.map(t => t.title.trim().toLowerCase()));
    for (const starter of STARTER_TEMPLATES) {
      if (existingTitles.has(starter.title.trim().toLowerCase())) continue;
      const saved = await upsert(starter);
      if (saved) {
        added += 1;
        existingTitles.add(starter.title.trim().toLowerCase());
      }
    }
    return added;
  };

  return { templates: contractTemplates, contractTemplates, loading, error, refresh, upsert, remove, setActive, seedStarters };
};

// ---- Generated booking contracts --------------------------------------

export const contractSigningUrl = (token: string): string => {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/contract/${token}`;
};

export const useContractsForRequest = (
  userId: string | null,
  bookingRequestId: string | null,
): {
  contracts: BookingContract[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  generate: () => Promise<number>;
} => {
  const [contracts, setContracts] = useState<BookingContract[]>([]);
  const [loading, setLoading] = useState<boolean>(!!userId && !!bookingRequestId);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (!userId || !bookingRequestId) { setContracts([]); return; }
    setLoading(true);
    setError(null);
    const supabase = getSupabase();
    const { data, error: err } = await supabase
      .from("booking_contracts")
      .select("*")
      .eq("user_id", userId)
      .eq("booking_request_id", bookingRequestId)
      .order("created_at", { ascending: true });
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setContracts((data || []) as BookingContract[]);
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
  }, [userId, bookingRequestId]);

  const generate = async () => {
    if (!userId || !bookingRequestId) return 0;
    const supabase = getSupabase();
    const { data, error: err } = await supabase.rpc("generate_booking_contracts", {
      booking_request_id_in: bookingRequestId,
    });
    if (err) {
      setError(err.message);
      return 0;
    }
    await refresh();
    return Number(data) || 0;
  };

  return { contracts, loading, error, refresh, generate };
};
