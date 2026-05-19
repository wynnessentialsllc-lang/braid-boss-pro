-- Unsigned-contract reminder. The separate contract_signing email no
-- longer fires on approval (the link is embedded in the approval
-- email); instead, if a contract is still unsigned and the
-- appointment is within 48h, send exactly one reminder.
alter table public.booking_contracts
  add column if not exists reminder_sent_at timestamptz;

create or replace function public.enqueue_due_contract_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  n int := 0;
  app_base text;
  rec record;
  studio text;
  signing_url text;
  start_ts timestamp;
begin
  app_base := coalesce(nullif(current_setting('app.public_url', true), ''), 'https://braidbosspro.app');

  for rec in
    select
      bc.id          as id,
      bc.user_id     as user_id,
      bc.title       as title,
      bc.public_token as public_token,
      coalesce(nullif(trim(coalesce(bc.client_email, '')), ''),
               nullif(trim(coalesce(br.client_email, '')), ''),
               nullif(trim(coalesce(a.client_email, '')), '')) as recip_email,
      coalesce(nullif(trim(coalesce(bc.client_name, '')), ''),
               nullif(trim(coalesce(br.client_name, '')), ''),
               nullif(trim(coalesce(a.client_name, '')), '')) as recip_name,
      coalesce(bc.service_name, br.service_name) as service_name,
      coalesce(a.appt_date::text, br.preferred_date::text) as d,
      coalesce(a.appt_time, br.preferred_time) as t
    from public.booking_contracts bc
    left join public.booking_requests br on br.id = bc.booking_request_id
    left join public.appointments a on a.id = bc.appointment_id
    where bc.reminder_sent_at is null
      and bc.public_token is not null
      and coalesce(bc.status, '') in ('sent', 'pending', 'pending_signature', 'viewed')
  loop
    if rec.recip_email is null or position('@' in rec.recip_email) = 0 then
      continue;
    end if;
    if rec.d is null or rec.t is null then
      continue;
    end if;
    begin
      start_ts := (rec.d || ' ' || rec.t)::timestamp;
    exception when others then
      continue;
    end;

    if now() >= start_ts then
      update public.booking_contracts set reminder_sent_at = now() where id = rec.id;
      continue;
    end if;
    if start_ts - now() > interval '48 hours' then
      continue;
    end if;

    studio := coalesce(nullif(trim(public.public_get_studio_name(rec.user_id)), ''), 'your stylist');
    signing_url := app_base || '/sign/contract/' || rec.public_token;

    begin
      perform public.queue_notification(
        user_id_in           => rec.user_id,
        channel_in           => 'email',
        notification_type_in => 'contract_signing',
        body_in              => 'Reminder: your appointment agreement is still pending',
        subject_in           => 'Reminder: your appointment agreement is still pending',
        recipient_email_in   => rec.recip_email,
        recipient_name_in    => rec.recip_name,
        payload_in           => jsonb_build_object(
          'clientName',    coalesce(rec.recip_name, 'there'),
          'studioName',    studio,
          'contractTitle', rec.title,
          'serviceName',   rec.service_name,
          'contractUrl',   signing_url,
          'reminder',      true
        ),
        dedupe_key_in        => 'contract_reminder:' || rec.id::text,
        contract_id_in       => rec.id
      );
      update public.booking_contracts set reminder_sent_at = now() where id = rec.id;
      n := n + 1;
    exception when others then null;
    end;
  end loop;

  return n;
end;
$function$;

revoke all on function public.enqueue_due_contract_reminders() from public;
grant execute on function public.enqueue_due_contract_reminders() to service_role;

do $$
declare jid bigint;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    select jobid into jid from cron.job where jobname = 'enqueue_contract_reminders_every_30m';
    if jid is not null then perform cron.unschedule(jid); end if;
    perform cron.schedule(
      'enqueue_contract_reminders_every_30m',
      '*/30 * * * *',
      $cron$ select public.enqueue_due_contract_reminders(); $cron$
    );
  end if;
end $$;

notify pgrst, 'reload schema';
