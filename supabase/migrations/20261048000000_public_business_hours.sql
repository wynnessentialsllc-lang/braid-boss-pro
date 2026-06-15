-- Public business hours for the booking concierge.
--
-- The booking-page chat assistant ("Ask Sheree's assistant") could talk
-- about the catalog, policy, and the next few open *dates*, but it had no
-- view of the recurring weekly schedule — so questions like "what are your
-- hours?", "what days are you open?", or "are you open on Saturdays?" got
-- deflected to the calendar instead of a real answer.
--
-- This adds a tiny security-definer RPC the public booking page can call
-- anonymously to read the stylist's weekly hours of operation. It exposes
-- ONLY the recurring schedule (weekday + open flag + window + break) — no
-- appointments, no client data, no exceptions — so it's safe for anon.
--
-- Source table: availability_rules (one canonical row per weekday).

create or replace function public.public_get_business_hours(
  slug_in text
)
returns table (
  weekday smallint,        -- 0 = Sunday … 6 = Saturday
  is_open boolean,
  start_time text,         -- "HH:mm"
  end_time text,           -- "HH:mm"
  break_start text,        -- "HH:mm" or null
  break_end text           -- "HH:mm" or null
)
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
begin
  -- Resolve slug → owner (same gate the other public RPCs use).
  select user_id into owner_id
  from public.booking_links
  where slug = slug_in and active = true
  limit 1;

  if owner_id is null then
    return;
  end if;

  return query
  select
    r.weekday::smallint,
    r.is_open,
    r.start_time,
    r.end_time,
    r.break_start,
    r.break_end
  from public.availability_rules r
  where r.user_id = owner_id
  order by r.weekday asc;
end;
$$;

revoke all on function public.public_get_business_hours(text) from public;
grant execute on function public.public_get_business_hours(text) to anon;
grant execute on function public.public_get_business_hours(text) to authenticated;
