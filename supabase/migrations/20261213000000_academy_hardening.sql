-- Braider Academy hardening (Phase 4).
--
-- Three production-grade fixes that apply to every braider:
--
--   1. public_storefront_sections — lets the storefront show the
--      Classes / Videos tabs ONLY when the braider has published
--      something, so a braider who never touches these features (the
--      majority, at first) shows a clean Profile/Shop storefront.
--
--   2. Atomic, hold-aware seat capacity — replaces the Phase 1 "soft"
--      capacity check (which had a documented race between two
--      simultaneous buyers) with a row-locked reservation RPC, and
--      counts in-flight checkouts as held seats so a class can never
--      oversell. Abandoned checkouts free their held seats after a
--      grace window.
--
--   3. expire_stale_class_holds — self-maintaining cleanup called
--      lazily by the reservation path (no pg_cron needed), mirroring
--      how expire_stale_approvals is invoked before booking refreshes.

begin;

-- How long an unpaid, in-flight sign-up holds its seat(s) before the
-- seat is released back to the pool. Long enough to complete Stripe
-- Checkout, short enough that an abandoned tab frees the seat soon.
-- (Inlined as a literal below; documented here for one source of truth.)
--   HOLD WINDOW = 30 minutes

-- ── 1. Storefront sections (conditional tabs) ────────────────────────
create or replace function public.public_storefront_sections(slug_in text)
returns table (
  has_classes boolean,
  has_videos  boolean
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
    return query select false, false;
    return;
  end if;
  return query
    select
      exists (
        select 1 from public.class_offerings
        where user_id = resolved.user_id and status = 'published'
      ),
      exists (
        select 1 from public.video_lessons
        where user_id = resolved.user_id and status = 'published'
      );
end $$;

revoke all on function public.public_storefront_sections(text) from public;
grant execute on function public.public_storefront_sections(text) to anon, authenticated;

-- ── 2. Stale hold cleanup ────────────────────────────────────────────
-- Fails any pending registration for this class older than the hold
-- window, releasing its held seats. Called by the reservation RPC (and
-- safe to call from anywhere) — self-maintaining, no cron required.
create or replace function public.expire_stale_class_holds(class_id_in uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.class_registrations
  set status = 'failed', updated_at = now()
  where class_id = class_id_in
    and status = 'pending'
    and created_at < now() - interval '30 minutes';
end $$;

revoke all on function public.expire_stale_class_holds(uuid) from public;
grant execute on function public.expire_stale_class_holds(uuid) to service_role;

-- ── 2b. Hold-aware seats-remaining ───────────────────────────────────
-- Redefine to count PAID seats plus in-flight holds (pending sign-ups
-- inside the hold window), so the public "seats left" figure — and the
-- reservation check below — reflect checkouts already in progress and
-- never oversell. Signature is unchanged, so every existing caller
-- (public_list_classes / public_get_class) picks this up transparently.
create or replace function public.class_seats_remaining(class_id_in uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  cap   integer;
  taken integer;
begin
  select capacity into cap from public.class_offerings where id = class_id_in;
  if cap is null then
    return null; -- unlimited
  end if;
  select coalesce(sum(seats), 0) into taken
    from public.class_registrations
    where class_id = class_id_in
      and (
        status = 'paid'
        or (status = 'pending' and created_at > now() - interval '30 minutes')
      );
  return greatest(0, cap - taken);
end $$;

revoke all on function public.class_seats_remaining(uuid) from public;
grant execute on function public.class_seats_remaining(uuid) to anon, authenticated, service_role;

-- ── 2c. Atomic reservation ───────────────────────────────────────────
-- Serializes concurrent buyers on the class row (FOR UPDATE), clears
-- stale holds, re-checks capacity, and inserts the pending registration
-- — all in one transaction. Returns the new registration id, or NULL if
-- the class would oversell (the checkout route maps NULL → "full"). This
-- is the ONLY place a class_registration is created, so the capacity
-- guarantee can't be bypassed.
create or replace function public.create_class_registration(
  class_id_in          uuid,
  user_id_in           uuid,
  seats_in             integer,
  amount_total_in      numeric,
  application_fee_in   numeric,
  currency_in          text,
  student_name_in      text,
  student_email_in     text,
  access_token_in      text,
  stripe_account_id_in text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  cap         integer;
  taken       integer;
  new_id      uuid;
  email_holds integer;
  seats       integer := greatest(1, coalesce(seats_in, 1));
begin
  -- Lock the class row so two concurrent reservations can't both pass
  -- the capacity check. A missing row → no class → no reservation.
  select capacity into cap from public.class_offerings where id = class_id_in for update;
  if not found then
    return null;
  end if;

  perform public.expire_stale_class_holds(class_id_in);

  -- Anti-abuse: cap how many unpaid holds one email can stack on a class,
  -- so a script can't reserve every seat with throwaway addresses. (Broad
  -- IP-based flooding is an edge/rate-limit concern outside this function.)
  if student_email_in is not null and length(trim(student_email_in)) > 0 then
    select count(*) into email_holds
      from public.class_registrations
      where class_id = class_id_in
        and lower(student_email) = lower(student_email_in)
        and status = 'pending'
        and created_at > now() - interval '30 minutes';
    if email_holds >= 3 then
      return null;
    end if;
  end if;

  if cap is not null then
    select coalesce(sum(cr.seats), 0) into taken
      from public.class_registrations cr
      where cr.class_id = class_id_in
        and (
          cr.status = 'paid'
          or (cr.status = 'pending' and cr.created_at > now() - interval '30 minutes')
        );
    if taken + seats > cap then
      return null; -- would oversell
    end if;
  end if;

  insert into public.class_registrations (
    user_id, class_id, status, seats, amount_total, application_fee,
    currency, student_name, student_email, access_token, stripe_account_id
  )
  values (
    user_id_in, class_id_in, 'pending', seats, amount_total_in, application_fee_in,
    currency_in, student_name_in, student_email_in, access_token_in, stripe_account_id_in
  )
  returning id into new_id;

  return new_id;
end $$;

revoke all on function public.create_class_registration(
  uuid, uuid, integer, numeric, numeric, text, text, text, text, text
) from public;
grant execute on function public.create_class_registration(
  uuid, uuid, integer, numeric, numeric, text, text, text, text, text
) to service_role;

-- ── Reload PostgREST schema cache ────────────────────────────────────
notify pgrst, 'reload schema';

commit;
