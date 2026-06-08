-- Mobile Services V1 — let traveling braiders set a home base, a
-- service radius, an optional zip blocklist, and a per-service travel
-- fee. The public booking page geocodes the client address, computes
-- distance, and either quotes the trip or blocks "outside service area"
-- before the request is ever submitted.
--
-- Stylist-wide config lives on booking_links so it persists across
-- services and tracks the public surface that already owns address-like
-- fields (location_text, business_city, business_state).
--
-- Per-service config lives on services so a stylist can mix studio +
-- mobile services on one menu.
--
-- Per-booking snapshot lives on booking_requests so the appointment
-- carries the address, distance, and travel fee paid.

-- ---- booking_links: stylist-wide mobile settings ---------------------

alter table public.booking_links
  add column if not exists mobile_base_address text,
  add column if not exists mobile_base_lat numeric(9, 6),
  add column if not exists mobile_base_lng numeric(9, 6),
  add column if not exists mobile_base_zip text,
  -- Default 0 means "no mobile coverage configured yet" — the service
  -- toggle still gates the public UI, so this is just a safe sentinel.
  add column if not exists mobile_radius_miles numeric(6, 2) not null default 0,
  add column if not exists mobile_blocked_zips text[] not null default '{}';

alter table public.booking_links
  add constraint booking_links_mobile_radius_chk
    check (mobile_radius_miles >= 0 and mobile_radius_miles <= 500)
    not valid;
alter table public.booking_links validate constraint booking_links_mobile_radius_chk;

-- ---- services: per-service mobile toggle + fee model -----------------

alter table public.services
  add column if not exists mobile_service boolean not null default false,
  -- 'flat' | 'per_mile' | 'hybrid' | 'tiered'
  add column if not exists mobile_fee_model text not null default 'flat',
  add column if not exists mobile_flat_fee numeric(10, 2) not null default 0,
  add column if not exists mobile_per_mile_fee numeric(10, 2) not null default 0,
  -- Hybrid model: free within this many miles, then per_mile_fee beyond.
  add column if not exists mobile_hybrid_free_miles numeric(6, 2) not null default 0,
  -- Tiered model: [{ max_miles, fee }, ...] sorted by max_miles.
  add column if not exists mobile_tiered_bands jsonb not null default '[]'::jsonb,
  -- Optional floor: refuse mobile bookings under this base price.
  add column if not exists mobile_minimum_price numeric(10, 2);

alter table public.services
  add constraint services_mobile_fee_model_chk
    check (mobile_fee_model in ('flat', 'per_mile', 'hybrid', 'tiered'))
    not valid;
alter table public.services validate constraint services_mobile_fee_model_chk;

-- Inactive-by-default index keeps the table footprint flat for the 95%
-- of services that are studio-only.
create index if not exists services_mobile_service_idx
  on public.services (user_id)
  where mobile_service = true;

-- ---- booking_requests: snapshot of the trip --------------------------

alter table public.booking_requests
  add column if not exists client_address text,
  add column if not exists client_address_zip text,
  add column if not exists client_address_lat numeric(9, 6),
  add column if not exists client_address_lng numeric(9, 6),
  add column if not exists trip_distance_miles numeric(6, 2),
  add column if not exists mobile_travel_fee numeric(10, 2),
  add column if not exists mobile_access_notes text;

-- ---- public_list_services: include the new mobile fields -------------

drop function if exists public.public_list_services(text);

