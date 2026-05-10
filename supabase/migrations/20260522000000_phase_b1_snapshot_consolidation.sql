-- Phase B1 snapshot consolidation — close the production schema drift.
--
-- Background
-- ----------
-- The original Phase B1 booking-request snapshot migration
-- (20260516000000) was applied to the repo but never run against the
-- production database. As a result, public.booking_requests is
-- missing eight columns the B5a / B4 RPCs expected:
--
--   service_id, service_duration_hours,
--   service_deposit_required, service_deposit_amount,
--   service_prep_instructions, timezone, locale, created_from_public
--
-- This migration is the canonical fix. It:
--   1. Adds every missing column (idempotent, if not exists).
--   2. Adds the soft FK service_id → services(id) on delete set null
--      to match the appointments table convention.
--   3. Backfills existing rows by case-insensitive service_name match.
--   4. Re-creates the RPCs the broken hotfix patched, this time
--      using the canonical snapshot fields (service_id, deposit_*)
--      and dropping the temporary name-matching fallback.
--   5. Re-creates public_submit_booking_request, which is the second
--      half of the original B1 snapshot migration. The Edge Function
--      booking-request/index.ts is updated in the same PR to populate
--      service_id and the snapshot fields on every new write.
--
-- The migration is non-destructive: every existing column, index,
-- constraint, RLS policy, and row is preserved.
--
-- Rollback
-- --------
-- The schema additions are safe to leave even if the RPC layer is
-- reverted; nothing reads them unless asked. To roll back the column
-- additions:
--   alter table public.booking_requests
--     drop column if exists service_id,
--     drop column if exists service_duration_hours,
--     drop column if exists service_deposit_required,
--     drop column if exists service_deposit_amount,
--     drop column if exists service_prep_instructions,
--     drop column if exists timezone,
--     drop column if exists locale,
--     drop column if exists created_from_public;
-- The RPCs would also need to be reverted to their hotfix versions
-- (20260521000000) since they will reference the dropped columns.

-- =====================================================================
-- 1. Schema additions
-- =====================================================================
alter table public.booking_requests
  add column if not exists service_id uuid,
  add column if not exists service_duration_hours numeric(5, 2),
  add column if not exists service_deposit_required boolean,
  add column if not exists service_deposit_amount numeric(10, 2),
  add column if not exists service_prep_instructions text,
  add column if not exists timezone text,
  add column if not exists locale text,
  add column if not exists created_from_public boolean not null default false;

-- Soft FK matches the appointments table convention so deleting a
-- service stops dragging history with it.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'booking_requests_service_id_fkey'
  ) then
    alter table public.booking_requests
      add constraint booking_requests_service_id_fkey
      foreign key (service_id) references public.services(id) on delete set null;
  end if;
end $$;

-- Partial index — only rows with a resolved service_id pay the cost.
create index if not exists booking_requests_service_id_idx
  on public.booking_requests (service_id)
  where service_id is not null;

-- =====================================================================
-- 2. Backfill from the services catalog
-- =====================================================================
-- Match strategy: case-insensitive name match scoped to the same
-- owner (user_id). The services.user_id RLS index keeps this fast.
-- For each historical booking_requests row, we:
--   • populate service_id when a name match exists
--   • snapshot the deposit + duration fields from that service when
--     the request itself didn't carry them
-- Idempotent: re-running only touches rows where the target column
-- is still null.
update public.booking_requests br
set
  service_id = coalesce(br.service_id, s.id),
  service_duration_hours = coalesce(br.service_duration_hours, br.service_duration, s.duration_hours),
  service_deposit_required = coalesce(br.service_deposit_required, s.deposit_required),
  service_deposit_amount = coalesce(br.service_deposit_amount, s.deposit_amount),
  service_prep_instructions = coalesce(br.service_prep_instructions, s.prep_instructions)
from public.services s
where s.user_id = br.user_id
  and lower(s.name) = lower(br.service_name)
  and br.service_name is not null
  and br.service_name <> ''
  and (
    br.service_id is null
    or br.service_duration_hours is null
    or br.service_deposit_required is null
    or br.service_deposit_amount is null
    or br.service_prep_instructions is null
  );

