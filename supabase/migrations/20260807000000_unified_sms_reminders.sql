-- Unified SMS reminders — one pipeline for client self-bookings AND
-- stylist-created appointments.
--
-- Problem: enqueue_due_appointment_reminders only scanned
-- booking_requests, so an appointment the stylist created in-app
-- (no booking_request) got no reminder at all.
--
-- Fix (additive, no second system): the SAME cron function gains a
-- second scan over appointments that have no linked booking_request.
-- Both scans feed the one queue_notification pipeline. Stylist
-- appointments get the minimum tracking columns the cron needs.
--
-- Also adds: SMS consent provenance (source + timestamp) and the
-- groundwork for STOP/unsubscribe compliance (an opt-out table that
-- every enqueue path now respects).

-- =================================================================
-- 1. Schema
-- =================================================================

-- Stylist-created appointments need the same tracking the cron uses
-- on booking_requests: an opt-in flag, consent provenance, and a
-- reminder throttle timestamp.
alter table public.appointments
  add column if not exists sms_opt_in boolean not null default false;
alter table public.appointments
  add column if not exists sms_consent_source text;
alter table public.appointments
  add column if not exists sms_opt_in_at timestamptz;
alter table public.appointments
  add column if not exists last_reminder_sent_at timestamptz;

-- booking_requests already has sms_opt_in (SMS PR 2); add the
-- consent provenance fields to match.
alter table public.booking_requests
  add column if not exists sms_consent_source text;
alter table public.booking_requests
  add column if not exists sms_opt_in_at timestamptz;

-- STOP / unsubscribe groundwork. The platform sends from one shared
-- Twilio number, so a STOP is effectively global to that number —
-- phone is unique, user_id is informational only. A future inbound-
-- SMS webhook inserts here on "STOP"; every enqueue path already
-- skips numbers listed here.
create table if not exists public.sms_opt_outs (
  id         uuid primary key default gen_random_uuid(),
  phone      text not null unique,         -- normalized digits
  user_id    uuid,
  source     text,                          -- 'sms_stop' | 'manual'
  created_at timestamptz not null default now()
);
alter table public.sms_opt_outs enable row level security;
-- No end-user policies — only SECURITY DEFINER functions touch it.

-- =================================================================
-- 2. Helpers
-- =================================================================

-- Normalize a phone to digits-only so opt-out matching is format-
-- agnostic ("(310) 555-1234" == "+13105551234" == "3105551234").
create or replace function public.sms_normalize_phone(raw text)
returns text
language sql
immutable
as $function$
  select regexp_replace(coalesce(raw, ''), '\D', '', 'g');
$function$;

-- Stamp consent provenance whenever sms_opt_in is set true. One
-- function, two triggers — booking_requests → 'booking_flow',
-- appointments → 'stylist' (unless a source was set explicitly).
create or replace function public.stamp_sms_consent()
returns trigger
language plpgsql
as $function$
begin
  if NEW.sms_opt_in is true then
    if NEW.sms_opt_in_at is null then
      NEW.sms_opt_in_at := now();
    end if;
    if NEW.sms_consent_source is null or trim(NEW.sms_consent_source) = '' then
      NEW.sms_consent_source := case TG_TABLE_NAME
        when 'booking_requests' then 'booking_flow'
        else 'stylist'
      end;
    end if;
  end if;
  return NEW;
end;
$function$;

drop trigger if exists trg_stamp_sms_consent on public.appointments;
create trigger trg_stamp_sms_consent
  before insert or update on public.appointments
  for each row execute function public.stamp_sms_consent();

drop trigger if exists trg_stamp_sms_consent on public.booking_requests;
create trigger trg_stamp_sms_consent
  before insert or update on public.booking_requests
  for each row execute function public.stamp_sms_consent();

