// Notification queue — Phase B12.1a.
//
// Universal outbound queue. Email-only in this phase via Resend.
// SMS, scheduled reminders, opt-out, and Communication Log UI land
// in B12.1b–e. See docs/b12_1_notification_architecture.md for the
// full design.
//
// Every call site for outbound messaging should go through
// `queueNotification`. Inline / one-shot sends are reserved for
// admin "manual resend" flows (which use the existing helpers in
// app/lib/email.ts directly).

import { getSupabase } from "./supabase";

// =====================================================================
// Types
// =====================================================================

export type NotificationChannel = "email" | "sms" | "in_app" | "system";

export type NotificationMessageType =
  | "booking_confirmation"
  | "appointment_reminder"
  | "prep_reminder"
  | "contract_request"
  | "contract_invite"
  | "contract_signing"
  | "contract_signed_owner_alert"
  | "contract_declined_owner_alert"
  | "contract_reminder"
  | "deposit_paid_owner_alert"
  | "deposit_expired_client"
  | "cancellation_notice";

export type NotificationStatus =
  | "queued"
  | "processing"
  | "sent"
  | "delivered"
  | "failed"
  | "opened"
  | "clicked"
  | "skipped"
  | "canceled"
  | "cancelled";

export type EnqueueNotificationInput = {
  channel: NotificationChannel;
  messageType: NotificationMessageType;
  recipient: string;
  subject?: string | null;
  body?: string | null;
  scheduledFor?: string | null;
  dedupeKey?: string | null;
  userId: string;
  clientId?: string | null;
  bookingRequestId?: string | null;
  appointmentId?: string | null;
  bookingContractId?: string | null;
  templateData?: Record<string, unknown> | null;
};

export type EnqueueNotificationResult =
  | { ok: true; queueId: string }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; error: string };

export type OutboundPayload = {
  to: string;
  subject?: string | null;
  body?: string | null;
  html?: string | null;
  extra?: Record<string, unknown> | null;
};

export type ProviderResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; retryable: boolean; error: string };

export interface NotificationProvider {
  channel: NotificationChannel;
  send(payload: OutboundPayload): Promise<ProviderResult>;
}

export type ClientCommunicationPreferences = {
  userId: string;
  clientId: string;
  emailOptOut: boolean;
  smsOptOut: boolean;
  optedOutAt: string | null;
  optOutSource: "manual" | "sms_stop_reply" | "email_unsubscribe" | null;
};

// =====================================================================
// Dedupe-key helpers — keep call sites converging on a stable convention
// =====================================================================

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
  bookingConfirmation: (bookingRequestId: string) =>
    `booking_confirmation:${bookingRequestId}`,
};

/** Stable convention so every call site can build the same key. */
export const buildDedupeKey = (
  scope: string,
  entityId: string | null | undefined,
): string | null => {
  if (!scope || !entityId) return null;
  return `${scope}:${entityId}`;
};

// =====================================================================
// Core API
// =====================================================================

const isEmailLike = (value: string | null | undefined): boolean =>
  !!value && /.+@.+\..+/.test(String(value).trim());

const isPhoneLike = (value: string | null | undefined): boolean =>
  !!value && String(value).replace(/\D/g, "").length >= 7;

/**
 * Enqueue an outbound message. Channel-aware recipient validation
 * happens both here (cheap pre-flight) and inside the
 * queue_notification RPC (authoritative). Dedupe is delegated to the
 * RPC's partial unique index — safe under concurrent writes.
 */
export const queueNotification = async (
  input: EnqueueNotificationInput,
): Promise<EnqueueNotificationResult> => {
  if (!input?.userId) {
    return { ok: false, skipped: true, reason: "missing_user_id" };
  }
  if (!input.body && !input.subject) {
    return { ok: false, skipped: true, reason: "empty_message" };
  }
  if (input.channel === "email" && !isEmailLike(input.recipient)) {
    return { ok: false, skipped: true, reason: "no_recipient_email" };
  }
  if (input.channel === "sms" && !isPhoneLike(input.recipient)) {
    return { ok: false, skipped: true, reason: "no_recipient_phone" };
  }
  if (input.channel === "in_app" || input.channel === "system") {
    // in_app + system channels are owner-side bell rows / audit logs
    // — they go through a different surface (buildNotifications +
    // communication_logs writes from the contract RPCs). The queue
    // is only for external send channels.
    return { ok: false, skipped: true, reason: "channel_not_queueable" };
  }

  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("queue_notification", {
    user_id_in: input.userId,
    channel_in: input.channel,
    notification_type_in: input.messageType,
    body_in: input.body || input.subject || "",
    subject_in: input.subject ?? null,
    recipient_email_in: input.channel === "email" ? input.recipient : null,
    recipient_phone_in: input.channel === "sms" ? input.recipient : null,
    payload_in: input.templateData ?? {},
    scheduled_for_in: input.scheduledFor ?? null,
    dedupe_key_in: input.dedupeKey ?? null,
    booking_request_id_in: input.bookingRequestId ?? null,
    appointment_id_in: input.appointmentId ?? null,
    client_id_in: input.clientId ?? null,
    contract_id_in: input.bookingContractId ?? null,
  });
  if (error) return { ok: false, error: error.message };
  const row = (data || {}) as { ok?: boolean; id?: string | null; skipped?: boolean; reason?: string };
  if (!row.ok) return { ok: false, error: row.reason || "rpc_failed" };
  if (row.skipped) {
    return { ok: false, skipped: true, reason: row.reason || "skipped" };
  }
  return { ok: true, queueId: String(row.id) };
};

