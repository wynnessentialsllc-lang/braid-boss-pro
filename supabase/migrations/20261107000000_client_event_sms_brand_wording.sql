-- Reword the client-event SMS bodies so they read cleanly once the worker
-- prepends the registered A2P brand ("Braid Boss Pro: ") at send time.
--
-- The campaign is registered under the Braid Boss Pro brand, so every SMS
-- must identify it. The worker now prepends "Braid Boss Pro: " to each
-- message; the bodies still name the stylist's business for the client.
-- The denial texts previously led with "Update from <business>:", which
-- read redundantly once prefixed ("Braid Boss Pro: Update from ...") — so
-- they now lead with the statement and keep the business name inline.
--
-- Only the booking_denied_* wording changes; cancellation and reschedule
-- already read well with the prefix.

create or replace function public.mirror_client_email_to_sms()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $func$
declare
  br         public.booking_requests;
  norm_phone text;
  v_studio   text;
  v_when     text := '';
  v_sms      text;
begin
  if NEW.channel <> 'email' then return NEW; end if;
  if NEW.notification_type not in (
    'client_booking_cancelled',
    'appointment_rescheduled',
    'client_booking_rescheduled',
    'booking_denied_no_charge',
    'booking_denied_refunded',
    'booking_denied_refund_manual'
  ) then
    return NEW;
  end if;

  if NEW.booking_request_id is not null then
    select * into br from public.booking_requests
      where id = NEW.booking_request_id limit 1;
  end if;
  if br.id is null and NEW.appointment_id is not null then
    select * into br from public.booking_requests
      where appointment_id = NEW.appointment_id
      order by created_at desc limit 1;
  end if;
  if br.id is null then return NEW; end if;

  if not coalesce(br.sms_opt_in, false) then return NEW; end if;
  if br.client_phone is null then return NEW; end if;
  norm_phone := public.sms_normalize_phone(br.client_phone);
  if norm_phone is null or length(norm_phone) < 7 then return NEW; end if;
  if exists (select 1 from public.sms_opt_outs o where o.phone = norm_phone) then
    return NEW;
  end if;
  if coalesce((select balance from public.sms_credits
               where user_id = NEW.user_id), 0) <= 0 then
    return NEW;
  end if;

  v_studio := coalesce(nullif(trim(public.public_get_studio_name(NEW.user_id)), ''),
                       'your stylist');

  begin
    if nullif(NEW.payload->>'preferredDate', '') is not null then
      v_when := to_char((NEW.payload->>'preferredDate')::date, 'FMMon FMDD');
    end if;
  exception when others then
    v_when := coalesce(NEW.payload->>'preferredDate', '');
  end;
  if nullif(NEW.payload->>'preferredTime', '') is not null then
    v_when := trim(v_when || ' at ' || (NEW.payload->>'preferredTime'));
  end if;

  v_sms := case NEW.notification_type
    when 'client_booking_cancelled' then
      'Your appointment with ' || v_studio
      || case when v_when <> '' then ' on ' || v_when else '' end
      || ' has been cancelled.'
    when 'appointment_rescheduled' then
      'Your appointment with ' || v_studio || ' has been moved'
      || case when v_when <> '' then ' to ' || v_when else '' end || '.'
    when 'client_booking_rescheduled' then
      'Reschedule request received by ' || v_studio
      || '. We''ll text you once your new time is confirmed.'
    when 'booking_denied_no_charge' then
      'Your booking request with ' || v_studio
      || ' wasn''t approved. No payment was taken.'
    when 'booking_denied_refunded' then
      'Your booking request with ' || v_studio
      || ' wasn''t approved. Your '
      || case when coalesce((NEW.payload->>'paidInFull')::boolean, false)
              then 'payment' else 'deposit' end
      || ' was refunded.'
    when 'booking_denied_refund_manual' then
      'Your booking request with ' || v_studio
      || ' wasn''t approved. Your refund is being processed.'
    else null
  end;

  if v_sms is null then return NEW; end if;

  begin
    perform public.queue_notification(
      user_id_in            => NEW.user_id,
      channel_in            => 'sms',
      notification_type_in  => NEW.notification_type,
      body_in               => v_sms,
      recipient_phone_in    => br.client_phone,
      recipient_name_in     => br.client_name,
      payload_in            => jsonb_build_object('smsText', v_sms),
      dedupe_key_in         => 'sms:' || coalesce(
                                 NEW.dedupe_key,
                                 NEW.notification_type || ':' || NEW.id::text),
      booking_request_id_in => br.id,
      appointment_id_in     => NEW.appointment_id
    );
  exception when others then
    null;
  end;

  return NEW;
end;
$func$;
