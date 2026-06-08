-- Cancelling an appointment must also retire its linked booking_request.
--
-- Bug: a cancelled appointment reappeared on the schedule. Root cause —
-- cancel_appointment() flipped only the appointment to 'cancelled' and
-- left the linked booking_requests row in 'approved'/'confirmed' with its
-- appointment_id still pointing at the (now cancelled) appointment. The
-- appointment id is derived from that booking, so re-running the approval
-- flow (or any materialization) re-created/overwrote the appointment back
-- to 'scheduled' — undoing the cancel.
--
-- Fix: in the same RPC, mark any booking_request linked to the cancelled
-- appointment as approval_status='cancelled'. That matches what the
-- existing client-cancellation bridge keys off (approval_status /
-- cancelled_at), so the booking can no longer re-spawn the appointment.
-- The legacy `status` column has no 'cancelled' value (CHECK allows only
-- pending/approved/declined/converted), so it's intentionally left as-is;
-- approval_status is the source of truth everywhere downstream.
--
-- Idempotent and best-effort relative to the appointment cancel: the
-- booking update is guarded so a re-fire is a no-op, and it never changes
-- the fact that the appointment itself is cancelled.

create or replace function public.cancel_appointment(
  appt_id_in text,
  reason_in text default null,
  refund_amount_in numeric default null,
  refund_ids_in text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  caller uuid := auth.uid();
  row_out public.appointments;
  v_booking_retired boolean := false;
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

  -- Retire any booking_request linked to this appointment so a paid,
  -- still-"approved" booking can't re-materialize the appointment after
  -- it's been cancelled. Guarded for idempotency.
  update public.booking_requests
     set approval_status     = 'cancelled',
         cancelled_at        = coalesce(cancelled_at, now()),
         cancelled_by        = coalesce(cancelled_by, 'stylist'),
         cancellation_reason = coalesce(cancellation_reason, reason_in)
   where appointment_id = appt_id_in
     and user_id = caller
     and approval_status is distinct from 'cancelled';
  if found then
    v_booking_retired := true;
  end if;

  return jsonb_build_object('ok', true, 'id', row_out.id, 'booking_retired', v_booking_retired);
end;
$function$;
