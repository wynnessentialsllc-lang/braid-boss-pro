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
