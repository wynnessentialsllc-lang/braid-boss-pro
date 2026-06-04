-- Service BNPL — let clients pay a service's FULL price via Buy-Now-
-- Pay-Later (Affirm / Klarna / Afterpay), opt-in per stylist.
--
-- Background: the storefront already surfaces BNPL because its Checkout
-- session omits payment_method_types (Stripe "dynamic payment methods").
-- The booking-deposit Checkout, by contrast, pins payment_method_types =
-- card AND saves the card off-session for no-show protection — both of
-- which are incompatible with BNPL. So services get a SEPARATE "pay in
-- full" Checkout (app/api/booking-full/checkout) that omits the method
-- list and the card-on-file bits. This migration adds the data plumbing:
--
--   1. profiles.service_bnpl_enabled  — the per-stylist opt-in flag.
--   2. booking_requests.paid_in_full / amount_paid — so a full payment is
--      recorded distinctly from a partial deposit and the resulting
--      appointment shows a $0 balance.
--   3. set_service_bnpl_enabled()     — self-serve toggle for the stylist.
--   4. mark_full_payment_paid_via_webhook() — the full-payment analogue of
--      mark_deposit_paid_via_webhook().
--   5. public_submit_booking_request() gains two OUT columns
--      (service_price, bnpl_enabled) so the booking page knows whether to
--      offer the "pay in full" choice and for how much.
--
-- Scope: pay-in-full BNPL is only offered for services that already take a
-- deposit (i.e. the booking already reaches a Stripe checkpoint at booking
-- time). No-deposit services keep the request-then-approve-then-pay flow
-- unchanged.

-- 1. Per-stylist opt-in flag. Default false: a stylist must turn it on in
--    /settings/payments. Unlike the paid-access columns, this is a benign
--    self-serve preference, but we still keep writes off the authenticated
--    role (profiles UPDATE is locked down) and route them through the
--    SECURITY DEFINER RPC below so the column lockdown stays intact.
alter table public.profiles
  add column if not exists service_bnpl_enabled boolean not null default false;

-- 2. Full-payment bookkeeping on booking_requests. paid_in_full marks that
--    the client paid the whole ticket up front (via BNPL or card on the
--    pay-in-full Checkout); amount_paid records how much actually landed.
alter table public.booking_requests
  add column if not exists paid_in_full boolean not null default false,
  add column if not exists amount_paid numeric(10, 2);

