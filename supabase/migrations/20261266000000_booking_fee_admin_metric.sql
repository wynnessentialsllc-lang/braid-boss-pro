-- Surface the client-paid booking fee in the admin command center.
--
-- app/lib/booking-fee.ts charges clients a flat convenience fee on top
-- of their deposit/full-payment checkout, routed to the platform via
-- Stripe's application_fee_amount — real revenue that shows up nowhere
-- in the database. The checkout routes stamp the amount actually
-- charged into Stripe metadata (booking_fee_cents) but nothing ever
-- reads it back out, so admin_command_center has had no way to report
-- it.
--
-- This persists what was actually charged (not the current env var,
-- which can change) onto the booking_requests row at the moment the
-- webhook confirms payment, then sums it the same way deposits_at_
-- booking already is.
--
-- Postgres treats a function with an added parameter as a NEW
-- overload, even with DEFAULT NULL — CREATE OR REPLACE alone would
-- leave the old 3-/4-arg versions in place alongside these. Drop them
-- first so callers can't resolve to the stale signature.

begin;

alter table public.booking_requests
  add column if not exists booking_fee_amount numeric;

comment on column public.booking_requests.booking_fee_amount is
  'Platform booking-fee dollars actually charged to the client on this booking''s Stripe session (the checkout-time booking_fee_cents metadata / 100). Null when the fee was disabled or the booking predates this column.';

drop function if exists public.mark_deposit_paid_via_webhook(uuid, text, text);

