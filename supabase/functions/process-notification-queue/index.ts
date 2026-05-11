// Edge Function: process-notification-queue
//
// Phase B12.1a — email-only dispatch worker. Pulls a batch of due
// rows via `mark_notification_processing` (which uses SELECT … FOR
// UPDATE SKIP LOCKED for multi-worker safety), renders the
// appropriate email via the build* helpers, calls Resend, then
// records success / failure via the matching RPCs.
//
// Invocation:
//   * Manual:  POST <fn URL>  (auth: service role bearer)
//   * pg_cron: configured in a follow-up migration (B12.1d) when
//              scheduled reminders ship. Until then, invoke from
//              Vercel cron (every minute) or by curl for testing.
//
// Idempotency:
//   * Each row is claimed exactly once per tick via the atomic
//     mark_notification_processing RPC. Re-running this fn won't
//     re-claim rows already in 'processing' state.
//   * Successful sends transition to 'sent' (terminal).
//   * Failed sends bump retry_count; the RPC enforces the cap (3).
//
// Channels:
//   * email → Resend REST (current). Non-retryable on 4xx, retryable
//     on 5xx / network errors.
//   * sms → NOT IMPLEMENTED in B12.1a. Rows with channel='sms' are
//     marked failed with reason='sms_not_implemented' so they don't
//     loop forever.

// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL");

const BATCH_LIMIT = 25;
const RESEND_ENDPOINT = "https://api.resend.com/emails";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

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
// Resend send — minimal REST wrapper, no SDK
// =====================================================================
async function sendViaResend(row: ClaimedRow): Promise<
  | { ok: true; providerMessageId: string | null }
  | { ok: false; retryable: boolean; error: string }
> {
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
    // Treat missing config as non-retryable so we don't spin on it.
    return { ok: false, retryable: false, error: "resend_env_missing" };
  }
  if (!row.recipient_email) {
    return { ok: false, retryable: false, error: "missing_recipient_email" };
  }

  const subject = row.subject || "Notification from Braid Boss Pro";
  // For B12.1a the body is whatever the caller queued. Templates
  // are rendered at queue time by the app's email builders, then
  // the rendered HTML lives in `payload.html` (or falls back to a
  // <pre> wrap of `body`). Future phases may render entirely inside
  // this worker.
  const html: string = typeof row.payload?.html === "string"
    ? row.payload.html
    : `<pre style="white-space:pre-wrap;font-family:sans-serif;">${escape(row.body)}</pre>`;

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
        subject,
        html,
        text: row.body,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // 4xx → likely permanent (bad address, suppressed). 5xx → retry.
      const retryable = res.status >= 500 || res.status === 429;
      return {
        ok: false,
        retryable,
        error: `resend_${res.status}: ${text.slice(0, 200)}`,
      };
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, providerMessageId: data?.id || null };
  } catch (e: any) {
    return { ok: false, retryable: true, error: `network: ${e?.message || e}` };
  }
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// =====================================================================
// HTTP handler — claims a batch, dispatches each, records outcomes
// =====================================================================
serve(async (req) => {
  if (req.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json(500, { error: "supabase_env_missing" });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Step 1 — atomic claim. Returns up to BATCH_LIMIT rows already
  // transitioned to status='processing'. Multi-worker safe.
  const { data: claimRes, error: claimErr } = await admin.rpc(
    "mark_notification_processing",
    { limit_in: BATCH_LIMIT },
  );
  if (claimErr) {
    console.error("[process-notification-queue] claim failed:", claimErr.message);
    return json(500, { error: claimErr.message });
  }
  const rows: ClaimedRow[] = (claimRes as { rows?: ClaimedRow[] })?.rows || [];
  if (rows.length === 0) {
    return json(200, { processed: 0 });
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  // Step 2 — dispatch each row. Failures are per-row; the function
  // never throws so one bad row doesn't kill the batch.
  await Promise.all(rows.map(async (row) => {
    try {
      if (row.channel === "sms") {
        // SMS lands in B12.1c. Fail terminally so the worker doesn't
        // pick it up again.
        await admin.rpc("mark_notification_failed", {
          id_in: row.id,
          reason_in: "sms_not_implemented_in_b12_1a",
        });
        // Bump again so it hits the 3-attempt cap immediately.
        // Cheap; avoids 3 ticks of churn for unsupported rows.
        await admin.rpc("mark_notification_failed", {
          id_in: row.id,
          reason_in: "sms_not_implemented_in_b12_1a",
        });
        await admin.rpc("mark_notification_failed", {
          id_in: row.id,
          reason_in: "sms_not_implemented_in_b12_1a",
        });
        skipped++;
        return;
      }
      if (row.channel !== "email") {
        await admin.rpc("mark_notification_failed", {
          id_in: row.id,
          reason_in: `unsupported_channel:${row.channel}`,
        });
        skipped++;
        return;
      }

      const result = await sendViaResend(row);
      if (result.ok) {
        await admin.rpc("mark_notification_sent", {
          id_in: row.id,
          provider_in: "resend",
          provider_message_id_in: result.providerMessageId,
        });
        sent++;
        return;
      }

      if (!result.retryable) {
        // Non-retryable error → bump straight to terminal via 3 marks.
        await admin.rpc("mark_notification_failed", {
          id_in: row.id, reason_in: result.error,
        });
        await admin.rpc("mark_notification_failed", {
          id_in: row.id, reason_in: result.error,
        });
        await admin.rpc("mark_notification_failed", {
          id_in: row.id, reason_in: result.error,
        });
        failed++;
        return;
      }

      await admin.rpc("mark_notification_failed", {
        id_in: row.id,
        reason_in: result.error,
      });
      failed++;
    } catch (e: any) {
      console.error(
        `[process-notification-queue] row ${row.id} threw:`,
        e?.message || e,
      );
      try {
        await admin.rpc("mark_notification_failed", {
          id_in: row.id,
          reason_in: `worker_exception: ${e?.message || e}`.slice(0, 256),
        });
      } catch (_) {
        // Swallow. Next tick will pick up the still-processing row
        // after a future "stuck row" sweep (B12.1d).
      }
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
