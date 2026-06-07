-- Optional custom message on the appointment confirmation email.
--
-- The "Send notification" modal lets the stylist add a short note that
-- should appear at the TOP of the client's confirmation email (Square's
-- behavior). We thread it through as a new 11th arg on
-- enqueue_appointment_confirmation, carried in the email payload as
-- `customMessage`. SMS is intentionally left untouched (note is
-- email/confirmation only).
--
-- Back-compat: the original 10-arg signature is kept as a thin wrapper
-- that passes a null message, so the currently-deployed app (which calls
-- with 10 args) keeps working until it ships the new call. The 11-arg
-- form has no default, so the two never resolve ambiguously.

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
begin
  if v_caller is not null and v_caller <> user_id_in then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_base   := coalesce(nullif(current_setting('app.public_url', true), ''), 'https://braidbosspro.app');
  v_studio := coalesce(nullif(trim(public.public_get_studio_name(user_id_in)), ''), 'your studio');
  v_msg    := nullif(trim(coalesce(custom_message_in, '')), '');

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
      dedupe_key_in        => 'appointment_confirmed:' || appt_id_in,
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
  text, uuid, text, text, text, text, text, text, numeric, boolean, text
) from public;
grant execute on function public.enqueue_appointment_confirmation(
  text, uuid, text, text, text, text, text, text, numeric, boolean, text
) to authenticated, service_role;

-- Back-compat wrapper: original 10-arg signature → no custom message.
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
begin
  return public.enqueue_appointment_confirmation(
    appt_id_in, user_id_in, client_name_in, client_email_in, client_phone_in,
    service_name_in, appt_date_in, appt_time_in, total_price_in, sms_opt_in_in, null
  );
end;
$function$;