-- 3. Self-serve toggle. SECURITY DEFINER so it can write the locked-down
--    profiles column, but scoped to auth.uid() so a caller can only ever
--    flip their OWN flag. Returns the resulting value for the UI.
create or replace function public.set_service_bnpl_enabled(enabled_in boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  -- Ensure a profile row exists (mirrors profiles_self_insert intent) so
  -- the toggle works even before any other profile write has happened.
  insert into public.profiles (id) values (uid)
  on conflict (id) do nothing;
  update public.profiles
  set service_bnpl_enabled = coalesce(enabled_in, false)
  where id = uid;
  return coalesce(enabled_in, false);
end;
$$;

revoke all on function public.set_service_bnpl_enabled(boolean) from public;
grant execute on function public.set_service_bnpl_enabled(boolean) to authenticated;

-- 4. Full-payment webhook RPC. Mirrors mark_deposit_paid_via_webhook but
--    records paid_in_full + amount_paid and lands in the SAME
--    deposit_paid_pending_approval state so the existing approval queue
--    handles it unchanged. Idempotent: a Stripe retry after the row has
--    moved on is a no-op.
create or replace function public.mark_full_payment_paid_via_webhook(
  request_id_in uuid,
  stripe_session_id_in text,
  stripe_payment_intent_in text default null,
  amount_paid_in numeric default null
)
returns public.booking_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  row_out public.booking_requests;
  current_status text;
begin
  select approval_status into current_status
  from public.booking_requests
  where id = request_id_in
  limit 1;

  if current_status is null then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;

  -- Already past payment — no-op (webhook retries are common).
  if current_status in (
    'deposit_paid_pending_approval', 'approved', 'confirmed', 'denied', 'declined', 'cancelled'
  ) then
    select * into row_out from public.booking_requests where id = request_id_in;
    return row_out;
  end if;

  update public.booking_requests
  set approval_status = 'deposit_paid_pending_approval',
      payment_status = 'paid',
      deposit_paid = true,
      paid_in_full = true,
      amount_paid = coalesce(amount_paid_in, amount_paid, service_price),
      deposit_paid_at = coalesce(deposit_paid_at, now()),
      stripe_checkout_session_id = coalesce(stripe_checkout_session_id, stripe_session_id_in),
      stripe_session_id = coalesce(stripe_session_id, stripe_session_id_in),
      stripe_payment_intent_id = coalesce(stripe_payment_intent_id, stripe_payment_intent_in),
      approval_expires_at = null
  where id = request_id_in
  returning * into row_out;

  return row_out;
end;
$$;

revoke all on function public.mark_full_payment_paid_via_webhook(uuid, text, text, numeric) from public;
grant execute on function public.mark_full_payment_paid_via_webhook(uuid, text, text, numeric) to service_role;

-- 5. Recreate public_submit_booking_request with two extra OUT columns:
--    service_price (the resolved full ticket) and bnpl_enabled (whether
--    the booking page should offer the pay-in-full BNPL choice). Changing
--    the return type requires DROP + CREATE; the argument signature is
--    unchanged. Body is identical to 20260806000001 except for reading the
--    owner's service_bnpl_enabled flag and populating the two new outputs.
drop function if exists public.public_submit_booking_request(
  text, text, text, text, uuid, date, text, text, text, text, text, text[], boolean
);

create function public.public_submit_booking_request(
  slug_in            text,
  client_name_in     text,
  client_phone_in    text    default null,
  client_email_in    text    default null,
  service_id_in      uuid    default null,
  preferred_date_in  date    default null,
  preferred_time_in  text    default null,
  notes_in           text    default null,
  timezone_in        text    default null,
  locale_in          text    default null,
  variation_id_in    text    default null,
  addon_ids_in       text[]  default null,
  sms_opt_in_in      boolean default false
)
returns table(
  request_id uuid,
  approval_status text,
  deposit_required boolean,
  deposit_amount numeric,
  stripe_connect_account_id text,
  service_price numeric,
  bnpl_enabled boolean
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  canonical_slug text := public._resolve_slug_to_canonical(slug_in);
  owner_id uuid;
  owner_connect_id text;
  owner_charges_enabled boolean;
  owner_bnpl_enabled boolean;
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
  addons_snapshot jsonb := '[]'::jsonb;
  addons_price_total numeric := 0;
  addons_duration_total numeric := 0;
  addons_deposit_extra numeric := 0;
  extra_obj jsonb;
  addon_id_iter text;
  offer_bnpl boolean := false;
begin
  if canonical_slug is null or canonical_slug = '' then return; end if;
  if client_name_in is null or trim(client_name_in) = '' then return; end if;

  select user_id into owner_id from public.booking_links where slug = canonical_slug and active = true limit 1;
  if owner_id is null then return; end if;

  select p.stripe_connect_account_id, p.stripe_connect_charges_enabled, p.service_bnpl_enabled
    into owner_connect_id, owner_charges_enabled, owner_bnpl_enabled
  from public.profiles p where p.id = owner_id limit 1;

  if service_id_in is not null then
    select * into svc_row from public.services where id = service_id_in and user_id = owner_id and is_active = true limit 1;
  end if;

  if svc_row.id is not null and variation_id_in is not null and trim(variation_id_in) <> '' then
    select v.value into variation_obj from jsonb_array_elements(coalesce(svc_row.add_ons, '[]'::jsonb)) as v where v.value ->> 'id' = variation_id_in limit 1;
    if variation_obj is not null then
      variation_id_eff := variation_obj ->> 'id';
      variation_name_eff := nullif(trim(coalesce(variation_obj ->> 'name', '')), '');
      if variation_obj ? 'variation_price' and (variation_obj -> 'variation_price') is not null and jsonb_typeof(variation_obj -> 'variation_price') = 'number' then
        variation_price_eff := (variation_obj ->> 'variation_price')::numeric;
      else
        variation_price_eff := coalesce(svc_row.base_price, 0) + coalesce(nullif(variation_obj ->> 'amount', '')::numeric, 0);
      end if;
      if variation_obj ? 'variation_duration_hours' and (variation_obj -> 'variation_duration_hours') is not null and jsonb_typeof(variation_obj -> 'variation_duration_hours') = 'number' then
        variation_duration_eff := (variation_obj ->> 'variation_duration_hours')::numeric;
      end if;
      if variation_obj ? 'variation_deposit_required' and (variation_obj -> 'variation_deposit_required') is not null and jsonb_typeof(variation_obj -> 'variation_deposit_required') = 'boolean' then
        variation_deposit_required_eff := (variation_obj ->> 'variation_deposit_required')::boolean;
      end if;
      if variation_obj ? 'variation_deposit_amount' and (variation_obj -> 'variation_deposit_amount') is not null and jsonb_typeof(variation_obj -> 'variation_deposit_amount') = 'number' then
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
    if resolved_price is not null and resolved_deposit_amount is not null and resolved_deposit_amount > resolved_price then
      resolved_deposit_amount := resolved_price;
    end if;
  end if;

  if svc_row.id is not null and addon_ids_in is not null then
    foreach addon_id_iter in array addon_ids_in loop
      if addon_id_iter is null or trim(addon_id_iter) = '' then continue; end if;
      select e.value into extra_obj from jsonb_array_elements(coalesce(svc_row.extras, '[]'::jsonb)) as e where e.value ->> 'id' = addon_id_iter and coalesce((e.value ->> 'active')::boolean, true) is true limit 1;
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

  resolved_price := coalesce(resolved_price, 0) + addons_price_total;
  resolved_duration := coalesce(resolved_duration, 0) + addons_duration_total;
  if resolved_deposit_required then
    resolved_deposit_amount := coalesce(resolved_deposit_amount, 0) + addons_deposit_extra;
    if resolved_price is not null and resolved_deposit_amount > resolved_price then
      resolved_deposit_amount := resolved_price;
    end if;
  elsif addons_deposit_extra > 0 then
    resolved_deposit_required := true;
    resolved_deposit_amount := addons_deposit_extra;
  end if;

  if svc_row.id is not null and resolved_deposit_required is true and coalesce(resolved_deposit_amount, 0) > 0 and owner_charges_enabled is true and owner_connect_id is not null and owner_connect_id <> '' then
    effective_deposit_required := true;
    effective_deposit_amount := resolved_deposit_amount;
    initial_status := 'awaiting_deposit';
    connect_stamp := owner_connect_id;
  end if;

  -- Offer pay-in-full BNPL whenever the stylist opted in, the account can
  -- take charges, and there's a real ticket to finance. This is offered
  -- regardless of whether a deposit is required:
  --   * deposit service  → client chooses deposit (card) vs full (BNPL).
  --   * no-deposit service → client chooses pay-in-full (BNPL) vs just
  --     sending the request (the existing pay-later flow).
  -- resolved_price must strictly exceed whatever is already due as a
  -- deposit (0 when none) so there's something extra to actually finance.
  offer_bnpl := coalesce(owner_bnpl_enabled, false)
    and owner_charges_enabled is true
    and owner_connect_id is not null
    and owner_connect_id <> ''
    and resolved_price is not null
    and resolved_price > 0
    and resolved_price > coalesce(effective_deposit_amount, 0);

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
    selected_addons,
    sms_opt_in
  ) values (
    owner_id,
    canonical_slug,
    nullif(trim(client_name_in), ''),
    nullif(trim(coalesce(client_phone_in, '')), ''),
    nullif(trim(coalesce(client_email_in, '')), ''),
    svc_row.id,
    case when variation_name_eff is not null and svc_row.name is not null then svc_row.name || ' — ' || variation_name_eff else coalesce(svc_row.name, null) end,
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
    addons_snapshot,
    coalesce(sms_opt_in_in, false)
  )
  returning id into new_id;

  request_id := new_id;
  approval_status := initial_status;
  deposit_required := effective_deposit_required;
  deposit_amount := effective_deposit_amount;
  stripe_connect_account_id := connect_stamp;
  service_price := resolved_price;
  bnpl_enabled := offer_bnpl;
  return next;
end;
$function$;

grant execute on function public.public_submit_booking_request(
  text, text, text, text, uuid, date, text, text, text, text, text, text[], boolean
) to anon;
grant execute on function public.public_submit_booking_request(
  text, text, text, text, uuid, date, text, text, text, text, text, text[], boolean
) to authenticated;
