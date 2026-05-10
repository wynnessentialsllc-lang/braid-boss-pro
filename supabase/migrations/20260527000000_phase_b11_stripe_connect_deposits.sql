-- Phase B11 — Stripe Connect Express deposits.
--
-- Each stylist connects their own Stripe Express account; deposits
-- route directly to their connected account (direct charges). The
-- platform retains booking-approval logic; appointments are still
-- only created when the stylist taps Approve.
--
-- Idempotent throughout — re-running is a no-op.

-- =====================================================================
-- 1. Stylist Connect state on profiles
-- =====================================================================
alter table public.profiles
  add column if not exists stripe_connect_account_id text,
  add column if not exists stripe_connect_status text,
  add column if not exists stripe_connect_charges_enabled boolean,
  add column if not exists stripe_connect_payouts_enabled boolean,
  add column if not exists stripe_connect_details_submitted boolean,
  add column if not exists stripe_connect_updated_at timestamptz;

update public.profiles
set stripe_connect_status = 'not_connected'
where stripe_connect_status is null;

update public.profiles
set stripe_connect_charges_enabled = false
where stripe_connect_charges_enabled is null;

update public.profiles
set stripe_connect_payouts_enabled = false
where stripe_connect_payouts_enabled is null;

update public.profiles
set stripe_connect_details_submitted = false
where stripe_connect_details_submitted is null;

alter table public.profiles
  alter column stripe_connect_status set default 'not_connected',
  alter column stripe_connect_status set not null,
  alter column stripe_connect_charges_enabled set default false,
  alter column stripe_connect_charges_enabled set not null,
  alter column stripe_connect_payouts_enabled set default false,
  alter column stripe_connect_payouts_enabled set not null,
  alter column stripe_connect_details_submitted set default false,
  alter column stripe_connect_details_submitted set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_stripe_connect_status_chk'
  ) then
    alter table public.profiles
      add constraint profiles_stripe_connect_status_chk
      check (stripe_connect_status in (
        'not_connected',
        'onboarding',
        'active',
        'restricted',
        'disabled'
      ));
  end if;
end $$;

-- Webhook lookup: account.updated events arrive with the connected
-- account id and we need to find the matching profile fast.
create unique index if not exists profiles_stripe_connect_account_id_uniq
  on public.profiles (stripe_connect_account_id)
  where stripe_connect_account_id is not null;

-- =====================================================================
-- 2. booking_requests — remember which Connect account took the charge
-- =====================================================================
-- Existing in-flight rows finish on the platform account (per phase
-- decision). New rows that submit through a Connect-enabled studio
-- stamp the acct_XXX so refunds can route back through the right
-- Stripe account.
alter table public.booking_requests
  add column if not exists stripe_connect_account_id text;

