-- Fix: column-vs-variable ambiguity in public_list_availability.
--
-- Bug
-- ---
-- The PL/pgSQL function declared local variables `break_start` and
-- `break_end` that collide with the columns of the same name on
-- `availability_rules`. With Postgres's default #variable_conflict
-- mode of `error`, the SELECT INTO that reads those columns raises
--
--   ERROR: column reference "break_start" is ambiguous
--
-- at runtime — surfaced reliably by the Phase B7 month heatmap that
-- calls public_list_availability for every day in view, but also a
-- latent bug for the single-day slot picker on any code path that
-- reaches the SELECT INTO.
--
-- Fix
-- ---
-- Two-part: (1) switch the function to #variable_conflict use_variable
-- so the locals win on unqualified references, (2) qualify every
-- SELECT INTO and unqualified column reference with a table alias
-- (ar.* for availability_rules, ae.* for availability_exceptions) so
-- intent stays explicit either way and a future variable rename can't
-- reintroduce the collision.
--
-- No behavior change beyond fixing the crash. The held-slot logic
-- still reads service_duration_hours (added by Phase B1 consolidation,
-- 20260522000000) with a service_duration fallback for any legacy
-- rows that pre-date the snapshot.
--
-- Idempotent — uses create or replace, no DDL on tables.

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

  weekday_in := extract(dow from date_in)::smallint;

  -- Qualify with the table alias so the SELECT INTO can't be read as
  -- referencing the local variables of the same name.
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
    select
      greatest(0, to_min(a.appt_time) - buffer_before) as r_start,
      to_min(a.appt_time) + greatest(15, (coalesce(a.duration_hours, 1) * 60)::integer) + buffer_after as r_end
    from public.appointments a
    where a.user_id = owner_id
      and a.appt_date = date_in
      and a.status <> 'cancelled'
      and a.appt_time is not null
    union all
    select to_min(ae.start_time), to_min(ae.end_time)
    from public.availability_exceptions ae
    where ae.user_id = owner_id and ae.kind = 'blocked'
      and date_in between ae.start_date and ae.end_date
      and ae.start_time is not null and ae.end_time is not null
    union all
    -- Approved-pending-deposit holds. Uses canonical
    -- service_duration_hours (added in Phase B1 consolidation) with a
    -- service_duration fallback for legacy rows.
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
