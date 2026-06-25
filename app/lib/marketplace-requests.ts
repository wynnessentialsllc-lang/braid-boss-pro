// Braider-side "Open Requests" inbox + quoting (Phase 4, sub-step 2).
//
// Reads the signed-in braider's matching open style requests and lets them
// submit/edit a quote. Both go through SECURITY DEFINER RPCs that key off
// auth.uid(), so a braider only ever sees requests relevant to them and can
// only quote on open requests.

import { getSupabase } from "./supabase";

const STORAGE_PUBLIC_BASE = `${(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://bjqazhplxqqhftekspfl.supabase.co"
).replace(/\/$/, "")}/storage/v1/object/public/style-request-photos/`;

export type OpenRequest = {
  id: string;
  photoUrl: string | null;
  styleTags: string[];
  size: string | null;
  length: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  city: string | null;
  state: string | null;
  preferredDate: string | null;
  notes: string | null;
  clientName: string;
  createdAt: string | null;
  // The braider's own quote on this request, if they've sent one.
  myQuoteId: string | null;
  myQuotePrice: number | null;
  myQuoteStatus: string | null;
};

export const fetchOpenRequests = async (): Promise<OpenRequest[]> => {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("marketplace_open_requests");
  if (error) throw error;
  return ((data || []) as any[]).map(r => ({
    id: String(r.id),
    photoUrl: r.photo_path ? STORAGE_PUBLIC_BASE + r.photo_path : null,
    styleTags: Array.isArray(r.style_tags) ? r.style_tags : [],
    size: r.size || null,
    length: r.length || null,
    budgetMin: r.budget_min == null ? null : Number(r.budget_min),
    budgetMax: r.budget_max == null ? null : Number(r.budget_max),
    city: r.city || null,
    state: r.state || null,
    preferredDate: r.preferred_date || null,
    notes: r.notes || null,
    clientName: String(r.client_name || "Client"),
    createdAt: r.created_at || null,
    myQuoteId: r.my_quote_id || null,
    myQuotePrice: r.my_quote_price == null ? null : Number(r.my_quote_price),
    myQuoteStatus: r.my_quote_status || null,
  }));
};

export const submitQuote = async (input: {
  requestId: string;
  price: number;
  message?: string;
  availableDate?: string | null;
}): Promise<string> => {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("marketplace_submit_quote", {
    p_request_id: input.requestId,
    p_price: input.price,
    p_message: input.message?.trim() || null,
    p_available_date: input.availableDate || null,
  });
  if (error) throw new Error(error.message || "Couldn't send your quote.");
  return String(data);
};