-- =================================================================
-- 3. Unified reminder cron — ONE function, TWO scans
-- =================================================================
-- Scan A: booking_requests (client self-bookings) — unchanged from
--         SMS PR 2, plus a STOP opt-out check on the SMS branch.
-- Scan B: appointments with NO linked booking_request (stylist-
--         created). Same window, same throttle, same gating, same
--         queue. Scan B excludes booking-request-linked rows, so
--         the two scans never both touch one appointment.
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
  sms_body text;
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
    start_ts := (br.preferred_date::text || ' ' || br.preferred_time::text)::timestamp;
    if start_ts <= now() + interval '18 hours'
       or start_ts >= now() + interval '30 hours' then
      continue;
    end if;
    if br.appointment_id is not null then
      select status into appt_status from public.appointments where id = br.appointment_id;
      if appt_status = 'cancelled' then continue; end if;
    end if;
    studio_name := coalesce(nullif(trim(public.public_get_studio_name(br.user_id)), ''), 'your stylist');
    service_label := coalesce(br.selected_variation_name, br.service_name);
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

      -- SMS reminder: opted in, usable phone, NOT opted out, credit.
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

  -- ---- Scan B: stylist-created appointments ---------------------
  -- Only appointments with NO booking_request (Scan A owns those),
  -- real (not personal/blocked), not cancelled, in the same window.
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
    begin
      start_ts := (ap.appt_date::text || ' ' || ap.appt_time::text)::timestamp;
    exception when others then
      continue;
    end;
    if start_ts <= now() + interval '18 hours'
       or start_ts >= now() + interval '30 hours' then
      continue;
    end if;

    studio_name := coalesce(nullif(trim(public.public_get_studio_name(ap.user_id)), ''), 'your stylist');
    service_label := coalesce(ap.style, 'appointment');
    begin
      -- Email reminder — only when an email is on file.
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

      -- SMS reminder — same gate as Scan A.
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

-- =================================================================
-- 4. Appointment confirmation — email + SMS for a stylist-created
--    appointment. Called from the in-app scheduler on save. Data is
--    passed in (not re-read) so it can't race the offline sync.
-- =================================================================
create or replace function public.enqueue_appointment_confirmation(
  appt_id_in       text,
  user_id_in       uuid,
  client_name_in   text,
  client_email_in  text,
  client_phone_in  text,
  service_name_in  text,
  appt_date_in     text,
  appt_time_in     text,
  total_price_in   numeric,
  sms_opt_in_in    boolean
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
begin
  if v_caller is not null and v_caller <> user_id_in then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_base   := coalesce(nullif(current_setting('app.public_url', true), ''), 'https://braidbosspro.app');
  v_studio := coalesce(nullif(trim(public.public_get_studio_name(user_id_in)), ''), 'your studio');

  -- Email confirmation — same behavior as the prior inline path.
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
        'appBase',          v_base
      ),
      dedupe_key_in        => 'appointment_confirmed:' || appt_id_in,
      appointment_id_in    => appt_id_in
    );
  end if;

  -- SMS confirmation — opted in, usable phone, not opted out, credit.
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
        dedupe_key_in        => 'appointment_confirmed_sms:' || appt_id_in,
        appointment_id_in    => appt_id_in
      );
    exception when others then null;
    end;
  end if;

  return jsonb_build_object('ok', true);
end;
$function$;

revoke all on function public.enqueue_appointment_confirmation(
  text, uuid, text, text, text, text, text, text, numeric, boolean) from public;
grant execute on function public.enqueue_appointment_confirmation(
  text, uuid, text, text, text, text, text, text, numeric, boolean) to authenticated;

