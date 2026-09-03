# Phase B12.1 — Notification queue architecture plan

Planning doc for the unified outbound notification layer. **No code or migrations here — implementation lands in B12.1.** This is the blueprint we reference when we start building.

## TL;DR

A single `notification_queue` table acts as the source of truth for every outbound message the platform sends. A Supabase Edge Function (`notification-dispatch`) runs on a pg_cron schedule, picks up due rows, calls a thin provider abstraction (Resend now, Twilio later), updates the row, and mirrors the outcome into `communication_logs`. Inline send-on-write is rejected as an architecture pattern because (a) it can't handle delayed sends (24h reminder, 24h-before-expiry warning), (b) it doesn't survive provider outages, and (c) it spreads sending logic across N feature paths.

## 1. Queue lifecycle

```
        enqueueNotification(payload)
                  │
                  ▼
        ┌─────────────────────────┐
        │ notification_queue row  │
        │   status = 'queued'     │
        │   scheduled_for = <ts>  │
        │   attempts = 0          │
        └────────────┬────────────┘
                     │ pg_cron(*/1 minute)
                     │ → invoke notification-dispatch edge fn
                     ▼
        ┌─────────────────────────┐
        │ status = 'processing'   │
        │ (locked via SELECT...   │
        │  FOR UPDATE SKIP LOCKED)│
        └────────────┬────────────┘
              ┌──────┴──────┐
        ok    │             │ error
              ▼             ▼
        ┌──────────┐  ┌─────────────────────────────┐
        │  sent    │  │ attempts < max:             │
        │ (final)  │  │   status='queued'           │
        └────┬─────┘  │   scheduled_for=now()+backoff
             │        │ attempts ≥ max:             │
             │        │   status='failed' (final)   │
             │        └─────────────────────────────┘
             │
   provider webhook → delivered / opened / clicked / bounced
             │
             ▼
        communication_logs row updated (status + provider_message_id)
```

States: `queued | processing | sent | failed | skipped | cancelled`.

Final states: `sent`, `failed`, `skipped`, `cancelled`. Any other state is in-flight and the worker can pick it up.

## 2. Provider abstraction

```ts
// app/lib/notifications.ts  (scaffolded in this PR, populated in B12.1)
export interface NotificationProvider {
  channel: NotificationChannel;
  send(payload: OutboundPayload): Promise<ProviderResult>;
}
```

Concrete providers (B12.1):
- `ResendProvider` — email, REST, already-wired key (`RESEND_API_KEY`)
- `TwilioProvider` — SMS, REST, gated by `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_FROM_NUMBER`. When env vars are missing, returns `{ ok: false, skipped: true }` and queue row goes `skipped`.
- `InAppProvider` — writes directly to the existing in-app notification surface (the bell badge). No external network; always succeeds.

Provider registry is just a map of `channel → provider`. New channels (push, WhatsApp) plug in without changing the queue.

## 3. Resend-first rollout

Ship in this order so each phase is independently testable:

1. **B12.1a — Email-only queue** (`Resend`):
   - Migration adds `notification_queue` table + `enqueueNotification` RPC
   - Edge function `notification-dispatch` calls Resend REST
   - Inline call sites: contract generated → invite email; contract signed → owner alert; deposit paid → owner alert
   - pg_cron job runs every 60s
   - No SMS yet
2. **B12.1b — SMS via Twilio**:
   - Add `TwilioProvider`
   - Add client opt-in checkbox + opt-out keyword handling
   - Twilio status-callback webhook → updates `communication_logs.status`
3. **B12.1c — Scheduled reminders**:
   - 48h / 24h / 2h appointment reminders (reuses queue with `scheduled_for` in the future)
   - 24h-before-`expires_at` contract nudge
4. **B12.1d — Owner preferences UI**:
   - Per-event-type toggles in Settings → Notifications
   - Per-client opt-out tracking

## 4. `communication_logs` relationship

`notification_queue` is the worker's table — short-lived, write-heavy, status-bound. `communication_logs` is the long-lived audit trail. **The queue writes BOTH rows** at boundary transitions:

| Queue transition | communication_logs effect |
|---|---|
| `enqueued` | INSERT row with `status='queued'` |
| `processing → sent` | UPDATE row to `status='sent'`, stamp `provider_message_id`, `sent_at` |
| `processing → failed` (final) | UPDATE row to `status='failed'`, populate `error_message` |
| Provider webhook delivered | UPDATE `delivered_at`, `status='delivered'` |
| Provider webhook bounced | UPDATE `status='failed'`, `error_message` |

`booking_contract_id`, `booking_request_id`, `appointment_id`, `client_id` are mirrored from the queue row into `communication_logs` so all the existing owner-side dashboards (Approvals queue mini-card, future Communication Log screen, intelligence dashboard) can join on whichever they have without touching the queue table.

## 5. Cron / worker strategy — recommendation

