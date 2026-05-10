-- Calendar item kinds. The same `appointments` table now also carries
-- two new types of calendar entries:
--   - personal: personal events (lunch, errand, school) shown as
--     neutral blocks; not counted in revenue.
--   - blocked: time the stylist is unavailable; rendered as
--     "Unavailable" on the calendar.
--
-- Default 'appointment' so every existing row remains a real booking
-- and every revenue / deposit aggregation that filters on
-- kind = 'appointment' works the same as before.

alter table public.appointments
  add column if not exists kind text not null default 'appointment'
    check (kind in ('appointment', 'personal', 'blocked'));

create index if not exists appointments_kind_idx
  on public.appointments (user_id, kind);
