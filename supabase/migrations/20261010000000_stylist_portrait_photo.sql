-- "Meet your stylist" portrait — a photo of the stylist herself.
--
-- The spotlight / editorial heroes (20260909) reuse `logo_url` for the
-- portrait, but a studio logo (a brand mark) is rarely a photo of the
-- person. This adds a dedicated `stylist_photo_url` so the stylist can
-- upload a picture of herself for the "Meet your stylist" card and the
-- About panel that expands from it. Nullable — the public page falls
-- back to logo_url (then the first gallery photo) when it's empty, so
-- every existing link renders exactly as before.
alter table public.booking_links
  add column if not exists stylist_photo_url text;

-- Resolver returns the new portrait field so the booking page can show
-- it in the same single roundtrip it already uses for the rest of the
-- storefront chrome. Body is otherwise identical to 20260909 — we only
-- widen the RETURNS TABLE and assign the new OUT param in both the
-- legacy-random and branded match branches.
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
  stylist_photo_url text,
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
    stylist_photo_url := bl.stylist_photo_url;
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
  stylist_photo_url := bl.stylist_photo_url;
  matched_via := 'branded';
  return next;
end;
$$;
revoke all on function public.public_resolve_booking_slug(text) from public;
grant execute on function public.public_resolve_booking_slug(text) to anon, authenticated;
