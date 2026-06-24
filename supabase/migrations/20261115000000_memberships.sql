-- Memberships — recurring packages (Phase 1: data model).
--
-- A membership is a package template that bills on a schedule (via a
-- Stripe subscription on the stylist's connected account) and grants its
-- visits/credit value every cycle. We deliberately extend the existing
-- package model rather than build a parallel one, so:
--   * the Settings screen shows packages + memberships in one place, and
--   * the chair-side redeem flow (redeem_package) is reused unchanged —
--     each paid cycle simply tops up a single rolling client_packages row.
--
-- Billing itself (checkout, invoice.paid grants, cancellation) is wired
-- in later phases; this migration only lays down the schema.

-- ── Template: one-time vs recurring ──────────────────────────────────
-- A 'one_time' template is today's prepaid package (unchanged default).
-- A 'recurring' template charges `price` every `billing_interval` and
-- grants `visits` / `credit_amount` each cycle.
alter table public.package_templates
  add column if not exists billing_mode text not null default 'one_time'
    check (billing_mode in ('one_time', 'recurring'));
alter table public.package_templates
  add column if not exists billing_interval text
    check (billing_interval in ('week', 'month', 'year'));
-- Cached Stripe Price for the recurring template, created lazily on the
-- stylist's connected account at first subscribe and reused thereafter.
alter table public.package_templates
  add column if not exists stripe_price_id text;

-- A recurring template must declare its interval; a one-time one must not.
alter table public.package_templates
  drop constraint if exists package_templates_billing_interval_ck;
alter table public.package_templates
  add constraint package_templates_billing_interval_ck check (
    (billing_mode = 'recurring' and billing_interval is not null)
    or (billing_mode = 'one_time' and billing_interval is null)
  );

-- Link a rolling issued package back to the membership that feeds it, so
-- a cycle top-up updates the same row instead of minting a new one.
alter table public.client_packages
  add column if not exists membership_id uuid;

-- ── Issued memberships (one per Stripe subscription) ─────────────────
create table if not exists public.client_memberships (
  id                         uuid primary key default gen_random_uuid(),
  user_id                    uuid not null references auth.users(id) on delete cascade,
  client_id                  text,            -- local client id (null until assigned)
  client_name                text,
  template_id                uuid references public.package_templates(id) on delete set null,
  name                       text not null,
  kind                       text not null check (kind in ('visits', 'credit')),
  per_cycle_visits           integer,         -- granted each cycle when kind = visits
  per_cycle_credit           numeric(10, 2),  -- granted each cycle when kind = credit
  price                      numeric(10, 2) not null default 0,   -- charged each cycle
  billing_interval           text not null default 'month'
                               check (billing_interval in ('week', 'month', 'year')),
  -- The single rolling package this membership tops up each paid cycle.
  package_id                 uuid references public.client_packages(id) on delete set null,
  -- Stripe linkage (all on the stylist's connected account).
  stripe_connect_account_id  text,
  stripe_customer_id         text,
  stripe_subscription_id     text unique,
  stripe_checkout_session_id text,
  status                     text not null default 'incomplete'
                               check (status in ('incomplete', 'active', 'past_due', 'canceled')),
  current_period_end         timestamptz,
  purchaser_name             text,
  purchaser_email            text,
  started_at                 timestamptz,
  canceled_at                timestamptz,
  created_at                 timestamptz not null default now()
);
create index if not exists client_memberships_user_idx
  on public.client_memberships (user_id, status, created_at desc);
create index if not exists client_memberships_client_idx
  on public.client_memberships (user_id, client_id);
create index if not exists client_memberships_sub_idx
  on public.client_memberships (stripe_subscription_id);

alter table public.client_memberships enable row level security;
drop policy if exists client_memberships_owner_all on public.client_memberships;
create policy client_memberships_owner_all on public.client_memberships
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.client_memberships to authenticated;

-- ── Per-cycle grant ledger (idempotent per Stripe invoice) ───────────
-- The webhook records each invoice it has granted for so a Stripe retry
-- can't double-credit a client's rolling package.
create table if not exists public.membership_invoices (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  membership_id      uuid not null references public.client_memberships(id) on delete cascade,
  stripe_invoice_id  text not null,
  amount             numeric(10, 2) not null default 0,
  visits_granted     integer not null default 0,
  credit_granted     numeric(10, 2) not null default 0,
  created_at         timestamptz not null default now(),
  unique (stripe_invoice_id)
);
create index if not exists membership_invoices_membership_idx
  on public.membership_invoices (membership_id, created_at desc);

alter table public.membership_invoices enable row level security;
drop policy if exists membership_invoices_owner_all on public.membership_invoices;
create policy membership_invoices_owner_all on public.membership_invoices
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.membership_invoices to authenticated;
