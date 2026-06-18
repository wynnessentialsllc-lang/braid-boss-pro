-- Public booking spam guard + stale unpaid-deposit expiry.
--
-- Two related fixes for junk that lands in the Approvals queue from the
-- anonymous /book/<slug> form:
--
--   1. A BEFORE INSERT guard on booking_requests rejects public
--      submissions whose contact info is clearly invalid (malformed
--      email, a phone with too few digits, or no contact channel at
--      all). This is the server-side backstop behind the booking page's
--      client validation + honeypot and the edge function's checks, so
--      it holds no matter which path inserts the row. Owner-created rows
--      (created_from_public = false) are never touched.
--
--   2. expire_stale_approvals() now also expires deposit-first requests
--      that have been sitting in `awaiting_deposit` unpaid for more than
--      a day. Previously only the approve-first hold
--      (`approved_pending_deposit`) expired, so an abandoned (or fake)
--      deposit-first request stayed in the active queue forever. The
--      queue calls this lazily before every refresh, so no pg_cron is
--      needed.

-- =====================================================================
-- 1. Validate anonymous booking submissions.
-- =====================================================================
create or replace function public.validate_public_booking_request()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_email text := nullif(trim(coalesce(NEW.client_email, '')), '');
  v_phone text := nullif(trim(coalesce(NEW.client_phone, '')), '');
begin
  -- Only police rows that came from the public booking form. Anything
  -- the stylist creates in-app is trusted and passes untouched.
  if NEW.created_from_public is not true then
    return NEW;
  end if;

  -- Must have at least one usable way to reach the client.
  if v_email is null and v_phone is null then
    raise exception 'A phone number or email is required.'
      using errcode = 'check_violation';
  end if;

  -- Email, when supplied, has to look like an email.
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Please enter a valid email address.'
      using errcode = 'check_violation';
  end if;

  -- Phone, when supplied, needs at least 7 digits. Strips any
  -- formatting first so "(555) 010-1234" and "555.010.1234" both pass.
  if v_phone is not null
     and length(regexp_replace(v_phone, '\D', '', 'g')) < 7 then
    raise exception 'Please enter a valid phone number.'
      using errcode = 'check_violation';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_validate_public_booking_request on public.booking_requests;
create trigger trg_validate_public_booking_request
  before insert on public.booking_requests
  for each row execute function public.validate_public_booking_request();

-- =====================================================================
-- 2. Expire stale unpaid deposit-first requests too.
-- =====================================================================
create or replace function public.expire_stale_approvals()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  affected integer;
  affected2 integer;
begin
  -- Approve-first hold: the stylist approved and opened a deposit
  -- window that has now elapsed.
  update public.booking_requests
  set approval_status = 'expired',
      expired_at = now(),
      status = case when status in ('pending','approved') then 'declined' else status end
  where approval_status = 'approved_pending_deposit'
    and approval_expires_at is not null
    and approval_expires_at < now();
  get diagnostics affected = row_count;

  -- Deposit-first abandonment: the client was sent to Stripe but never
  -- paid. After 24h the slot is no longer reasonably held, so drop it
  -- out of the active queue. Only ever touches unpaid rows.
  update public.booking_requests
  set approval_status = 'expired',
      expired_at = now(),
      status = case when status in ('pending','approved') then 'declined' else status end
  where approval_status = 'awaiting_deposit'
    and coalesce(deposit_paid, false) = false
    and created_at < now() - interval '24 hours';
  get diagnostics affected2 = row_count;

  return coalesce(affected, 0) + coalesce(affected2, 0);
end;
$$;

revoke all on function public.expire_stale_approvals() from public;
grant execute on function public.expire_stale_approvals() to authenticated;
