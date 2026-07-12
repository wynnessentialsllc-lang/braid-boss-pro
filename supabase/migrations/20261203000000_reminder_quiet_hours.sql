-- Don't text clients in the middle of the night.
--
-- Bug: the ~24-hour appointment reminder fired the first time the cron ran
-- while the appointment was 18–30h away. For a 9 AM appointment that window
-- STARTS at 3 AM the day before, so clients got a reminder text at 3:00 AM.
--
-- Fix: gate the reminder to civil hours in the client's timezone (9 AM–8 PM).
-- The 18–30h window is 12 hours wide, so there is always a daytime cron tick
-- inside it — skipping a night-time tick just defers the send to the morning
-- (last_reminder_sent_at is only stamped once the reminder actually goes out,
-- so the deferral is safe and idempotent).
--
-- The function is reproduced verbatim from 20261024000000 with only the
-- quiet-hours guard added after each window check. The 2-hour "starting soon"
-- reminder is unchanged (it fires close to the appointment by design).

create or replace function public.enqueue_due_appointment_reminders()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  enqueued int := 0;
  app_base text;
  br public.booking_requests%rowtype;
  ap public.appointments%rowtype;
  studio_name text;
  service_label text;
  appt_status text;
  start_ts timestamptz;
  v_tz text;
  v_local_hour int;
  sms_body text;
  v_hair text;
  v_hair_sms text;