**Edge Function + pg_cron** is the right pick for Braid Boss Pro. Options considered:

| Option | Verdict | Why |
|---|---|---|
| (A) In-app dispatch | ❌ | Requires a stylist's app to be open to send. Breaks immediately. |
| (B) Edge function on-write only | ⚠️ | Works for immediate sends but can't handle scheduled (24h reminder, 24h-before-expiry). Would need a parallel scheduler anyway. |
| (C) Pure cron worker (e.g. Vercel cron + REST) | ✓ workable | Adds infra surface (Vercel cron). Less integrated with Supabase. Locking semantics weaker (no `SELECT...FOR UPDATE SKIP LOCKED` from outside Postgres). |
| (D) Pure DB trigger (Postgres `http` extension) | ❌ | The `http` extension exists but blocking the writing transaction on a third-party HTTP call is brittle. No retry. No backoff. |
| **(E) pg_cron → invoke edge function** | ✅ **recommended** | All scheduling stays in the DB (free in Supabase), HTTP/secrets stay in the edge function (where they belong), `SELECT...FOR UPDATE SKIP LOCKED` keeps multi-worker safe, idempotency lives in one place. |

Recommended cadence: **every 60 seconds**. Each tick the edge function processes up to N due rows (e.g. 50), then exits. Cheap, predictable, easy to reason about.

## 6. Idempotency considerations

Every queue row carries a `dedupe_key text unique` (nullable). Patterns:

| Event | Suggested dedupe_key |
|---|---|
| contract_signed_owner_alert | `contract_signed:<booking_contract_id>` |
| contract_invite_client | `contract_invite:<booking_contract_id>` |
| deposit_paid_owner_alert | `deposit_paid:<booking_request_id>` |
| appt_reminder_48h | `appt_reminder_48h:<appointment_id>` |
| appt_reminder_24h | `appt_reminder_24h:<appointment_id>` |
| appt_reminder_2h | `appt_reminder_2h:<appointment_id>` |
| daily_sales_summary | `daily_summary:<user_id>:<local_date>` |
| monthly_review | `monthly_review:<user_id>:<YYYY-MM>` |
| stylist_trial_started | `stylist_trial_started:<user_id>` (fired once, either by the signup trigger or the one-time backfill) |
| stylist_trial_ending (local, card-less trial) | `local_trial_ending:<user_id>:<YYYY-MM-DD period end>` |
| activation_nudge | `activation_nudge:<user_id>:<checkpoint day, one of 1/3/7/14/21>` |

The two recurring reports key on the period they summarize rather than on a
row id, so the hourly job that fires them at each stylist's local midnight can
run in every timezone without ever sending the same period twice.

The worker uses a no-op `ON CONFLICT (dedupe_key) DO NOTHING` insert. Webhook retries, double-tap signing, edge function re-invocations — all safe.

## 7. Retry handling

- `max_attempts` default 5
- Backoff schedule: `1m, 5m, 15m, 1h, 6h`
- On final failure (`attempts >= max_attempts`), flip to `failed` and surface in the owner's Communication Log screen (B12.1d) for manual retry.
- Provider 4xx errors are treated as **non-retryable** (bad email format, opt-out) → immediate `failed`.
- Provider 5xx / network errors → retryable with backoff.

## 8. Opt-out considerations

`client_communication_preferences` table (B12.1b):

| Column | |
|---|---|
| `user_id` | stylist owner |
| `client_id` | text — matches existing clients.id |
| `email_opt_out` | boolean |
| `sms_opt_out` | boolean |
| `opted_out_at` | timestamptz |
| `opt_out_source` | enum (manual, sms_stop_reply, email_unsubscribe) |

Worker checks this table before dispatching. Opted-out rows flip to `skipped` with `error_message='client_opted_out'`. Inline `STOP` reply handling lands in the Twilio webhook in B12.1b.

CAN-SPAM / TCPA notes:
- Every email must include a one-tap unsubscribe URL (Resend handles `list-unsubscribe` header automatically — turn it on).
- Every SMS must include "Reply STOP to opt out" at least on the first message.
- Initial opt-in collected on the public booking page checkbox (added to `booking_requests` as a metadata flag in B12.1b).

## 9. Future webhook handling

Two webhooks land in B12.1:

1. **Resend webhook** — `/api/notifications/resend-webhook`. Subscribes to `email.delivered`, `email.bounced`, `email.complained`, `email.opened`, `email.clicked`. Signature verified via Resend's webhook secret. Updates `communication_logs.status` + timestamps.
2. **Twilio webhook** — `/api/notifications/twilio-webhook`. Subscribes to delivery status + inbound (for STOP / HELP keyword handling). Signature verified via Twilio's `X-Twilio-Signature` HMAC.

Both webhooks are stateless aside from the DB write. Idempotent via `provider_message_id`.

## 10. Why a universal queue beats per-feature send fns

