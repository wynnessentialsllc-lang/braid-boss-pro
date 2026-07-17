-- Braid Care Guide — automated post-service aftercare email.
--
-- One editable email a braider can send a few days after a finished
-- appointment (how to care for braids, how long to wear them, myth-busting,
-- when to reach out). OFF by default — the braider opts in per studio, sets
-- the delay, and can edit/add/remove any part. Content lives as jsonb so the
-- editor owns the shape (app/lib/care-guide.ts).
--
-- Mirrors the marketing rebook-nudge pattern (20260721): a daily cron scans
-- for eligible completed appointments and enqueues the email, deduped per
-- appointment, respecting the client's marketing opt-out. The email itself
-- is rendered worker-side (renderBraidCareGuide in process-notification-queue)
-- from the content passed on the payload.

-- =====================================================================
-- 1. Per-stylist settings + editable content
-- =====================================================================
create table if not exists public.braid_care_guides (
  user_id     uuid primary key,
  enabled     boolean not null default false,
  -- Set when first switched on. Guides only go to appointments completed
  -- on/after this instant, so enabling never back-blasts old clients.
  enabled_at  timestamptz,
  delay_days  integer not null default 3 check (delay_days between 1 and 30),
  content     jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.braid_care_guides enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
    where schemaname = 'public' and tablename = 'braid_care_guides'
      and policyname = 'braid_care_guides_owner_rw') then
    create policy braid_care_guides_owner_rw on public.braid_care_guides
      for all to authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

grant select, insert, update on public.braid_care_guides to authenticated, service_role;

-- =====================================================================
-- 2. Cron processor — daily, enqueues due care guides
-- =====================================================================
-- For each studio with the guide ENABLED, find completed appointments whose
-- age has reached delay_days (with a short catch-up window in case a daily
-- run was missed), tied to a client who is opted in and has an email, that
-- we haven't already sent for. Enqueue the email with the studio's stored
-- content + personalization on the payload. Deduped on the appointment.
create or replace function public.process_braid_care_guides()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_enqueued integer := 0;
  r record;
  app_base text;
  v_token text;
  v_dedupe text;
  v_payload jsonb;
  v_when text;
begin
  app_base := coalesce(nullif(current_setting('app.public_url', true), ''), 'https://braidbosspro.app');

  for r in
    select
      a.user_id,
      a.client_id,
      a.id            as appointment_id,
      a.appt_date     as appointment_date,
      a.style         as appointment_style,
      c.name          as client_name,
      c.email         as client_email,
      g.delay_days,
      g.content       as guide_content,
      coalesce(p.business_name, p.full_name) as studio_name,
      coalesce(bl.slug, p.public_slug)       as booking_slug
    from public.braid_care_guides g
    join public.appointments a
      on a.user_id = g.user_id
     and a.client_id is not null
     and a.status not in ('cancelled', 'canceled')
     and (a.status = 'completed' or a.payment_status = 'paid')
     and a.appt_date is not null
     -- Age has reached the delay, with a 3-day catch-up so a missed cron
     -- run doesn't skip anyone (dedupe still guarantees one send).
     and a.appt_date <= current_date - g.delay_days
     and a.appt_date >= current_date - g.delay_days - 3
     -- Never send for appointments completed before the guide was enabled.
     and a.appt_date >= coalesce(g.enabled_at::date, current_date)
    join public.clients c
      on c.user_id = a.user_id and c.id = a.client_id
    left join public.profiles p on p.id = a.user_id
    left join public.booking_links bl on bl.user_id = a.user_id and bl.active = true
    where g.enabled = true
      and c.marketing_emails_enabled = true
      and c.email is not null and length(trim(c.email)) > 3
  loop
    v_dedupe := 'braid_care_guide:' || r.user_id || ':' || r.client_id || ':' || r.appointment_id;

    if exists (select 1 from public.notification_queue where dedupe_key = v_dedupe) then
      continue;
    end if;

    v_token := public.ensure_client_marketing_token(r.user_id, r.client_id);

    v_payload := jsonb_build_object(
      'content', r.guide_content,
      'clientName', r.client_name,
      'studioName', coalesce(r.studio_name, 'your stylist'),
      'serviceName', r.appointment_style,
      'bookingSlug', r.booking_slug,
      'unsubscribeToken', v_token,
      'appBase', app_base
    );

    begin
      perform public.queue_notification(
        r.user_id,
        'email',
        'braid_care_guide',
        'Caring for your new braids',
        'Caring for your new braids',
        r.client_email,
        null,
        r.client_name,
        v_payload,
        null,
        v_dedupe,
        null,
        r.appointment_id,
        r.client_id,
        null
      );
      v_enqueued := v_enqueued + 1;
    exception when others then null;
    end;
  end loop;

  return v_enqueued;
end $$;

revoke all on function public.process_braid_care_guides() from public;
grant execute on function public.process_braid_care_guides() to service_role;

-- =====================================================================
-- 3. Daily cron — 10am Pacific, same window as the rebook nudge.
-- =====================================================================
do $$
begin
  if exists (select 1 from cron.job where jobname = 'braid_care_guides_daily') then
    perform cron.unschedule('braid_care_guides_daily');
  end if;
end $$;

select cron.schedule(
  'braid_care_guides_daily',
  '0 17 * * *',
  $$select public.process_braid_care_guides();$$
);
