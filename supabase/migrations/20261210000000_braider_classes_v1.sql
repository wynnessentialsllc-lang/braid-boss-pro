-- Braider Classes — ticketed workshops (v1: the money path).
--
-- The real-world model this copies is Eventbrite: a braider publishes
-- a class (title, date/time, price, capacity), students sign up and
-- pay through the braider's OWN Stripe Connect account (direct charge
-- + optional platform application fee, exactly like product_orders /
-- booking-request deposits), and the location / meeting link is only
-- revealed AFTER payment.
--
-- Two tables, mirroring the products + product_orders split:
--   • class_offerings    — braider-owned catalog row (RLS: owner all).
--   • class_registrations — one row per checkout session, written by
--     the service-role webhook; owner read-only (no authenticated
--     writes, same as product_orders).
--
-- Public reads go through SECURITY DEFINER RPCs that resolve the
-- braider via public_resolve_booking_slug, so the anonymous
-- /@handle/classes page can list + open a class without RLS grants —
-- and WITHOUT ever exposing the post-payment access fields
-- (location_text / meeting_url) to a browser that hasn't paid.

begin;

-- ---- class_offerings ----------------------------------------------------

create table if not exists public.class_offerings (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  slug              text not null,
  title             text not null,
  description       text,
  cover_image_url   text,
  -- 'in_person' reveals location_text after payment; 'virtual' reveals
  -- meeting_url after payment. A class is exactly one of the two.
  format            text not null default 'in_person'
                      check (format in ('in_person', 'virtual')),
  price             numeric(10, 2) not null default 0 check (price >= 0),
  currency          text not null default 'usd',
  -- null capacity = unlimited seats. Otherwise seats are capped and the
  -- checkout route refuses to oversell against paid registrations.
  capacity          integer check (capacity is null or capacity >= 0),
  starts_at         timestamptz,
  duration_minutes  integer check (duration_minutes is null or duration_minutes > 0),
  -- IANA tz the braider set the class in (display only; starts_at is
  -- an absolute instant). e.g. 'America/New_York'.
  timezone          text,
  -- Post-payment access fields — NEVER returned by the public list/get
  -- RPCs. Delivered by the webhook (email) + the confirmation page
  -- keyed on a paid registration's access_token.
  location_text     text,
  meeting_url       text,
  status            text not null default 'draft'
                      check (status in ('draft', 'published', 'canceled')),
  is_featured       boolean not null default false,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Slug is URL-facing and unique per braider (the public URL is
-- /@handle/classes/<slug>, already scoped by handle).
create unique index if not exists class_offerings_user_slug_uidx
  on public.class_offerings (user_id, slug);
create index if not exists class_offerings_user_idx
  on public.class_offerings (user_id, status, starts_at);

alter table public.class_offerings enable row level security;
drop policy if exists class_offerings_owner_all on public.class_offerings;
create policy class_offerings_owner_all on public.class_offerings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.class_offerings to authenticated;

-- ---- class_registrations ------------------------------------------------

create table if not exists public.class_registrations (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users(id) on delete cascade,
  class_id               uuid not null references public.class_offerings(id) on delete cascade,
  stripe_session_id      text unique,
  stripe_payment_intent  text,
  stripe_account_id      text,
  status                 text not null default 'pending'
                           check (status in ('pending', 'paid', 'refunded', 'cancelled', 'failed')),
  -- Seats bought in this one checkout (a student can register a friend).
  seats                  integer not null default 1 check (seats > 0),
  amount_total           numeric(10, 2) not null default 0,
  application_fee        numeric(10, 2),
  currency               text not null default 'usd',
  student_name           text,
  student_email          text,
  -- Bearer token for the "you're signed up" confirmation page, so a
  -- student who isn't an app user can still re-open their access
  -- details from the emailed link. Minted at row creation.
  access_token           text unique,
  metadata               jsonb not null default '{}'::jsonb,
  paid_at                timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists class_registrations_user_idx
  on public.class_registrations (user_id, created_at desc);
create index if not exists class_registrations_class_idx
  on public.class_registrations (class_id, status);
create index if not exists class_registrations_session_idx
  on public.class_registrations (stripe_session_id);

alter table public.class_registrations enable row level security;
-- Braider reads their own rosters. Writes are service-role only (the
-- checkout route creates the pending row, the webhook flips it paid),
-- matching product_orders — so no authenticated insert/update/delete.
drop policy if exists class_registrations_owner_select on public.class_registrations;
create policy class_registrations_owner_select on public.class_registrations
  for select to authenticated using (user_id = auth.uid());

-- ---- Helper: seats remaining for a class --------------------------------
-- Counts paid seats and returns null for unlimited-capacity classes.
-- SECURITY DEFINER so the public RPCs (and the checkout route via the
-- service role) can compute availability without a direct table grant.
create or replace function public.class_seats_remaining(class_id_in uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  cap integer;
  taken integer;
begin
  select capacity into cap from public.class_offerings where id = class_id_in;
  if cap is null then
    return null; -- unlimited
  end if;
  select coalesce(sum(seats), 0) into taken
    from public.class_registrations
    where class_id = class_id_in and status = 'paid';
  return greatest(0, cap - taken);
end $$;

revoke all on function public.class_seats_remaining(uuid) from public;
grant execute on function public.class_seats_remaining(uuid) to anon, authenticated, service_role;

-- ---- Public RPC: list a braider's published classes ---------------------
-- Upcoming-or-undated published classes only. Post-payment fields
-- (location_text / meeting_url) are deliberately omitted.
create or replace function public.public_list_classes(slug_in text)
returns table (
  id                uuid,
  title             text,
  slug              text,
  description       text,
  cover_image_url   text,
  format            text,
  price             numeric,
  currency          text,
  capacity          integer,
  seats_remaining   integer,
  starts_at         timestamptz,
  duration_minutes  integer,
  timezone          text,
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
      c.id, c.title, c.slug, c.description, c.cover_image_url,
      c.format, c.price, c.currency, c.capacity,
      public.class_seats_remaining(c.id) as seats_remaining,
      c.starts_at, c.duration_minutes, c.timezone, c.is_featured
    from public.class_offerings c
    where c.user_id = resolved.user_id
      and c.status = 'published'
      and (c.starts_at is null or c.starts_at > now() - interval '2 hours')
    order by c.is_featured desc, c.sort_order asc, c.starts_at asc nulls last, c.created_at desc;
end $$;

revoke all on function public.public_list_classes(text) from public;
grant execute on function public.public_list_classes(text) to anon, authenticated;

-- ---- Public RPC: get one class for the sign-up page ---------------------
-- Returns the connected-account fields the checkout route needs, plus
-- live seats_remaining. Still NO location_text / meeting_url.
create or replace function public.public_get_class(
  slug_in text,
  class_slug_in text
)
returns table (
  id                       uuid,
  user_id                  uuid,
  title                    text,
  slug                     text,
  description              text,
  cover_image_url          text,
  format                   text,
  price                    numeric,
  currency                 text,
  capacity                 integer,
  seats_remaining          integer,
  starts_at                timestamptz,
  duration_minutes         integer,
  timezone                 text,
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
      c.id, c.user_id, c.title, c.slug, c.description, c.cover_image_url,
      c.format, c.price, c.currency, c.capacity,
      public.class_seats_remaining(c.id) as seats_remaining,
      c.starts_at, c.duration_minutes, c.timezone,
      prof.stripe_connect_account_id as stylist_account_id,
      coalesce(prof.stripe_connect_charges_enabled, false) as stylist_charges_enabled
    from public.class_offerings c
    left join public.profiles prof on prof.id = c.user_id
    where c.user_id = resolved.user_id
      and c.status = 'published'
      and c.slug = class_slug_in
    limit 1;
end $$;

revoke all on function public.public_get_class(text, text) from public;
grant execute on function public.public_get_class(text, text) to anon, authenticated;

-- ---- Public RPC: resolve a paid registration's confirmation --------------
-- Keyed on the bearer access_token emailed to the student. Only a
-- PAID registration reveals the class access fields (location_text /
-- meeting_url) — a pending / failed token returns no access details.
create or replace function public.public_get_class_registration(token_in text)
returns table (
  status            text,
  class_title       text,
  format            text,
  starts_at         timestamptz,
  duration_minutes  integer,
  timezone          text,
  seats             integer,
  student_name      text,
  location_text     text,
  meeting_url       text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if token_in is null or length(trim(token_in)) = 0 then
    return;
  end if;
  return query
    select
      r.status,
      c.title as class_title,
      c.format,
      c.starts_at,
      c.duration_minutes,
      c.timezone,
      r.seats,
      r.student_name,
      case when r.status = 'paid' then c.location_text else null end as location_text,
      case when r.status = 'paid' then c.meeting_url else null end as meeting_url
    from public.class_registrations r
    join public.class_offerings c on c.id = r.class_id
    where r.access_token = token_in
    limit 1;
end $$;

revoke all on function public.public_get_class_registration(text) from public;
grant execute on function public.public_get_class_registration(text) to anon, authenticated;

-- ---- Webhook RPC: mark a registration paid ------------------------------
-- Flips a pending registration to paid (idempotent on Stripe retry) and
-- returns the class access details so the webhook can email them. Does
-- NOT create rows — the checkout route owns creation (same contract as
-- mark_product_order_paid).
create or replace function public.mark_class_registration_paid(
  session_id_in        text,
  payment_intent_in    text,
  amount_total_in      numeric,
  student_email_in     text,
  student_name_in      text
)
returns table (
  registration_id  uuid,
  already_paid     boolean,
  access_token     text,
  student_email    text,
  student_name     text,
  seats            integer,
  class_title      text,
  format           text,
  starts_at        timestamptz,
  duration_minutes integer,
  timezone         text,
  location_text    text,
  meeting_url      text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.class_registrations%rowtype;
  cls      public.class_offerings%rowtype;
begin
  select * into existing
    from public.class_registrations
    where stripe_session_id = session_id_in
    limit 1;
  if existing.id is null then
    return; -- no matching row → webhook ignores
  end if;

  select * into cls from public.class_offerings where id = existing.class_id limit 1;

  if existing.status <> 'paid' then
    update public.class_registrations
    set status = 'paid',
        stripe_payment_intent = coalesce(stripe_payment_intent, payment_intent_in),
        student_email = coalesce(student_email, student_email_in),
        student_name = coalesce(student_name, student_name_in),
        amount_total = coalesce(nullif(amount_total, 0), amount_total_in),
        paid_at = now(),
        updated_at = now()
    where id = existing.id;
  end if;

  return query
    select
      existing.id,
      (existing.status = 'paid') as already_paid,
      existing.access_token,
      coalesce(existing.student_email, student_email_in),
      coalesce(existing.student_name, student_name_in),
      existing.seats,
      cls.title,
      cls.format,
      cls.starts_at,
      cls.duration_minutes,
      cls.timezone,
      cls.location_text,
      cls.meeting_url;
end $$;

revoke all on function public.mark_class_registration_paid(text, text, numeric, text, text) from public;
grant execute on function public.mark_class_registration_paid(text, text, numeric, text, text) to service_role;

-- ---- Reload PostgREST schema cache --------------------------------------
notify pgrst, 'reload schema';

commit;
