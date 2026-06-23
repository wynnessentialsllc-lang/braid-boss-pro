# SMS setup & go-live runbook

The SMS feature is **fully built in code** (queue-based Twilio dispatch,
prepaid credits, opt-in capture, STOP/opt-out gating, reminders +
confirmations). What's left is **external account configuration**. This
doc is the checklist to actually turn it on.

Architecture lives in `docs/b12_1_notification_architecture.md`; this
doc is purely operational.

---

## 1. Twilio account + sending number (required)

**Live config (10DLC, A2P-registered):**
- Messaging Service SID: `MGe4be6ed030e475d804d051f2b61ebf6c`
- 10DLC Number: `+15755677776` (in the Messaging Service sender pool)
- A2P Campaign SID: `CM9cc91134f5af2d0592c2087e8dadee87` (use case
  `LOW_VOLUME`) — approved 2026-06-15
- A2P Brand Registration SID: `BNce39419e9641287898a463d044044f5e`

> **Migrated off toll-free (2026-06):** the previous setup used toll-free
> number `+18556298377` on Messaging Service
> `MG72a42abd8c856af96835c99c49ba5fe7`. Those are retired — the function
> secrets and the inbound webhook now point at the 10DLC service above.

1. Create / sign in to a Twilio account.
2. Provision a Messaging Service and attach a sending number (done — see
   above). Sending through the Messaging Service is preferred: it carries
   the toll-free / A2P registration and manages the sender pool.