-- =================================================================
-- 5. Booking-confirmation SMS — add the STOP opt-out check so a
--    client who previously texted STOP isn't messaged even if they
--    re-tick the box. Email path unchanged.
-- =================================================================
create or replace function public.enqueue_public_booking_emails(
  request_id_in    uuid,
  app_base_url_in  text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  br_row public.booking_requests;
  svc_row public.services%rowtype;
  studio_name text;
  enqueued integer := 0;
  payload_obj jsonb;
  rpc_result jsonb;
  app_base text;
  sms_body text;
begin
  if request_id_in is null then
    return jsonb_build_object('ok', false, 'reason', 'request_id_required');
  end if;
  select * into br_row from public.booking_requests where id = request_id_in limit 1;
  if br_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'request_not_found');
  end if;
  select coalesce(p.business_name, p.full_name, 'Braid Boss Pro') into studio_name
  from public.profiles p where p.id = br_row.user_id limit 1;
  studio_name := coalesce(studio_name, 'Braid Boss Pro');
  if br_row.service_id is not null then
    select * into svc_row from public.services where id = br_row.service_id limit 1;
  end if;
  app_base := coalesce(
    nullif(trim(coalesce(app_base_url_in, '')), ''),
    nullif(current_setting('app.public_url', true), ''),
    'https://braidbosspro.app'
  );
  if br_row.client_email is not null and position('@' in br_row.client_email) > 0 then
    payload_obj := jsonb_build_object(
      'clientName', coalesce(br_row.client_name, 'there'),
      'studioName', studio_name,
      'serviceName', br_row.service_name,
      'preferredDate', br_row.preferred_date::text,
      'preferredTime', br_row.preferred_time,
      'approvalStatus', br_row.approval_status,
      'depositRequired', br_row.deposit_required,
      'hairIncluded', coalesce(svc_row.hair_included, false),
      'selectedHairColor', coalesce(br_row.selected_hair_color, br_row.customization_summary->>'custom_hair_color'),
      'selectedCurlPattern', coalesce(br_row.selected_curl_pattern, br_row.customization_summary->>'custom_curl_pattern'),
      'prepReminder', nullif(trim(coalesce(svc_row.prep_instructions, '')), ''),
      'portalUrl', case when br_row.portal_token is not null
                        then app_base || '/client/appointment/' || br_row.portal_token else null end
    );
    rpc_result := public.queue_notification(
      user_id_in => br_row.user_id,
      channel_in => 'email',
      notification_type_in => 'booking_confirmation',
      body_in => 'Booking request received',
      subject_in => 'Booking request received — ' || studio_name,
      recipient_email_in => br_row.client_email,
      recipient_name_in => br_row.client_name,
      payload_in => payload_obj,
      dedupe_key_in => 'booking_confirmation:' || br_row.id::text,
      booking_request_id_in => br_row.id
    );
    if coalesce((rpc_result->>'ok')::boolean, false)
       and not coalesce((rpc_result->>'skipped')::boolean, false) then
      enqueued := enqueued + 1;
    end if;
  end if;

  if coalesce(br_row.sms_opt_in, false)
     and br_row.client_phone is not null
     and length(public.sms_normalize_phone(br_row.client_phone)) >= 7
     and not exists (select 1 from public.sms_opt_outs o
                     where o.phone = public.sms_normalize_phone(br_row.client_phone))
     and coalesce((select balance from public.sms_credits where user_id = br_row.user_id), 0) > 0
  then
    sms_body := 'Booking request received by ' || studio_name
                || '. You''ll hear back once it''s confirmed.';
    begin
      rpc_result := public.queue_notification(
        user_id_in => br_row.user_id,
        channel_in => 'sms',
        notification_type_in => 'booking_confirmation',
        body_in => sms_body,
        recipient_phone_in => br_row.client_phone,
        recipient_name_in => br_row.client_name,
        payload_in => jsonb_build_object('smsText', sms_body),
        dedupe_key_in => 'booking_confirmation_sms:' || br_row.id::text,
        booking_request_id_in => br_row.id
      );
      if coalesce((rpc_result->>'ok')::boolean, false)
         and not coalesce((rpc_result->>'skipped')::boolean, false) then
        enqueued := enqueued + 1;
      end if;
    exception when others then null;
    end;
  end if;

  return jsonb_build_object('ok', true, 'enqueued', enqueued);
end;
$function$;
