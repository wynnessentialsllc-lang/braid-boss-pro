-- Customizable booking-page header — themes + branded hero.
--
-- Braid Boss Pro's answer to Acuity's customizable booking header,
-- with a luxe-editorial twist. Three new fields on booking_links let
-- a stylist choose how their /book/<slug> hero reads:
--
--   * header_theme — which hero layout the public page renders:
--       'classic'   → the original banner + overlapping logo card
--                     (default, so every existing link is unchanged)
--       'editorial' → centered, serif-forward magazine hero with an
--                     entrance animation
--       'spotlight' → "Meet your stylist" hero: portrait + bio panel
--                     layered over the banner, à la Acuity's flyer
--   * tagline      — a short specialty kicker shown in the hero
--                     (e.g. "Knotless / Boho / Box Braid Specialist").
--                     Distinct from `intro`, which greets visitors in
--                     the body; the tagline brands the hero itself.
--   * about        — the "Meet your stylist" bio paragraph rendered
--                     in the editorial / spotlight heroes.
--
-- All nullable; header_theme is guarded by a CHECK so the column can
-- only ever carry a known layout key (the public page switches on it
-- with inline styles, so an unknown value would silently fall back to
-- classic — the constraint just keeps the data honest).
alter table public.booking_links
  add column if not exists header_theme text,
  add column if not exists tagline text,
  add column if not exists about text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'booking_links_header_theme_chk'
  ) then
    alter table public.booking_links
      add constraint booking_links_header_theme_chk
      check (header_theme is null or header_theme in ('classic', 'editorial', 'spotlight'))
      not valid;
    alter table public.booking_links validate constraint booking_links_header_theme_chk;
  end if;
end $$;

-- Resolver returns the three new header fields so the booking page can
-- render the branded hero in the same single roundtrip it already uses
-- for the rest of the storefront chrome. Body is otherwise identical to
-- 20260617 — we only widen the RETURNS TABLE and assign the new OUT
-- params in both the legacy-random and branded match branches.
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
  header_theme text,
  tagline text,
  about text,
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
    header_theme := bl.header_theme; tagline := bl.tagline; about := bl.about;
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
  header_theme := bl.header_theme; tagline := bl.tagline; about := bl.about;
  matched_via := 'branded';
  return next;
end;
$$;
revoke all on function public.public_resolve_booking_slug(text) from public;
grant execute on function public.public_resolve_booking_slug(text) to anon, authenticated;
