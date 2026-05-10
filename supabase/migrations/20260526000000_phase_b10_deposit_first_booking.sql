-- Phase B10 — Deposit-first booking flow.
--
-- Inverts the approval timeline. Instead of:
--   request → stylist approves → client pays
-- we now ship:
--   request → client pays deposit → stylist approves → appointment confirmed
--
-- New approval_status values:
--   awaiting_deposit                 — request landed, deposit owed
--   deposit_paid_pending_approval    — Stripe webhook confirmed payment
--   approved                         — stylist approved + appt created
--   denied                           — stylist declined (refund manual)
--   cancelled                        — client / system cancelled
--
-- Existing values stay valid so no historical row breaks:
--   pending_review, approved_pending_deposit, confirmed,
--   expired, declined.
--
-- Adds the columns the deposit flow needs and a partial index for
-- the "needs your attention" dashboard surface.
--
-- Idempotent throughout. Re-runnable.

-- =====================================================================
-- 1. Schema additions
-- =====================================================================
alter table public.booking_requests
  add column if not exists deposit_required boolean,
  add column if not exists deposit_paid boolean,
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists payment_status text,
  add column if not exists denied_reason text,
  add column if not exists denied_at timestamptz;

update public.booking_requests
set deposit_paid = (deposit_paid_at is not null)
where deposit_paid is null;

update public.booking_requests
set payment_status = case
  when deposit_paid_at is not null then 'paid'
  else 'unpaid'
end
where payment_status is null;

update public.booking_requests
set deposit_required = case
  when service_deposit_required is true then true
  when deposit_amount is not null and deposit_amount > 0 then true
  else false
end
where deposit_required is null;

-- Mirror legacy `decline_reason` / `declined_at` into the new fields
-- so the queue UI can read a single canonical column going forward.
update public.booking_requests
set denied_reason = decline_reason
where denied_reason is null and decline_reason is not null;

update public.booking_requests
set denied_at = declined_at
where denied_at is null and declined_at is not null;

alter table public.booking_requests
  alter column deposit_paid set default false,
  alter column deposit_paid set not null,
  alter column payment_status set default 'unpaid',
  alter column payment_status set not null,
  alter column deposit_required set default false,
  alter column deposit_required set not null;

-- Expand the approval_status check constraint.
do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'booking_requests_approval_status_chk'
  ) then
    alter table public.booking_requests
      drop constraint booking_requests_approval_status_chk;
  end if;
  alter table public.booking_requests
    add constraint booking_requests_approval_status_chk
    check (approval_status in (
      'pending_review',
      'approved_pending_deposit',
      'awaiting_deposit',
      'deposit_paid_pending_approval',
      'approved',
      'confirmed',
      'denied',
      'declined',
      'cancelled',
      'expired'
    ));
end $$;

-- Optional payment_status check — open the door for partial / refund
-- states later without forcing them now.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'booking_requests_payment_status_chk'
  ) then
    alter table public.booking_requests
      add constraint booking_requests_payment_status_chk
      check (payment_status in ('unpaid','paid','refunded','failed'));
  end if;
end $$;

-- "Needs your attention" — owners want a fast path to the deposit-paid
-- requests waiting on them.
create index if not exists booking_requests_needs_review_idx
  on public.booking_requests (user_id, created_at desc)
  where approval_status = 'deposit_paid_pending_approval';

