-- Discounts V1 — fixed amount or percentage off, optionally tied to a
-- specific service (column lands now; UI in V1 only exposes the
-- "applies to all" path because the app has no first-class services
-- table yet — appointment.style is a free-text string).
--
-- Each discount belongs to one user (RLS-isolated). A finalised
-- quote/appointment may reference a discount; the existing rows get
-- nullable columns so historical records aren't disturbed.

create table if not exists public.discounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  discount_type text not null check (discount_type in ('fixed', 'percentage')),
  value numeric(10, 2) not null check (value >= 0),
  applies_to text not null default 'all' check (applies_to in ('all', 'service')),
  service_id uuid,
  is_active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  usage_limit integer check (usage_limit is null or usage_limit > 0),
  times_used integer not null default 0 check (times_used >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Percentage values must fall in (0, 100]; fixed must be > 0.
  constraint discounts_value_in_range check (
    (discount_type = 'percentage' and value > 0 and value <= 100)
    or (discount_type = 'fixed' and value > 0)
  ),
  constraint discounts_dates_ordered check (
    starts_at is null or ends_at is null or ends_at > starts_at
  ),
  constraint discounts_service_required check (
    applies_to <> 'service' or service_id is not null
  )
);

create index if not exists discounts_user_active_idx
  on public.discounts (user_id, is_active);

-- RLS: every user only ever sees / mutates their own discounts.
alter table public.discounts enable row level security;

drop policy if exists "discounts_self_select" on public.discounts;
create policy "discounts_self_select" on public.discounts
  for select using (auth.uid() = user_id);

drop policy if exists "discounts_self_insert" on public.discounts;
create policy "discounts_self_insert" on public.discounts
  for insert with check (auth.uid() = user_id);

drop policy if exists "discounts_self_update" on public.discounts;
create policy "discounts_self_update" on public.discounts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "discounts_self_delete" on public.discounts;
create policy "discounts_self_delete" on public.discounts
  for delete using (auth.uid() = user_id);

-- Make sure SELECT/INSERT/UPDATE/DELETE table privileges exist for
-- the authenticated role. Without these, RLS would allow but the
-- table-level permission would block — same gotcha that bit profiles.
grant select, insert, update, delete on public.discounts to authenticated;

-- Auto-bump updated_at.
create or replace function public.discounts_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists discounts_touch on public.discounts;
create trigger discounts_touch
  before update on public.discounts
  for each row
  execute function public.discounts_touch_updated_at();

-- Quote + appointment line-item columns. Optional and nullable so old
-- rows continue to load. Values are denormalised snapshots of the
-- discount at the time the quote/appointment was finalised — that
-- way deleting a discount later doesn't re-price historical work.
alter table public.quotes
  add column if not exists discount_id uuid,
  add column if not exists discount_name text,
  add column if not exists discount_amount numeric(10, 2);

alter table public.appointments
  add column if not exists discount_id uuid,
  add column if not exists discount_name text,
  add column if not exists discount_amount numeric(10, 2);
