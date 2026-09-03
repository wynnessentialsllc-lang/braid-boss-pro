-- Multi-day / split appointments: a single logical booking (e.g. a long
-- braid install started one day and finished the next) made of two or
-- more appointment rows that share one group id, instead of inventing a
-- new "one row spans two dates" primitive.
--
-- Why linked rows instead of an end_date column: every calendar/revenue/
-- reminder query in this app (Schedule day view, computeDashboardRevenue,
-- weekClientRows, the SMS reminder cron) is keyed to a single appt_date
-- per row. Reusing that — one row per calendar day the booking touches —
-- means none of that code needs to change; each session shows on its own
-- day, gets its own reminder, and (per the app's existing PATCH-style
-- appointment save) carries its own normal deposit/balance/status fields.
-- The app is responsible for how money is split across the linked rows
-- (see app/AppRoot.tsx's AppointmentSheet: session 1 carries the full
-- price/deposit, later sessions are $0 calendar placeholders), same as
-- it already is for a single appointment's totalPrice/depositPaid.
--
-- Deliberately a separate column from series_id: series_id links
-- independent, identically-priced, repeating occurrences (a weekly
-- retwist); multi_day_group_id links sessions of the SAME booking. A
-- booking could in principle be both someday (a recurring 2-day
-- service) without the two concepts colliding.
--
-- multi_day_session_label ("Day 1 of 2") is deliberately NOT a promoted
-- column here — it's display-only copy, generated once at creation and
-- stored in the existing `data` jsonb like most other appointment
-- fields, so no schema change is needed for it.

alter table public.appointments
  add column if not exists multi_day_group_id text;

create index if not exists idx_appointments_multi_day_group
  on public.appointments (user_id, multi_day_group_id)
  where multi_day_group_id is not null;
