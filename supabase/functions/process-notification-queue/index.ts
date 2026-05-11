// Edge Function: process-notification-queue
//
// Phase B12.1a — email dispatch worker.
//
// Each invocation atomically claims a batch of due notification_queue
// rows via mark_notification_processing (SELECT ... FOR UPDATE SKIP
// LOCKED), renders the appropriate email template from the row's
// notification_type + payload, sends through Resend, and records the
// outcome via mark_notification_sent / mark_notification_failed.
//
// Architecture invariants (do not redesign without updating the
// docs in docs/b12_1_notification_architecture.md):
//   1. Multi-worker safe — the claim path locks each row.
//   2. Idempotent — retried Stripe-style invocations cannot
//      re-send a row that's already in 'sent' / terminal 'failed'.
//   3. Worker-rendered — templates live inside the worker. The
//      app only enqueues the raw template data on `payload`. Old
//      enqueue rows that include `payload.html` are still
//      honored for backward compat.
//   4. Channel: email only in B12.1a. SMS rows are terminal-failed.
//
// Invocation:
//   * Manual: POST <fn URL> with bearer service-role
//   * Future: pg_cron or Vercel cron, every 60 seconds. Not
//     configured in this phase; see docs/b12_1a_deploy.md.

// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// =====================================================================
// Env
// =====================================================================
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "";

const BATCH_LIMIT = 25;
const RESEND_ENDPOINT = "https://api.resend.com/emails";

// =====================================================================
// Types — must mirror the column shape returned by
// mark_notification_processing.
// =====================================================================
type ClaimedRow = {
  id: string;
  user_id: string;
  channel: "email" | "sms";
  notification_type: string;
  recipient_email: string | null;
  recipient_phone: string | null;
  recipient_name: string | null;
  subject: string | null;
  body: string;
  payload: Record<string, any>;
  scheduled_for: string;
  status: string;
  retry_count: number;
  dedupe_key: string | null;
  booking_request_id: string | null;
  appointment_id: string | null;
  client_id: string | null;
  contract_id: string | null;
};

// =====================================================================
// Renderers — warm cream / gold / espresso palette. Single inline
// stylesheet, no external CSS, mobile-safe layout. Templates avoid
// images and webfonts so they render cleanly across every client.
// =====================================================================
const C = {
  espresso: "#1F140A",
  coffee: "#4A2C1A",
  cream: "#FAF6EE",
  paper: "#FFFFFF",
  hairline: "#E9DFC8",
  muted: "#9A8B72",
  gold: "#C9A961",
  goldDeep: "#A8893F",
};

const escape = (s: unknown): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const wrapHtml = (title: string, body: string): string => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title></head>
<body style="margin:0;background:${C.cream};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${C.espresso};">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <div style="background:${C.paper};border:1px solid ${C.hairline};border-radius:16px;padding:28px;box-shadow:0 1px 4px rgba(31,20,10,0.04);">
      ${body}
    </div>
    <p style="text-align:center;font-size:11px;color:${C.muted};margin-top:18px;">
      Sent by Braid Boss Pro
    </p>
  </div>
</body></html>`;

const ctaButton = (label: string, url: string): string => `
  <p style="margin:22px 0;text-align:center;">
    <a href="${escape(url)}" style="display:inline-block;background:${C.espresso};color:${C.cream};text-decoration:none;padding:14px 26px;border-radius:999px;font-weight:600;font-size:14px;letter-spacing:0.04em;">
      ${escape(label)}
    </a>
  </p>
