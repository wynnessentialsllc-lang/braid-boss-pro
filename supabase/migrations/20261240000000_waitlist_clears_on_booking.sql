-- Book someone in, and their waitlist request stops asking for attention.
--
-- The Waitlist screen's own "Convert to appointment" button already
-- flips the request to 'booked' and links the appointment. But that's
-- one of several ways a braider actually books a waitlist client:
-- she might type the appointment straight into the schedule, approve
-- their booking request, or take it over the phone. Every one of those
-- leaves the request sitting in 'waiting', looking like unfinished
-- work, until she goes and archives it by hand.
--
-- This closes that by watching the appointments table itself, so it
-- covers every path in and any future one.
--
-- Matching is on contact details, not name: phone digits or a
-- lowercased email. Names repeat between clients; a phone number
-- doesn't. A request with neither is left alone rather than guessed at.
--
-- The date rule is the careful part. Booking someone for the day they
-- asked about — or any day after — settles the request. Booking them
-- for something EARLIER does not: a client waiting on an October date
-- who comes in for a September touch-up still wants October, and
-- silently clearing that would drop them from the release-day alert
-- they joined for.
--
-- Marked 'booked' rather than deleted, so the waitlist conversion rate
-- in Booking intelligence still counts them.

begin;

create or replace function public.appointments_settle_waitlist()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_phone text;
  v_email text;
begin
  -- Real, live, future appointments only. A cancelled booking or a
  -- calendar block settles nothing.
  if coalesce(NEW.kind, 'appointment') <> 'appointment' then
    return NEW;
  end if;
  if lower(coalesce(NEW.status, '')) in ('cancelled', 'canceled', 'declined', 'no-show', 'no_show', 'noshow') then
    return NEW;
  end if;
  if NEW.appt_date is null or NEW.appt_date < current_date then
    return NEW;
  end if;

  -- Digits only, last 10, so (415) 555-0111 and +14155550111 match.
  v_phone := nullif(right(regexp_replace(coalesce(NEW.client_phone, ''), '\D', '', 'g'), 10), '');
  v_email := nullif(lower(trim(coalesce(NEW.client_email, ''))), '');

  if v_phone is null and v_email is null then
    return NEW;
  end if;

  update public.waitlist_requests w
     set status = 'booked',
         converted_appointment_id = coalesce(w.converted_appointment_id, NEW.id),
         updated_at = now()
   where w.user_id = NEW.user_id
     and w.status in ('waiting', 'contacted')
     and (
       (v_phone is not null
        and nullif(right(regexp_replace(coalesce(w.client_phone, ''), '\D', '', 'g'), 10), '') = v_phone)
       or
       (v_email is not null
        and nullif(lower(trim(coalesce(w.client_email, ''))), '') = v_email)
     )
     -- They asked for no particular day, or this booking is on/after
     -- the day they wanted. An earlier appointment leaves it standing.
     and (w.preferred_date is null or NEW.appt_date >= w.preferred_date);

  return NEW;
exception when others then
  return NEW;  -- never let this get between a braider and a booking
end;
$$;

-- Fires on the booking being made and on one being revived (a
-- reschedule out of cancelled, a status correction), so a request is
-- settled whichever way the appointment arrives.
drop trigger if exists trg_appointments_settle_waitlist on public.appointments;
create trigger trg_appointments_settle_waitlist
  after insert or update of status, appt_date, client_phone, client_email
  on public.appointments
  for each row execute function public.appointments_settle_waitlist();

commit;
