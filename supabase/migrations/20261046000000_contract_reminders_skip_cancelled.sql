-- Contract-signing reminders must skip cancelled bookings.
--
-- Both the 48h reminder (enqueue_due_contract_reminders) and the 7-day
-- unsigned reminder (enqueue_unsigned_contract_reminders) selected
-- still-unsigned contracts purely by contract status + age — they never
-- checked whether the underlying appointment had been cancelled. Result:
-- a client whose appointment was cancelled weeks ago still got "your
-- agreement is still unsigned" nudges (and the stylist got the matching
-- "still unsigned" alert).
--
-- Cancellation source of truth (see cancel_appointment, 20261003):
--   * booking_requests.approval_status = 'cancelled'
--   * appointments.status = 'cancelled'
-- We exclude on BOTH so older cancellations (whose approval_status may
-- predate that fix) are still caught. Denied requests and no-shows are
-- excluded too — neither should be nudged to sign.

-- ---- 48h reminder ------------------------------------------------------
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
      and coalesce(br.approval_status, '') not in ('cancelled', 'canceled', 'denied')
      and lower(coalesce(a.status, '')) not in ('cancelled', 'canceled', 'no_show')
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

-- ---- 7-day unsigned reminder ------------------------------------------
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
    left join public.appointments a on a.id = coalesce(bc.appointment_id, br.appointment_id)
    where bc.unsigned_reminder_sent_at is null
      and bc.public_token is not null
      and coalesce(bc.status, '') in ('sent', 'pending', 'pending_signature', 'viewed')
      and bc.created_at <= now() - interval '7 days'
      and (bc.expires_at is null or bc.expires_at > now())
      and coalesce(br.approval_status, '') not in ('cancelled', 'canceled', 'denied')
      and lower(coalesce(a.status, '')) not in ('cancelled', 'canceled', 'no_show')
  loop
    if rec.recip_email is null or position('@' in rec.recip_email) = 0 then
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

      -- 2. Stylist alert — "we nudged them; still unsigned".
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

-- Belt-and-suspenders: stamp any still-unsigned reminders for contracts
-- whose booking is ALREADY cancelled, so a run between now and deploy
-- can't fire on them either.
update public.booking_contracts bc
   set reminder_sent_at = coalesce(bc.reminder_sent_at, now()),
       unsigned_reminder_sent_at = coalesce(bc.unsigned_reminder_sent_at, now())
  from public.booking_requests br
 where br.id = bc.booking_request_id
   and coalesce(br.approval_status, '') in ('cancelled', 'canceled', 'denied')
   and (bc.reminder_sent_at is null or bc.unsigned_reminder_sent_at is null);

notify pgrst, 'reload schema';
