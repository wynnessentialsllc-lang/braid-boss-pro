// Client packages (prepaid bundles) — owner-side API.
//
// Templates are reusable definitions; issuing a template (or a one-off)
// creates a client_package instance tied to a client. Packages are
// either a count of visits or a prepaid dollar balance, drawn down via
// the idempotent redeem_package RPC. Mirrors the waitlist/discounts
// hook shape.

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabase } from "./supabase";

export type PackageKind = "visits" | "credit";
export type PackageStatus = "active" | "depleted" | "void";
// A template either sells once ('one_time' — a prepaid package) or bills
// on a schedule ('recurring' — a membership). Recurring templates grant
// their visits/credit value every `billing_interval`.
export type BillingMode = "one_time" | "recurring";
export type BillingInterval = "week" | "month" | "year";
export type MembershipStatus = "incomplete" | "active" | "past_due" | "canceled";

export type PackageTemplate = {
  id: string;
  name: string;
  kind: PackageKind;
  visits: number | null;
  credit_amount: number | null;
  price: number;
  service_label: string | null;
  active: boolean;
  sort: number;
  billing_mode: BillingMode;
  billing_interval: BillingInterval | null;
};

// An issued membership: a Stripe subscription on the stylist's connected
// account that tops up a single rolling client_package each paid cycle.
export type ClientMembership = {
  id: string;
  client_id: string | null;
  client_name: string | null;
  template_id: string | null;
  name: string;
  kind: PackageKind;
  per_cycle_visits: number | null;
  per_cycle_credit: number | null;
  price: number;
  billing_interval: BillingInterval;
  package_id: string | null;
  status: MembershipStatus;
  current_period_end: string | null;
  purchaser_name: string | null;
  purchaser_email: string | null;
  started_at: string | null;
  canceled_at: string | null;
  created_at: string;
};

export type ClientPackage = {
  id: string;
  client_id: string | null;
  client_name: string | null;
  template_id: string | null;
  name: string;
  kind: PackageKind;
  total_visits: number | null;
  remaining_visits: number | null;
  initial_amount: number | null;
  balance: number | null;
  price: number;
  service_label: string | null;
  status: PackageStatus;
  source: "manual" | "online";
  purchaser_name: string | null;
  purchaser_email: string | null;
  notes: string | null;
  purchased_at: string;
  // Set when this package is the rolling balance fed by a membership;
  // such packages are shown under the membership, not as a standalone sale.
  membership_id: string | null;
};

export type TemplateDraft = {
  id?: string;
  name: string;
  kind: PackageKind;
  visits?: number | null;
  credit_amount?: number | null;
  price: number;
  service_label?: string | null;
  active?: boolean;
  sort?: number;
  billing_mode?: BillingMode;
  billing_interval?: BillingInterval | null;
};

