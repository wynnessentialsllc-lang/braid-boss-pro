-- Marketplace Phase 1 — Square-style "auto-listed" model.
--
-- V1 (20260728) was opt-IN: a stylist only appeared on /discover after
-- flipping booking_links.marketplace_enabled. That left the directory
-- empty. Phase 1 flips to the Square Go model: every COMPLETE + ACTIVE
-- stylist is auto-listed, with a one-tap "hide me" opt-OUT control that
-- lives in the in-app Account & Sync area.
--
-- Three pieces:
--   1. marketplace_hidden — the new opt-out flag (default false = listed).
--   2. services.style_tags — a CANONICAL braid-style vocabulary so the
--      /discover page can filter across stylists (per-stylist
--      service_categories are free-form and not cross-comparable).
--   3. public_discover_stylists — rewritten with a completeness gate,
--      the opt-out rule, style/mobile/rating filters, and a gallery-first
--      cover photo + style chips in the card payload.
--
-- A one-time "you're now listed" notification helper is defined at the
-- bottom but deliberately NOT invoked here — see the comment there.

-- ---------------------------------------------------------------
-- 1. Opt-out flag
-- ---------------------------------------------------------------
-- Default false => listed. Stylists who want out flip this from the
-- Account & Sync screen. The legacy marketplace_enabled column is left
-- in place (the old toggle still reads it) but is no longer REQUIRED by
-- the discovery RPC — completeness + not-hidden is the new rule.
alter table public.booking_links
  add column if not exists marketplace_hidden boolean not null default false;

-- ---------------------------------------------------------------
-- 2. Canonical braid-style vocabulary on services
-- ---------------------------------------------------------------
-- Fixed slug set, approved with the product owner. The CHECK keeps the
-- column to this vocabulary so /discover filters stay consistent across
-- every stylist. Edit the array here (and the app's STYLE_TAGS list) to
-- evolve the taxonomy.
alter table public.services
  add column if not exists style_tags text[] not null default '{}'::text[];

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'services_style_tags_chk'
  ) then
    alter table public.services
      add constraint services_style_tags_chk
      check (
        style_tags <@ array[
          'knotless','boho','micros','feed_in','cornrows',
          'twists','locs','passion_twists','kids','takedown'
        ]::text[]
      )
      not valid;
    alter table public.services validate constraint services_style_tags_chk;
  end if;
end $$;

-- GIN index so the style filter (style_tags && array[...]) stays fast.
create index if not exists services_style_tags_gin
  on public.services using gin (style_tags);

-- ---------------------------------------------------------------
-- 3. Discovery RPC — rewritten
-- ---------------------------------------------------------------
-- Drop the V1 (text-only) signature first so the new defaulted one
-- doesn't create an ambiguous overload. Callers passing only city_in
-- keep working because the new params all default.
drop function if exists public.public_discover_stylists(text);

