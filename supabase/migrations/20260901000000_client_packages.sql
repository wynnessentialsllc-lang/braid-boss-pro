-- Client packages (prepaid bundles) — Phase 1.
--
-- A stylist defines reusable package templates (e.g. "5 Knotless
-- Maintenance — $200"); each sale issues a client_package instance tied
-- to a client, redeemed over time. A package is either:
--   * kind 'visits' — a count of visits (remaining_visits), one redeemed
--     per appointment, or
--   * kind 'credit' — a prepaid dollar balance, drawn down by amount.
--
-- Packages live in the cloud (not the local client store) so an online
-- purchase webhook can issue them too (Phase 2). Redemptions are an
-- idempotent ledger so a double-tap / replay can't double-decrement.

-- ── Templates ────────────────────────────────────────────────────────
create table if not exists public.package_templates (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  kind          text not null check (kind in ('visits', 'credit')),
  visits        integer,
  credit_amount numeric(10, 2),
  price         numeric(10, 2) not null default 0,
  service_label text,
  active        boolean not null default true,
  sort          integer not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists package_templates_user_idx
  on public.package_templates (user_id, sort, created_at);

alter table public.package_templates enable row level security;
drop policy if exists package_templates_owner_all on public.package_templates;
create policy package_templates_owner_all on public.package_templates
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.package_templates to authenticated;

-- ── Issued packages ──────────────────────────────────────────────────
create table if not exists public.client_packages (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  client_id        text,             -- local client id (null until assigned)
  client_name      text,
  template_id      uuid references public.package_templates(id) on delete set null,
  name             text not null,
  kind             text not null check (kind in ('visits', 'credit')),
  total_visits     integer,
  remaining_visits integer,
  initial_amount   numeric(10, 2),
  balance          numeric(10, 2),
  price            numeric(10, 2) not null default 0,
  service_label    text,
  status           text not null default 'active' check (status in ('active', 'depleted', 'void')),
  source           text not null default 'manual' check (source in ('manual', 'online')),
  purchaser_email  text,
  notes            text,
  purchased_at     timestamptz not null default now(),
  created_at       timestamptz not null default now()
);
create index if not exists client_packages_user_idx
  on public.client_packages (user_id, status, created_at desc);
create index if not exists client_packages_client_idx
  on public.client_packages (user_id, client_id);

alter table public.client_packages enable row level security;
drop policy if exists client_packages_owner_all on public.client_packages;
create policy client_packages_owner_all on public.client_packages
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.client_packages to authenticated;

-- ── Redemption ledger (idempotent per appointment) ──────────────────
create table if not exists public.package_redemptions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  package_id     uuid not null references public.client_packages(id) on delete cascade,
  appointment_id text,
  visits_used    integer not null default 0,
  amount_used    numeric(10, 2) not null default 0,
  created_at     timestamptz not null default now()
);
-- One redemption per package per appointment. appointment_id NULL (a
-- manual, non-appointment redemption) is exempt — Postgres treats NULLs
-- as distinct, so those never collide.
create unique index if not exists package_redemptions_appt_uidx
  on public.package_redemptions (package_id, appointment_id)
  where appointment_id is not null;
create index if not exists package_redemptions_pkg_idx
  on public.package_redemptions (package_id, created_at);

alter table public.package_redemptions enable row level security;
drop policy if exists package_redemptions_owner_all on public.package_redemptions;
create policy package_redemptions_owner_all on public.package_redemptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.package_redemptions to authenticated;

-- ── Redemption RPC ───────────────────────────────────────────────────
-- Atomically draws down a package and records the ledger row. Idempotent
-- per (package, appointment): a repeat for the same appointment is a
-- no-op that returns the current state.
create or replace function public.redeem_package(
  package_id_in     uuid,
  appointment_id_in text default null,
  visits_in         integer default 1,
  amount_in         numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pkg public.client_packages%rowtype;
  v_visits int;
  v_amount numeric;
  v_new_status text;
begin
  select * into pkg from public.client_packages
   where id = package_id_in and user_id = auth.uid()
   for update;
  if pkg.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if pkg.status <> 'active' then
    return jsonb_build_object('ok', false, 'reason', 'inactive');
  end if;

  -- Idempotency: if this appointment already redeemed this package,
  -- return current state without decrementing again.
  if appointment_id_in is not null and exists (
    select 1 from public.package_redemptions
     where package_id = pkg.id and appointment_id = appointment_id_in
  ) then
    return jsonb_build_object('ok', true, 'duplicate', true,
      'remaining_visits', pkg.remaining_visits, 'balance', pkg.balance, 'status', pkg.status);
  end if;

  if pkg.kind = 'visits' then
    v_visits := greatest(1, coalesce(visits_in, 1));
    if coalesce(pkg.remaining_visits, 0) < v_visits then
      return jsonb_build_object('ok', false, 'reason', 'insufficient_visits',
        'remaining_visits', pkg.remaining_visits);
    end if;
    update public.client_packages
       set remaining_visits = remaining_visits - v_visits,
           status = case when remaining_visits - v_visits <= 0 then 'depleted' else status end
     where id = pkg.id
     returning remaining_visits, status into pkg.remaining_visits, v_new_status;
    insert into public.package_redemptions (user_id, package_id, appointment_id, visits_used)
      values (auth.uid(), pkg.id, appointment_id_in, v_visits);
    return jsonb_build_object('ok', true, 'remaining_visits', pkg.remaining_visits, 'status', v_new_status);
  else
    v_amount := round(greatest(0, coalesce(amount_in, 0))::numeric, 2);
    if v_amount <= 0 then
      return jsonb_build_object('ok', false, 'reason', 'no_amount');
    end if;
    if coalesce(pkg.balance, 0) < v_amount then
      return jsonb_build_object('ok', false, 'reason', 'insufficient_balance', 'balance', pkg.balance);
    end if;
    update public.client_packages
       set balance = balance - v_amount,
           status = case when balance - v_amount <= 0 then 'depleted' else status end
     where id = pkg.id
     returning balance, status into pkg.balance, v_new_status;
    insert into public.package_redemptions (user_id, package_id, appointment_id, amount_used)
      values (auth.uid(), pkg.id, appointment_id_in, v_amount);
    return jsonb_build_object('ok', true, 'balance', pkg.balance, 'status', v_new_status);
  end if;
end;
$$;

revoke all on function public.redeem_package(uuid, text, integer, numeric) from public;
grant execute on function public.redeem_package(uuid, text, integer, numeric) to authenticated;
