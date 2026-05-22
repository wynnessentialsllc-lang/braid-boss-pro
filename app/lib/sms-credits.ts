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
  note: string | null;
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
    .select("id, delta, reason, note, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data || []) as any[]).map(r => ({
    id: String(r.id),
    delta: Number(r.delta) || 0,
    reason: String(r.reason || ""),
    note: r.note || null,
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