create or replace function public.public_discover_stylists(
  city_in    text    default null,
  style_in   text    default null,   -- one canonical style slug, or null
  mobile_only boolean default false,  -- only stylists who travel to clients
  min_rating numeric default null     -- floor on average star rating
)
returns table (
  slug            text,
  business_name   text,
  logo_url        text,
  cover_photo     text,        -- first gallery photo, else logo
  business_city   text,
  business_state  text,
  intro           text,
  price_min       numeric,
  price_max       numeric,
  rating_avg      numeric,
  rating_count    integer,
  style_tags      text[],      -- distinct styles this stylist offers
  travels         boolean      -- offers mobile / travels to client
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    bl.slug,
    bl.business_name,
    bl.logo_url,
    coalesce(
      (select gp->>'url'
         from jsonb_array_elements(bl.gallery_photos) gp
        order by (gp->>'sort')::int nulls last
        limit 1),
      bl.logo_url
    ) as cover_photo,
    bl.business_city,
    bl.business_state,
    bl.intro,
    sv.price_min,
    sv.price_max,
    rv.rating_avg,
    coalesce(rv.rating_count, 0)::integer,
    coalesce(st.style_tags, '{}'::text[]) as style_tags,
    (coalesce(bl.mobile_radius_miles, 0) > 0) as travels
  from public.booking_links bl
  left join lateral (
    select min(s.base_price) as price_min,
           max(s.base_price) as price_max
    from public.services s
    where s.user_id = bl.user_id
      and s.is_active = true
      and s.base_price > 0
  ) sv on true
  left join lateral (
    select round(avg(ar.stars)::numeric, 1) as rating_avg,
           count(*)                          as rating_count
    from public.appointment_reviews ar
    where ar.user_id = bl.user_id
      and ar.status <> 'hidden'
      and ar.stars is not null
  ) rv on true
  left join lateral (
    select array_agg(distinct tag order by tag) as style_tags
    from (
      select unnest(s.style_tags) as tag
      from public.services s
      where s.user_id = bl.user_id and s.is_active = true
    ) tags
  ) st on true
  where
    -- ---- completeness gate (Square: "your profile is already live") ----
    bl.active = true
    and bl.slug is not null
    and coalesce(trim(bl.business_city), '') <> ''
    and exists (
      select 1 from public.services s
      where s.user_id = bl.user_id and s.is_active = true and s.base_price > 0
    )
    and (
      coalesce(bl.logo_url, '') <> ''
      or jsonb_array_length(bl.gallery_photos) > 0
    )
    -- ---- opt-out ----
    and bl.marketplace_hidden = false
    -- ---- filters ----
    and (
      city_in is null or trim(city_in) = ''
      or bl.business_city ilike '%' || trim(city_in) || '%'
    )
    and (
      style_in is null or trim(style_in) = ''
      or exists (
        select 1 from public.services s
        where s.user_id = bl.user_id
          and s.is_active = true
          and style_in = any (s.style_tags)
      )
    )
    and (mobile_only = false or coalesce(bl.mobile_radius_miles, 0) > 0)
    and (min_rating is null or coalesce(rv.rating_avg, 0) >= min_rating)
  order by coalesce(rv.rating_count, 0) desc,
           rv.rating_avg desc nulls last,
           bl.business_name asc;
$$;

revoke all on function public.public_discover_stylists(text, text, boolean, numeric) from public;
grant execute on function public.public_discover_stylists(text, text, boolean, numeric) to anon, authenticated;

-- ---------------------------------------------------------------
-- One-time launch notification helper (NOT auto-run)
-- ---------------------------------------------------------------
-- Flipping to opt-out means every complete + active stylist becomes
-- discoverable. Square pairs this with a "your profile is now live"
-- heads-up. This helper enqueues exactly one such notification per
-- currently-eligible stylist, deduped so re-running is a no-op.
--
-- It is intentionally NOT called inside this migration: a mass send is
-- a real-world side effect that should be triggered deliberately (e.g.
-- `select public.enqueue_marketplace_launch_notifications();`) once the
-- hide toggle is live in production, not silently at deploy time.
create or replace function public.enqueue_marketplace_launch_notifications()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inserted integer := 0;
begin
  with eligible as (
    select bl.user_id, bl.business_name
    from public.booking_links bl
    where bl.active = true
      and bl.slug is not null
      and coalesce(trim(bl.business_city), '') <> ''
      and bl.marketplace_hidden = false
      and (
        coalesce(bl.logo_url, '') <> ''
        or jsonb_array_length(bl.gallery_photos) > 0
      )
      and exists (
        select 1 from public.services s
        where s.user_id = bl.user_id and s.is_active = true and s.base_price > 0
      )
  ),
  ins as (
    insert into public.notification_queue
      (user_id, channel, notification_type, subject, body, dedupe_key)
    select
      e.user_id,
      'email',
      'marketplace_launch',
      'You''re now on the Braid Boss directory',
      'Good news — ' || coalesce(e.business_name, 'your studio') ||
        ' is now listed on the public Find a Braider directory, so new ' ||
        'clients can discover and book you. Want to stay private? You can ' ||
        'hide your listing anytime from Account & Sync in the app.',
      'marketplace_launch:' || e.user_id::text
    from eligible e
    where not exists (
      select 1 from public.notification_queue nq
      where nq.dedupe_key = 'marketplace_launch:' || e.user_id::text
    )
    returning 1
  )
  select count(*) into inserted from ins;
  return inserted;
end;
$$;

revoke all on function public.enqueue_marketplace_launch_notifications() from public;
