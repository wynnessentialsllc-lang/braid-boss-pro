-- Reject public booking submissions that don't include both a date
-- and a time.
--
-- The /book/<slug> form now validates client-side, but the public
-- submit RPC accepts both as nullable defaults. A bug, a stale
-- client, or a direct RPC call could still insert a request without
-- a time — and that puts the stylist in the impossible spot of
-- approving an appointment that has no slot. This trigger is the
-- belt-and-suspenders server-side guard: any public submission
-- missing date or time gets rejected with a clear message.
--
-- Scope:
--   * Only fires on rows where created_from_public = true. Manual
--     stylist-created bookings + legacy data are left alone — the
--     stylist can already create internal placeholders without a
--     time when needed.
--   * Fires on INSERT only. Updates are unaffected so the stylist
--     can edit a request that somehow already landed without a time
--     (manual cleanup path).

create or replace function public.fn_require_public_booking_datetime()
returns trigger
language plpgsql
as $$
begin
  if new.created_from_public is true
     and (new.preferred_date is null
          or new.preferred_time is null
          or trim(new.preferred_time) = '') then
    raise exception 'Please pick a date and time before submitting your booking.'
      using errcode = '22023';
  end if;
  return new;
end $$;

drop trigger if exists trg_booking_requests_require_datetime
  on public.booking_requests;
create trigger trg_booking_requests_require_datetime
  before insert on public.booking_requests
  for each row execute function public.fn_require_public_booking_datetime();
