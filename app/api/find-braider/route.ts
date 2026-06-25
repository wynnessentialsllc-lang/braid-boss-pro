// POST /api/find-braider — "Find My Braider" AI Style-Match.
//
// Public, anon-callable. A client sends an inspiration photo (+ optional
// city / notes); we ask Claude (vision) to classify the photo into our
// CANONICAL braid-style vocabulary (the same slugs as services.style_tags),
// then rank LISTED braiders by how many of those styles they offer via the
// public_match_braiders RPC.
//
// Unlike /api/style-consult, there is no single stylist here — the model
// only classifies into our fixed taxonomy (validated server-side), it never
// invents styles or prices. The photo is classified in-flight and NOT
// stored (no stylist to attach it to).
//
// Degrades gracefully: if ANTHROPIC_API_KEY isn't configured, returns 503
// so the /discover panel can hide the feature instead of erroring.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { STYLE_TAGS } from "../../lib/marketplace";
import { STYLE_SIZES, STYLE_LENGTHS } from "../../lib/style-request";
import { rateLimit, clientIp } from "../../lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// base64 inflates bytes ~33%, so ~9.4M chars ≈ a 7 MB image.
const MAX_IMAGE_B64_CHARS = 9_400_000;
const ALLOWED_MEDIA = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const CANONICAL_SLUGS = new Set(STYLE_TAGS.map(s => s.slug));
const SIZE_SET = new Set<string>(STYLE_SIZES as readonly string[]);
const LENGTH_SET = new Set<string>(STYLE_LENGTHS as readonly string[]);

const fail = (status: number, message: string) =>
  NextResponse.json({ error: message }, { status });

const tooMany = (retryAfter: number) =>
  NextResponse.json(
    { error: "Too many requests — please wait a moment and try again." },
    { status: 429, headers: { "retry-after": String(retryAfter) } },
  );

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};