Argument for the queue:
- **One place** to add throttling, deduping, opt-out checks, retry policy, audit logging
- **Scheduled sends are first-class** — reminders, expirations, follow-ups all use the same pipeline
- **Provider switching is a config change**, not a refactor
- **Failure observability is centralised** — one Vercel function to monitor, one DB table to query for "what's stuck"
- **Multi-channel fan-out is trivial** — one enqueue per channel, dispatcher figures out the rest
- **Owner-visible Communication Log is a single SELECT**, not a fan-in from 8 different code paths

Argument for per-feature send fns (rejected):
- "Simpler for one event" — true on day one, false by event six
- "Synchronous feedback to the caller" — fine for some flows, but most of the events here are fire-and-forget; the queue's "queued / sent / failed" status is plenty of feedback for the UI

We're already at six event types with B12.0 + B12.1 scope. The queue is the right call.

## 11. Implementation readiness report

### Safe to proceed?

**Yes.** B12.0 is in a clean, audited state:
- Migration file matches production schema 1:1
- All 4 RPCs verified end-to-end via dry-run on production
- RLS policies cover owner-only access; anon access scoped to four security-definer RPCs
- No drift between repo and production after the 2026-05-11 patch session
- `app/lib/contracts.ts` typed hook surface is stable; no breaking changes anticipated

### Remaining risks

| Risk | Severity | Mitigation |
|---|---|---|
| pg_cron extension not yet enabled on production | Low | One-time `create extension if not exists pg_cron;` in B12.1 migration |
| Resend deliverability before production warm-up | Medium | Use a subdomain (`mail.braidbosspro.app`); set SPF, DKIM, DMARC before first real send |
| TCPA exposure on SMS reminders | High | Ship email-first; require explicit SMS opt-in checkbox; defer SMS to B12.1b |
| Owner unable to disable specific event types | Medium | Settings → Notifications UI in B12.1d; until then default all event types ON |
| Notification volume hammering Resend free tier | Low | Free tier handles 3k/month; track per-month volume in intelligence dashboard |
| Old `public.communications` table semantic confusion | Low | Already documented as "outbound copy log" distinct from `communication_logs` — `app/lib/notifications.ts` only references `communication_logs` |

### Suggested rollout order

1. **B12.1a — Email queue MVP**
   - Migration: `notification_queue` table + `enqueueNotification` RPC + enable pg_cron extension + cron job
   - Edge fn `notification-dispatch` with `ResendProvider` only
   - Wire 3 inline enqueue calls: contract generated, contract signed (owner), deposit paid (owner)
   - No UI changes; verify via SQL + Resend dashboard
2. **B12.1b — Owner preferences + opt-out**
   - `client_communication_preferences` table
   - Owner Settings → Notifications screen (per-event toggles)
   - Public booking page: SMS opt-in checkbox
   - Email unsubscribe link via Resend list-unsubscribe header
3. **B12.1c — Twilio SMS**
   - `TwilioProvider`
   - Twilio status-callback webhook
   - Inbound STOP keyword handler
   - Add SMS channel to existing event types
4. **B12.1d — Scheduled reminders**
   - 48h / 24h / 2h appt reminders
   - 24h-before-`expires_at` contract nudge
   - Owner-side schedule preview ("3 reminders queued for tomorrow")
5. **B12.1e — Communication Log UI**
   - Owner screen rendering `communication_logs` with filters (channel, message_type, status)
   - Per-client comm history on client profile

### Queue location recommendation

**Edge Function + pg_cron (option E above).** Reasoning summarised:
- Scheduled sends are a hard requirement (reminders, expirations)
- Multi-worker concurrency is free via `SELECT ... FOR UPDATE SKIP LOCKED`
- HTTP / secrets / provider SDKs belong in TypeScript, not PL/pgSQL
- pg_cron is free, native to Supabase, and triggers from inside the DB so no external scheduling infra
- Per-tick batch processing limits cost and blast radius

Do not:
- Use Vercel cron (introduces a second scheduling system; no DB locking primitives)
- Use the Postgres `http` extension (blocks the writing transaction; no retry semantics)
- Dispatch inline in the originating RPC (no delayed sends; failure of provider blocks the booking submit)

## 12. Files this plan will touch (preview only — for B12.1, not this PR)

- `supabase/migrations/<ts>_phase_b12_1a_notification_queue.sql` — table + RPC + cron + extension enable
- `supabase/functions/notification-dispatch/index.ts` — edge function worker
- `app/lib/notifications.ts` — full implementation (scaffolded in this PR)
- `app/lib/email.ts` — already has the templates; will call `enqueueNotification` instead of `sendEmail` directly
- `app/page.tsx` — Settings → Notifications screen (B12.1d)
- `app/lib/contracts.ts` — call sites in sign / decline / generate after the inline RPC writes (optional; can also enqueue from inside the RPCs)
