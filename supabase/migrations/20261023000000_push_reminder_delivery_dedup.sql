-- Durable dedup memory for in-app push reminders.
--
-- The client scheduler (app/lib/notification-scheduler.ts) decides which
-- reminder pop-ups to fire and, until now, remembered what it had already
-- delivered ONLY in the browser's localStorage. iOS evicts web-app storage
-- after a stretch of inactivity (ITP), so when the stylist re-opens the app
-- after it has sat idle the dedup memory is gone and every still-upcoming
-- reminder re-fires — the duplicate pop-ups the user reported.
--
-- This table is the authoritative "already delivered" ledger. One row per
-- (stylist, rule_id); rule_id is the scheduler's stable per-notification id
-- (e.g. "appt_48h:<appointmentId>", "today_clients:2026-06-13"). The client
-- merges this with its local cache on open and writes a row after every
-- successful dispatch, so a reminder seen once stays suppressed across app
-- restarts AND across devices.

create table if not exists public.notification_reminder_deliveries (
  user_id uuid not null references auth.users(id) on delete cascade,
  rule_id text not null,
  delivered_at timestamptz not null default now(),
  primary key (user_id, rule_id)
);

-- Pruning / recent-window lookups filter by (user_id, delivered_at).
create index if not exists notification_reminder_deliveries_user_time_idx
  on public.notification_reminder_deliveries (user_id, delivered_at desc);

alter table public.notification_reminder_deliveries enable row level security;

-- Owner-only. The ledger is purely the stylist's own delivery history;
-- no anon or cross-user access.
drop policy if exists "nrd_self_select" on public.notification_reminder_deliveries;
create policy "nrd_self_select" on public.notification_reminder_deliveries
  for select using (auth.uid() = user_id);

drop policy if exists "nrd_self_insert" on public.notification_reminder_deliveries;
create policy "nrd_self_insert" on public.notification_reminder_deliveries
  for insert with check (auth.uid() = user_id);

drop policy if exists "nrd_self_update" on public.notification_reminder_deliveries;
create policy "nrd_self_update" on public.notification_reminder_deliveries
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "nrd_self_delete" on public.notification_reminder_deliveries;
create policy "nrd_self_delete" on public.notification_reminder_deliveries
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete
  on public.notification_reminder_deliveries to authenticated;
