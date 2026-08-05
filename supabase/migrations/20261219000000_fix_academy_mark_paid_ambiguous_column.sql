-- Fix "column reference is ambiguous" in the Academy mark-paid webhooks.
--
-- mark_video_purchase_paid and mark_class_registration_paid both declare
-- RETURNS TABLE (... buyer_email / buyer_name ... | ... student_email /
-- student_name ...). Those output columns become PL/pgSQL variables that
-- SHADOW the identically-named columns on video_purchases /
-- class_registrations. Inside each UPDATE, `coalesce(buyer_email,
-- buyer_email_in)` (and the student_* equivalents) is then ambiguous:
-- Postgres can't tell the table column from the output variable, so it
-- raises `column reference "buyer_email" is ambiguous` and the function
-- aborts with SQLSTATE 42702.
--
-- Effect on the live app: the Stripe webhooks
-- (/api/video-checkout/webhook, /api/class-checkout/webhook) passed
-- signature verification, called these RPCs, got a 500, and returned 500
-- to Stripe — so the purchase/registration was NEVER flipped to 'paid'.
-- The buyer was charged but the /watch page (video) and confirmation page
-- (class) sat forever on "confirming your payment".
--
-- Fix: add `#variable_conflict use_column` so a bare name that matches a
-- table column resolves to the column (which is exactly what the UPDATE
-- self-coalesce wants). The RETURN QUERY already uses record-qualified
-- names (existing.buyer_email) and the *_in parameters, so it is
-- unaffected. Bodies are otherwise byte-for-byte the originals.
--
-- CREATE OR REPLACE preserves the existing service_role grants; they are
-- re-asserted here for clarity.

begin;

-- ---- Video: mark a purchase paid ----------------------------------------
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
#variable_conflict use_column
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

-- ---- Class: mark a registration paid ------------------------------------
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
#variable_conflict use_column
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

commit;
