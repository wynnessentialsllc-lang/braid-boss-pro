-- Google review boost.
--
-- Funnels happy clients to the stylist's public Google profile. The
-- internal review form (/review/<token>) still collects first-party
-- star ratings + private feedback; once a client submits a HIGH rating
-- (4-5 stars) we surface a "Share it on Google" CTA pointing at the
-- stylist's Google review URL. Negative feedback stays private.
--
--   1. booking_links.google_review_url — optional, set in the
--      Customize Booking Page editor.
--   2. public_get_review_boost(token_in) — anon RPC the review page
--      calls after a successful submit to fetch that URL. Kept separate
--      from public_get_review_by_token so the existing review-render
--      path is untouched.

alter table public.booking_links
  add column if not exists google_review_url text;

create or replace function public.public_get_review_boost(token_in text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_url  text;
begin
  if token_in is null or trim(token_in) = '' then
    return jsonb_build_object('ok', false);
  end if;

  select user_id into v_user
  from public.appointments
  where review_request_token = token_in
  limit 1;
  if v_user is null then
    return jsonb_build_object('ok', false);
  end if;

  select nullif(trim(google_review_url), '')
    into v_url
  from public.booking_links
  where user_id = v_user
  order by created_at desc nulls last
  limit 1;

  return jsonb_build_object('ok', true, 'google_review_url', v_url);
end;
$$;

revoke all on function public.public_get_review_boost(text) from public;
grant execute on function public.public_get_review_boost(text) to anon, authenticated;
