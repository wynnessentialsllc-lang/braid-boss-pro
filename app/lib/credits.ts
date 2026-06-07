// Client account credit — store-credit ledger client API.
//
// Pairs with the client_credits table + apply_client_credit_to_appointment
// RPC (20260914 migration). A credit is a signed ledger entry per client:
//   * grant  — positive: the stylist puts credit on the account
//   * redeem — negative: credit applied to an appointment balance
//   * adjust — signed manual correction
//   * void   — reverses a prior entry
//
// Balance for a client = sum(amount). The deposit flow is untouched — a
// returning client still pays a deposit to book; credit only draws down
// the balance afterward.
//
// Whenever credit is GRANTED, the client is notified by email (best-
// effort) through the existing notification queue.

import { getSupabase } from "./supabase";

export type CreditKind = "grant" | "redeem" | "adjust" | "void";

export type CreditEntry = {
  id: string;
  user_id: string;
  client_id: string;
  amount: number;
  kind: CreditKind;
  reason: string | null;
  appointment_id: string | null;
  created_at: string;
};

// ---- Pure helpers (no I/O) --------------------------------------------

const round2 = (n: number) => Number((Number(n) || 0).toFixed(2));

// Net credit a client currently has available to spend.
export const creditBalance = (entries: CreditEntry[] | null | undefined): number => {
  let total = 0;
  for (const e of entries || []) total += Number(e.amount) || 0;
  return round2(total);
};

// Group a flat ledger into a per-client balance map.
export const creditBalancesByClient = (
  entries: CreditEntry[] | null | undefined,
): Map<string, number> => {
  const map = new Map<string, number>();
  for (const e of entries || []) {
    map.set(e.client_id, round2((map.get(e.client_id) || 0) + (Number(e.amount) || 0)));
  }
  return map;
};

// ---- Reads -------------------------------------------------------------

export const listCreditsForClient = async (
  userId: string,
  clientId: string,
): Promise<CreditEntry[]> => {
  if (!userId || !clientId) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("client_credits")
    .select("*")
    .eq("user_id", userId)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []) as CreditEntry[];
};

// Whole-account ledger — used to show "Credit" chips across the client
// list without a query per client.
export const listAllCredits = async (userId: string): Promise<CreditEntry[]> => {
  if (!userId) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("client_credits")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) throw error;
  return (data || []) as CreditEntry[];
};

export const availableCreditFor = async (
  userId: string,
  clientId: string,
): Promise<number> => creditBalance(await listCreditsForClient(userId, clientId));

// ---- Writes ------------------------------------------------------------

// Grant credit to a client's account and notify them by email. `client`
// carries the name/email used for the notification (best-effort — a
// missing email just skips the email, the credit still lands).
export const grantCredit = async (
  userId: string,
  client: { id: string; name?: string | null; email?: string | null },
  amount: number,
  reason: string,
  opts?: { kind?: "grant" | "adjust"; studioName?: string | null; notify?: boolean },
): Promise<CreditEntry> => {
  const supabase = getSupabase();
  const signed = round2(amount);
  if (!Number.isFinite(signed) || signed === 0) {
    throw new Error("Credit amount must be greater than $0.");
  }
  const { data, error } = await supabase
    .from("client_credits")
    .insert({
      user_id: userId,
      client_id: client.id,
      amount: signed,
      kind: opts?.kind || "grant",
      reason: reason?.trim() || null,
    })
    .select("*")
    .single();
  if (error) throw error;

  // Notify the client their account was credited. Best-effort: the grant
  // already succeeded, so a failed/queued email never throws.
  if (opts?.notify !== false && signed > 0) {
    try {
      await notifyCreditGranted(userId, client, signed, reason, opts?.studioName || null);
    } catch {
      /* email is best-effort */
    }
  }
  return data as CreditEntry;
};

// Reverse / remove a ledger entry by writing an opposite-signed void row
// (keeps the audit trail rather than deleting history).
export const voidCreditEntry = async (
  userId: string,
  entry: CreditEntry,
): Promise<void> => {
  const supabase = getSupabase();
  const { error } = await supabase.from("client_credits").insert({
    user_id: userId,
    client_id: entry.client_id,
    amount: -Number(entry.amount),
    kind: "void",
    reason: `Reversed: ${entry.reason || entry.kind}`,
    appointment_id: entry.appointment_id,
  });
  if (error) throw error;
};

// Apply (or clear) credit against an appointment's balance. Idempotent —
// safe to call on every appointment save. Returns the amount actually
// applied + remaining balance.
export const applyCreditToAppointment = async (
  clientId: string,
  appointmentId: string,
  amount: number,
): Promise<{ applied: number; remaining: number }> => {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("apply_client_credit_to_appointment", {
    client_id_in: clientId,
    appointment_id_in: appointmentId,
    amount_in: round2(amount),
  });
  if (error) throw error;
  const r = (data || {}) as { applied?: number; remaining?: number };
  return { applied: Number(r.applied) || 0, remaining: Number(r.remaining) || 0 };
};

// ---- Client notification ----------------------------------------------

const notifyCreditGranted = async (
  userId: string,
  client: { id: string; name?: string | null; email?: string | null },
  amount: number,
  reason: string,
  studioName: string | null,
): Promise<void> => {
  const email = (client.email || "").trim();
  if (!email || !email.includes("@")) return;

  const supabase = getSupabase();
  let studio = (studioName || "").trim();
  if (!studio) {
    try {
      const { data } = await supabase.rpc("public_get_studio_name", { user_id_in: userId });
      if (typeof data === "string" && data.trim()) studio = data.trim();
    } catch {
      /* studio name best-effort */
    }
  }
  if (!studio) studio = "your stylist";

  const name = (client.name || "").trim() || "there";
  const amountStr = `$${amount.toFixed(2)}`;
  const reasonClean = (reason || "").trim();
  const esc = (v: string) =>
    v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const html = `
    <div style="font-family:'DM Sans',Helvetica,Arial,sans-serif;color:#15111A;line-height:1.55;">
      <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#7C3AED;margin:0 0 10px;font-weight:700;">Account credit</p>
      <h1 style="font-size:20px;line-height:1.25;margin:0 0 12px;">You've got ${esc(amountStr)} in credit.</h1>
      <p style="font-size:15px;margin:0 0 14px;">
        Hi ${esc(name)}, ${esc(studio)} added <strong>${esc(amountStr)}</strong> of credit to your account${reasonClean ? ` (${esc(reasonClean)})` : ""}.
      </p>
      <p style="font-size:14px;color:#6F6477;margin:0 0 14px;">
        It'll be applied to the balance of your next appointment — you'll still pay your deposit to book, and the credit comes off what's left.
      </p>
      <p style="font-size:13px;color:#9F95A8;margin-top:18px;">Questions? Just reply to this email and your stylist will follow up.</p>
    </div>`;

  await supabase.rpc("queue_notification", {
    user_id_in: userId,
    channel_in: "email",
    notification_type_in: "client_credit_granted",
    body_in: `${studio} added ${amountStr} of account credit${reasonClean ? ` (${reasonClean})` : ""}.`,
    subject_in: `You've received ${amountStr} in credit — ${studio}`,
    recipient_email_in: email,
    recipient_name_in: client.name || null,
    payload_in: { html, creditAmount: amount, studioName: studio, reason: reasonClean || null },
    client_id_in: client.id,
  });
};
