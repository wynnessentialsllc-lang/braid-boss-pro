-- A2P / CTIA proof-of-consent: record the client IP at opt-in time.
--
-- We already stamp sms_opt_in_at (timestamp) and sms_consent_source via
-- the stamp_sms_consent() trigger (migration 20260807). Carriers and The
-- Campaign Registry expect retained proof of express consent, which
-- ideally pairs the consent timestamp with the originating IP address.
--
-- This adds a nullable sms_consent_ip column to both tables the trigger
-- fires on, and extends the trigger to capture the client IP from the
-- PostgREST request's X-Forwarded-For header. The capture is wrapped so a
-- missing/malformed request context (e.g. a direct SQL write, or an
-- in-app stylist edit) can never block a booking write.

alter table public.booking_requests
  add column if not exists sms_consent_ip text;
alter table public.appointments
  add column if not exists sms_consent_ip text;

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
        when 'booking_requests' then 'booking_flow'
        else 'stylist'
      end;
    end if;
    -- Record the originating client IP at the moment of consent. The
    -- first hop in X-Forwarded-For is the client; later hops are proxies.
    begin
      if NEW.sms_consent_ip is null then
        NEW.sms_consent_ip := nullif(split_part(
          coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''),
          ',', 1), '');
      end if;
    exception when others then
      null;  -- never block a write on consent-IP capture
    end;
  end if;
  return NEW;
end;
$function$;

-- Triggers already point at stamp_sms_consent() (created in 20260807);
-- CREATE OR REPLACE above is picked up without recreating them.
