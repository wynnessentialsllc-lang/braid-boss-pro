// Contract templates + booking contracts — Phase B12.
//
// Owner-side hook for managing contract templates, plus typed
// helpers for the booking request → contract lifecycle. The public
// signing surface lives in app/contract/[token]/page.tsx and reads
// via the security-definer RPCs `get_public_contract_by_token` /
// `sign_public_contract` / `decline_public_contract`.

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "./supabase";

// ---- Types -----------------------------------------------------------

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

export type ContractStatus =
  | "pending"
  | "viewed"
  | "signed"
  | "declined"
  | "expired"
  | "voided";

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

export type BookingContract = {
  id: string;
  user_id: string;
  client_id: string | null;
  booking_request_id: string | null;
  appointment_id: string | null;
  contract_template_id: string | null;
  title: string;
  body_snapshot: string;
  status: ContractStatus;
  client_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  signed_name: string | null;
  signature_text: string | null;
  initials: string | null;
  signed_at: string | null;
  viewed_at: string | null;
  declined_at: string | null;
  expires_at: string | null;
  ip_address: string | null;
  user_agent: string | null;
  public_token: string;
  created_at: string;
  updated_at: string;
};

export const TEMPLATE_TYPE_LABEL: Record<ContractTemplateType, string> = {
  booking_agreement:      "Booking agreement",
  deposit_agreement:      "Deposit agreement",
  cancellation_policy:    "Cancellation policy",
  no_show_policy:         "No-show policy",
  hair_prep_agreement:    "Hair prep agreement",
  photo_video_consent:    "Photo / video consent",
  liability_waiver:       "Liability waiver",
  consultation_agreement: "Consultation agreement",
  custom:                 "Custom",
};

export const STATUS_LABEL: Record<ContractStatus, string> = {
  pending:  "Sent",
  viewed:   "Viewed",
  signed:   "Signed",
  declined: "Declined",
  expired:  "Expired",
  voided:   "Voided",
};

export const STATUS_TONE: Record<ContractStatus, "neutral" | "gold" | "success" | "warning" | "danger"> = {
  pending:  "neutral",
  viewed:   "gold",
  signed:   "success",
  declined: "danger",
  expired:  "warning",
  voided:   "neutral",
};

// ---- Public sign URL helper ------------------------------------------

const APP_PUBLIC_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.NEXT_PUBLIC_APP_PUBLIC_URL ||
  ""
).replace(/\/$/, "");

export const contractSigningUrl = (token: string): string => {
  if (!token) return "";
  if (typeof window !== "undefined" && !APP_PUBLIC_URL) {
    return `${window.location.origin}/contract/${encodeURIComponent(token)}`;
  }
  return `${APP_PUBLIC_URL}/contract/${encodeURIComponent(token)}`;
};

// ---- Starter templates -----------------------------------------------
//
// Tap "Add starter templates" in Settings → Contracts → seeds these
// rows for the signed-in stylist. Editable like any other template.

export const STARTER_TEMPLATES: ContractTemplateInput[] = [
  {
    title: "Booking confirmation agreement",
    template_type: "booking_agreement",
    is_active: true,
    require_signature: true,
    require_initials: false,
    attach_to_all_bookings: true,
    body:
`By submitting this booking, I confirm:

• My name, contact details, service, and appointment time are accurate.
• I have reviewed the studio's policies and prep instructions.
• I understand that my appointment is held only after the deposit is paid and the stylist confirms.
• I agree to communicate any changes at least 48 hours in advance.

I am the named client booking this appointment and authorize Braid Boss Pro to text and email me about this booking.`,
  },
  {
    title: "Deposit agreement",
    template_type: "deposit_agreement",
    is_active: true,
    require_signature: true,
    require_initials: false,
    attach_to_all_bookings: false,
    body:
`I understand and agree:

• A non-refundable deposit is required to confirm every appointment.
• The deposit is applied to the final total at checkout.
• If I cancel within the studio's cancellation window, my deposit is forfeited.
• If I no-show, my deposit is forfeited and future bookings may require full prepayment.

By signing, I authorize the listed deposit amount to be charged.`,
  },
  {
    title: "Cancellation + no-show policy",
    template_type: "cancellation_policy",
    is_active: true,
    require_signature: true,
    require_initials: false,
    attach_to_all_bookings: false,
    body:
`Cancellation:
• 48+ hours notice → deposit credited toward a future booking.
• 24–48 hours notice → deposit forfeited; rebooking allowed.
• Less than 24 hours → deposit forfeited; future bookings may require prepayment.

No-show:
• Failing to arrive within 15 minutes of the start time without communication is a no-show.
• No-shows forfeit the full deposit and may be required to prepay future appointments in full.

I have read and understand this policy.`,
  },
  {
    title: "Hair prep agreement",
    template_type: "hair_prep_agreement",
    is_active: true,
    require_signature: true,
    require_initials: false,
    attach_to_all_bookings: false,
    body:
`To protect the integrity of my hair and the timing of my appointment, I agree to:

• Arrive with hair freshly washed, blow-dried straight, and detangled.
• Bring the agreed-on add-ons or hair product if I'm providing my own.
• Inform the stylist of any sensitivities, prior chemical treatments, or recent hair damage.

I understand that arriving without proper prep may shorten my service time at the stylist's discretion or result in rescheduling.`,
  },
  {
    title: "Photo / video consent",
    template_type: "photo_video_consent",
    is_active: true,
    require_signature: true,
    require_initials: false,
    attach_to_all_bookings: false,
    body:
`I grant permission for the stylist to capture and use photos and short videos of my completed style for portfolio, social media, and marketing purposes.

• My name will not be published without separate consent.
• I may withdraw consent in writing for future bookings; previously published media is not affected.

I understand I can decline this consent without affecting my booking.`,
  },
  {
    title: "Liability + scalp sensitivity waiver",
    template_type: "liability_waiver",
    is_active: true,
    require_signature: true,
    require_initials: true,
    attach_to_all_bookings: false,
    body:
`I acknowledge:

• Braiding involves tension on the scalp; some discomfort during and immediately after the appointment is normal.
• Excessive tightness, prolonged headache, or any abnormal reaction must be reported to the stylist immediately so adjustments can be made.
• I have disclosed any scalp conditions, allergies, or medications that may affect the service.
• The stylist is not responsible for reactions, breakage, or damage caused by undisclosed conditions or product sensitivities.

By signing and providing initials, I release the stylist from liability for outcomes outside their reasonable control.`,
  },
  {
    title: "Consultation agreement",
    template_type: "consultation_agreement",
    is_active: true,
    require_signature: true,
    require_initials: false,
    attach_to_all_bookings: false,
    body:
`This consultation is intended to align expectations on style, length, color, hair type, and timing before the main booking.

I understand:
• Consultation outcomes are recommendations and the final style may be adjusted on the day of service if hair or scalp conditions require it.
• Quotes provided during consultation are estimates and may change if the actual scope differs.

I agree to follow the prep instructions provided after this consultation.`,
  },
];

