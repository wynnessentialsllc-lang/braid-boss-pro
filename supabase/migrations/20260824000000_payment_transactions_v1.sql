-- Payments & Transactions V1 — a durable ledger row for every payment
-- the stylist collects that ISN'T already represented by an
-- appointment's deposit/balance columns or a live Stripe charge.
--
-- In practice this table is the home for MANUAL transactions — Cash,
-- Zelle, Cash App, Venmo — plus any one-off correction the stylist
-- records by hand. Stripe charges are pulled live from the connected
-- account (see /api/stripe-connect/transactions) and appointment
-- deposits/balances are derived from the appointments table, so those
-- two sources stay canonical where they live. This table only stores
-- what nothing else owns.
--
-- Same sync shape as the rest of the app (`user_id uuid + id text`
-- composite PK, free-form `data jsonb`) so the existing
-- toCloudRow/fromCloudRow pipeline carries it without special-casing.

create table if not exists public.payment_transactions (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  -- Optional link back to the appointment this payment settles, so the
  -- Payments page can reconcile manual cash against a booking.
  appointment_id text,
  client_id text,
  client_name text,
  service_name text,
  -- Positive for collections, negative for refunds. Stored in the
  -- currency's major unit (dollars), matching the rest of the app.
  amount numeric(12, 2) not null default 0,
  tip_amount numeric(12, 2) not null default 0,
  -- 'deposit' | 'final' | 'full' | 'refund'
  payment_type text not null default 'full',
  -- 'cash' | 'zelle' | 'cashapp' | 'venmo' | 'stripe' | 'other'
  payment_method text not null default 'cash',
  paid_at timestamptz not null default now(),
  note text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists payment_transactions_user_paid_idx
  on public.payment_transactions (user_id, paid_at desc);

create index if not exists payment_transactions_user_appt_idx
  on public.payment_transactions (user_id, appointment_id)
  where appointment_id is not null;

alter table public.payment_transactions enable row level security;

drop policy if exists "payment_transactions_self_select" on public.payment_transactions;
create policy "payment_transactions_self_select" on public.payment_transactions
  for select using (auth.uid() = user_id);

drop policy if exists "payment_transactions_self_insert" on public.payment_transactions;
create policy "payment_transactions_self_insert" on public.payment_transactions
  for insert with check (auth.uid() = user_id);

drop policy if exists "payment_transactions_self_update" on public.payment_transactions;
create policy "payment_transactions_self_update" on public.payment_transactions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "payment_transactions_self_delete" on public.payment_transactions;
create policy "payment_transactions_self_delete" on public.payment_transactions
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on public.payment_transactions to authenticated;

create or replace function public.payment_transactions_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists payment_transactions_touch on public.payment_transactions;
create trigger payment_transactions_touch
  before update on public.payment_transactions
  for each row
  execute function public.payment_transactions_touch_updated_at();
