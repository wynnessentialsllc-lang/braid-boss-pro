// "Find My Braider" — client-side types + caller for the AI Style-Match
// discovery flow. The heavy lifting (Claude vision classification + the
// ranking RPC) lives in /api/find-braider; this module is the typed
// bridge the /discover page uses.

import type { DiscoverStylist } from "./marketplace";

// What the vision model detected from the inspiration photo. styleTags is
// always a subset of the canonical STYLE_TAGS vocabulary (validated
// server-side, so the client can trust it).
export type DetectedStyle = {
  styleTags: string[];
  styleFamily: string;     // free-text, e.g. "boho knotless box braids"
  sizeGuess: string;       // canonical size slug or ""
  lengthGuess: string;     // canonical length slug or ""
  rationale: string;       // one client-readable sentence
};

export type MatchedBraider = DiscoverStylist & {
  matchCount: number;      // how many detected styles this braider offers
  matchedStyles: string[]; // which ones
};

export type FindBraiderResult = {
  detected: DetectedStyle;
  matches: MatchedBraider[];
};

export type FindBraiderInput = {
  imageBase64: string;
  mediaType: string;
  city?: string;
  notes?: string;
};

// Calls the route. Throws Error(message) on a non-2xx so the UI can show a
// friendly message (e.g. the 503 when the AI key isn't configured).
export const findBraider = async (input: FindBraiderInput): Promise<FindBraiderResult> => {
  const res = await fetch("/api/find-braider", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      image_base64: input.imageBase64,
      media_type: input.mediaType,
      city: input.city?.trim() || null,
      notes: input.notes?.trim() || null,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as any)?.error || "Couldn't match your photo right now.");
  }
  return data as FindBraiderResult;
};

// Classify-only: detect style tags from a photo without running the match
// query. Used by the "post a request" form to auto-suggest style tags.
export const classifyStyle = async (
  imageBase64: string,
  mediaType: string,
): Promise<DetectedStyle> => {
  const res = await fetch("/api/find-braider", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ image_base64: imageBase64, media_type: mediaType, classify_only: true }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as any)?.error || "Couldn't read that photo right now.");
  }
  return (data as FindBraiderResult).detected;
};
