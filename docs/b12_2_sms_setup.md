# SMS setup & go-live runbook

The SMS feature is **fully built in code** (queue-based Twilio dispatch,
prepaid credits, opt-in capture, STOP/opt-out gating, reminders +
confirmations). What's left is **external account configuration**. This
doc is the checklist to actually turn it on.

Architecture lives in `docs/b12_1_notification_architecture.md`; this
doc is purely operational.

---

## 1. Twilio account + sending number (required)

1. Create / sign in to a Twilio account.
2. Buy a phone number (or provision a Messaging Service) capable of SMS.
3. Set the project secrets so the dispatch worker can send. **These are
   Supabase function secrets, not `.env.local`** — edge functions only
   see secrets set on the project:
   ```bash
   supabase secrets set \
     TWILIO_ACCOUNT_SID=AC_xxx \
     TWILIO_AUTH_TOKEN=xxx \
     TWILIO_PHONE_NUMBER=+1XXXXXXXXXX \
     --project-ref bjqazhplxqqhftekspfl
   ```
   - `TWILIO_PHONE_NUMBER` must be E.164 (`+1...`).
   - The worker (`process-notification-queue`) reads all three. Until
     they're set, every SMS row terminal-fails with `twilio_env_missing`
     (email is unaffected — dispatch is per-row).

Verify:
```bash
supabase secrets list --project-ref bjqazhplxqqhftekspfl | grep -i twilio
```

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
   Event: `checkout.session.completed`.
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
