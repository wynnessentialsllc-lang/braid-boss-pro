-- Phase B3 — month availability heatmap + owner sensitivity.
--
-- Builds on Phase B2's public_list_availability so a single RPC
-- can return per-day status across an entire calendar month, which
-- the public booking page can use to render the heatmap with
-- minimal round-trips.

-- =====================================================================
-- booking_policies — availability sensitivity
-- =====================================================================
-- Knob the owner can twist to bias the slot engine:
--   conservative  → 60-min slot interval (sparser openings, longer rests)
--   balanced      → 30-min interval (default; current behaviour)
--   aggressive    → 15-min interval (packs schedule tighter)
-- The public RPC reads this column and translates it into the
-- slot_interval_minutes argument passed to public_list_availability.
alter table public.booking_policies
  add column if not exists availability_sensitivity text not null default 'balanced';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'booking_policies_availability_sensitivity_check'
  ) then
    alter table public.booking_policies
      add constraint booking_policies_availability_sensitivity_check
      check (availability_sensitivity in ('conservative','balanced','aggressive'));
  end if;
end $$;


-- =====================================================================
-- public_list_availability — sensitivity fallback
-- =====================================================================
-- Re-creates the Phase B2 function so that passing NULL for
-- slot_interval_minutes_in falls back to the owner's
-- availability_sensitivity setting from booking_policies.
-- Behaviour is identical when the caller passes an explicit value.
create or replace function public.public_list_availability(
  slug_in text,
  date_in date,
  duration_minutes_in integer default null,
  service_id_in uuid default null,
  slot_interval_minutes_in integer default null
)
returns table (
  slot_time text,
  slot_label text,
  start_minute integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
  weekday_in smallint;
  rule record;
  exc_off boolean;
  exc_custom_start text;
  exc_custom_end text;
  base_start text;
  base_end text;
  break_start text;
  break_end text;
  duration_minutes integer;
  buffer_before integer := 0;
  buffer_after integer := 0;
  max_concurrent integer := 1;
  interval_minutes integer;
  sensitivity text;
begin
  -- 1. Resolve slug → owner.
  select user_id into owner_id
  from public.booking_links
  where slug = slug_in and active = true
  limit 1;
  if owner_id is null then
    return;
  end if;

  -- Translate sensitivity → slot interval when caller didn't pass one.
  if slot_interval_minutes_in is null then
    select coalesce(availability_sensitivity, 'balanced')
      into sensitivity
    from public.booking_policies
    where user_id = owner_id
    limit 1;
    if sensitivity is null then sensitivity := 'balanced'; end if;
    interval_minutes := case sensitivity
      when 'conservative' then 60
      when 'aggressive'   then 15
      else 30
    end;
  else
    interval_minutes := greatest(5, slot_interval_minutes_in);
  end if;

  -- 2. Resolve duration + buffers + concurrency from the service.
  if service_id_in is not null then
    select
      coalesce(duration_minutes_in, (s.duration_hours * 60)::integer),
      coalesce(s.buffer_before_minutes, 0),
      coalesce(s.buffer_after_minutes, 0),
      coalesce(s.max_concurrent, 1)
      into duration_minutes, buffer_before, buffer_after, max_concurrent
    from public.services s
    where s.id = service_id_in and s.user_id = owner_id and s.is_active = true
    limit 1;
  else
    duration_minutes := duration_minutes_in;
  end if;
  if duration_minutes is null or duration_minutes <= 0 then
    return;
  end if;
  duration_minutes := greatest(15, duration_minutes);

  -- 3. Off-day exception → no slots.
  select true into exc_off
  from public.availability_exceptions
  where user_id = owner_id and kind = 'off'
    and date_in between start_date and end_date
  limit 1;
  if exc_off is true then return; end if;

  -- 4. Weekly rule for the weekday.
  weekday_in := extract(dow from date_in)::smallint;
  select start_time, end_time, break_start, break_end, is_open
    into rule
  from public.availability_rules
  where user_id = owner_id and weekday = weekday_in
  limit 1;
  if rule is null then
    base_start := '09:00'; base_end := '18:00';
    break_start := null; break_end := null;
  elsif rule.is_open = false then
    return;
  else
    base_start := rule.start_time; base_end := rule.end_time;
    break_start := rule.break_start; break_end := rule.break_end;
  end if;

  -- 5. Custom-hours exception overrides the weekly window.
  select start_time, end_time
    into exc_custom_start, exc_custom_end
  from public.availability_exceptions
  where user_id = owner_id and kind = 'custom'
    and date_in between start_date and end_date
  limit 1;
  if exc_custom_start is not null and exc_custom_end is not null then
    base_start := exc_custom_start; base_end := exc_custom_end;
    break_start := null; break_end := null;
  end if;

  -- 6. Build windows + reserved + slot candidates.
  return query
  with raw_windows as (
    select to_min(base_start) as w_start, to_min(base_end) as w_end,
           to_min(break_start) as b_start, to_min(break_end) as b_end
  ),
  windows as (
    select w_start, b_start as w_end from raw_windows
    where b_start is not null and b_end is not null
      and b_start > w_start and b_start < w_end
    union all
    select b_end as w_start, w_end from raw_windows
    where b_start is not null and b_end is not null
      and b_end > w_start and b_end < w_end
    union all
    select w_start, w_end from raw_windows
    where b_start is null or b_end is null
       or b_start <= w_start or b_end >= w_end
  ),
  reserved as (
    select greatest(0, to_min(a.appt_time) - buffer_before) as r_start,
           to_min(a.appt_time) + greatest(15, (coalesce(a.duration_hours, 1) * 60)::integer) + buffer_after as r_end
    from public.appointments a
    where a.user_id = owner_id and a.appt_date = date_in
      and a.status <> 'cancelled' and a.appt_time is not null
    union all
    select to_min(start_time), to_min(end_time)
    from public.availability_exceptions
    where user_id = owner_id and kind = 'blocked'
      and date_in between start_date and end_date
      and start_time is not null and end_time is not null
  ),
  slot_candidates as (
    select gs.s as start_minute, gs.s + duration_minutes as end_minute
    from windows w,
      lateral generate_series(w.w_start, w.w_end - duration_minutes, interval_minutes) as gs(s)
  ),
  slots_with_overlap as (
    select sc.start_minute, sc.end_minute,
      coalesce((select count(*) from reserved r
                where r.r_start < sc.end_minute and r.r_end > sc.start_minute), 0) as overlap_count
    from slot_candidates sc
  )
  select to_hhmm(sw.start_minute), to_label(sw.start_minute), sw.start_minute
  from slots_with_overlap sw
  where sw.overlap_count < max_concurrent
  order by sw.start_minute asc;
end;
$$;

revoke all on function public.public_list_availability(text, date, integer, uuid, integer) from public;
grant execute on function public.public_list_availability(text, date, integer, uuid, integer) to anon;
grant execute on function public.public_list_availability(text, date, integer, uuid, integer) to authenticated;


-- =====================================================================
-- public_get_month_availability(slug, year, month, service_id)
-- =====================================================================
-- Returns one row per day in the month with the slot count + a
-- bucketed status the heatmap can colour without re-deriving:
--   off       — no rule applies / off exception covers the day
--   booked    — working day but zero slots fit
--   limited   — 1..4 slots
--   available — 5+ slots
--
-- Calls Phase B2's public_list_availability per day so logic stays
-- in one place. Bounded to ~31 days per call so the function never
-- explodes.
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

  -- Resolve slug → owner. The link must be active.
  select user_id into owner_id
  from public.booking_links
  where slug = slug_in and active = true
  limit 1;
  if owner_id is null then
    return;
  end if;

  -- Translate sensitivity → slot interval minutes. Owners who
  -- haven't set a policy row inherit the balanced 30-min default.
  select coalesce(availability_sensitivity, 'balanced')
    into sensitivity
  from public.booking_policies
  where user_id = owner_id
  limit 1;
  if sensitivity is null then sensitivity := 'balanced'; end if;
  interval_minutes := case sensitivity
    when 'conservative' then 60
    when 'aggressive'   then 15
    else 30
  end;

  first_day := make_date(year_in, month_in, 1);
  last_day := (first_day + interval '1 month' - interval '1 day')::date;

  -- Walk the month day-by-day. For each, ask the existing slot
  -- engine how many slots fit, then bucket. Today's date is the
  -- earliest cell the public heatmap should ever colour as available
  -- — past dates always come back as 'off' for the public surface.
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
        -- Distinguish "off" (truly closed) from "booked" (open but
        -- everything's full). public_list_availability returns 0 in
        -- both cases. Re-check whether the day is closed via the
        -- weekly rule or an off exception.
        if exists (
          select 1 from public.availability_exceptions
          where user_id = owner_id and kind = 'off'
            and d between start_date and end_date
        ) then
          status := 'off';
        elsif exists (
          select 1 from public.availability_rules
          where user_id = owner_id and weekday = extract(dow from d)::smallint
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

revoke all on function public.public_get_month_availability(text, integer, integer, uuid, integer) from public;
grant execute on function public.public_get_month_availability(text, integer, integer, uuid, integer) to anon;
grant execute on function public.public_get_month_availability(text, integer, integer, uuid, integer) to authenticated;


-- =====================================================================
-- analytics_events — extend public allow-list
-- =====================================================================
-- Phase B3 events the heatmap emits. Re-create the policy with the
-- broader list (additive — older events still allowed).
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
