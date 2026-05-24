-- Re-arm reminder + review crons when an appointment is rescheduled.
--
-- The reminder cron throttles on last_reminder_sent_at (only re-sends
-- after 12h) and the review cron stops scanning a row once
-- review_request_sent_at is non-null. If a stylist reschedules an
-- appointment after either stamp has been written for the OLD date,
-- the cron won't re-fire for the NEW date — the client either gets
-- no day-before reminder, or no review email after the new visit.
--
-- Fix: when appt_date or appt_time changes on an appointments row,
-- clear both stamps so the crons re-evaluate against the new
-- schedule. Same on booking_requests when preferred_date /
-- preferred_time change (the reminder cron reads its throttle off
-- that row).
--
-- Scope is narrow: a no-op edit (status flip, price change) leaves
-- the stamps alone; only a real reschedule re-arms them.

create or replace function public.appointments_reset_notif_stamps_on_reschedule()
returns trigger
language plpgsql
as $function$
begin
  if (NEW.appt_date is distinct from OLD.appt_date)
     or (NEW.appt_time is distinct from OLD.appt_time) then
    NEW.last_reminder_sent_at := null;
    NEW.review_request_sent_at := null;
  end if;
  return NEW;
end;
$function$;

drop trigger if exists trg_reset_notif_stamps_on_reschedule on public.appointments;
create trigger trg_reset_notif_stamps_on_reschedule
  before update on public.appointments
  for each row execute function public.appointments_reset_notif_stamps_on_reschedule();

create or replace function public.booking_requests_reset_reminder_on_reschedule()
returns trigger
language plpgsql
as $function$
begin
  if (NEW.preferred_date is distinct from OLD.preferred_date)
     or (NEW.preferred_time is distinct from OLD.preferred_time) then
    NEW.last_reminder_sent_at := null;
  end if;
  return NEW;
end;
$function$;

drop trigger if exists trg_reset_reminder_on_reschedule on public.booking_requests;
create trigger trg_reset_reminder_on_reschedule
  before update on public.booking_requests
  for each row execute function public.booking_requests_reset_reminder_on_reschedule();

notify pgrst, 'reload schema';
