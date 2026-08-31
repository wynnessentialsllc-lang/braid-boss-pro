// POST /api/social-ai — owner-facing AI content studio for the social
// templates feature. One endpoint, four `kind`s: caption, template, photo,
// plan (see app/lib/social-ai.ts).
//
// Auth: the signed-in stylist passes their Supabase access_token in the
// body (the same pattern verify-payment uses). We resolve the user, load
// their REAL business name + active catalog server-side, and ask Claude to
// generate copy anchored to that data. The model never invents services or
// prices; numbers come from the catalog we pass in.
//
// Degrades gracefully: with no ANTHROPIC_API_KEY it returns 503 so the UI
// can hide the AI buttons instead of erroring.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { chargeAiCredits, refundAiCredits, outOfCreditsMessage } from "../../lib/ai-credits";
import {
  buildSystemPrompt,
  socialAiTool,
  parseCaption,
  parseTemplate,
  parsePhoto,
  parsePlan,
  SOCIAL_AI_TOOL_NAME,
  SOCIAL_AI_MAX_PROMPT,
  SOCIAL_AI_KINDS,
  type SocialAiKind,
  type StudioContext,
} from "../../lib/social-ai";
import { rateLimit } from "../../lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_MEDIA = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
// base64 inflates ~33%, so ~9.4M chars ≈ a 7 MB image.
const MAX_IMAGE_B64_CHARS = 9_400_000;

const fail = (status: number, message: string) =>
  NextResponse.json({ error: message }, { status });

const tooMany = (retryAfter: number) =>
  NextResponse.json(
    { error: "You're generating a lot at once — give it a moment." },
    { status: 429, headers: { "retry-after": String(retryAfter) } },
  );

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};

type Body = {
  access_token?: string;
  kind?: string;
  prompt?: string;
  // template context (caption kind): the chosen graphic's copy.
  template?: { name?: string; headline?: string; subhead?: string } | null;
  // photo kind
  image_base64?: string | null;
  media_type?: string | null;
  // plan kind
  slowDays?: unknown;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid JSON body.");
  }

  const kind = String(body.kind || "") as SocialAiKind;
  if (!SOCIAL_AI_KINDS.includes(kind)) return fail(400, "Unknown request kind.");

  const accessToken = (body.access_token || "").trim();
  if (!accessToken) return fail(401, "Please sign in again.");

  const prompt = (body.prompt || "").trim().slice(0, SOCIAL_AI_MAX_PROMPT);

  // Image is only relevant to the photo kind; validate it up front.
  let imageData: string | null = null;
  if (kind === "photo") {
    if (typeof body.image_base64 !== "string" || !body.image_base64) {
      return fail(400, "Add a photo to generate a post from it.");
    }
    if (body.image_base64.length > MAX_IMAGE_B64_CHARS) {
      return fail(413, "That photo is too large. Please use an image under ~7 MB.");
    }
    if (!body.media_type || !ALLOWED_MEDIA.has(body.media_type)) {
      return fail(400, "Unsupported image type.");
    }
    imageData = body.image_base64.includes(",")
      ? body.image_base64.slice(body.image_base64.indexOf(",") + 1)
      : body.image_base64;
  }

  // Graceful degradation when the AI key isn't configured.
  let anthropicKey: string;
  let supabaseUrl: string;
  let serviceKey: string;
  try {
    anthropicKey = env("ANTHROPIC_API_KEY");
  } catch {
    return fail(503, "AI content tools are temporarily unavailable.");
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

  // Identify the signed-in stylist.
  const { data: userData, error: userErr } = await admin.auth.getUser(accessToken);
  if (userErr || !userData?.user) return fail(401, "Could not identify the signed-in user.");
  const userId = userData.user.id;

  // Per-user cost guard.
  const gate = rateLimit("social-ai:user", userId, 30, 60_000);
  if (!gate.ok) return tooMany(gate.retryAfter);

  // Load the stylist's real business context (service role bypasses RLS).
  const ctx: StudioContext = { businessName: "Your Studio", services: [] };
  try {
    const { data: link } = await admin
      .from("booking_links")
      .select("business_name, business_city")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (link?.business_name) ctx.businessName = String(link.business_name);
    if (link?.business_city) ctx.city = String(link.business_city);
  } catch {
    /* non-fatal — fall back to defaults */
  }
  try {
    const { data: services } = await admin
      .from("services")
      .select("name, base_price, is_active")
      .eq("user_id", userId)
      .eq("is_active", true);
    ctx.services = (services || []).map((s: any) => ({
      name: String(s.name || "Service"),
      price: Number(s.base_price) || 0,
    }));
  } catch {
    /* non-fatal */
  }
  if (kind === "plan" && Array.isArray(body.slowDays)) {
    ctx.slowDays = body.slowDays.filter((d): d is string => typeof d === "string").slice(0, 7);
  }

  // Compose the user turn for this kind.
  const userContent: Anthropic.ContentBlockParam[] = [];
  if (imageData && body.media_type) {
    userContent.push({
      type: "image",
      source: { type: "base64", media_type: body.media_type as any, data: imageData },
    });
  }
  let instruction = prompt;
  if (kind === "caption") {
    const t = body.template || {};
    const desc = [t.name, t.headline, t.subhead].map((x) => (x || "").trim()).filter(Boolean).join(" — ");
    instruction = `Promo graphic: ${desc || "a booking promo"}.${prompt ? ` Extra direction: ${prompt}` : ""}`;
  } else if (kind === "template" && !prompt) {
    return fail(400, "Describe the promo you want to create.");
  } else if (kind === "photo" && !prompt) {
    instruction = "Create a post that shows off this style.";
  } else if (kind === "plan" && !prompt) {
    instruction = "Plan my week of social posts.";
  }
  userContent.push({ type: "text", text: instruction });

  // Vision needs Opus (matches style-consult); text kinds use the faster,
  // cheaper Sonnet.
  const model = kind === "photo" ? "claude-opus-4-8" : "claude-sonnet-4-6";

  // Photo analysis bills more because it runs on Opus.
  const feature = kind === "photo" ? "social-ai-photo" : "social-ai";
  const charge = await chargeAiCredits(admin, userId, feature);
  if (!charge.ok) {
    if (charge.reason === "insufficient_credits") {
      return fail(402, outOfCreditsMessage(charge.needed, charge.balance));
    }
    return fail(502, "Couldn't start that. Please try again.");
  }

  try {
    const client = new Anthropic({ apiKey: anthropicKey });
    const tool = socialAiTool(kind);
    const msg = await client.messages.create({
      model,
      max_tokens: 1024,
      system: buildSystemPrompt(kind, ctx),
      tools: [tool],
      tool_choice: { type: "tool", name: SOCIAL_AI_TOOL_NAME[kind] },
      messages: [{ role: "user", content: userContent }],
    });
    const toolUse = msg.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    const input = toolUse?.input ?? null;

    const result =
      kind === "caption" ? parseCaption(input)
      : kind === "template" ? parseTemplate(input)
      : kind === "photo" ? parsePhoto(input)
      : parsePlan(input);

    if (!result) {
      await refundAiCredits(admin, userId, feature, charge.charged);
      return fail(502, "Couldn't generate that — please try again.");
    }
    return NextResponse.json({ ok: true, kind, result, credits_balance: charge.balance });
  } catch (e: any) {
    await refundAiCredits(admin, userId, feature, charge.charged);
    if (e instanceof Anthropic.APIError && e.status === 429) {
      return fail(429, "We're a little busy — please try again in a moment.");
    }
    return fail(502, "Couldn't generate that right now. Please try again.");
  }
}
