-- Branded booking page → storefront. Adds the profile fields the
-- header surfaces (banner, location, socials, years) and a per-
-- service featured flag. All nullable / default-false so existing
-- booking links keep working unchanged.
--
-- Companion to PR #167 (branded slugs). The storefront UI reads
-- everything off the same booking_links row through the resolver
-- RPC, so anonymous /book/<slug> visitors get the new fields with
-- one network call.

alter table public.booking_links
  add column if not exists banner_image_url text,
  add column if not exists instagram_url text,
  add column if not exists tiktok_url text,
  add column if not exists website_url text,
  add column if not exists business_city text,
  add column if not exists business_state text,
  add column if not exists years_in_business smallint;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'booking_links_years_in_business_chk'
  ) then
    alter table public.booking_links
      add constraint booking_links_years_in_business_chk
      check (years_in_business is null or (years_in_business >= 0 and years_in_business <= 80))
      not valid;
    alter table public.booking_links validate constraint booking_links_years_in_business_chk;
  end if;
end $$;

alter table public.services
  add column if not exists featured boolean not null default false;

create index if not exists services_user_featured_idx
  on public.services (user_id, featured) where featured = true;

-- Resolver returns the new profile fields so the booking page can
-- render the branded header in one roundtrip.
drop function if exists public.public_resolve_booking_slug(text);
create or replace function public.public_resolve_booking_slug(slug_in text)
returns table (
  link_id uuid,
  user_id uuid,
  slug text,
  branded_slug text,
  business_name text,
  intro text,
  services jsonb,
  active boolean,
  logo_url text,
  banner_image_url text,
  location_text text,
  business_city text,
  business_state text,
  phone text,
  policies text,
  accent_color text,
  gallery_photos jsonb,
  instagram_url text,
  tiktok_url text,
  website_url text,
  years_in_business smallint,
  matched_via text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  q text := lower(coalesce(trim(slug_in), ''));
  bl public.booking_links%rowtype;
  prof_user uuid;
  prof_slug text;
begin
  if q = '' then return; end if;
  select * into bl from public.booking_links where booking_links.slug = q limit 1;
  -- booking_links has no `id` column (PK is slug); use slug for the
  -- existence check and surface link_id := bl.user_id for client
  -- truthy-checks. See 20260616000001 for the original hotfix.
  if bl.slug is not null then
    select p.public_slug into prof_slug from public.profiles p where p.id = bl.user_id;
    link_id := bl.user_id; user_id := bl.user_id; slug := bl.slug; branded_slug := prof_slug;
    business_name := bl.business_name; intro := bl.intro; services := bl.services; active := bl.active;
    logo_url := bl.logo_url; banner_image_url := bl.banner_image_url;
    location_text := bl.location_text; business_city := bl.business_city; business_state := bl.business_state;
    phone := bl.phone; policies := bl.policies; accent_color := bl.accent_color; gallery_photos := bl.gallery_photos;
    instagram_url := bl.instagram_url; tiktok_url := bl.tiktok_url; website_url := bl.website_url;
    years_in_business := bl.years_in_business;
    matched_via := 'legacy_random';
    return next; return;
  end if;
  select p.id into prof_user from public.profiles p where p.public_slug = q limit 1;
  if prof_user is null then return; end if;
  -- Qualify every column ref — `active`, `slug`, `services`,
  -- `policies`, etc. are also OUT param names, so unqualified refs
  -- throw "column reference is ambiguous". See 20260616000002 hotfix.
  select * into bl from public.booking_links
   where public.booking_links.user_id = prof_user
     and public.booking_links.active = true
   order by public.booking_links.created_at desc nulls last
   limit 1;
  if bl.slug is null then return; end if;
  link_id := bl.user_id; user_id := bl.user_id; slug := bl.slug; branded_slug := q;
  business_name := bl.business_name; intro := bl.intro; services := bl.services; active := bl.active;
  logo_url := bl.logo_url; banner_image_url := bl.banner_image_url;
  location_text := bl.location_text; business_city := bl.business_city; business_state := bl.business_state;
  phone := bl.phone; policies := bl.policies; accent_color := bl.accent_color; gallery_photos := bl.gallery_photos;
  instagram_url := bl.instagram_url; tiktok_url := bl.tiktok_url; website_url := bl.website_url;
  years_in_business := bl.years_in_business;
  matched_via := 'branded';
  return next;
end;
$$;
revoke all on function public.public_resolve_booking_slug(text) from public;
grant execute on function public.public_resolve_booking_slug(text) to anon, authenticated;

-- public_list_services surfaces `featured` so the booking page can
-- pick out the featured row without a second RPC. Featured services
-- sort first within the same alpha order so they're visible above
-- the fold.
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
  category_id uuid,
  featured boolean
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
    s.contract_template_id, s.category_id, coalesce(s.featured, false) as featured
  from public.services s
  inner join public.booking_links bl on bl.user_id = s.user_id
  where bl.slug = public._resolve_slug_to_canonical(slug_in)
    and bl.active = true
    and s.is_active = true
  order by coalesce(s.featured, false) desc, s.name asc;
$$;
revoke all on function public.public_list_services(text) from public;
grant execute on function public.public_list_services(text) to anon, authenticated;
