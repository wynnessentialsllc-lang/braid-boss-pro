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
  purchaser_email: string | null;
  notes: string | null;
  purchased_at: string;
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

export const useClientPackages = (
  userId: string | null,
): {
  templates: PackageTemplate[];
  packages: ClientPackage[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  saveTemplate: (draft: TemplateDraft) => Promise<boolean>;
  deleteTemplate: (id: string) => Promise<boolean>;
  issuePackage: (draft: IssueDraft) => Promise<ClientPackage | null>;
  redeem: (packageId: string, opts?: { appointmentId?: string | null; visits?: number; amount?: number }) => Promise<{ ok: boolean; reason?: string }>;
  voidPackage: (id: string) => Promise<boolean>;
  activeForClient: (clientId: string) => ClientPackage[];
} => {
  const [templates, setTemplates] = useState<PackageTemplate[]>([]);
  const [packages, setPackages] = useState<ClientPackage[]>([]);
  const [loading, setLoading] = useState<boolean>(!!userId);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) { setTemplates([]); setPackages([]); setLoading(false); return; }
    setLoading(true);
    try {
      const supabase = getSupabase();
      const [tpl, pkg] = await Promise.all([
        supabase.from("package_templates").select("*").eq("user_id", userId).order("sort").order("created_at"),
        supabase.from("client_packages").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
      ]);
      if (tpl.error) throw tpl.error;
      if (pkg.error) throw pkg.error;
      setTemplates((tpl.data || []) as PackageTemplate[]);
      setPackages((pkg.data || []) as ClientPackage[]);
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

  const activeForClient = useCallback(
    (clientId: string): ClientPackage[] =>
      packages.filter(p => p.client_id === clientId && p.status === "active"),
    [packages],
  );

  return useMemo(() => ({
    templates, packages, loading, error, refresh,
    saveTemplate, deleteTemplate, issuePackage, redeem, voidPackage, activeForClient,
  }), [templates, packages, loading, error, refresh, saveTemplate, deleteTemplate, issuePackage, redeem, voidPackage, activeForClient]);
};
