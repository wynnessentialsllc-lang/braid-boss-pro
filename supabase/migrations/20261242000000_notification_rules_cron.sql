-- Schedule the off-device notification sweep.
--
-- Every internal reminder the stylist gets — appointment timing, balance due,
-- retention nudges, business insights — was generated inside the React app on
-- a setInterval that only ticks while the app is OPEN. Close the app and
-- nothing runs; open it and the backlog fires at once. Reported as: "I have
-- to open the app to see that I received one."
--
-- This job calls /api/notifications/run-rules every 5 minutes. That route
-- runs the identical rule pipeline (it imports the same app/lib modules the
-- client uses, so the two cannot drift) and pushes anything due.
--
-- The route authenticates internal callers with the project service-role key
-- as a Bearer token, exactly like /api/academy/reconcile and the send-push
-- edge function. We reuse the existing 'send_push_service_key' Vault secret
-- rather than adding another copy of the same key. Until that secret exists
-- the job simply no-ops (it never errors), so this migration is safe to apply
-- in any order.
--
-- Users whose profiles.timezone is NULL are skipped by the route — see
-- 20261241000000_profile_timezone.sql. The app stamps the timezone on load,
-- so each stylist opts in automatically the next time they open it.
--
-- Re-running is safe: cron.schedule() upserts by job name and the function is
-- CREATE OR REPLACE.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.trigger_notification_rules_sweep()
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_secret text;
begin
  begin
    select decrypted_secret into v_secret
      from vault.decrypted_secrets
      where name = 'send_push_service_key'
      limit 1;
  exception when others then
    v_secret := null;
  end;
  if v_secret is null or trim(v_secret) = '' then
    return; -- secret not configured → no-op
  end if;

  perform net.http_post(
    url     := 'https://braidbosspro.app/api/notifications/run-rules',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
exception when others then
  null; -- best-effort; a blip never breaks the schedule
end;
$function$;

revoke all on function public.trigger_notification_rules_sweep() from public;
-- Only invoked by cron (definer); no role grants.

do $$
declare
  jid bigint;
begin
  select jobid into jid from cron.job where jobname = 'notification_rules_sweep_every_5_min';
  if jid is not null then
    perform cron.unschedule(jid);
  end if;
end $$;

select cron.schedule(
  'notification_rules_sweep_every_5_min',
  '*/5 * * * *',
  $cron$ select public.trigger_notification_rules_sweep(); $cron$
);

-- Verification:
-- select jobid, schedule, jobname, active from cron.job
-- where jobname = 'notification_rules_sweep_every_5_min';
--
-- Recent runs:
-- select start_time, status, return_message
-- from cron.job_run_details
-- where jobid = (select jobid from cron.job where jobname='notification_rules_sweep_every_5_min')
-- order by start_time desc limit 10;
--
-- Route responses (pg_net keeps roughly the last 6 hours):
-- select id, status_code, created, left(content, 300)
-- from net._http_response order by created desc limit 20;