3. Set the project secrets so the dispatch worker can send. **These are
   Supabase function secrets, not `.env.local`** — edge functions only
   see secrets set on the project:
   ```bash
   supabase secrets set \
     TWILIO_ACCOUNT_SID=AC_xxx \
     TWILIO_AUTH_TOKEN=xxx \
     TWILIO_MESSAGING_SERVICE_SID=MGe4be6ed030e475d804d051f2b61ebf6c \
     TWILIO_PHONE_NUMBER=+15755677776 \
     --project-ref bjqazhplxqqhftekspfl
   ```
   - The worker (`process-notification-queue`) prefers
     `TWILIO_MESSAGING_SERVICE_SID` and sends with `MessagingServiceSid`.
     `TWILIO_PHONE_NUMBER` (E.164 `+1...`) is an optional fallback for a
     single-number deploy; with a Messaging Service it isn't needed.
   - Until `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and a sender
     (Messaging Service SID **or** phone number) are set, every SMS row
     terminal-fails with `twilio_env_missing` (email is unaffected —
     dispatch is per-row).

Verify:
```bash
supabase secrets list --project-ref bjqazhplxqqhftekspfl | grep -i twilio
```

### Per-stylist master switch

Beyond the platform-wide `SMS_ENABLED` code flag, each stylist has an
account-level switch — `profiles.sms_notifications_enabled`, **default
OFF** — toggled in **Account → Notifications → Text messages (SMS)**. The
queue gate in `queue_notification()` enforces it server-side: SMS rows
for an owner with the switch off are dropped at enqueue with reason
`sms_disabled_by_owner`. So no texts go out until the stylist flips it on
(and a client opted in on the booking form, and the stylist holds
credits). Flipped via the `set_sms_notifications_enabled` RPC.

### SMS-covered events

Once a stylist's master switch is on (and the client opted in + credits
exist), these send a client SMS through the queue:

| Event | Type | Where it's enqueued |
|---|---|---|
| Booking received | `booking_confirmation` | `enqueue_public_booking_emails` |
| Appointment approved / confirmed | `appointment_confirmed` | `enqueue_appointment_confirmation` |
| Reschedule approved | `appointment_confirmed` (date-aware dedupe) | `enqueue_appointment_confirmation` re-fired on re-approval |
| 24-hour reminder | `appointment_reminder` | `enqueue_due_appointment_reminders` (cron */30) |
| 2-hour reminder | `appointment_reminder_2h` (SMS only) | `enqueue_due_2h_sms_reminders` (cron */15) |
| Review request | `review_request` | `enqueue_due_review_requests` (post-visit) |

Every outbound SMS gets `Reply STOP to opt out.` appended by the worker.

## 2. A2P 10DLC registration (required for US sending)

US carriers **block** application-to-person SMS from unregistered local
numbers. In the Twilio Console:

1. Register a **Brand** (your business info / EIN).
2. Register a **Campaign** (use case: account notifications /
   appointment reminders) and attach your number or Messaging Service.
3. Wait for carrier approval (often 1–5 business days).

Alternative: a **toll-free number** with toll-free verification — usually
faster to approve. Either path must complete before reminders deliver
reliably; unregistered traffic is silently filtered.

## 3. Inbound STOP/HELP webhook (compliance)

The `twilio-inbound` edge function keeps `public.sms_opt_outs` in sync
with what recipients text. Every enqueue path already skips opted-out
numbers, so this closes the STOP loop.

1. Deploy (CI deploys on merge; manual:):
   ```bash
   supabase functions deploy twilio-inbound --project-ref bjqazhplxqqhftekspfl
   ```
   `verify_jwt = false` is pinned in `supabase/config.toml` (Twilio can't
   send a Supabase JWT; the function verifies `X-Twilio-Signature`
   instead, keyed by `TWILIO_AUTH_TOKEN`).
2. In the Twilio Console, set the number's (or Messaging Service's)
   **"A message comes in"** webhook to:
   ```
   https://bjqazhplxqqhftekspfl.functions.supabase.co/twilio-inbound
   ```
   Method: `HTTP POST`.
3. **Leave Twilio's Advanced Opt-Out enabled.** Twilio sends the
   carrier-compliant STOP/HELP/START replies; our function returns an
   empty TwiML and only records the opt-out/opt-in in our DB. This avoids
   double-texting and keeps compliant wording on Twilio.

Keyword handling:
| Texted | Effect |
|---|---|
| STOP / STOPALL / UNSUBSCRIBE / CANCEL / END / QUIT | insert into `sms_opt_outs` (number is skipped on every future send) |
| START / UNSTOP / YES | delete from `sms_opt_outs` (re-enabled) |
| HELP / anything else | no DB change |

Smoke test (after Twilio is live): text `STOP` to the number, then:
```sql
select phone, source, created_at from public.sms_opt_outs order by created_at desc limit 5;
```

## 4. SMS credit-pack Stripe webhook (required — currently NOT firing)

Stylists buy prepaid credits via `/api/sms-credits/checkout` (a
**platform** charge, not Connect). On payment, Stripe must call
`/api/sms-credits/webhook`, which flips the purchase to `paid` and adds
the credits. **The worker refuses to send when balance is 0**, so this
must work or no SMS goes out even with Twilio configured.

This endpoint is its own Stripe webhook (like `founding-checkout` and
`product-checkout`). Set it up on the **platform** Stripe account:

1. Stripe Dashboard → Developers → Webhooks → **Add endpoint**:
   ```
   https://<your-app-domain>/api/sms-credits/webhook
   ```
   Events: `checkout.session.completed` **and**
   `checkout.session.async_payment_succeeded` (the second covers BNPL —
   Klarna/Afterpay — which settle asynchronously; without it those
   purchases never credit).
2. Copy the endpoint's signing secret and set it in the app's env
   (Vercel): `STRIPE_SMS_WEBHOOK_SECRET=whsec_...`
   - If unset, the route falls back to `STRIPE_DEPOSIT_WEBHOOK_SECRET`,
     which is the wrong secret for a platform-account endpoint — set the
     dedicated one.
3. Re-buy a pack end-to-end and confirm the balance lands:
   ```sql
   select user_id, balance from public.sms_credits where balance > 0;
   select status, count(*) from public.sms_credit_purchases group by status;
   ```

### Reconciling a stuck purchase

A purchase created before the webhook was configured stays `pending`
with no credits applied. If you've confirmed in the Stripe Dashboard that
the session was actually **paid**, apply it idempotently:
```sql
select public.record_sms_credit_purchase('cs_live_...session_id...');
```
This flips the row to `paid` and adds the credits exactly once (a replay
no-ops). To reverse an accidental credit:
```sql
update public.sms_credits set balance = balance - <credits> where user_id = '<uuid>';
update public.sms_credit_purchases set status = 'pending' where stripe_session_id = 'cs_live_...';
```

## 5. End-to-end verification (after 1–4)

1. Buy a credit pack → confirm `sms_credits.balance` increases.
2. Submit a public booking at `/book/<slug>` with a real phone and the
   SMS opt-in box ticked.
3. The booking-confirmation SMS enqueues; the worker (cron, every minute)
   sends it. Check:
   ```sql
   select channel, notification_type, status, provider_message_id, failure_reason
   from public.notification_queue
   where channel = 'sms' order by created_at desc limit 10;
   ```
   Sent → `status='sent'`, `provider_message_id` = the Twilio SID.
4. Text `STOP` from that phone, submit another booking → confirm no SMS
   enqueues (the row is gated out by `sms_opt_outs`).

## Quick reference — where each knob lives

| Setting | Where |
|---|---|
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` | Supabase function secrets |
| Inbound SMS webhook URL | Twilio Console → number / Messaging Service |
| `STRIPE_SMS_WEBHOOK_SECRET` | App env (Vercel) |
| SMS credit-pack webhook endpoint | Stripe Dashboard (platform account) |
| Credit pack pricing | `app/lib/sms-packs.ts` |
