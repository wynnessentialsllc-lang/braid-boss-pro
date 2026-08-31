-- Hard daily ceilings for the public AI routes.
--
-- style-consult, booking-concierge and booking-color-photo run on the
-- PUBLIC booking page: no session, keyed by slug, open to anyone with
-- the link. Each one spends the platform's Anthropic budget, and the
-- only thing standing in front of them is app/lib/rate-limit.ts, whose
-- own header is candid about what it is:
--
--   "this is a speed bump, not a guarantee. On serverless the counter
--    lives in a single instance's memory, so it resets on cold starts
--    and isn't shared across concurrent instances ... For a hard
--    guarantee, back this with a shared store."
--
-- So the per-minute limit resets whenever a lambda recycles and is
-- enforced per-instance rather than globally, and there is no ceiling
-- at all beyond the minute. A patient caller with one booking link can
-- spend without bound. This is the shared store that comment asks for.
--
-- Deliberately NOT billed to the stylist's credit balance. Metering
-- these against her wallet would let any visitor drain the credits her
-- appointment reminders depend on -- denial-of-wallet dressed up as a
-- feature. The platform absorbs the cost and caps it instead.
--
-- Two ceilings, because they fail differently:
--   * per slug  -- contains one abused booking link to its own budget
--                  without taking the feature away from everyone else.
--   * global    -- the circuit breaker for a spread-out attack across
--                  many slugs, which a per-slug cap alone would miss.

create table if not exists public.public_ai_usage (
  day       date    not null default (now() at time zone 'utc')::date,
  feature   text    not null,
  scope     text    not null check (scope in ('slug', 'global')),
  scope_key text    not null,
  calls     integer not null default 0,
  primary key (day, feature, scope, scope_key)
);

-- Counters only; nothing reads this from the client.
alter table public.public_ai_usage enable row level security;

-- Retention: yesterday's counters have no use once the day rolls.
create index if not exists public_ai_usage_day_idx
  on public.public_ai_usage (day);

-- ---------------------------------------------------------------
-- claim_public_ai_call -- atomic "may this call proceed?"
-- ---------------------------------------------------------------
-- The conditional UPDATE is what makes this exact under concurrency:
--
--   on conflict ... do update set calls = calls + 1 where calls < cap
--
-- When the WHERE fails no row comes back, so the caller is over its
-- ceiling and nothing was incremented. Two simultaneous requests at
-- the boundary cannot both win, because only one UPDATE can observe a
-- count below the cap.
--
-- The global counter moves first. If the per-slug claim then fails,
-- the global increment is compensated back -- otherwise one busy slug
-- would burn down the platform-wide budget it never got to spend.
create or replace function public.claim_public_ai_call(
  feature_in    text,
  slug_in       text,
  slug_cap_in   integer,
  global_cap_in integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day        date := (now() at time zone 'utc')::date;
  v_feature    text := left(coalesce(nullif(trim(feature_in), ''), 'unknown'), 60);
  v_slug       text := left(lower(coalesce(nullif(trim(slug_in), ''), '(none)')), 120);
  v_slug_cap   integer := greatest(1, coalesce(slug_cap_in, 40));
  v_global_cap integer := greatest(1, coalesce(global_cap_in, 1000));
  v_global     integer;
  v_slug_calls integer;
begin
  insert into public.public_ai_usage as u (day, feature, scope, scope_key, calls)
  values (v_day, v_feature, 'global', '*', 1)
  on conflict (day, feature, scope, scope_key) do update
    set calls = u.calls + 1
  where u.calls < v_global_cap
  returning u.calls into v_global;

  if v_global is null then
    return jsonb_build_object('ok', false, 'reason', 'global_daily_cap', 'cap', v_global_cap);
  end if;

  insert into public.public_ai_usage as u (day, feature, scope, scope_key, calls)
  values (v_day, v_feature, 'slug', v_slug, 1)
  on conflict (day, feature, scope, scope_key) do update
    set calls = u.calls + 1
  where u.calls < v_slug_cap
  returning u.calls into v_slug_calls;

  if v_slug_calls is null then
    -- Give the global budget back; this call is not happening.
    update public.public_ai_usage
       set calls = greatest(0, calls - 1)
     where day = v_day and feature = v_feature and scope = 'global' and scope_key = '*';
    return jsonb_build_object('ok', false, 'reason', 'slug_daily_cap', 'cap', v_slug_cap);
  end if;

  return jsonb_build_object(
    'ok', true, 'slug_calls', v_slug_calls, 'global_calls', v_global);
end $$;

revoke all on function public.claim_public_ai_call(text, text, integer, integer) from public;
grant execute on function public.claim_public_ai_call(text, text, integer, integer) to service_role;

-- ---------------------------------------------------------------
-- refund_public_ai_call -- the model call never happened.
-- ---------------------------------------------------------------
-- A claim is taken before Anthropic is called, so a failure there
-- would otherwise burn budget for a response nobody received.
create or replace function public.refund_public_ai_call(
  feature_in text,
  slug_in    text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day     date := (now() at time zone 'utc')::date;
  v_feature text := left(coalesce(nullif(trim(feature_in), ''), 'unknown'), 60);
  v_slug    text := left(lower(coalesce(nullif(trim(slug_in), ''), '(none)')), 120);
begin
  update public.public_ai_usage set calls = greatest(0, calls - 1)
   where day = v_day and feature = v_feature
     and ((scope = 'global' and scope_key = '*') or (scope = 'slug' and scope_key = v_slug));
end $$;

revoke all on function public.refund_public_ai_call(text, text) from public;
grant execute on function public.refund_public_ai_call(text, text) to service_role;

-- ---------------------------------------------------------------
-- Housekeeping -- keep 30 days, drop the rest nightly.
-- ---------------------------------------------------------------
create or replace function public.prune_public_ai_usage()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n integer;
begin
  delete from public.public_ai_usage
   where day < ((now() at time zone 'utc')::date - 30);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.prune_public_ai_usage() from public;
grant execute on function public.prune_public_ai_usage() to service_role;

do $$
declare jid bigint;
begin
  select jobid into jid from cron.job where jobname = 'prune_public_ai_usage_daily';
  if jid is not null then perform cron.unschedule(jid); end if;
end $$;

select cron.schedule(
  'prune_public_ai_usage_daily',
  '17 4 * * *',
  $cron$ select public.prune_public_ai_usage(); $cron$
);

notify pgrst, 'reload schema';
