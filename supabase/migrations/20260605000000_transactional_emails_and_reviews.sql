-- Transactional emails + appointment reviews.
--
-- Three new email touchpoints surface from the existing payment
-- flows. To minimize churn on the production RPCs that already work
-- (mark_deposit_paid_via_webhook returns booking_requests; touching
-- it would force a contract change), the email enqueues live in:
--
--   approve_booking_request           — client-side helper in
--                                       app/lib/booking-requests.ts
--                                       fires queue_notification right
--                                       after a successful approve.
--   mark_deposit_paid_via_webhook     — the calling Stripe webhook
--                                       route fires queue_notification
--                                       after the RPC succeeds. Both
--                                       /api/booking-deposit/webhook
--                                       and /api/stripe-connect/webhook
--                                       are wired the same way.
--   mark_balance_paid_via_webhook     — recreated below to enqueue
--                                       the balance-paid email + review
--                                       link inline (this RPC was new in
--                                       20260604, safe to update).
--
-- Plus the review system itself: appointment_reviews table, anon-
-- callable RPCs for read + write, unique constraint so a client can
-- only have one stored review per appointment (re-submits update).

-- =====================================================================
-- 1. appointment_reviews — one row per appointment per submission
-- =====================================================================
-- NB: appointments.id alone has no unique constraint (PK is composite
-- (user_id, id)), so we can't FK appointment_id. The RPC validates
-- existence at write time which is enough for analytics integrity.
create table if not exists public.appointment_reviews (
  id uuid primary key default gen_random_uuid(),
  appointment_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  stars smallint not null check (stars between 1 and 5),
  notes text,
  submitted_at timestamptz not null default now(),
  unique (appointment_id)
);

create index if not exists appointment_reviews_user_recent_idx
  on public.appointment_reviews (user_id, submitted_at desc);

alter table public.appointment_reviews enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'appointment_reviews'
      and policyname = 'appointment_reviews_owner_read'
  ) then
    create policy appointment_reviews_owner_read
      on public.appointment_reviews for select
      using (auth.uid() = user_id);
  end if;
end $$;

-- =====================================================================
-- 2. public_get_appointment_for_review(text)
-- =====================================================================
create or replace function public.public_get_appointment_for_review(
  appt_id_in text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row_out public.appointments;
  studio  text;
  stars_existing smallint;
begin
  if appt_id_in is null or trim(appt_id_in) = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_id');
  end if;
  select * into row_out from public.appointments where id = appt_id_in limit 1;
  if row_out.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  studio := public.public_get_studio_name(row_out.user_id);
  select stars into stars_existing
  from public.appointment_reviews where appointment_id = appt_id_in;
  return jsonb_build_object(
    'ok', true,
    'id', row_out.id,
    'studio_name', coalesce(studio, ''),
    'service_name', row_out.style,
    'appt_date', row_out.appt_date,
    'appt_time', row_out.appt_time,
    'client_name', row_out.client_name,
    'already_submitted', stars_existing is not null,
    'existing_stars', stars_existing
  );
end;
$$;

revoke all on function public.public_get_appointment_for_review(text) from public;
grant execute on function public.public_get_appointment_for_review(text) to anon;
grant execute on function public.public_get_appointment_for_review(text) to authenticated;

-- =====================================================================
-- 3. submit_appointment_review(text, smallint, text)
-- =====================================================================
create or replace function public.submit_appointment_review(
  appt_id_in text,
  stars_in smallint,
  notes_in text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row_appt public.appointments;
begin
  if appt_id_in is null or trim(appt_id_in) = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_id');
  end if;
  if stars_in is null or stars_in < 1 or stars_in > 5 then
    return jsonb_build_object('ok', false, 'reason', 'bad_stars');
  end if;
  select * into row_appt from public.appointments where id = appt_id_in limit 1;
  if row_appt.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  insert into public.appointment_reviews (
    appointment_id, user_id, stars, notes, submitted_at
  ) values (
    appt_id_in,
    row_appt.user_id,
    stars_in,
    nullif(left(trim(coalesce(notes_in, '')), 4000), ''),
    now()
  )
  on conflict (appointment_id) do update
    set stars = excluded.stars,
        notes = excluded.notes,
        submitted_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.submit_appointment_review(text, smallint, text) from public;
grant execute on function public.submit_appointment_review(text, smallint, text) to anon;
grant execute on function public.submit_appointment_review(text, smallint, text) to authenticated;

-- =====================================================================
-- 4. mark_balance_paid_via_webhook — adds balance_paid email enqueue
-- =====================================================================
-- This RPC was new in 20260604 and returns jsonb, so updating it
-- doesn't break a public contract. Other balance-paid logic
-- unchanged from the previous migration.
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

  -- Best-effort balance-paid email with review CTA.
  if row_out.client_email is not null and row_out.client_email <> '' then
    studio := public.public_get_studio_name(row_out.user_id);
    app_base_url := coalesce(
      nullif(current_setting('app.public_url', true), ''),
      'https://braidbosspro.app'
    );
    review_url := app_base_url || '/review/' || row_out.id;
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
