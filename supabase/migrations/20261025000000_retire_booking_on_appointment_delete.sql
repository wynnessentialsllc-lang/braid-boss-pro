-- "Delete permanently" must also retire the appointment's booking_request.
--
-- Cancelling an appointment (status='cancelled') already retires the linked
-- booking via cancel_appointment() (see 20261003000000). But the separate
-- "Delete permanently" path removes the appointment row entirely: the client
-- deletes it locally, and the push-sync diff issues a DELETE against
-- public.appointments. Nothing touches the booking_request, so it stays
-- approval_status='approved'/'confirmed' with appointment_id pointing at a row
-- that no longer exists. That orphan keeps matching the reminder scans and the
-- client gets reminders for an appointment that's gone.
--
-- 20261024000000 hardened the reminder functions to skip such orphans, but the
-- data itself is still inconsistent. This migration:
--   1. Adds retire_booking_for_deleted_appointment(), called by the app right
--      before it permanently deletes an appointment, to mark the linked
--      booking cancelled. Mirrors the booking-retire block in
--      cancel_appointment(): only approval_status / cancelled_at /
--      cancelled_by / cancellation_reason move; the legacy CHECK-constrained
--      `status` column is left untouched. Guarded for idempotency.
--   2. Back-fills existing orphans: any approved/confirmed, not-yet-cancelled
--      booking whose appointment_id points at a missing appointments row.

create or replace function public.retire_booking_for_deleted_appointment(
  appt_id_in text,
  reason_in text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  caller uuid := auth.uid();
  v_retired int := 0;
begin
  if caller is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;
  if appt_id_in is null or trim(appt_id_in) = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_id');
  end if;

  update public.booking_requests
     set approval_status     = 'cancelled',
         cancelled_at        = coalesce(cancelled_at, now()),
         cancelled_by        = coalesce(cancelled_by, 'stylist'),
         cancellation_reason = coalesce(
           cancellation_reason,
           nullif(trim(coalesce(reason_in, '')), ''),
           'Appointment deleted from schedule'
         ),
         updated_at          = now()
   where appointment_id = appt_id_in
     and user_id = caller
     and approval_status is distinct from 'cancelled';
  get diagnostics v_retired = row_count;

  return jsonb_build_object('ok', true, 'retired', v_retired);
end;
$function$;

revoke all on function public.retire_booking_for_deleted_appointment(text, text) from public;
grant execute on function public.retire_booking_for_deleted_appointment(text, text) to authenticated, service_role;

-- ---- One-time back-fill of existing orphans -----------------------
-- Retire every still-active booking whose linked appointment row is gone.
-- After this runs the rows are cancelled, so a re-run matches nothing.
update public.booking_requests br
   set approval_status     = 'cancelled',
       cancelled_at        = coalesce(br.cancelled_at, now()),
       cancelled_by        = coalesce(br.cancelled_by, 'stylist'),
       cancellation_reason = coalesce(br.cancellation_reason, 'Appointment deleted from schedule'),
       updated_at          = now()
 where br.approval_status in ('approved', 'confirmed')
   and br.cancelled_at is null
   and br.appointment_id is not null
   and not exists (
     select 1 from public.appointments a where a.id = br.appointment_id
   );

notify pgrst, 'reload schema';