begin
  app_base := coalesce(nullif(current_setting('app.public_url', true), ''), 'https://braidbosspro.app');

  -- ---- Scan A: booking requests ---------------------------------
  for br in
    select * from public.booking_requests
    where approval_status in ('approved', 'confirmed')
      and cancelled_at is null
      and client_email is not null
      and preferred_date is not null
      and preferred_time is not null
      and cancel_token is not null
      and (last_reminder_sent_at is null
           or last_reminder_sent_at < (now() - interval '12 hours'))
  loop
    v_tz := coalesce(
      nullif(br.timezone, ''),
      (select br2.timezone
         from public.booking_requests br2
        where br2.user_id = br.user_id
          and br2.timezone is not null
          and br2.timezone <> ''
        order by br2.created_at desc
        limit 1),
      'America/Los_Angeles'
    );
    begin
      start_ts := (br.preferred_date::text || ' ' || br.preferred_time::text)::timestamp
                  at time zone v_tz;
    exception when others then
      continue;
    end;
    if start_ts <= now() + interval '18 hours'
       or start_ts >= now() + interval '30 hours' then
      continue;
    end if;
    -- Quiet hours: hold the reminder until 9 AM–8 PM local. A later daytime
    -- tick (still inside the 12h window) will send it.
    v_local_hour := extract(hour from (now() at time zone v_tz));
    if v_local_hour < 9 or v_local_hour >= 20 then
      continue;
    end if;
    if br.appointment_id is not null then
      select status into appt_status from public.appointments where id = br.appointment_id;
      -- Missing row (hard-deleted from the schedule) or terminal status:
      -- the appointment is gone/cancelled, so don't remind. NOT FOUND must
      -- be checked explicitly because appt_status is left NULL/stale.
      if not found
         or coalesce(appt_status, '') in
              ('cancelled', 'canceled', 'no-show', 'no_show', 'noshow', 'declined', 'completed')
      then
        continue;
      end if;
    end if;
    studio_name := coalesce(nullif(trim(public.public_get_studio_name(br.user_id)), ''), 'your stylist');
    service_label := coalesce(br.selected_variation_name, br.service_name);
    v_hair := public.hair_bring_text(br.service_id, false);
    v_hair_sms := public.hair_bring_text(br.service_id, true);
    begin
      perform public.queue_notification(
        user_id_in => br.user_id,
        channel_in => 'email',
        notification_type_in => 'appointment_reminder',
        body_in => 'Reminder: your appointment is coming up soon.',
        subject_in => 'Reminder: your appointment with ' || studio_name,
        recipient_email_in => br.client_email,
        recipient_name_in => br.client_name,
        payload_in => jsonb_build_object(
          'clientName', coalesce(br.client_name, 'there'),
          'studioName', studio_name,
          'serviceName', service_label,
          'hairBring', v_hair,
          'preferredDate', br.preferred_date,
          'preferredTime', br.preferred_time,
          'cancelUrl', app_base || '/booking-action/' || br.cancel_token || '/cancel',
          'rescheduleUrl',
            case when br.reschedule_count = 0 and br.reschedule_token is not null
              then app_base || '/booking-action/' || br.reschedule_token || '/reschedule'
              else null end,
          'rescheduleUsed', br.reschedule_count >= 1
        ),
        dedupe_key_in => 'appointment_reminder:' || br.id::text || ':' || br.preferred_date::text,
        booking_request_id_in => br.id,
        appointment_id_in => br.appointment_id
      );

      if coalesce(br.sms_opt_in, false)
         and br.client_phone is not null
         and length(public.sms_normalize_phone(br.client_phone)) >= 7
         and not exists (
           select 1 from public.sms_opt_outs o
           where o.phone = public.sms_normalize_phone(br.client_phone))
         and coalesce((select balance from public.sms_credits where user_id = br.user_id), 0) > 0
      then
        sms_body := 'Reminder: your ' || coalesce(service_label, 'appointment')
                    || ' with ' || studio_name || ' is '
                    || to_char(br.preferred_date::date, 'FMMon FMDD')
                    || ' at ' || br.preferred_time || '.';
        if v_hair_sms is not null then
          sms_body := sms_body || ' Bring: ' || v_hair_sms || '.';
        end if;
        begin
          perform public.queue_notification(
            user_id_in => br.user_id,
            channel_in => 'sms',
            notification_type_in => 'appointment_reminder',
            body_in => sms_body,
            recipient_phone_in => br.client_phone,
            recipient_name_in => br.client_name,
            payload_in => jsonb_build_object('smsText', sms_body),
            dedupe_key_in => 'appointment_reminder_sms:' || br.id::text || ':' || br.preferred_date::text,
            booking_request_id_in => br.id,
            appointment_id_in => br.appointment_id
          );
        exception when others then null;
        end;
      end if;

      update public.booking_requests set last_reminder_sent_at = now() where id = br.id;
      enqueued := enqueued + 1;
    exception when others then null;
    end;
  end loop;

  -- ---- Scan B: stylist-created appointments (no service link) ----
  for ap in
    select * from public.appointments a
    where coalesce(a.kind, 'appointment') = 'appointment'
      and coalesce(a.is_all_day, false) = false
      and coalesce(a.status, '') not in
            ('cancelled', 'canceled', 'no-show', 'no_show', 'noshow', 'declined', 'completed')
      and a.appt_date is not null
      and a.appt_time is not null
      and (a.last_reminder_sent_at is null
           or a.last_reminder_sent_at < (now() - interval '12 hours'))
      and not exists (
        select 1 from public.booking_requests br2 where br2.appointment_id = a.id)
  loop
    v_tz := coalesce(
      nullif(ap.timezone, ''),
      (select br2.timezone
         from public.booking_requests br2
        where br2.user_id = ap.user_id
          and br2.timezone is not null
          and br2.timezone <> ''
        order by br2.created_at desc
        limit 1),
      'America/Los_Angeles'
    );
    begin
      start_ts := (ap.appt_date::text || ' ' || ap.appt_time::text)::timestamp
                  at time zone v_tz;
    exception when others then
      continue;
    end;
    if start_ts <= now() + interval '18 hours'
       or start_ts >= now() + interval '30 hours' then
      continue;
    end if;
    -- Quiet hours (see Scan A).
    v_local_hour := extract(hour from (now() at time zone v_tz));
    if v_local_hour < 9 or v_local_hour >= 20 then
      continue;
    end if;

    studio_name := coalesce(nullif(trim(public.public_get_studio_name(ap.user_id)), ''), 'your stylist');
    service_label := coalesce(ap.style, 'appointment');
    begin
      if ap.client_email is not null and position('@' in ap.client_email) > 0 then
        perform public.queue_notification(
          user_id_in => ap.user_id,
          channel_in => 'email',
          notification_type_in => 'appointment_reminder',
          body_in => 'Reminder: your appointment is coming up soon.',
          subject_in => 'Reminder: your appointment with ' || studio_name,
          recipient_email_in => ap.client_email,
          recipient_name_in => ap.client_name,
          payload_in => jsonb_build_object(
            'clientName', coalesce(ap.client_name, 'there'),
            'studioName', studio_name,
            'serviceName', service_label,
            'preferredDate', ap.appt_date,
            'preferredTime', ap.appt_time
          ),
          dedupe_key_in => 'appointment_reminder:appt:' || ap.id::text || ':' || ap.appt_date::text,
          appointment_id_in => ap.id::text
        );
      end if;

      if coalesce(ap.sms_opt_in, false)
         and ap.client_phone is not null
         and length(public.sms_normalize_phone(ap.client_phone)) >= 7
         and not exists (
           select 1 from public.sms_opt_outs o
           where o.phone = public.sms_normalize_phone(ap.client_phone))
         and coalesce((select balance from public.sms_credits where user_id = ap.user_id), 0) > 0
      then
        sms_body := 'Reminder: your ' || service_label
                    || ' with ' || studio_name || ' is '
                    || to_char(ap.appt_date::date, 'FMMon FMDD')
                    || ' at ' || ap.appt_time || '.';
        begin
          perform public.queue_notification(
            user_id_in => ap.user_id,
            channel_in => 'sms',
            notification_type_in => 'appointment_reminder',
            body_in => sms_body,
            recipient_phone_in => ap.client_phone,
            recipient_name_in => ap.client_name,
            payload_in => jsonb_build_object('smsText', sms_body),
            dedupe_key_in => 'appointment_reminder_sms:appt:' || ap.id::text || ':' || ap.appt_date::text,
            appointment_id_in => ap.id::text
          );
        exception when others then null;
        end;
      end if;

      update public.appointments set last_reminder_sent_at = now() where id = ap.id;
      enqueued := enqueued + 1;
    exception when others then null;
    end;
  end loop;

  return enqueued;
end;
$function$;

notify pgrst, 'reload schema';
