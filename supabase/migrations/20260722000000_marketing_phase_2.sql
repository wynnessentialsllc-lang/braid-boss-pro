-- Marketing automation V2 — birthday, win-back, new-client welcome.
--
-- Phase 2 of marketing automation. Rides on the suppression
-- infrastructure from Phase 1 (clients.marketing_emails_enabled +
-- marketing_unsubscribe_token + public_unsubscribe_marketing) so
-- every new email type honors opt-outs without re-doing the layer.
--
-- Three new triggers:
--   1. Birthday — fires on the client's birthday with a personal
--      "happy birthday" greeting. No discount in V1 (matches the
--      rebook-nudge philosophy: don't train clients to wait for
--      discounts).
--   2. Win-back — fires when a client hits 90+ days since their
--      last billable appointment AND has already passed their
--      rebook-nudge window (so they're truly drifting away, not
--      just due for a refresh).
--   3. New-client welcome — fires the day AFTER a client's first
--      completed appointment, thanking them + setting expectations.
--
-- All three share the same opaque-token unsubscribe footer and
-- dedupe on the queue's dedupe_key so a re-run doesn't multi-send.

-- ---------------------------------------------------------------
-- Birthday field on clients
-- ---------------------------------------------------------------
-- Stored as a real date so we can index it and run cron math
-- without TEXT parsing. The year doesn't matter for matching —
-- the cron compares to_char(birthday, 'MM-DD') against today's
-- MM-DD — so a 1900-05-20 birthday matches every May 20.
alter table public.clients
  add column if not exists birthday date;

-- Note: no functional index on to_char(birthday, 'MM-DD') —
-- to_char isn't marked IMMUTABLE so PG won't accept it in an
-- index expression. At small per-stylist scale (hundreds of
-- clients) the daily sequential scan is fast enough; revisit if
-- a user ever crosses 10k+ clients.

