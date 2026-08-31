// POST /api/rebooking-ai — owner-facing AI for the rebooking + win-back
// flow. Two kinds (see app/lib/rebooking-ai.ts):
//
//   nudge   — a personalized rebooking message for one client. Channel
//             "sms" -> { message }; "email" -> { subject, body }.
//   winback — a win-back email campaign draft for a lapsed cohort, shaped
//             for the existing campaign composer.
//
// Auth mirrors social-ai: the stylist passes their Supabase access_token
// in the body; we resolve the user and load their real business name +
// city server-side. The per-client brief (first name, last style, days
// overdue) is sent by the client — it's already computed on-device by the
// rebooking engine, and carries no contact details.
//
// Guardrail: the model is told never to invent an offer; any incentive is
// passed through verbatim from the stylist's optional `offer` field.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { chargeAiCredits, refundAiCredits, outOfCreditsMessage } from "../../lib/ai-credits";
import {
  buildNudgeSystem,
  buildWinbackSystem,
  rebookTool,
  parseNudge,
  parseWinback,
  cleanBrief,
  cleanWinbackBrief,
  toneForBrief,
  firstNameOf,
  REBOOK_TOOL_NAME,
  REBOOK_AI_KINDS,
  REBOOK_CHANNELS,
  REBOOK_TONES,
  REBOOK_AI_MAX_OFFER,
  type RebookAiKind,
  type RebookChannel,
  type RebookTone,
  type StudioContext,
} from "../../lib/rebooking-ai";
import { rateLimit } from "../../lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fail = (status: number, message: string) =>
  NextResponse.json({ error: message }, { status });

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};

type Body = {
  access_token?: string;
  kind?: string;
  channel?: string;
  tone?: string;
  offer?: string;
  brief?: unknown; // nudge
  cohort?: unknown; // winback
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid JSON body.");
  }

  const kind = String(body.kind || "") as RebookAiKind;
  if (!REBOOK_AI_KINDS.includes(kind)) return fail(400, "Unknown request kind.");

  const accessToken = (body.access_token || "").trim();
  if (!accessToken) return fail(401, "Please sign in again.");

  const channel: RebookChannel = REBOOK_CHANNELS.includes(body.channel as RebookChannel)
    ? (body.channel as RebookChannel)
    : "sms";
  const toneOverride = REBOOK_TONES.includes(body.tone as RebookTone) ? (body.tone as RebookTone) : null;
  const offer = (body.offer || "").trim().slice(0, REBOOK_AI_MAX_OFFER);

  // Config / graceful degradation.
  let anthropicKey: string;
  let supabaseUrl: string;
  let serviceKey: string;
  try {
    anthropicKey = env("ANTHROPIC_API_KEY");
  } catch {
    return fail(503, "AI rebooking is temporarily unavailable.");
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

  const { data: userData, error: userErr } = await admin.auth.getUser(accessToken);
  if (userErr || !userData?.user) return fail(401, "Could not identify the signed-in user.");
  const userId = userData.user.id;

  const gate = rateLimit("rebooking-ai:user", userId, 40, 60_000);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "You're generating a lot at once — give it a moment." },
      { status: 429, headers: { "retry-after": String(gate.retryAfter) } },
    );
  }

  // Real business context for voice.
  const ctx: StudioContext = { businessName: "Your studio" };
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
    /* non-fatal */
  }

  // Build prompt + tool for this kind.
  let system: string;
  let tool: ReturnType<typeof rebookTool>;
  let toolName: string;
  let userText: string;

  if (kind === "nudge") {
    const brief = cleanBrief(body.brief);
    const tone: RebookTone = toneForBrief(brief, toneOverride);
    system = buildNudgeSystem(ctx, brief, channel, tone, offer);
    tool = rebookTool("nudge", channel);
    toolName = channel === "sms" ? REBOOK_TOOL_NAME.nudge_sms : REBOOK_TOOL_NAME.nudge_email;
    userText = `Write the ${channel === "sms" ? "text message" : "email"} to ${firstNameOf(brief.firstName)}.`;
  } else {
    const cohort = cleanWinbackBrief(body.cohort);
    const tone: RebookTone = toneOverride || "warm";
    system = buildWinbackSystem(ctx, cohort, tone, offer);
    tool = rebookTool("winback", "email");
    toolName = REBOOK_TOOL_NAME.winback;
    userText = "Draft the win-back campaign.";
  }

  const charge = await chargeAiCredits(admin, userId, "rebooking-ai");
  if (!charge.ok) {
    if (charge.reason === "insufficient_credits") {
      return fail(402, outOfCreditsMessage(charge.needed, charge.balance));
    }
    return fail(502, "Couldn't start that. Please try again.");
  }

  try {
    const client = new Anthropic({ apiKey: anthropicKey });
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system,
      tools: [tool],
      tool_choice: { type: "tool", name: toolName },
      messages: [{ role: "user", content: [{ type: "text", text: userText }] }],
    });
    const toolUse = msg.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    const input = toolUse?.input ?? null;

    const result =
      kind === "nudge" ? parseNudge(input, channel) : parseWinback(input);
    if (!result) {
      await refundAiCredits(admin, userId, "rebooking-ai", charge.charged);
      return fail(502, "Couldn't generate that — please try again.");
    }
    return NextResponse.json({ ok: true, kind, result, credits_balance: charge.balance });
  } catch (e: any) {
    await refundAiCredits(admin, userId, "rebooking-ai", charge.charged);
    if (e instanceof Anthropic.APIError && e.status === 429) {
      return fail(429, "We're a little busy — please try again in a moment.");
    }
    return fail(502, "Couldn't generate that right now. Please try again.");
  }
}
