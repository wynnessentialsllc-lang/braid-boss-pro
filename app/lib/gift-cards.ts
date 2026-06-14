// Gift cards — stylist-side read API.
//
// Cards are issued by the product-checkout webhook when a gift-card
// product is purchased. This lists them for the owning stylist; RLS
// (gift_cards_owner_select) already scopes reads to user_id =
// auth.uid(), and the explicit filter keeps it tidy.
//
// Redemption (spending a code) ships in PR B.

import { getSupabase } from "./supabase";

export type GiftCard = {
  id: string;
  code: string;
  initialAmount: number;
  balance: number;
  status: string;            // active | depleted | void
  purchaserName: string | null;
  purchaserEmail: string | null;
  issuedAt: string;
};

export const listGiftCards = async (userId: string): Promise<GiftCard[]> => {
  if (!userId) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("gift_cards")
    .select("id, code, initial_amount, balance, status, purchaser_name, purchaser_email, issued_at")
    .eq("user_id", userId)
    .order("issued_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return ((data || []) as any[]).map(r => ({
    id: String(r.id),
    code: String(r.code || ""),
    initialAmount: Number(r.initial_amount) || 0,
    balance: Number(r.balance) || 0,
    status: String(r.status || "active"),
    purchaserName: r.purchaser_name || null,
    purchaserEmail: r.purchaser_email || null,
    issuedAt: String(r.issued_at || ""),
  }));
};

// A redeemable card found by its code, scoped to the owning stylist by
// RLS (gift_cards_owner_select). Used by Boss Checkout to apply a card
// as tender at the chair.
export type GiftCardLookup = {
  id: string;
  code: string;
  balance: number;
  status: string;
};

export const findGiftCardByCode = async (
  userId: string,
  code: string,
): Promise<GiftCardLookup | null> => {
  const trimmed = (code || "").trim();
  if (!userId || !trimmed) return null;
  const supabase = getSupabase();
  // Case-insensitive exact match — codes are issued uppercase but a
  // stylist typing one in shouldn't have to match the case.
  const { data } = await supabase
    .from("gift_cards")
    .select("id, code, balance, status")
    .eq("user_id", userId)
    .ilike("code", trimmed)
    .maybeSingle();
  if (!data) return null;
  return {
    id: String(data.id),
    code: String(data.code || ""),
    balance: Number(data.balance) || 0,
    status: String(data.status || "active"),
  };
};

export type RedeemResult = { ok: boolean; balance?: number; reason?: string };

// Redeem `amount` off a gift card for an in-person sale. Idempotent on
// saleId (the Boss Checkout transaction id) via the
// redeem_gift_card_in_person RPC, so a retry can't double-spend the card.
export const redeemGiftCardInPerson = async (
  cardId: string,
  saleId: string,
  amount: number,
): Promise<RedeemResult> => {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("redeem_gift_card_in_person", {
    card_id_in: cardId,
    sale_id_in: saleId,
    amount_in: amount,
  });
  if (error) return { ok: false, reason: error.message };
  const r = (data || {}) as any;
  return {
    ok: !!r.ok,
    balance: r.balance != null ? Number(r.balance) : undefined,
    reason: r.reason || undefined,
  };
};