type Body = {
  image_base64?: string | null;
  media_type?: string | null;
  city?: string | null;
  notes?: string | null;
  // When true, only classify the photo into style tags and skip the
  // braider-matching query — used by the "post a request" form to
  // auto-suggest style tags.
  classify_only?: boolean;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid JSON body.");
  }

  const mediaType = (body.media_type || "").trim();
  if (!body.image_base64 || !mediaType) return fail(400, "An inspiration photo is required.");
  if (!ALLOWED_MEDIA.has(mediaType)) return fail(415, "Unsupported image type. Use JPEG, PNG, WebP, or GIF.");
  if (typeof body.image_base64 === "string" && body.image_base64.length > MAX_IMAGE_B64_CHARS) {
    return fail(413, "That photo is too large. Please use an image under ~7 MB.");
  }

  // Cost-abuse guard — this fans out to Claude vision on every call.
  const ip = clientIp(req);
  const ipGate = rateLimit("find-braider:ip", ip, 8, 60_000);
  if (!ipGate.ok) return tooMany(ipGate.retryAfter);

  let anthropicKey: string;
  let supabaseUrl: string;
  let serviceKey: string;
  try {
    anthropicKey = env("ANTHROPIC_API_KEY");
  } catch {
    return fail(503, "Style matching is temporarily unavailable. Try searching by city instead.");
  }
  try {
    supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || env("SUPABASE_URL");
    serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  } catch (e: any) {
    return fail(500, e?.message || "Server is not configured.");
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Strip a data: URL prefix if present.
  const imageData = body.image_base64.includes(",")
    ? body.image_base64.slice(body.image_base64.indexOf(",") + 1)
    : body.image_base64;

  const styleList = STYLE_TAGS.map(s => `${s.slug} (${s.label})`).join(", ");
  const notes = (body.notes || "").trim().slice(0, 500);
  const promptText =
    "You are a braiding-style classifier for a braider marketplace. Look at the inspiration photo " +
    "and identify which of our canonical braid styles it shows. Pick ONLY from this fixed list of slugs:\n" +
    `${styleList}\n\n` +
    "Rules:\n" +
    "- styleTags: 1–3 slugs from the list above that best describe the photo. Use [] if it clearly isn't a braiding style.\n" +
    "- Only output slugs that appear in the list verbatim. Never invent a slug.\n" +
    "- sizeGuess: one of micro|small|medium|large|jumbo, or \"\" if unclear.\n" +
    "- lengthGuess: one of shoulder|mid_back|waist|hip|butt, or \"\" if unclear.\n" +
    "- rationale: one short, friendly sentence the client can read.\n" +
    (notes ? `\nClient notes: ${notes}\n` : "");

  const userContent: Anthropic.ContentBlockParam[] = [
    { type: "image", source: { type: "base64", media_type: mediaType as any, data: imageData } },
    { type: "text", text: promptText },
  ];

  const tool: Anthropic.Tool = {
    name: "classify_braid_style",
    description: "Classify the inspiration photo into the canonical braid-style vocabulary.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["styleTags", "styleFamily", "sizeGuess", "lengthGuess", "rationale"],
      properties: {
        styleTags: {
          type: "array",
          items: { type: "string" },
          description: "1–3 canonical slugs from the provided list, or [] if not a braiding style.",
        },
        styleFamily: { type: "string", description: "e.g. 'boho knotless box braids'." },
        sizeGuess: { type: "string", description: "micro|small|medium|large|jumbo or ''." },
        lengthGuess: { type: "string", description: "shoulder|mid_back|waist|hip|butt or ''." },
        rationale: { type: "string", description: "One short sentence for the client." },
      },
    },
  };

  let detected: {
    styleTags: string[];
    styleFamily: string;
    sizeGuess: string;
    lengthGuess: string;
    rationale: string;
  };
  try {
    const client = new Anthropic({ apiKey: anthropicKey });
    const msg = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      tools: [tool],
      tool_choice: { type: "tool", name: "classify_braid_style" },
      messages: [{ role: "user", content: userContent }],
    });
    const toolUse = msg.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (!toolUse) return fail(502, "Couldn't read that photo. Try a clearer image or search by city.");
    const input = toolUse.input as Record<string, unknown>;

    // Validate against our taxonomy — never trust raw model output.
    const rawTags = Array.isArray(input.styleTags) ? input.styleTags : [];
    const styleTags = Array.from(
      new Set(rawTags.map(t => String(t || "").trim()).filter(t => CANONICAL_SLUGS.has(t))),
    ).slice(0, 3);
    const size = String(input.sizeGuess || "").trim();
    const length = String(input.lengthGuess || "").trim();
    detected = {
      styleTags,
      styleFamily: String(input.styleFamily || "").trim().slice(0, 120),
      sizeGuess: SIZE_SET.has(size) ? size : "",
      lengthGuess: LENGTH_SET.has(length) ? length : "",
      rationale: String(input.rationale || "").trim().slice(0, 280),
    };
  } catch {
    return fail(502, "Couldn't match your photo right now. Please try again or search by city.");
  }

  // Classify-only (auto-suggest for the post-a-request form): skip matching.
  if (body.classify_only) {
    return NextResponse.json({ detected, matches: [] });
  }

  // Nothing canonical detected → return the read, no matches (UI falls back).
  if (detected.styleTags.length === 0) {
    return NextResponse.json({ detected, matches: [] });
  }

  // Rank listed braiders by style overlap.
  let matches: any[] = [];
  try {
    const { data, error } = await admin.rpc("public_match_braiders", {
      style_slugs: detected.styleTags,
      city_in: (body.city || "").trim() || null,
    });
    if (error) throw error;
    matches = ((data || []) as any[]).map(r => ({
      slug: String(r.slug || ""),
      businessName: String(r.business_name || "Braid stylist"),
      logoUrl: r.logo_url || null,
      coverPhoto: r.cover_photo || r.logo_url || null,
      city: r.business_city || null,
      state: r.business_state || null,
      intro: r.intro || null,
      priceMin: r.price_min == null ? null : Number(r.price_min),
      priceMax: r.price_max == null ? null : Number(r.price_max),
      ratingAvg: r.rating_avg == null ? null : Number(r.rating_avg),
      ratingCount: Number(r.rating_count) || 0,
      styleTags: Array.isArray(r.style_tags) ? r.style_tags : [],
      travels: Boolean(r.travels),
      matchCount: Number(r.match_count) || 0,
      matchedStyles: Array.isArray(r.matched_styles) ? r.matched_styles : [],
    })).filter(m => m.slug);
  } catch {
    return fail(502, "Found your style, but couldn't load matches. Please try again.");
  }

  return NextResponse.json({ detected, matches });
}
