-- Schedule the auto-recharge sweep.
--
-- Unlike the other crons here, this one calls the Next.js app rather
-- than an edge function: the charge needs STRIPE_SECRET_KEY, which
-- lives in the Vercel environment and is deliberately not published to
-- Supabase functions.
--
-- Every 15 minutes. Frequent enough that a stylist who runs dry mid-day
-- is topped up before their next reminder batch, infrequent enough that
-- it is not hammering Stripe. The real protection against
-- over-charging is not the schedule but claim_sms_autorecharge's
-- cooldown, daily cap and idempotency key -- the sweep is safe to run
-- as often as you like.
--
-- Requires the shared secret to match AUTORECHARGE_CRON_SECRET in the
-- app environment. Stored in Vault so it is not sitting in a migration
-- file; the job reads it at fire time.
--
--   select vault.create_secret('<value>', 'autorecharge_cron_secret');
--
-- Until that secret exists the job posts an empty header and the route
-- answers 401 -- inert, not dangerous.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  jid bigint;
begin
  select jobid into jid from cron.job where jobname = 'sms_autorecharge_every_15_min';
  if jid is not null then
    perform cron.unschedule(jid);
  end if;
end $$;

select cron.schedule(
  'sms_autorecharge_every_15_min',
  '*/15 * * * *',
  $cron$
  select net.http_post(
    url := 'https://braidbosspro.app/api/sms-credits/autorecharge-run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce(
        (select decrypted_secret from vault.decrypted_secrets
          where name = 'autorecharge_cron_secret' limit 1),
        ''
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $cron$
);

-- Verification:
--   select jobname, schedule, active from cron.job
--    where jobname = 'sms_autorecharge_every_15_min';
--   select status, return_message from cron.job_run_details
--    where jobid = (select jobid from cron.job
--                    where jobname = 'sms_autorecharge_every_15_min')
--    order by start_time desc limit 5;
