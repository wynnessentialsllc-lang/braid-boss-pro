-- Founding Stylist Access auto-claim infrastructure.
--
-- Three pieces:
--   1. founding_access_orders table — one row per Stripe Checkout
--      Session. Inserted pending by /api/founding-checkout; flipped
--      to paid by the webhook on checkout.session.completed.
--   2. profiles.founding_access boolean + profiles.founding_paid_at
--      — set when a sign-up's email matches a paid order.
--   3. mark_founding_order_paid (webhook) + claim_founding_access_for_user
--      (signup) RPCs — both security-definer + idempotent.

create table if not exists public.founding_access_orders (
  id uuid primary key default gen_random_uuid(),
  stripe_session_id text unique,
  stripe_payment_intent text,
  customer_email text,
  amount_cents integer not null default 999,
  currency text not null default 'usd',
  status text not null default 'pending'
    check (status in ('pending','paid','failed','refunded')),
  claimed_by_user_id uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  paid_at timestamptz,
  refunded_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists founding_access_orders_email_idx
  on public.founding_access_orders (lower(customer_email), status);
create index if not exists founding_access_orders_session_idx
  on public.founding_access_orders (stripe_session_id);
create index if not exists founding_access_orders_claimed_idx
  on public.founding_access_orders (claimed_by_user_id);

alter table public.founding_access_orders enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname='public'
      and tablename='founding_access_orders'
      and policyname='founding_access_orders_owner_select'
  ) then
    create policy founding_access_orders_owner_select
      on public.founding_access_orders
      for select to authenticated
      using (claimed_by_user_id = auth.uid());
  end if;
end $$;

alter table public.profiles
  add column if not exists founding_access boolean not null default false,
  add column if not exists founding_paid_at timestamptz;

create or replace function public.mark_founding_order_paid(
  session_id_in text,
  payment_intent_in text,
  customer_email_in text,
  amount_total_cents_in integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.founding_access_orders%rowtype;
  matched_uid uuid;
begin
  select * into existing
    from public.founding_access_orders
    where stripe_session_id = session_id_in
    limit 1;

  if existing.id is null then
    insert into public.founding_access_orders (
      stripe_session_id, stripe_payment_intent, customer_email,
      amount_cents, currency, status, paid_at
    ) values (
      session_id_in, payment_intent_in, customer_email_in,
      coalesce(amount_total_cents_in, 999), 'usd', 'paid', now()
    )
    returning * into existing;
  else
    if existing.status = 'paid' then return true; end if;
    update public.founding_access_orders
    set status = 'paid',
        stripe_payment_intent = coalesce(stripe_payment_intent, payment_intent_in),
        customer_email = coalesce(customer_email, customer_email_in),
        paid_at = now(),
        updated_at = now()
    where id = existing.id
    returning * into existing;
  end if;

  if existing.customer_email is not null then
    select u.id into matched_uid
    from auth.users u
    where lower(u.email) = lower(existing.customer_email)
    limit 1;

    if matched_uid is not null then
      update public.founding_access_orders
      set claimed_by_user_id = matched_uid,
          claimed_at = coalesce(claimed_at, now()),
          updated_at = now()
      where id = existing.id;

      update public.profiles
      set founding_access = true,
          founding_paid_at = coalesce(founding_paid_at, now()),
          updated_at = now()
      where id = matched_uid;
    end if;
  end if;

  return true;
end $$;

revoke all on function public.mark_founding_order_paid(text, text, text, integer) from public;
grant execute on function public.mark_founding_order_paid(text, text, text, integer) to service_role;

create or replace function public.claim_founding_access_for_user(
  email_in text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  e text := lower(coalesce(trim(email_in), ''));
  matched_count int;
begin
  if uid is null then return false; end if;
  if e = '' then return false; end if;

  if (select founding_access from public.profiles where id = uid) is true then
    return true;
  end if;

  with claimed as (
    update public.founding_access_orders
    set claimed_by_user_id = uid,
        claimed_at = coalesce(claimed_at, now()),
        updated_at = now()
    where lower(customer_email) = e
      and status = 'paid'
      and (claimed_by_user_id is null or claimed_by_user_id = uid)
    returning id
  )
  select count(*) into matched_count from claimed;

  if matched_count > 0 then
    update public.profiles
    set founding_access = true,
        founding_paid_at = coalesce(founding_paid_at, now()),
        updated_at = now()
    where id = uid;
    return true;
  end if;

  return false;
end $$;

revoke all on function public.claim_founding_access_for_user(text) from public;
grant execute on function public.claim_founding_access_for_user(text) to authenticated;

notify pgrst, 'reload schema';
