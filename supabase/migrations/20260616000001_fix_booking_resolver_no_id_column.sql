-- HOTFIX for PR #167. The original public_resolve_booking_slug
-- referenced bl.id, but public.booking_links has no `id` column —
-- its primary key is `slug`. Every /book/<slug> page broke at
-- runtime with `record "bl" has no field "id"`.
--
-- Patch: use bl.slug for the existence check and stamp link_id with
-- bl.user_id so the deployed client's truthy check on row.link_id
-- still passes without an app redeploy.

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
  location_text text,
  phone text,
  policies text,
  accent_color text,
  gallery_photos jsonb,
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
  if bl.slug is not null then
    select p.public_slug into prof_slug from public.profiles p where p.id = bl.user_id;
    link_id := bl.user_id; user_id := bl.user_id; slug := bl.slug; branded_slug := prof_slug;
    business_name := bl.business_name; intro := bl.intro; services := bl.services; active := bl.active;
    logo_url := bl.logo_url; location_text := bl.location_text; phone := bl.phone;
    policies := bl.policies; accent_color := bl.accent_color; gallery_photos := bl.gallery_photos;
    matched_via := 'legacy_random';
    return next; return;
  end if;
  select id into prof_user from public.profiles where public_slug = q limit 1;
  if prof_user is null then return; end if;
  select * into bl from public.booking_links where booking_links.user_id = prof_user and active = true order by created_at desc nulls last limit 1;
  if bl.slug is null then return; end if;
  link_id := bl.user_id; user_id := bl.user_id; slug := bl.slug; branded_slug := q;
  business_name := bl.business_name; intro := bl.intro; services := bl.services; active := bl.active;
  logo_url := bl.logo_url; location_text := bl.location_text; phone := bl.phone;
  policies := bl.policies; accent_color := bl.accent_color; gallery_photos := bl.gallery_photos;
  matched_via := 'branded';
  return next;
end;
$$;
revoke all on function public.public_resolve_booking_slug(text) from public;
grant execute on function public.public_resolve_booking_slug(text) to anon, authenticated;
