-- Preserve the deposit-vs-balance breakdown when a balance is paid.
--
-- The original mark_balance_paid_via_webhook / mark_balance_paid_manually
-- overwrote deposit_paid with the full total (deposit_paid = total_price,
-- or deposit_paid + amount). That collapsed the record so a $25 deposit +
-- $279.74 balance showed as one flat "$304.74 deposit" — the stylist lost
-- the ability to see the real deposit, balance, and tip split on the
-- receipt and the ledger.
--
-- These redefinitions leave deposit_paid ALONE (the original deposit stays
-- the original deposit) and simply mark the balance collected: balance_paid
-- = true, balance_due = 0, payment_status = 'paid'. The app now counts the
-- full ticket for a paid appointment (calculateCollectedAmount), so revenue
-- stays correct without the flatten, and deriveAppointmentTransactions can
-- render the deposit and balance as their own rows.
--
-- Everything else about the two functions is unchanged.

-- =====================================================================
-- mark_balance_paid_via_webhook — keep deposit_paid intact
-- =====================================================================
create or replace function public.mark_balance_paid_via_webhook(
  appt_id_in text,
  stripe_session_id_in text default null,
  stripe_payment_intent_in text default null,
  amount_in numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row_out public.appointments;
begin
  if appt_id_in is null or trim(appt_id_in) = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_id');
  end if;

  select * into row_out from public.appointments where id = appt_id_in limit 1;
  if row_out.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if row_out.balance_paid then
    return jsonb_build_object('ok', true, 'already_paid', true, 'id', row_out.id);
  end if;
  if row_out.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'reason', 'cancelled');
  end if;

  update public.appointments
  set balance_paid = true,
      balance_paid_at = now(),
      balance_payment_intent_id = coalesce(stripe_payment_intent_in, balance_payment_intent_id),
      balance_checkout_session_id = coalesce(stripe_session_id_in, balance_checkout_session_id),
      balance_payment_status = 'paid',
      payment_status = 'paid',
      payment_date = coalesce(payment_date, current_date),
      payment_method = coalesce(payment_method, 'stripe'),
      -- Balance is now settled. deposit_paid is deliberately NOT touched, so
      -- the original deposit is preserved and the deposit-vs-balance split
      -- survives on the receipt and ledger.
      balance_due = 0,
      updated_at = now()
  where id = appt_id_in
  returning * into row_out;

  return jsonb_build_object('ok', true, 'id', row_out.id);
end;
$$;

revoke all on function public.mark_balance_paid_via_webhook(text, text, text, numeric) from public;
grant execute on function public.mark_balance_paid_via_webhook(text, text, text, numeric) to service_role;

-- =====================================================================
-- mark_balance_paid_manually — keep deposit_paid intact
-- =====================================================================
create or replace function public.mark_balance_paid_manually(
  appt_id_in text,
  method_in text default 'manual',
  note_in text default null
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
  select * into row_out from public.appointments where id = appt_id_in limit 1;
  if row_out.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if row_out.user_id <> caller then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if row_out.balance_paid then
    return jsonb_build_object('ok', true, 'already_paid', true);
  end if;

  update public.appointments
  set balance_paid = true,
      balance_paid_at = now(),
      balance_payment_status = 'paid_manually',
      payment_status = 'paid',
      payment_method = coalesce(method_in, payment_method, 'manual'),
      payment_notes = coalesce(note_in, payment_notes),
      payment_date = coalesce(payment_date, current_date),
      -- deposit_paid deliberately left intact (see webhook fn above).
      balance_due = 0,
      updated_at = now()
  where id = appt_id_in
  returning * into row_out;

  return jsonb_build_object('ok', true, 'id', row_out.id);
end;
$$;

revoke all on function public.mark_balance_paid_manually(text, text, text) from public;
grant execute on function public.mark_balance_paid_manually(text, text, text) to authenticated;
