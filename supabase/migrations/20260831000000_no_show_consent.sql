-- No-show fee disclosure + consent.
--
-- When a stylist has no-show fees enabled and a booking will save a card
-- (deposit), the public booking page shows the fee and requires the
-- client to agree before paying. We stamp the agreement timestamp here
-- as proof of consent for dispute defense.
--
--   booking_requests.no_show_consent_at — when the client agreed (null = no record)
--   public_get_no_show_fee(user_id)      — anon: read the stylist's fee config for the booking page
--   public_record_no_show_consent(req)   — anon: stamp consent at booking time

alter table public.booking_requests
  add column if not exists no_show_consent_at timestamptz;

create or replace function public.public_get_no_show_fee(user_id_in uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean;
  v_type    text;
  v_value   numeric;
begin
  if user_id_in is null then
    return jsonb_build_object('ok', false);
  end if;

  select no_show_fee_enabled, no_show_fee_type, no_show_fee_value
    into v_enabled, v_type, v_value
  from public.booking_policies
  where user_id = user_id_in
  limit 1;

  return jsonb_build_object(
    'ok',      true,
    'enabled', coalesce(v_enabled, false),
    'type',    coalesce(v_type, 'flat'),
    'value',   v_value
  );
end;
$$;

revoke all on function public.public_get_no_show_fee(uuid) from public;
grant execute on function public.public_get_no_show_fee(uuid) to anon, authenticated;

create or replace function public.public_record_no_show_consent(request_id_in uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
begin
  if request_id_in is null then
    return jsonb_build_object('ok', false, 'reason', 'no_request');
  end if;

  select exists(select 1 from public.booking_requests where id = request_id_in)
    into v_exists;
  if not v_exists then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  update public.booking_requests
     set no_show_consent_at = now()
   where id = request_id_in
     and no_show_consent_at is null;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.public_record_no_show_consent(uuid) from public;
grant execute on function public.public_record_no_show_consent(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