/**
 * Convenience alias matching the original B12.0 scaffold signature
 * so existing call sites that imported `enqueueNotification` keep
 * compiling.
 */
export const enqueueNotification = queueNotification;

export type DueNotification = {
  id: string;
  user_id: string;
  channel: NotificationChannel;
  notification_type: NotificationMessageType;
  recipient_email: string | null;
  recipient_phone: string | null;
  recipient_name: string | null;
  subject: string | null;
  body: string;
  payload: Record<string, unknown>;
  scheduled_for: string;
  status: NotificationStatus;
  retry_count: number;
  dedupe_key: string | null;
  booking_request_id: string | null;
  appointment_id: string | null;
  client_id: string | null;
  contract_id: string | null;
};

/** Read-only inspection. Does not claim rows. */
export const getDueNotifications = async (
  limit: number = 25,
): Promise<DueNotification[]> => {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("get_due_notifications", {
    limit_in: limit,
  });
  if (error) throw new Error(error.message);
  const rows = (data as { rows?: DueNotification[] } | null)?.rows || [];
  return rows;
};

/**
 * Worker entry point. Atomically claims up to `limit` rows via
 * SELECT … FOR UPDATE SKIP LOCKED on the server. Multi-worker safe.
 */
export const markNotificationProcessing = async (
  limit: number = 25,
): Promise<DueNotification[]> => {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("mark_notification_processing", {
    limit_in: limit,
  });
  if (error) throw new Error(error.message);
  const rows = (data as { rows?: DueNotification[] } | null)?.rows || [];
  return rows;
};

export const markNotificationSent = async (
  id: string,
  args?: { provider?: string | null; providerMessageId?: string | null },
): Promise<{ ok: boolean }> => {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("mark_notification_sent", {
    id_in: id,
    provider_in: args?.provider ?? null,
    provider_message_id_in: args?.providerMessageId ?? null,
  });
  if (error) throw new Error(error.message);
  return { ok: !!(data as { ok?: boolean } | null)?.ok };
};

export const markNotificationFailed = async (
  id: string,
  reason?: string | null,
): Promise<{ ok: boolean; terminal: boolean; retryCount: number }> => {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("mark_notification_failed", {
    id_in: id,
    reason_in: reason ?? null,
  });
  if (error) throw new Error(error.message);
  const row = (data || {}) as { ok?: boolean; terminal?: boolean; retry_count?: number };
  return {
    ok: !!row.ok,
    terminal: !!row.terminal,
    retryCount: Number(row.retry_count) || 0,
  };
};

// =====================================================================
// Helpers reserved for B12.1b+ (still inert)
// =====================================================================

export const cancelQueuedNotification = async (
  dedupeKey: string,
): Promise<{ ok: boolean; cancelled: number }> => {
  // B12.1c will UPDATE notification_queue
  //   SET status='canceled'
  //   WHERE dedupe_key = ? AND status IN ('queued','processing')
  void dedupeKey;
  return { ok: false, cancelled: 0 };
};

export const renderOutboundPayload = (
  input: EnqueueNotificationInput,
): OutboundPayload | null => {
  // The dispatch worker renders templates inside the edge function
  // (closer to Resend). This client-side helper is reserved for
  // unit tests in a future phase.
  void input;
  return null;
};

export const isChannelAllowedForClient = async (
  userId: string,
  clientId: string | null,
  channel: NotificationChannel,
): Promise<boolean> => {
  // B12.1b ships client_communication_preferences. Until then we
  // default-allow on every channel.
  void userId; void clientId; void channel;
  return true;
};

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
  // Direct comm-log writes from the app are no longer the canonical
  // pathway — the queue's mark_notification_sent / _failed RPCs do
  // it server-side. Kept as a stub for any future ad-hoc writes
  // (admin manual override) that the UI may need.
  void args;
  return { ok: false };
};
