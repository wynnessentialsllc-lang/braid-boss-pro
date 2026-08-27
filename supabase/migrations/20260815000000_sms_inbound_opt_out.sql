-- Inbound SMS opt-out / opt-in plumbing.
--
-- The unified-reminders migration (20260807) created public.sms_opt_outs
-- and wired every enqueue path to skip numbers listed there, but left a
-- TODO: "a future inbound-SMS webhook inserts here on STOP." This adds
-- the two SECURITY DEFINER RPCs that webhook calls — one to record an
-- opt-out (STOP / UNSUBSCRIBE), one to clear it (START / UNSTOP). The
-- table has RLS on with no end-user policies, so only these definer
-- functions (and the service role) ever touch it.
--
-- Phone is normalized via public.sms_normalize_phone so "(310) 555-1234",
-- "+13105551234" and "3105551234" all collapse to one opt-out row.
--
-- That claim did NOT hold before this migration: the normalizer only
-- stripped non-digits, so Twilio's E.164 "From" (+13105551234 -> the 11
-- digits "13105551234") and a client phone stored as "(310) 555-1234"
-- (-> "3105551234") produced DIFFERENT keys. Every send path gates on
--
--   not exists (select 1 from sms_opt_outs o
--               where o.phone = sms_normalize_phone(client_phone))
--
-- so an opt-out recorded from an inbound STOP would never have matched
-- the stored client number, and the client would have kept receiving
-- messages. This migration therefore also makes the normalizer canonical
-- for NANP numbers (an 11-digit result beginning with 1 loses the country
-- code), so both sides of that comparison agree.
--
-- Safe to change in place: the normalizer is used for opt-out matching
-- and length validation only — never to build the outbound recipient
-- number — and sms_opt_outs is empty, so no existing key is orphaned.
--
-- Because the platform sends from one shared Twilio number, a STOP is
-- global to that number; user_id is informational only.

-- =================================================================
-- sms_normalize_phone — canonical matching key. Digits only, with the
-- NANP country code dropped so "+1 310 555 1234" and "(310) 555-1234"
-- are the same number. Non-NANP / short input is left as its digits.
-- =================================================================
create or replace function public.sms_normalize_phone(raw text)
returns text
language sql
immutable
as $function$
  select case
           when length(d) = 11 and left(d, 1) = '1' then right(d, 10)
           else d
         end
  from (select regexp_replace(coalesce(raw, ''), '\D', '', 'g') as d) t;
$function$;

-- =================================================================
-- sms_record_opt_out — idempotent. Inserts (or refreshes the source/
-- timestamp of) an opt-out for the normalized phone. Returns the
-- normalized phone so the caller can log what it acted on.
-- =================================================================
create or replace function public.sms_record_opt_out(
  phone_in   text,
  source_in  text default 'sms_stop',
  user_id_in uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_norm text;
begin
  v_norm := public.sms_normalize_phone(phone_in);
  if v_norm is null or length(v_norm) < 7 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_phone');
  end if;

  insert into public.sms_opt_outs (phone, user_id, source)
  values (v_norm, user_id_in, coalesce(nullif(trim(source_in), ''), 'sms_stop'))
  on conflict (phone) do update
    set source     = excluded.source,
        user_id    = coalesce(public.sms_opt_outs.user_id, excluded.user_id),
        created_at = public.sms_opt_outs.created_at;  -- keep first opt-out time

  return jsonb_build_object('ok', true, 'phone', v_norm);
end;
$function$;

-- =================================================================
-- sms_clear_opt_out — removes an opt-out so a previously-opted-out
-- number can be messaged again after texting START / UNSTOP / YES.
-- No-ops cleanly when the number wasn't opted out.
-- =================================================================
create or replace function public.sms_clear_opt_out(phone_in text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_norm    text;
  v_deleted integer;
begin
  v_norm := public.sms_normalize_phone(phone_in);
  if v_norm is null or length(v_norm) < 7 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_phone');
  end if;

  delete from public.sms_opt_outs where phone = v_norm;
  get diagnostics v_deleted = row_count;

  return jsonb_build_object('ok', true, 'phone', v_norm, 'cleared', v_deleted > 0);
end;
$function$;

revoke all on function public.sms_record_opt_out(text, text, uuid) from public;
revoke all on function public.sms_clear_opt_out(text)            from public;
grant execute on function public.sms_record_opt_out(text, text, uuid) to service_role;
grant execute on function public.sms_clear_opt_out(text)            to service_role;
