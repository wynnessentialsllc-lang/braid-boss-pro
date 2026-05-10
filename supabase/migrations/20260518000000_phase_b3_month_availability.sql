-- Phase B3 — Smart availability calendar + booking heatmap.
--
-- This file is reconstructed from the live database after the fact.
-- The original migration was applied directly via the Supabase SQL
-- editor and never committed to the repo, so a fresh-environment
-- replay (CI seed, dev DB reset, new project) would skip Phase B3
-- and produce schema drift. Replaying this file from scratch lands
-- the same shape that already exists in production.
--
-- Adds:
--   1. booking_policies.availability_sensitivity (text, NOT NULL,
--      default 'balanced', CHECK in
--      {conservative, balanced, aggressive}). Drives the slot
--      interval used by the public month view + calendar heatmap.
--   2. public_get_month_availability(slug, year, month, service_id?,
--      duration_minutes?) — security-definer RPC that returns one
--      row per day of the month with a slot count and a status
--      label (off / booked / limited / available). Loops the
--      existing public_list_availability RPC under the hood so
--      slot logic stays in one place.
--
-- Idempotent: column add is `if not exists`, constraint creation is
-- guarded by pg_constraint lookup, function uses `create or replace`.

-- =====================================================================
-- 1. booking_policies.availability_sensitivity
-- =====================================================================
alter table public.booking_policies
  add column if not exists availability_sensitivity text;

update public.booking_policies
set availability_sensitivity = 'balanced'
where availability_sensitivity is null;

alter table public.booking_policies
  alter column availability_sensitivity set default 'balanced',
  alter column availability_sensitivity set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'booking_policies_availability_sensitivity_check'
  ) then
    alter table public.booking_policies
      add constraint booking_policies_availability_sensitivity_check
      check (availability_sensitivity in ('conservative', 'balanced', 'aggressive'));
  end if;
end $$;

-- =====================================================================
-- 2. public_get_month_availability
-- =====================================================================
-- Returns one row per calendar day in the requested month so the
-- public booking page can render a heatmap without N round trips.
-- Days in the past are returned as `off` with zero slots so the UI
-- can grey them out without doing date math itself. For days from
-- today onward we delegate to public_list_availability and bucket
-- the slot count into status labels:
--   0 slots + off-day exception or closed weekday → 'off'
--   0 slots otherwise                              → 'booked'
--   1–4 slots                                      → 'limited'
--   5+ slots                                       → 'available'
--
-- Slot interval is driven by the owner's availability_sensitivity:
--   conservative → 60-minute slots (fewer, only obvious openings)
--   balanced     → 30-minute slots (default)
--   aggressive   → 15-minute slots (squeeze every opening visible)
create or replace function public.public_get_month_availability(
  slug_in text,
  year_in integer,
  month_in integer,
  service_id_in uuid default null,
  duration_minutes_in integer default null
)
returns table (
  day_iso date,
  slot_count integer,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
  sensitivity text;
  interval_minutes integer;
  first_day date;
  last_day date;
  d date;
  slot_n integer;
begin
  if year_in is null or month_in is null then
    return;
  end if;

  if month_in < 1 or month_in > 12 then
    return;
  end if;

  select user_id into owner_id
  from public.booking_links
  where slug = slug_in and active = true
  limit 1;

  if owner_id is null then
    return;
  end if;

  select coalesce(availability_sensitivity, 'balanced')
  into sensitivity
  from public.booking_policies
  where user_id = owner_id
  limit 1;

  if sensitivity is null then
    sensitivity := 'balanced';
  end if;

  interval_minutes := case sensitivity
    when 'conservative' then 60
    when 'aggressive' then 15
    else 30
  end;

  first_day := make_date(year_in, month_in, 1);
  last_day := (first_day + interval '1 month' - interval '1 day')::date;

  d := first_day;

  while d <= last_day loop
    if d < current_date then
      day_iso := d;
      slot_count := 0;
      status := 'off';
      return next;
    else
      select count(*)
      into slot_n
      from public.public_list_availability(
        slug_in,
        d,
        duration_minutes_in,
        service_id_in,
        interval_minutes
      );

      day_iso := d;
      slot_count := coalesce(slot_n, 0);

      if slot_count = 0 then
        if exists (
          select 1
          from public.availability_exceptions
          where user_id = owner_id
            and kind = 'off'
            and d between start_date and end_date
        ) then
          status := 'off';
        elsif exists (
          select 1
          from public.availability_rules
          where user_id = owner_id
            and weekday = extract(dow from d)::smallint
            and is_open = false
        ) then
          status := 'off';
        else
          status := 'booked';
        end if;
      elsif slot_count <= 4 then
        status := 'limited';
      else
        status := 'available';
      end if;

      return next;
    end if;

    d := d + 1;
  end loop;
end;
$$;

revoke all on function public.public_get_month_availability(
  text, integer, integer, uuid, integer
) from public;
grant execute on function public.public_get_month_availability(
  text, integer, integer, uuid, integer
) to anon;
grant execute on function public.public_get_month_availability(
  text, integer, integer, uuid, integer
) to authenticated;

-- =====================================================================
-- Phase B2 analytics allow-list — keep parity with production
-- =====================================================================
-- Production's analytics_events anon-insert policy includes four
-- additional event types beyond what the Phase B2 migration shipped
-- (calendar_day_selected, availability_loaded, next_available_clicked,
-- slot_selected). They were added during the B3 rollout for the
-- heatmap UX. Reconstruct the policy so a fresh replay matches prod.
drop policy if exists "analytics_events_public_insert" on public.analytics_events;
create policy "analytics_events_public_insert"
on public.analytics_events
for insert
to anon
with check (
  event_source = 'public'
  and event_type in (
    'booking_requested',
    'waitlist_joined',
    'public_booking_viewed',
    'public_service_viewed',
    'public_slot_viewed',
    'calendar_day_selected',
    'availability_loaded',
    'next_available_clicked',
    'slot_selected'
  )
);
