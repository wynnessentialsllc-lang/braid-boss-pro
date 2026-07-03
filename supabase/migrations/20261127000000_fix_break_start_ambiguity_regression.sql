-- Fix (regression): public_list_availability reverted to a stale body.
--
-- Bug
-- ---
-- The Calendar Reveal migration (20261126000000_booking_window_calendar_reveal)
-- rebuilt public_list_availability from the *original* Phase B2 body
-- (20260517000000) — its comment even says "Same body as the Phase B2 RPC".
-- Phase B2 predates three later fixes to this function, so recreating it from
-- that base silently reverted all three:
--
--   1. 20260524000000 — the `#variable_conflict use_variable` directive and
--      the alias-qualified `into rule` read of availability_rules. Without
--      them, reading the `break_start` / `break_end` columns while local
--      variables of the same name are in scope raises, at runtime:
--
--        ERROR: column reference "break_start" is ambiguous
--
--      This is the client-facing crash: the public month heatmap calls
--      public_get_month_availability, which calls public_list_availability for
--      every visible day, so the whole month fails —
--      "Couldn't load this month's availability. column reference
--      'break_start' is ambiguous" — and no date can be picked.
--
--   2. 20260525000000 — the all-day personal-event short-circuit (the
--      `all_day_block` guard) and the `is_all_day` filter on the reserved
--      appointments. Without them an all-day blocking event no longer closes
--      the day for public booking, and an all-day row can pollute slot overlap.
--
--   3. 20260520000000 / 20260522000000 — the approved-pending-deposit holds
--      branch of `reserved`. Without it a slot held for a client who was
--      approved but hasn't paid the deposit can be double-booked.
--
-- Fix
-- ---
-- Restore the last-good body (20260525000000) and re-apply the Calendar Reveal
-- window gate from 20261126000000 on top of it — i.e. the true intended state
-- of that migration. Belt-and-suspenders against the collision: keep both
-- `#variable_conflict use_variable` and the alias-qualified column reads so a
-- future body copy can't quietly reintroduce the ambiguity.
--
-- Idempotent — create or replace, no DDL on tables.

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
  win record;
begin
  interval_minutes := greatest(5, coalesce(slot_interval_minutes_in, 30));

  -- 1. Resolve slug → owner.
  select bl.user_id into owner_id
  from public.booking_links bl
  where bl.slug = slug_in and bl.active = true
  limit 1;
  if owner_id is null then
    return;
  end if;

  -- 1.5. Calendar Reveal window (20261126000000). A date the stylist hasn't
  --      opened yet (or has closed) yields no slots — the client can't reach
  --      past the horizon even by calling this RPC directly.
  select * into win from public.compute_booking_window(owner_id);
  if date_in < win.min_date then
    return;
  end if;
  if win.max_date is not null and date_in > win.max_date then
    return;
  end if;

  -- 2. Resolve duration + buffers + concurrency.
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
  from public.availability_exceptions ae
  where ae.user_id = owner_id and ae.kind = 'off'
    and date_in between ae.start_date and ae.end_date
  limit 1;
  if exc_off is true then
    return;
  end if;

  -- 3.5. Phase B9 (20260525000000): any non-cancelled all-day blocking event
  --      on this date closes the day for public booking entirely.
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

  -- 4. Weekly rule for the weekday.
  --    Qualify with the table alias so the SELECT INTO can't be read as
  --    referencing the local variables of the same name.
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

  -- 5. Custom-hours exception overrides the weekly window for that day.
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

  -- 6. Build the open windows and emit fitting slots.
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
    -- Timed appointments only — all-day rows already short-circuited above.
    -- Filter to a.appt_time is not null so a timed row missing its time
    -- doesn't produce a nonsense overlap.
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
    -- Approved-pending-deposit holds (20260520000000 / 20260522000000). Uses
    -- canonical service_duration_hours with a service_duration fallback for
    -- legacy rows.
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
grant execute on function public.public_list_availability(text, date, integer, uuid, integer) to anon, authenticated;
