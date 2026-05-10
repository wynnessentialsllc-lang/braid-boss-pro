-- Services & Styles V1 — the studio's catalog of what they offer.
--
-- This is the foundation Phase 2 will hook into (booking policies +
-- availability rules read it; the appointment form will let users
-- pick a service to prefill duration / price / deposit). Phase 1 only
-- ships the table + CRUD screen — the booking flow is unchanged.
--
-- RLS-isolated per user, mirroring the discounts table pattern.
-- Service rows snapshot is intentionally NOT denormalised onto
-- appointments yet — that comes when bookings start referencing
-- service_id. Until then a deleted service silently disappears from
-- the picker; nothing else breaks.

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  duration_hours numeric(5, 2) not null check (duration_hours > 0 and duration_hours <= 48),
  base_price numeric(10, 2) not null check (base_price >= 0),
  deposit_required boolean not null default false,
  deposit_amount numeric(10, 2) check (deposit_amount is null or deposit_amount >= 0),
  -- jsonb array of { id, name, amount } for service-level add-ons.
  -- Free-form; UI validates structure on save.
  add_ons jsonb not null default '[]'::jsonb,
  prep_instructions text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- If a deposit is required there must be an amount on file.
  constraint services_deposit_amount_when_required check (
    deposit_required = false or (deposit_amount is not null and deposit_amount > 0)
  )
);

create index if not exists services_user_active_idx
  on public.services (user_id, is_active);

alter table public.services enable row level security;

drop policy if exists "services_self_select" on public.services;
create policy "services_self_select" on public.services
  for select using (auth.uid() = user_id);

drop policy if exists "services_self_insert" on public.services;
create policy "services_self_insert" on public.services
  for insert with check (auth.uid() = user_id);

drop policy if exists "services_self_update" on public.services;
create policy "services_self_update" on public.services
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "services_self_delete" on public.services;
create policy "services_self_delete" on public.services
  for delete using (auth.uid() = user_id);

-- Table-level grants so RLS-allowed reads actually return rows.
-- Same gotcha that bit profiles + discounts.
grant select, insert, update, delete on public.services to authenticated;

-- Auto-bump updated_at.
create or replace function public.services_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists services_touch on public.services;
create trigger services_touch
  before update on public.services
  for each row
  execute function public.services_touch_updated_at();
