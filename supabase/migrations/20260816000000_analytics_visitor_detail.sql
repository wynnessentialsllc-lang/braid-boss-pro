-- analytics_events — visitor-level detail.
--
-- Public booking-page events are written with `user_id` = the stylist
-- who owns the link (that's what makes the owner-scoped booking
-- intelligence RPCs work), so the admin feed had exactly one identity
-- to show for every visitor of every booking page: the owner's. Two
-- different people browsing two different booking pages rendered
-- identically.
--
-- The client now stamps an anonymous visitor id and visit context into
-- `metadata` (see app/lib/analytics-context.ts):
--
--   visitor_id     durable, first-party, random   ("v_...")
--   session_id     rotates after 30m idle         ("s_...")
--   device / os / browser / installed_pwa
--   referrer_host / referrer_type                 (direct|internal|search|social|ai|referral)
--   utm_source / utm_medium / utm_campaign
--   is_new_visitor / is_new_session / local_hour / timezone / language
--
-- This migration adds the index that makes those readable in bulk and
-- extends `analytics_summary_for_admin` with the aggregates built on
-- them. The function keeps its signature and every key it returned
-- before — only new keys are added, so an un-migrated dashboard and a
-- migrated one both work.
--
-- Idempotent: index is `if not exists`, function is `create or replace`.

-- Bulk reads group by visitor and by referrer, so index both jsonb
-- expressions rather than making every dashboard load a seq scan.
create index if not exists analytics_events_visitor_idx
  on public.analytics_events ((metadata ->> 'visitor_id'), created_at desc);

create index if not exists analytics_events_referrer_idx
  on public.analytics_events ((metadata ->> 'referrer_type'), created_at desc);

create or replace function public.analytics_summary_for_admin(
  caller_email_in text,
  window_days_in integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  window_start timestamptz;
  result jsonb;
begin
  if caller_email_in is null
     or lower(trim(caller_email_in)) <> 'shereewynn@icloud.com' then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  window_start := now() - make_interval(days => greatest(1, coalesce(window_days_in, 30)));

  with windowed as (
    select *,
           -- One identity column for the whole query. Rows written
           -- before the visitor id existed fall back to their session,
           -- so historical counts stay sane instead of collapsing to 0.
           coalesce(metadata ->> 'visitor_id', session_id) as visitor_key
    from public.analytics_events
    where created_at >= window_start
  ),
  by_name as (
    select coalesce(event_name, event_type, 'unknown') as event_name, count(*)::int as n
    from windowed group by 1
  ),
  by_day as (
    select date_trunc('day', created_at) as day, count(*)::int as n
    from windowed group by 1 order by 1 desc limit 30
  ),
  by_category as (
    select coalesce(event_category, event_source, 'uncategorized') as event_category, count(*)::int as n
    from windowed group by 1
  ),
  -- Visitor counts, not event counts: one person refreshing a booking
  -- page twenty times is one phone, not twenty.
  by_device as (
    select coalesce(metadata ->> 'device', 'unknown') as device,
           count(distinct visitor_key)::int as n
    from windowed
    where visitor_key is not null
    group by 1
  ),
  by_referrer_type as (
    select coalesce(metadata ->> 'referrer_type', 'unknown') as referrer_type,
           count(distinct visitor_key)::int as n
    from windowed
    where visitor_key is not null
    group by 1
  ),
  top_referrers as (
    select metadata ->> 'referrer_host' as host,
           count(distinct visitor_key)::int as n
    from windowed
    where nullif(metadata ->> 'referrer_host', '') is not null
      and visitor_key is not null
    group by 1
    order by 2 desc
    limit 10
  ),
  top_sources as (
    select metadata ->> 'utm_source' as source,
           count(distinct visitor_key)::int as n
    from windowed
    where nullif(metadata ->> 'utm_source', '') is not null
      and visitor_key is not null
    group by 1
    order by 2 desc
    limit 10
  ),
  -- Which booking links visitors actually landed on, so a public event
  -- can be traced back to a stylist without joining profiles.
  top_pages as (
    select coalesce(nullif(path, ''), 'unknown') as path,
           count(distinct visitor_key)::int as visitors,
           count(*)::int as views
    from windowed
    where visitor_key is not null
    group by 1
    order by 2 desc
    limit 10
  ),
  recent as (
    select id, user_id, session_id,
           coalesce(event_name, event_type) as event_name,
           coalesce(event_category, event_source) as event_category,
           coalesce(metadata, payload, '{}'::jsonb) as metadata,
           path, created_at
    from windowed
    order by created_at desc
    limit 100
  ),
  errors as (
    select id, coalesce(event_name, event_type) as event_name,
           coalesce(metadata, payload, '{}'::jsonb) as metadata, created_at
    from windowed
    where coalesce(event_category, event_source) = 'error'
    order by created_at desc
    limit 50
  ),
  stripe_health as (
    select
      count(*) filter (where stripe_connect_account_id is not null)::int as connected,
      count(*) filter (where stripe_connect_charges_enabled)::int as charges_enabled,
      count(*) filter (where stripe_connect_payouts_enabled)::int as payouts_enabled
    from public.profiles
  )
  select jsonb_build_object(
    'window_days', greatest(1, coalesce(window_days_in, 30)),
    'window_start', window_start,
    'total_events', (select coalesce(sum(n), 0) from by_name),
    'by_name',     (select coalesce(jsonb_object_agg(event_name, n), '{}'::jsonb) from by_name),
    'by_category', (select coalesce(jsonb_object_agg(event_category, n), '{}'::jsonb) from by_category),
    'by_day',      (select coalesce(jsonb_agg(jsonb_build_object('day', day, 'n', n) order by day), '[]'::jsonb) from by_day),
    'by_device',   (select coalesce(jsonb_object_agg(device, n), '{}'::jsonb) from by_device),
    'by_referrer_type', (select coalesce(jsonb_object_agg(referrer_type, n), '{}'::jsonb) from by_referrer_type),
    'top_referrers', (select coalesce(jsonb_agg(jsonb_build_object('host', host, 'n', n) order by n desc), '[]'::jsonb) from top_referrers),
    'top_sources', (select coalesce(jsonb_agg(jsonb_build_object('source', source, 'n', n) order by n desc), '[]'::jsonb) from top_sources),
    'top_pages',   (select coalesce(jsonb_agg(jsonb_build_object('path', path, 'visitors', visitors, 'views', views) order by visitors desc), '[]'::jsonb) from top_pages),
    'recent',      (select coalesce(jsonb_agg(to_jsonb(recent) order by created_at desc), '[]'::jsonb) from recent),
    'errors',      (select coalesce(jsonb_agg(to_jsonb(errors) order by created_at desc), '[]'::jsonb) from errors),
    'stripe',      (select to_jsonb(stripe_health) from stripe_health),
    'totals',      jsonb_build_object(
                      'unique_users', (select count(distinct user_id)::int from windowed where user_id is not null),
                      'unique_sessions', (select count(distinct session_id)::int from windowed where session_id is not null),
                      'unique_visitors', (select count(distinct visitor_key)::int from windowed where visitor_key is not null),
                      'new_visitors', (select count(distinct visitor_key)::int from windowed
                                        where visitor_key is not null and (metadata ->> 'is_new_visitor') = 'true')
                   )
  ) into result;

  return result;
end;
$$;

revoke all on function public.analytics_summary_for_admin(text, integer) from public;
grant execute on function public.analytics_summary_for_admin(text, integer) to authenticated;
