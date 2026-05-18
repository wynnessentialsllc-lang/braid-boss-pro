-- Idempotency guards for client-facing denial / refund emails.
-- One-shot per booking request; the /api/booking-deposit/refund
-- route claims the matching column (UPDATE ... WHERE col IS NULL)
-- before enqueueing, so repeated denials / Stripe retries /
-- double-clicks can't duplicate the email.
alter table public.booking_requests
  add column if not exists denied_email_sent_at timestamptz,
  add column if not exists refund_email_sent_at timestamptz,
  add column if not exists refund_manual_email_sent_at timestamptz;