// ---- Owner hook ------------------------------------------------------

export const useContractTemplates = (userId: string | null): {
  templates: ContractTemplate[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  upsert: (draft: Partial<ContractTemplateInput> & { id?: string }) => Promise<ContractTemplate | null>;
  remove: (id: string) => Promise<boolean>;
  setActive: (id: string, isActive: boolean) => Promise<boolean>;
  seedStarters: () => Promise<number>;
} => {
  const [templates, setTemplates] = useState<ContractTemplate[]>([]);
  const [loading, setLoading] = useState<boolean>(!!userId);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) { setTemplates([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    const supabase = getSupabase();
    const { data, error: err } = await supabase
      .from("contract_templates")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (err) { setError(err.message); setLoading(false); return; }
    setTemplates((data || []) as ContractTemplate[]);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    (async () => { if (!cancelled) await refresh(); })();
    return () => { cancelled = true; };
  }, [refresh]);

  const upsert: ReturnType<typeof useContractTemplates>["upsert"] = async (draft) => {
    if (!userId) return null;
    const payload: Record<string, any> = {
      user_id: userId,
      title: (draft.title || "").trim(),
      template_type: draft.template_type || "booking_agreement",
      body: (draft.body || "").trim(),
      is_active: draft.is_active ?? true,
      require_signature: draft.require_signature ?? true,
      require_initials: draft.require_initials ?? false,
      attach_to_all_bookings: draft.attach_to_all_bookings ?? false,
    };
    if (!payload.title) { setError("Title is required."); return null; }
    if (!payload.body)  { setError("Agreement body can't be empty."); return null; }
    const supabase = getSupabase();
    const { data, error: err } = draft.id
      ? await supabase.from("contract_templates").update(payload).eq("id", draft.id).eq("user_id", userId).select("*").maybeSingle()
      : await supabase.from("contract_templates").insert(payload).select("*").maybeSingle();
    if (err || !data) { setError(err?.message || "Couldn't save the template."); return null; }
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
    setTemplates(prev => prev.filter(t => t.id !== id));
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
    setTemplates(prev => prev.map(t => t.id === id ? { ...t, is_active: isActive } : t));
    return true;
  };

  const seedStarters: ReturnType<typeof useContractTemplates>["seedStarters"] = async () => {
    if (!userId) return 0;
    const supabase = getSupabase();
    // Skip starters whose title already exists for this user — keeps
    // the button safely re-runnable.
    const existingTitles = new Set(templates.map(t => t.title.toLowerCase()));
    const toInsert = STARTER_TEMPLATES
      .filter(s => !existingTitles.has(s.title.toLowerCase()))
      .map(s => ({ ...s, user_id: userId }));
    if (toInsert.length === 0) return 0;
    const { data, error: err } = await supabase
      .from("contract_templates")
      .insert(toInsert)
      .select("*");
    if (err) { setError(err.message); return 0; }
    await refresh();
    return (data?.length || 0);
  };

  return { templates, loading, error, refresh, upsert, remove, setActive, seedStarters };
};

// ---- Booking-side hook -----------------------------------------------
//
// Reads contracts attached to a specific booking_request so the
// Approvals queue can show "X agreements pending / signed" + share
// signing links inline.

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
  const [loading, setLoading] = useState<boolean>(!!(userId && bookingRequestId));
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!userId || !bookingRequestId) { setContracts([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    const supabase = getSupabase();
    const { data, error: err } = await supabase
      .from("booking_contracts")
      .select("*")
      .eq("user_id", userId)
      .eq("booking_request_id", bookingRequestId)
      .order("created_at", { ascending: true });
    if (err) { setError(err.message); setLoading(false); return; }
    setContracts((data || []) as BookingContract[]);
    setLoading(false);
  }, [userId, bookingRequestId]);

  useEffect(() => {
    let cancelled = false;
    (async () => { if (!cancelled) await refresh(); })();
    return () => { cancelled = true; };
  }, [refresh]);

  const generate: ReturnType<typeof useContractsForRequest>["generate"] = async () => {
    if (!bookingRequestId) return 0;
    const supabase = getSupabase();
    const { data, error: err } = await supabase.rpc("generate_booking_contracts", {
      booking_request_id_in: bookingRequestId,
    });
    if (err) { setError(err.message); return 0; }
    await refresh();
    return Number(data) || 0;
  };

  return { contracts, loading, error, refresh, generate };
};
