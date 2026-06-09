-- Hair sourcing v2, phase 1 (confirmations): thread the "hair to bring"
-- shopping list into the booking-received + appointment-confirmed
-- messages so client-supplied braiders' clients know exactly what to buy.
--
-- hair_bring_text(service_id, short) formats the spec:
--   full  → "5 packs X-pression Kanekalon 1B. Come washed + blow-dried"
--   short → "5 packs 1B"  (for SMS, kept to one segment)
-- Returns NULL when the service isn't client/choice or has no spec.

create or replace function public.hair_bring_text(
  service_id_in uuid,
  short_in      boolean default false
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s     public.services%rowtype;
  brand text; color text; packs text; prep text;
  core  text;
begin
  if service_id_in is null then return null; end if;
  select * into s from public.services where id = service_id_in;
  if not found or coalesce(s.hair_sourcing, 'included') not in ('client', 'choice') then
    return null;
  end if;
  brand := nullif(trim(coalesce(s.hair_spec->>'brand', '')), '');
  color := nullif(trim(coalesce(s.hair_spec->>'color', '')), '');
  packs := nullif(trim(coalesce(s.hair_spec->>'packs', '')), '');
  prep  := nullif(trim(coalesce(s.hair_spec->>'prep',  '')), '');
  if short_in then
    -- packs + color only, to keep the SMS within one segment.
    core := nullif(trim(concat_ws(' ',
      case when packs is not null then packs || ' packs' end,
      color)), '');
    return core;
  end if;
  core := nullif(trim(concat_ws(' ',
    case when packs is not null then packs || ' packs' end,
    brand,
    color)), '');
  if core is null then return null; end if;
  if prep is not null then return core || '. ' || prep; end if;
  return core;
end;
$$;

revoke all on function public.hair_bring_text(uuid, boolean) from public;
grant execute on function public.hair_bring_text(uuid, boolean) to authenticated, service_role;

-- ---- Booking-received confirmation (email + SMS) -------------------
-- Reproduced from 20260807 verbatim with the hair-to-bring line added.
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
  v_hair text;
  v_hair_sms text;
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
  v_hair := public.hair_bring_text(br_row.service_id, false);
  v_hair_sms := public.hair_bring_text(br_row.service_id, true);
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
      'hairBring', v_hair,
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
    if v_hair_sms is not null then
      sms_body := sms_body || ' Bring: ' || v_hair_sms || '.';
    end if;
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

-- ---- Appointment-confirmed (on approval) email + SMS --------------
-- Reproduced from 20261017 with the hair line added. The hair spec is
-- reached from the appointment via its booking_request (service_id);
-- stylist-created appts without a booking_request simply have no line.
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
  v_sid    uuid;
  v_hair   text;
  v_hair_sms text;
begin
  if v_caller is not null and v_caller <> user_id_in then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_base   := coalesce(nullif(current_setting('app.public_url', true), ''), 'https://braidbosspro.app');
  v_studio := coalesce(nullif(trim(public.public_get_studio_name(user_id_in)), ''), 'your studio');
  v_msg    := nullif(trim(coalesce(custom_message_in, '')), '');
  v_datekey := coalesce(nullif(trim(coalesce(appt_date_in, '')), ''), 'na');

  select br.service_id into v_sid
  from public.booking_requests br
  where br.appointment_id::text = appt_id_in and br.service_id is not null
  order by br.updated_at desc limit 1;
  v_hair := public.hair_bring_text(v_sid, false);
  v_hair_sms := public.hair_bring_text(v_sid, true);

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
        'hairBring',        v_hair,
        'appBase',          v_base
      ),
      dedupe_key_in        => 'appointment_confirmed:' || appt_id_in || ':' || v_datekey,
      appointment_id_in    => appt_id_in
    );
  end if;

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
    v_sms := 'You''re booked with ' || left(v_studio, 24) || v_when || '.';
    if v_hair_sms is not null then
      v_sms := v_sms || ' Bring: ' || v_hair_sms || '.';
    end if;
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

notify pgrst, 'reload schema';
