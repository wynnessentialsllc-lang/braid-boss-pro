// One-off outreach to a single client — send a stylist-composed (or
// AI-written) message straight to the email/phone on file instead of
// copy-pasting it into another app.
//
// The send itself is server-side: send_client_outreach validates that
// the client belongs to the caller, applies the same consent gate a
// marketing campaign uses, and enqueues onto the existing notification
// queue. This module is the thin call + the human-readable reasons.

import { getSupabase } from "./supabase";

export type OutreachChannel = "email" | "sms";

export type OutreachResult = {
  ok: boolean;
  channel: OutreachChannel;
  to?: string | null;
  // Present when ok is false — already phrased for the stylist.
  error?: string;
};

// Why a send was refused, in the stylist's terms. The RPC returns a
// stable reason code; the wording lives here so it can change without
// a migration.
const REASON_COPY: Record<string, string> = {
  not_authenticated: "Your session expired — please sign in again.",
  bad_channel: "Pick email or text first.",
  empty: "There's no message to send yet.",
  not_found: "Couldn't find that client.",
  no_email: "No email address on file for this client.",
  unsubscribed: "This client unsubscribed from marketing emails.",
  sms_off: "Turn on text messaging in Settings → SMS first.",
  sms_marketing_off: "Turn on promotional texts in Settings → SMS first.",
  no_phone: "No mobile number on file for this client.",
  stopped: "This client replied STOP, so texts to them are turned off.",
  no_sms_consent: "This client hasn't agreed to promotional texts. Send an email instead.",
  no_credits: "You're out of SMS credits. Top up in Settings → SMS credits.",
  sms_disabled: "Turn on text messaging in Settings → SMS first.",
};

const humanReason = (reason: string): string =>
  REASON_COPY[reason] || "Couldn't send that message. Please try again.";

export const sendClientOutreach = async (
  clientId: string,
  channel: OutreachChannel,
  subject: string | null,
  body: string,
): Promise<OutreachResult> => {
  if (!clientId || !(body || "").trim()) {
    return { ok: false, channel, error: REASON_COPY.empty };
  }
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc("send_client_outreach", {
      client_id_in: clientId,
      channel_in: channel,
      subject_in: subject || null,
      body_in: body,
    });
    if (error) return { ok: false, channel, error: humanReason("") };
    const v = (data || {}) as { ok?: boolean; reason?: string; to?: string | null };
    if (v.ok !== true) {
      return { ok: false, channel, error: humanReason(String(v.reason || "")) };
    }
    return { ok: true, channel, to: v.to ?? null };
  } catch {
    return { ok: false, channel, error: humanReason("") };
  }
};

// Mask a destination for the confirmation line — enough to confirm it's
// the right person without printing the full address in a screenshot.
export const maskDestination = (channel: OutreachChannel, to?: string | null): string => {
  const v = (to || "").trim();
  if (!v) return channel === "email" ? "their email" : "their phone";
  if (channel === "email") {
    const at = v.indexOf("@");
    if (at <= 0) return v;
    const name = v.slice(0, at);
    const domain = v.slice(at);
    const head = name.slice(0, Math.min(2, name.length));
    return `${head}${"•".repeat(Math.max(1, name.length - head.length))}${domain}`;
  }
  const digits = v.replace(/\D/g, "");
  if (digits.length < 4) return v;
  return `•••• ${digits.slice(-4)}`;
};
