-- Separate marketing / promotional SMS consent (A2P 10DLC / CTIA).
--
-- Twilio rejected the A2P campaign because the booking form bundled
-- transactional and marketing opt-in into a single checkbox. The form now
-- collects two distinct, optional opt-ins:
--   1. transactional SMS  -> booking_requests.sms_opt_in  (existing column,
--      stamped by the booking RPC + stamp_sms_consent() trigger)
--   2. marketing SMS       -> booking_requests.sms_marketing_opt_in (new)
--
-- Marketing SMS is not sent today (all promotional notifications are email
-- only), so there is no send path to gate yet — this captures the consent +
-- timestamp + IP/UA as proof so a future promotional-SMS feature can gate on
-- it. Recorded post-insert via public_record_sms_marketing_consent(), mirroring
-- public_record_no_show_consent(), so the large booking RPC is untouched.

alter table public.booking_requests
  add column if not exists sms_marketing_opt_in boolean not null default false;
alter table public.booking_requests
  add column if not exists sms_marketing_opt_in_at timestamptz;
alter table public.booking_requests
  add column if not exists sms_marketing_consent_ip text;
alter table public.booking_requests
  add column if not exists sms_marketing_consent_user_agent text;
alter table public.booking_requests
  add column if not exists sms_marketing_consent_version text;

-- Parity columns on appointments for stylist-initiated marketing consent.
alter table public.appointments
  add column if not exists sms_marketing_opt_in boolean not null default false;
alter table public.appointments
  add column if not exists sms_marketing_opt_in_at timestamptz;

-- Anon recorder — stamps affirmative marketing consent on the just-created
-- booking request. Idempotent (only writes when not already opted in) and
-- non-fatal: a missing request context can never block a booking.
create or replace function public.public_record_sms_marketing_consent(request_id_in uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
  v_ip text := null;
  v_ua text := null;
begin
  if request_id_in is null then
    return jsonb_build_object('ok', false, 'reason', 'no_request');
  end if;

  select exists(select 1 from public.booking_requests where id = request_id_in)
    into v_exists;
  if not v_exists then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- Best-effort capture of the consent IP + user-agent as A2P proof.
  begin
    v_ip := nullif(split_part(
      coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''),
      ',', 1), '');
    v_ua := nullif(
      coalesce(current_setting('request.headers', true)::json ->> 'user-agent', ''), '');
  exception when others then
    v_ip := null;
    v_ua := null;
  end;

  update public.booking_requests
     set sms_marketing_opt_in = true,
         sms_marketing_opt_in_at = coalesce(sms_marketing_opt_in_at, now()),
         sms_marketing_consent_ip = coalesce(sms_marketing_consent_ip, v_ip),
         sms_marketing_consent_user_agent = coalesce(sms_marketing_consent_user_agent, v_ua),
         sms_marketing_consent_version = coalesce(sms_marketing_consent_version, '2026-06-a2p')
   where id = request_id_in
     and sms_marketing_opt_in is distinct from true;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.public_record_sms_marketing_consent(uuid) from public;
grant execute on function public.public_record_sms_marketing_consent(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
