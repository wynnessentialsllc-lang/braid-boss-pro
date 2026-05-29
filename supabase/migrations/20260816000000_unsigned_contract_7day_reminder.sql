-- 7-day unsigned-contract reminder + owner alert.
--
-- Existing pipeline already had ONE contract reminder
-- (enqueue_due_contract_reminders), but it's keyed to appointment
-- proximity: it nudges only when the appointment is within 48h. That
-- leaves a gap — a contract sent well ahead of the appointment can sit
-- unsigned for a week with no follow-up.
--
-- This migration adds a SECOND, independent reminder keyed to age:
-- when a contract has been unsigned for 7 days, send the client a
-- reminder AND alert the stylist that the reminder went out (so they
-- know to follow up personally if needed).
--
-- Independence from the 48h reminder is deliberate:
--   * Separate column (unsigned_reminder_sent_at) so the two reminders
--     can't clobber each other's "already sent" bookkeeping.
--   * Separate dedupe keys (contract_reminder_7d / contract_reminder_owner)
--     so neither send is suppressed by the other's queue row.
-- A client can therefore receive the 7-day nudge now and, later, the
-- 48h nudge as the appointment approaches — two distinct touchpoints.

alter table public.booking_contracts
  add column if not exists unsigned_reminder_sent_at timestamptz;

-- Exactly-once 7-day reminder. For each still-unsigned contract whose
-- row was created >= 7 days ago (and not expired), enqueue a client
-- reminder email + a stylist alert, then stamp unsigned_reminder_sent_at
-- so it never re-fires. Best-effort per row: one bad contract can't
-- abort the batch.
create or replace function public.enqueue_unsigned_contract_reminders()
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
  owner_email text;
  signing_url text;
  days_unsigned int;
begin
  app_base := coalesce(nullif(current_setting('app.public_url', true), ''), 'https://braidbosspro.app');

  for rec in
    select
      bc.id           as id,
      bc.user_id      as user_id,
      bc.title        as title,
      bc.public_token as public_token,
      bc.created_at   as created_at,
      coalesce(nullif(trim(coalesce(bc.client_email, '')), ''),
               nullif(trim(coalesce(br.client_email, '')), '')) as recip_email,
      coalesce(nullif(trim(coalesce(bc.client_name, '')), ''),
               nullif(trim(coalesce(br.client_name, '')), '')) as recip_name,
      coalesce(bc.service_name, br.service_name) as service_name
    from public.booking_contracts bc
    left join public.booking_requests br on br.id = bc.booking_request_id
    where bc.unsigned_reminder_sent_at is null
      and bc.public_token is not null
      and coalesce(bc.status, '') in ('sent', 'pending', 'pending_signature', 'viewed')
      and bc.created_at <= now() - interval '7 days'
      and (bc.expires_at is null or bc.expires_at > now())
  loop
    if rec.recip_email is null or position('@' in rec.recip_email) = 0 then
      -- Can't remind without a deliverable address. Stamp it so we
      -- don't re-scan this row every hour forever.
      update public.booking_contracts set unsigned_reminder_sent_at = now() where id = rec.id;
      continue;
    end if;

    studio := coalesce(nullif(trim(public.public_get_studio_name(rec.user_id)), ''), 'your stylist');
    signing_url := app_base || '/sign/contract/' || rec.public_token;
    days_unsigned := greatest(1, floor(extract(epoch from (now() - rec.created_at)) / 86400)::int);
    select au.email into owner_email from auth.users au where au.id = rec.user_id;

    begin
      -- 1. Client reminder.
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
        dedupe_key_in        => 'contract_reminder_7d:' || rec.id::text,
        contract_id_in       => rec.id
      );

      -- 2. Stylist alert — "we nudged them; still unsigned". Records
      --    copy framing, sent to the owner's account email.
      perform public.queue_notification(
        user_id_in           => rec.user_id,
        channel_in           => 'email',
        notification_type_in => 'contract_reminder_owner_alert',
        body_in              => coalesce(rec.recip_name, 'A client')
                                  || ' still has not signed ' || coalesce(rec.title, 'their agreement')
                                  || '. A reminder was just sent.',
        subject_in           => 'Reminder sent: ' || coalesce(rec.title, 'agreement')
                                  || ' still unsigned by ' || coalesce(rec.recip_name, 'client'),
        recipient_email_in   => owner_email,
        recipient_name_in    => studio,
        payload_in           => jsonb_build_object(
          'studioName',    studio,
          'clientName',    rec.recip_name,
          'clientEmail',   rec.recip_email,
          'contractTitle', rec.title,
          'serviceName',   rec.service_name,
          'daysUnsigned',  days_unsigned,
          'contractUrl',   signing_url
        ),
        dedupe_key_in        => 'contract_reminder_owner:' || rec.id::text,
        contract_id_in       => rec.id
      );

      update public.booking_contracts set unsigned_reminder_sent_at = now() where id = rec.id;
      n := n + 1;
    exception when others then null;
    end;
  end loop;

  return n;
end;
$function$;

revoke all on function public.enqueue_unsigned_contract_reminders() from public;
grant execute on function public.enqueue_unsigned_contract_reminders() to service_role;

-- Hourly is plenty for a day-granularity trigger; offset to minute 25
-- so it doesn't pile onto the :00/:30 cron bursts.
do $$
declare jid bigint;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    select jobid into jid from cron.job where jobname = 'enqueue_unsigned_contract_reminders_hourly';
    if jid is not null then perform cron.unschedule(jid); end if;
    perform cron.schedule(
      'enqueue_unsigned_contract_reminders_hourly',
      '25 * * * *',
      $cron$ select public.enqueue_unsigned_contract_reminders(); $cron$
    );
  end if;
end $$;

notify pgrst, 'reload schema';