-- For rows whose service_name doesn't match any current service
-- (renamed / deleted / typo), populate service_duration_hours from
-- the legacy `service_duration` column so the slot-hold calculation
-- has the correct duration without any join at read time.
update public.booking_requests
set service_duration_hours = service_duration
where service_duration_hours is null
  and service_duration is not null;

-- Stamp created_from_public as `true` for rows that came in via the
-- public link (link_slug present). Conservative — only fills nulls.
update public.booking_requests
set created_from_public = true
where created_from_public is distinct from true
  and link_slug is not null
  and link_slug <> '';

-- =====================================================================
-- 3. public_submit_booking_request — the missing half of original B1
-- =====================================================================
-- Lets the public booking page submit anonymously without a round
-- trip through the Edge Function. The current edge function still
-- works (writes via service role); this RPC is the lighter path
-- once we wire the page to it. Snapshots service catalog data at
-- submit time so subsequent owner edits don't rewrite history.
create or replace function public.public_submit_booking_request(
  slug_in text,
  client_name_in text,
  client_phone_in text default null,
  client_email_in text default null,
  service_id_in uuid default null,
  preferred_date_in date default null,
  preferred_time_in text default null,
  notes_in text default null,
  timezone_in text default null,
  locale_in text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
  svc_row public.services%rowtype;
  new_id uuid;
begin
  if slug_in is null or trim(slug_in) = '' then
    return null;
  end if;
  if client_name_in is null or trim(client_name_in) = '' then
    return null;
  end if;

  select user_id into owner_id
  from public.booking_links
  where slug = slug_in and active = true
  limit 1;
  if owner_id is null then
    return null;
  end if;

  -- Snapshot the service if one was supplied (and active for owner).
  if service_id_in is not null then
    select * into svc_row
    from public.services
    where id = service_id_in and user_id = owner_id and is_active = true
    limit 1;
  end if;

  insert into public.booking_requests (
    user_id, link_slug,
    client_name, client_phone, client_email,
    service_id, service_name, service_duration, service_duration_hours,
    service_price, service_deposit_required, service_deposit_amount,
    service_prep_instructions,
    preferred_date, preferred_time, notes,
    timezone, locale, created_from_public,
    status, approval_status
  ) values (
    owner_id,
    nullif(trim(slug_in), ''),
    nullif(trim(client_name_in), ''),
    nullif(trim(coalesce(client_phone_in, '')), ''),
    nullif(trim(coalesce(client_email_in, '')), ''),
    svc_row.id,
    coalesce(svc_row.name, null),
    svc_row.duration_hours,
    svc_row.duration_hours,
    svc_row.base_price,
    svc_row.deposit_required,
    svc_row.deposit_amount,
    svc_row.prep_instructions,
    preferred_date_in,
    nullif(trim(coalesce(preferred_time_in, '')), ''),
    nullif(trim(coalesce(notes_in, '')), ''),
    nullif(trim(coalesce(timezone_in, '')), ''),
    nullif(trim(coalesce(locale_in, '')), ''),
    true,
    'pending',
    'pending_review'
  )
  returning id into new_id;

  return new_id;
end;
$$;

revoke all on function public.public_submit_booking_request(
  text, text, text, text, uuid, date, text, text, text, text
) from public;
grant execute on function public.public_submit_booking_request(
  text, text, text, text, uuid, date, text, text, text, text
) to anon;
grant execute on function public.public_submit_booking_request(
  text, text, text, text, uuid, date, text, text, text, text
) to authenticated;

-- =====================================================================
-- 4. approve_booking_request — canonical fields, no name fallback
-- =====================================================================
create or replace function public.approve_booking_request(
  request_id_in uuid,
  deposit_amount_in numeric default null,
  expires_minutes_in integer default 30
)
returns public.booking_requests
language plpgsql
security invoker
set search_path = public
as $$
declare
  caller uuid;
  row_out public.booking_requests;
  resolved_deposit numeric;
  expires_minutes integer;
begin
  caller := auth.uid();
  if caller is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;
  expires_minutes := greatest(5, least(coalesce(expires_minutes_in, 30), 24 * 60));

  -- Explicit override wins; otherwise read the snapshot stamped at
  -- submit time. service_deposit_required + service_deposit_amount
  -- are populated either by the snapshot RPC, the edge function, or
  -- the backfill above.
  select coalesce(
    deposit_amount_in,
    case when service_deposit_required then service_deposit_amount end
  )
    into resolved_deposit
  from public.booking_requests
  where id = request_id_in and user_id = caller;

  update public.booking_requests
  set approval_status = 'approved_pending_deposit',
      deposit_amount = resolved_deposit,
      approval_expires_at = now() + (expires_minutes || ' minutes')::interval,
      approved_at = now(),
      expired_at = null,
      declined_at = null,
      decline_reason = null,
      status = 'approved'
  where id = request_id_in and user_id = caller
  returning * into row_out;

  if row_out.id is null then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
  return row_out;
end;
$$;

revoke all on function public.approve_booking_request(uuid, numeric, integer) from public;
grant execute on function public.approve_booking_request(uuid, numeric, integer) to authenticated;

-- =====================================================================
-- 5. public_list_availability — use canonical service_duration_hours
-- =====================================================================
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
  from public.availability_exceptions
  where user_id = owner_id and kind = 'off'
    and date_in between start_date and end_date
  limit 1;
  if exc_off is true then
    return;
  end if;

  weekday_in := extract(dow from date_in)::smallint;
  select start_time, end_time, break_start, break_end, is_open
    into rule
  from public.availability_rules
  where user_id = owner_id and weekday = weekday_in
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
    select to_min(start_time), to_min(end_time)
    from public.availability_exceptions
    where user_id = owner_id and kind = 'blocked'
      and date_in between start_date and end_date
      and start_time is not null and end_time is not null
    union all
    -- Approved-pending-deposit holds. Uses the canonical snapshot
    -- column populated by the snapshot RPC / edge function.
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
-- 6. get_booking_intelligence — canonical service_id join
-- =====================================================================
create or replace function public.get_booking_intelligence(
  start_in date default null,
  end_in date default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  caller uuid;
  win_start date;
  win_end date;
  result jsonb;
  funnel jsonb;
  top_services jsonb;
  pressure jsonb;
  waitlist_block jsonb;
  sources jsonb;
  demand jsonb;
  opportunity jsonb;
  approvals_block jsonb;
begin
  caller := auth.uid();
  if caller is null then
    return jsonb_build_object('error', 'auth_required');
  end if;

  win_end := coalesce(end_in, current_date);
  win_start := coalesce(start_in, win_end - interval '30 days');

  -- 1. Funnel
  with ev as (
    select event_type, count(*)::int as n
    from public.analytics_events
    where user_id = caller
      and created_at >= win_start::timestamptz
      and created_at < (win_end::timestamptz + interval '1 day')
    group by event_type
  ),
  by_type as (
    select coalesce(jsonb_object_agg(event_type, n), '{}'::jsonb) as map from ev
  ),
  appt_count as (
    select count(*)::int as n
    from public.appointments
    where user_id = caller
      and (status = 'completed' or status = 'scheduled' or status = 'confirmed')
      and source = 'public_booking'
      and created_at >= win_start::timestamptz
      and created_at < (win_end::timestamptz + interval '1 day')
  ),
  waitlist_total as (
    select count(*)::int as n
    from public.waitlist_requests
    where user_id = caller and created_at >= win_start::timestamptz
      and created_at < (win_end::timestamptz + interval '1 day')
  ),
  waitlist_booked as (
    select count(*)::int as n
    from public.waitlist_requests
    where user_id = caller and status = 'booked'
      and created_at >= win_start::timestamptz
      and created_at < (win_end::timestamptz + interval '1 day')
  )
  select jsonb_build_object(
    'page_views', coalesce((select (map -> 'public_booking_viewed')::int from by_type), 0),
    'service_views', coalesce((select (map -> 'public_service_viewed')::int from by_type), 0),
    'slot_views', coalesce((select (map -> 'public_slot_viewed')::int from by_type), 0),
    'booking_requests', coalesce((select (map -> 'booking_requested')::int from by_type), 0),
    'approved_bookings', (select n from appt_count),
    'waitlist_joined', (select n from waitlist_total),
    'waitlist_converted', (select n from waitlist_booked)
  ) into funnel;

  -- 2. Top services — canonical service_id join (no more name match)
  with svc_views as (
    select payload ->> 'serviceId' as svc_text, count(*)::int as views
    from public.analytics_events
    where user_id = caller
      and event_type in ('public_service_viewed','public_slot_viewed')
      and created_at >= win_start::timestamptz
      and payload ->> 'serviceId' is not null
    group by 1
  ),
  svc_views_typed as (
    -- Regex-guard the cast so a malformed payload can't crash the RPC
    select svc_text::uuid as svc, views
    from svc_views
    where svc_text ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  ),
  svc_requests as (
    select service_id as svc, count(*)::int as requests
    from public.booking_requests
    where user_id = caller
      and service_id is not null
      and created_at >= win_start::timestamptz
    group by 1
  ),
  svc_appts as (
    select service_id as svc, count(*)::int as approvals,
           coalesce(sum(coalesce(total_price, 0) - coalesce(discount_amount, 0)), 0)::numeric as revenue
    from public.appointments
    where user_id = caller and service_id is not null
      and status <> 'cancelled'
      and (created_at >= win_start::timestamptz or appt_date >= win_start)
    group by 1
  ),
  svc_meta as (select id, name from public.services where user_id = caller)
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
    into top_services
  from (
    select
      m.id as service_id, m.name as service_name,
      coalesce(v.views, 0) as views,
      coalesce(r.requests, 0) as requests,
      coalesce(a.approvals, 0) as approvals,
      coalesce(a.revenue, 0)::numeric as revenue,
      case when coalesce(v.views,0) > 0 then round((coalesce(a.approvals,0)::numeric / v.views) * 100, 1) else null end as conversion_pct
    from svc_meta m
    left join svc_views_typed v on v.svc = m.id
    left join svc_requests r on r.svc = m.id
    left join svc_appts a on a.svc = m.id
    order by coalesce(a.revenue,0) desc, coalesce(a.approvals,0) desc, coalesce(v.views,0) desc
    limit 10
  ) t;

  -- 3. Availability pressure
  with appts_window as (
    select appt_date, extract(dow from appt_date)::int as dow, appt_time
    from public.appointments
    where user_id = caller and status <> 'cancelled'
      and (kind is null or kind = 'appointment')
      and appt_date between win_start and win_end
  ),
  by_dow as (select dow, count(*)::int as n from appts_window group by dow),
  busiest_dow as (select dow, n from by_dow order by n desc limit 1),
  by_hour as (
    select substring(appt_time from 1 for 2)::int as hour, count(*)::int as n
    from appts_window where appt_time is not null group by 1
  ),
  busiest_hour as (select hour, n from by_hour order by n desc limit 1)
  select jsonb_build_object(
    'by_weekday', coalesce((select jsonb_agg(jsonb_build_object('dow', dow, 'count', n) order by dow) from by_dow), '[]'::jsonb),
    'busiest_weekday', (select dow from busiest_dow),
    'busiest_weekday_count', (select n from busiest_dow),
    'busiest_hour', (select hour from busiest_hour),
    'busiest_hour_count', (select n from busiest_hour)
  ) into pressure;

  -- 4. Waitlist intelligence
  with active_wl as (
    select count(*)::int as n from public.waitlist_requests
    where user_id = caller and status in ('waiting','contacted')
  ),
  total_wl as (
    select count(*)::int as n from public.waitlist_requests
    where user_id = caller and created_at >= win_start::timestamptz
  ),
  conv_wl as (
    select count(*)::int as n from public.waitlist_requests
    where user_id = caller and status = 'booked'
      and created_at >= win_start::timestamptz
  ),
  wl_top_services as (
    select coalesce(service_name, 'Unspecified') as service_name, count(*)::int as n
    from public.waitlist_requests
    where user_id = caller and created_at >= win_start::timestamptz
    group by 1 order by n desc limit 5
  ),
  wl_top_dates as (
    select coalesce(preferred_date::text, 'Flexible') as preferred_date, count(*)::int as n
    from public.waitlist_requests
    where user_id = caller and created_at >= win_start::timestamptz
    group by 1 order by n desc limit 5
  )
  select jsonb_build_object(
    'active', (select n from active_wl),
    'total_in_window', (select n from total_wl),
    'converted', (select n from conv_wl),
    'conversion_pct',
      case when (select n from total_wl) > 0
        then round(((select n from conv_wl)::numeric / (select n from total_wl)) * 100, 1)
        else null end,
    'top_services', coalesce((select jsonb_agg(row_to_json(t)) from wl_top_services t), '[]'::jsonb),
    'top_dates', coalesce((select jsonb_agg(row_to_json(t)) from wl_top_dates t), '[]'::jsonb)
  ) into waitlist_block;

  -- 5. Client sources
  with by_source as (
    select coalesce(nullif(referral_source, ''), 'other') as source,
           count(*)::int as bookings,
           coalesce(sum(coalesce(total_price, 0) - coalesce(discount_amount, 0)), 0)::numeric as revenue
    from public.appointments
    where user_id = caller and status <> 'cancelled'
      and (kind is null or kind = 'appointment')
      and appt_date between win_start and win_end
    group by 1
  )
  select coalesce(jsonb_agg(row_to_json(t) order by bookings desc), '[]'::jsonb)
    into sources from by_source t;

  -- 6. Calendar demand
  with daily as (
    select appt_date as day, count(*)::int as bookings,
           coalesce(sum(coalesce(total_price,0) - coalesce(discount_amount,0)), 0)::numeric as revenue
    from public.appointments
    where user_id = caller and status <> 'cancelled'
      and (kind is null or kind = 'appointment')
      and appt_date between win_start and win_end
    group by 1
  )
  select coalesce(jsonb_agg(row_to_json(t) order by day asc), '[]'::jsonb)
    into demand from daily t;

  -- 7. Revenue opportunity
  with avg_ticket as (
    select coalesce(
      avg(coalesce(total_price,0) - coalesce(discount_amount,0))
        filter (where status = 'completed' or status = 'scheduled' or status = 'confirmed'),
      0
    )::numeric as v
    from public.appointments
    where user_id = caller
      and (kind is null or kind = 'appointment')
      and appt_date between win_start and win_end
  ),
  unmet as (
    select count(*)::int as n from public.waitlist_requests
    where user_id = caller and status in ('waiting','contacted','declined')
      and created_at >= win_start::timestamptz
  )
  select jsonb_build_object(
    'unmet_demand', (select n from unmet),
    'avg_ticket', (select v from avg_ticket),
    'estimated_lost_revenue', round((select n from unmet) * (select v from avg_ticket), 2)
  ) into opportunity;

  -- 8. Approvals block
  with by_state as (
    select approval_status, count(*)::int as n,
           coalesce(sum(coalesce(deposit_amount, 0)), 0)::numeric as dep_total
    from public.booking_requests
    where user_id = caller
      and created_at >= win_start::timestamptz
      and created_at < (win_end::timestamptz + interval '1 day')
    group by approval_status
  ),
  totals as (
    select
      coalesce(sum(case when approval_status in ('approved_pending_deposit','confirmed','expired') then n end), 0)::int as approvals_sent,
      coalesce(sum(case when approval_status = 'confirmed' then n end), 0)::int as approvals_confirmed,
      coalesce(sum(case when approval_status = 'expired' then n end), 0)::int as approvals_expired,
      coalesce(sum(case when approval_status = 'declined' then n end), 0)::int as approvals_declined,
      coalesce(sum(case when approval_status = 'pending_review' then n end), 0)::int as awaiting_review,
      coalesce(sum(case when approval_status = 'approved_pending_deposit' then n end), 0)::int as awaiting_deposit,
      coalesce(sum(case when approval_status = 'expired' then dep_total end), 0)::numeric as expired_deposit_value
    from by_state
  )
  select jsonb_build_object(
    'approvals_sent', approvals_sent,
    'approvals_confirmed', approvals_confirmed,
    'approvals_expired', approvals_expired,
    'approvals_declined', approvals_declined,
    'awaiting_review', awaiting_review,
    'awaiting_deposit', awaiting_deposit,
    'deposit_conversion_pct',
      case when approvals_sent > 0
        then round((approvals_confirmed::numeric / approvals_sent) * 100, 1)
        else null end,
    'lost_deposit_value', expired_deposit_value
  )
    into approvals_block
  from totals;

  result := jsonb_build_object(
    'window', jsonb_build_object('start', win_start, 'end', win_end),
    'funnel', funnel,
    'top_services', top_services,
    'availability_pressure', pressure,
    'waitlist', waitlist_block,
    'client_sources', sources,
    'calendar_demand', demand,
    'revenue_opportunity', opportunity,
    'approvals', approvals_block
  );
  return result;
end;
$$;

revoke all on function public.get_booking_intelligence(date, date) from public;
grant execute on function public.get_booking_intelligence(date, date) to authenticated;
