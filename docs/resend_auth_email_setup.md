# Auth emails via Resend (custom SMTP)

Route Supabase Auth's transactional emails — **signup confirmation**, the
in-app **resend**, **password reset**, and **email change** — through the
Resend account you already use for booking confirmations. This removes
Supabase's built-in ~2–4 emails/hour cap (the root of the early
"no email / try again in 51 seconds" reports) and makes every auth email
land from your own verified `braidbosspro.app` domain.

Everything here is done in the **Supabase dashboard** for the
`braid-boss` project (`bjqazhplxqqhftekspfl`). Nothing in this repo needs
to change — the app already passes the right redirect
(`https://braidbosspro.app/auth/callback`).

---

## Step 1 — Turn on custom SMTP

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
  no new DNS is needed. Any `@braidbosspro.app` address works; a dedicated
  `no-reply@braidbosspro.app` is also fine if you prefer replies not to hit
  your `hello@` inbox.
- Port `587` also works (STARTTLS) if `465` is ever blocked.
- The API key is pasted directly into Supabase — it is **not** stored in
  this repo.

## Step 2 — Confirm the URL configuration

**Dashboard → Authentication → URL Configuration.**

- **Site URL:** `https://braidbosspro.app`
- **Redirect URLs (allow-list):** add
  - `https://braidbosspro.app/auth/callback`
  - `https://braidbosspro.app/**` (covers previews/other flows)

These must match what the app sends as `emailRedirectTo`, or the
confirmation link will bounce.

## Step 3 — Raise the email rate limit

**Dashboard → Authentication → Rate Limits → "Rate limit for sending emails".**

The built-in service caps this at a handful per hour. On custom SMTP you
can safely raise it (e.g. **100/hour** to start) — Resend's free tier is
100/day / 3,000/mo, and paid scales far beyond that. The **per-email**
resend cooldown (~60s) is separate and stays; the app already shows a
friendly countdown for it, so leave that as-is.

## Step 4 — Brand the confirmation email

**Dashboard → Authentication → Emails → Templates → "Confirm signup".**

**Subject:**

```
Confirm your email to start your 14-day free trial
```

**Message body (HTML):** paste `confirm-signup.html` from this folder.
It uses Supabase's `{{ .ConfirmationURL }}` variable, so the button and
fallback link are filled in automatically. The same look can be pasted
into the **Reset password** and **Magic Link** templates — just swap the
headline/CTA copy; the confirmation link variable is the same.

---

## Test checklist

1. Sign up with a fresh address in an incognito window.
2. Confirm the email arrives **from `hello@braidbosspro.app`** (not
   `noreply@mail.app.supabase.io`) — that proves SMTP is live.
3. Tap the button → it lands on `braidbosspro.app/auth/callback` and signs
   you in.
4. In Resend's dashboard, the send shows up under **Emails** with a
   `delivered` status.
5. Hit "Resend email" in the app within a minute → the friendly countdown
   shows instead of a raw error.
