-- Critical security + money-correctness migration.
--
-- PRIORITY 2 — no anon RPC may return client PII / pricing / balance
-- from a guessable appointment id:
--   * appointments gets a secure `balance_access_token` (backfilled +
--     trigger-minted, like review_request_token).
--   * public_get_balance_payment_info is recreated to look up by that
--     token instead of the raw appointment id.
--   * Legacy id-based review RPCs (public_get_appointment_for_review,
--     submit_appointment_review) are DROPPED.
--   * public_get_review_by_token / submit_review_by_token lose their
--     "fall back to bare appointment id" branch.
--   * mark_balance_paid_via_webhook builds the review link from the
--     secure review_request_token, not the appointment id.
--
-- PRIORITY 3 — deposit-denial money correctness:
--   * booking_requests gets deposit-disposition columns.
--   * deny_booking_request records refund outcome / a clear
--     reconciliation state. The Stripe refund itself is issued by the
--     new /api/booking-deposit/refund route (SQL can't call Stripe);
--     this RPC just persists the disposition the route reports.

-- =====================================================================
-- P2.1 — appointments.balance_access_token
-- =====================================================================
alter table public.appointments
  add column if not exists balance_access_token text;

update public.appointments
set balance_access_token = encode(gen_random_bytes(18), 'hex')
where balance_access_token is null;

create unique index if not exists appointments_balance_access_token_idx
  on public.appointments (balance_access_token)
  where balance_access_token is not null;

-- Extend the existing token trigger fn (trigger is already attached
-- to appointments from the client_love migration) to also mint the
-- balance token. Idempotent: only fills nulls.
create or replace function public.fn_set_review_request_token()
returns trigger
language plpgsql
as $$
begin
  if new.review_request_token is null then
    new.review_request_token := encode(gen_random_bytes(18), 'hex');
  end if;
  if new.balance_access_token is null then
    new.balance_access_token := encode(gen_random_bytes(18), 'hex');
  end if;
  return new;
end;
$$;

-- =====================================================================
-- P2.2 — public_get_balance_payment_info now keyed by token
-- =====================================================================
-- Same return shape MINUS the raw internal id (the caller already
-- holds the secret token; it never needs the id). Anon may call it,
-- but only with the unguessable token.
--
-- DROP first: the prior signature was (appt_id_in text). CREATE OR
-- REPLACE cannot rename an input parameter, so we drop the old
-- guessable-id entry point entirely, then create the token version.
drop function if exists public.public_get_balance_payment_info(text);
create function public.public_get_balance_payment_info(
  token_in text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row_out public.appointments;
  stylist_name text;
  studio_name text;
begin
  if token_in is null or trim(token_in) = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_token');
  end if;
  select * into row_out from public.appointments
    where balance_access_token = token_in limit 1;
  if row_out.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  select coalesce(p.full_name, ''), nullif(trim(coalesce(p.business_name, '')), '')
    into stylist_name, studio_name
  from public.profiles p where p.id = row_out.user_id;
  if studio_name is null or studio_name = '' then
    select nullif(trim(coalesce(s.business_name, '')), '') into studio_name
    from public.settings s where s.user_id = row_out.user_id limit 1;
  end if;
  if studio_name is null or studio_name = '' then
    select nullif(trim(coalesce(b.business_name, '')), '') into studio_name
    from public.booking_links b
    where b.user_id = row_out.user_id and b.active = true
    order by b.created_at desc nulls last limit 1;
  end if;
  return jsonb_build_object(
    'ok', true,
    'token', token_in,
    'stylist_name', coalesce(stylist_name, ''),
    'studio_name', coalesce(studio_name, ''),
    'service_name', row_out.style,
    'client_name', row_out.client_name,
    'appt_date', row_out.appt_date,
    'appt_time', row_out.appt_time,
    'total_price', row_out.total_price,
    'deposit_paid', row_out.deposit_paid,
    'balance_due', greatest(0, coalesce(row_out.balance_due,
      coalesce(row_out.total_price, 0) - coalesce(row_out.deposit_paid, 0))),
    'status', row_out.status,
    'balance_paid', row_out.balance_paid,
    'balance_paid_at', row_out.balance_paid_at,
    'payment_status', row_out.payment_status,
    'is_cancelled', row_out.status = 'cancelled'
  );
end;
$$;

revoke all on function public.public_get_balance_payment_info(text) from public;
grant execute on function public.public_get_balance_payment_info(text) to anon, authenticated;

-- =====================================================================
-- P2.3 — drop legacy id-based review RPCs
-- =====================================================================
drop function if exists public.public_get_appointment_for_review(text);
drop function if exists public.submit_appointment_review(text, smallint, text);

-- =====================================================================
-- P2.4 — review token RPCs WITHOUT the bare-appointment-id fallback
-- =====================================================================
create or replace function public.public_get_review_by_token(
  token_in text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row_appt public.appointments;
  studio   text;
  existing public.appointment_reviews;
begin
  if token_in is null or trim(token_in) = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_token');
  end if;

  select * into row_appt from public.appointments
    where review_request_token = token_in limit 1;

  if row_appt.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if coalesce(row_appt.status, '') in
       ('cancelled', 'no-show', 'no_show', 'noshow', 'declined') then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  studio := public.public_get_studio_name(row_appt.user_id);
  select * into existing from public.appointment_reviews
    where appointment_id = row_appt.id;

  return jsonb_build_object(
    'ok', true,
    'studio_name', coalesce(studio, ''),
    'service_name', row_appt.style,
    'client_name', row_appt.client_name,
    'appt_date', row_appt.appt_date,
    'appt_time', row_appt.appt_time,
    'already_submitted', existing.id is not null,
    'existing_stars', existing.stars,
    'existing_text', existing.notes,
    'existing_would_book_again', existing.would_book_again,
    'existing_display_name', existing.display_name
  );
end;
$$;

revoke all on function public.public_get_review_by_token(text) from public;
grant execute on function public.public_get_review_by_token(text) to anon, authenticated;

create or replace function public.submit_review_by_token(
  token_in text,
  stars_in smallint,
  review_text_in text default null,
  would_book_again_in boolean default null,
  private_feedback_in text default null,
  display_name_in text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row_appt public.appointments;
begin
  if token_in is null or trim(token_in) = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_token');
  end if;
  if stars_in is null or stars_in < 1 or stars_in > 5 then
    return jsonb_build_object('ok', false, 'reason', 'bad_stars');
  end if;

  select * into row_appt from public.appointments
    where review_request_token = token_in limit 1;
  if row_appt.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if coalesce(row_appt.status, '') in
       ('cancelled', 'no-show', 'no_show', 'noshow', 'declined') then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  insert into public.appointment_reviews (
    appointment_id, user_id, stars, notes,
    would_book_again, private_feedback, display_name,
    status, submitted_at, updated_at
  ) values (
    row_appt.id,
    row_appt.user_id,
    stars_in,
    nullif(left(trim(coalesce(review_text_in, '')), 4000), ''),
    would_book_again_in,
    nullif(left(trim(coalesce(private_feedback_in, '')), 4000), ''),
    nullif(left(trim(coalesce(display_name_in, '')), 80), ''),
    'pending',
    now(),
    now()
  )
  on conflict (appointment_id) do update
    set stars            = excluded.stars,
        notes            = excluded.notes,
        would_book_again = excluded.would_book_again,
        private_feedback = excluded.private_feedback,
        display_name     = excluded.display_name,
        status           = 'pending',
        submitted_at     = now(),
        updated_at       = now();

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.submit_review_by_token(text, smallint, text, boolean, text, text) from public;
grant execute on function public.submit_review_by_token(text, smallint, text, boolean, text, text) to anon, authenticated;

-- =====================================================================
-- P2.5 — mark_balance_paid_via_webhook: review link via secure token
-- =====================================================================
create or replace function public.mark_balance_paid_via_webhook(
  appt_id_in text,
  stripe_session_id_in text default null,
  stripe_payment_intent_in text default null,
  amount_in numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row_out public.appointments;
  studio text;
  app_base_url text;
  review_url text;
  amount_paid_out numeric;
begin
  if appt_id_in is null or trim(appt_id_in) = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_id');
  end if;
  select * into row_out from public.appointments where id = appt_id_in limit 1;
  if row_out.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if row_out.balance_paid then
    return jsonb_build_object('ok', true, 'already_paid', true, 'id', row_out.id);
  end if;
  if row_out.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'reason', 'cancelled');
  end if;

  update public.appointments
  set balance_paid = true,
      balance_paid_at = now(),
      balance_payment_intent_id = coalesce(stripe_payment_intent_in, balance_payment_intent_id),
      balance_checkout_session_id = coalesce(stripe_session_id_in, balance_checkout_session_id),
      balance_payment_status = 'paid',
      payment_status = 'paid',
      payment_date = coalesce(payment_date, current_date),
      payment_method = coalesce(payment_method, 'stripe'),
      balance_due = case
        when amount_in is not null and amount_in > 0
          then greatest(0, coalesce(balance_due, 0) - amount_in)
          else 0
        end,
      deposit_paid = case
        when amount_in is not null and amount_in > 0
          then coalesce(deposit_paid, 0) + amount_in
          else coalesce(total_price, deposit_paid)
        end,
      updated_at = now()
  where id = appt_id_in
  returning * into row_out;

  if row_out.client_email is not null and row_out.client_email <> '' then
    studio := public.public_get_studio_name(row_out.user_id);
    app_base_url := coalesce(
      nullif(current_setting('app.public_url', true), ''),
      'https://braidbosspro.app'
    );
    -- Secure review token (always present: backfilled + trigger).
    review_url := app_base_url || '/review/' || row_out.review_request_token;
    amount_paid_out := coalesce(amount_in, row_out.total_price);
    begin
      perform public.queue_notification(
        user_id_in            => row_out.user_id,
        channel_in            => 'email',
        notification_type_in  => 'balance_paid',
        body_in               => 'Thank you — your balance is paid in full.',
        subject_in            => 'Thank you — your balance is paid',
        recipient_email_in    => row_out.client_email,
        recipient_name_in     => row_out.client_name,
        payload_in            => jsonb_build_object(
          'clientName',  coalesce(row_out.client_name, 'there'),
          'studioName',  coalesce(nullif(studio, ''), 'your stylist'),
          'serviceName', row_out.style,
          'amountPaid',  amount_paid_out,
          'reviewUrl',   review_url
        ),
        dedupe_key_in         => 'balance_paid:' || row_out.id,
        appointment_id_in     => row_out.id
      );
    exception when others then null;
    end;
  end if;

  return jsonb_build_object('ok', true, 'id', row_out.id);
end;
$$;

revoke all on function public.mark_balance_paid_via_webhook(text, text, text, numeric) from public;
grant execute on function public.mark_balance_paid_via_webhook(text, text, text, numeric) to service_role;

-- =====================================================================
-- P3 — deposit-denial money correctness
-- =====================================================================
alter table public.booking_requests
  add column if not exists deposit_disposition text,
  add column if not exists deposit_refund_amount numeric,
  add column if not exists deposit_refund_ids text[],
  add column if not exists deposit_refunded_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'booking_requests_deposit_disposition_chk'
  ) then
    alter table public.booking_requests
      add constraint booking_requests_deposit_disposition_chk
      check (deposit_disposition is null or deposit_disposition in
        ('no_charge', 'refunded', 'refund_failed_manual'));
  end if;
end $$;

-- Replace deny_booking_request with a richer signature. Drop the old
-- 2-arg version first so we don't leave a stale overload. Still
-- SECURITY INVOKER + owner check, so the API route calls it with the
-- stylist's JWT exactly like cancel_appointment.
drop function if exists public.deny_booking_request(uuid, text);
create function public.deny_booking_request(
  request_id_in uuid,
  reason_in text default null,
  deposit_disposition_in text default null,
  refund_amount_in numeric default null,
  refund_ids_in text[] default null
)
returns public.booking_requests
language plpgsql
security invoker
set search_path = public
as $$
declare
  caller uuid;
  row_out public.booking_requests;
begin
  caller := auth.uid();
  if caller is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;
  if deposit_disposition_in is not null
     and deposit_disposition_in not in
         ('no_charge', 'refunded', 'refund_failed_manual') then
    raise exception 'bad_disposition' using errcode = '22023';
  end if;

  update public.booking_requests
  set approval_status = 'denied',
      denied_at = coalesce(denied_at, now()),
      declined_at = coalesce(declined_at, now()),
      denied_reason = nullif(trim(coalesce(reason_in, '')), ''),
      decline_reason = nullif(trim(coalesce(reason_in, '')), ''),
      approval_expires_at = null,
      status = 'declined',
      deposit_disposition = coalesce(deposit_disposition_in, deposit_disposition),
      deposit_refund_amount = coalesce(refund_amount_in, deposit_refund_amount),
      deposit_refund_ids = coalesce(refund_ids_in, deposit_refund_ids),
      deposit_refunded_at = case
        when deposit_disposition_in = 'refunded' then coalesce(deposit_refunded_at, now())
        else deposit_refunded_at
      end
  where id = request_id_in and user_id = caller
  returning * into row_out;

  if row_out.id is null then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
  return row_out;
end;
$$;

revoke all on function public.deny_booking_request(uuid, text, text, numeric, text[]) from public;
grant execute on function public.deny_booking_request(uuid, text, text, numeric, text[]) to authenticated;

notify pgrst, 'reload schema';
