// Loyalty points — client API.
//
// Per-visit points. Earned points are DERIVED app-side from a
// client's completed-visit count (see earnedPoints); only the
// program config and the redemptions ledger are persisted.
// Available = earned - sum(points redeemed).

import { getSupabase } from "./supabase";

export type LoyaltySettings = {
  enabled: boolean;
  pointsPerVisit: number;
  rewardPoints: number;     // points needed for one reward
  rewardValue: number;      // dollar value of one reward
};

export const DEFAULT_LOYALTY: LoyaltySettings = {
  enabled: false,
  pointsPerVisit: 10,
  rewardPoints: 100,
  rewardValue: 10,
};

export const loadLoyaltySettings = async (
  userId: string,
): Promise<LoyaltySettings> => {
  if (!userId) return { ...DEFAULT_LOYALTY };
  const supabase = getSupabase();
  const { data } = await supabase
    .from("loyalty_settings")
    .select("enabled, points_per_visit, reward_points, reward_value")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return { ...DEFAULT_LOYALTY };
  return {
    enabled: !!data.enabled,
    pointsPerVisit: Number(data.points_per_visit) || DEFAULT_LOYALTY.pointsPerVisit,
    rewardPoints: Number(data.reward_points) || DEFAULT_LOYALTY.rewardPoints,
    rewardValue: Number(data.reward_value) || DEFAULT_LOYALTY.rewardValue,
  };
};

export const saveLoyaltySettings = async (
  userId: string,
  s: LoyaltySettings,
): Promise<void> => {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("loyalty_settings")
    .upsert({
      user_id: userId,
      enabled: s.enabled,
      points_per_visit: Math.max(1, Math.min(1000, Math.round(s.pointsPerVisit))),
      reward_points: Math.max(1, Math.min(100000, Math.round(s.rewardPoints))),
      reward_value: Math.max(0.01, s.rewardValue),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
  if (error) throw error;
};

export type LoyaltyRedemption = {
  id: string;
  clientId: string;
  pointsSpent: number;
  rewardValue: number;
  note: string | null;
  redeemedAt: string;
};

// All redemptions for the stylist — the caller buckets them by
// clientId to compute per-client available balances.
export const fetchLoyaltyRedemptions = async (
  userId: string,
): Promise<LoyaltyRedemption[]> => {
  if (!userId) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("loyalty_redemptions")
    .select("id, client_id, points_spent, reward_value, note, redeemed_at")
    .eq("user_id", userId)
    .order("redeemed_at", { ascending: false });
  if (error) throw error;
  return ((data || []) as any[]).map(r => ({
    id: String(r.id),
    clientId: String(r.client_id),
    pointsSpent: Number(r.points_spent) || 0,
    rewardValue: Number(r.reward_value) || 0,
    note: r.note || null,
    redeemedAt: String(r.redeemed_at || ""),
  }));
};

export const recordLoyaltyRedemption = async (
  userId: string,
  clientId: string,
  pointsSpent: number,
  rewardValue: number,
): Promise<LoyaltyRedemption> => {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("loyalty_redemptions")
    .insert({
      user_id: userId,
      client_id: clientId,
      points_spent: pointsSpent,
      reward_value: rewardValue,
    })
    .select("id, client_id, points_spent, reward_value, note, redeemed_at")
    .single();
  if (error) throw error;
  return {
    id: String(data.id),
    clientId: String(data.client_id),
    pointsSpent: Number(data.points_spent) || 0,
    rewardValue: Number(data.reward_value) || 0,
    note: data.note || null,
    redeemedAt: String(data.redeemed_at || ""),
  };
};

// Points a client has earned from their completed visits.
export const earnedPoints = (visitCount: number, pointsPerVisit: number): number =>
  Math.max(0, Math.floor(visitCount)) * Math.max(0, pointsPerVisit);
