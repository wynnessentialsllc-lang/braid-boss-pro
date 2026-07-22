-- Braider Video Lessons — sell access to teaching videos (v1).
--
-- The real-world model this copies is Gumroad: a braider lists a
-- tutorial, sets a price, and the buyer pays through the braider's OWN
-- Stripe Connect account. After paying, the buyer lands on a private,
-- token-gated watch page that reveals the video — the raw link is
-- NEVER in public HTML, which closes the "leaked Google Drive link"
-- hole of the manual DM-and-CashApp method.
--
-- Access model, also from Gumroad: each lesson is either
--   • 'buy'  — permanent access, or
--   • 'rent' — access for `rental_days` after purchase.
-- The purchase row stamps access_expires_at from the lesson's model at
-- pay time, and the watch RPC refuses an expired token.
--
-- Two tables, mirroring products + product_orders:
--   • video_lessons   — braider-owned catalog row (RLS: owner all).
--                       access_url is the SECRET link; it is never
--                       returned by the public list/get RPCs.
--   • video_purchases — one row per checkout session, service-role
--                       written; owner read-only.

begin;

-- ---- video_lessons ------------------------------------------------------

create table if not exists public.video_lessons (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  slug              text not null,
  title             text not null,
  description       text,
  cover_image_url   text,
  price             numeric(10, 2) not null default 0 check (price >= 0),
  currency          text not null default 'usd',
  -- The SECRET playback link (unlisted YouTube / Vimeo / Loom / Drive).
  -- Server-only: never selected by a public RPC. Revealed to a buyer
  -- exclusively through public_get_video_access(token).
  access_url        text,
  -- Optional public trailer / preview embed shown on the buy page.
  preview_url       text,
  access_model      text not null default 'buy'
                      check (access_model in ('buy', 'rent')),
  -- Days of access when access_model = 'rent'. Required for rent, null
  -- for buy (permanent).
  rental_days       integer
                      check (rental_days is null or rental_days > 0),
  status            text not null default 'draft'
                      check (status in ('draft', 'published')),
  is_featured       boolean not null default false,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- A rental must declare its window; a buy must not.
  constraint video_lessons_rental_window_ck check (
    (access_model = 'rent' and rental_days is not null)
    or (access_model = 'buy' and rental_days is null)
  )
);

create unique index if not exists video_lessons_user_slug_uidx
  on public.video_lessons (user_id, slug);
create index if not exists video_lessons_user_idx
  on public.video_lessons (user_id, status, sort_order);

alter table public.video_lessons enable row level security;
drop policy if exists video_lessons_owner_all on public.video_lessons;
create policy video_lessons_owner_all on public.video_lessons
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.video_lessons to authenticated;

-- ---- video_purchases ----------------------------------------------------

