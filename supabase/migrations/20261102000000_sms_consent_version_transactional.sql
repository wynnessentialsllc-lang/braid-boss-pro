-- A2P 10DLC: bump SMS consent-language version to the transactional-only wording.
--
-- The booking-form opt-in, Privacy Policy, Terms, and the opt-in proof page no
-- longer bundle promotional/marketing offers into the SMS consent — the program
-- is strictly transactional (appointment confirmations, reminders, booking
-- updates, payment/contract reminders, review + rebooking reminders). New
-- consents are stamped with a version string that reflects that corrected
-- language so the proof-of-consent record stays accurate over time.
--
-- Only the default version string inside stamp_sms_consent() changes; existing
-- rows keep whatever version they were captured under.

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
      NEW.sms_consent_version := '2026-06-a2p-transactional';
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
