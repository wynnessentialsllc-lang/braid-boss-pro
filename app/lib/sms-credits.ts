// SMS credits — client API.
//
// Prepaid credit packs (a platform charge). loadSmsBalance reads
// the current balance; buySmsCredits kicks off a Stripe Checkout
// for a pack. PR 2 spends credits when texts actually send.

import { getSupabase } from "./supabase";

export { SMS_PACKS, findSmsPack, type SmsPack } from "./sms-packs";

// At/below this balance the SMS screen shows a low-credit warning.
export const SMS_LOW_BALANCE = 20;

export type SmsLedgerEntry = {
  id: string;
  delta: number;            // +credits for purchase/refund, -1 for send
  reason: string;           // purchase | send | refund | adjustment
  note: string | null;      // the message text, for sends
  recipient: string | null; // who the text went to, for sends
  createdAt: string;
};

// Credit transaction history — purchases, sends, refunds.
export const fetchSmsLedger = async (
  userId: string,
  limit = 60,
): Promise<SmsLedgerEntry[]> => {
  if (!userId) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("sms_credit_ledger")
    .select("id, delta, reason, note, recipient, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data || []) as any[]).map(r => ({
    id: String(r.id),
    delta: Number(r.delta) || 0,
    reason: String(r.reason || ""),
    note: r.note || null,
    recipient: r.recipient || null,
    createdAt: String(r.created_at || ""),
  }));
};

export const loadSmsBalance = async (userId: string): Promise<number> => {
  if (!userId) return 0;
  const supabase = getSupabase();
  const { data } = await supabase
    .from("sms_credits")
    .select("balance")
    .eq("user_id", userId)
    .maybeSingle();
  return Number(data?.balance) || 0;
};

// Start a credit-pack purchase. Posts to the checkout route with the
// signed-in stylist's access token (the route verifies it and keys
// the credited account off the verified user), then redirects to
// Stripe Checkout.
export const buySmsCredits = async (packId: string): Promise<void> => {
  const supabase = getSupabase();
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Please sign in again to buy credits.");
  const res = await fetch("/api/sms-credits/checkout", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ pack: packId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.url) {
    throw new Error(body?.error || "Couldn't start checkout. Try again.");
  }
  window.location.href = String(body.url);
};

// ---- Auto-recharge --------------------------------------------------
//
// A saved card plus a threshold. When the balance falls below it, a
// scheduled sweep charges the card and credits the pack, so reminders
// don't stop because nobody remembered to top up.

export type AutoRechargeSettings = {
  enabled: boolean;
  threshold: number;
  packId: string;
  hasCard: boolean;
  cardBrand: string | null;
  cardLast4: string | null;
  lastError: string | null;
};

export const DEFAULT_AUTORECHARGE: AutoRechargeSettings = {
  enabled: false,
  threshold: 20,
  packId: "standard",
  hasCard: false,
  cardBrand: null,
  cardLast4: null,
  lastError: null,
};

export const loadAutoRecharge = async (
  userId: string,
): Promise<AutoRechargeSettings> => {
  if (!userId) return DEFAULT_AUTORECHARGE;
  const supabase = getSupabase();
  const { data } = await supabase
    .from("sms_autorecharge")
    .select("enabled, threshold, pack_id, stripe_payment_method_id, card_brand, card_last4, last_error")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return DEFAULT_AUTORECHARGE;
  const r = data as any;
  return {
    enabled: !!r.enabled,
    threshold: Number(r.threshold) || DEFAULT_AUTORECHARGE.threshold,
    packId: String(r.pack_id || DEFAULT_AUTORECHARGE.packId),
    hasCard: !!r.stripe_payment_method_id,
    cardBrand: r.card_brand || null,
    cardLast4: r.card_last4 || null,
    lastError: r.last_error || null,
  };
};

/**
 * Persist the stylist's own preferences. The card fields are not
 * settable here — those are written only by the webhook once Stripe
 * confirms a saved payment method. Enabling without a card on file is
 * refused server-side, so the toggle can never claim to be armed when
 * nothing would charge.
 */
export const saveAutoRecharge = async (opts: {
  enabled: boolean;
  threshold?: number;
  packId?: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> => {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("set_sms_autorecharge", {
    enabled_in: opts.enabled,
    threshold_in: opts.threshold ?? null,
    pack_id_in: opts.packId ?? null,
  });
  if (error) return { ok: false, reason: error.message };
  const res = (data || {}) as any;
  if (res.ok === true) return { ok: true };
  return { ok: false, reason: String(res.reason || "unknown") };
};

/** Open Stripe Checkout in setup mode to put a card on file. */
export const startAutoRechargeCardSetup = async (): Promise<void> => {
  const supabase = getSupabase();
  const { data: sess } = await supabase.auth.getSession();
  const token = sess?.session?.access_token;
  if (!token) throw new Error("Please sign in again.");
  const res = await fetch("/api/sms-credits/autorecharge-setup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ access_token: token }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.url) {
    throw new Error(body?.error || "Couldn't open the card form.");
  }
  window.location.href = body.url as string;
};
