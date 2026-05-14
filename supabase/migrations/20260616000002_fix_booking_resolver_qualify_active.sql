-- Second hotfix to public_resolve_booking_slug. The branded-slug
-- path referenced `active` unqualified in a WHERE clause, but
-- `active` is also one of the function's OUT parameter names —
-- Postgres can't tell whether `active = true` means the column or
-- the variable, so the call throws:
--   column reference "active" is ambiguous
-- and the booking page falls into the catch branch with
-- "This booking link isn't available." This was masked by the
-- earlier `bl.id` bug (PR #168 hotfix); the legacy-slug path
-- happened to be qualified, the branded-slug path was not.
--
-- Patch: fully qualify every column reference inside the function
-- body (booking_links.* / profiles.*) so the same trap can't
-- happen for `slug`, `services`, `policies`, `active`, etc. — all
-- of which are OUT parameter names.

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

  -- 1) Legacy random slug path.
  select * into bl from public.booking_links
   where public.booking_links.slug = q
   limit 1;
  if bl.slug is not null then
    select p.public_slug into prof_slug from public.profiles p where p.id = bl.user_id;
    link_id := bl.user_id; user_id := bl.user_id; slug := bl.slug; branded_slug := prof_slug;
    business_name := bl.business_name; intro := bl.intro; services := bl.services; active := bl.active;
    logo_url := bl.logo_url; location_text := bl.location_text; phone := bl.phone;
    policies := bl.policies; accent_color := bl.accent_color; gallery_photos := bl.gallery_photos;
    matched_via := 'legacy_random';
    return next; return;
  end if;

  -- 2) Branded slug → profiles.public_slug → first active link.
  select p.id into prof_user from public.profiles p where p.public_slug = q limit 1;
  if prof_user is null then return; end if;
  select * into bl from public.booking_links
   where public.booking_links.user_id = prof_user
     and public.booking_links.active = true
   order by public.booking_links.created_at desc nulls last
   limit 1;
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

notify pgrst, 'reload schema';
