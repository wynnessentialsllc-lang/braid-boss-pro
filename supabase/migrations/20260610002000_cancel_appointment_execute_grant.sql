-- Fix appointment cancellation RPC permissions without widening access.
--
-- Appointments are cancelled, not hard-deleted. The API route verifies the
-- caller owns the appointment before refund work, and this SECURITY DEFINER
-- function repeats the owner check with auth.uid() before updating the row.

create or replace function public.cancel_appointment(
  appt_id_in text,
  reason_in text default null,
  refund_amount_in numeric default null,
  refund_ids_in text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  row_out public.appointments;
begin
  if caller is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;
  if appt_id_in is null or trim(appt_id_in) = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_id');
  end if;

  update public.appointments as appt
  set status = 'cancelled',
      cancelled_at = coalesce(appt.cancelled_at, now()),
      cancellation_reason = coalesce(reason_in, appt.cancellation_reason),
      refund_amount = case
        when refund_amount_in is not null then
          coalesce(appt.refund_amount, 0) + refund_amount_in
        else appt.refund_amount
      end,
      refund_stripe_charge_ids = case
        when refund_ids_in is not null and array_length(refund_ids_in, 1) > 0 then
          coalesce(appt.refund_stripe_charge_ids, ARRAY[]::text[]) || refund_ids_in
        else appt.refund_stripe_charge_ids
      end,
      updated_at = now()
  where appt.id = appt_id_in
    and appt.user_id = caller
  returning appt.* into row_out;

  if row_out.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  return jsonb_build_object('ok', true, 'id', row_out.id);
end;
$$;

revoke all on function public.cancel_appointment(text, text, numeric, text[]) from public;
grant execute on function public.cancel_appointment(text, text, numeric, text[]) to authenticated;
