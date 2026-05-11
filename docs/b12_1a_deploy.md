# B12.1a — `process-notification-queue` deployment + verification

How to deploy the email worker and confirm it's processing queued notifications. Scheduled invocation (pg_cron / Vercel cron) lands in B12.1d.

## Required env vars (Supabase project secrets)

Set these on the Supabase project, **not** in `.env.local` — edge functions only see secrets configured via the Supabase dashboard or CLI.

| Name | Used by | Already set in production? |
|---|---|---|
| `SUPABASE_URL` | every Supabase fn | yes (auto-provided) |
| `SUPABASE_SERVICE_ROLE_KEY` | worker RPC auth | yes (auto-provided) |
| `RESEND_API_KEY` | Resend REST send | yes (B5a) |
| `RESEND_FROM_EMAIL` | verified sender (must pass SPF/DKIM/DMARC) | yes (B5a) |

Verify:
```bash
supabase secrets list --project-ref bjqazhplxqqhftekspfl | grep -E 'RESEND|SUPABASE'
```

Set / rotate if missing:
```bash
supabase secrets set RESEND_API_KEY=re_xxx --project-ref bjqazhplxqqhftekspfl
supabase secrets set RESEND_FROM_EMAIL="Braid Boss Pro <bookings@braidbosspro.app>" \
  --project-ref bjqazhplxqqhftekspfl
```

## Deploy

```bash
# From the repo root
supabase functions deploy process-notification-queue --project-ref bjqazhplxqqhftekspfl
```

CLI output ends with the deployed URL, e.g.
```
Deployed Function: process-notification-queue
Endpoint: https://bjqazhplxqqhftekspfl.functions.supabase.co/process-notification-queue
```

## Invoke manually (smoke test)

```bash
# Health probe (GET — never sends, just confirms the fn is reachable)
curl https://bjqazhplxqqhftekspfl.functions.supabase.co/process-notification-queue
# → {"ok":true,"endpoint":"process-notification-queue"}

# Process one tick. Requires the service role key in the Authorization header.
curl -X POST \
  https://bjqazhplxqqhftekspfl.functions.supabase.co/process-notification-queue \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "content-type: application/json" \
  -d '{}'
# → {"processed":0,"sent":0,"failed":0,"skipped":0}   (empty queue)
# → {"processed":3,"sent":3,"failed":0,"skipped":0}   (after a real submit)
```

## End-to-end verification

After deploy, exercise the full path:

1. **Submit a public booking** at `/book/<slug>` with a real recipient email (e.g. your own). If `attach_to_all_bookings = true` is set on any contract template, a `contract_signing` row also enqueues.
2. **Check the queue**:
   ```sql
   select id, channel, notification_type, recipient_email,
          status, retry_count, scheduled_for, created_at
   from public.notification_queue
   order by created_at desc
   limit 10;
   ```
   Expect rows with `status='queued'` for the just-submitted booking.
3. **Invoke the worker** (manual POST as above).
4. **Re-check the queue**:
   ```sql
   select id, notification_type, status, sent_at, provider_message_id,
          retry_count, failure_reason
   from public.notification_queue
   order by created_at desc
   limit 10;
   ```
   Successful rows → `status='sent'`, `provider_message_id` populated.
   Failed rows → `status='queued'` with `retry_count` incremented and `failure_reason` set, or terminal `status='failed'` if non-retryable.
5. **Check `communication_logs` mirror**:
   ```sql
   select cl.message_type, cl.status, cl.delivery_status,
          cl.provider, cl.provider_message_id, cl.sent_at, cl.failed_at
   from public.communication_logs cl
   where cl.notification_queue_id is not null
   order by cl.created_at desc
   limit 10;
   ```
   Each terminal queue row should have a matching `communication_logs` row mirrored server-side.
6. **Inbox check**: the test email should arrive within seconds. Confirm Resend dashboard → Emails shows it as `delivered`.

## Re-run safety

The migration in `supabase/migrations/20260530000000_phase_b12_1a_notification_queue.sql` is idempotent. The worker:
- claims rows atomically via `SELECT … FOR UPDATE SKIP LOCKED`, so concurrent invocations don't double-process
- dedupes enqueues via the `dedupe_key` partial unique index
- caps retries at 3 attempts per row

Calling the function on an empty queue is a no-op and returns `{"processed":0}`. Safe to invoke as often as desired during testing.

## Scheduling (deferred to B12.1d)

Until B12.1d, the worker isn't on a schedule. Two recommended interim options:

**Manual cron via `curl`** — the simplest "is it working" loop while testing:
```bash
while true; do
  curl -s -X POST \
    https://bjqazhplxqqhftekspfl.functions.supabase.co/process-notification-queue \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
  echo
  sleep 60
done
```

**Vercel cron** — production-grade once you're satisfied with the manual tests. Add to `vercel.json`:
```json
{
  "crons": [
    {
      "path": "/api/notification-tick",
      "schedule": "* * * * *"
    }
  ]
}
```
And add a thin `/api/notification-tick` Next.js route that proxies to the Supabase fn (using the service role key from env). This route lands in a future PR; for now, manual invocation is fine.

`pg_cron` (DB-native scheduler) lands in B12.1d alongside scheduled reminders since both need the extension. The migration block at the bottom of `20260530000000_phase_b12_1a_notification_queue.sql` shows the expected `cron.schedule` call for reference.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `{"error":"supabase_env_missing"}` | Worker can't read `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Auto-provided in production; check secrets list if running locally |
| All rows fail with `resend_env_missing` | `RESEND_API_KEY` / `RESEND_FROM_EMAIL` not set | `supabase secrets set` |
| Row fails with `resend_403` or `resend_422` | Sender domain not verified on Resend; bad recipient | Add SPF/DKIM/DMARC for `RESEND_FROM_EMAIL` domain or fix the recipient address |
| Row stuck in `processing` | Worker crashed between claim and mark | B12.1d will ship a stuck-row sweep. Manual recovery: `update notification_queue set status='queued', processing_started_at=null where status='processing' and processing_started_at < now() - interval '15 minutes';` |
| `mark_notification_failed` increments retry_count past 3 | Edge case — retry_count clamps at 3 via the RPC's terminal check | No action; row is already in terminal `failed` once retry_count reaches 3 |
