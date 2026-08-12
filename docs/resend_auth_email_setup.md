# Account and billing emails

How the stylist-facing lifecycle emails are produced, and what still has
to be set in a provider dashboard by hand.

There are **two** delivery paths, on purpose:

| Path | Emails | Who renders | Who sends |
|------|--------|-------------|-----------|
| Supabase Auth (custom SMTP → Resend) | verify email, password reset, email change | Supabase, from a template pasted into its dashboard | Supabase Auth |
| `notification_queue` → `process-notification-queue` → Resend | welcome, trial started, trial ending, subscription confirmed, payment failed | the worker, from `supabase/functions/_shared/lifecycle-emails.ts` | the worker |

Auth links must be minted and sent by the auth provider, so path one
cannot move into the app. Everything else rides the queue the rest of
the product already uses. There is no third email system.

Both paths render from the **same design kit**
(`supabase/functions/_shared/email-kit.ts`), so the two look identical
in the inbox even though different services send them.

---

## Path one — Supabase Auth templates

### Step 1. Custom SMTP

**Dashboard → Authentication → Emails → SMTP Settings → enable "Custom SMTP".**

| Field | Value |
|-------|-------|
| Sender email | `hello@braidbosspro.app` |
| Sender name | `Braid Boss Pro` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | *your Resend API key* (`re_…`) — the same key in `RESEND_API_KEY` |

Notes:
- The sender domain (`braidbosspro.app`) is already verified in Resend, so
  no new DNS is needed.
- Port `587` also works (STARTTLS) if `465` is ever blocked.
- The API key is pasted directly into Supabase. It is **not** stored in
  this repo.

### Step 2. URL configuration

**Dashboard → Authentication → URL Configuration.**

- **Site URL:** `https://braidbosspro.app`
- **Redirect URLs (allow-list):**
  - `https://braidbosspro.app/auth/callback`
  - `https://braidbosspro.app/**`

These must match what the app sends as `emailRedirectTo`, or the
confirmation link will bounce.

### Step 3. Email rate limit

**Dashboard → Authentication → Rate Limits → "Rate limit for sending emails".**

On custom SMTP this can be raised well past the built-in cap (e.g.
**100/hour** to start). The per-email resend cooldown (~60s) is separate
and stays; the app already shows a friendly countdown for it.

### Step 4. Paste the templates

Generated files live in `docs/email-templates/`. Rebuild them with:

```bash
node scripts/build-auth-email-templates.mjs
```

| File | Paste into |
|------|-----------|
| `supabase-confirm-signup.html` | Authentication → Emails → Templates → **Confirm signup** |
| `supabase-reset-password.html` | Authentication → Emails → Templates → **Reset password** |
| `supabase-email-change.html` | Authentication → Emails → Templates → **Change email address** |

Set the subject line for each from the banner comment at the top of the
file. For confirm signup that is:

```
Boss move pending: verify your Braid Boss Pro account
```

Two things to check before pasting:

1. **Expiry wording.** Each template states how long the link is good
   for ("24 hours" for signup and email change, "1 hour" for reset).
   Confirm those match the project's actual Auth expiry settings and, if
   not, change the values in `scripts/build-auth-email-templates.mjs`
   and regenerate. Do not leave a wrong number in customer-facing copy.
2. **No click tracking.** `{{ .ConfirmationURL }}` carries an
   authentication token. It must not be wrapped in a Resend or
   third-party click tracker, which would hand that token to another
   service. Leave click tracking off for this sending domain.

### Test checklist

1. Sign up with a fresh address in an incognito window.
2. Confirm the email arrives **from `hello@braidbosspro.app`**.
3. Tap the button → it lands on `braidbosspro.app/auth/callback` and
   signs you in.
4. In Resend's dashboard the send shows `delivered`.
5. Hit "Resend email" within a minute → the friendly countdown shows.

---

## Path two — queued lifecycle emails

| Email | Notification type | Triggered by |
|-------|-------------------|--------------|
| Welcome and account confirmed | `stylist_welcome` | DB trigger on `auth.users` when `email_confirmed_at` goes null → set |
| Free trial started | `stylist_trial_started` | Stripe `checkout.session.completed`, only when the subscription reports `trialing` |
| Trial ending soon | `stylist_trial_ending` | Stripe `customer.subscription.trial_will_end` (fires 3 days out) |
| Subscription confirmed / receipt | `stylist_subscription_confirmed` | Stripe `invoice.payment_succeeded`, amount > 0 |
| Payment failed (dunning) | `stylist_payment_failed` | Stripe `invoice.payment_failed`, amount due > 0 |

Rendering happens in `process-notification-queue`, which imports the
templates from `_shared/`. Deploying the function (the
`deploy-edge-functions` workflow, or `supabase functions deploy`) is what
ships template changes.

### Stripe dashboard: enable three more events

The subscription webhook endpoint (`/api/subscribe/webhook`) must have
these enabled, in addition to the four it already listens for:

- `customer.subscription.trial_will_end`
- `invoice.payment_succeeded`
- `invoice.payment_failed`

Until they are enabled the trial reminder, the payment receipt, and the
dunning notice simply never fire. Nothing else changes and no billing
behaviour depends on them: all three are read-only as far as this
endpoint is concerned. Subscription state during a failed payment still
arrives through `customer.subscription.updated` (status → `past_due`),
which was already enabled.

