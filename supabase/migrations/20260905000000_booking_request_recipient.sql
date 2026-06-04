-- Public booking: capture who the appointment is for (self vs someone
-- else, e.g. a parent booking for their child).
--
-- The booking page asks "Who's this appointment for?" and, when it's
-- someone else, captures a recipient name (+ optional note like age).
-- Stored on the booking_request and carried onto the appointment as the
-- dependent on approval (pairs with the stylist-side family profiles).
--
-- booked_for_name NULL/empty = booked for the client themselves.
--
-- Mirrors the existing post-submit "attach" RPCs
-- (public_attach_booking_customization): the anon booking page can't
-- update booking_requests directly, so a SECURITY DEFINER wrapper sets
-- the recipient by the server-returned (unguessable) request id.

alter table public.booking_requests
  add column if not exists booked_for_name text,
  add column if not exists booked_for_note text;

create or replace function public.public_attach_booking_recipient(
  request_id_in       uuid,
  booked_for_name_in  text default null,
  booked_for_note_in  text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected int;
begin
  if request_id_in is null then return false; end if;

  update public.booking_requests
  set booked_for_name = nullif(left(trim(coalesce(booked_for_name_in, '')), 120), ''),
      booked_for_note = nullif(left(trim(coalesce(booked_for_note_in, '')), 200), ''),
      updated_at = now()
  where id = request_id_in;

  get diagnostics affected = row_count;
  return affected > 0;
end $$;

revoke all on function public.public_attach_booking_recipient(uuid, text, text) from public;
grant execute on function public.public_attach_booking_recipient(uuid, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
