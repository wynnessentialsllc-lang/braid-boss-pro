-- Phase 2 — Booking Policies + Availability infrastructure.
--
-- booking_policies (1 row per user) carries the calm calendar-side
-- copy users surface to clients (deposit, cancellation, late, etc).
-- availability_rules holds the recurring weekly hours; one row per
-- weekday per user (or none → unavailable that day).
-- availability_exceptions covers one-off overrides: blocked time,
-- a one-time custom hours change, or a vacation range.
--
-- Every table is RLS-isolated per user with explicit table-level
-- grants (same gotcha that bit profiles + discounts).

-- =====================================================================
-- BOOKING POLICIES
-- =====================================================================
create table if not exists public.booking_policies (
  user_id uuid primary key references auth.users(id) on delete cascade,
  deposit_policy text,
  cancellation_window_hours integer check (cancellation_window_hours is null or cancellation_window_hours >= 0),
  cancellation_policy text,
  late_arrival_policy text,
  no_show_policy text,
  hair_prep_instructions text,
  guests_policy text,
  reschedule_policy text,
  custom_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.booking_policies enable row level security;

drop policy if exists "booking_policies_self_select" on public.booking_policies;
create policy "booking_policies_self_select" on public.booking_policies
  for select using (auth.uid() = user_id);

drop policy if exists "booking_policies_self_insert" on public.booking_policies;
create policy "booking_policies_self_insert" on public.booking_policies
  for insert with check (auth.uid() = user_id);

drop policy if exists "booking_policies_self_update" on public.booking_policies;
create policy "booking_policies_self_update" on public.booking_policies
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "booking_policies_self_delete" on public.booking_policies;
create policy "booking_policies_self_delete" on public.booking_policies
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on public.booking_policies to authenticated;

create or replace function public.booking_policies_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists booking_policies_touch on public.booking_policies;
create trigger booking_policies_touch
  before update on public.booking_policies
  for each row execute function public.booking_policies_touch_updated_at();


-- =====================================================================
-- AVAILABILITY RULES — recurring weekly hours
-- =====================================================================
-- weekday: 0 = Sunday … 6 = Saturday (matches JS Date.getDay()).
-- Hours are stored as text "HH:mm" so the UI doesn't fight timezones.
-- Optional break window subtracts a single mid-day chunk; richer
-- break-modeling can come later by promoting this to a separate
-- availability_breaks table. For V1 one break per day covers most
-- studios.
create table if not exists public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time text not null,
  end_time text not null,
  break_start text,
  break_end text,
  is_open boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One canonical row per user/day. Updates upsert against this.
  unique (user_id, weekday)
);

create index if not exists availability_rules_user_idx
  on public.availability_rules (user_id);

alter table public.availability_rules enable row level security;

drop policy if exists "availability_rules_self_select" on public.availability_rules;
create policy "availability_rules_self_select" on public.availability_rules
  for select using (auth.uid() = user_id);

drop policy if exists "availability_rules_self_insert" on public.availability_rules;
create policy "availability_rules_self_insert" on public.availability_rules
  for insert with check (auth.uid() = user_id);

drop policy if exists "availability_rules_self_update" on public.availability_rules;
create policy "availability_rules_self_update" on public.availability_rules
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "availability_rules_self_delete" on public.availability_rules;
create policy "availability_rules_self_delete" on public.availability_rules
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on public.availability_rules to authenticated;

create or replace function public.availability_rules_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists availability_rules_touch on public.availability_rules;
create trigger availability_rules_touch
  before update on public.availability_rules
  for each row execute function public.availability_rules_touch_updated_at();


-- =====================================================================
-- AVAILABILITY EXCEPTIONS — one-time overrides
-- =====================================================================
-- kind:
--   'off'      → the day(s) are closed, regardless of weekly rule
--   'custom'   → custom open/close hours that override the weekly rule
--   'blocked'  → a specific time window inside an open day is blocked
-- Date range is inclusive; for single-day exceptions start_date = end_date.
create table if not exists public.availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('off', 'custom', 'blocked')),
  start_date date not null,
  end_date date not null,
  start_time text,
  end_time text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint availability_exceptions_dates_ordered check (end_date >= start_date),
  constraint availability_exceptions_custom_needs_times check (
    kind <> 'custom' or (start_time is not null and end_time is not null)
  ),
  constraint availability_exceptions_blocked_needs_times check (
    kind <> 'blocked' or (start_time is not null and end_time is not null)
  )
);

create index if not exists availability_exceptions_user_date_idx
  on public.availability_exceptions (user_id, start_date, end_date);

alter table public.availability_exceptions enable row level security;

drop policy if exists "availability_exceptions_self_select" on public.availability_exceptions;
create policy "availability_exceptions_self_select" on public.availability_exceptions
  for select using (auth.uid() = user_id);

drop policy if exists "availability_exceptions_self_insert" on public.availability_exceptions;
create policy "availability_exceptions_self_insert" on public.availability_exceptions
  for insert with check (auth.uid() = user_id);

drop policy if exists "availability_exceptions_self_update" on public.availability_exceptions;
create policy "availability_exceptions_self_update" on public.availability_exceptions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "availability_exceptions_self_delete" on public.availability_exceptions;
create policy "availability_exceptions_self_delete" on public.availability_exceptions
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on public.availability_exceptions to authenticated;

create or replace function public.availability_exceptions_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists availability_exceptions_touch on public.availability_exceptions;
create trigger availability_exceptions_touch
  before update on public.availability_exceptions
  for each row execute function public.availability_exceptions_touch_updated_at();


-- =====================================================================
-- APPOINTMENTS — soft FK to the service catalog
-- =====================================================================
-- Optional reference back to the row in `services` that an appointment
-- was booked against. Nullable; old rows stay untouched. ON DELETE
-- SET NULL so removing a service from the catalog doesn't cascade
-- delete history.
alter table public.appointments
  add column if not exists service_id uuid references public.services(id) on delete set null;

create index if not exists appointments_service_id_idx
  on public.appointments (service_id);
