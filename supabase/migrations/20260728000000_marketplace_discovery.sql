-- Mini-marketplace V1 — public "Find a braider near you" discovery.
--
-- Roadmap item #14. A public, no-login page lists opted-in Braid
-- Boss Pro stylists, searchable by city. Each listing is a rich
-- card (logo, area, service price range, star rating) linking to
-- the stylist's existing public booking page.
--
-- V1 location model is city text — booking_links already carries
-- business_city / business_state, so the only new column is the
-- opt-in flag. Distance-radius geo is a deliberate later phase.

-- ---------------------------------------------------------------
-- Opt-in flag
-- ---------------------------------------------------------------
-- Off by default — a stylist is only listed once they explicitly
-- opt in from the in-app Marketplace screen. The discovery RPC
-- additionally requires booking_links.active = true, so pausing a
-- booking link also pulls the marketplace listing.
alter table public.booking_links
  add column if not exists marketplace_enabled boolean not null default false;

create index if not exists booking_links_marketplace_idx
  on public.booking_links (marketplace_enabled, business_city)
  where marketplace_enabled = true;

-- ---------------------------------------------------------------
-- Discovery RPC — anon-callable
-- ---------------------------------------------------------------
-- Returns one row per listed stylist with the card payload the
-- /discover page renders: slug (for the booking-page link),
-- business name, logo, city/state, intro blurb, service price
-- range, and star rating. SECURITY DEFINER so anonymous visitors
-- can read across stylists without a table grant; it only ever
-- exposes stylists who opted in AND have an active booking link,
-- and only the public-safe columns below.
--
-- Empty / null city_in returns every listed stylist (browse-all);
-- a non-empty city does a case-insensitive substring match so
-- "los angeles" / "Los Angeles" / "angeles" all hit.
create or replace function public.public_discover_stylists(city_in text default null)
returns table (
  slug            text,
  business_name   text,
  logo_url        text,
  business_city   text,
  business_state  text,
  intro           text,
  price_min       numeric,
  price_max       numeric,
  rating_avg      numeric,
  rating_count    integer
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    bl.slug,
    bl.business_name,
    bl.logo_url,
    bl.business_city,
    bl.business_state,
    bl.intro,
    sv.price_min,
    sv.price_max,
    rv.rating_avg,
    coalesce(rv.rating_count, 0)::integer
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
  where bl.active = true
    and bl.marketplace_enabled = true
    and bl.slug is not null
    and (
      city_in is null
      or trim(city_in) = ''
      or bl.business_city ilike '%' || trim(city_in) || '%'
    )
  -- Best-reviewed stylists first; alphabetical as the tiebreaker.
  order by coalesce(rv.rating_count, 0) desc,
           rv.rating_avg desc nulls last,
           bl.business_name asc;
$$;

revoke all on function public.public_discover_stylists(text) from public;
grant execute on function public.public_discover_stylists(text) to anon, authenticated;
