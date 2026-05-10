// Availability — recurring weekly hours + one-time exceptions.
//
// Two tables back this module:
//   availability_rules      — one canonical row per weekday
//   availability_exceptions — one-off off / custom-hours / blocked-time
//
// computeDayAvailability(date) merges them into a single per-day
// answer the calendar can consume: { open, windows, label, kind }.

import { useEffect, useState } from "react";
import { getSupabase } from "./supabase";

export type AvailabilityRule = {
  id: string;
  user_id: string;
  weekday: number;        // 0 = Sunday … 6 = Saturday
  start_time: string;     // "HH:mm"
  end_time: string;       // "HH:mm"
  break_start: string | null;
  break_end: string | null;
  is_open: boolean;
  created_at?: string;
  updated_at?: string;
};

export type AvailabilityRuleInput = Pick<
  AvailabilityRule,
  "weekday" | "start_time" | "end_time" | "break_start" | "break_end" | "is_open"
>;

export type AvailabilityExceptionKind = "off" | "custom" | "blocked";

export type AvailabilityException = {
  id: string;
  user_id: string;
  kind: AvailabilityExceptionKind;
  start_date: string;     // "YYYY-MM-DD"
  end_date: string;       // "YYYY-MM-DD"
  start_time: string | null; // "HH:mm" — required for custom + blocked
  end_time: string | null;   // "HH:mm"
  note: string | null;
  created_at?: string;
  updated_at?: string;
};

export type AvailabilityExceptionInput = Omit<
  AvailabilityException,
  "id" | "user_id" | "created_at" | "updated_at"
>;

// Default weekly schedule the editor seeds when a user has nothing
// configured yet. Tue–Sat 9–6 with a 12:30–1:30 break is a calm
// braider-friendly default.
export const DEFAULT_WEEKLY_RULES: AvailabilityRuleInput[] = [
  { weekday: 0, start_time: "10:00", end_time: "16:00", break_start: null, break_end: null, is_open: false },
  { weekday: 1, start_time: "10:00", end_time: "16:00", break_start: null, break_end: null, is_open: false },
  { weekday: 2, start_time: "09:00", end_time: "18:00", break_start: "12:30", break_end: "13:30", is_open: true },
  { weekday: 3, start_time: "09:00", end_time: "18:00", break_start: "12:30", break_end: "13:30", is_open: true },
  { weekday: 4, start_time: "09:00", end_time: "18:00", break_start: "12:30", break_end: "13:30", is_open: true },
  { weekday: 5, start_time: "09:00", end_time: "18:00", break_start: "12:30", break_end: "13:30", is_open: true },
  { weekday: 6, start_time: "09:00", end_time: "16:00", break_start: null, break_end: null, is_open: true },
];

// ---- Combined hook ----------------------------------------------------

export const useAvailability = (
  userId: string | null,
): {
  rules: AvailabilityRule[];
  exceptions: AvailabilityException[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  upsertRule: (draft: AvailabilityRuleInput) => Promise<AvailabilityRule | null>;
  seedDefaults: () => Promise<void>;
  upsertException: (draft: AvailabilityExceptionInput & { id?: string }) => Promise<AvailabilityException | null>;
  removeException: (id: string) => Promise<boolean>;
} => {
  const [rules, setRules] = useState<AvailabilityRule[]>([]);
  const [exceptions, setExceptions] = useState<AvailabilityException[]>([]);
  const [loading, setLoading] = useState<boolean>(!!userId);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (!userId) { setRules([]); setExceptions([]); return; }
    setLoading(true);
    setError(null);
    const supabase = getSupabase();
    const [rulesRes, excRes] = await Promise.all([
      supabase.from("availability_rules").select("*").eq("user_id", userId).order("weekday", { ascending: true }),
      supabase.from("availability_exceptions").select("*").eq("user_id", userId).order("start_date", { ascending: false }),
    ]);
    if (rulesRes.error) { setError(rulesRes.error.message); setLoading(false); return; }
    if (excRes.error)   { setError(excRes.error.message);   setLoading(false); return; }
    setRules((rulesRes.data || []) as AvailabilityRule[]);
    setExceptions((excRes.data || []) as AvailabilityException[]);
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => { if (!cancelled) await refresh(); })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const upsertRule: ReturnType<typeof useAvailability>["upsertRule"] = async (draft) => {
    if (!userId) return null;
    const supabase = getSupabase();
    const payload = {
      user_id: userId,
      weekday: draft.weekday,
      start_time: draft.start_time,
      end_time: draft.end_time,
      break_start: draft.break_start || null,
      break_end: draft.break_end || null,
      is_open: !!draft.is_open,
    };
    const { data, error: err } = await supabase
      .from("availability_rules")
      .upsert(payload, { onConflict: "user_id,weekday" })
      .select("*")
      .maybeSingle();
    if (err || !data) {
      setError(err?.message || "Could not save the schedule.");
      return null;
    }
    setError(null);
    await refresh();
    return data as AvailabilityRule;
  };

  const seedDefaults: ReturnType<typeof useAvailability>["seedDefaults"] = async () => {
    if (!userId) return;
    const supabase = getSupabase();
    const payload = DEFAULT_WEEKLY_RULES.map(r => ({ ...r, user_id: userId }));
    const { error: err } = await supabase
      .from("availability_rules")
      .upsert(payload, { onConflict: "user_id,weekday" });
    if (err) { setError(err.message); return; }
    await refresh();
  };

  const upsertException: ReturnType<typeof useAvailability>["upsertException"] = async (draft) => {
    if (!userId) return null;
    if (draft.start_date > draft.end_date) {
      setError("End date must be on or after the start date.");
      return null;
    }
    if ((draft.kind === "custom" || draft.kind === "blocked") && (!draft.start_time || !draft.end_time)) {
      setError("Please set a start and end time.");
      return null;
    }
    const supabase = getSupabase();
    const payload = {
      ...(draft.id ? { id: draft.id } : {}),
      user_id: userId,
      kind: draft.kind,
      start_date: draft.start_date,
      end_date: draft.end_date,
      start_time: draft.start_time || null,
      end_time: draft.end_time || null,
      note: (draft.note || "").trim() || null,
    };
    const { data, error: err } = draft.id
      ? await supabase.from("availability_exceptions").update(payload).eq("id", draft.id).eq("user_id", userId).select("*").maybeSingle()
      : await supabase.from("availability_exceptions").insert(payload).select("*").maybeSingle();
    if (err || !data) {
      setError(err?.message || "Could not save the exception.");
      return null;
    }
    setError(null);
    await refresh();
    return data as AvailabilityException;
  };

  const removeException: ReturnType<typeof useAvailability>["removeException"] = async (id) => {
    if (!userId) return false;
    const supabase = getSupabase();
    const { error: err } = await supabase
      .from("availability_exceptions")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);
    if (err) { setError(err.message); return false; }
    setExceptions(prev => prev.filter(e => e.id !== id));
    return true;
  };

  return { rules, exceptions, loading, error, refresh, upsertRule, seedDefaults, upsertException, removeException };
};

