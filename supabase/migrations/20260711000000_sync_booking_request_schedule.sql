-- When a stylist reschedules via Edit Appointment, the appointments
-- row is updated but the linked booking_request was left stale —
-- the client portal (public_get_booking_portal_state) reads
-- preferred_date/preferred_time off booking_requests, so "View
-- appointment details" showed the OLD time. This owner-scoped RPC
-- propagates the new schedule to the linked request.
create or replace function public.sync_booking_request_schedule(
  appointment_id_in text,
  new_date date,
  new_time text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  n int;
begin
  if uid is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;
  if appointment_id_in is null or trim(appointment_id_in) = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_appointment_id');
  end if;
  update public.booking_requests
    set preferred_date = new_date,
        preferred_time = nullif(trim(coalesce(new_time, '')), ''),
        updated_at = now()
  where appointment_id = appointment_id_in
    and user_id = uid;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'updated', n);
end;
$$;

revoke all on function public.sync_booking_request_schedule(text, date, text) from public;
grant execute on function public.sync_booking_request_schedule(text, date, text) to authenticated;

notify pgrst, 'reload schema';
