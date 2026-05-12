-- Balance payment links via Stripe Connect — Phase 1.
--
-- After a deposit is paid, the stylist can send a balance payment
-- link to the client. The link routes to a public page that creates
-- a Stripe Checkout Session on the stylist's connected account. A
-- webhook flips the appointment's balance_paid columns when Stripe
-- fires checkout.session.completed.
--
-- Mirrors the existing booking-deposit infrastructure
-- (stripe_webhook_events idempotency log, SECURITY DEFINER write
-- RPC, public read RPC). No new Stripe surface area beyond what the
-- deposit flow already exercises.

-- =====================================================================
-- 1. Columns
-- =====================================================================
alter table public.appointments
  add column if not exists balance_paid boolean not null default false,
  add column if not exists balance_paid_at timestamptz,
  add column if not exists balance_payment_intent_id text,
  add column if not exists balance_checkout_session_id text,
  add column if not exists balance_payment_status text;

-- Hot path indexes — most queries fetch by id; the partial unpaid
-- index keeps "send link" lookups fast even at scale.
create index if not exists appointments_balance_unpaid_idx
  on public.appointments (user_id, appt_date)
  where balance_paid = false and balance_due is not null and balance_due > 0;

-- =====================================================================
-- 2. public_get_balance_payment_info — anon-callable read
-- =====================================================================
-- Returns just the fields the public /pay/balance/<id> page renders.
-- Never exposes notes, phone, email, discount_id, or any internal
-- IDs beyond what the URL already encodes.
create or replace function public.public_get_balance_payment_info(
  appt_id_in text
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
  if appt_id_in is null or trim(appt_id_in) = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_id');
  end if;

  select * into row_out from public.appointments where id = appt_id_in limit 1;
  if row_out.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- Surface the stylist's display name from profiles + business name
  -- from app_settings so the page can read like "Pay Amara at Studio
  -- 32" not just "Pay $80".
  select coalesce(p.full_name, p.email, '')
    into stylist_name
  from public.profiles p
  where p.id = row_out.user_id;
  select coalesce(s.data->>'businessName', '')
    into studio_name
  from public.app_settings s
  where s.user_id = row_out.user_id
  limit 1;

  return jsonb_build_object(
    'ok', true,
    'id', row_out.id,
    'stylist_name', stylist_name,
    'studio_name', studio_name,
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
grant execute on function public.public_get_balance_payment_info(text) to anon;
grant execute on function public.public_get_balance_payment_info(text) to authenticated;

-- =====================================================================
-- 3. mark_balance_paid_via_webhook — atomic write
-- =====================================================================
-- Idempotent: a second call once balance_paid is already true is a
-- no-op. The webhook route also dedupes by event_id via
-- stripe_webhook_events; this RPC is a second line of defense.
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
        -- If the customer paid the full balance, the "deposit_paid"
        -- column in the app's payment model now reflects the total
        -- collected. Keep it consistent for the Money screen.
        when amount_in is not null and amount_in > 0
          then coalesce(deposit_paid, 0) + amount_in
          else coalesce(total_price, deposit_paid)
        end,
      updated_at = now()
  where id = appt_id_in
  returning * into row_out;

  return jsonb_build_object('ok', true, 'id', row_out.id);
end;
$$;

revoke all on function public.mark_balance_paid_via_webhook(text, text, text, numeric) from public;
grant execute on function public.mark_balance_paid_via_webhook(text, text, text, numeric) to service_role;

-- =====================================================================
-- 4. mark_balance_paid_manually — stylist-side override
-- =====================================================================
-- Authenticated stylist marks the balance paid outside the Stripe
-- flow (cash, Zelle, etc.). Authorizes by auth.uid() = appointment
-- owner so a leaked anon key can't mark random appointments paid.
create or replace function public.mark_balance_paid_manually(
  appt_id_in text,
  method_in text default 'manual',
  note_in text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  row_out public.appointments;
begin
  if caller is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;
  select * into row_out from public.appointments where id = appt_id_in limit 1;
  if row_out.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if row_out.user_id <> caller then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if row_out.balance_paid then
    return jsonb_build_object('ok', true, 'already_paid', true);
  end if;

  update public.appointments
  set balance_paid = true,
      balance_paid_at = now(),
      balance_payment_status = 'paid_manually',
      payment_status = 'paid',
      payment_method = coalesce(method_in, payment_method, 'manual'),
      payment_notes = coalesce(note_in, payment_notes),
      payment_date = coalesce(payment_date, current_date),
      deposit_paid = coalesce(total_price, deposit_paid),
      balance_due = 0,
      updated_at = now()
  where id = appt_id_in
  returning * into row_out;

  return jsonb_build_object('ok', true, 'id', row_out.id);
end;
$$;

revoke all on function public.mark_balance_paid_manually(text, text, text) from public;
grant execute on function public.mark_balance_paid_manually(text, text, text) to authenticated;
