-- Owner-only safe backfill/getter for an appointment's balance link
-- token. All rows already have one (trigger + earlier backfill); this
-- is a belt-and-braces path so the "Copy balance payment link" button
-- can always resolve a token even for legacy rows or stale local
-- state, without exposing anything to anon.
create or replace function public.ensure_appointment_balance_token(
  appt_id_in text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
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
    tok := encode(gen_random_bytes(18), 'hex');
    update public.appointments
      set balance_access_token = tok
      where id = appt_id_in and user_id = uid;
  end if;
  return tok;
end;
$$;

revoke all on function public.ensure_appointment_balance_token(text) from public;
grant execute on function public.ensure_appointment_balance_token(text) to authenticated;

notify pgrst, 'reload schema';
