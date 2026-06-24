-- Client SMS receipt when a client pays their remaining balance.
--
-- Every other money/appointment event texts the client, but the
-- "balance paid in full" confirmation was email-only. Unlike the other
-- mirrored types (which are booking-request events), balance_paid fires
-- for ANY appointment — including stylist-created ones that have no
-- booking_request — so its consent + phone are sourced from the
-- APPOINTMENT (appointments.sms_opt_in / client_phone), the same source
-- the SMS reminder uses. Handling it in the mirror covers every
-- balance_paid email enqueue path (Stripe webhook + manual mark-paid) in
-- one place.
--
-- Reproduces the current mirror_client_email_to_sms (incl. the
-- appointment_approved entry from 20261108) and adds the balance_paid
-- branch. balance_paid is enqueued as SMS nowhere else, so no double.

create or replace function public.mirror_client_email_to_sms()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $func$
declare
  br         public.booking_requests;
  ap         public.appointments;
  norm_phone text;
  v_studio   text;
  v_when     text := '';
  v_sms      text;
begin
  if NEW.channel <> 'email' then return NEW; end if;

  -- Appointment-centric receipt: balance paid in full. Consent + phone
  -- come from the appointment, so it works for every appointment, not
  -- just those that originated from a booking request.
  if NEW.notification_type = 'balance_paid' then
    if NEW.appointment_id is null then return NEW; end if;
    select * into ap from public.appointments
      where id = NEW.appointment_id and user_id = NEW.user_id limit 1;
    if ap.id is null then return NEW; end if;
    if not coalesce(ap.sms_opt_in, false) then return NEW; end if;
    if ap.client_phone is null then return NEW; end if;
    norm_phone := public.sms_normalize_phone(ap.client_phone);
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
    v_sms := 'Thank you! Your balance with ' || v_studio || ' is paid in full.';
    begin
      perform public.queue_notification(
        user_id_in            => NEW.user_id,
        channel_in            => 'sms',
        notification_type_in  => 'balance_paid',
        body_in               => v_sms,
        recipient_phone_in    => ap.client_phone,
        recipient_name_in     => ap.client_name,
        payload_in            => jsonb_build_object('smsText', v_sms),
        dedupe_key_in         => 'sms:' || coalesce(
                                   NEW.dedupe_key,
                                   'balance_paid:' || NEW.id::text),
        appointment_id_in     => NEW.appointment_id
      );
    exception when others then null;
    end;
    return NEW;
  end if;

  -- Booking-request-centric client-facing transactional emails.
  if NEW.notification_type not in (
    'appointment_approved',         -- stylist approved; pay the deposit
    'client_booking_cancelled',     -- appointment cancelled (either side)
    'appointment_rescheduled',      -- stylist moved a confirmed appt
    'client_booking_rescheduled',   -- client's reschedule request received
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
    when 'appointment_approved' then
      v_studio || ' approved your booking'
      || case when v_when <> '' then ' for ' || v_when else '' end
      || '. Check your email to pay your deposit and lock in your spot.'
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
      'Update from ' || v_studio
      || ': your booking request wasn''t approved. No payment was taken.'
    when 'booking_denied_refunded' then
      'Update from ' || v_studio
      || ': your booking request wasn''t approved. Your '
      || case when coalesce((NEW.payload->>'paidInFull')::boolean, false)
              then 'payment' else 'deposit' end
      || ' was refunded.'
    when 'booking_denied_refund_manual' then
      'Update from ' || v_studio
      || ': your booking request wasn''t approved. Your refund is being processed.'
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

drop trigger if exists mirror_client_email_to_sms on public.notification_queue;
create trigger mirror_client_email_to_sms
  after insert on public.notification_queue
  for each row
  execute function public.mirror_client_email_to_sms();
