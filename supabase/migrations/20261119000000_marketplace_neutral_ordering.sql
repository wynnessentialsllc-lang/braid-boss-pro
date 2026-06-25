-- Marketplace — neutral ordering.
--
-- Product decision: Braid Boss Pro is a neutral pipe between clients and
-- braiders, not a trust broker. We don't endorse or rank braiders, so the
-- directory no longer orders by review count / rating (an implicit ranking
-- by us). Ratings are still DISPLAYED on each card — that's the braider's
-- own data — we just don't decide who shows first.
--
--   * public_discover_stylists  -> fully randomized (equal rotation/exposure)
--   * public_match_braiders     -> photo-match relevance first (that's
--                                  answering the client's request, not a
--                                  ranking of braiders), then randomized ties
--
-- Only the ORDER BY changes; bodies are otherwise identical to
-- 20261117 (discover) and 20261118 (match).

create or replace function public.public_discover_stylists(
  city_in    text    default null,
  style_in   text    default null,
  mobile_only boolean default false,
  min_rating numeric default null
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
  travels         boolean
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
  -- Neutral: no platform ranking. Equal rotation across listed braiders.
  order by random();
$$;

revoke all on function public.public_discover_stylists(text, text, boolean, numeric) from public;
grant execute on function public.public_discover_stylists(text, text, boolean, numeric) to anon, authenticated;

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
    and m.matched is not null
    and (
      city_in is null or trim(city_in) = ''
      or bl.business_city ilike '%' || trim(city_in) || '%'
    )
  -- Relevance to the client's photo first (answering their request, not a
  -- ranking of braiders); randomize equally-relevant braiders.
  order by coalesce(array_length(m.matched, 1), 0) desc,
           random();
$$;

revoke all on function public.public_match_braiders(text[], text) from public;
grant execute on function public.public_match_braiders(text[], text) to anon, authenticated;
