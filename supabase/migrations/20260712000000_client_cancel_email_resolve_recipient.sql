-- Client self-service cancel: reliably email the CLIENT. Previously
-- the client_booking_cancelled email was gated on br.client_email
-- being non-null, but for many bookings the email lives on the
-- linked appointment (or is an empty string), so the client got
-- nothing while the stylist still got their notice. Resolve the
-- recipient from booking_request → linked appointment, and treat
-- '' as missing. Stylist enqueue + all other logic unchanged.
create or replace function public.public_cancel_booking_by_token(token_in text, reason_in text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  br public.booking_requests%rowtype;
  appt_start_ts timestamptz;
  studio_name text;
  service_label text;
  audit_entry jsonb;
  v_client_email text;
  v_client_name text;
begin
  if token_in is null or length(trim(token_in)) < 16 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_token');
  end if;
  select * into br from public.booking_requests
  where cancel_token = token_in limit 1;
  if br.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if br.approval_status = 'cancelled' or br.cancelled_at is not null then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if br.preferred_date is not null and br.preferred_time is not null then
    appt_start_ts := (br.preferred_date::text || ' ' || br.preferred_time::text)::timestamp;
    if appt_start_ts < now() then
      return jsonb_build_object('ok', false, 'reason', 'appointment_past');
    end if;
  end if;
  audit_entry := jsonb_build_object(
    'action', 'cancel',
    'reason', coalesce(reason_in, ''),
    'token_suffix', right(token_in, 6),
    'at', now()
  );
  update public.booking_requests
  set approval_status = 'cancelled',
      status = 'declined',
      cancelled_at = now(),
      cancelled_by = 'client',
      cancellation_reason = nullif(trim(coalesce(reason_in, '')), ''),
      deposit_forfeited = true,
      client_action_audit = coalesce(client_action_audit, '[]'::jsonb) || jsonb_build_array(audit_entry),
      cancel_token = null,
      reschedule_token = null,
      updated_at = now()
  where id = br.id;
  if br.appointment_id is not null then
    update public.appointments
    set status = 'cancelled',
        cancelled_at = coalesce(cancelled_at, now()),
        cancellation_reason = coalesce(
          cancellation_reason,
          'Client cancellation via secure link' ||
            case when reason_in is not null and trim(reason_in) <> ''
              then ': ' || left(trim(reason_in), 200)
              else '' end
        ),
        updated_at = now()
    where id = br.appointment_id;
  end if;
  studio_name := coalesce(nullif(trim(public.public_get_studio_name(br.user_id)), ''), 'your stylist');
  service_label := coalesce(br.selected_variation_name, br.service_name);

  -- Resolve the client's email: booking_request first, then the
  -- linked appointment. Empty strings count as missing.
  v_client_email := nullif(trim(coalesce(br.client_email, '')), '');
  if v_client_email is null and br.appointment_id is not null then
    select nullif(trim(coalesce(a.client_email, '')), '')
      into v_client_email
    from public.appointments a
    where a.id = br.appointment_id
    limit 1;
  end if;
  v_client_name := coalesce(
    nullif(trim(coalesce(br.client_name, '')), ''),
    (select nullif(trim(coalesce(a.client_name, '')), '')
       from public.appointments a where a.id = br.appointment_id limit 1)
  );

  begin
    perform public.queue_notification(
      user_id_in => br.user_id,
      channel_in => 'email',
      notification_type_in => 'stylist_booking_cancelled',
      body_in => 'A client cancelled their appointment via the self-service link. Deposit forfeited.',
      subject_in => 'Client cancelled — ' || coalesce(br.client_name, 'a client'),
      recipient_email_in => (select email from auth.users where id = br.user_id),
      recipient_name_in => null,
      payload_in => jsonb_build_object(
        'clientName', coalesce(br.client_name, 'A client'),
        'serviceName', service_label,
        'preferredDate', br.preferred_date,
        'preferredTime', br.preferred_time,
        'reason', coalesce(reason_in, ''),
        'depositAmount', br.deposit_amount
      ),
      dedupe_key_in => 'stylist_booking_cancelled:' || br.id::text,
      booking_request_id_in => br.id,
      appointment_id_in => br.appointment_id
    );
  exception when others then null;
  end;

  if v_client_email is not null then
    begin
      perform public.queue_notification(
        user_id_in => br.user_id,
        channel_in => 'email',
        notification_type_in => 'client_booking_cancelled',
        body_in => 'Your appointment has been cancelled.',
        subject_in => 'Your appointment was cancelled',
        recipient_email_in => v_client_email,
        recipient_name_in => v_client_name,
        payload_in => jsonb_build_object(
          'clientName', coalesce(v_client_name, 'there'),
          'studioName', studio_name,
          'serviceName', service_label,
          'preferredDate', br.preferred_date,
          'preferredTime', br.preferred_time,
          'depositForfeited', true,
          'depositAmount', br.deposit_amount
        ),
        dedupe_key_in => 'client_booking_cancelled:' || br.id::text,
        booking_request_id_in => br.id,
        appointment_id_in => br.appointment_id
      );
    exception when others then null;
    end;
  end if;
  return jsonb_build_object('ok', true, 'id', br.id);
end $function$;

revoke all on function public.public_cancel_booking_by_token(text, text) from public;
grant execute on function public.public_cancel_booking_by_token(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
