-- Pickup availability uses the existing booking schedule (Phase D11).
--
-- Stylists already configure their working hours per day-of-week in
-- availability_rules + block one-off days in availability_exceptions.
-- Layering pickups on top of that infrastructure (instead of a parallel
-- pickup_days_of_week field) means a stylist who blocks Sunday because
-- they're traveling automatically blocks Sunday pickups too — no second
-- place to remember to update.
--
-- Add one column: availability_rules.pickup_enabled. When true, the
-- storefront includes that day-of-week in the buyer's pickup date picker
-- (filtered further by exceptions + turnaround_days_min).
--
-- product_orders.pickup_scheduled_at carries the buyer's structured pick
-- (real timestamptz) — surfaced to the stylist on the order screen and
-- ordered chronologically. A4's free-text pickup_preferred_time stays as
-- the fallback when the stylist hasn't toggled any day for pickup.
--
-- New public RPC public_get_pickup_availability(slug, days_ahead) returns
-- the upcoming list of allowed dates with the day's start/end window so the
-- storefront can render a date+time picker without exposing the schedule
-- internals (anon-safe).
--
-- This migration also cleans up the orphaned shop_settings.pickup_days_of
-- _week / window columns + the renamed RPC that an earlier draft of this
-- migration installed; they were never used in the app.

-- 1) Drop the orphaned shop_settings columns + the wider RPC from the
--    earlier draft. IF EXISTS so a fresh DB without them is fine too.
alter table public.shop_settings
  drop column if exists pickup_days_of_week,
  drop column if exists pickup_window_start,
  drop column if exists pickup_window_end;

drop function if exists public.public_get_shop_fulfillment(text);

-- Restore the previous (pre-draft) signature.
create or replace function public.public_get_shop_fulfillment(slug_in text)
returns table (
  pickup_enabled          boolean,
  delivery_enabled        boolean,
  shipping_enabled        boolean,
  shipping_mode           text,
  shipping_flat_rate      numeric,
  shipping_free_threshold numeric,
  delivery_fee            numeric,
  pickup_instructions     text,
  delivery_radius_miles   numeric,
  turnaround_days_min     integer,
  turnaround_days_max     integer
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
      coalesce(s.pickup_enabled, false),
      coalesce(s.delivery_enabled, false),
      coalesce(s.shipping_enabled, false),
      coalesce(s.shipping_mode, 'flat'),
      s.shipping_flat_rate,
      s.shipping_free_threshold,
      s.delivery_fee,
      s.pickup_instructions,
      s.delivery_radius_miles,
      s.turnaround_days_min,
      s.turnaround_days_max
    from public.shop_settings s
    where s.user_id = resolved.user_id
    limit 1;
end $$;

revoke all on function public.public_get_shop_fulfillment(text) from public;
grant execute on function public.public_get_shop_fulfillment(text) to anon, authenticated;

-- 2) Per-day-of-week pickup toggle on the existing schedule.
alter table public.availability_rules
  add column if not exists pickup_enabled boolean not null default false;

-- 3) Order column for the buyer's scheduled pickup time.
alter table public.product_orders
  add column if not exists pickup_scheduled_at timestamptz;

-- 4) Public RPC: list upcoming allowed pickup dates for a shop.
--
-- Returns rows of (date, start_time, end_time) for the next `days_ahead`
-- calendar days (capped at 30) where:
--   • availability_rules.is_open and availability_rules.pickup_enabled
--     are both true for that day's weekday,
--   • the date is at least turnaround_days_min from today (so a 1–3 day
--     turnaround shop doesn't offer tomorrow), and
--   • no availability_exceptions row blocks the date (full-day or all-
--     day overrides).
--
-- The storefront calls this once, dumps the list into a select. No
-- capacity model — pickups are slotless; the stylist confirms.
create or replace function public.public_get_pickup_availability(
  slug_in     text,
  days_ahead  integer default 21
)
returns table (
  pickup_date timestamptz,
  start_time  text,
  end_time    text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved        record;
  uid             uuid;
  days            integer := least(greatest(coalesce(days_ahead, 21), 1), 30);
  turnaround_min  integer;
  start_date      date;
begin
  select * into resolved from public.public_resolve_booking_slug(slug_in) limit 1;
  if resolved.user_id is null then
    return;
  end if;
  uid := resolved.user_id;
  select coalesce(s.turnaround_days_min, 0) into turnaround_min
    from public.shop_settings s
    where s.user_id = uid
    limit 1;
  start_date := (current_date + (coalesce(turnaround_min, 0) || ' days')::interval)::date;

  return query
    select
      (d::date)::timestamptz   as pickup_date,
      r.start_time,
      r.end_time
    from generate_series(start_date, start_date + (days - 1), interval '1 day') d
    join public.availability_rules r
      on r.user_id = uid
     and r.weekday = extract(dow from d)::int
     and r.is_open
     and r.pickup_enabled
    where not exists (
      select 1 from public.appointments a
      where a.user_id = uid
        and a.blocks_availability
        and a.is_all_day
        and a.status <> 'cancelled'
        and a.start_at::date <= d::date
        and a.end_at::date >= d::date
    )
    order by pickup_date asc;
end $$;

revoke all on function public.public_get_pickup_availability(text, integer) from public;
grant execute on function public.public_get_pickup_availability(text, integer) to anon, authenticated;

notify pgrst, 'reload schema';
