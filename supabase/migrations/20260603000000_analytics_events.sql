-- analytics_events — privacy-conscious event log for pre-launch
-- analytics.
--
-- Phase A had a partial analytics_events table with
-- (event_type, event_source, payload). This migration extends it to
-- the v2 shape (event_name, event_category, metadata, session_id,
-- path, user_agent) and back-fills the new columns from the legacy
-- ones so dashboards reading either name keep working.
--
-- Writes go through /api/analytics/track using the service role key
-- (never directly from the browser supabase client), so RLS here is
-- locked down to deny-by-default.
--
-- Reads are restricted to the platform admin (email lives in
-- app/lib/admin.ts → isAdminUser) and are surfaced through
-- /api/admin/analytics, which validates the caller's session before
-- aggregating.

alter table public.analytics_events
  add column if not exists session_id text,
  add column if not exists event_name text,
  add column if not exists event_category text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists path text,
  add column if not exists user_agent text;

update public.analytics_events
set event_name = coalesce(event_name, event_type)
where event_name is null and event_type is not null;

update public.analytics_events
set event_category = coalesce(event_category, event_source)
where event_category is null and event_source is not null;

create index if not exists analytics_events_created_at_idx
  on public.analytics_events (created_at desc);
create index if not exists analytics_events_name_created_idx
  on public.analytics_events (event_name, created_at desc);
create index if not exists analytics_events_category_created_idx
  on public.analytics_events (event_category, created_at desc)
  where event_category is not null;
create index if not exists analytics_events_user_idx
  on public.analytics_events (user_id, created_at desc)
  where user_id is not null;

alter table public.analytics_events enable row level security;
-- No RLS policies → no anon/auth access. The /api/analytics/track
-- route uses the service role to insert; the admin RPC below is the
-- only read path.

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
    select * from public.analytics_events
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
    'recent',      (select coalesce(jsonb_agg(to_jsonb(recent) order by created_at desc), '[]'::jsonb) from recent),
    'errors',      (select coalesce(jsonb_agg(to_jsonb(errors) order by created_at desc), '[]'::jsonb) from errors),
    'stripe',      (select to_jsonb(stripe_health) from stripe_health),
    'totals',      jsonb_build_object(
                      'unique_users', (select count(distinct user_id)::int from windowed where user_id is not null),
                      'unique_sessions', (select count(distinct session_id)::int from windowed where session_id is not null)
                   )
  ) into result;

  return result;
end;
$$;

revoke all on function public.analytics_summary_for_admin(text, integer) from public;
grant execute on function public.analytics_summary_for_admin(text, integer) to authenticated;
