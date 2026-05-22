-- Loyalty points — V1.
--
-- Per-visit points. A client's EARNED points are derived, not
-- stored: earned = (completed/paid appointment count) x
-- points_per_visit, computed app-side from appointment history the
-- app already holds. That removes any earning hook / double-award
-- risk. The only persisted state is the program config and the
-- redemptions ledger; available = earned - sum(points redeemed).

-- ---------------------------------------------------------------
-- loyalty_settings — one row per stylist (the program config).
-- ---------------------------------------------------------------
create table if not exists public.loyalty_settings (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  enabled          boolean not null default false,
  -- Points a client earns per completed visit.
  points_per_visit integer not null default 10
                     check (points_per_visit between 1 and 1000),
  -- Points needed to redeem one reward.
  reward_points    integer not null default 100
                     check (reward_points between 1 and 100000),
  -- Dollar value of one reward.
  reward_value     numeric(10,2) not null default 10
                     check (reward_value > 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.loyalty_settings enable row level security;
drop policy if exists loyalty_settings_owner_all on public.loyalty_settings;
create policy loyalty_settings_owner_all on public.loyalty_settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------
-- loyalty_redemptions — append-only ledger of redeemed rewards.
-- A client's available balance = earned - sum(points_spent here).
-- ---------------------------------------------------------------
create table if not exists public.loyalty_redemptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  client_id    text not null,
  points_spent integer not null check (points_spent > 0),
  reward_value numeric(10,2) not null check (reward_value >= 0),
  note         text,
  redeemed_at  timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create index if not exists loyalty_redemptions_user_client_idx
  on public.loyalty_redemptions (user_id, client_id);

alter table public.loyalty_redemptions enable row level security;
drop policy if exists loyalty_redemptions_owner_all on public.loyalty_redemptions;
create policy loyalty_redemptions_owner_all on public.loyalty_redemptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
