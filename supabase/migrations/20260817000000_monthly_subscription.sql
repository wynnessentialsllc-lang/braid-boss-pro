-- Monthly subscription ($14.99/mo, 14-day trial) — new monetization.
--
-- Replaces the $9.99 one-time founding/lifetime offer for NEW users.
-- EXISTING lifetime + founding members are grandfathered automatically:
-- profiles.lifetime_access and profiles.founding_access are left
-- untouched and continue to grant full access. This migration only
-- ADDS subscription state; it never revokes a legacy flag.
--
-- Access (computed app-side in lib/guest-limits.ts) becomes:
--   lifetime_access OR founding_access OR subscription is live
-- where "live" = subscription_status in ('trialing','active','past_due').
--
-- The Stripe subscription lifecycle is mirrored onto these columns by
-- the /api/subscribe/webhook route via the two RPCs below.

alter table public.profiles
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_status text,
  add column if not exists subscription_current_period_end timestamptz,
  add column if not exists subscription_cancel_at_period_end boolean not null default false,
  add column if not exists subscription_started_at timestamptz;

create index if not exists profiles_stripe_customer_idx
  on public.profiles (stripe_customer_id) where stripe_customer_id is not null;
create index if not exists profiles_stripe_subscription_idx
  on public.profiles (stripe_subscription_id) where stripe_subscription_id is not null;

-- =====================================================================
-- start_subscription_for_user — called on checkout.session.completed
-- (mode=subscription). We know the user from the session's
-- client_reference_id, so we bind customer + subscription ids onto the
-- profile here. Subsequent status changes flow through
-- apply_subscription_status (matched by subscription/customer id).
-- Idempotent: re-running with the same ids just refreshes the row.
-- =====================================================================
create or replace function public.start_subscription_for_user(
  user_id_in                  uuid,
  customer_id_in              text,
  subscription_id_in          text,
  status_in                   text,
  current_period_end_in       timestamptz default null,
  cancel_at_period_end_in     boolean     default false
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if user_id_in is null then
    return false;
  end if;
  update public.profiles
  set stripe_customer_id               = coalesce(customer_id_in, stripe_customer_id),
      stripe_subscription_id           = coalesce(subscription_id_in, stripe_subscription_id),
      subscription_status              = coalesce(nullif(trim(status_in), ''), subscription_status),
      subscription_current_period_end  = coalesce(current_period_end_in, subscription_current_period_end),
      subscription_cancel_at_period_end = coalesce(cancel_at_period_end_in, false),
      subscription_started_at          = coalesce(subscription_started_at, now())
  where id = user_id_in;
  return found;
end;
$$;

revoke all on function public.start_subscription_for_user(uuid, text, text, text, timestamptz, boolean) from public;
grant execute on function public.start_subscription_for_user(uuid, text, text, text, timestamptz, boolean) to service_role;

-- =====================================================================
-- apply_subscription_status — called on customer.subscription.updated
-- and customer.subscription.deleted. These events carry the full
-- subscription object but NOT our user id, so we match the profile by
-- stripe_subscription_id (preferred) or stripe_customer_id. Never
-- touches lifetime_access / founding_access, so grandfathered access
-- survives any subscription state.
-- =====================================================================
create or replace function public.apply_subscription_status(
  customer_id_in              text,
  subscription_id_in          text,
  status_in                   text,
  current_period_end_in       timestamptz default null,
  cancel_at_period_end_in     boolean     default false
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  matched int := 0;
begin
  if status_in is null or trim(status_in) = '' then
    return false;
  end if;

  update public.profiles
  set subscription_status               = status_in,
      subscription_current_period_end   = coalesce(current_period_end_in, subscription_current_period_end),
      subscription_cancel_at_period_end = coalesce(cancel_at_period_end_in, false),
      stripe_customer_id                = coalesce(stripe_customer_id, customer_id_in),
      stripe_subscription_id            = coalesce(stripe_subscription_id, subscription_id_in)
  where (subscription_id_in is not null and stripe_subscription_id = subscription_id_in)
     or (customer_id_in is not null and stripe_customer_id = customer_id_in);
  get diagnostics matched = row_count;
  return matched > 0;
end;
$$;

revoke all on function public.apply_subscription_status(text, text, text, timestamptz, boolean) from public;
grant execute on function public.apply_subscription_status(text, text, text, timestamptz, boolean) to service_role;

notify pgrst, 'reload schema';
