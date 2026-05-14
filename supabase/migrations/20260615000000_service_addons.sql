-- Service add-ons — optional paid extras stacked on top of the base
-- service OR the picked variation (e.g. "Waist length +$30", "Curly
-- pieces +$25, +0.5h").
--
-- The terminology is now:
--   * variations → services.add_ons jsonb  (legacy column name)
--   * add-ons    → services.extras  jsonb  (new column added here)
--
-- Add-ons are additive: their price stacks on the variation/base, and
-- their duration_hours_delta stacks on the variation/base duration.
-- The deposit is NOT auto-bumped unless an individual add-on has
-- `include_in_deposit = true`.
--
-- Each booking_request row that included add-ons snapshots them on
-- `selected_addons jsonb` so the picked extras survive the
-- public-page → checkout → approval handoff intact, even if the
-- stylist edits the catalog mid-flow.

alter table public.services
  add column if not exists extras jsonb not null default '[]'::jsonb;

-- Bound the array so a misbehaving client can't push 1000 entries.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'services_extras_chk'
  ) then
    alter table public.services
      add constraint services_extras_chk
      check (
        jsonb_typeof(extras) = 'array'
        and jsonb_array_length(extras) <= 25
      )
      not valid;
    alter table public.services validate constraint services_extras_chk;
  end if;
end $$;

alter table public.booking_requests
  add column if not exists selected_addons jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'booking_requests_selected_addons_chk'
  ) then
    alter table public.booking_requests
      add constraint booking_requests_selected_addons_chk
      check (
        jsonb_typeof(selected_addons) = 'array'
        and jsonb_array_length(selected_addons) <= 25
      )
      not valid;
    alter table public.booking_requests validate constraint booking_requests_selected_addons_chk;
  end if;
end $$;

-- Surface `extras` on the public services RPC so /book/<slug> can
-- render the optional add-ons list without a second roundtrip.
drop function if exists public.public_list_services(text);
create or replace function public.public_list_services(slug_in text)
returns table (
  id uuid,
  name text,
  description text,
  duration_hours numeric(5,2),
  base_price numeric(10,2),
  deposit_required boolean,
  deposit_amount numeric(10,2),
  add_ons jsonb,
  extras jsonb,
  prep_instructions text,
  buffer_before_minutes integer,
  buffer_after_minutes integer,
  max_concurrent integer,
  contract_template_id uuid,
  category_id uuid
)
language sql
security definer
set search_path = public
as $$
  select
    s.id, s.name, s.description, s.duration_hours, s.base_price,
    s.deposit_required, s.deposit_amount, s.add_ons, s.extras,
    s.prep_instructions,
    s.buffer_before_minutes, s.buffer_after_minutes, s.max_concurrent,
    s.contract_template_id, s.category_id
  from public.services s
  inner join public.booking_links bl on bl.user_id = s.user_id
  where bl.slug = slug_in
    and bl.active = true
    and s.is_active = true
  order by s.name asc;
$$;

revoke all on function public.public_list_services(text) from public;
grant execute on function public.public_list_services(text) to anon, authenticated;