create table if not exists public.video_purchases (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users(id) on delete cascade,
  video_id               uuid not null references public.video_lessons(id) on delete cascade,
  stripe_session_id      text unique,
  stripe_payment_intent  text,
  stripe_account_id      text,
  status                 text not null default 'pending'
                           check (status in ('pending', 'paid', 'refunded', 'cancelled', 'failed')),
  amount_total           numeric(10, 2) not null default 0,
  application_fee        numeric(10, 2),
  currency               text not null default 'usd',
  buyer_name             text,
  buyer_email            text,
  -- Bearer token → the /watch/<token> page. Minted at row creation so
  -- the success redirect and the emailed link can both use it.
  access_token           text unique,
  -- Stamped at pay time from the lesson's access_model: null for a
  -- permanent buy, now()+rental_days for a rent.
  access_expires_at      timestamptz,
  metadata               jsonb not null default '{}'::jsonb,
  paid_at                timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists video_purchases_user_idx
  on public.video_purchases (user_id, created_at desc);
create index if not exists video_purchases_video_idx
  on public.video_purchases (video_id, status);
create index if not exists video_purchases_session_idx
  on public.video_purchases (stripe_session_id);

alter table public.video_purchases enable row level security;
drop policy if exists video_purchases_owner_select on public.video_purchases;
create policy video_purchases_owner_select on public.video_purchases
  for select to authenticated using (user_id = auth.uid());

-- ---- Public RPC: list a braider's published lessons ---------------------
-- No access_url — buy page only shows title / price / cover / preview.
create or replace function public.public_list_videos(slug_in text)
returns table (
  id                uuid,
  title             text,
  slug              text,
  description       text,
  cover_image_url   text,
  preview_url       text,
  price             numeric,
  currency          text,
  access_model      text,
  rental_days       integer,
  is_featured       boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved record;
begin
  select * into resolved
    from public.public_resolve_booking_slug(slug_in)
    limit 1;
  if resolved.user_id is null then
    return;
  end if;
  return query
    select
      v.id, v.title, v.slug, v.description, v.cover_image_url, v.preview_url,
      v.price, v.currency, v.access_model, v.rental_days, v.is_featured
    from public.video_lessons v
    where v.user_id = resolved.user_id
      and v.status = 'published'
    order by v.is_featured desc, v.sort_order asc, v.created_at desc;
end $$;

revoke all on function public.public_list_videos(text) from public;
grant execute on function public.public_list_videos(text) to anon, authenticated;

-- ---- Public RPC: get one lesson for the buy page ------------------------
-- Adds the connected-account fields the checkout route needs. Still no
-- access_url.
create or replace function public.public_get_video(
  slug_in text,
  video_slug_in text
)
returns table (
  id                       uuid,
  user_id                  uuid,
  title                    text,
  slug                     text,
  description              text,
  cover_image_url          text,
  preview_url              text,
  price                    numeric,
  currency                 text,
  access_model             text,
  rental_days              integer,
  stylist_account_id       text,
  stylist_charges_enabled  boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved record;
begin
  select * into resolved
    from public.public_resolve_booking_slug(slug_in)
    limit 1;
  if resolved.user_id is null then
    return;
  end if;
  return query
    select
      v.id, v.user_id, v.title, v.slug, v.description, v.cover_image_url, v.preview_url,
      v.price, v.currency, v.access_model, v.rental_days,
      prof.stripe_connect_account_id as stylist_account_id,
      coalesce(prof.stripe_connect_charges_enabled, false) as stylist_charges_enabled
    from public.video_lessons v
    left join public.profiles prof on prof.id = v.user_id
    where v.user_id = resolved.user_id
      and v.status = 'published'
      and v.slug = video_slug_in
    limit 1;
end $$;

revoke all on function public.public_get_video(text, text) from public;
grant execute on function public.public_get_video(text, text) to anon, authenticated;

-- ---- Public RPC: resolve a paid token → the video (the gate) ------------
-- This is the ONLY path that returns access_url, and only for a PAID,
-- unexpired purchase. Powers /watch/<token>.
create or replace function public.public_get_video_access(token_in text)
returns table (
  ok                boolean,
  reason            text,
  title             text,
  description       text,
  access_url        text,
  access_model      text,
  access_expires_at timestamptz,
  buyer_name        text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  pur public.video_purchases%rowtype;
  vid public.video_lessons%rowtype;
begin
  if token_in is null or length(trim(token_in)) = 0 then
    return query select false, 'invalid_token', null::text, null::text, null::text, null::text, null::timestamptz, null::text;
    return;
  end if;

  select * into pur from public.video_purchases where access_token = token_in limit 1;
  if pur.id is null then
    return query select false, 'not_found', null::text, null::text, null::text, null::text, null::timestamptz, null::text;
    return;
  end if;
  if pur.status <> 'paid' then
    return query select false, 'not_paid', null::text, null::text, null::text, null::text, null::timestamptz, null::text;
    return;
  end if;
  if pur.access_expires_at is not null and pur.access_expires_at < now() then
    return query select false, 'expired', null::text, null::text, null::text, pur.access_expires_at::timestamptz, null::text, null::text;
    return;
  end if;

  select * into vid from public.video_lessons where id = pur.video_id limit 1;
  return query
    select true, null::text, vid.title, vid.description, vid.access_url,
           vid.access_model, pur.access_expires_at, pur.buyer_name;
end $$;

revoke all on function public.public_get_video_access(text) from public;
grant execute on function public.public_get_video_access(text) to anon, authenticated;

-- ---- Webhook RPC: mark a purchase paid ----------------------------------
-- Flips a pending purchase to paid (idempotent), stamps
-- access_expires_at from the lesson's access model, and returns the
-- token + title for the receipt email. Does NOT create rows.
create or replace function public.mark_video_purchase_paid(
  session_id_in      text,
  payment_intent_in  text,
  amount_total_in    numeric,
  buyer_email_in     text,
  buyer_name_in      text
)
returns table (
  purchase_id       uuid,
  already_paid      boolean,
  access_token      text,
  buyer_email       text,
  buyer_name        text,
  video_title       text,
  access_model      text,
  access_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.video_purchases%rowtype;
  vid      public.video_lessons%rowtype;
  new_expiry timestamptz;
begin
  select * into existing
    from public.video_purchases
    where stripe_session_id = session_id_in
    limit 1;
  if existing.id is null then
    return;
  end if;

  select * into vid from public.video_lessons where id = existing.video_id limit 1;

  if existing.status <> 'paid' then
    -- Rentals expire rental_days from the moment of payment; buys never.
    if vid.access_model = 'rent' and vid.rental_days is not null then
      new_expiry := now() + make_interval(days := vid.rental_days);
    else
      new_expiry := null;
    end if;

    update public.video_purchases
    set status = 'paid',
        stripe_payment_intent = coalesce(stripe_payment_intent, payment_intent_in),
        buyer_email = coalesce(buyer_email, buyer_email_in),
        buyer_name = coalesce(buyer_name, buyer_name_in),
        amount_total = coalesce(nullif(amount_total, 0), amount_total_in),
        access_expires_at = new_expiry,
        paid_at = now(),
        updated_at = now()
    where id = existing.id;

    existing.access_expires_at := new_expiry;
  end if;

  return query
    select
      existing.id,
      (existing.status = 'paid') as already_paid,
      existing.access_token,
      coalesce(existing.buyer_email, buyer_email_in),
      coalesce(existing.buyer_name, buyer_name_in),
      vid.title,
      vid.access_model,
      existing.access_expires_at;
end $$;

revoke all on function public.mark_video_purchase_paid(text, text, numeric, text, text) from public;
grant execute on function public.mark_video_purchase_paid(text, text, numeric, text, text) to service_role;

-- ---- Reload PostgREST schema cache --------------------------------------
notify pgrst, 'reload schema';

commit;
