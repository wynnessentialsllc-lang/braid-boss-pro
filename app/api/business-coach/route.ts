// POST /api/business-coach — the AI "daily briefing". The client computes
// a CoachSnapshot on-device (aggregate numbers + first-names-only top
// rebooking opportunities, no contact details) and posts it here. We
// resolve the stylist, load their business + owner name, and ask Claude to
// narrate the snapshot into a headline + summary + 2-3 concrete actions.
//
// The model only rephrases the numbers we send — it can't invent figures.
// Auth + degradation mirror the other owner AI endpoints.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import {
  cleanSnapshot,
  buildCoachSystem,
  coachTool,
  parseCoachBriefing,
  COACH_TOOL_NAME,
  type CoachContext,
} from "../../lib/business-coach";
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

export async function POST(req: Request) {
  let body: { access_token?: string; snapshot?: unknown; owner_first_name?: string };
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid JSON body.");
  }

  const accessToken = (body.access_token || "").trim();
  if (!accessToken) return fail(401, "Please sign in again.");
  const ownerFirstName = (body.owner_first_name || "").trim().slice(0, 40).split(/\s+/)[0] || null;

  let anthropicKey: string;
  let supabaseUrl: string;
  let serviceKey: string;
  try {
    anthropicKey = env("ANTHROPIC_API_KEY");
  } catch {
    return fail(503, "The AI coach is temporarily unavailable.");
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

  const gate = rateLimit("business-coach:user", userId, 20, 60_000);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Give the coach a moment between briefings." },
      { status: 429, headers: { "retry-after": String(gate.retryAfter) } },
    );
  }

  // Business + owner name for a personal tone.
  const ctx: CoachContext = { businessName: "your studio", ownerFirstName };
  try {
    const { data: link } = await admin
      .from("booking_links")
      .select("business_name")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (link?.business_name) ctx.businessName = String(link.business_name);
  } catch {
    /* non-fatal */
  }

  const snapshot = cleanSnapshot(body.snapshot);

  try {
    const client = new Anthropic({ apiKey: anthropicKey });
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: buildCoachSystem(snapshot, ctx),
      tools: [coachTool()],
      tool_choice: { type: "tool", name: COACH_TOOL_NAME },
      messages: [{ role: "user", content: [{ type: "text", text: "Give me today's briefing." }] }],
    });
    const toolUse = msg.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    const briefing = parseCoachBriefing(toolUse?.input ?? null);
    if (!briefing) return fail(502, "Couldn't generate your briefing — please try again.");
    return NextResponse.json({ ok: true, briefing });
  } catch (e: any) {
    if (e instanceof Anthropic.APIError && e.status === 429) {
      return fail(429, "We're a little busy — please try again in a moment.");
    }
    return fail(502, "Couldn't generate your briefing right now. Please try again.");
  }
}
