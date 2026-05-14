-- Branded public booking slugs.
--
-- Stylists can set a memorable URL like /book/sbw-braiding instead of
-- the random /book/hfqcy1js. Random booking_links.slug values keep
-- working — this layers on top:
--   * profiles.public_slug   — per-user branded slug (nullable, unique)
--   * public_resolve_booking_slug(slug)  → booking_link row by either
--     branded slug OR random slug
--   * public_check_slug_available(slug)  → owner-side availability check
--   * set_my_public_slug(slug)           → owner self-update with
--     reserved-word + format guards
--
-- Future-proofing: the same profiles.public_slug can power /<slug>
-- storefronts later without a second column.

alter table public.profiles
  add column if not exists public_slug text;

-- Per-spec: lowercase, no spaces, letters/numbers/hyphens, 3..40 chars.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_public_slug_format_chk'
  ) then
    alter table public.profiles
      add constraint profiles_public_slug_format_chk
      check (
        public_slug is null
        or public_slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$'
      ) not valid;
    alter table public.profiles validate constraint profiles_public_slug_format_chk;
  end if;
end $$;

create unique index if not exists profiles_public_slug_uidx
  on public.profiles (public_slug)
  where public_slug is not null;

-- Reserved slugs we'll never hand out — duplicated client-side in
-- lib/publicSlug.ts for fast feedback. Server is the source of truth.
create or replace function public._reserved_public_slugs()
returns setof text
language sql
immutable
as $$
  values
    ('admin'), ('api'), ('dashboard'), ('pricing'), ('support'),
    ('login'), ('signup'), ('book'), ('shop'), ('app'),
    ('settings'), ('help'), ('privacy'), ('terms'),
    ('account'), ('billing'), ('checkout'), ('logout'),
    ('signin'), ('register'), ('reset'), ('verify'), ('callback'),
    ('webhook'), ('static'), ('public'), ('assets'), ('favicon'),
    ('manifest'), ('robots'), ('sitemap'), ('admin-panel'),
    ('braid-boss-pro'), ('braidbosspro'), ('me'), ('user'), ('users'),
    ('profile'), ('profiles'), ('contract'), ('pay'), ('review'),
    ('booking'), ('reviews'), ('gallery'), ('storefront');
$$;

-- Resolve a slug coming off /book/<slug>. Tries the legacy
-- booking_links.slug first (so existing random links keep working
-- with one indexed lookup), then falls back to the branded
-- profiles.public_slug → first active booking_link for that user.
-- Returns the canonical link row + which slug type matched, so the
-- booking page can decide whether to redirect to the branded URL.
create or replace function public.public_resolve_booking_slug(
  slug_in text
)
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
  matched_via text  -- 'legacy_random' | 'branded'
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

  -- 1. Legacy random slug.
  select * into bl from public.booking_links where slug = q limit 1;
  if bl.id is not null then
    select p.public_slug into prof_slug from public.profiles p where p.id = bl.user_id;
    link_id := bl.id;
    user_id := bl.user_id;
    slug := bl.slug;
    branded_slug := prof_slug;
    business_name := bl.business_name;
    intro := bl.intro;
    services := bl.services;
    active := bl.active;
    logo_url := bl.logo_url;
    location_text := bl.location_text;
    phone := bl.phone;
    policies := bl.policies;
    accent_color := bl.accent_color;
    gallery_photos := bl.gallery_photos;
    matched_via := 'legacy_random';
    return next;
    return;
  end if;

  -- 2. Branded slug → user → first active booking_link.
  select id into prof_user from public.profiles where public_slug = q limit 1;
  if prof_user is null then return; end if;
  select * into bl from public.booking_links
  where booking_links.user_id = prof_user
    and active = true
  order by created_at desc nulls last
  limit 1;
  if bl.id is null then return; end if;
  link_id := bl.id;
  user_id := bl.user_id;
  slug := bl.slug;
  branded_slug := q;
  business_name := bl.business_name;
  intro := bl.intro;
  services := bl.services;
  active := bl.active;
  logo_url := bl.logo_url;
  location_text := bl.location_text;
  phone := bl.phone;
  policies := bl.policies;
  accent_color := bl.accent_color;
  gallery_photos := bl.gallery_photos;
  matched_via := 'branded';
  return next;
end;
$$;

revoke all on function public.public_resolve_booking_slug(text) from public;
grant execute on function public.public_resolve_booking_slug(text) to anon, authenticated;

-- Owner-side: is this branded slug available for me to claim? Returns
-- a struct so the UI can surface a tailored message. Considers reserved
-- words, format, and uniqueness across profiles + booking_links.
create or replace function public.public_check_slug_available(
  slug_in text
)
returns table (
  ok boolean,
  reason text  -- 'available' | 'invalid_format' | 'too_short' | 'too_long' | 'reserved' | 'taken'
)
language plpgsql
security definer
set search_path = public
as $$
declare
  q text := lower(coalesce(trim(slug_in), ''));
  caller uuid := auth.uid();
  conflict_count integer;
begin
  if q = '' or length(q) < 3 then ok := false; reason := 'too_short'; return next; return; end if;
  if length(q) > 40 then ok := false; reason := 'too_long'; return next; return; end if;
  if q !~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$' then
    ok := false; reason := 'invalid_format'; return next; return;
  end if;
  if exists (select 1 from public._reserved_public_slugs() r(s) where r.s = q) then
    ok := false; reason := 'reserved'; return next; return;
  end if;
  -- Conflict with any other user's branded slug, or any booking_link's
  -- random slug (we don't want a branded slug to collide with somebody
  -- else's old random link).
  select count(*) into conflict_count
  from (
    select 1 from public.profiles p
    where p.public_slug = q
      and (caller is null or p.id <> caller)
    union all
    select 1 from public.booking_links bl
    where bl.slug = q
      and (caller is null or bl.user_id <> caller)
  ) collisions;
  if conflict_count > 0 then ok := false; reason := 'taken'; return next; return; end if;
  ok := true; reason := 'available'; return next;
end;
$$;

revoke all on function public.public_check_slug_available(text) from public;
grant execute on function public.public_check_slug_available(text) to authenticated;

-- Owner self-update. Server-side guard so a savvy client can't bypass
-- the format / reserved / collision rules. Pass null to clear.
create or replace function public.set_my_public_slug(
  slug_in text
)
returns table (ok boolean, slug text, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  q text;
  check_row record;
begin
  if caller is null then ok := false; slug := null; reason := 'auth_required'; return next; return; end if;
  if slug_in is null or trim(slug_in) = '' then
    update public.profiles set public_slug = null where id = caller;
    if not found then
      insert into public.profiles (id, public_slug) values (caller, null)
      on conflict (id) do update set public_slug = null;
    end if;
    ok := true; slug := null; reason := 'cleared'; return next; return;
  end if;
  q := lower(trim(slug_in));
  select * into check_row from public.public_check_slug_available(q);
  if not check_row.ok then
    ok := false; slug := null; reason := check_row.reason; return next; return;
  end if;
  -- Upsert by id so a profile that doesn't exist yet is created on first set.
  insert into public.profiles (id, public_slug) values (caller, q)
  on conflict (id) do update set public_slug = excluded.public_slug;
  ok := true; slug := q; reason := 'saved'; return next;
end;
$$;

revoke all on function public.set_my_public_slug(text) from public;
grant execute on function public.set_my_public_slug(text) to authenticated;
