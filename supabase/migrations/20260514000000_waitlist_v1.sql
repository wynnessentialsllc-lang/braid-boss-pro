-- Waitlist V1 — Phase A.
--
-- The owner manages waitlist requests from the Stylist app.
-- Anonymous booking-page visitors can INSERT a request when no
-- openings are available for their preferred date. They cannot
-- read each other's requests (no anon SELECT policy).
--
-- Phase B will add a public availability RPC + automatic "Join
-- waitlist" prompt when slots are exhausted; Phase A wires the
-- table + the manual CTA on the public page.

create table if not exists public.waitlist_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_name text not null,
  client_phone text,
  client_email text,
  service_id uuid references public.services(id) on delete set null,
  service_name text,
  preferred_date date,
  preferred_time text,
  flexibility text check (flexibility is null or flexibility in ('anytime','morning','afternoon','evening','specific')),
  notes text,
  status text not null default 'waiting'
    check (status in ('waiting','contacted','booked','declined','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Surface-level guard: name cannot be empty after trimming.
  constraint waitlist_requests_name_not_empty check (length(trim(client_name)) > 0)
);

create index if not exists waitlist_requests_user_status_idx
  on public.waitlist_requests (user_id, status);
create index if not exists waitlist_requests_user_created_idx
  on public.waitlist_requests (user_id, created_at desc);

alter table public.waitlist_requests enable row level security;

-- Owner — full CRUD on their own requests.
drop policy if exists "waitlist_self_select" on public.waitlist_requests;
create policy "waitlist_self_select" on public.waitlist_requests
  for select using (auth.uid() = user_id);

drop policy if exists "waitlist_self_update" on public.waitlist_requests;
create policy "waitlist_self_update" on public.waitlist_requests
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "waitlist_self_delete" on public.waitlist_requests;
create policy "waitlist_self_delete" on public.waitlist_requests
  for delete using (auth.uid() = user_id);

-- Anonymous booking-page visitors can INSERT a request for any
-- user_id (it's stamped server-side via the public booking flow's
-- slug → user_id resolution). They can never SELECT, UPDATE, or
-- DELETE — those policies above gate by auth.uid().
drop policy if exists "waitlist_public_insert" on public.waitlist_requests;
create policy "waitlist_public_insert" on public.waitlist_requests
  for insert with check (true);

-- Authenticated users also need the standard self-insert policy so
-- the owner can add a manual entry from the Stylist app.
drop policy if exists "waitlist_self_insert" on public.waitlist_requests;
create policy "waitlist_self_insert" on public.waitlist_requests
  for insert with check (auth.uid() = user_id);

-- Table-level grants. Anon needs INSERT only; authenticated needs
-- SELECT + INSERT + UPDATE + DELETE (all already gated by RLS).
grant insert on public.waitlist_requests to anon;
grant select, insert, update, delete on public.waitlist_requests to authenticated;

-- =====================================================================
-- APPOINTMENTS — booking source label
-- =====================================================================
-- Tags how an appointment was created so the Stylist app can show
-- "Booked via public link" / "From waitlist" / "Manual" on the
-- profile + schedule. Optional, defaults to null (existing rows
-- read as "manual" in the UI).
alter table public.appointments
  add column if not exists source text
    check (source is null or source in ('manual','public_booking','waitlist'));

create index if not exists appointments_source_idx
  on public.appointments (user_id, source)
  where source is not null;


-- Auto-bump updated_at.
create or replace function public.waitlist_requests_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists waitlist_requests_touch on public.waitlist_requests;
create trigger waitlist_requests_touch
  before update on public.waitlist_requests
  for each row execute function public.waitlist_requests_touch_updated_at();
