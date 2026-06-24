-- Client SMS when a stylist APPROVES a booking request (the "pay your
-- deposit" step).
--
-- Gap: the request-approval flow enqueues an `appointment_approved`
-- EMAIL only (app/lib/booking-requests.ts), and the SMS mirror added in
-- 20261106 did not include that type. So a client who booked via the
-- public link and opted into texts got an email on approval but no
-- text — even though they were texted on submit, denial, cancellation,
-- and reschedule. The confirmation ("you're booked") text is handled
-- separately by enqueue_appointment_confirmation, called SMS-only from
-- confirm_booking_request_approval's app path.
--
-- Fix: add `appointment_approved` to the mirror_client_email_to_sms
-- allowlist so the existing approval email auto-mirrors to a gated SMS.
-- Safe from double-texting: `appointment_approved` is enqueued as SMS
-- nowhere else (only as email, dedupe_key `appointment_approved:<id>`,
-- so the mirror's `sms:appointment_approved:<id>` key is unique). All
-- other behavior is reproduced verbatim from 20261106.

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
  -- Only mirror the specific client-facing transactional emails below.
  if NEW.channel <> 'email' then return NEW; end if;
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

  -- Resolve the linked booking request, which carries the client's phone
  -- and SMS opt-in. Prefer the explicit FK; fall back to appointment_id
  -- (the stylist-side cancel route keys on appointment, not request).
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

  -- Gating (mirrors the other client SMS enqueues).
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

  -- Studio name resolved canonically (settings -> profiles ->
  -- booking_links), same source the booking SMS use.
  v_studio := coalesce(nullif(trim(public.public_get_studio_name(NEW.user_id)), ''),
                       'your stylist');

  -- Human "Mon DD at TIME" from the email payload, formatted defensively.
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

  -- Enqueue the SMS. dedupe_key namespaced off the email's so an email
  -- retry/re-insert can't double-text. queue_notification enforces the
  -- master switch; channel='sms' means this insert won't re-fire us.
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
    null;  -- never let SMS mirroring break the email insert
  end;

  return NEW;
end;
$func$;

-- Trigger already exists from 20261106 and points at this function name;
-- create or replace above updates the body in place. Re-assert for
-- environments applying this migration in isolation.
drop trigger if exists mirror_client_email_to_sms on public.notification_queue;
create trigger mirror_client_email_to_sms
  after insert on public.notification_queue
  for each row
  execute function public.mirror_client_email_to_sms();
