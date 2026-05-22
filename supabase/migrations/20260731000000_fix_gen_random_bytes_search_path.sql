-- Fix: "function gen_random_bytes(integer) does not exist".
--
-- gen_random_bytes is provided by the pgcrypto extension, which on
-- Supabase lives in the `extensions` schema. Three token-generating
-- functions called it UNqualified:
--
--   * ensure_client_marketing_token   — search_path 'public, pg_temp'
--   * ensure_appointment_balance_token — search_path 'public'
--   * fn_set_review_request_token      — no SET search_path
--
-- The first two pin an explicit search_path that excludes
-- `extensions`, so the bare call cannot resolve — this is what broke
-- "Send campaign" (process_marketing_campaign -> ensure_client_
-- marketing_token). ensure_appointment_balance_token has the
-- identical latent defect on a payment token; it has been masked
-- only because the appointment insert trigger usually pre-fills the
-- token. fn_set_review_request_token happens to work today by
-- inheriting the session search_path, but that is fragile.
--
-- Fix: schema-qualify as extensions.gen_random_bytes in all three.
-- Behavior is otherwise byte-for-byte identical to the live
-- definitions.

create or replace function public.ensure_client_marketing_token(
  user_id_in uuid, client_id_in text
)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_token text;
  v_new   text;
begin
  select marketing_unsubscribe_token into v_token
    from public.clients
   where user_id = user_id_in and id = client_id_in;
  if v_token is not null and length(v_token) > 0 then
    return v_token;
  end if;
  v_new := replace(replace(replace(
    encode(extensions.gen_random_bytes(16), 'base64'),
    '+', '-'), '/', '_'), '=', '');
  update public.clients
     set marketing_unsubscribe_token = v_new
   where user_id = user_id_in and id = client_id_in;
  return v_new;
end $function$;

create or replace function public.ensure_appointment_balance_token(
  appt_id_in text
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  tok text;
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;
  select balance_access_token into tok
  from public.appointments
  where id = appt_id_in and user_id = uid
  limit 1;
  if not found then
    return null;
  end if;
  if tok is null or tok = '' then
    tok := encode(extensions.gen_random_bytes(18), 'hex');
    update public.appointments
      set balance_access_token = tok
      where id = appt_id_in and user_id = uid;
  end if;
  return tok;
end;
$function$;

create or replace function public.fn_set_review_request_token()
returns trigger
language plpgsql
as $function$
begin
  if new.review_request_token is null then
    new.review_request_token := encode(extensions.gen_random_bytes(18), 'hex');
  end if;
  if new.balance_access_token is null then
    new.balance_access_token := encode(extensions.gen_random_bytes(18), 'hex');
  end if;
  return new;
end;
$function$;
