// "Open Style Request" — client-side caller for posting a request to the
// marketplace (Phase 4, sub-step 1). The route at /api/style-request-post
// validates, uploads the photo, and returns the opaque client token used to
// view incoming quotes at /requests/<token>.

export type StyleRequestInput = {
  clientName: string;
  clientEmail?: string;
  clientPhone?: string;
  imageBase64?: string | null;
  mediaType?: string | null;
  styleTags: string[];
  size?: string | null;
  length?: string | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  city?: string;
  state?: string;
  preferredDate?: string | null;
  notes?: string;
};

export type RequestQuote = {
  price: number;
  message: string | null;
  availableDate: string | null;
  createdAt: string | null;
  businessName: string;
  slug: string;
  logoUrl: string | null;
};

export type RequestView = {
  status: string;
  styleTags: string[];
  size: string | null;
  length: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  city: string | null;
  notes: string | null;
  createdAt: string | null;
  quotes: RequestQuote[];
};

// Loads a client's request + quotes by token. Returns null if not found.
export const getRequestQuotes = async (token: string): Promise<RequestView | null> => {
  const { getSupabase } = await import("./supabase");
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("public_get_request_quotes", { token_in: token });
  if (error) throw error;
  if (!data) return null;
  const d = data as any;
  return {
    status: String(d.status || "open"),
    styleTags: Array.isArray(d.styleTags) ? d.styleTags : [],
    size: d.size || null,
    length: d.length || null,
    budgetMin: d.budgetMin == null ? null : Number(d.budgetMin),
    budgetMax: d.budgetMax == null ? null : Number(d.budgetMax),
    city: d.city || null,
    notes: d.notes || null,
    createdAt: d.createdAt || null,
    quotes: Array.isArray(d.quotes) ? d.quotes.map((q: any) => ({
      price: Number(q.price) || 0,
      message: q.message || null,
      availableDate: q.availableDate || null,
      createdAt: q.createdAt || null,
      businessName: String(q.businessName || "Braider"),
      slug: String(q.slug || ""),
      logoUrl: q.logoUrl || null,
    })) : [],
  };
};

// Returns the request's client_token. Throws Error(message) on non-2xx.
export const createStyleRequest = async (input: StyleRequestInput): Promise<string> => {
  const res = await fetch("/api/style-request-post", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: input.clientName,
      client_email: input.clientEmail?.trim() || null,
      client_phone: input.clientPhone?.trim() || null,
      image_base64: input.imageBase64 || null,
      media_type: input.mediaType || null,
      style_tags: input.styleTags,
      size: input.size || null,
      length: input.length || null,
      budget_min: input.budgetMin ?? null,
      budget_max: input.budgetMax ?? null,
      city: input.city?.trim() || null,
      state: input.state?.trim() || null,
      preferred_date: input.preferredDate || null,
      notes: input.notes?.trim() || null,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !(data as any)?.token) {
    throw new Error((data as any)?.error || "Couldn't post your request right now.");
  }
  return String((data as any).token);
};