**Stripe → Developers → Webhooks → the Braid Boss Pro subscription
endpoint → Add events.**

### Duplicate protection

Three independent layers, all pre-existing:

1. `record_stripe_webhook_event` drops a replayed Stripe **event id**.
2. `queue_notification`'s `dedupe_key` drops a second row describing the
   same real-world moment (see `dedupeKeys` in
   `app/lib/subscription-emails.ts`).
3. The worker's atomic claim plus terminal `sent` state stops two
   workers sending the same row.

The dunning key is per **attempt** (`invoice id` + `attempt_count`), not
per invoice. Stripe retries a failed invoice several times over roughly
two weeks; each genuine attempt sends one notice, and a replayed webhook
for the same attempt sends none.

### What the failed-payment email deliberately does not say

- **No Stripe internals.** Decline codes, `last_payment_error` strings,
  and network responses are never read into the payload, let alone
  rendered. They mean nothing to a stylist and leak processor detail.
- **No raw billing-portal URL.** A portal session is a short-lived
  bearer credential. Mailing one would expire before many people open
  it and would hand billing access to anyone who saw the message. The
  button opens the app, which mints a fresh authenticated session on
  tap. The Stripe-hosted invoice link is included when Stripe provides
  one, since that link is designed to be emailed.
- **No threat.** `past_due` counts as live access in
  `app/lib/guest-limits.ts`, so the email says the account stays open,
  because it does. If that ever changes, the copy must change with it.

### Environment variables

Nothing new. The lifecycle emails use the variables the queue already
needs:

| Variable | Where | Used for |
|----------|-------|----------|
| `RESEND_API_KEY` | edge function secrets | sending |
| `RESEND_FROM_EMAIL` | edge function secrets | transactional From |
| `NEXT_PUBLIC_SITE_URL` | app + edge function | link and image origin |
| `SUPABASE_SERVICE_ROLE_KEY` | app + edge function | enqueue and dispatch |
| `STRIPE_SECRET_KEY` | app | re-reading the subscription for plan and card |
| `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` | app | signature verification |

---

## Previewing and testing without sending

```bash
# Browse every email at 320 / 375 / 640 px. Dev server only, 404s in prod.
npm run dev
open http://localhost:3000/api/dev/email-preview

# Or render every fixture to disk (no server, no network).
node scripts/render-email-previews.mjs
open .email-previews/index.html

# Unit tests for the templates and the Stripe payload mapping.
npx vitest run app/lib/lifecycle-emails.test.ts
```

### Sending a real test to an internal address

There is no "send test" button in the app on purpose. To put a real
message in a real inbox, use one of these:

**Auth emails.** Sign up with an internal address in an incognito
window. That is the only way to get a genuine, working confirmation
token, and it exercises SMTP, the template, and the redirect together.

**Queued lifecycle emails.** Insert one queue row for an internal
address and let the worker pick it up. Run this in the Supabase SQL
editor, substituting a **real internal user id and address**:

```sql
select public.queue_notification(
  user_id_in           => '<internal-user-uuid>',
  channel_in           => 'email',
  notification_type_in => 'stylist_trial_started',
  body_in              => 'Plain-text fallback for the trial started email.',
  subject_in           => 'Your 14-day Braid Boss Pro trial has started',
  recipient_email_in   => 'you@braidbosspro.app',
  payload_in           => jsonb_build_object(
    'firstName',             'Sheree',
    'planLabel',             'Monthly',
    'trialStart',            1755000000,
    'trialEnd',              1756209600,
    'amountAfterTrialMinor', 1499,
    'currency',              'usd',
    'interval',              'month',
    'cardBrand',             'visa',
    'cardLast4',             '4242',
    'timeZone',              'America/Los_Angeles',
    'stripeConnectActive',   true
  ),
  dedupe_key_in        => 'manual-test:' || gen_random_uuid()::text
);
```

Swap `notification_type_in` and the payload for the other four types.
The `dedupe_key_in` above is randomised so repeated tests are not
swallowed as duplicates; production keys are deterministic.

Do this against a **test** Stripe mode and a non-customer address. The
worker sends to whatever address the row carries, so a typo mails a
stranger.

### Stripe end-to-end, in test mode

1. Subscribe with a Stripe test card (`4242 4242 4242 4242`) →
   trial started should arrive.
2. Stripe → the test subscription → **Advance the clock** to three days
   before trial end → trial ending should arrive.
3. Advance past trial end → subscription confirmed should arrive.
4. Swap in a card that always declines (`4000 0000 0000 0341`) and
   advance to the next cycle → payment failed should arrive.

---

## Known email-client limits

- **Outlook (Windows, Word engine)** ignores `border-radius`, so the
  buttons and cards render as squares. Colour, size, and tap target are
  unaffected.
- **Gmail web** strips `<head><style>`, so the max-width media queries
  do not apply there. The layout is fluid without them, which is why
  every band is a percentage-width table rather than a fixed one.
- **Dark mode.** Templates pin `color-scheme: light only`. Gmail's
  Android client and Outlook.com force-invert regardless; the palette
  stays legible because every band sets an explicit background and a
  matching foreground.
- **Cormorant Garamond** is not available in email. Headlines fall back
  to Georgia, which is installed nearly everywhere and holds the same
  editorial tone.
