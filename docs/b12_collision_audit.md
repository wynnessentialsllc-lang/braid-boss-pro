# B12 collision audit

Pre-implementation review for B12.1 notification queue. Identifies overlap, duplicate pathways, and architectural risks across existing surfaces. **Read once before starting B12.1 — informs which call sites get rewired vs. left alone.**

## Surfaces scanned

| Surface | Location | Status |
|---|---|---|
| Contracts flow (sign / decline / generate) | `supabase/migrations/20260528...`, `app/lib/contracts.ts`, `app/contract/[token]/page.tsx` | Clean — already writes `communication_logs` inline for `contract_signed` + `contract_declined`. Queue layer **adds** outbound dispatch without removing the inline audit write. |
| Approvals queue | `app/page.tsx` `ApprovalQueueScreen` + `ApprovalContractsBlock` | No outbound comms today. Stylist manually copies signing links. Queue layer adds a "Send link to client" button that enqueues `contract_invite`. |
| Public booking submit | `app/book/[slug]/page.tsx` | Calls `public_submit_booking_request` then `generate_booking_contracts`. No comms today. Queue layer enqueues `booking_confirmation` (client) + `booking_request_owner_alert` (owner). |
| Existing `public.communications` table | unchanged since pre-B12 | **Not a conflict.** Different semantic: outbound copy / share / send-template event log used by the existing Communication sheets (`logClientCommunication` in `app/page.tsx`). New work writes to `communication_logs` (separate table). Both can coexist forever; or `public.communications` can be migrated into `communication_logs` in a later phase. **No action in B12.1.** |
| Existing email helper | `app/lib/email.ts` | Currently called synchronously by `cacheLifetimeAccess` style flows only. After B12.1a, B12.0 contract templates' `build*` helpers stay; the queue dispatcher calls them inside `renderOutboundPayload`. The `sendEmail` helper itself is still useful for in-app one-shot flows (admin manual resend); keep both. |
| Stripe deposit webhook | `app/api/stripe-connect/webhook/route.ts` | Already idempotent. After B12.1 we add **one** `enqueueNotification` call after `mark_deposit_paid_via_webhook` succeeds: `deposit_paid_owner_alert`. No state-machine changes. |
| Existing edge functions | `supabase/functions/booking-request`, `calendar-feed`, `delete-account`, `send-push` | None overlap. `send-push` is iOS push (Capacitor) — adjacent channel; queue can later route an `in_app_push` channel through it. Not in B12.1a scope. |
| pg_cron | not yet installed (per `select extname from pg_extension where extname='pg_cron';` — none) | **B12.1a action item**: enable extension as part of the queue migration. |
| In-app notifications (bell badge) | `app/page.tsx` `useNotifications` + `buildNotifications` | Already pulls from booking_requests for the `deposit_paid_pending_approval` notification (PR #102). Future: pull from `communication_logs` rows with `status='delivered'` failed/queued so the owner can see pending sends. Not a conflict — additive. |
| Existing notification scheduler | `app/lib/notification-scheduler.ts` | Local-only / client-side delivery of reminders via Capacitor push. Different layer — owner-side notifications to themselves about appointments. The new queue is platform-side outbound to clients. Keep both; don't try to unify in B12.1. |
| Reminders / `reminder_settings` table | does not exist yet | Free to design. Will be added with B12.1d scheduled reminders. |

## Identified risks / conflicts

### 1. Inline writes to `communication_logs` from sign/decline RPCs

The B12.0 `sign_public_contract` and `decline_public_contract` RPCs already insert `communication_logs` rows with `channel='system'`. When B12.1 adds an OUTBOUND `contract_signed_owner_alert` email, that's a **second** row with `channel='email'`. **Not a conflict** — they represent different events (system audit vs. outbound email). The Communication Log UI in B12.1e should filter on `channel != 'system'` for the "messages sent" view and include system rows under a separate "Activity" filter.

### 2. `app/lib/email.ts` synchronous send

Currently exports `sendEmail` for one-shot synchronous dispatch. After B12.1a most call sites enqueue instead. But `sendEmail` is still useful for:
- Admin-side manual "Resend" buttons in the Communication Log UI (B12.1e)
- Test scaffolding

Keep it. The contract template `build*` helpers are referenced from BOTH `sendEmail` (sync path) and from the dispatcher's `renderOutboundPayload` (queue path). No duplication needed.

### 3. iOS push via `send-push` edge function

Adjacent channel, different audience. `send-push` targets the **stylist's** phone (Capacitor push). The queue targets the **client's** email/SMS. B12.1a doesn't touch `send-push`. A future B12.1f could add a `push` channel to the queue that wraps `send-push` invocations, but no need now.

### 4. Existing `analytics_events` anon-insert allow-list

Phase B3 added an anon insert policy on `analytics_events` with a fixed allow-list. If B12.1 adds analytics events for outbound sends (e.g. `email_sent`), the allow-list needs extending. Pattern is documented in the B3 migration. Track this as a B12.1 todo.

### 5. Resend webhook signature

Resend's `list-unsubscribe` and webhook delivery signing both require setting the webhook secret in a separate Stripe-like config flow. B12.1 needs a new env var (`RESEND_WEBHOOK_SECRET`) and a new route (`/api/notifications/resend-webhook`). No collision with existing Stripe webhook routes — different paths.

### 6. RLS on the future `notification_queue` table

The dispatcher runs in an edge function with the service role key, so it bypasses RLS. But the owner-side "what's queued for me" UI needs RLS-scoped reads. Pattern: enable RLS, add `notification_queue_owner_select` policy `using (auth.uid() = user_id)`. Already covered in the architecture doc.

### 7. Race between `generate_booking_contracts` and the queue

If B12.1 wires `contract_invite` enqueue **inside** `generate_booking_contracts`, every booking submit creates queue rows immediately. Edge case: the stylist hasn't connected Stripe yet, so the booking falls to `pending_review` (no deposit). The client still gets a contract invite — that's desired. **No conflict**, but the implementation must put the enqueue AFTER the insert returns the new booking_contracts.id so the dedupe key is stable.

### 8. Existing `booking_request_id` foreign keys on contracts table

`booking_contracts.booking_request_id` is `on delete set null`. If a stylist deletes a booking request, the contract row keeps the signed audit trail but loses the FK. **Acceptable** — signed contracts are intentionally immutable historical records.

## Recommendations

- **Do not migrate `public.communications` into `communication_logs`.** Different purposes; consolidation is not worth the risk for B12.1.
- **Do not refactor inline `communication_logs` inserts** out of `sign_public_contract` / `decline_public_contract`. Those are system audit rows and should land regardless of queue health.
- **Enable pg_cron + add the queue migration as one atomic file** (B12.1a). Don't ship the table without the cron job or vice versa — both are required for the queue to function.
- **Default opt-in** for B12.1a (email only). B12.1b adds explicit opt-out + SMS opt-in.
- **Hold off on consolidating `app/lib/notification-scheduler.ts`** (client-side Capacitor push) with the new queue. They're different audiences.

## Net result

**Zero blocking conflicts.** B12.1 is safe to implement on top of the current B12.0 foundation. Scaffolding in this PR (`app/lib/notifications.ts`) locks the import surface so call-site additions in B12.1 are mechanical.
