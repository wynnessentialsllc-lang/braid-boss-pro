-- Phase B9 — All-day personal events that fully block public booking.
--
-- Adds two flags to public.appointments so a stylist can drop a
-- single-tap "All day" event on the schedule and have the public
-- booking page treat that date as closed:
--
--   is_all_day            true → ignore time/duration; the row covers
--                                the whole calendar day.
--   blocks_availability   true (default) → the public slot RPC and
--                                month heatmap exclude this date.
--                         Setting to false lets the stylist note
--                                personal context without affecting
--                                what clients see.
--
-- public_list_availability returns no slots when any non-cancelled
-- all-day blocking event exists for the date. public_get_month_
-- availability falls through to its existing 0-slots → 'off' / 'booked'
-- bucket: any day with an all-day blocker shows up as 'off' on the
-- heatmap because the new branch returns before the inner slot RPC
-- runs.
--
-- Idempotent: column adds use `if not exists`, RPCs use create or
-- replace, no destructive operations.

-- =====================================================================
-- 1. Schema
-- =====================================================================
alter table public.appointments
  add column if not exists is_all_day boolean,
  add column if not exists blocks_availability boolean;

update public.appointments set is_all_day = false where is_all_day is null;
update public.appointments set blocks_availability = true where blocks_availability is null;

alter table public.appointments
  alter column is_all_day set default false,
  alter column is_all_day set not null,
  alter column blocks_availability set default true,
  alter column blocks_availability set not null;

-- Partial index — only the rows that actually block availability.
-- Drives the daily lookup in public_list_availability and the
-- per-day check in public_get_month_availability.
create index if not exists appointments_all_day_block_idx
  on public.appointments (user_id, appt_date)
  where is_all_day = true and blocks_availability = true and status <> 'cancelled';

-- =====================================================================
-- 2. public_list_availability — short-circuit on all-day blockers
-- =====================================================================
-- Re-creates the function with one new check inserted after the
-- existing off-day exception lookup. Keeps the variable_conflict
-- + qualified-alias fix from migration 20260524000000.
create or replace function public.public_list_availability(
  slug_in text,
  date_in date,
  duration_minutes_in integer default null,
  service_id_in uuid default null,
  slot_interval_minutes_in integer default 30
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
#variable_conflict use_variable
declare
  owner_id uuid;
  weekday_in smallint;
  rule record;
  exc_off boolean;
  all_day_block boolean;
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
begin
  interval_minutes := greatest(5, coalesce(slot_interval_minutes_in, 30));

  select user_id into owner_id
  from public.booking_links
  where slug = slug_in and active = true
  limit 1;
  if owner_id is null then
    return;
  end if;

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

  select true into exc_off
  from public.availability_exceptions ae
  where ae.user_id = owner_id and ae.kind = 'off'
    and date_in between ae.start_date and ae.end_date
  limit 1;
  if exc_off is true then
    return;
  end if;

  -- Phase B9: any non-cancelled all-day blocking event on this date
  -- closes the day for public booking entirely.
  select true into all_day_block
  from public.appointments a
  where a.user_id = owner_id
    and a.appt_date = date_in
    and a.is_all_day = true
    and a.blocks_availability = true
    and a.status <> 'cancelled'
  limit 1;
  if all_day_block is true then
    return;
  end if;

  weekday_in := extract(dow from date_in)::smallint;

  select ar.start_time, ar.end_time, ar.break_start, ar.break_end, ar.is_open
    into rule
  from public.availability_rules ar
  where ar.user_id = owner_id and ar.weekday = weekday_in
  limit 1;

  if rule is null then
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

  select ae.start_time, ae.end_time
    into exc_custom_start, exc_custom_end
  from public.availability_exceptions ae
  where ae.user_id = owner_id and ae.kind = 'custom'
    and date_in between ae.start_date and ae.end_date
  limit 1;
  if exc_custom_start is not null and exc_custom_end is not null then
    base_start := exc_custom_start;
    base_end := exc_custom_end;
    break_start := null;
    break_end := null;
  end if;

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
    -- Timed appointments only — all-day rows already short-circuited
    -- above. Filter to a.appt_time is not null so an unfortunate
    -- timed row missing its time doesn't produce nonsense overlap.
    select
      greatest(0, to_min(a.appt_time) - buffer_before) as r_start,
      to_min(a.appt_time) + greatest(15, (coalesce(a.duration_hours, 1) * 60)::integer) + buffer_after as r_end
    from public.appointments a
    where a.user_id = owner_id
      and a.appt_date = date_in
      and a.status <> 'cancelled'
      and a.appt_time is not null
      and (a.is_all_day is null or a.is_all_day = false)
    union all
    select to_min(ae.start_time), to_min(ae.end_time)
    from public.availability_exceptions ae
    where ae.user_id = owner_id and ae.kind = 'blocked'
      and date_in between ae.start_date and ae.end_date
      and ae.start_time is not null and ae.end_time is not null
    union all
    -- Approved-pending-deposit holds.
    select
      greatest(0, to_min(br.preferred_time) - buffer_before) as r_start,
      to_min(br.preferred_time)
        + greatest(15, (coalesce(br.service_duration_hours, br.service_duration, 1) * 60)::integer)
        + buffer_after as r_end
    from public.booking_requests br
    where br.user_id = owner_id
      and br.preferred_date = date_in
      and br.preferred_time is not null
      and br.approval_status = 'approved_pending_deposit'
      and (br.approval_expires_at is null or br.approval_expires_at > now())
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

revoke all on function public.public_list_availability(text, date, integer, uuid, integer) from public;
grant execute on function public.public_list_availability(text, date, integer, uuid, integer) to anon;
grant execute on function public.public_list_availability(text, date, integer, uuid, integer) to authenticated;

-- =====================================================================
-- 3. public_get_month_availability — surface all-day blocks as 'off'
-- =====================================================================
-- The function already buckets days with zero slots into 'off' /
-- 'booked' based on whether the weekday is closed. Add an explicit
-- all-day-block check so a date with an all-day personal event lands
-- in 'off' even when the weekday rule is open — that matches what
-- the stylist sees on their internal calendar.
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
          from public.appointments a
          where a.user_id = owner_id
            and a.appt_date = d
            and a.is_all_day = true
            and a.blocks_availability = true
            and a.status <> 'cancelled'
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

revoke all on function public.public_get_month_availability(text, integer, integer, uuid, integer) from public;
grant execute on function public.public_get_month_availability(text, integer, integer, uuid, integer) to anon;
grant execute on function public.public_get_month_availability(text, integer, integer, uuid, integer) to authenticated;
