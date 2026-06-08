-- Build-your-style request -> booking (Stage 2).
--
-- Approving a "Build your style" request should drop it into the SAME
-- deposit-first booking pipeline a normal booking uses, so the client
-- gets the existing deposit-link email -> Stripe checkout -> confirmation
-- + contract flow with zero new payment plumbing.
--
-- This RPC converts a style_requests row into a booking_requests row
-- (seeded from the request's client info + AI estimate + matched
-- service), links the two via style_requests.booking_request_id, and
-- marks the style request 'booked'. The stylist then approves it in the
-- normal Approvals queue, which collects the deposit and emails the pay
-- link. Idempotent: a second call returns the already-created booking.
--
-- booking_requests has only three NOT-NULL columns without defaults —
-- user_id, client_name, link_slug — so link_slug is resolved from the
-- stylist's booking link. created_from_public is false (stylist-
-- initiated), which also skips the public date/time guard trigger.

create or replace function public.convert_style_request_to_booking(
  style_request_id_in uuid
)
returns public.booking_requests
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  caller        uuid := auth.uid();
  sr            public.style_requests;
  svc           public.services;
  v_slug        text;
  v_price       numeric(10,2);
  v_dep_amount  numeric(10,2);
  v_name        text;
  v_row         public.booking_requests;
begin
  if caller is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select * into sr
    from public.style_requests
   where id = style_request_id_in and user_id = caller;
  if not found then
    raise exception 'style_request_not_found' using errcode = 'P0002';
  end if;

  -- Idempotent: if it's already been converted, hand back the existing
  -- booking instead of creating a duplicate.
  if sr.booking_request_id is not null then
    select * into v_row
      from public.booking_requests
     where id = sr.booking_request_id and user_id = caller;
    if found then
      return v_row;
    end if;
  end if;

  -- Snapshot the AI-matched service when it still exists and is the
  -- caller's own. svc stays all-NULL when there's no match.
  if sr.ai_suggested_service_id is not null then
    select * into svc
      from public.services
     where id = sr.ai_suggested_service_id
       and user_id = caller
       and coalesce(is_active, true);
  end if;

  -- Price: the matched service's base price, else the AI midpoint, else
  -- whichever AI bound exists. NULL only when nothing is known (the
  -- stylist sets it on approval).
  v_price := coalesce(
    svc.base_price,
    round((( coalesce(sr.ai_price_low,  sr.ai_price_high, 0)
           + coalesce(sr.ai_price_high, sr.ai_price_low,  0)) / 2.0)::numeric, 2),
    sr.ai_price_high,
    sr.ai_price_low
  );
  v_dep_amount := svc.deposit_amount;  -- NULL when no service / no preset

  v_name := coalesce(
    nullif(trim(coalesce(svc.name, '')), ''),
    nullif(trim(coalesce(sr.ai_style_family, '')), ''),
    'Custom style'
  );

  -- link_slug is NOT NULL with no default; use the stylist's booking
  -- link (any one), falling back to '' so the insert never fails.
  v_slug := coalesce(
    (select slug from public.booking_links where user_id = caller order by created_at nulls last limit 1),
    ''
  );

  insert into public.booking_requests (
    user_id, link_slug,
    client_name, client_phone, client_email,
    service_id, service_name, service_name_snapshot,
    service_duration, service_duration_hours,
    service_price,
    service_deposit_required, service_deposit_amount,
    service_prep_instructions,
    preferred_date, preferred_time, notes,
    created_from_public, status, approval_status,
    deposit_required, deposit_amount,
    payment_status, deposit_paid
  ) values (
    caller, v_slug,
    coalesce(nullif(trim(sr.client_name), ''), 'Client'),
    nullif(trim(coalesce(sr.client_phone, '')), ''),
    nullif(trim(coalesce(sr.client_email, '')), ''),
    svc.id,
    v_name, v_name,
    coalesce(svc.duration_hours, sr.ai_est_duration_hours),
    coalesce(svc.duration_hours, sr.ai_est_duration_hours),
    v_price,
    coalesce(svc.deposit_required, true),
    v_dep_amount,
    svc.prep_instructions,
    sr.preferred_date,
    nullif(trim(coalesce(sr.preferred_time, '')), ''),
    nullif(trim(coalesce(sr.notes, '')), ''),
    false, 'pending', 'pending_review',
    true, v_dep_amount,
    'unpaid', false
  )
  returning * into v_row;

  -- Link + retire the style request from the open queue. This UPDATE
  -- sets status to 'booked' (not 'denied'), so the Stage 1 denial
  -- trigger is a no-op here.
  update public.style_requests
     set status = 'booked',
         booking_request_id = v_row.id,
         updated_at = now()
   where id = sr.id and user_id = caller;

  return v_row;
end;
$$;

revoke all on function public.convert_style_request_to_booking(uuid) from public;
grant execute on function public.convert_style_request_to_booking(uuid) to authenticated;
