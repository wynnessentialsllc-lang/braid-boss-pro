// POST /api/style-consult — "Build your style" AI ballpark quote.
//
// A public, anon-callable endpoint for the booking page. The client sends
// an inspiration photo + a few structured answers; we resolve the slug to
// the stylist, fetch their ACTIVE service catalog, and ask Claude (vision)
// to pick the single closest catalog service + estimate size/length/
// duration. Pricing is NEVER produced by the model — resolveQuoteRange()
// anchors a ballpark range to the matched service's real base_price, so a
// hallucinated or tampered price can't reach the client.
//
// Degrades gracefully: if ANTHROPIC_API_KEY isn't configured, returns 503
// with a friendly message so the booking page can hide/soft-disable the
// feature instead of erroring.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import {
  resolveQuoteRange,
  STYLE_SIZE_LABEL,
  STYLE_LENGTH_LABEL,
  type AiStyleQuote,
} from "../../lib/style-request";
import type { Service } from "../../lib/services";
import { rateLimit, clientIp } from "../../lib/rate-limit";
import {
  claimPublicAiCall,
  releasePublicAiCall,
  capReachedMessage,
  secondsUntilCapReset,
  notifyCapReached,
} from "../../lib/public-ai-cap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hard ceiling on the inline inspiration photo. base64 inflates bytes by
// ~33%, so ~9.4M chars ≈ a 7 MB image — generous for a phone photo while
// refusing payloads crafted to balloon the vision bill / storage upload.
const MAX_IMAGE_B64_CHARS = 9_400_000;

const fail = (status: number, message: string) =>
  NextResponse.json({ error: message }, { status });

const tooMany = (retryAfter: number) =>
  NextResponse.json(
    { error: "Too many requests — please wait a moment and try again." },
    { status: 429, headers: { "retry-after": String(retryAfter) } },
  );

// The daily ceiling, as distinct from the per-minute speed bump above:
// this one doesn't clear until the counters roll at UTC midnight.
const capped = () =>
  NextResponse.json(
    { error: capReachedMessage("style-consult"), reason: "daily_cap" },
    { status: 429, headers: { "retry-after": String(secondsUntilCapReset()) } },
  );

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};

// Accepted inline image types for the vision call.
const ALLOWED_MEDIA = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

