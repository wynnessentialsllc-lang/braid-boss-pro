// Referral payouts V1 — client API + summary helpers.
//
// Pairs with the referral_rewards table + process_referral_rewards
// RPC from the 20260727 migration. Rewards are account credit: the
// referring client earns a fixed amount when the friend they
// referred completes their first paid appointment. The stylist
// applies that credit as a discount on the referrer's next
// appointment, then marks the reward redeemed here.

import { getSupabase } from "./supabase";

export type ReferralRewardStatus = "earned" | "redeemed" | "void";

export type ReferralReward = {
  id: string;
  user_id: string;
  referrer_client_id: string;
  referred_client_id: string;
  trigger_appointment_id: string | null;
  amount: number;
  status: ReferralRewardStatus;
  earned_at: string;
  redeemed_at: string | null;
  redeemed_note: string | null;
  created_at: string;
  updated_at: string;
};

export type ReferralSettings = {
  enabled: boolean;
  rewardAmount: number;
};

export const loadReferralSettings = async (userId: string): Promise<ReferralSettings> => {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("shop_settings")
    .select("referral_enabled, referral_reward_amount")
    .eq("user_id", userId)
    .maybeSingle();
  return {
    enabled: data?.referral_enabled ?? false,
    rewardAmount: Number(data?.referral_reward_amount) || 0,
  };
};

export const saveReferralSettings = async (
  userId: string,
  settings: ReferralSettings,
): Promise<void> => {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("shop_settings")
    .upsert({
      user_id: userId,
      referral_enabled: settings.enabled,
      referral_reward_amount: Math.max(0, Number(settings.rewardAmount) || 0),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
  if (error) throw error;
};

export const listReferralRewards = async (userId: string): Promise<ReferralReward[]> => {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("referral_rewards")
    .select("*")
    .eq("user_id", userId)
    .order("earned_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data || []) as ReferralReward[];
};

// Mark a reward redeemed — the stylist applied the credit to the
// referrer's appointment. Optional note records how (e.g. "20 off
// her knotless on 6/14").
export const markRewardRedeemed = async (
  userId: string,
  rewardId: string,
  note?: string,
): Promise<void> => {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("referral_rewards")
    .update({
      status: "redeemed",
      redeemed_at: new Date().toISOString(),
      redeemed_note: note?.trim() || null,
    })
    .eq("id", rewardId)
    .eq("user_id", userId);
  if (error) throw error;
};

// Void a reward — fraud, a mistake, or a referral that shouldn't
// have counted. Distinct from redeemed so the books stay honest.
export const voidReward = async (userId: string, rewardId: string): Promise<void> => {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("referral_rewards")
    .update({ status: "void", redeemed_at: null, redeemed_note: null })
    .eq("id", rewardId)
    .eq("user_id", userId);
  if (error) throw error;
};

// Restore a redeemed/void reward back to earned (undo).
export const restoreReward = async (userId: string, rewardId: string): Promise<void> => {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("referral_rewards")
    .update({ status: "earned", redeemed_at: null, redeemed_note: null })
    .eq("id", rewardId)
    .eq("user_id", userId);
  if (error) throw error;
};

// On-demand run of the daily processor — lets the stylist see a
// reward appear immediately after a referred client's first paid
// appointment instead of waiting for the 17:00 UTC cron.
export const runReferralProcessor = async (): Promise<number> => {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("process_referral_rewards");
  if (error) throw error;
  return Number(data) || 0;
};

// ---- Pure summary -----------------------------------------------------

const round2 = (n: number) => Number((n || 0).toFixed(2));

export type ReferrerRollup = {
  referrerClientId: string;
  referralCount: number;       // total rewards generated
  earnedCredit: number;        // status = earned (available to apply)
  redeemedTotal: number;       // status = redeemed (already given)
};

export type ReferralSummary = {
  totals: {
    referrals: number;         // earned + redeemed (void excluded)
    creditOutstanding: number; // sum of earned
    creditRedeemed: number;    // sum of redeemed
  };
  byReferrer: ReferrerRollup[];
};

export const computeReferralSummary = (
  rewards: ReferralReward[] | null | undefined,
): ReferralSummary => {
  const byReferrer = new Map<string, ReferrerRollup>();
  let creditOutstanding = 0;
  let creditRedeemed = 0;
  let referrals = 0;

  for (const r of (rewards || [])) {
    if (r.status === "void") continue;
    referrals += 1;
    const roll = byReferrer.get(r.referrer_client_id) || {
      referrerClientId: r.referrer_client_id,
      referralCount: 0,
      earnedCredit: 0,
      redeemedTotal: 0,
    };
    roll.referralCount += 1;
    if (r.status === "earned") {
      roll.earnedCredit += Number(r.amount) || 0;
      creditOutstanding += Number(r.amount) || 0;
    } else if (r.status === "redeemed") {
      roll.redeemedTotal += Number(r.amount) || 0;
      creditRedeemed += Number(r.amount) || 0;
    }
    byReferrer.set(r.referrer_client_id, roll);
  }

  return {
    totals: {
      referrals,
      creditOutstanding: round2(creditOutstanding),
      creditRedeemed: round2(creditRedeemed),
    },
    byReferrer: Array.from(byReferrer.values())
      .map(r => ({
        ...r,
        earnedCredit: round2(r.earnedCredit),
        redeemedTotal: round2(r.redeemedTotal),
      }))
      .sort((a, b) => b.earnedCredit - a.earnedCredit),
  };
};

// Credit a specific client currently has available to spend.
export const earnedCreditFor = (
  rewards: ReferralReward[] | null | undefined,
  clientId: string,
): number => {
  let total = 0;
  for (const r of (rewards || [])) {
    if (r.status === "earned" && r.referrer_client_id === clientId) {
      total += Number(r.amount) || 0;
    }
  }
  return round2(total);
};
