-- A2P / CTIA proof-of-consent metadata (round 2).
--
-- Extends the consent record beyond timestamp (sms_opt_in_at) and IP
-- (sms_consent_ip) to also retain the user-agent and a consent-language
-- version, and to tag the booking-form source as "public_booking_page".
-- All captured server-side inside the existing stamp_sms_consent() trigger
-- from request headers + constants, so no RPC signature changes are needed
-- and a missing request context can never block a write.

alter table public.booking_requests
  add column if not exists sms_consent_user_agent text;
alter table public.booking_requests
  add column if not exists sms_consent_version text;
alter table public.appointments
  add column if not exists sms_consent_user_agent text;
alter table public.appointments
  add column if not exists sms_consent_version text;

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
        when 'booking_requests' then 'public_booking_page'
        else 'stylist'
      end;
    end if;
    if NEW.sms_consent_version is null then
      NEW.sms_consent_version := '2026-06-a2p';
    end if;
    begin
      if NEW.sms_consent_ip is null then
        NEW.sms_consent_ip := nullif(split_part(
          coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''),
          ',', 1), '');
      end if;
      if NEW.sms_consent_user_agent is null then
        NEW.sms_consent_user_agent := nullif(
          coalesce(current_setting('request.headers', true)::json ->> 'user-agent', ''), '');
      end if;
    exception when others then
      null;
    end;
  end if;
  return NEW;
end;
$function$;
