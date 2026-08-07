-- Include the studio/service address in the appointment confirmation
-- email.
--
-- Bug: clients booking a studio-based (non-mobile) service got a
-- confirmation email with no address, so they had no idea where to go
-- and had to text the stylist to ask. The address was never threaded
-- into the email at all — not in the enqueue payload, and not in the
-- rendered template.
--
-- This migration handles the data side: a small resolver that reads the
-- stylist's storefront location, and an updated enqueue_appointment_
-- confirmation that puts it on the email payload as 'studioAddress' for
-- studio (non-mobile) services. The matching "Where" block in the
-- process-notification-queue edge function renders it.

-- ---- Studio location resolver ---------------------------------------
-- Prefers the free-form location_text (e.g. "5309 Knowlton St"), falling
-- back to "City, ST" from the structured fields. Active storefront row
-- wins; returns '' when nothing is on file.
create or replace function public.studio_location_text(user_id_in uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loc   text;
  v_city  text;
  v_state text;
begin
  if user_id_in is null then return ''; end if;

  select nullif(trim(coalesce(b.location_text, '')), ''),
         nullif(trim(coalesce(b.business_city, '')), ''),
         nullif(trim(coalesce(b.business_state, '')), '')
    into v_loc, v_city, v_state
  from public.booking_links b
  where b.user_id = user_id_in
  order by b.active desc nulls last, b.created_at desc nulls last
  limit 1;

  if v_loc is not null then
    return v_loc;
  end if;
  if v_city is not null or v_state is not null then
    return trim(both ', ' from concat_ws(', ', v_city, v_state));
  end if;
  return '';
end;
$$;

revoke all on function public.studio_location_text(uuid) from public;
grant execute on function public.studio_location_text(uuid) to authenticated, service_role;

-- ---- Confirmation enqueue: add studioAddress to the email payload ----
-- Identical to the prior definition (20261206000000) except it resolves
-- the studio address for non-mobile services and adds it to the email
-- payload. The SMS branch is unchanged.
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
  v_mobile boolean;
  v_addr   text;
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

  -- The studio address only makes sense for a fixed-location (studio)
  -- service. For a mobile service the appointment is at the client's
  -- place, so we leave it out rather than send a misleading address.
  select coalesce(s.mobile_service, false) into v_mobile
  from public.services s where s.id = v_sid limit 1;
  if not coalesce(v_mobile, false) then
    v_addr := nullif(trim(public.studio_location_text(user_id_in)), '');
  else
    v_addr := null;
  end if;

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
        'studioAddress',    v_addr,
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
    v_sms := 'You''re booked with ' || public.sms_truncate_label(v_studio, 24) || v_when || '.';
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
