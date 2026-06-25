-- Marketplace Phase 2 — "Find My Braider" AI Style-Match ranking RPC.
--
-- The /api/find-braider route classifies a client's inspiration photo into
-- our canonical braid-style vocabulary (the same slugs as
-- services.style_tags), then calls this RPC to rank LISTED braiders by how
-- many of the detected styles they actually offer.
--
-- Mirrors public_discover_stylists' completeness gate + opt-out exactly, so
-- the two stay consistent — a braider can never surface here but not on the
-- main directory. Adds match_count (overlap size) + matched_styles and
-- ranks by match first, then social proof.

create or replace function public.public_match_braiders(
  style_slugs text[],
  city_in     text default null
)
returns table (
  slug            text,
  business_name   text,
  logo_url        text,
  cover_photo     text,
  business_city   text,
  business_state  text,
  intro           text,
  price_min       numeric,
  price_max       numeric,
  rating_avg      numeric,
  rating_count    integer,
  style_tags      text[],
  travels         boolean,
  match_count     integer,
  matched_styles  text[]
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
    (coalesce(bl.mobile_radius_miles, 0) > 0) as travels,
    coalesce(array_length(m.matched, 1), 0) as match_count,
    coalesce(m.matched, '{}'::text[]) as matched_styles
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
  -- The styles this stylist offers that the client's photo matched.
  left join lateral (
    select array_agg(distinct tag order by tag) as matched
    from (
      select unnest(s.style_tags) as tag
      from public.services s
      where s.user_id = bl.user_id and s.is_active = true
    ) tags
    where tag = any (style_slugs)
  ) m on true
  where
    -- ---- same completeness gate + opt-out as public_discover_stylists ----
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
    and bl.marketplace_hidden = false
    -- ---- only braiders who offer at least one detected style ----
    and m.matched is not null
    -- ---- optional city narrowing ----
    and (
      city_in is null or trim(city_in) = ''
      or bl.business_city ilike '%' || trim(city_in) || '%'
    )
  order by coalesce(array_length(m.matched, 1), 0) desc,
           coalesce(rv.rating_count, 0) desc,
           rv.rating_avg desc nulls last,
           bl.business_name asc;
$$;

revoke all on function public.public_match_braiders(text[], text) from public;
grant execute on function public.public_match_braiders(text[], text) to anon, authenticated;
