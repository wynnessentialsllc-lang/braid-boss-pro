-- Mobile Services V1.1 — let stylists attach a free-text note that
-- explains their mobile minimum service price to clients. Surfaces on
-- the public booking page when the picked service has a minimum AND
-- the client's selection doesn't meet it, instead of our generic
-- "requires $X minimum for mobile bookings" copy.

alter table public.services
  add column if not exists mobile_minimum_price_note text;

alter table public.services
  add constraint services_mobile_minimum_price_note_len_chk
    check (mobile_minimum_price_note is null or length(mobile_minimum_price_note) <= 500)
    not valid;
alter table public.services validate constraint services_mobile_minimum_price_note_len_chk;

-- Re-emit public_list_services so the new field rides the existing
-- single roundtrip the public booking page already makes. The body
-- otherwise mirrors the 20261010 migration verbatim.

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
  mobile_minimum_price numeric(10, 2),
  mobile_minimum_price_note text
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
    s.mobile_minimum_price,
    s.mobile_minimum_price_note
  from public.services s
  inner join public.booking_links bl on bl.user_id = s.user_id
  where bl.slug = public._resolve_slug_to_canonical(slug_in)
    and bl.active = true
    and s.is_active = true
  order by coalesce(s.featured, false) desc, s.name asc;
$$;
revoke all on function public.public_list_services(text) from public;
grant execute on function public.public_list_services(text) to anon, authenticated;

notify pgrst, 'reload schema';
