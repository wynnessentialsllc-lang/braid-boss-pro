-- Lifetime access flag for the one-time $9.99 unlock.
--
-- Source of truth lives on profiles.lifetime_access. The flag is only
-- ever set by the /api/verify-payment Next.js route handler, which uses
-- the Supabase service role after retrieving and validating the Stripe
-- Checkout Session. Authenticated users are explicitly REVOKEd from
-- updating this column so they cannot self-grant access.

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists lifetime_access boolean not null default false,
  add column if not exists stripe_checkout_session_id text,
  add column if not exists upgraded_at timestamptz;

-- RLS: a user can read their own profile row but cannot set the
-- lifetime_access column themselves. The service role (used by the
-- Next.js verify-payment route) bypasses RLS and is what flips the flag.
alter table public.profiles enable row level security;

drop policy if exists "profiles_self_select" on public.profiles;
create policy "profiles_self_select" on public.profiles
  for select using (auth.uid() = user_id);

-- Allow the user to insert their own empty profile row (idempotent).
-- The lifetime_access default is false, so this is safe.
drop policy if exists "profiles_self_insert" on public.profiles;
create policy "profiles_self_insert" on public.profiles
  for insert with check (auth.uid() = user_id);

-- Column-level lockdown: revoke UPDATE on the paid columns from
-- authenticated. Service role still has full access (it bypasses RLS
-- and the GRANTs below don't restrict it).
revoke update on public.profiles from authenticated;
grant update (updated_at) on public.profiles to authenticated;

-- Auto-bump updated_at.
create or replace function public.profiles_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch
  before update on public.profiles
  for each row
  execute function public.profiles_touch_updated_at();