-- Stripe checkout session lookup for the webhook handler. UNIQUE so
-- a retried webhook can't accidentally bind one session to multiple
-- requests.
create unique index if not exists booking_requests_stripe_checkout_session_id_uniq
  on public.booking_requests (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

-- =====================================================================
-- 2. public_submit_booking_request — deposit-aware insert
-- =====================================================================
-- Returns a row containing the new id PLUS the deposit context the
-- client needs to immediately call /api/booking-deposit/checkout
-- without a second round trip. When the snapshot says no deposit is
-- required the row lands as `pending_review` (legacy free flow);
-- otherwise it lands as `awaiting_deposit` and the client is redirected
-- straight to Stripe Checkout.
create or replace function public.public_submit_booking_request(
  slug_in text,
  client_name_in text,
  client_phone_in text default null,
  client_email_in text default null,
  service_id_in uuid default null,
  preferred_date_in date default null,
  preferred_time_in text default null,
  notes_in text default null,
  timezone_in text default null,
  locale_in text default null
)
returns table (
  request_id uuid,
  approval_status text,
  deposit_required boolean,
  deposit_amount numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
  svc_row public.services%rowtype;
  new_id uuid;
  effective_deposit_required boolean := false;
  effective_deposit_amount numeric := null;
  initial_status text := 'pending_review';
begin
  if slug_in is null or trim(slug_in) = '' then
    return;
  end if;
  if client_name_in is null or trim(client_name_in) = '' then
    return;
  end if;

  select user_id into owner_id
  from public.booking_links
  where slug = slug_in and active = true
  limit 1;
  if owner_id is null then
    return;
  end if;

  if service_id_in is not null then
    select * into svc_row
    from public.services
    where id = service_id_in and user_id = owner_id and is_active = true
    limit 1;
  end if;

  if svc_row.id is not null and svc_row.deposit_required is true and coalesce(svc_row.deposit_amount, 0) > 0 then
    effective_deposit_required := true;
    effective_deposit_amount := svc_row.deposit_amount;
    initial_status := 'awaiting_deposit';
  end if;

  insert into public.booking_requests (
    user_id, link_slug,
    client_name, client_phone, client_email,
    service_id, service_name, service_name_snapshot,
    service_duration, service_duration_hours,
    service_price,
    service_deposit_required, service_deposit_amount,
    service_prep_instructions,
    preferred_date, preferred_time, notes,
    timezone, locale, created_from_public,
    status, approval_status,
    deposit_required, deposit_amount,
    payment_status, deposit_paid
  ) values (
    owner_id,
    nullif(trim(slug_in), ''),
    nullif(trim(client_name_in), ''),
    nullif(trim(coalesce(client_phone_in, '')), ''),
    nullif(trim(coalesce(client_email_in, '')), ''),
    svc_row.id,
    coalesce(svc_row.name, null),
    coalesce(svc_row.name, null),
    svc_row.duration_hours,
    svc_row.duration_hours,
    svc_row.base_price,
    svc_row.deposit_required,
    svc_row.deposit_amount,
    svc_row.prep_instructions,
    preferred_date_in,
    nullif(trim(coalesce(preferred_time_in, '')), ''),
    nullif(trim(coalesce(notes_in, '')), ''),
    nullif(trim(coalesce(timezone_in, '')), ''),
    nullif(trim(coalesce(locale_in, '')), ''),
    true,
    'pending',
    initial_status,
    effective_deposit_required,
    effective_deposit_amount,
    'unpaid',
    false
  )
  returning id into new_id;

  request_id := new_id;
  approval_status := initial_status;
  deposit_required := effective_deposit_required;
  deposit_amount := effective_deposit_amount;
  return next;
end;
$$;

revoke all on function public.public_submit_booking_request(
  text, text, text, text, uuid, date, text, text, text, text
) from public;
grant execute on function public.public_submit_booking_request(
  text, text, text, text, uuid, date, text, text, text, text
) to anon;
grant execute on function public.public_submit_booking_request(
  text, text, text, text, uuid, date, text, text, text, text
) to authenticated;

-- =====================================================================
-- 3. public_get_booking_request_status — anon read for success page
-- =====================================================================
-- The /booking/success page polls this RPC to show "Deposit received,
-- waiting on stylist" copy without leaking the full row to anon. Only
-- returns the public surface fields.
create or replace function public.public_get_booking_request_status(
  request_id_in uuid
)
returns table (
  approval_status text,
  payment_status text,
  deposit_paid boolean,
  deposit_amount numeric,
  service_name text,
  preferred_date date,
  preferred_time text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select br.approval_status, br.payment_status, br.deposit_paid,
         br.deposit_amount, br.service_name, br.preferred_date, br.preferred_time
  from public.booking_requests br
  where br.id = request_id_in
  limit 1;
end;
$$;

revoke all on function public.public_get_booking_request_status(uuid) from public;
grant execute on function public.public_get_booking_request_status(uuid) to anon;
grant execute on function public.public_get_booking_request_status(uuid) to authenticated;

-- =====================================================================
-- 4. confirm_booking_request_approval — owner-side approval
-- =====================================================================
-- Called from the queue after the screen has matched/created a client
-- and an appointment row. Idempotent: if approval_status is already
-- `approved` and appointment_id is set, it returns the existing row
-- unchanged. Refuses to approve a row that hasn't been paid (unless
-- it's on the legacy approve-first state, which is allowed for
-- backwards compatibility).
create or replace function public.confirm_booking_request_approval(
  request_id_in uuid,
  appointment_id_in text
)
returns public.booking_requests
language plpgsql
security invoker
set search_path = public
as $$
declare
  caller uuid;
  row_out public.booking_requests;
  current_status text;
begin
  caller := auth.uid();
  if caller is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;
  if appointment_id_in is null or trim(appointment_id_in) = '' then
    raise exception 'appointment_id_required';
  end if;

  select approval_status into current_status
  from public.booking_requests
  where id = request_id_in and user_id = caller
  limit 1;

  if current_status is null then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;

  -- Idempotent — re-clicking approve doesn't double-create.
  if current_status = 'approved' or current_status = 'confirmed' then
    select * into row_out from public.booking_requests
    where id = request_id_in and user_id = caller;
    return row_out;
  end if;

  if current_status not in (
    'deposit_paid_pending_approval',
    'pending_review',
    'approved_pending_deposit'
  ) then
    raise exception 'request_not_approvable_in_state_%', current_status
      using errcode = 'P0001';
  end if;

  update public.booking_requests
  set approval_status = 'approved',
      approved_at = coalesce(approved_at, now()),
      confirmed_at = coalesce(confirmed_at, now()),
      appointment_id = appointment_id_in,
      approval_expires_at = null,
      status = case when status = 'declined' then 'declined' else 'approved' end
  where id = request_id_in and user_id = caller
  returning * into row_out;

  return row_out;
end;
$$;

revoke all on function public.confirm_booking_request_approval(uuid, text) from public;
grant execute on function public.confirm_booking_request_approval(uuid, text) to authenticated;

-- =====================================================================
-- 5. deny_booking_request — owner-side denial
-- =====================================================================
create or replace function public.deny_booking_request(
  request_id_in uuid,
  reason_in text default null
)
returns public.booking_requests
language plpgsql
security invoker
set search_path = public
as $$
declare
  caller uuid;
  row_out public.booking_requests;
begin
  caller := auth.uid();
  if caller is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  update public.booking_requests
  set approval_status = 'denied',
      denied_at = coalesce(denied_at, now()),
      declined_at = coalesce(declined_at, now()),
      denied_reason = nullif(trim(coalesce(reason_in, '')), ''),
      decline_reason = nullif(trim(coalesce(reason_in, '')), ''),
      approval_expires_at = null,
      status = 'declined'
  where id = request_id_in and user_id = caller
  returning * into row_out;

  if row_out.id is null then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
  return row_out;
end;
$$;

revoke all on function public.deny_booking_request(uuid, text) from public;
grant execute on function public.deny_booking_request(uuid, text) to authenticated;

-- =====================================================================
-- 6. mark_deposit_paid_via_webhook — service-role only
-- =====================================================================
-- The Stripe webhook (Next.js route, runs with the SUPABASE service
-- role key) calls this to flip the request to deposit_paid_pending_
-- approval. SECURITY DEFINER + a narrow signature so we don't have to
-- re-grant raw INSERT/UPDATE on booking_requests to anyone. Idempotent:
-- a retried webhook is a no-op once the row is past awaiting_deposit.
create or replace function public.mark_deposit_paid_via_webhook(
  request_id_in uuid,
  stripe_session_id_in text,
  stripe_payment_intent_in text default null
)
returns public.booking_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  row_out public.booking_requests;
  current_status text;
begin
  select approval_status into current_status
  from public.booking_requests
  where id = request_id_in
  limit 1;

  if current_status is null then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;

  -- Already past payment — no-op (webhook retries are common).
  if current_status in (
    'deposit_paid_pending_approval', 'approved', 'confirmed', 'denied', 'declined', 'cancelled'
  ) then
    select * into row_out from public.booking_requests where id = request_id_in;
    return row_out;
  end if;

  update public.booking_requests
  set approval_status = 'deposit_paid_pending_approval',
      payment_status = 'paid',
      deposit_paid = true,
      deposit_paid_at = coalesce(deposit_paid_at, now()),
      stripe_checkout_session_id = coalesce(stripe_checkout_session_id, stripe_session_id_in),
      stripe_session_id = coalesce(stripe_session_id, stripe_session_id_in),
      stripe_payment_intent_id = coalesce(stripe_payment_intent_id, stripe_payment_intent_in),
      approval_expires_at = null
  where id = request_id_in
  returning * into row_out;

  return row_out;
end;
$$;

revoke all on function public.mark_deposit_paid_via_webhook(uuid, text, text) from public;
grant execute on function public.mark_deposit_paid_via_webhook(uuid, text, text) to service_role;
