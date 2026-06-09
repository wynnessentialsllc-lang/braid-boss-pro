-- Hair sourcing v1 — serve braiders who DON'T supply the hair.
--
-- Until now the app implied the stylist supplies the hair (the
-- services.hair_included boolean + "hair included" copy). Many braiders
-- require the client to bring their own. This makes hair sourcing an
-- explicit per-service choice plus a structured "what to buy" spec.
--
--   hair_sourcing:
--     'included' — stylist supplies (default; existing behavior)
--     'client'   — client must bring their own hair
--     'choice'   — client picks: bring own, or buy from the stylist
--   hair_spec (jsonb): { brand, color, packs, prep, buyUrl }
--     the shopping list shown to the client when they supply the hair.
--
-- Default 'included' on every existing row → zero behavior change until
-- a stylist opts a service into client-supplied.

alter table public.services
  add column if not exists hair_sourcing text not null default 'included',
  add column if not exists hair_spec jsonb not null default '{}'::jsonb;

alter table public.services
  drop constraint if exists services_hair_sourcing_chk;
alter table public.services
  add constraint services_hair_sourcing_chk
    check (hair_sourcing in ('included', 'client', 'choice')) not valid;
alter table public.services validate constraint services_hair_sourcing_chk;

-- Re-emit public_list_services so the two new fields ride the existing
-- single roundtrip the public booking page already makes. Body mirrors
-- 20261011 verbatim with hair_sourcing + hair_spec appended.

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
  mobile_minimum_price_note text,
  hair_sourcing text,
  hair_spec jsonb
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
    s.mobile_minimum_price_note,
    coalesce(s.hair_sourcing, 'included'),
    coalesce(s.hair_spec, '{}'::jsonb)
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