-- Extend public_submit_booking_request to accept the picked add-ons.
-- The function resolves each one against the live services.extras
-- jsonb (so a malicious client can't invent free upgrades), stacks
-- their price + duration on top of the variation/base, and only
-- folds `include_in_deposit = true` add-ons into the deposit amount.
drop function if exists public.public_submit_booking_request(
  text, text, text, text, uuid, date, text, text, text, text, text
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
  variation_id_in text default null,
  addon_ids_in text[] default null
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
  variation_obj jsonb := null;
  variation_id_eff text := null;
  variation_name_eff text := null;
  variation_price_eff numeric := null;
  variation_duration_eff numeric := null;
  variation_deposit_amount_eff numeric := null;
  variation_deposit_required_eff boolean := null;
  resolved_price numeric := null;
  resolved_duration numeric := null;
  resolved_deposit_required boolean := false;
  resolved_deposit_amount numeric := null;
  -- Add-on resolution.
  addons_snapshot jsonb := '[]'::jsonb;
  addons_price_total numeric := 0;
  addons_duration_total numeric := 0;
  addons_deposit_extra numeric := 0;
  extra_obj jsonb;
  addon_id_iter text;
begin
  if slug_in is null or trim(slug_in) = '' then return; end if;
  if client_name_in is null or trim(client_name_in) = '' then return; end if;

  select user_id into owner_id
  from public.booking_links
  where slug = slug_in and active = true
  limit 1;
  if owner_id is null then return; end if;

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

  -- Variation pick (same shape as the previous version of this RPC).
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

  resolved_price := coalesce(variation_price_eff, svc_row.base_price);
  resolved_duration := coalesce(variation_duration_eff, svc_row.duration_hours);

  if variation_obj is not null and variation_deposit_required_eff is not null then
    resolved_deposit_required := variation_deposit_required_eff;
  else
    resolved_deposit_required := coalesce(svc_row.deposit_required, false);
  end if;

  if resolved_deposit_required then
    if variation_deposit_amount_eff is not null and variation_deposit_amount_eff > 0 then
      resolved_deposit_amount := variation_deposit_amount_eff;
    else
      resolved_deposit_amount := svc_row.deposit_amount;
    end if;
    if resolved_price is not null and resolved_deposit_amount is not null
       and resolved_deposit_amount > resolved_price
    then
      resolved_deposit_amount := resolved_price;
    end if;
  end if;

  -- Add-on resolution. Look each id up in services.extras and
  -- snapshot only what's there — never trust client-provided money.
  if svc_row.id is not null and addon_ids_in is not null then
    foreach addon_id_iter in array addon_ids_in loop
      if addon_id_iter is null or trim(addon_id_iter) = '' then continue; end if;
      select e.value into extra_obj
      from jsonb_array_elements(coalesce(svc_row.extras, '[]'::jsonb)) as e
      where e.value ->> 'id' = addon_id_iter
        and coalesce((e.value ->> 'active')::boolean, true) is true
      limit 1;
      if extra_obj is null then continue; end if;

      addons_snapshot := addons_snapshot || jsonb_build_array(jsonb_build_object(
        'id', extra_obj ->> 'id',
        'name', coalesce(extra_obj ->> 'name', ''),
        'price', coalesce(nullif(extra_obj ->> 'price', '')::numeric, 0),
        'duration_hours_delta', coalesce(nullif(extra_obj ->> 'duration_hours_delta', '')::numeric, 0),
        'include_in_deposit', coalesce((extra_obj ->> 'include_in_deposit')::boolean, false)
      ));
      addons_price_total := addons_price_total + coalesce(nullif(extra_obj ->> 'price', '')::numeric, 0);
      addons_duration_total := addons_duration_total + coalesce(nullif(extra_obj ->> 'duration_hours_delta', '')::numeric, 0);
      if coalesce((extra_obj ->> 'include_in_deposit')::boolean, false) is true then
        addons_deposit_extra := addons_deposit_extra + coalesce(nullif(extra_obj ->> 'price', '')::numeric, 0);
      end if;
    end loop;
  end if;

  -- Stack add-ons on top of the resolved variation/base.
  resolved_price := coalesce(resolved_price, 0) + addons_price_total;
  resolved_duration := coalesce(resolved_duration, 0) + addons_duration_total;
  if resolved_deposit_required then
    resolved_deposit_amount := coalesce(resolved_deposit_amount, 0) + addons_deposit_extra;
    if resolved_price is not null and resolved_deposit_amount > resolved_price then
      resolved_deposit_amount := resolved_price;
    end if;
  elsif addons_deposit_extra > 0 then
    -- An add-on flagged include_in_deposit triggers a deposit even
    -- if the parent didn't require one. The deposit amount equals
    -- the sum of those flagged add-ons.
    resolved_deposit_required := true;
    resolved_deposit_amount := addons_deposit_extra;
  end if;

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
    selected_variation_deposit_amount,
    selected_addons
  ) values (
    owner_id,
    nullif(trim(slug_in), ''),
    nullif(trim(client_name_in), ''),
    nullif(trim(coalesce(client_phone_in, '')), ''),
    nullif(trim(coalesce(client_email_in, '')), ''),
    svc_row.id,
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
    variation_deposit_amount_eff,
    addons_snapshot
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
  text, text, text, text, uuid, date, text, text, text, text, text, text[]
) from public;
grant execute on function public.public_submit_booking_request(
  text, text, text, text, uuid, date, text, text, text, text, text, text[]
) to anon, authenticated;
