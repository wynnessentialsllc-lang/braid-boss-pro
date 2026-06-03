// Digital intake / consultation forms.
//
// One form per stylist (config stored on booking_links.intake_form).
// The public booking page renders the enabled questions before the
// deposit step; answers are written to booking_requests.intake_answers
// and surface in the stylist's client view + the approval email.
//
// Mirrors the waitlist/services lib shape: types + a default question
// set + an owner-side hook + anon helpers for the booking page.

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "./supabase";

export type IntakeQuestionType = "text" | "textarea" | "yes_no" | "choice";

export type IntakeQuestion = {
  id: string;
  label: string;
  type: IntakeQuestionType;
  options?: string[]; // for type "choice"
  enabled: boolean;
};

export type IntakeForm = {
  enabled: boolean;
  questions: IntakeQuestion[];
};

// A captured answer. Label is denormalized so the client view and
// confirmation email never need the form config to display them.
export type IntakeAnswer = {
  q: string;
  a: string;
};

export const INTAKE_TYPE_LABEL: Record<IntakeQuestionType, string> = {
  text: "Short text",
  textarea: "Paragraph",
  yes_no: "Yes / No",
  choice: "Multiple choice",
};

// Standard braider consultation set. Shipped enabled; the stylist can
// toggle individual questions off or add their own.
export const DEFAULT_INTAKE_QUESTIONS: IntakeQuestion[] = [
  { id: "scalp", label: "Do you have any scalp sensitivities or conditions I should know about?", type: "textarea", enabled: true },
  { id: "allergies", label: "Any allergies (hair products, latex, etc.)?", type: "textarea", enabled: true },
  { id: "last-style", label: "When did you last have a protective style, and what was it?", type: "text", enabled: true },
  { id: "treated", label: "Is your hair colored, relaxed, or chemically treated?", type: "yes_no", enabled: true },
  { id: "texture", label: "How would you describe your hair type / texture?", type: "text", enabled: true },
  { id: "tension", label: "What tension do you prefer?", type: "choice", options: ["Tighter", "Medium", "Looser"], enabled: true },
  { id: "meds", label: "Are you taking any medication that affects your hair or scalp?", type: "textarea", enabled: false },
  { id: "goals", label: "What's your goal for this style, or anything else I should know?", type: "textarea", enabled: true },
];

export const DEFAULT_INTAKE_FORM: IntakeForm = {
  enabled: false,
  questions: DEFAULT_INTAKE_QUESTIONS,
};

// Coerce an unknown stored value into a valid IntakeForm, repairing or
// dropping malformed entries so the UI never crashes on bad data.
export const normalizeIntakeForm = (raw: unknown): IntakeForm => {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_INTAKE_FORM };
  const obj = raw as Record<string, unknown>;
  const rawQs = Array.isArray(obj.questions) ? obj.questions : [];
  const questions: IntakeQuestion[] = rawQs
    .map((q): IntakeQuestion | null => {
      if (!q || typeof q !== "object") return null;
      const o = q as Record<string, unknown>;
      const label = String(o.label ?? "").trim();
      if (!label) return null;
      const type: IntakeQuestionType =
        o.type === "textarea" || o.type === "yes_no" || o.type === "choice" ? o.type : "text";
      const options = Array.isArray(o.options)
        ? o.options.map((x) => String(x ?? "").trim()).filter(Boolean)
        : undefined;
      return {
        id: String(o.id ?? `q_${Math.random().toString(36).slice(2, 9)}`),
        label,
        type,
        options: type === "choice" ? (options && options.length ? options : ["Yes", "No"]) : undefined,
        enabled: o.enabled !== false,
      };
    })
    .filter((q): q is IntakeQuestion => q !== null);
  return {
    enabled: obj.enabled === true,
    questions: questions.length ? questions : DEFAULT_INTAKE_QUESTIONS,
  };
};

// Active questions a client actually sees.
export const visibleQuestions = (form: IntakeForm | null): IntakeQuestion[] =>
  form && form.enabled ? form.questions.filter((q) => q.enabled) : [];

// ---- Anon helpers (public booking page) ------------------------------

export const fetchIntakeForm = async (userId: string): Promise<IntakeForm | null> => {
  if (!userId) return null;
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc("public_get_intake_form", { user_id_in: userId });
    if (error || !data || (data as any).ok !== true) return null;
    const form = (data as any).intake_form;
    if (!form) return null;
    return normalizeIntakeForm(form);
  } catch {
    return null;
  }
};

export const attachIntakeAnswers = async (
  requestId: string,
  answers: IntakeAnswer[],
): Promise<boolean> => {
  const clean = (answers || []).filter((x) => x && x.q && String(x.a ?? "").trim());
  if (!requestId || clean.length === 0) return false;
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc("public_attach_intake_answers", {
      request_id_in: requestId,
      answers_in: clean,
    });
    return !error && !!data && (data as any).ok === true;
  } catch {
    return false;
  }
};

// ---- Owner-side hook (Settings → Intake form) ------------------------

export const useIntakeForm = (
  userId: string | null,
): {
  form: IntakeForm;
  loading: boolean;
  error: string | null;
  save: (next: IntakeForm) => Promise<boolean>;
  refresh: () => Promise<void>;
} => {
  const [form, setForm] = useState<IntakeForm>({ ...DEFAULT_INTAKE_FORM });
  const [loading, setLoading] = useState<boolean>(!!userId);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    try {
      const supabase = getSupabase();
      const { data, error: err } = await supabase
        .from("booking_links")
        .select("intake_form")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (err) throw err;
      setForm(data?.intake_form ? normalizeIntakeForm(data.intake_form) : { ...DEFAULT_INTAKE_FORM });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load_failed");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    (async () => { if (!cancelled) await refresh(); })();
    return () => { cancelled = true; };
  }, [refresh]);

  const save = useCallback(
    async (next: IntakeForm): Promise<boolean> => {
      if (!userId) return false;
      const normalized = normalizeIntakeForm(next);
      // Optimistic.
      setForm(normalized);
      try {
        const supabase = getSupabase();
        const { error: err } = await supabase
          .from("booking_links")
          .update({ intake_form: normalized })
          .eq("user_id", userId);
        if (err) throw err;
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "save_failed");
        return false;
      }
    },
    [userId],
  );

  return { form, loading, error, save, refresh };
};
