-- Manual approval gate before a new stylist can take real money.
--
-- Trigger: a wave of Connect signups since Aug 25 turned out to be
-- fraud — card-testing against the membership-checkout and
-- booking-deposit flows, using fake client names/emails. Stripe's own
-- Radar caught and rejected most of them, but only after money had
-- already moved through at least one account. Stripe onboarding
-- (KYC) proves someone controls a bank account; it says nothing about
-- whether the storefront they're about to open is legitimate. That
-- gap is what got exploited.
--
-- This adds a second, platform-side gate that sits in front of every
-- checkout route that creates a real charge on a connected account.
-- Being Stripe-`charges_enabled` is necessary but no longer
-- sufficient — the platform owner also has to flip
-- `platform_approved` before a stylist's storefront can take a
-- payment. New stylists start unapproved; the admin command center
-- surfaces who's waiting and an RPC approves them.

begin;

alter table public.profiles
  add column if not exists platform_approved boolean not null default false;

comment on column public.profiles.platform_approved is
  'Manual review gate, independent of Stripe''s own charges_enabled. Every checkout route that charges a connected account requires this to be true, so a newly-onboarded stylist cannot take money until the platform owner has looked at the account. Set via admin_set_platform_approval.';

alter table public.profiles
  add column if not exists platform_review_status text not null default 'pending'
    check (platform_review_status in ('pending', 'approved', 'rejected'));

comment on column public.profiles.platform_review_status is
  'Admin queue visibility, separate from platform_approved (the actual money gate). ''pending'' rows show up in admin_command_center.pending_approval; ''approved''/''rejected'' are dismissed from the queue whether or not platform_approved ended up true. Set alongside platform_approved by admin_set_platform_approval.';

-- Grandfather in stylists with real paid history — they're already
-- proven, not new signups riding the fraud wave. Everyone else
-- (including every account created since the fraud started, whether
-- flagged yet or not) starts unapproved and must be reviewed.
update public.profiles
set platform_approved = true,
    platform_review_status = 'approved'
where id in (
  select distinct user_id
  from public.booking_requests
  where deposit_paid is true
);

