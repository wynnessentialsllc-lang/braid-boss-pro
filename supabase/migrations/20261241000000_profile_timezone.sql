-- Store each stylist's IANA timezone on their profile.
--
-- Needed by the off-device notification sweep (see
-- 20261242000000_notification_rules_cron.sql). The rule generators in
-- app/lib/notification-rules.ts build appointment start times with
-- `new Date(y, m - 1, d, hh, mm)` — the PROCESS's local timezone. In the
-- browser that is the stylist's own phone, so a booking stored as the wall
-- clock "14:00" is read correctly. A server process runs in UTC and reads
-- the same booking as 2 PM UTC, which is 9 AM Eastern — a "starts soon"
-- push would fire roughly five hours early.
--
-- Nothing in the schema recorded a timezone before this: appointments.timezone
-- is NULL on every row and settings.data->'business' has no such key. So the
-- sweep has no way to know when a booking actually happens until this column
-- is populated.
--
-- The app writes it on load from Intl.DateTimeFormat().resolvedOptions(),
-- so existing users are filled in the next time they open the app. Until
-- then the column is NULL and the sweep SKIPS that user rather than
-- assuming UTC — no notification is better than one at the wrong hour.

alter table public.profiles
  add column if not exists timezone text;

comment on column public.profiles.timezone is
  'IANA timezone (e.g. America/New_York), written by the client from '
  'Intl.DateTimeFormat().resolvedOptions().timeZone. Used by the '
  'notification rules sweep to interpret stored wall-clock appointment '
  'times. NULL means "unknown" — the sweep skips the user.';

-- Partial index: the sweep selects users that HAVE a timezone, and that set
-- is the minority until clients have checked in.
create index if not exists profiles_timezone_present_idx
  on public.profiles (id)
  where timezone is not null;