`;

// ---- booking_confirmation -------------------------------------------
const renderBookingConfirmation = (p: Record<string, any>) => {
  const clientName  = p.clientName  || "there";
  const studioName  = p.studioName  || "your stylist";
  const serviceName = p.serviceName || null;
  const date        = p.preferredDate || null;
  const time        = p.preferredTime || null;
  const awaitingDeposit = p.approvalStatus === "awaiting_deposit";
  const depositRequired = !!p.depositRequired;
  const when = [date, time].filter(Boolean).join(" · ");

  const nextLine = awaitingDeposit
    ? "We've also sent a deposit link separately. Once your deposit lands and the stylist approves, your appointment is locked in."
    : depositRequired
      ? "Your stylist will review shortly. If a deposit is required, you'll receive a secure link by email."
      : "Your stylist will review and confirm shortly. You'll hear from us as soon as it's approved.";

  const subject = `Booking request received — ${studioName}`;
  const html = wrapHtml(subject, `
    <h1 style="font-size:20px;margin:0 0 12px;color:${C.espresso};">We've got it, ${escape(clientName)}.</h1>
    <p style="font-size:14px;line-height:22px;color:${C.coffee};">
      Your booking request${serviceName ? ` for <strong>${escape(serviceName)}</strong>` : ""}${when ? ` on <strong>${escape(when)}</strong>` : ""} has been received by ${escape(studioName)}.
    </p>
    <p style="font-size:14px;line-height:22px;color:${C.coffee};">${escape(nextLine)}</p>
    <p style="font-size:12px;color:${C.muted};line-height:18px;margin-top:18px;">
      We'll only email you about this booking. Reply to this message any time if you need to update something.
    </p>
  `);
  return { subject, html };
};

// ---- contract_signing (+ legacy alias contract_invite) --------------
const renderContractSigning = (p: Record<string, any>) => {
  const clientName    = p.clientName    || "there";
  const studioName    = p.studioName    || "your stylist";
  const contractTitle = p.contractTitle || "Appointment agreement";
  const serviceName   = p.serviceName   || null;
  const contractUrl   = String(p.contractUrl || "").trim();

  const subject = `Please review and sign your appointment agreement`;
  const cta = contractUrl
    ? ctaButton(`Review & sign — ${contractTitle}`, contractUrl)
    : "";
  const html = wrapHtml(subject, `
    <h1 style="font-size:20px;margin:0 0 12px;color:${C.espresso};">Hi ${escape(clientName)},</h1>
    <p style="font-size:14px;line-height:22px;color:${C.coffee};">
      Your stylist at ${escape(studioName)} sent an agreement for your upcoming${serviceName ? ` <strong>${escape(serviceName)}</strong>` : ""} appointment.
    </p>
    <p style="font-size:14px;line-height:22px;color:${C.coffee};">
      Please take a minute to review and sign:
    </p>
    ${cta}
    <p style="font-size:12px;color:${C.muted};line-height:18px;">
      Signing keeps your appointment time secure and policies clear.
    </p>
  `);
  return { subject, html };
};

// ---- generic fallback -----------------------------------------------
const renderGeneric = (row: ClaimedRow) => {
  const subject = row.subject || "Notification from Braid Boss Pro";
  const html = wrapHtml(subject, `
    <h1 style="font-size:20px;margin:0 0 12px;color:${C.espresso};">${escape(subject)}</h1>
    <pre style="font-size:14px;line-height:22px;color:${C.coffee};white-space:pre-wrap;font-family:inherit;margin:0;">${escape(row.body)}</pre>
  `);
  return { subject, html };
};

// ---- dispatcher -----------------------------------------------------
type Rendered = { subject: string; html: string };

const renderForRow = (row: ClaimedRow): Rendered => {
  // Backward compatibility: rows enqueued by older app builds put a
  // pre-rendered html string into payload.html. Honor that if
  // present; future enqueues just provide raw data and the
  // worker-side renderers take over.
  if (typeof row.payload?.html === "string" && row.payload.html.trim()) {
    return {
      subject: row.subject || "Notification from Braid Boss Pro",
      html: row.payload.html,
    };
  }

  switch (row.notification_type) {
    case "booking_confirmation":
      return renderBookingConfirmation(row.payload || {});
    case "contract_signing":
    case "contract_signing_email":
    case "contract_invite":
      return renderContractSigning(row.payload || {});
    default:
      return renderGeneric(row);
  }
};

// =====================================================================
// Resend
// =====================================================================
const sendViaResend = async (
  row: ClaimedRow,
  rendered: Rendered,
): Promise<
  | { ok: true; providerMessageId: string | null }
  | { ok: false; retryable: boolean; error: string }
> => {
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
    return { ok: false, retryable: false, error: "resend_env_missing" };
  }
  if (!row.recipient_email) {
    return { ok: false, retryable: false, error: "missing_recipient_email" };
  }
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to: row.recipient_email,
        subject: rendered.subject,
        html: rendered.html,
        text: row.body,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // 5xx + 429 → transient, retryable. Everything else → permanent.
      const retryable = res.status >= 500 || res.status === 429;
      return {
        ok: false,
        retryable,
        error: `resend_${res.status}: ${text.slice(0, 240)}`,
      };
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, providerMessageId: data?.id || null };
  } catch (e: any) {
    return { ok: false, retryable: true, error: `network: ${e?.message || e}` };
  }
};

// =====================================================================
// Helpers
// =====================================================================
const failTerminal = async (
  admin: ReturnType<typeof createClient>,
  id: string,
  reason: string,
): Promise<void> => {
  // mark_notification_failed increments retry_count by 1; after 3
  // increments the row terminates. Call it three times to force a
  // permanent failure on non-retryable errors. Each call sets
  // scheduled_for = now() + 5 min, so a concurrent worker tick
  // can't pick the row up between increments.
  for (let i = 0; i < 3; i++) {
    const { error } = await admin.rpc("mark_notification_failed", {
      id_in: id,
      reason_in: reason,
    });
    if (error) {
      console.warn(
        `[process-notification-queue] failTerminal increment ${i + 1} failed for ${id}: ${error.message}`,
      );
      break;
    }
  }
};

// =====================================================================
// HTTP handler
// =====================================================================
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "GET") {
    // Friendly health probe so ops can curl the URL.
    return json(200, { ok: true, endpoint: "process-notification-queue" });
  }
  if (req.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json(500, { error: "supabase_env_missing" });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Atomic claim
  const { data: claimRes, error: claimErr } = await admin.rpc(
    "mark_notification_processing",
    { limit_in: BATCH_LIMIT },
  );
  if (claimErr) {
    console.error(
      "[process-notification-queue] claim failed:",
      claimErr.message,
    );
    return json(500, { error: claimErr.message });
  }
  const rows: ClaimedRow[] =
    (claimRes as { rows?: ClaimedRow[] })?.rows || [];
  if (rows.length === 0) {
    return json(200, { processed: 0, sent: 0, failed: 0, skipped: 0 });
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  // 2. Per-row dispatch. Errors are contained to the row.
  await Promise.all(rows.map(async (row) => {
    try {
      if (row.channel === "sms") {
        await failTerminal(admin, row.id, "sms_not_implemented_in_b12_1a");
        skipped++;
        return;
      }
      if (row.channel !== "email") {
        await failTerminal(admin, row.id, `unsupported_channel:${row.channel}`);
        skipped++;
        return;
      }

      const rendered = renderForRow(row);
      const result = await sendViaResend(row, rendered);

      if (result.ok) {
        const { error } = await admin.rpc("mark_notification_sent", {
          id_in: row.id,
          provider_in: "resend",
          provider_message_id_in: result.providerMessageId,
        });
        if (error) {
          console.error(
            `[process-notification-queue] mark_sent failed for ${row.id}: ${error.message}`,
          );
          failed++;
          return;
        }
        sent++;
        return;
      }

      if (!result.retryable) {
        await failTerminal(admin, row.id, result.error);
        failed++;
        return;
      }

      const { error } = await admin.rpc("mark_notification_failed", {
        id_in: row.id,
        reason_in: result.error,
      });
      if (error) {
        console.error(
          `[process-notification-queue] mark_failed failed for ${row.id}: ${error.message}`,
        );
      }
      failed++;
    } catch (e: any) {
      console.error(
        `[process-notification-queue] row ${row.id} threw:`,
        e?.message || e,
      );
      try {
        await admin.rpc("mark_notification_failed", {
          id_in: row.id,
          reason_in: `worker_exception: ${(e?.message || e).toString().slice(0, 240)}`,
        });
      } catch { /* swallow — next tick will retry */ }
      failed++;
    }
  }));

  return json(200, {
    processed: rows.length,
    sent,
    failed,
    skipped,
  });
});