// ---- Per-day computation ----------------------------------------------

export type DayAvailability = {
  // The calendar reads these:
  open: boolean;             // false → render strip as "Off"
  windows: { start: string; end: string }[];  // open windows in HH:mm
  blocks: { start: string; end: string; note: string | null }[]; // explicit "blocked" exceptions
  // Surfaced in the all-day strip:
  label: string;             // human label fragment ("Off · Studio closed")
  kind: "off" | "open" | "custom" | "limited";
};

const dayOfWeek = (iso: string): number => new Date(iso + "T00:00:00").getDay();

const inDateRange = (target: string, start: string, end: string): boolean =>
  start <= target && target <= end;

export const computeDayAvailability = (
  iso: string,
  rules: AvailabilityRule[],
  exceptions: AvailabilityException[],
): DayAvailability => {
  const todaysExceptions = exceptions.filter(e => inDateRange(iso, e.start_date, e.end_date));
  // 1. Hard "off" override beats everything.
  const offHit = todaysExceptions.find(e => e.kind === "off");
  if (offHit) {
    return {
      open: false,
      windows: [],
      blocks: [],
      label: offHit.note ? `Off · ${offHit.note}` : "Off",
      kind: "off",
    };
  }
  // 2. Weekly rule for the day. If no rule exists at all, default
  //    to "open" with a generous window so an un-configured studio
  //    doesn't appear closed.
  const rule = rules.find(r => r.weekday === dayOfWeek(iso));
  if (rule && !rule.is_open) {
    return {
      open: false,
      windows: [],
      blocks: [],
      label: "Off · Day closed",
      kind: "off",
    };
  }
  const baseStart = rule?.start_time || "09:00";
  const baseEnd = rule?.end_time || "18:00";
  const breakStart = rule?.break_start || null;
  const breakEnd = rule?.break_end || null;

  // 3. Custom-hours exception overrides the weekly window.
  const customHit = todaysExceptions.find(e => e.kind === "custom");
  let windows: { start: string; end: string }[];
  if (customHit && customHit.start_time && customHit.end_time) {
    windows = [{ start: customHit.start_time, end: customHit.end_time }];
  } else if (breakStart && breakEnd && breakStart < breakEnd && baseStart < breakStart && breakEnd < baseEnd) {
    windows = [
      { start: baseStart, end: breakStart },
      { start: breakEnd, end: baseEnd },
    ];
  } else {
    windows = [{ start: baseStart, end: baseEnd }];
  }

  // 4. Collect "blocked" exceptions for the day.
  const blocks = todaysExceptions
    .filter(e => e.kind === "blocked" && e.start_time && e.end_time)
    .map(e => ({
      start: e.start_time as string,
      end: e.end_time as string,
      note: e.note,
    }));

  if (customHit) {
    return {
      open: true,
      windows,
      blocks,
      label: customHit.note ? `Custom hours · ${customHit.note}` : "Custom hours",
      kind: "custom",
    };
  }
  if (blocks.length > 0) {
    return {
      open: true,
      windows,
      blocks,
      label: blocks[0].note ? `Limited · ${blocks[0].note}` : "Limited availability",
      kind: "limited",
    };
  }
  return {
    open: true,
    windows,
    blocks,
    label: "Open",
    kind: "open",
  };
};

// Convenience: total open minutes for the day, used by computeDayStatus
// to pick "Fully booked" vs "Openings available".
export const dayCapacityMinutes = (avail: DayAvailability): number => {
  if (!avail.open) return 0;
  let total = 0;
  for (const w of avail.windows) {
    total += minutesBetween(w.start, w.end);
  }
  for (const b of avail.blocks) {
    total -= minutesBetween(b.start, b.end);
  }
  return Math.max(0, total);
};

const minutesBetween = (start: string, end: string): number => {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
};

export const WEEKDAY_LABELS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
] as const;
export const WEEKDAY_SHORT = ["S", "M", "T", "W", "T", "F", "S"] as const;