-- ---------------------------------------------------------------
-- Per-type master switches
-- ---------------------------------------------------------------
-- All default true so a stylist who flips the parent "rebook nudges"
-- on (from Phase 1's MarketingScreen) gets the rest "for free"
-- without surprises. They can disable each independently later.
alter table public.shop_settings
  add column if not exists marketing_birthday_enabled boolean not null default true,
  add column if not exists marketing_winback_enabled  boolean not null default true,
  add column if not exists marketing_welcome_enabled  boolean not null default true;

-- ---------------------------------------------------------------
-- Birthday processor
-- ---------------------------------------------------------------
-- Daily scan: clients whose birthday matches today AND the stylist's
-- master switch is on AND they're opted in AND have an email.
-- Dedupe keyed on (client, current year) so the same person gets one
-- email per birthday per year — never on the 21st AND the 20th if the
-- cron misses a day, etc.
create or replace function public.process_birthday_nudges()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_enqueued integer := 0;
  r record;
  v_subject text;
  v_body    text;
  v_payload jsonb;
  v_token   text;
  v_dedupe  text;
  v_today_year integer := extract(year from current_date);
  v_today_mmdd text := to_char(current_date, 'MM-DD');
begin
  for r in
    select
      c.user_id,
      c.id          as client_id,
      c.name        as client_name,
      c.email       as client_email,
      coalesce(p.business_name, p.full_name) as studio_name,
      coalesce(bl.slug, p.public_slug)       as booking_slug
    from public.clients c
    left join public.shop_settings ss on ss.user_id = c.user_id
    left join public.profiles      p  on p.id       = c.user_id
    left join public.booking_links bl on bl.user_id = c.user_id and bl.active = true
    where c.birthday is not null
      and to_char(c.birthday, 'MM-DD') = v_today_mmdd
      and c.marketing_emails_enabled = true
      and coalesce(ss.marketing_birthday_enabled, true) = true
      and c.email is not null and length(trim(c.email)) > 3
  loop
    v_dedupe := 'birthday:' || r.user_id || ':' || r.client_id || ':' || v_today_year;
    if exists (
      select 1 from public.notification_queue where dedupe_key = v_dedupe
    ) then
      continue;
    end if;

    v_token := public.ensure_client_marketing_token(r.user_id, r.client_id);
    v_subject := 'Happy birthday from ' || coalesce(r.studio_name, 'your stylist') || '!';
    v_body    := 'Happy birthday from ' || coalesce(r.studio_name, 'your stylist') || '!';
    v_payload := jsonb_build_object(
      'clientName',        r.client_name,
      'studioName',        coalesce(r.studio_name, 'your stylist'),
      'bookingSlug',       r.booking_slug,
      'unsubscribeToken',  v_token
    );

    perform public.queue_notification(
      r.user_id, 'email', 'birthday_greeting',
      v_body, v_subject, r.client_email, null, r.client_name,
      v_payload, null, v_dedupe, null, null, r.client_id, null
    );
    v_enqueued := v_enqueued + 1;
  end loop;
  return v_enqueued;
end $$;

revoke all on function public.process_birthday_nudges() from public;
grant execute on function public.process_birthday_nudges() to service_role;

-- ---------------------------------------------------------------
-- Win-back processor
-- ---------------------------------------------------------------
-- Clients whose most-recent billable appointment is 90..365 days
-- ago AND who haven't received a win-back in the last 60 days AND
-- have no future booking. Capped at 365 to avoid spamming clients
-- who clearly went elsewhere years ago; we treat them as churned.
create or replace function public.process_winback_nudges()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_enqueued integer := 0;
  r record;
  v_subject text;
  v_body    text;
  v_payload jsonb;
  v_token   text;
  v_dedupe  text;
begin
  for r in
    with last_appt as (
      select distinct on (a.user_id, a.client_id)
        a.user_id,
        a.client_id,
        a.appt_date,
        a.style
      from public.appointments a
      where a.client_id is not null
        and a.status not in ('cancelled', 'canceled')
        and (a.status = 'completed' or a.payment_status = 'paid')
        and a.appt_date is not null
      order by a.user_id, a.client_id, a.appt_date desc
    )
    select
      la.user_id,
      la.client_id,
      la.appt_date  as last_date,
      la.style      as last_style,
      c.name        as client_name,
      c.email       as client_email,
      coalesce(p.business_name, p.full_name) as studio_name,
      coalesce(bl.slug, p.public_slug)       as booking_slug
    from last_appt la
    join public.clients c on c.user_id = la.user_id and c.id = la.client_id
    left join public.shop_settings ss on ss.user_id = la.user_id
    left join public.profiles p on p.id = la.user_id
    left join public.booking_links bl on bl.user_id = la.user_id and bl.active = true
    where (current_date - la.appt_date) between 90 and 365
      and c.marketing_emails_enabled = true
      and coalesce(ss.marketing_winback_enabled, true) = true
      and c.email is not null and length(trim(c.email)) > 3
      -- No future appointment
      and not exists (
        select 1 from public.appointments fa
        where fa.user_id = la.user_id
          and fa.client_id = la.client_id
          and fa.appt_date > current_date
          and fa.status not in ('cancelled', 'canceled')
      )
      -- No win-back in the last 60 days
      and not exists (
        select 1 from public.notification_queue nq
        where nq.client_id = la.client_id
          and nq.user_id = la.user_id
          and nq.notification_type = 'winback'
          and nq.created_at > now() - interval '60 days'
      )
  loop
    v_dedupe := 'winback:' || r.user_id || ':' || r.client_id || ':' || to_char(current_date, 'YYYY-MM');
    if exists (
      select 1 from public.notification_queue where dedupe_key = v_dedupe
    ) then
      continue;
    end if;

    v_token := public.ensure_client_marketing_token(r.user_id, r.client_id);
    v_subject := 'We miss you at ' || coalesce(r.studio_name, 'the studio');
    v_body    := 'It''s been a while — your seat is still warm.';
    v_payload := jsonb_build_object(
      'clientName',        r.client_name,
      'studioName',        coalesce(r.studio_name, 'your stylist'),
      'lastStyle',         r.last_style,
      'daysSince',         (current_date - r.last_date)::int,
      'bookingSlug',       r.booking_slug,
      'unsubscribeToken',  v_token
    );

    perform public.queue_notification(
      r.user_id, 'email', 'winback',
      v_body, v_subject, r.client_email, null, r.client_name,
      v_payload, null, v_dedupe, null, null, r.client_id, null
    );
    v_enqueued := v_enqueued + 1;
  end loop;
  return v_enqueued;
end $$;

revoke all on function public.process_winback_nudges() from public;
grant execute on function public.process_winback_nudges() to service_role;

-- ---------------------------------------------------------------
-- New-client welcome processor
-- ---------------------------------------------------------------
-- Fires the day AFTER a client's first completed appointment so the
-- email doesn't compete with the receipt / review-request. Capped
-- at 14 days post-completion: if the cron misses for two weeks, the
-- moment's gone and we don't backfill stale welcomes.
create or replace function public.process_new_client_welcomes()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_enqueued integer := 0;
  r record;
  v_subject text;
  v_body    text;
  v_payload jsonb;
  v_token   text;
  v_dedupe  text;
begin
  for r in
    with appt_counts as (
      select
        a.user_id,
        a.client_id,
        count(*)               as completed_count,
        min(a.appt_date)       as first_date,
        (array_agg(a.style order by a.appt_date asc))[1] as first_style
      from public.appointments a
      where a.client_id is not null
        and a.status not in ('cancelled', 'canceled')
        and (a.status = 'completed' or a.payment_status = 'paid')
        and a.appt_date is not null
        and a.appt_date <= current_date
      group by a.user_id, a.client_id
    )
    select
      ac.user_id,
      ac.client_id,
      ac.first_date,
      ac.first_style,
      c.name        as client_name,
      c.email       as client_email,
      coalesce(p.business_name, p.full_name) as studio_name,
      coalesce(bl.slug, p.public_slug)       as booking_slug
    from appt_counts ac
    join public.clients c on c.user_id = ac.user_id and c.id = ac.client_id
    left join public.shop_settings ss on ss.user_id = ac.user_id
    left join public.profiles p on p.id = ac.user_id
    left join public.booking_links bl on bl.user_id = ac.user_id and bl.active = true
    where ac.completed_count = 1
      and ac.first_date >= current_date - interval '14 days'
      and ac.first_date <= current_date - interval '1 day'
      and c.marketing_emails_enabled = true
      and coalesce(ss.marketing_welcome_enabled, true) = true
      and c.email is not null and length(trim(c.email)) > 3
  loop
    v_dedupe := 'welcome:' || r.user_id || ':' || r.client_id;
    if exists (
      select 1 from public.notification_queue where dedupe_key = v_dedupe
    ) then
      continue;
    end if;

    v_token := public.ensure_client_marketing_token(r.user_id, r.client_id);
    v_subject := 'Welcome to ' || coalesce(r.studio_name, 'the studio') || ' 💜';
    v_body    := 'Thanks for your first visit — here''s what to expect next.';
    v_payload := jsonb_build_object(
      'clientName',        r.client_name,
      'studioName',        coalesce(r.studio_name, 'your stylist'),
      'firstStyle',        r.first_style,
      'bookingSlug',       r.booking_slug,
      'unsubscribeToken',  v_token
    );

    perform public.queue_notification(
      r.user_id, 'email', 'new_client_welcome',
      v_body, v_subject, r.client_email, null, r.client_name,
      v_payload, null, v_dedupe, null, null, r.client_id, null
    );
    v_enqueued := v_enqueued + 1;
  end loop;
  return v_enqueued;
end $$;

revoke all on function public.process_new_client_welcomes() from public;
grant execute on function public.process_new_client_welcomes() to service_role;

-- ---------------------------------------------------------------
-- Daily crons — all at 17:00 UTC alongside the rebook nudges so
-- the stylist's mailbox only gets one batch per day. Independent
-- cron jobs so one failing scanner doesn't take down the others.
-- ---------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'birthday_nudges_daily') then
    perform cron.unschedule('birthday_nudges_daily');
  end if;
  if exists (select 1 from cron.job where jobname = 'winback_nudges_daily') then
    perform cron.unschedule('winback_nudges_daily');
  end if;
  if exists (select 1 from cron.job where jobname = 'new_client_welcomes_daily') then
    perform cron.unschedule('new_client_welcomes_daily');
  end if;
end $$;

select cron.schedule(
  'birthday_nudges_daily', '0 17 * * *',
  $$select public.process_birthday_nudges();$$
);
select cron.schedule(
  'winback_nudges_daily', '0 17 * * *',
  $$select public.process_winback_nudges();$$
);
select cron.schedule(
  'new_client_welcomes_daily', '0 17 * * *',
  $$select public.process_new_client_welcomes();$$
);
