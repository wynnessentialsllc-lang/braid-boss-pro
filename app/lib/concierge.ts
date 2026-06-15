// Booking concierge — pure helpers + types for the public chat assistant.
//
// A client on the booking page asks free-form questions ("do you do
// micros?", "how long for waist-length knotless?", "what's your
// cancellation fee?"). The /api/booking-concierge route resolves the
// slug, loads the stylist's REAL catalog + policy, and asks Claude to
// reply — choosing, never inventing, from that data. Everything here is
// pure so it can be unit-tested without the network or the model.
//
// Guardrails baked into the system prompt: the model never produces a
// price (it points at a real catalog service whose price the UI already
// shows), never promises a specific open slot (it sends the client to
// the calendar), and never collects payment.

export type ConciergeRole = "user" | "assistant";

export interface ConciergeMessage {
  role: ConciergeRole;
  content: string;
}

// The slimmed catalog row the model reasons over. Prices stay in the
// payload only so the model can talk about them in words; the authoritative
// figure the client books against is the one the page already renders.
export interface ConciergeServiceLite {
  id: string;
  name: string;
  price: number;
  durationHours: number;
  description?: string | null;
}

export interface ConciergeContext {
  businessName: string;
  currency: string;
  services: ConciergeServiceLite[];
  /** One-line summary of the no-show / cancellation policy, or null. */
  noShowFeeNote?: string | null;
}

// Conversation + per-message caps. The history is client-supplied (the
// endpoint is stateless), so it's untrusted: clamp it before it reaches
// the model to bound cost and block prompt-stuffing.
export const CONCIERGE_MAX_MESSAGES = 20;
export const CONCIERGE_MAX_CHARS = 1500;

export const CONCIERGE_TOOL_NAME = "concierge_reply";

/**
 * Clamp untrusted client history into a safe, well-formed transcript:
 * keep only valid roles, trim/limit each message, drop empties, keep the
 * most recent CONCIERGE_MAX_MESSAGES, and collapse any leading assistant
 * turn so the transcript always starts with the user.
 */
export const sanitizeHistory = (raw: unknown): ConciergeMessage[] => {
  if (!Array.isArray(raw)) return [];
  const cleaned: ConciergeMessage[] = [];
  for (const m of raw) {
    const role = (m as any)?.role;
    const content = (m as any)?.content;
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string") continue;
    const text = content.trim().slice(0, CONCIERGE_MAX_CHARS);
    if (!text) continue;
    cleaned.push({ role, content: text });
  }
  const recent = cleaned.slice(-CONCIERGE_MAX_MESSAGES);
  // A transcript that opens on an assistant turn confuses the model and
  // some API validations — drop leading assistant messages.
  while (recent.length && recent[0].role === "assistant") recent.shift();
  return recent;
};

const money = (n: number, currency: string): string => {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `$${Math.round(n)}`;
  }
};

/**
 * Build the system prompt. The catalog is rendered as compact lines the
 * model can quote verbatim; the rules keep it honest about pricing,
 * availability, and scope.
 */
export const buildSystemPrompt = (ctx: ConciergeContext): string => {
  const biz = (ctx.businessName || "this studio").trim();
  const lines = ctx.services.length
    ? ctx.services
        .map((s) => {
          const dur = s.durationHours > 0 ? `, ~${s.durationHours}h` : "";
          const desc = s.description?.trim()
            ? ` — ${s.description.trim().slice(0, 160)}`
            : "";
          return `- [${s.id}] ${s.name} (${money(s.price, ctx.currency)}${dur})${desc}`;
        })
        .join("\n")
    : "(no services are listed yet)";

  const policy = ctx.noShowFeeNote?.trim()
    ? `\nPolicy: ${ctx.noShowFeeNote.trim()}`
    : "";

  return [
    `You are the friendly booking assistant for ${biz}, a hair-braiding studio. You help clients on the booking page understand the services and decide what to book.`,
    "",
    "Rules:",
    `- Answer ONLY from the catalog and policy below. Never invent services, prices, durations, or availability.`,
    `- Do not state a price the catalog doesn't list. If a client asks "how much", name the matching service and let its listed price speak; never make up a number or a discount.`,
    `- You cannot see the live calendar. For "when are you free?" or specific dates, tell them to pick a date on the booking calendar on this page.`,
    `- You never take payment or finalize a booking. Custom styles go to the stylist for review.`,
    `- Keep replies short and warm — 1 to 3 sentences. Use emoji sparingly, at most one.`,
    `- When one catalog service clearly fits what they want, set suggestedServiceId to that service's id so the page can highlight it.`,
    `- Set readyToBook to true once the client signals they want to book or asks how to start.`,
    `- If something isn't covered here, say you'll let the stylist confirm rather than guessing.`,
    "",
    "Catalog:",
    lines,
    policy,
  ].join("\n");
};

// Forced-tool schema = robust structured output across SDK versions, the
// same approach the style-consult route trusts.
export const conciergeTool = () => ({
  name: CONCIERGE_TOOL_NAME,
  description: "Reply to the client and optionally highlight a catalog service.",
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    required: ["reply", "suggestedServiceId", "readyToBook"],
    properties: {
      reply: {
        type: "string",
        description: "The message shown to the client. 1-3 short sentences.",
      },
      suggestedServiceId: {
        type: "string",
        description: 'A catalog id to highlight, or "" if none fits.',
      },
      readyToBook: {
        type: "boolean",
        description: "True when the client signals intent to book.",
      },
    },
  },
});

export interface ConciergeReply {
  reply: string;
  suggestedServiceId: string | null;
  readyToBook: boolean;
}

/**
 * Validate the model's tool output. suggestedServiceId is pinned to a real
 * catalog id (anything else becomes null) so a hallucinated id can never
 * reach the UI.
 */
export const parseConciergeReply = (
  input: unknown,
  services: ConciergeServiceLite[],
): ConciergeReply | null => {
  const obj = (input ?? {}) as Record<string, unknown>;
  const reply = typeof obj.reply === "string" ? obj.reply.trim() : "";
  if (!reply) return null;
  const rawId = typeof obj.suggestedServiceId === "string" ? obj.suggestedServiceId : "";
  const suggestedServiceId = services.some((s) => s.id === rawId) ? rawId : null;
  return {
    reply,
    suggestedServiceId,
    readyToBook: obj.readyToBook === true,
  };
};