create or replace function public.mark_deposit_paid_via_webhook(
  request_id_in uuid,
  stripe_session_id_in text,
  stripe_payment_intent_in text default null,
  booking_fee_cents_in integer default null
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
      booking_fee_amount = coalesce(
        booking_fee_amount,
        case when booking_fee_cents_in > 0 then booking_fee_cents_in / 100.0 else null end
      ),
      approval_expires_at = null
  where id = request_id_in
  returning * into row_out;

  return row_out;
end;
$$;

revoke all on function public.mark_deposit_paid_via_webhook(uuid, text, text, integer) from public;
grant execute on function public.mark_deposit_paid_via_webhook(uuid, text, text, integer) to service_role;

drop function if exists public.mark_full_payment_paid_via_webhook(uuid, text, text, numeric);

create or replace function public.mark_full_payment_paid_via_webhook(
  request_id_in uuid,
  stripe_session_id_in text,
  stripe_payment_intent_in text default null,
  amount_paid_in numeric default null,
  booking_fee_cents_in integer default null
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
      paid_in_full = true,
      amount_paid = coalesce(amount_paid_in, amount_paid, service_price),
      deposit_paid_at = coalesce(deposit_paid_at, now()),
      stripe_checkout_session_id = coalesce(stripe_checkout_session_id, stripe_session_id_in),
      stripe_session_id = coalesce(stripe_session_id, stripe_session_id_in),
      stripe_payment_intent_id = coalesce(stripe_payment_intent_id, stripe_payment_intent_in),
      booking_fee_amount = coalesce(
        booking_fee_amount,
        case when booking_fee_cents_in > 0 then booking_fee_cents_in / 100.0 else null end
      ),
      approval_expires_at = null
  where id = request_id_in
  returning * into row_out;

  return row_out;
end;
$$;

revoke all on function public.mark_full_payment_paid_via_webhook(uuid, text, text, numeric, integer) from public;
grant execute on function public.mark_full_payment_paid_via_webhook(uuid, text, text, numeric, integer) to service_role;

-- ---------------------------------------------------------------------
-- admin_command_center — add booking_fee_revenue to the revenue block.
-- Every other field mirrors 20261247000000 verbatim.
-- ---------------------------------------------------------------------
create or replace function public.admin_command_center(
  caller_email_in text,
  window_days_in integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  win_days  integer := greatest(1, least(365, coalesce(window_days_in, 30)));
  win_start timestamptz := now() - make_interval(days => win_days);
  result    jsonb;
begin
  if caller_email_in is null
     or lower(trim(caller_email_in)) <> 'shereewynn@icloud.com' then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  with
  deposits_win as (
    select coalesce(sum(deposit_amount), 0)::numeric as cents,
           count(*)::int as n,
           count(distinct user_id)::int as braiders
    from public.booking_requests
    where deposit_paid is true
      and deposit_paid_at is not null
      and deposit_paid_at >= win_start
  ),
  active_braiders as (
    select count(distinct user_id)::int as n
    from public.appointments
    where created_at >= win_start
  ),
  appts_win as (
    select
      count(*)::int as total,
      count(*) filter (where status ilike '%complet%')::int as completed,
      count(*) filter (where status ilike '%no%show%' or status = 'no_show')::int as no_show,
      count(*) filter (where cancelled_at is not null or status ilike '%cancel%')::int as cancelled,
      count(*) filter (where created_from_public is true)::int as from_public,
      coalesce(sum(total_price), 0)::numeric as booked_value,
      coalesce(sum(deposit_paid), 0)::numeric as deposits_at_booking
    from public.appointments
    where created_at >= win_start
  ),
  requests_win as (
    select
      count(*)::int as total,
      count(*) filter (where deposit_paid is true)::int as deposited,
      count(*) filter (where coalesce(approval_status, status) ilike '%pend%')::int as pending,
      count(*) filter (where no_show_fee_amount is not null and no_show_fee_amount > 0)::int as no_show_fees
    from public.booking_requests
    where created_at >= win_start
  ),
  -- ---- Client-paid booking fee (windowed, same clock as deposits) -----
  booking_fee_win as (
    select coalesce(sum(booking_fee_amount), 0)::numeric as amount,
           count(*) filter (where coalesce(booking_fee_amount, 0) > 0)::int as n
    from public.booking_requests
    where deposit_paid is true
      and deposit_paid_at is not null
      and deposit_paid_at >= win_start
  ),
  style_win as (
    select count(*)::int as ai_quotes
    from public.style_requests
    where created_at >= win_start
  ),
  retail_win as (
    select
      coalesce(sum(amount_total), 0)::numeric as gmv,
      coalesce(sum(application_fee), 0)::numeric as platform_fee,
      count(*)::int as orders
    from public.product_orders
    where paid_at is not null and paid_at >= win_start
  ),
  sms_win as (
    select coalesce(sum(amount_cents), 0)::numeric / 100.0 as revenue,
           coalesce(sum(credits), 0)::int as credits
    from public.sms_credit_purchases
    where status in ('paid', 'succeeded', 'complete', 'completed')
      and created_at >= win_start
  ),
  sms_liability as (
    select coalesce(sum(balance), 0)::int as outstanding,
           count(*) filter (where balance > 0)::int as accounts_holding
    from public.sms_credits
  ),
  subs as (
    select
      count(*)::int as total_braiders,
      count(*) filter (where subscription_status = 'active')::int as active,
      count(*) filter (where subscription_status = 'trialing')::int as trialing,
      count(*) filter (where subscription_status = 'past_due')::int as past_due,
      count(*) filter (where subscription_status in ('canceled', 'cancelled'))::int as canceled,
      count(*) filter (where lifetime_access is true)::int as lifetime,
      count(*) filter (where founding_access is true)::int as founding,
      count(*) filter (where created_at >= win_start)::int as new_in_window
    from public.profiles
  ),
  subs_by_status as (
    select coalesce(subscription_status, 'none') as s, count(*)::int as n
    from public.profiles group by 1
  ),
  activation as (
    select
      (select count(*) from public.profiles)::int as accounts,
      (select count(*) from public.profiles where stripe_connect_account_id is not null)::int as stripe_connected,
      (select count(*) from public.profiles where stripe_connect_charges_enabled is true)::int as charges_enabled,
      (select count(distinct user_id) from public.appointments)::int as took_booking,
      (select count(distinct user_id) from public.booking_requests where deposit_paid is true)::int as took_deposit
  ),
  stripe_health as (
    select
      count(*) filter (where stripe_connect_account_id is not null)::int as connected,
      count(*) filter (where stripe_connect_charges_enabled is true)::int as charges_enabled,
      count(*) filter (where stripe_connect_payouts_enabled is true)::int as payouts_enabled
    from public.profiles
  ),
  deposits_by_day as (
    select date_trunc('day', deposit_paid_at) as day, coalesce(sum(deposit_amount), 0)::numeric as cents
    from public.booking_requests
    where deposit_paid is true and deposit_paid_at is not null and deposit_paid_at >= win_start
    group by 1
  ),
  bookings_by_day as (
    select date_trunc('day', created_at) as day, count(*)::int as n
    from public.appointments
    where created_at >= win_start
    group by 1
  )
  select jsonb_build_object(
    'generated_at', now(),
    'window_days', win_days,
    'window_start', win_start,
    'north_star', jsonb_build_object(
      'deposited_revenue', (select cents from deposits_win),
      'deposit_count',     (select n from deposits_win),
      'active_braiders',   (select n from active_braiders),
      'per_braider',       case when (select n from active_braiders) > 0
                                 then round((select cents from deposits_win) / (select n from active_braiders), 2)
                                 else 0 end
    ),
    'revenue', jsonb_build_object(
      'booked_value',       (select booked_value from appts_win),
      'deposits_collected', (select cents from deposits_win),
      'deposits_at_booking',(select deposits_at_booking from appts_win),
      'retail_gmv',         (select gmv from retail_win),
      'retail_orders',      (select orders from retail_win),
      'platform_fee',       (select platform_fee from retail_win),
      'sms_revenue',        (select revenue from sms_win),
      'sms_credits_sold',   (select credits from sms_win),
      'sms_credits_outstanding', (select outstanding from sms_liability),
      'sms_accounts_holding_credits', (select accounts_holding from sms_liability),
      'booking_fee_revenue', (select amount from booking_fee_win),
      'booking_fee_charges',  (select n from booking_fee_win)
    ),
    'subscriptions', jsonb_build_object(
      'total_braiders', (select total_braiders from subs),
      'active',         (select active from subs),
      'trialing',       (select trialing from subs),
      'past_due',       (select past_due from subs),
      'canceled',       (select canceled from subs),
      'lifetime',       (select lifetime from subs),
      'founding',       (select founding from subs),
      'new_in_window',  (select new_in_window from subs),
      'mrr_estimate',   round((select active from subs) * 14.99, 2),
      'by_status',      (select coalesce(jsonb_object_agg(s, n), '{}'::jsonb) from subs_by_status)
    ),
    'bookings', jsonb_build_object(
      'requests_total',     (select total from requests_win),
      'requests_deposited', (select deposited from requests_win),
      'requests_pending',   (select pending from requests_win),
      'ai_quote_requests',  (select ai_quotes from style_win),
      'no_show_fee_charges',(select no_show_fees from requests_win),
      'appointments_total', (select total from appts_win),
      'appointments_completed', (select completed from appts_win),
      'appointments_no_show',   (select no_show from appts_win),
      'appointments_cancelled', (select cancelled from appts_win),
      'public_booking_share',   (select from_public from appts_win)
    ),
    'activation', jsonb_build_object(
      'accounts',         (select accounts from activation),
      'stripe_connected', (select stripe_connected from activation),
      'charges_enabled',  (select charges_enabled from activation),
      'took_booking',     (select took_booking from activation),
      'took_deposit',     (select took_deposit from activation)
    ),
    'stripe', (select to_jsonb(stripe_health) from stripe_health),
    'trend', jsonb_build_object(
      'deposits_by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', day, 'cents', cents) order by day), '[]'::jsonb) from deposits_by_day),
      'bookings_by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', day, 'n', n) order by day), '[]'::jsonb) from bookings_by_day)
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.admin_command_center(text, integer) from public;
grant execute on function public.admin_command_center(text, integer) to authenticated;
grant execute on function public.admin_command_center(text, integer) to service_role;

notify pgrst, 'reload schema';

commit;
