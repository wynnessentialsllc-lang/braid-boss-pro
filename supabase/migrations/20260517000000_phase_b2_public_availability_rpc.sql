-- Phase B2 — public live availability slot picker.
--
-- Adds a security-definer RPC the public booking page can call
-- anonymously to compute bookable slots for a (slug, date, service)
-- combination. Slot computation lives entirely server-side so anon
-- visitors never read raw owner availability / appointment data.
--
-- Loops the existing tables:
--   booking_links            slug → user_id
--   services                 duration / buffers / concurrency
--   availability_rules       weekly hours + breaks
--   availability_exceptions  off / custom hours / blocked windows
--   appointments             reserved time on the date
--
-- Phase A's getAvailableSlots() in app/lib/availability.ts is the
-- JS twin of this function for internal screens; both honour the
-- same rules so an internal stylist preview will match the public
-- view.

create or replace function public.public_list_availability(
  slug_in text,
  date_in date,
  duration_minutes_in integer default null,
  service_id_in uuid default null,
  slot_interval_minutes_in integer default 30
)
returns table (
  slot_time text,        -- "HH:mm" 24h, sortable
  slot_label text,       -- "9:00 AM" — UI-ready
  start_minute integer   -- minutes from midnight
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
  -- Working set of open windows for the day, after exceptions.
  windows record;
begin
  interval_minutes := greatest(5, coalesce(slot_interval_minutes_in, 30));

  -- 1. Resolve slug → owner.
  select user_id into owner_id
  from public.booking_links
  where slug = slug_in and active = true
  limit 1;
  if owner_id is null then
    return;
  end if;

  -- 2. Resolve duration + buffers + concurrency from the service if
  --    one was supplied; otherwise honour the explicit duration.
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
  if exc_off is true then
    return;
  end if;

  -- 4. Weekly rule for the weekday. JS Date.getDay() and
  --    extract(dow from date) both return 0 = Sunday.
  weekday_in := extract(dow from date_in)::smallint;
  select start_time, end_time, break_start, break_end, is_open
    into rule
  from public.availability_rules
  where user_id = owner_id and weekday = weekday_in
  limit 1;
  if rule is null then
    -- No rule configured → assume a generous default 9-18 so an
    -- un-configured studio doesn't appear closed.
    base_start := '09:00';
    base_end   := '18:00';
    break_start := null;
    break_end := null;
  elsif rule.is_open = false then
    return;
  else
    base_start := rule.start_time;
    base_end   := rule.end_time;
    break_start := rule.break_start;
    break_end := rule.break_end;
  end if;

  -- 5. Custom-hours exception overrides the weekly window for that day.
  select start_time, end_time
    into exc_custom_start, exc_custom_end
  from public.availability_exceptions
  where user_id = owner_id and kind = 'custom'
    and date_in between start_date and end_date
  limit 1;
  if exc_custom_start is not null and exc_custom_end is not null then
    base_start := exc_custom_start;
    base_end := exc_custom_end;
    break_start := null;
    break_end := null;
  end if;

  -- 6. Build the open windows. If a break is configured and falls
  --    inside the day, split into two windows.
  return query
  with raw_windows as (
    select
      to_min(base_start) as w_start,
      to_min(base_end) as w_end,
      to_min(break_start) as b_start,
      to_min(break_end) as b_end
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
    -- Existing bookings (non-cancelled), padded by buffer.
    select
      greatest(0, to_min(a.appt_time) - buffer_before) as r_start,
      to_min(a.appt_time) + greatest(15, (coalesce(a.duration_hours, 1) * 60)::integer) + buffer_after as r_end
    from public.appointments a
    where a.user_id = owner_id
      and a.appt_date = date_in
      and a.status <> 'cancelled'
      and a.appt_time is not null
    union all
    -- Explicit blocked-time exceptions.
    select to_min(start_time), to_min(end_time)
    from public.availability_exceptions
    where user_id = owner_id and kind = 'blocked'
      and date_in between start_date and end_date
      and start_time is not null and end_time is not null
  ),
  slot_candidates as (
    select
      gs.s as start_minute,
      gs.s + duration_minutes as end_minute
    from windows w,
      lateral generate_series(
        w.w_start,
        w.w_end - duration_minutes,
        interval_minutes
      ) as gs(s)
  ),
  slots_with_overlap as (
    select
      sc.start_minute,
      sc.end_minute,
      coalesce((
        select count(*)
        from reserved r
        where r.r_start < sc.end_minute and r.r_end > sc.start_minute
      ), 0) as overlap_count
    from slot_candidates sc
  )
  select
    to_hhmm(sw.start_minute) as slot_time,
    to_label(sw.start_minute) as slot_label,
    sw.start_minute
  from slots_with_overlap sw
  where sw.overlap_count < max_concurrent
  order by sw.start_minute asc;
end;
$$;

-- Helper: HH:mm → minutes from midnight.
create or replace function public.to_min(hhmm text)
returns integer
language sql
immutable
as $$
  select case
    when hhmm is null or hhmm = '' then null
    else split_part(hhmm, ':', 1)::int * 60 + coalesce(nullif(split_part(hhmm, ':', 2), '')::int, 0)
  end;
$$;

-- Helper: minutes → HH:mm (24h).
create or replace function public.to_hhmm(mins integer)
returns text
language sql
immutable
as $$
  select lpad((mins / 60)::text, 2, '0') || ':' || lpad((mins % 60)::text, 2, '0');
$$;

-- Helper: minutes → human label "9:00 AM".
create or replace function public.to_label(mins integer)
returns text
language sql
immutable
as $$
  select
    (((mins / 60 + 11) % 12) + 1)::text
    || ':'
    || lpad((mins % 60)::text, 2, '0')
    || case when (mins / 60) >= 12 then ' PM' else ' AM' end;
$$;

revoke all on function public.public_list_availability(text, date, integer, uuid, integer) from public;
grant execute on function public.public_list_availability(text, date, integer, uuid, integer) to anon;
grant execute on function public.public_list_availability(text, date, integer, uuid, integer) to authenticated;


-- =====================================================================
-- analytics_events — extend public allow-list
-- =====================================================================
-- Phase A capped anon inserts to a closed allow-list of event types.
-- Phase B2 needs `public_slot_viewed` so the page can record when
-- the slot picker loads. Re-create the policy with the broader list.
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
    'public_slot_viewed'
  )
);
