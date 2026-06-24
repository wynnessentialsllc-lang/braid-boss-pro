-- Two-way SMS: deliver a stylist's thread reply to the client as a text.
--
-- client_messages was in-app only (the client saw stylist replies when
-- they reopened their portal link). For clients who reach the stylist by
-- SMS, that loop is invisible. This sends the stylist's reply back out as
-- an SMS, making the number a true two-way line.
--
-- Compliance guardrails (carrier / A2P 10DLC):
--   * Only to clients who OPTED IN to SMS (booking_requests.sms_opt_in) —
--     the auditable consent signal. A client only ever received our texts
--     because they opted in, so anyone in an SMS conversation qualifies.
--   * NEVER to an opted-out number (sms_opt_outs) — STOP is absolute.
--   * Owner must hold credits; queue_notification adds the per-owner SMS
--     master switch. The worker prepends the registered brand
--     ("Braid Boss Pro: ") and appends "Reply STOP to opt out." to every
--     send, so each conversational message stays identified + opt-out-able.
--   * Stylist-authored, customer-care content tied to the appointment
--     thread — the compliant "conversational" A2P use case.
--
-- When a guard fails the message still lands in-app (portal); it just
-- isn't texted. channel='sms' so this never re-fires the notification_queue
-- triggers, and it reads client_messages (not writes), so no recursion.

create or replace function public.send_stylist_message_as_sms()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $func$
declare
  br         public.booking_requests;
  norm_phone text;
begin
  if NEW.sender <> 'stylist' then return NEW; end if;
  if nullif(btrim(coalesce(NEW.body, '')), '') is null then return NEW; end if;

  select * into br from public.booking_requests
    where id = NEW.booking_request_id limit 1;
  if br.id is null then return NEW; end if;

  -- Consent + deliverability guards.
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

  begin
    perform public.queue_notification(
      user_id_in            => NEW.user_id,
      channel_in            => 'sms',
      notification_type_in  => 'client_message',
      body_in               => NEW.body,
      recipient_phone_in    => br.client_phone,
      recipient_name_in     => br.client_name,
      payload_in            => jsonb_build_object('smsText', NEW.body),
      dedupe_key_in         => 'sms:client_message:' || NEW.id::text,
      booking_request_id_in => br.id
    );
  exception when others then
    null;  -- never block the in-app message insert
  end;

  return NEW;
end;
$func$;

drop trigger if exists send_stylist_message_as_sms on public.client_messages;
create trigger send_stylist_message_as_sms
  after insert on public.client_messages
  for each row
  execute function public.send_stylist_message_as_sms();
