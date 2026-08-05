-- Schedule the Academy self-healing reconcile sweep.
--
-- Backstops the class/video checkout webhooks: if a webhook ever fails
-- to flip a paid purchase out of 'pending' (bad signing secret, duplicate
-- endpoint, transient 5xx, a crash in the mark-paid RPC), the buyer is
-- charged but left with no access. This job calls the reconcile route
-- every 5 minutes; the route asks Stripe which pending Checkout Sessions
-- actually paid and marks them paid (idempotent) + emails access.
--
-- The reconcile route authenticates internal callers with the project
-- service-role key as a Bearer token, exactly like the send-push edge
-- function. We read that key from Supabase Vault so it is never committed.
--
-- SETUP (one-time, by the project owner) — store the service-role key:
--   select vault.create_secret(
--     '<your SUPABASE_SERVICE_ROLE_KEY>',
--     'academy_reconcile_key',
--     'Bearer token for public.trigger_academy_reconcile()'
--   );
-- If you already created 'send_push_service_key' with the same value you
-- can point the function below at that name instead. Until the secret
-- exists the job simply no-ops (it never errors), so this migration is
-- safe to apply before the secret is set.
--
-- Re-running is safe: cron.schedule() upserts by job name and the
-- function is CREATE OR REPLACE.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Fire-and-forget trigger: read the bearer from Vault, POST the route.
create or replace function public.trigger_academy_reconcile()
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
      where name = 'academy_reconcile_key'
      limit 1;
  exception when others then
    v_secret := null;
  end;
  if v_secret is null or trim(v_secret) = '' then
    return; -- secret not configured yet → no-op
  end if;

  perform net.http_post(
    url     := 'https://braidbosspro.app/api/academy/reconcile',
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

revoke all on function public.trigger_academy_reconcile() from public;
-- Only invoked by cron (definer); no role grants.

-- Unschedule any prior version before re-scheduling so the cron entry
-- stays the single source of truth.
do $$
declare
  jid bigint;
begin
  select jobid into jid from cron.job where jobname = 'academy_reconcile_pending_every_5_min';
  if jid is not null then
    perform cron.unschedule(jid);
  end if;
end $$;

select cron.schedule(
  'academy_reconcile_pending_every_5_min',
  '*/5 * * * *',
  $cron$ select public.trigger_academy_reconcile(); $cron$
);

-- Verification:
-- select jobid, schedule, jobname, active from cron.job
-- where jobname = 'academy_reconcile_pending_every_5_min';
--
-- Recent runs:
-- select start_time, status, return_message
-- from cron.job_run_details
-- where jobid = (select jobid from cron.job where jobname='academy_reconcile_pending_every_5_min')
-- order by start_time desc limit 10;
