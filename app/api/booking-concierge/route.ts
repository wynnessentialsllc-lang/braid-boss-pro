// POST /api/booking-concierge — public, anon-callable chat assistant for
// the booking page.
//
// The client sends their slug + the running conversation; we resolve the
// slug to the stylist, load their ACTIVE catalog + no-show policy, and ask
// Claude to reply from that data. Prices are NEVER produced by the model —
// it can only reference services that exist, and suggestedServiceId is
// pinned back to a real catalog id in parseConciergeReply().
//
// Stateless: the transcript lives on the client and is re-sent each turn,
// so there's no table to provision. The history is untrusted, so it's
// clamped (length + count) before it reaches the model.
//
// Degrades gracefully: with no ANTHROPIC_API_KEY it returns 503 so the
// booking page can hide/soft-disable the chat instead of erroring.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import {
  sanitizeHistory,
  buildSystemPrompt,
  conciergeTool,
  parseConciergeReply,
  buildAvailabilityNote,
  CONCIERGE_TOOL_NAME,
  type ConciergeServiceLite,
  type MonthAvailabilityRow,
} from "../../lib/concierge";
import { rateLimit, clientIp } from "../../lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fail = (status: number, message: string) =>
  NextResponse.json({ error: message }, { status });

const tooMany = (retryAfter: number) =>
  NextResponse.json(
    { error: "Too many messages — please wait a moment and try again." },
    { status: 429, headers: { "retry-after": String(retryAfter) } },
  );

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};

type Body = {
  slug?: string;
  messages?: unknown;
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

  // Clamp the untrusted, client-supplied transcript before any work.
  const messages = sanitizeHistory(body.messages);
  if (!messages.length) return fail(400, "Send a message to start.");
  if (messages[messages.length - 1].role !== "user") {
    return fail(400, "The last message must be from the client.");
  }

  // Cost-abuse guard: this endpoint fans out to Claude on every call.
  const ip = clientIp(req);
  const ipGate = rateLimit("concierge:ip", ip, 20, 60_000);
  if (!ipGate.ok) return tooMany(ipGate.retryAfter);
  const slugGate = rateLimit("concierge:slug", slug.toLowerCase(), 60, 60_000);
  if (!slugGate.ok) return tooMany(slugGate.retryAfter);

  // Graceful degradation when the AI key isn't configured.
  let anthropicKey: string;
  let supabaseUrl: string;
  let serviceKey: string;
  try {
    anthropicKey = env("ANTHROPIC_API_KEY");
  } catch {
    return fail(503, "The booking assistant is temporarily unavailable. You can still browse services and book below.");
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

  // Resolve slug -> stylist (same RPC the booking page uses).
  let userId: string | null = null;
  let businessName = "this studio";
  try {
    const { data, error } = await admin.rpc("public_resolve_booking_slug", { slug_in: slug });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : (data as any);
    userId = row?.user_id ? String(row.user_id) : null;
    if (row?.business_name) businessName = String(row.business_name);
  } catch {
    return fail(502, "Couldn't look up this booking link.");
  }
  if (!userId) return fail(404, "Booking link not found.");

  // Fetch the ACTIVE catalog — the only services the model may reference.
  let services: ConciergeServiceLite[] = [];
  try {
    const { data, error } = await admin
      .from("services")
      .select("id, name, description, base_price, duration_hours, is_active")
      .eq("user_id", userId)
      .eq("is_active", true);
    if (error) throw error;
    services = (data || []).map((s: any) => ({
      id: String(s.id),
      name: String(s.name || "Service"),
      price: Number(s.base_price) || 0,
      durationHours: Number(s.duration_hours) || 0,
      description: s.description ?? null,
    }));
  } catch {
    return fail(502, "Couldn't load the stylist's services.");
  }

  // No-show policy, best-effort — a one-liner the model can quote. Failure
  // here just means the assistant won't speak to the policy.
  let noShowFeeNote: string | null = null;
  try {
    const { data } = await admin.rpc("public_get_no_show_fee", { user_id_in: userId });
    const row = Array.isArray(data) ? data[0] : (data as any);
    if (row?.enabled) {
      const type = String(row.type || "");
      const value = Number(row.value) || 0;
      if (value > 0) {
        noShowFeeNote =
          type === "percent"
            ? `A no-show / late-cancellation fee of ${value}% of the service price applies.`
            : `A no-show / late-cancellation fee of $${value} applies.`;
      }
    }
  } catch {
    /* ignore — policy line is non-critical */
  }

  // Live availability, best-effort — gives the assistant the next open days
  // so it can answer "when are you free?". We pull this month + next month
  // (covers month-boundary questions) and summarize the soonest openings.
  // Any failure just falls back to "check the calendar".
  let availabilityNote: string | null = null;
  try {
    const todayIso = new Date().toISOString().slice(0, 10);
    const [y, m] = todayIso.split("-").map(Number);
    const nextY = m === 12 ? y + 1 : y;
    const nextM = m === 12 ? 1 : m + 1;
    const months = await Promise.all([
      admin.rpc("public_get_month_availability", { slug_in: slug, year_in: y, month_in: m }),
      admin.rpc("public_get_month_availability", { slug_in: slug, year_in: nextY, month_in: nextM }),
    ]);
    const rows: MonthAvailabilityRow[] = [];
    for (const r of months) {
      if (Array.isArray(r.data)) {
        for (const row of r.data as any[]) {
          rows.push({ day_iso: String(row.day_iso), slot_count: Number(row.slot_count) || 0, status: row.status ?? null });
        }
      }
    }
    availabilityNote = buildAvailabilityNote(rows, todayIso, 6);
  } catch {
    /* non-critical — assistant will point to the calendar */
  }

  const system = buildSystemPrompt({ businessName, currency: "USD", services, noShowFeeNote, availabilityNote });

  try {
    const client = new Anthropic({ apiKey: anthropicKey });
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
      system,
      tools: [conciergeTool()],
      tool_choice: { type: "tool", name: CONCIERGE_TOOL_NAME },
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
    const toolUse = msg.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    const parsed = toolUse ? parseConciergeReply(toolUse.input, services) : null;
    if (!parsed) {
      return fail(502, "Couldn't get a reply just now. Please try again or book below.");
    }
    return NextResponse.json({
      ok: true,
      reply: parsed.reply,
      suggestedServiceId: parsed.suggestedServiceId,
      readyToBook: parsed.readyToBook,
    });
  } catch (e: any) {
    if (e instanceof Anthropic.APIError && e.status === 429) {
      return fail(429, "We're a little busy — please try again in a moment.");
    }
    return fail(502, "Couldn't reach the assistant right now. You can still book below.");
  }
}
