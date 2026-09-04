-- Surface the fraud-review checklist directly on each pending-approval
-- row instead of leaving it as something the admin has to remember.
--
-- Every account in the Aug 25 fraud wave shared the same tells:
--   - an auto-generated-looking email (letters + 2-4 digits @gmail.com —
--     james43@, derick76@, been76@, peters43@, ekanda682@, angelnduva767@,
--     philbrewerton868@ all match)
--   - zero services and zero clients set up before connecting Stripe —
--     a real braider builds out their storefront first
--   - Stripe onboarding finished within minutes of signup
--
-- None of these prove fraud on their own (a fast, thin signup can be a
-- real person in a hurry), so this ships the raw signals rather than a
-- single verdict — the admin still decides, just with the checklist
-- already run for them.

begin;

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
    select coalesce(sum(deposit_amount), 0)::numeric as amount,
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
    select date_trunc('day', deposit_paid_at) as day, coalesce(sum(deposit_amount), 0)::numeric as amount
    from public.booking_requests
    where deposit_paid is true and deposit_paid_at is not null and deposit_paid_at >= win_start
    group by 1
  ),
  bookings_by_day as (
    select date_trunc('day', created_at) as day, count(*)::int as n
    from public.appointments
    where created_at >= win_start
    group by 1
  ),
  pending_stylists as (
    select
      p.id,
      u.email,
      p.business_name,
      p.full_name,
      p.stripe_connect_account_id,
      p.stripe_connect_status,
      p.stripe_connect_charges_enabled,
      p.created_at,
      (select count(*)::int from public.services s where s.user_id = p.id) as services_count,
      (select count(*)::int from public.clients c where c.user_id = p.id) as clients_count,
      -- Minutes between account signup and the last time Stripe Connect
      -- status was synced (onboarding return, or a manual refresh) — an
      -- approximation of onboarding speed, not an exact "completed at"
      -- timestamp. Null until the account has synced at least once.
      case when p.stripe_connect_updated_at is not null
        then round(extract(epoch from (p.stripe_connect_updated_at - p.created_at)) / 60.0)
        else null
      end as minutes_to_stripe_sync,
      -- letters followed by 2-4 digits before the @ — the shape every
      -- fake client/stylist email in the Aug 25 wave shared.
      (u.email ~* '^[a-z]+[0-9]{2,4}@') as email_looks_generated
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.platform_review_status = 'pending'
      and p.stripe_connect_account_id is not null
    order by p.created_at desc
  )
  select jsonb_build_object(
    'generated_at', now(),
    'window_days', win_days,
    'window_start', win_start,
    'north_star', jsonb_build_object(
      'deposited_revenue', (select amount from deposits_win),
      'deposit_count',     (select n from deposits_win),
      'active_braiders',   (select n from active_braiders),
      'per_braider',       case when (select n from active_braiders) > 0
                                 then round((select amount from deposits_win) / (select n from active_braiders), 2)
                                 else 0 end
    ),
    'revenue', jsonb_build_object(
      'booked_value',       (select booked_value from appts_win),
      'deposits_collected', (select amount from deposits_win),
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
      'deposits_by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', day, 'amount', amount) order by day), '[]'::jsonb) from deposits_by_day),
      'bookings_by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', day, 'n', n) order by day), '[]'::jsonb) from bookings_by_day)
    ),
    'pending_approval', (select coalesce(jsonb_agg(to_jsonb(pending_stylists)), '[]'::jsonb) from pending_stylists)
  ) into result;

  return result;
end;
$$;

revoke all on function public.admin_command_center(text, integer) from public;
grant execute on function public.admin_command_center(text, integer) to authenticated;
grant execute on function public.admin_command_center(text, integer) to service_role;

notify pgrst, 'reload schema';

commit;
