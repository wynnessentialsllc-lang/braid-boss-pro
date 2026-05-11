-- Phase B12.1d — schedule the notification dispatch worker.
--
-- Calls process-notification-queue every minute via pg_net.
-- The anon JWT is fine here: the function only acts on rows already
-- in the queue, and verify_jwt just needs *any* valid Supabase JWT
-- (not service role).
--
-- Re-running is safe: cron.schedule() upserts by job name.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Unschedule any prior version of this job before re-scheduling so
-- the cron entry stays single-source-of-truth.
do $$
declare
  jid bigint;
begin
  select jobid into jid from cron.job where jobname = 'process_notification_queue_every_minute';
  if jid is not null then
    perform cron.unschedule(jid);
  end if;
end $$;

select cron.schedule(
  'process_notification_queue_every_minute',
  '* * * * *',
  $cron$
  select net.http_post(
    url := 'https://bjqazhplxqqhftekspfl.supabase.co/functions/v1/process-notification-queue',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJqcWF6aHBseHFxaGZ0ZWtzcGZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyMDk0NzYsImV4cCI6MjA5Mzc4NTQ3Nn0.mM7BvlajwZnk9oK-9wHmXmn7c8IHu_erUKQkupov_KI',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $cron$
);

-- Verification:
-- select jobid, schedule, jobname, active from cron.job
-- where jobname = 'process_notification_queue_every_minute';
--
-- Inspect recent runs:
-- select start_time, status, return_message
-- from cron.job_run_details
-- where jobid = (select jobid from cron.job where jobname='process_notification_queue_every_minute')
-- order by start_time desc limit 10;