export type IssueDraft = {
  clientId: string;
  clientName?: string | null;
  templateId?: string | null;
  name: string;
  kind: PackageKind;
  visits?: number | null;
  creditAmount?: number | null;
  price: number;
  serviceLabel?: string | null;
  notes?: string | null;
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Short human summary of a package's remaining value.
export const packageRemainingLabel = (p: ClientPackage, currency = "USD"): string => {
  if (p.kind === "visits") {
    const r = Number(p.remaining_visits) || 0;
    const t = Number(p.total_visits) || 0;
    return `${r} of ${t} visit${t === 1 ? "" : "s"} left`;
  }
  const bal = Number(p.balance) || 0;
  try {
    return `${new Intl.NumberFormat(undefined, { style: "currency", currency }).format(bal)} left`;
  } catch {
    return `$${bal.toFixed(2)} left`;
  }
};

// "every month" / "every week" / "every year" — interval as a cadence.
export const intervalCadenceLabel = (interval: BillingInterval): string =>
  interval === "week" ? "every week" : interval === "year" ? "every year" : "every month";

// "$120/mo" style price-per-cycle label.
export const intervalPriceLabel = (price: number, interval: BillingInterval, currency = "USD"): string => {
  const suffix = interval === "week" ? "/wk" : interval === "year" ? "/yr" : "/mo";
  try {
    return `${new Intl.NumberFormat(undefined, { style: "currency", currency }).format(price)}${suffix}`;
  } catch {
    return `$${(Number(price) || 0).toFixed(2)}${suffix}`;
  }
};

// What a membership grants each cycle, e.g. "1 visit every month" or
// "$100 credit every month".
export const membershipGrantLabel = (m: ClientMembership, currency = "USD"): string => {
  const cadence = intervalCadenceLabel(m.billing_interval);
  if (m.kind === "visits") {
    const v = Number(m.per_cycle_visits) || 0;
    return `${v} visit${v === 1 ? "" : "s"} ${cadence}`;
  }
  const amt = Number(m.per_cycle_credit) || 0;
  try {
    return `${new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amt)} credit ${cadence}`;
  } catch {
    return `$${amt.toFixed(2)} credit ${cadence}`;
  }
};

export const useClientPackages = (
  userId: string | null,
): {
  templates: PackageTemplate[];
  packages: ClientPackage[];
  memberships: ClientMembership[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  saveTemplate: (draft: TemplateDraft) => Promise<boolean>;
  deleteTemplate: (id: string) => Promise<boolean>;
  issuePackage: (draft: IssueDraft) => Promise<ClientPackage | null>;
  redeem: (packageId: string, opts?: { appointmentId?: string | null; visits?: number; amount?: number }) => Promise<{ ok: boolean; reason?: string }>;
  voidPackage: (id: string) => Promise<boolean>;
  assignPackage: (id: string, clientId: string, clientName: string | null) => Promise<boolean>;
  activeForClient: (clientId: string) => ClientPackage[];
  cancelMembership: (id: string) => Promise<{ ok: boolean; reason?: string }>;
  assignMembership: (id: string, clientId: string, clientName: string | null) => Promise<boolean>;
  membershipsForClient: (clientId: string) => ClientMembership[];
} => {
  const [templates, setTemplates] = useState<PackageTemplate[]>([]);
  const [packages, setPackages] = useState<ClientPackage[]>([]);
  const [memberships, setMemberships] = useState<ClientMembership[]>([]);
  const [loading, setLoading] = useState<boolean>(!!userId);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) { setTemplates([]); setPackages([]); setMemberships([]); setLoading(false); return; }
    setLoading(true);
    try {
      const supabase = getSupabase();
      const [tpl, pkg, mem] = await Promise.all([
        supabase.from("package_templates").select("*").eq("user_id", userId).order("sort").order("created_at"),
        supabase.from("client_packages").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
        supabase.from("client_memberships").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
      ]);
      if (tpl.error) throw tpl.error;
      if (pkg.error) throw pkg.error;
      if (mem.error) throw mem.error;
      setTemplates((tpl.data || []) as PackageTemplate[]);
      setPackages((pkg.data || []) as ClientPackage[]);
      setMemberships((mem.data || []) as ClientMembership[]);
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

  const saveTemplate = useCallback(async (draft: TemplateDraft): Promise<boolean> => {
    if (!userId) return false;
    const isRecurring = draft.billing_mode === "recurring";
    const row = {
      ...(draft.id ? { id: draft.id } : {}),
      user_id: userId,
      name: draft.name.trim(),
      kind: draft.kind,
      visits: draft.kind === "visits" ? (num(draft.visits) ?? 1) : null,
      credit_amount: draft.kind === "credit" ? (num(draft.credit_amount) ?? 0) : null,
      price: num(draft.price) ?? 0,
      service_label: draft.service_label?.trim() || null,
      active: draft.active !== false,
      sort: draft.sort ?? 0,
      billing_mode: isRecurring ? "recurring" : "one_time",
      // A recurring template must carry an interval; a one-time one must
      // be null (DB constraint enforces this pairing).
      billing_interval: isRecurring ? (draft.billing_interval || "month") : null,
    };
    try {
      const supabase = getSupabase();
      const { error: err } = await supabase.from("package_templates").upsert(row);
      if (err) throw err;
      await refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "save_failed");
      return false;
    }
  }, [userId, refresh]);

  const deleteTemplate = useCallback(async (id: string): Promise<boolean> => {
    if (!userId) return false;
    try {
      const supabase = getSupabase();
      const { error: err } = await supabase.from("package_templates").delete().eq("id", id).eq("user_id", userId);
      if (err) throw err;
      setTemplates(prev => prev.filter(t => t.id !== id));
      return true;
    } catch { return false; }
  }, [userId]);

  const issuePackage = useCallback(async (draft: IssueDraft): Promise<ClientPackage | null> => {
    if (!userId) return null;
    const isVisits = draft.kind === "visits";
    const visits = isVisits ? Math.max(1, num(draft.visits) ?? 1) : null;
    const credit = !isVisits ? Math.max(0, num(draft.creditAmount) ?? 0) : null;
    const row = {
      user_id: userId,
      client_id: draft.clientId,
      client_name: draft.clientName?.trim() || null,
      template_id: draft.templateId || null,
      name: draft.name.trim(),
      kind: draft.kind,
      total_visits: visits,
      remaining_visits: visits,
      initial_amount: credit,
      balance: credit,
      price: num(draft.price) ?? 0,
      service_label: draft.serviceLabel?.trim() || null,
      status: "active" as const,
      source: "manual" as const,
      notes: draft.notes?.trim() || null,
    };
    try {
      const supabase = getSupabase();
      const { data, error: err } = await supabase.from("client_packages").insert(row).select("*").single();
      if (err || !data) throw err || new Error("insert_failed");
      const pkg = data as ClientPackage;
      setPackages(prev => [pkg, ...prev]);
      return pkg;
    } catch (e) {
      setError(e instanceof Error ? e.message : "issue_failed");
      return null;
    }
  }, [userId]);

  const redeem = useCallback(async (
    packageId: string,
    opts?: { appointmentId?: string | null; visits?: number; amount?: number },
  ): Promise<{ ok: boolean; reason?: string }> => {
    if (!userId) return { ok: false, reason: "no_user" };
    try {
      const supabase = getSupabase();
      const { data, error: err } = await supabase.rpc("redeem_package", {
        package_id_in: packageId,
        appointment_id_in: opts?.appointmentId ?? null,
        visits_in: opts?.visits ?? 1,
        amount_in: opts?.amount ?? 0,
      });
      if (err) return { ok: false, reason: err.message };
      const res = (data || {}) as any;
      if (res.ok) await refresh();
      return { ok: !!res.ok, reason: res.reason };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : "redeem_failed" };
    }
  }, [userId, refresh]);

  const voidPackage = useCallback(async (id: string): Promise<boolean> => {
    if (!userId) return false;
    try {
      const supabase = getSupabase();
      const { error: err } = await supabase.from("client_packages").update({ status: "void" }).eq("id", id).eq("user_id", userId);
      if (err) throw err;
      setPackages(prev => prev.map(p => p.id === id ? { ...p, status: "void" } : p));
      return true;
    } catch { return false; }
  }, [userId]);

  const assignPackage = useCallback(async (id: string, clientId: string, clientName: string | null): Promise<boolean> => {
    if (!userId || !clientId) return false;
    try {
      const supabase = getSupabase();
      const { error: err } = await supabase
        .from("client_packages")
        .update({ client_id: clientId, client_name: clientName })
        .eq("id", id)
        .eq("user_id", userId);
      if (err) throw err;
      setPackages(prev => prev.map(p => p.id === id ? { ...p, client_id: clientId, client_name: clientName } : p));
      return true;
    } catch { return false; }
  }, [userId]);

  const activeForClient = useCallback(
    (clientId: string): ClientPackage[] =>
      packages.filter(p => p.client_id === clientId && p.status === "active"),
    [packages],
  );

  // Cancel a membership's Stripe subscription on the connected account.
  // The server cancels at period end (the client keeps what they've paid
  // for); the webhook flips status to 'canceled' when Stripe confirms.
  const cancelMembership = useCallback(async (id: string): Promise<{ ok: boolean; reason?: string }> => {
    if (!userId) return { ok: false, reason: "no_user" };
    try {
      const supabase = getSupabase();
      const { data: sess } = await supabase.auth.getSession();
      const accessToken = sess?.session?.access_token;
      if (!accessToken) return { ok: false, reason: "no_session" };
      const res = await fetch("/api/membership/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ access_token: accessToken, membership_id: id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, reason: json?.error || `http_${res.status}` };
      await refresh();
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : "cancel_failed" };
    }
  }, [userId, refresh]);

  const assignMembership = useCallback(async (id: string, clientId: string, clientName: string | null): Promise<boolean> => {
    if (!userId || !clientId) return false;
    try {
      const supabase = getSupabase();
      const { error: err } = await supabase
        .from("client_memberships")
        .update({ client_id: clientId, client_name: clientName })
        .eq("id", id)
        .eq("user_id", userId);
      if (err) throw err;
      // Keep the rolling package tied to the same client so it shows on
      // their profile alongside the membership.
      const mem = memberships.find(m => m.id === id);
      if (mem?.package_id) {
        await supabase.from("client_packages")
          .update({ client_id: clientId, client_name: clientName })
          .eq("id", mem.package_id).eq("user_id", userId);
      }
      await refresh();
      return true;
    } catch { return false; }
  }, [userId, memberships, refresh]);

  const membershipsForClient = useCallback(
    (clientId: string): ClientMembership[] =>
      memberships.filter(m => m.client_id === clientId && (m.status === "active" || m.status === "past_due")),
    [memberships],
  );

  return useMemo(() => ({
    templates, packages, memberships, loading, error, refresh,
    saveTemplate, deleteTemplate, issuePackage, redeem, voidPackage, assignPackage, activeForClient,
    cancelMembership, assignMembership, membershipsForClient,
  }), [templates, packages, memberships, loading, error, refresh, saveTemplate, deleteTemplate, issuePackage, redeem, voidPackage, assignPackage, activeForClient, cancelMembership, assignMembership, membershipsForClient]);
};
