-- Public stylist reviews RPC — readable client reviews behind a
-- star rating, used by both the /discover marketplace card and the
-- public /book/<slug> booking page.
--
-- Returns ONLY public-safe columns: star rating, the public review
-- text (notes), the reviewer's chosen display name, the date.
-- private_feedback / appointment_id / would_book_again are never
-- returned. Same status <> 'hidden' filter the marketplace card's
-- rating count uses, so count and content always agree.
--
-- No marketplace gate — a /book/<slug> page is already public by
-- slug, so a stylist's reviews show there whether or not they
-- opted into the marketplace.

create or replace function public.public_stylist_reviews(slug_in text)
returns table (
  stars        integer,
  notes        text,
  display_name text,
  submitted_at timestamptz
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    ar.stars,
    ar.notes,
    ar.display_name,
    ar.submitted_at
  from public.booking_links bl
  join public.appointment_reviews ar on ar.user_id = bl.user_id
  where bl.slug = slug_in
    and bl.active = true
    and ar.status <> 'hidden'
    and ar.stars is not null
  order by ar.submitted_at desc nulls last
  limit 50;
$$;

revoke all on function public.public_stylist_reviews(text) from public;
grant execute on function public.public_stylist_reviews(text) to anon, authenticated;
