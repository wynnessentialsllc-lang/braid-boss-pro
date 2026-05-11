// Notification queue — scaffolding for Phase B12.1.
//
// This file is INTENTIONALLY INERT. It exports types, an interface,
// and TODO stubs so future PRs land cleanly without re-shaping the
// import surface. None of the functions perform any side effects in
// B12.0. See docs/b12_1_notification_architecture.md for the full
// design.
//
// Why scaffold now:
//   • Lock the import shape so call sites (contracts.ts, page.tsx,
//     booking flow) compile against stable signatures.
//   • Force future PRs to pick a single canonical pathway
//     (enqueueNotification) instead of growing per-feature send
//     helpers across the codebase.
//   • Keep typecheck green during B12.1 incremental landings.
//
// DO NOT add runtime logic here in B12.0. B12.1 will:
//   1. Add a `notification_queue` table via migration.
//   2. Add a `notification-dispatch` Supabase edge function.
//   3. Replace the stub bodies below with real DB writes + REST calls
//      to Resend / Twilio.
//
// Until then every function is a no-op or returns a stub result.

// =====================================================================
// Types — stable surface for call sites
// =====================================================================

export type NotificationChannel = "email" | "sms" | "in_app" | "system";

/**
 * Event-level message types the queue will know how to dispatch.
 * Keep this list narrow and explicit — each value should map to a
 * single template in the email / SMS layer. Add new values here
 * before adding new call sites.
 */
export type NotificationMessageType =
  | "booking_confirmation"
  | "appointment_reminder"
  | "prep_reminder"
  | "contract_request"
  | "contract_invite"
  | "contract_signed_owner_alert"
  | "contract_declined_owner_alert"
  | "contract_reminder"
  | "deposit_paid_owner_alert"
  | "deposit_expired_client"
  | "cancellation_notice";

/**
 * Mirrors the values in `communication_logs.status` enum. The queue
 * row tracks the in-flight states (`queued` / `processing`); the
 * communication_logs row tracks the terminal states + provider
 * webhook deliveries.
 */
export type NotificationStatus =
  | "queued"
  | "processing"
  | "sent"
  | "delivered"
  | "failed"
  | "opened"
  | "clicked"
  | "skipped"
  | "cancelled";

/**
 * Enqueue payload — the public input shape every call site uses.
 * The dispatcher fan-outs from this to provider-specific shapes.
 */
export type EnqueueNotificationInput = {
  channel: NotificationChannel;
  messageType: NotificationMessageType;
  recipient: string;                   // email, phone, or in_app target id
  subject?: string | null;
  body?: string | null;
  /** ISO timestamp; omit for immediate dispatch. */
  scheduledFor?: string | null;
  /** Idempotency key. Suggested patterns in the architecture doc. */
  dedupeKey?: string | null;
  /** Foreign-key hints — written into the queue row and copied to
   *  communication_logs so owner-side dashboards can join on whichever
   *  they have. */
  userId: string;                      // owner / stylist
  clientId?: string | null;
  bookingRequestId?: string | null;
  appointmentId?: string | null;
  bookingContractId?: string | null;
  /** Free-form payload for template rendering inside the dispatcher. */
  templateData?: Record<string, unknown> | null;
};

export type EnqueueNotificationResult =
  | { ok: true; queueId: string }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; error: string };

/**
 * The single outbound payload shape every provider implementation
 * receives. The dispatcher renders templates into this shape before
 * handing off.
 */
export type OutboundPayload = {
  to: string;
  subject?: string | null;
  body?: string | null;
  html?: string | null;
  /** Provider-specific extras (e.g. Resend list-unsubscribe headers). */
  extra?: Record<string, unknown> | null;
};

export type ProviderResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; retryable: boolean; error: string };

/**
 * Provider abstraction. B12.1 implements ResendProvider first,
 * TwilioProvider in B12.1c. InAppProvider already covered by the
 * existing in-app notification builder.
 */
export interface NotificationProvider {
  channel: NotificationChannel;
  send(payload: OutboundPayload): Promise<ProviderResult>;
}

/**
 * Opt-out record. Schema lands in B12.1b; shape pinned here so the
 * dispatcher's preference-check helper has a stable target type.
 */
export type ClientCommunicationPreferences = {
  userId: string;
  clientId: string;
  emailOptOut: boolean;
  smsOptOut: boolean;
  optedOutAt: string | null;
  optOutSource: "manual" | "sms_stop_reply" | "email_unsubscribe" | null;
};

// =====================================================================
// Stubs — DO NOT USE IN B12.0
// =====================================================================
//
// Every function below is intentionally inert. Importing them is
// safe; calling them returns a stub result that downstream code can
// branch on. B12.1 swaps the bodies for real implementations without
// changing signatures.