-- ---------------------------------------------------------------------
-- admin_set_platform_approval — the only way platform_approved changes
-- after signup. Same single-owner allow-list check as every other
-- admin RPC (admin_command_center, etc).
-- ---------------------------------------------------------------------
create or replace function public.admin_set_platform_approval(
  caller_email_in text,
  target_user_id_in uuid,
  approved_in boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if caller_email_in is null
     or lower(trim(caller_email_in)) <> 'shereewynn@icloud.com' then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  update public.profiles
  set platform_approved = approved_in,
      platform_review_status = case when approved_in then 'approved' else 'rejected' end
  where id = target_user_id_in;

  if not found then
    raise exception 'stylist_not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.admin_set_platform_approval(text, uuid, boolean) from public;
grant execute on function public.admin_set_platform_approval(text, uuid, boolean) to authenticated;
grant execute on function public.admin_set_platform_approval(text, uuid, boolean) to service_role;

-- ---------------------------------------------------------------------
-- admin_command_center — add a pending_approval list: every stylist
-- who has started or finished Stripe onboarding but hasn't been
-- approved yet. All-time, not windowed — a pending stylist doesn't
-- stop being pending just because they signed up 31 days ago. Every
-- other field mirrors 20261267000000 verbatim.
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
      p.created_at
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

-- ---------------------------------------------------------------------
-- Fold the approval gate into the storefront RPCs that hand
-- stylist_charges_enabled to the product/video/class checkout routes,
-- so "can this stylist take money" has exactly one answer everywhere
-- it's asked. Return shapes are unchanged — CREATE OR REPLACE is safe.
-- ---------------------------------------------------------------------
create or replace function public.public_get_product(slug_in text, product_slug_in text)
returns table(
  id uuid, user_id uuid, title text, slug text, description text,
  image_url text, gallery_images jsonb, price numeric,
  compare_at_price numeric, inventory_count integer, category text,
  is_featured boolean, local_pickup_available boolean,
  external_checkout_url text, requires_shipping boolean,
  variant_label text, variants jsonb, stylist_account_id text,
  stylist_charges_enabled boolean,
  is_gift_card boolean, gift_card_allow_custom boolean,
  is_digital boolean
)
language plpgsql security definer set search_path = public as $$
declare resolved record;
begin
  select * into resolved from public.public_resolve_booking_slug(slug_in) limit 1;
  if resolved.user_id is null then return; end if;
  return query
    select p.id, p.user_id, p.title, p.slug, p.description, p.image_url,
      coalesce(p.gallery_images, '[]'::jsonb),
      p.price, p.compare_at_price, p.inventory_count, p.category,
      p.is_featured, p.local_pickup_available,
      p.external_checkout_url, p.requires_shipping,
      p.variant_label,
      coalesce(p.variants, '[]'::jsonb),
      prof.stripe_connect_account_id,
      coalesce(prof.stripe_connect_charges_enabled, false) and coalesce(prof.platform_approved, false),
      coalesce(p.is_gift_card, false),
      coalesce(p.gift_card_allow_custom, false),
      coalesce(p.is_digital, false)
    from public.products p
    left join public.profiles prof on prof.id = p.user_id
    where p.user_id = resolved.user_id and p.active = true and p.slug = product_slug_in
    limit 1;
end $$;

revoke all on function public.public_get_product(text, text) from public;
grant execute on function public.public_get_product(text, text) to anon, authenticated, service_role;

create or replace function public.public_get_video(
  slug_in text,
  video_slug_in text
)
returns table (
  id                       uuid,
  user_id                  uuid,
  title                    text,
  slug                     text,
  description              text,
  cover_image_url          text,
  preview_url              text,
  price                    numeric,
  currency                 text,
  access_model             text,
  rental_days              integer,
  stylist_account_id       text,
  stylist_charges_enabled  boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved record;
begin
  select * into resolved
    from public.public_resolve_booking_slug(slug_in)
    limit 1;
  if resolved.user_id is null then
    return;
  end if;
  return query
    select
      v.id, v.user_id, v.title, v.slug, v.description, v.cover_image_url, v.preview_url,
      v.price, v.currency, v.access_model, v.rental_days,
      prof.stripe_connect_account_id as stylist_account_id,
      coalesce(prof.stripe_connect_charges_enabled, false) and coalesce(prof.platform_approved, false) as stylist_charges_enabled
    from public.video_lessons v
    left join public.profiles prof on prof.id = v.user_id
    where v.user_id = resolved.user_id
      and v.status = 'published'
      and v.slug = video_slug_in
    limit 1;
end $$;

revoke all on function public.public_get_video(text, text) from public;
grant execute on function public.public_get_video(text, text) to anon, authenticated;

create or replace function public.public_get_class(
  slug_in text,
  class_slug_in text
)
returns table (
  id                       uuid,
  user_id                  uuid,
  title                    text,
  slug                     text,
  description              text,
  cover_image_url          text,
  format                   text,
  price                    numeric,
  currency                 text,
  capacity                 integer,
  seats_remaining          integer,
  starts_at                timestamptz,
  duration_minutes         integer,
  timezone                 text,
  stylist_account_id       text,
  stylist_charges_enabled  boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved record;
begin
  select * into resolved
    from public.public_resolve_booking_slug(slug_in)
    limit 1;
  if resolved.user_id is null then
    return;
  end if;
  return query
    select
      c.id, c.user_id, c.title, c.slug, c.description, c.cover_image_url,
      c.format, c.price, c.currency, c.capacity,
      public.class_seats_remaining(c.id) as seats_remaining,
      c.starts_at, c.duration_minutes, c.timezone,
      prof.stripe_connect_account_id as stylist_account_id,
      coalesce(prof.stripe_connect_charges_enabled, false) and coalesce(prof.platform_approved, false) as stylist_charges_enabled
    from public.class_offerings c
    left join public.profiles prof on prof.id = c.user_id
    where c.user_id = resolved.user_id
      and c.status = 'published'
      and c.slug = class_slug_in
    limit 1;
end $$;

revoke all on function public.public_get_class(text, text) from public;
grant execute on function public.public_get_class(text, text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
