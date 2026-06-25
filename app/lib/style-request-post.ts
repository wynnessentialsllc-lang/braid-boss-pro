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