create function public.public_list_services(slug_in text)
returns table (
  id uuid,
  name text,
  description text,
  duration_hours numeric(5, 2),
  base_price numeric(10, 2),
  deposit_required boolean,
  deposit_amount numeric(10, 2),
  add_ons jsonb,
  extras jsonb,
  prep_instructions text,
  buffer_before_minutes integer,
  buffer_after_minutes integer,
  max_concurrent integer,
  contract_template_id uuid,
  category_id uuid,
  featured boolean,
  cover_image_url text,
  before_after_image_url text,
  hair_included boolean,
  included_hair_description text,
  allow_client_hair_color_selection boolean,
  allowed_hair_colors text[],
  allow_client_curl_pattern_selection boolean,
  allowed_curl_patterns text[],
  allow_style_notes boolean,
  allow_inspiration_photos boolean,
  included_details text,
  customization_enabled boolean,
  mobile_service boolean,
  mobile_fee_model text,
  mobile_flat_fee numeric(10, 2),
  mobile_per_mile_fee numeric(10, 2),
  mobile_hybrid_free_miles numeric(6, 2),
  mobile_tiered_bands jsonb,
  mobile_minimum_price numeric(10, 2)
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
    s.contract_template_id, s.category_id, coalesce(s.featured, false) as featured,
    s.cover_image_url, s.before_after_image_url,
    coalesce(s.hair_included, false),
    s.included_hair_description,
    coalesce(s.allow_client_hair_color_selection, false),
    coalesce(s.allowed_hair_colors, '{}'),
    coalesce(s.allow_client_curl_pattern_selection, false),
    coalesce(s.allowed_curl_patterns, '{}'),
    coalesce(s.allow_style_notes, true),
    coalesce(s.allow_inspiration_photos, true),
    s.included_details,
    coalesce(s.customization_enabled, true),
    coalesce(s.mobile_service, false),
    coalesce(s.mobile_fee_model, 'flat'),
    coalesce(s.mobile_flat_fee, 0),
    coalesce(s.mobile_per_mile_fee, 0),
    coalesce(s.mobile_hybrid_free_miles, 0),
    coalesce(s.mobile_tiered_bands, '[]'::jsonb),
    s.mobile_minimum_price
  from public.services s
  inner join public.booking_links bl on bl.user_id = s.user_id
  where bl.slug = public._resolve_slug_to_canonical(slug_in)
    and bl.active = true
    and s.is_active = true
  order by coalesce(s.featured, false) desc, s.name asc;
$$;
revoke all on function public.public_list_services(text) from public;
grant execute on function public.public_list_services(text) to anon, authenticated;

-- ---- public_get_mobile_config: resolve a slug's mobile config --------
--
-- Tiny anon-callable RPC the /api/mobile-quote route calls to get the
-- stylist's home base + radius + blocked zips without granting select
-- on booking_links to anon. Returns at most one row.

create or replace function public.public_get_mobile_config(slug_in text)
returns table (
  user_id uuid,
  base_lat numeric(9, 6),
  base_lng numeric(9, 6),
  base_zip text,
  radius_miles numeric(6, 2),
  blocked_zips text[]
)
language sql
security definer
set search_path = public
as $$
  select
    bl.user_id,
    bl.mobile_base_lat,
    bl.mobile_base_lng,
    bl.mobile_base_zip,
    coalesce(bl.mobile_radius_miles, 0),
    coalesce(bl.mobile_blocked_zips, '{}')
  from public.booking_links bl
  where bl.slug = public._resolve_slug_to_canonical(slug_in)
    and bl.active = true;
$$;
revoke all on function public.public_get_mobile_config(text) from public;
grant execute on function public.public_get_mobile_config(text) to anon, authenticated;

-- ---- public_attach_booking_travel_details ----------------------------
--
-- Mirrors public_attach_booking_customization: a tiny separate RPC the
-- booking page calls after a successful submit to stamp the address /
-- distance / travel fee / access notes onto the freshly-created row.
-- Kept separate to avoid re-emitting public_submit_booking_request and
-- risking regressions in the deposit/variation/extras logic.

create or replace function public.public_attach_booking_travel_details(
  request_id_in        uuid,
  address_in           text default null,
  zip_in               text default null,
  lat_in               numeric default null,
  lng_in               numeric default null,
  distance_miles_in    numeric default null,
  travel_fee_in        numeric default null,
  access_notes_in      text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected int;
begin
  if request_id_in is null then return false; end if;

  update public.booking_requests
  set client_address      = nullif(trim(coalesce(address_in, '')), ''),
      client_address_zip  = nullif(trim(coalesce(zip_in, '')), ''),
      client_address_lat  = lat_in,
      client_address_lng  = lng_in,
      trip_distance_miles = case when distance_miles_in is null then null
                                 when distance_miles_in < 0    then 0
                                 else round(distance_miles_in::numeric, 2) end,
      mobile_travel_fee   = case when travel_fee_in is null then null
                                 when travel_fee_in < 0    then 0
                                 else round(travel_fee_in::numeric, 2) end,
      mobile_access_notes = nullif(trim(coalesce(access_notes_in, '')), ''),
      updated_at          = now()
  where id = request_id_in;

  get diagnostics affected = row_count;
  return affected > 0;
end $$;

revoke all on function public.public_attach_booking_travel_details(uuid, text, text, numeric, numeric, numeric, numeric, text) from public;
grant execute on function public.public_attach_booking_travel_details(uuid, text, text, numeric, numeric, numeric, numeric, text) to anon, authenticated;

notify pgrst, 'reload schema';