type Body = {
  slug?: string;
  image_base64?: string | null;
  media_type?: string | null;
  intake?: {
    size?: string | null;
    length?: string | null;
    hairIncluded?: boolean | null;
    humanHair?: boolean | null;
    color?: string | null;
    notes?: string | null;
  } | null;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid JSON body.");
  }

  const slug = (body.slug || "").trim();
  if (!slug) return fail(400, "Missing booking link.");

  // Reject oversized inline images before doing any work — every call
  // here costs a Claude vision request + a storage upload.
  if (typeof body.image_base64 === "string" && body.image_base64.length > MAX_IMAGE_B64_CHARS) {
    return fail(413, "That photo is too large. Please use an image under ~7 MB.");
  }

  // Best-effort cost-abuse guard: this endpoint fans out to Claude Opus
  // vision on every call. Cap per-IP and per-slug request rates. Limits
  // are generous enough that a real client trying a couple of styles is
  // never affected.
  const ip = clientIp(req);
  const ipGate = rateLimit("style-consult:ip", ip, 8, 60_000);
  if (!ipGate.ok) return tooMany(ipGate.retryAfter);
  const slugGate = rateLimit("style-consult:slug", slug.toLowerCase(), 30, 60_000);
  if (!slugGate.ok) return tooMany(slugGate.retryAfter);

  // Graceful degradation when the AI key isn't configured.
  let anthropicKey: string;
  let supabaseUrl: string;
  let serviceKey: string;
  try {
    anthropicKey = env("ANTHROPIC_API_KEY");
  } catch {
    return fail(503, "Style consultation is temporarily unavailable. Please send your request to the stylist instead.");
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

  // Resolve slug -> stylist user_id (same RPC the booking page uses).
  let userId: string | null = null;
  try {
    const { data, error } = await admin.rpc("public_resolve_booking_slug", { slug_in: slug });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : (data as any);
    userId = row?.user_id ? String(row.user_id) : null;
  } catch {
    return fail(502, "Couldn't look up this booking link.");
  }
  if (!userId) return fail(404, "Booking link not found.");

  // Daily ceiling. Claimed AFTER the slug resolves, so a caller hammering
  // made-up slugs can't burn a real stylist's budget, and BEFORE the
  // storage upload and the Opus call — the two things that cost money.
  const claim = await claimPublicAiCall(admin, "style-consult", slug);
  if (!claim.ok) {
    // Fire-and-forget: the stylist hears that her page is turning
    // clients away, rather than finding out from a client.
    await notifyCapReached(admin, "style-consult", claim, userId);
    return capped();
  }
  // From here on every early return has to hand the slot back, or a run
  // of failures would silently eat the day's budget.
  const release = () => releasePublicAiCall(admin, "style-consult", slug);

  // Fetch the stylist's ACTIVE services — the catalog the model chooses from.
  let services: Service[] = [];
  try {
    const { data, error } = await admin
      .from("services")
      .select("id, name, description, base_price, duration_hours, is_active")
      .eq("user_id", userId)
      .eq("is_active", true);
    if (error) throw error;
    services = (data || []) as unknown as Service[];
  } catch {
    await release();
    return fail(502, "Couldn't load the stylist's services.");
  }

  // Build the model input. Catalog is passed as compact JSON so the model
  // can only pick an id that actually exists.
  const catalog = services.map(s => ({
    id: s.id,
    name: s.name,
    base_price: Number(s.base_price) || 0,
    duration_hours: Number(s.duration_hours) || 0,
  }));
  const intake = body.intake || {};
  const sizeLabel = intake.size ? (STYLE_SIZE_LABEL as any)[intake.size] || intake.size : "unspecified";
  const lengthLabel = intake.length ? (STYLE_LENGTH_LABEL as any)[intake.length] || intake.length : "unspecified";

  const intakeText = [
    `Desired size: ${sizeLabel}`,
    `Desired length: ${lengthLabel}`,
    `Hair included by stylist: ${intake.hairIncluded == null ? "unspecified" : intake.hairIncluded ? "yes" : "no (client brings hair)"}`,
    `Human hair: ${intake.humanHair == null ? "unspecified" : intake.humanHair ? "yes" : "no"}`,
    `Color: ${(intake.color || "").trim() || "unspecified"}`,
    `Client notes: ${(intake.notes || "").trim() || "none"}`,
  ].join("\n");

  const promptText =
    "A client wants to book a braiding style. Using the inspiration photo (if provided) and their answers, " +
    "pick the SINGLE closest matching service from the stylist's catalog below, and estimate the style family, " +
    "size, length, and duration in hours.\n\n" +
    "Rules:\n" +
    "- suggestedServiceId MUST be one of the catalog ids, or \"\" if nothing is a reasonable match.\n" +
    "- Do NOT invent or output any prices. You only choose the closest service.\n" +
    "- estDurationHours: your best estimate in hours (use 0 if unsure).\n\n" +
    `Client answers:\n${intakeText}\n\n` +
    `Catalog (JSON): ${JSON.stringify(catalog)}`;

  const userContent: Anthropic.ContentBlockParam[] = [];
  let imageData: string | null = null;
  if (body.image_base64 && body.media_type && ALLOWED_MEDIA.has(body.media_type)) {
    // Strip a data: URL prefix if present.
    imageData = body.image_base64.includes(",")
      ? body.image_base64.slice(body.image_base64.indexOf(",") + 1)
      : body.image_base64;
    userContent.push({
      type: "image",
      source: { type: "base64", media_type: body.media_type as any, data: imageData },
    });
  }
  userContent.push({ type: "text", text: promptText });

  // Persist the inspiration photo server-side (service role bypasses the
  // anon write restriction) so the stylist can see it in their review
  // queue. Best-effort: a storage failure never blocks the estimate.
  let photoPath: string | null = null;
  if (imageData) {
    try {
      const ext = body.media_type === "image/png" ? "png"
        : body.media_type === "image/webp" ? "webp"
        : body.media_type === "image/gif" ? "gif" : "jpg";
      const path = `${userId}/${crypto.randomUUID()}.${ext}`;
      const buffer = Buffer.from(imageData, "base64");
      const { error: upErr } = await admin.storage
        .from("style-request-photos")
        .upload(path, buffer, { contentType: body.media_type || "image/jpeg", upsert: false });
      if (!upErr) photoPath = path;
    } catch {
      // ignore — photo persistence is non-critical
    }
  }

  // Forced tool call = robust structured output across SDK versions.
  const tool: Anthropic.Tool = {
    name: "propose_style_quote",
    description: "Return the closest catalog service and the style estimate.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["styleFamily", "suggestedServiceId", "sizeGuess", "lengthGuess", "estDurationHours", "rationale"],
      properties: {
        styleFamily: { type: "string", description: "e.g. 'knotless box braids', 'boho knotless', 'passion twists'" },
        suggestedServiceId: { type: "string", description: "A catalog id, or \"\" if none fit." },
        sizeGuess: { type: "string", description: "micro | small | medium | large | jumbo, or ''" },
        lengthGuess: { type: "string", description: "shoulder | mid_back | waist | hip | butt, or ''" },
        estDurationHours: { type: "number", description: "Best estimate in hours; 0 if unsure." },
        rationale: { type: "string", description: "One short sentence the client can read." },
      },
    },
  };

  let ai: AiStyleQuote;
  try {
    const client = new Anthropic({ apiKey: anthropicKey });
    const msg = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      tools: [tool],
      tool_choice: { type: "tool", name: "propose_style_quote" },
      messages: [{ role: "user", content: userContent }],
    });
    const toolUse = msg.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (!toolUse) {
      await release();
      return fail(502, "Couldn't generate an estimate. Please send your request to the stylist.");
    }
    const input = toolUse.input as Record<string, unknown>;
    ai = {
      styleFamily: typeof input.styleFamily === "string" ? input.styleFamily : null,
      suggestedServiceId: typeof input.suggestedServiceId === "string" && input.suggestedServiceId
        ? input.suggestedServiceId : null,
      sizeGuess: typeof input.sizeGuess === "string" ? input.sizeGuess : null,
      lengthGuess: typeof input.lengthGuess === "string" ? input.lengthGuess : null,
      estDurationHours: typeof input.estDurationHours === "number" ? input.estDurationHours : null,
      rationale: typeof input.rationale === "string" ? input.rationale : null,
    };
  } catch (e: any) {
    await release();
    if (e instanceof Anthropic.APIError && e.status === 429) {
      return fail(429, "We're a little busy — please try again in a moment.");
    }
    return fail(502, "Couldn't generate an estimate right now. Please send your request to the stylist.");
  }

  // Anchor the ballpark to the real catalog. Price never comes from the model.
  const quote = resolveQuoteRange(ai, services);

  return NextResponse.json({
    ok: true,
    photo_path: photoPath,
    quote: {
      styleFamily: ai.styleFamily,
      sizeGuess: ai.sizeGuess,
      lengthGuess: ai.lengthGuess,
      rationale: ai.rationale,
      matchedServiceId: quote.matchedServiceId,
      matchedServiceName: quote.matchedServiceName,
      priceLow: quote.priceLow,
      priceHigh: quote.priceHigh,
      estDurationHours: quote.estDurationHours,
      anchored: quote.anchored,
    },
  });
}
