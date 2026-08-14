// Canonical deep-link format for notification targets.
//
// A push (web or native) carries `data.url`; tapping it must land on the
// thing the notification is ABOUT — an appointment reminder opens that
// appointment, a waitlist alert opens Waitlist, and so on.
//
// Before this module every sender invented its own query shape
// (`?focus=appointment&id=`, `?tab=schedule`, `?notification=reviews`)
// and the reader understood only two of them, so most taps silently
// no-opped and the app just refocused wherever it already was. This file
// is the single source of truth for both directions:
//
//   encodeTargetUrl(target) -> "/?n=appointment&id=appt_123"
//   decodeTargetUrl(url)    -> { kind: "appointment", appointmentId: "appt_123" }
//
// `decodeTargetUrl` also understands every legacy shape, because pushes
// already delivered to a device keep their old URL forever — a tap on a
// week-old notification must still route correctly.
//
// Deliberately dependency-free: imported by the service-worker-adjacent
// client dispatch path, by notification-rules, and by AppRoot. It must
// not import from AppRoot (which imports this) or pull in React.

/** Where a notification tap should land. Mirrors AppRoot's NotificationTarget. */
export type PushTarget =
  | { kind: "appointment"; appointmentId: string }
  | { kind: "client"; clientId: string; action?: "rebooking" }
  | { kind: "booking_approval"; requestId: string }
  | { kind: "email_log"; queueId: string }
  | { kind: "contract_view"; contractId: string }
  | { kind: "reminders" }
  | { kind: "schedule" }
  | { kind: "clientsTab" }
  | { kind: "reviews" }
  | { kind: "inbox" }
  | { kind: "packages" }
  | { kind: "styleRequests" }
  | { kind: "waitlist" };

export type PushTargetKind = PushTarget["kind"];

/** Query param carrying the target kind. Short — it rides in every push. */
export const TARGET_PARAM = "n";
/** Query param carrying the target's record id, when the kind needs one. */
export const TARGET_ID_PARAM = "id";
/** Query param carrying an optional sub-action (currently `rebooking`). */
export const TARGET_ACTION_PARAM = "a";

/** Kinds that address a specific record and are meaningless without an id. */
const KINDS_NEEDING_ID = new Set<string>([
  "appointment",
  "client",
  "booking_approval",
  "email_log",
  "contract_view",
]);

/** Kinds that address a whole screen. */
const STANDALONE_KINDS = new Set<string>([
  "reminders",
  "schedule",
  "clientsTab",
  "reviews",
  "inbox",
  "packages",
  "styleRequests",
  "waitlist",
]);

/** Read the id field off a target, whatever the kind calls it. */
const targetId = (target: PushTarget): string | null => {
  switch (target.kind) {
    case "appointment": return target.appointmentId || null;
    case "client": return target.clientId || null;
    case "booking_approval": return target.requestId || null;
    case "email_log": return target.queueId || null;
    case "contract_view": return target.contractId || null;
    default: return null;
  }
};

/**
 * Build the `data.url` for a push. Returns "/" when the target is
 * incomplete (e.g. an appointment target with no id) so the push still
 * opens the app rather than carrying a link that resolves to nothing.
 */
export const encodeTargetUrl = (target: PushTarget | null | undefined): string => {
  if (!target || !target.kind) return "/";
  const id = targetId(target);
  if (KINDS_NEEDING_ID.has(target.kind) && !id) return "/";

  const params = new URLSearchParams();
  params.set(TARGET_PARAM, target.kind);
  if (id) params.set(TARGET_ID_PARAM, id);
  if (target.kind === "client" && target.action === "rebooking") {
    params.set(TARGET_ACTION_PARAM, "rebooking");
  }
  return `/?${params.toString()}`;
};

/** Build a target from an already-parsed set of params, or null. */
const fromCanonical = (params: URLSearchParams): PushTarget | null => {
  const kind = params.get(TARGET_PARAM);
  if (!kind) return null;
  const id = params.get(TARGET_ID_PARAM) || "";

  if (KINDS_NEEDING_ID.has(kind) && !id) return null;

  switch (kind) {
    case "appointment": return { kind: "appointment", appointmentId: id };
    case "client":
      return params.get(TARGET_ACTION_PARAM) === "rebooking"
        ? { kind: "client", clientId: id, action: "rebooking" }
        : { kind: "client", clientId: id };
    case "booking_approval": return { kind: "booking_approval", requestId: id };
    case "email_log": return { kind: "email_log", queueId: id };
    case "contract_view": return { kind: "contract_view", contractId: id };
    default:
      return STANDALONE_KINDS.has(kind)
        ? ({ kind } as PushTarget)
        : null;
  }
};

/**
 * Legacy shapes, still live on already-delivered pushes and in older
 * email CTAs. Each maps onto exactly one canonical target.
 *
 *   ?focus=appointment&id=X          -> appointment
 *   ?focus=client&id=X[&action=…]    -> client
 *   ?focus=inbox                     -> inbox
 *   ?tab=schedule | ?tab=clients     -> schedule | clients tab
 *   ?notification=reviews            -> reviews
 */
const fromLegacy = (params: URLSearchParams): PushTarget | null => {
  const focus = params.get("focus");
  const id = params.get("id") || "";

  if (focus === "appointment") {
    return id ? { kind: "appointment", appointmentId: id } : null;
  }
  if (focus === "client") {
    if (!id) return null;
    return params.get("action") === "rebooking"
      ? { kind: "client", clientId: id, action: "rebooking" }
      : { kind: "client", clientId: id };
  }
  if (focus === "inbox") return { kind: "inbox" };

  const tab = params.get("tab");
  if (tab === "schedule") return { kind: "schedule" };
  if (tab === "clients") return { kind: "clientsTab" };

  // `?notification=<kind>` was emitted by internal_send_push and never
  // had a reader. Accept it as an alias for the canonical kinds.
  const legacyNotification = params.get("notification");
  if (legacyNotification) {
    const alias = new URLSearchParams();
    alias.set(TARGET_PARAM, legacyNotification);
    if (id) alias.set(TARGET_ID_PARAM, id);
    return fromCanonical(alias);
  }

  return null;
};

/**
 * Parse a push/deep-link URL into a target. Accepts absolute or relative
 * URLs. Returns null when the URL carries no recognisable target, which
 * callers should treat as "just open the app, don't navigate".
 */
export const decodeTargetUrl = (
  rawUrl: string | null | undefined,
  origin?: string,
): PushTarget | null => {
  if (!rawUrl) return null;
  let params: URLSearchParams;
  try {
    // A bare query string ("?n=inbox") is a valid input; URL needs a base.
    const base = origin
      || (typeof window !== "undefined" ? window.location.origin : "http://localhost");
    params = new URL(rawUrl, base).searchParams;
  } catch {
    return null;
  }
  return fromCanonical(params) || fromLegacy(params);
};
