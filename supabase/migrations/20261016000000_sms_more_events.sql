-- Extend SMS coverage to the remaining client-facing events:
--   * Reschedule approvals  — via a date-aware confirmation dedupe key
--   * Review requests        — add an SMS alongside the email
--   * 2-hour reminders       — a new SMS-only "starting soon" nudge
--
-- Appointment approvals and 24-hour reminders already send SMS
-- (enqueue_appointment_confirmation / enqueue_due_appointment_reminders)
-- and are untouched here except for the dedupe-key fix below. Every SMS
-- still funnels through queue_notification(), so the per-owner master
-- switch added in 20261015 governs all of these centrally.

-- =====================================================================
-- 1. Reschedule approvals.
--
-- A client reschedule keeps the same appointment_id and bounces the
-- booking back to pending; the stylist's re-approval calls
-- enqueue_appointment_confirmation again with the NEW date. But the
-- confirmation dedupe key was 'appointment_confirmed[_sms]:<appt_id>'
-- (no date), so the re-approval matched the original send and was
-- dropped — the client got no fresh confirmation, by email or SMS.
--
-- Fix: include the date in the dedupe key (the original design intent,
-- per the 20260702 reschedule migration). A reschedule to a new date
-- now sends a fresh appointment_confirmed email + SMS; same-date double
-- approvals stay idempotent. Re-created verbatim from 20260916 with only
-- the two dedupe keys changed.
-- =====================================================================
create or replace function public.enqueue_appointment_confirmation(
  appt_id_in        text,
  user_id_in        uuid,
  client_name_in    text,
  client_email_in   text,
  client_phone_in   text,
  service_name_in   text,
  appt_date_in      text,
  appt_time_in      text,
  total_price_in    numeric,
  sms_opt_in_in     boolean,
  custom_message_in text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_caller uuid := auth.uid();
  v_studio text;
  v_base   text;
  v_sms    text;
  v_when   text;
  v_msg    text;
  v_datekey text;
begin
  if v_caller is not null and v_caller <> user_id_in then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_base   := coalesce(nullif(current_setting('app.public_url', true), ''), 'https://braidbosspro.app');
  v_studio := coalesce(nullif(trim(public.public_get_studio_name(user_id_in)), ''), 'your studio');
  v_msg    := nullif(trim(coalesce(custom_message_in, '')), '');
  v_datekey := coalesce(nullif(trim(coalesce(appt_date_in, '')), ''), 'na');

  -- Email confirmation — now carries the optional custom message.
  if client_email_in is not null and position('@' in client_email_in) > 0 then
    perform public.queue_notification(
      user_id_in           => user_id_in,
      channel_in           => 'email',
      notification_type_in => 'appointment_confirmed',
      body_in              => 'Your appointment is confirmed.',
      subject_in           => 'Your appointment is confirmed — ' || v_studio,
      recipient_email_in   => client_email_in,
      recipient_name_in    => client_name_in,
      payload_in           => jsonb_build_object(
        'clientName',       coalesce(client_name_in, 'there'),
        'studioName',       v_studio,
        'serviceName',      service_name_in,
        'preferredDate',    appt_date_in,
        'preferredTime',    appt_time_in,
        'remainingBalance', case when total_price_in is not null and total_price_in > 0
                                 then total_price_in else null end,
        'customMessage',    v_msg,
        'appBase',          v_base
      ),
      dedupe_key_in        => 'appointment_confirmed:' || appt_id_in || ':' || v_datekey,
      appointment_id_in    => appt_id_in
    );
  end if;

  -- SMS confirmation — unchanged (no custom message on text).
  if coalesce(sms_opt_in_in, false)
     and client_phone_in is not null
     and length(public.sms_normalize_phone(client_phone_in)) >= 7
     and not exists (select 1 from public.sms_opt_outs o
                     where o.phone = public.sms_normalize_phone(client_phone_in))
     and coalesce((select balance from public.sms_credits where user_id = user_id_in), 0) > 0
  then
    begin
      v_when := case when appt_date_in is not null and appt_date_in <> ''
                     then ' on ' || to_char(appt_date_in::date, 'FMMon FMDD')
                     else '' end
             || case when appt_time_in is not null and appt_time_in <> ''
                     then ' at ' || appt_time_in else '' end;
    exception when others then
      v_when := '';
    end;
    v_sms := 'You''re booked with ' || v_studio || v_when || '.';
    begin
      perform public.queue_notification(
        user_id_in           => user_id_in,
        channel_in           => 'sms',
        notification_type_in => 'appointment_confirmed',
        body_in              => v_sms,
        recipient_phone_in   => client_phone_in,
        recipient_name_in    => client_name_in,
        payload_in           => jsonb_build_object('smsText', v_sms),
        dedupe_key_in        => 'appointment_confirmed_sms:' || appt_id_in || ':' || v_datekey,
        appointment_id_in    => appt_id_in
      );
    exception when others then null;
    end;
  end if;

  return jsonb_build_object('ok', true);
end;
$function$;

revoke all on function public.enqueue_appointment_confirmation(
  text, uuid, text, text, text, text, text, text, numeric, boolean, text
) from public;
grant execute on function public.enqueue_appointment_confirmation(
  text, uuid, text, text, text, text, text, text, numeric, boolean, text
) to authenticated, service_role;

-- =====================================================================
-- 2. Review requests — add SMS alongside the email.
--
-- Re-created from 20260919 with two changes: the scan now also picks up
-- phone-only clients (the email enqueue is wrapped in an email guard),
-- and a parallel review SMS is enqueued behind the standard opt-in /
-- opt-out / credit gates. One-shot per row via review_request_sent_at;
-- channels separated by dedupe key.
-- =====================================================================
create or replace function public.enqueue_due_review_requests()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  enqueued int := 0;
  app_base text;
  a        public.appointments%rowtype;
  studio_name text;
  v_tz     text;
  end_ts   timestamptz;
  v_review_url text;
  v_sms    text;
begin
  app_base := coalesce(
    nullif(current_setting('app.public_url', true), ''),
    'https://braidbosspro.app'
  );

  for a in
    select * from public.appointments
    where coalesce(status, '') not in
            ('cancelled', 'canceled', 'no-show', 'no_show', 'noshow',
             'declined', 'rescheduled')
      and cancelled_at is null
      and (
        (client_email is not null and client_email <> '')
        or (client_phone is not null and client_phone <> '')
      )
      and appt_date is not null and appt_time is not null
      and review_request_sent_at is null
      and review_request_token is not null
      and coalesce(kind, 'appointment') = 'appointment'
      and coalesce(is_all_day, false) = false
      and not exists (
        select 1 from public.booking_requests br
        where br.appointment_id = appointments.id
          and br.user_id = appointments.user_id
          and (
            br.cancelled_at is not null
            or coalesce(br.approval_status, '') in ('cancelled', 'denied', 'declined')
            or (coalesce(br.reschedule_count, 0) >= 1
                and coalesce(br.approval_status, '') = 'deposit_paid_pending_approval')
          )
      )
  loop
    v_tz := coalesce(
      nullif(a.timezone, ''),
      (select br.timezone
         from public.booking_requests br
        where br.user_id = a.user_id
          and br.timezone is not null
          and br.timezone <> ''
        order by br.created_at desc
        limit 1),
      'America/Los_Angeles'
    );

    begin
      end_ts := ((a.appt_date::text || ' ' || a.appt_time)::timestamp
                 at time zone v_tz)
                + (coalesce(a.duration_hours, 0)::text || ' hours')::interval;
    exception when others then
      continue;
    end;

    -- Send only once the service has realistically wrapped:
    -- local end time + 2 hours.
    if now() < end_ts + interval '2 hours' then
      continue;
    end if;

    -- Stale: more than 14 days past end. Mark sent so we stop
    -- considering the row; never message a client about an old visit.
    if end_ts < now() - interval '14 days' then
      update public.appointments
        set review_request_sent_at = now()
        where id = a.id and user_id = a.user_id;
      continue;
    end if;

    studio_name := coalesce(
      nullif(trim(public.public_get_studio_name(a.user_id)), ''),
      'your stylist'
    );
    v_review_url := app_base || '/review/' || a.review_request_token;

    begin
      if a.client_email is not null and a.client_email <> '' then
        perform public.queue_notification(
          user_id_in           => a.user_id,
          channel_in           => 'email',
          notification_type_in => 'review_request',
          body_in              => 'How was your appointment? Leave a quick review.',
          subject_in           => 'How was your appointment?',
          recipient_email_in   => a.client_email,
          recipient_name_in    => a.client_name,
          payload_in           => jsonb_build_object(
            'clientName',  coalesce(a.client_name, 'there'),
            'studioName',  studio_name,
            'serviceName', a.style,
            'reviewUrl',   v_review_url
          ),
          dedupe_key_in        => 'review_request:' || a.id,
          appointment_id_in    => a.id
        );
      end if;

      -- Parallel review SMS, behind the standard opt-in / opt-out /
      -- credit gates. Owner master switch is enforced in queue_notification.
      if coalesce(a.sms_opt_in, false)
         and a.client_phone is not null
         and length(public.sms_normalize_phone(a.client_phone)) >= 7
         and not exists (select 1 from public.sms_opt_outs o
                         where o.phone = public.sms_normalize_phone(a.client_phone))
         and coalesce((select balance from public.sms_credits where user_id = a.user_id), 0) > 0
      then
        v_sms := 'How was your visit with ' || studio_name
                 || '? Leave a quick review: ' || v_review_url;
        perform public.queue_notification(
          user_id_in           => a.user_id,
          channel_in           => 'sms',
          notification_type_in => 'review_request',
          body_in              => v_sms,
          recipient_phone_in   => a.client_phone,
          recipient_name_in    => a.client_name,
          payload_in           => jsonb_build_object('smsText', v_sms),
          dedupe_key_in        => 'review_request_sms:' || a.id,
          appointment_id_in    => a.id
        );
      end if;

      update public.appointments
        set review_request_sent_at = now()
        where id = a.id and user_id = a.user_id;
      enqueued := enqueued + 1;
    exception when others then null;
    end;
  end loop;

  return enqueued;
end;
$function$;

revoke all on function public.enqueue_due_review_requests() from public;
grant execute on function public.enqueue_due_review_requests() to service_role;

-- =====================================================================
-- 3. 2-hour "starting soon" reminder — SMS only.
--
-- Separate from the 24h reminder so its large body stays untouched.
-- Fires when the local start time is 1.5–2.5h out (≥30-min-wide window
-- guarantees the */15 cron catches it; the per-row dedupe key makes it
-- one-shot, so we never touch last_reminder_sent_at which the 24h job
-- owns). Mirrors both scans: approved booking_requests and
-- stylist-created appointments.
-- =====================================================================
create or replace function public.enqueue_due_2h_sms_reminders()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  enqueued int := 0;
  br public.booking_requests%rowtype;
  ap public.appointments%rowtype;
  studio_name text;
  service_label text;
  appt_status text;
  start_ts timestamptz;
  v_tz text;
  sms_body text;
begin
  -- ---- Scan A: approved booking requests ------------------------
  for br in
    select * from public.booking_requests
    where approval_status in ('approved', 'confirmed')
      and cancelled_at is null
      and preferred_date is not null
      and preferred_time is not null
      and preferred_date >= (current_date - 1)
  loop
    if not (coalesce(br.sms_opt_in, false)
            and br.client_phone is not null
            and length(public.sms_normalize_phone(br.client_phone)) >= 7
            and not exists (select 1 from public.sms_opt_outs o
                            where o.phone = public.sms_normalize_phone(br.client_phone))
            and coalesce((select balance from public.sms_credits where user_id = br.user_id), 0) > 0) then
      continue;
    end if;

    v_tz := coalesce(
      nullif(br.timezone, ''),
      (select br2.timezone from public.booking_requests br2
        where br2.user_id = br.user_id and br2.timezone is not null and br2.timezone <> ''
        order by br2.created_at desc limit 1),
      'America/Los_Angeles'
    );
    begin
      start_ts := (br.preferred_date::text || ' ' || br.preferred_time::text)::timestamp
                  at time zone v_tz;
    exception when others then
      continue;
    end;
    if start_ts <= now() + interval '90 minutes'
       or start_ts >= now() + interval '150 minutes' then
      continue;
    end if;
    if br.appointment_id is not null then
      select status into appt_status from public.appointments where id = br.appointment_id;
      if appt_status = 'cancelled' then continue; end if;
    end if;

    studio_name := coalesce(nullif(trim(public.public_get_studio_name(br.user_id)), ''), 'your stylist');
    service_label := coalesce(br.selected_variation_name, br.service_name, 'appointment');
    sms_body := 'See you soon! Your ' || service_label || ' with ' || studio_name
                || ' is today at ' || br.preferred_time || '.';
    begin
      perform public.queue_notification(
        user_id_in => br.user_id,
        channel_in => 'sms',
        notification_type_in => 'appointment_reminder_2h',
        body_in => sms_body,
        recipient_phone_in => br.client_phone,
        recipient_name_in => br.client_name,
        payload_in => jsonb_build_object('smsText', sms_body),
        dedupe_key_in => 'appt_reminder_2h_sms:' || br.id::text || ':' || br.preferred_date::text,
        booking_request_id_in => br.id,
        appointment_id_in => br.appointment_id
      );
      enqueued := enqueued + 1;
    exception when others then null;
    end;
  end loop;

  -- ---- Scan B: stylist-created appointments ---------------------
  for ap in
    select * from public.appointments a
    where coalesce(a.kind, 'appointment') = 'appointment'
      and coalesce(a.is_all_day, false) = false
      and coalesce(a.status, '') not in
            ('cancelled', 'canceled', 'no-show', 'no_show', 'noshow', 'declined', 'completed')
      and a.appt_date is not null
      and a.appt_time is not null
      and a.appt_date >= (current_date - 1)
      and not exists (select 1 from public.booking_requests br2 where br2.appointment_id = a.id)
  loop
    if not (coalesce(ap.sms_opt_in, false)
            and ap.client_phone is not null
            and length(public.sms_normalize_phone(ap.client_phone)) >= 7
            and not exists (select 1 from public.sms_opt_outs o
                            where o.phone = public.sms_normalize_phone(ap.client_phone))
            and coalesce((select balance from public.sms_credits where user_id = ap.user_id), 0) > 0) then
      continue;
    end if;

    v_tz := coalesce(
      nullif(ap.timezone, ''),
      (select br2.timezone from public.booking_requests br2
        where br2.user_id = ap.user_id and br2.timezone is not null and br2.timezone <> ''
        order by br2.created_at desc limit 1),
      'America/Los_Angeles'
    );
    begin
      start_ts := (ap.appt_date::text || ' ' || ap.appt_time::text)::timestamp
                  at time zone v_tz;
    exception when others then
      continue;
    end;
    if start_ts <= now() + interval '90 minutes'
       or start_ts >= now() + interval '150 minutes' then
      continue;
    end if;

    studio_name := coalesce(nullif(trim(public.public_get_studio_name(ap.user_id)), ''), 'your stylist');
    service_label := coalesce(ap.style, 'appointment');
    sms_body := 'See you soon! Your ' || service_label || ' with ' || studio_name
                || ' is today at ' || ap.appt_time || '.';
    begin
      perform public.queue_notification(
        user_id_in => ap.user_id,
        channel_in => 'sms',
        notification_type_in => 'appointment_reminder_2h',
        body_in => sms_body,
        recipient_phone_in => ap.client_phone,
        recipient_name_in => ap.client_name,
        payload_in => jsonb_build_object('smsText', sms_body),
        dedupe_key_in => 'appt_reminder_2h_sms:appt:' || ap.id::text || ':' || ap.appt_date::text,
        appointment_id_in => ap.id::text
      );
      enqueued := enqueued + 1;
    exception when others then null;
    end;
  end loop;

  return enqueued;
end;
$function$;

revoke all on function public.enqueue_due_2h_sms_reminders() from public;
grant execute on function public.enqueue_due_2h_sms_reminders() to service_role;

-- pg_cron: run the 2h reminder every 15 minutes. Upserts by job name.
do $$
declare jid bigint;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    select jobid into jid from cron.job where jobname = 'enqueue_2h_sms_reminders_every_15m';
    if jid is not null then
      perform cron.unschedule(jid);
    end if;
    perform cron.schedule(
      'enqueue_2h_sms_reminders_every_15m',
      '*/15 * * * *',
      $cron$ select public.enqueue_due_2h_sms_reminders(); $cron$
    );
  end if;
end $$;

notify pgrst, 'reload schema';
