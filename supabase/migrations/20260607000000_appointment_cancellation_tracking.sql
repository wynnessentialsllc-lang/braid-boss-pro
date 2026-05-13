-- Cancel-not-delete for real appointments.
--
-- Why: deleting an appointment removes the only Braid Boss Pro row
-- that ties a Stripe charge to a booking. If the deposit hasn't been
-- refunded, the stylist's books and Stripe drift apart. The new
-- pattern is:
--   * Real appointment → POST /api/cancel-appointment, which calls
--     Stripe Refunds for any linked payment_intent (deposit +
--     balance) and then calls cancel_appointment() to flip the row
--     to status='cancelled' with audit columns populated.
--   * Personal / blocked-time entries still delete normally — no
--     money attached.

alter table public.appointments
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text,
  add column if not exists refund_amount numeric,
  add column if not exists refund_stripe_charge_ids text[];

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

  update public.appointments
  set status = 'cancelled',
      cancelled_at = coalesce(cancelled_at, now()),
      cancellation_reason = coalesce(reason_in, cancellation_reason),
      refund_amount = case
        when refund_amount_in is not null then
          coalesce(refund_amount, 0) + refund_amount_in
        else refund_amount
      end,
      refund_stripe_charge_ids = case
        when refund_ids_in is not null and array_length(refund_ids_in, 1) > 0 then
          coalesce(refund_stripe_charge_ids, ARRAY[]::text[]) || refund_ids_in
        else refund_stripe_charge_ids
      end,
      updated_at = now()
  where id = appt_id_in and user_id = caller
  returning * into row_out;

  if row_out.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'id', row_out.id);
end;
$$;

revoke all on function public.cancel_appointment(text, text, numeric, text[]) from public;
grant execute on function public.cancel_appointment(text, text, numeric, text[]) to authenticated;
