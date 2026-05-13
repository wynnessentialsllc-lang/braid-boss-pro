-- Per-variation prices, durations, and deposits.
--
-- A parent service (services.add_ons jsonb) can now expose multiple
-- bookable variations, each with their own price / duration / deposit
-- amount — e.g. Boho Knotless Braids → { Standard $225 / $25 deposit,
-- Human curly hair $355 / $75 deposit, Synthetic curly $285 / $50 }.
-- The variation row itself is still stored inside services.add_ons
-- (jsonb); this migration only:
--   1. Adds snapshot columns to booking_requests so the picked
--      variation survives the public-booking → checkout → approval
--      handoff without depending on the live services row (which the
--      stylist could edit between submit and approval).
--   2. Replaces public_submit_booking_request with a version that
--      accepts the picked variation id, resolves its effective deposit
--      (variation → parent → none), and persists the snapshot.
--
-- Fully back-compat: callers that pass null/no variation_id keep the
-- old behavior. Services without variations are untouched.

alter table public.booking_requests
  add column if not exists selected_variation_id text,
  add column if not exists selected_variation_name text,
  add column if not exists selected_variation_price numeric(10, 2),
  add column if not exists selected_variation_duration_hours numeric(5, 2),
  add column if not exists selected_variation_deposit_amount numeric(10, 2);

-- The old signature still exists alongside the new one; drop it so the
-- replacement is unambiguous and the PostgREST schema cache picks up
-- the new param list cleanly.
drop function if exists public.public_submit_booking_request(
  text, text, text, text, uuid, date, text, text, text, text
);

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
  locale_in text default null,
  variation_id_in text default null
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
  -- Resolved variation snapshot.
  variation_obj jsonb := null;
  variation_id_eff text := null;
  variation_name_eff text := null;
  variation_price_eff numeric := null;
  variation_duration_eff numeric := null;
  variation_deposit_amount_eff numeric := null;
  variation_deposit_required_eff boolean := null;
  -- Computed pricing fed into the booking_request row.
  resolved_price numeric := null;
  resolved_duration numeric := null;
  resolved_deposit_required boolean := false;
  resolved_deposit_amount numeric := null;
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

  -- Resolve the picked variation against the live add_ons jsonb.
  -- variation_id_in is the client-side `addon_xxxx` id; we look it up
  -- and snapshot only the fields we care about.
  if svc_row.id is not null
     and variation_id_in is not null
     and trim(variation_id_in) <> ''
  then
    select v.value into variation_obj
    from jsonb_array_elements(coalesce(svc_row.add_ons, '[]'::jsonb)) as v
    where v.value ->> 'id' = variation_id_in
    limit 1;

    if variation_obj is not null then
      variation_id_eff := variation_obj ->> 'id';
      variation_name_eff := nullif(trim(coalesce(variation_obj ->> 'name', '')), '');

      -- variation_price: explicit override → number; else inherit
      -- base_price + legacy add-on amount.
      if variation_obj ? 'variation_price'
         and (variation_obj -> 'variation_price') is not null
         and jsonb_typeof(variation_obj -> 'variation_price') = 'number'
      then
        variation_price_eff := (variation_obj ->> 'variation_price')::numeric;
      else
        variation_price_eff := coalesce(svc_row.base_price, 0)
          + coalesce(nullif(variation_obj ->> 'amount', '')::numeric, 0);
      end if;

      if variation_obj ? 'variation_duration_hours'
         and (variation_obj -> 'variation_duration_hours') is not null
         and jsonb_typeof(variation_obj -> 'variation_duration_hours') = 'number'
      then
        variation_duration_eff := (variation_obj ->> 'variation_duration_hours')::numeric;
      end if;

      if variation_obj ? 'variation_deposit_required'
         and (variation_obj -> 'variation_deposit_required') is not null
         and jsonb_typeof(variation_obj -> 'variation_deposit_required') = 'boolean'
      then
        variation_deposit_required_eff := (variation_obj ->> 'variation_deposit_required')::boolean;
      end if;

      if variation_obj ? 'variation_deposit_amount'
         and (variation_obj -> 'variation_deposit_amount') is not null
         and jsonb_typeof(variation_obj -> 'variation_deposit_amount') = 'number'
      then
        variation_deposit_amount_eff := (variation_obj ->> 'variation_deposit_amount')::numeric;
      end if;
    end if;
  end if;

  -- Effective pricing for THIS booking_request:
  --   * If a variation was picked AND has a price → variation price.
  --   * Else → parent service base_price (or NULL if no service).
  resolved_price := coalesce(variation_price_eff, svc_row.base_price);
  resolved_duration := coalesce(variation_duration_eff, svc_row.duration_hours);

  -- Deposit resolution: variation override → parent service → none.
  -- The variation's required-toggle overrides the parent's only when
  -- it's explicitly boolean; otherwise we inherit.
  if variation_obj is not null and variation_deposit_required_eff is not null then
    resolved_deposit_required := variation_deposit_required_eff;
  else
    resolved_deposit_required := coalesce(svc_row.deposit_required, false);
  end if;

  if resolved_deposit_required then
    -- Variation amount wins when present and > 0.
    if variation_deposit_amount_eff is not null and variation_deposit_amount_eff > 0 then
      resolved_deposit_amount := variation_deposit_amount_eff;
    else
      resolved_deposit_amount := svc_row.deposit_amount;
    end if;
    -- Cap at the price.
    if resolved_price is not null and resolved_deposit_amount is not null
       and resolved_deposit_amount > resolved_price
    then
      resolved_deposit_amount := resolved_price;
    end if;
  end if;

  -- Deposit branch only fires when the connected Stripe account is
  -- ready AND we have a positive deposit to collect.
  if svc_row.id is not null
     and resolved_deposit_required is true
     and coalesce(resolved_deposit_amount, 0) > 0
     and owner_charges_enabled is true
     and owner_connect_id is not null
     and owner_connect_id <> ''
  then
    effective_deposit_required := true;
    effective_deposit_amount := resolved_deposit_amount;
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
    stripe_connect_account_id,
    selected_variation_id, selected_variation_name,
    selected_variation_price, selected_variation_duration_hours,
    selected_variation_deposit_amount
  ) values (
    owner_id,
    nullif(trim(slug_in), ''),
    nullif(trim(client_name_in), ''),
    nullif(trim(coalesce(client_phone_in, '')), ''),
    nullif(trim(coalesce(client_email_in, '')), ''),
    svc_row.id,
    -- service_name reflects what the client booked — when a variation
    -- is picked, append it so the approval queue + emails read right.
    case
      when variation_name_eff is not null and svc_row.name is not null
        then svc_row.name || ' — ' || variation_name_eff
      else coalesce(svc_row.name, null)
    end,
    coalesce(svc_row.name, null),
    resolved_duration,
    resolved_duration,
    resolved_price,
    resolved_deposit_required,
    resolved_deposit_amount,
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
    connect_stamp,
    variation_id_eff,
    variation_name_eff,
    variation_price_eff,
    variation_duration_eff,
    variation_deposit_amount_eff
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
  text, text, text, text, uuid, date, text, text, text, text, text
) from public;
grant execute on function public.public_submit_booking_request(
  text, text, text, text, uuid, date, text, text, text, text, text
) to anon, authenticated;