const NOT_IMPLEMENTED = "notification_queue_not_implemented_in_b12_0";

/**
 * Enqueue a notification for dispatch.
 *
 * TODO(B12.1a): INSERT into `notification_queue` with the resolved
 * scheduledFor; return the new row id.
 *
 * @example
 *   await enqueueNotification({
 *     channel: "email",
 *     messageType: "contract_invite",
 *     recipient: client.email,
 *     userId: stylist.id,
 *     bookingContractId: contract.id,
 *     dedupeKey: `contract_invite:${contract.id}`,
 *     templateData: { contractTitle, contractUrl, ... },
 *   });
 */
export const enqueueNotification = async (
  input: EnqueueNotificationInput,
): Promise<EnqueueNotificationResult> => {
  // Intentional no-op in B12.0. Call sites added before B12.1a lands
  // will silently skip rather than throw — preserves booking submit
  // resilience during the transition.
  void input;
  return { ok: false, skipped: true, reason: NOT_IMPLEMENTED };
};

/**
 * Cancel a queued notification by dedupe key. Used when the
 * underlying booking is cancelled before the scheduled send fires.
 *
 * TODO(B12.1a): UPDATE notification_queue SET status='cancelled'
 * WHERE dedupe_key = ? AND status IN ('queued','processing').
 */
export const cancelQueuedNotification = async (
  dedupeKey: string,
): Promise<{ ok: boolean; cancelled: number }> => {
  void dedupeKey;
  return { ok: false, cancelled: 0 };
};

/**
 * Resolve the canonical OutboundPayload from an enqueue input. The
 * dispatcher uses this. Exposed here so unit tests in B12.1 can
 * verify templates compile correctly against real DB data.
 *
 * TODO(B12.1a): render templates from `app/lib/email.ts` build*
 * helpers based on messageType + templateData.
 */
export const renderOutboundPayload = (
  input: EnqueueNotificationInput,
): OutboundPayload | null => {
  void input;
  return null;
};

/**
 * Check the client's opt-out preferences before enqueueing or
 * dispatching. Returns true if sending is allowed on this channel.
 *
 * TODO(B12.1b): SELECT email_opt_out / sms_opt_out from
 * client_communication_preferences. Default ALLOW when no row.
 */
export const isChannelAllowedForClient = async (
  userId: string,
  clientId: string | null,
  channel: NotificationChannel,
): Promise<boolean> => {
  void userId; void clientId; void channel;
  return true;
};

/**
 * Mirror a queue row's terminal status into communication_logs so
 * owner-side dashboards have a single audit surface.
 *
 * TODO(B12.1a): UPSERT communication_logs row keyed by
 * (provider_message_id) or fresh INSERT when no provider id yet.
 */
export const recordCommLog = async (args: {
  userId: string;
  channel: NotificationChannel;
  messageType: NotificationMessageType;
  recipient: string | null;
  subject: string | null;
  body: string | null;
  status: NotificationStatus;
  provider?: string | null;
  providerMessageId?: string | null;
  errorMessage?: string | null;
  bookingContractId?: string | null;
  bookingRequestId?: string | null;
  appointmentId?: string | null;
  clientId?: string | null;
  sentAt?: string | null;
  deliveredAt?: string | null;
}): Promise<{ ok: boolean }> => {
  void args;
  return { ok: false };
};

// =====================================================================
// Dedupe-key helpers
// =====================================================================
//
// Conventions documented in docs/b12_1_notification_architecture.md
// §6. Helpers exist so call sites don't free-form construct keys and
// drift apart over time.

export const dedupe = {
  contractInvite: (bookingContractId: string) =>
    `contract_invite:${bookingContractId}`,
  contractSignedOwnerAlert: (bookingContractId: string) =>
    `contract_signed:${bookingContractId}`,
  contractDeclinedOwnerAlert: (bookingContractId: string) =>
    `contract_declined:${bookingContractId}`,
  contractReminder: (bookingContractId: string, offsetHours: number) =>
    `contract_reminder_${offsetHours}h:${bookingContractId}`,
  depositPaidOwnerAlert: (bookingRequestId: string) =>
    `deposit_paid:${bookingRequestId}`,
  apptReminder48h: (appointmentId: string) =>
    `appt_reminder_48h:${appointmentId}`,
  apptReminder24h: (appointmentId: string) =>
    `appt_reminder_24h:${appointmentId}`,
  apptReminder2h: (appointmentId: string) =>
    `appt_reminder_2h:${appointmentId}`,
};
