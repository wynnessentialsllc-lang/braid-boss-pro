-- Phase B4 — Booking Intelligence dashboard.
--
-- Single SECURITY INVOKER RPC that aggregates everything the
-- Booking Intelligence screen needs in one round-trip. Owner-only
-- (relies on the standard RLS on every underlying table — the
-- function runs as the caller, so policy enforcement is automatic).
--
-- Returns jsonb so the shape can evolve without migrating every
-- consumer. The screen renders sections: funnel · top services ·
-- availability pressure · waitlist intelligence · client sources ·
-- calendar demand · revenue opportunity · smart insight seeds.

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
  events_total integer := 0;
  result jsonb;
  funnel jsonb;
  top_services jsonb;
  pressure jsonb;
  waitlist_block jsonb;
  sources jsonb;
  demand jsonb;
  opportunity jsonb;
begin
  caller := auth.uid();
  if caller is null then
    return jsonb_build_object('error', 'auth_required');
  end if;

  win_end := coalesce(end_in, current_date);
  win_start := coalesce(start_in, win_end - interval '30 days');

  -- ===================================================================
  -- 1. Funnel — analytics_events counts
  -- ===================================================================
  with ev as (
    select event_type, count(*)::int as n
    from public.analytics_events
    where user_id = caller
      and created_at >= win_start::timestamptz
      and created_at < (win_end::timestamptz + interval '1 day')
    group by event_type
  ),
  by_type as (
    select coalesce(jsonb_object_agg(event_type, n), '{}'::jsonb) as map
    from ev
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
    where user_id = caller
      and created_at >= win_start::timestamptz
      and created_at < (win_end::timestamptz + interval '1 day')
  ),
  waitlist_booked as (
    select count(*)::int as n
    from public.waitlist_requests
    where user_id = caller
      and status = 'booked'
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

  -- ===================================================================
  -- 2. Top services — view / request / approval / revenue
  -- ===================================================================
  with svc_views as (
    select coalesce((payload ->> 'serviceId')::uuid, null) as svc, count(*)::int as views
    from public.analytics_events
    where user_id = caller
      and event_type in ('public_service_viewed','public_slot_viewed')
      and created_at >= win_start::timestamptz
      and payload ->> 'serviceId' is not null
    group by 1
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
    where user_id = caller
      and service_id is not null
      and status <> 'cancelled'
      and (created_at >= win_start::timestamptz or appt_date >= win_start)
    group by 1
  ),
  svc_meta as (
    select id, name from public.services where user_id = caller
  )
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
    into top_services
  from (
    select
      m.id as service_id,
      m.name as service_name,
      coalesce(v.views, 0) as views,
      coalesce(r.requests, 0) as requests,
      coalesce(a.approvals, 0) as approvals,
      coalesce(a.revenue, 0)::numeric as revenue,
      case when coalesce(v.views,0) > 0 then round((coalesce(a.approvals,0)::numeric / v.views) * 100, 1) else null end as conversion_pct
    from svc_meta m
    left join svc_views v on v.svc = m.id
    left join svc_requests r on r.svc = m.id
    left join svc_appts a on a.svc = m.id
    order by coalesce(a.revenue,0) desc, coalesce(a.approvals,0) desc, coalesce(v.views,0) desc
    limit 10
  ) t;

  -- ===================================================================
  -- 3. Availability pressure — busiest weekdays + fully-booked count
  -- ===================================================================
  with appts_window as (
    select appt_date, extract(dow from appt_date)::int as dow, appt_time
    from public.appointments
    where user_id = caller
      and status <> 'cancelled'
      and (kind is null or kind = 'appointment')
      and appt_date between win_start and win_end
  ),
  by_dow as (
    select dow, count(*)::int as n
    from appts_window
    group by dow
  ),
  busiest_dow as (
    select dow, n
    from by_dow
    order by n desc
    limit 1
  ),
  by_hour as (
    select substring(appt_time from 1 for 2)::int as hour, count(*)::int as n
    from appts_window
    where appt_time is not null
    group by 1
  ),
  busiest_hour as (
    select hour, n from by_hour order by n desc limit 1
  )
  select jsonb_build_object(
    'by_weekday', coalesce((select jsonb_agg(jsonb_build_object('dow', dow, 'count', n) order by dow) from by_dow), '[]'::jsonb),
    'busiest_weekday', (select dow from busiest_dow),
    'busiest_weekday_count', (select n from busiest_dow),
    'busiest_hour', (select hour from busiest_hour),
    'busiest_hour_count', (select n from busiest_hour)
  ) into pressure;

  -- ===================================================================
  -- 4. Waitlist intelligence
  -- ===================================================================
  with active_wl as (
    select count(*)::int as n
    from public.waitlist_requests
    where user_id = caller
      and status in ('waiting','contacted')
  ),
  total_wl as (
    select count(*)::int as n
    from public.waitlist_requests
    where user_id = caller
      and created_at >= win_start::timestamptz
  ),
  conv_wl as (
    select count(*)::int as n
    from public.waitlist_requests
    where user_id = caller
      and status = 'booked'
      and created_at >= win_start::timestamptz
  ),
  wl_top_services as (
    select coalesce(service_name, 'Unspecified') as service_name, count(*)::int as n
    from public.waitlist_requests
    where user_id = caller
      and created_at >= win_start::timestamptz
    group by 1
    order by n desc
    limit 5
  ),
  wl_top_dates as (
    select coalesce(preferred_date::text, 'Flexible') as preferred_date, count(*)::int as n
    from public.waitlist_requests
    where user_id = caller
      and created_at >= win_start::timestamptz
    group by 1
    order by n desc
    limit 5
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

  -- ===================================================================
  -- 5. Client sources — appointments.referral_source
  -- ===================================================================
  with by_source as (
    select coalesce(nullif(referral_source, ''), 'other') as source,
           count(*)::int as bookings,
           coalesce(sum(coalesce(total_price, 0) - coalesce(discount_amount, 0)), 0)::numeric as revenue
    from public.appointments
    where user_id = caller
      and status <> 'cancelled'
      and (kind is null or kind = 'appointment')
      and appt_date between win_start and win_end
    group by 1
  )
  select coalesce(jsonb_agg(row_to_json(t) order by bookings desc), '[]'::jsonb)
    into sources
  from by_source t;

  -- ===================================================================
  -- 6. Calendar demand — bookings per day across the window
  -- ===================================================================
  with daily as (
    select appt_date as day, count(*)::int as bookings,
           coalesce(sum(coalesce(total_price,0) - coalesce(discount_amount,0)), 0)::numeric as revenue
    from public.appointments
    where user_id = caller
      and status <> 'cancelled'
      and (kind is null or kind = 'appointment')
      and appt_date between win_start and win_end
    group by 1
  )
  select coalesce(jsonb_agg(row_to_json(t) order by day asc), '[]'::jsonb)
    into demand
  from daily t;

  -- ===================================================================
  -- 7. Revenue opportunity (estimate)
  --    Lost bookings ≈ waitlist requests in window × avg ticket
  -- ===================================================================
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
    select count(*)::int as n
    from public.waitlist_requests
    where user_id = caller
      and status in ('waiting','contacted','declined')
      and created_at >= win_start::timestamptz
  )
  select jsonb_build_object(
    'unmet_demand', (select n from unmet),
    'avg_ticket', (select v from avg_ticket),
    'estimated_lost_revenue', round((select n from unmet) * (select v from avg_ticket), 2)
  ) into opportunity;

  result := jsonb_build_object(
    'window', jsonb_build_object('start', win_start, 'end', win_end),
    'funnel', funnel,
    'top_services', top_services,
    'availability_pressure', pressure,
    'waitlist', waitlist_block,
    'client_sources', sources,
    'calendar_demand', demand,
    'revenue_opportunity', opportunity
  );
  return result;
end;
$$;

revoke all on function public.get_booking_intelligence(date, date) from public;
grant execute on function public.get_booking_intelligence(date, date) to authenticated;