-- =====================================================================
-- 3. public_submit_booking_request — Connect-aware deposit branch
-- =====================================================================
-- Only sets approval_status = 'awaiting_deposit' when the stylist's
-- Connect account can actually accept charges. Otherwise the request
-- falls back to 'pending_review' (legacy approve-first flow) and the
-- stylist can chase the deposit off-platform or finish Stripe setup
-- before approving. Returns the same shape as Phase B10 plus the
-- connected account id so the checkout route can validate quickly.
create or replace function public.public_submit_booking_request(
  slug_in text,
  client_name_in text,
  client_phone_in text default null,
  client_email_in text default null,
  service_id_in uuid default null,
  preferred_date_in date default null,
  preferred_time_in text default null,
  notes_in text default null,
  timezone_in text default null,
  locale_in text default null
)
returns table (
  request_id uuid,
  approval_status text,
  deposit_required boolean,
  deposit_amount numeric,
  stripe_connect_account_id text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
  owner_connect_id text;
  owner_charges_enabled boolean;
  svc_row public.services%rowtype;
  new_id uuid;
  effective_deposit_required boolean := false;
  effective_deposit_amount numeric := null;
  initial_status text := 'pending_review';
  connect_stamp text := null;
begin
  if slug_in is null or trim(slug_in) = '' then
    return;
  end if;
  if client_name_in is null or trim(client_name_in) = '' then
    return;
  end if;

  select user_id into owner_id
  from public.booking_links
  where slug = slug_in and active = true
  limit 1;
  if owner_id is null then
    return;
  end if;

  select p.stripe_connect_account_id, p.stripe_connect_charges_enabled
    into owner_connect_id, owner_charges_enabled
  from public.profiles p
  where p.id = owner_id
  limit 1;

  if service_id_in is not null then
    select * into svc_row
    from public.services
    where id = service_id_in and user_id = owner_id and is_active = true
    limit 1;
  end if;

  -- Deposit branch only fires when:
  --   1. The service requires a deposit with a positive amount.
  --   2. The stylist has a Connect account that can take charges.
  -- Without (2) we fall through to pending_review so the request
  -- doesn't get stuck in awaiting_deposit forever.
  if svc_row.id is not null
     and svc_row.deposit_required is true
     and coalesce(svc_row.deposit_amount, 0) > 0
     and owner_charges_enabled is true
     and owner_connect_id is not null
     and owner_connect_id <> ''
  then
    effective_deposit_required := true;
    effective_deposit_amount := svc_row.deposit_amount;
    initial_status := 'awaiting_deposit';
    connect_stamp := owner_connect_id;
  end if;

  insert into public.booking_requests (
    user_id, link_slug,
    client_name, client_phone, client_email,
    service_id, service_name, service_name_snapshot,
    service_duration, service_duration_hours,
    service_price,
    service_deposit_required, service_deposit_amount,
    service_prep_instructions,
    preferred_date, preferred_time, notes,
    timezone, locale, created_from_public,
    status, approval_status,
    deposit_required, deposit_amount,
    payment_status, deposit_paid,
    stripe_connect_account_id
  ) values (
    owner_id,
    nullif(trim(slug_in), ''),
    nullif(trim(client_name_in), ''),
    nullif(trim(coalesce(client_phone_in, '')), ''),
    nullif(trim(coalesce(client_email_in, '')), ''),
    svc_row.id,
    coalesce(svc_row.name, null),
    coalesce(svc_row.name, null),
    svc_row.duration_hours,
    svc_row.duration_hours,
    svc_row.base_price,
    svc_row.deposit_required,
    svc_row.deposit_amount,
    svc_row.prep_instructions,
    preferred_date_in,
    nullif(trim(coalesce(preferred_time_in, '')), ''),
    nullif(trim(coalesce(notes_in, '')), ''),
    nullif(trim(coalesce(timezone_in, '')), ''),
    nullif(trim(coalesce(locale_in, '')), ''),
    true,
    'pending',
    initial_status,
    effective_deposit_required,
    effective_deposit_amount,
    'unpaid',
    false,
    connect_stamp
  )
  returning id into new_id;

  request_id := new_id;
  approval_status := initial_status;
  deposit_required := effective_deposit_required;
  deposit_amount := effective_deposit_amount;
  stripe_connect_account_id := connect_stamp;
  return next;
end;
$$;

revoke all on function public.public_submit_booking_request(
  text, text, text, text, uuid, date, text, text, text, text
) from public;
grant execute on function public.public_submit_booking_request(
  text, text, text, text, uuid, date, text, text, text, text
) to anon;
grant execute on function public.public_submit_booking_request(
  text, text, text, text, uuid, date, text, text, text, text
) to authenticated;

-- =====================================================================
-- 4. apply_stripe_connect_account_update — service-role only
-- =====================================================================
-- Called by the Connect webhook on account.updated /
-- account.application.deauthorized so we don't need to re-hit Stripe
-- on every status read. Looks up the profile by acct id and mirrors
-- the latest flags + computes the derived status string.
create or replace function public.apply_stripe_connect_account_update(
  account_id_in text,
  charges_enabled_in boolean,
  payouts_enabled_in boolean,
  details_submitted_in boolean,
  deauthorized_in boolean default false
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  row_out public.profiles;
  next_status text;
begin
  if deauthorized_in is true then
    next_status := 'disabled';
  elsif coalesce(charges_enabled_in, false) is true then
    next_status := 'active';
  elsif coalesce(details_submitted_in, false) is true then
    next_status := 'restricted';
  else
    next_status := 'onboarding';
  end if;

  update public.profiles
  set stripe_connect_status = next_status,
      stripe_connect_charges_enabled = coalesce(charges_enabled_in, false),
      stripe_connect_payouts_enabled = coalesce(payouts_enabled_in, false),
      stripe_connect_details_submitted = coalesce(details_submitted_in, false),
      stripe_connect_updated_at = now()
  where stripe_connect_account_id = account_id_in
  returning * into row_out;

  return row_out;
end;
$$;

revoke all on function public.apply_stripe_connect_account_update(text, boolean, boolean, boolean, boolean) from public;
grant execute on function public.apply_stripe_connect_account_update(text, boolean, boolean, boolean, boolean) to service_role;
