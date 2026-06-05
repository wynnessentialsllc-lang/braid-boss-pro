-- Balance payment page: full service breakdown + discount visibility.
--
-- The public balance-pay page (/pay/balance/<token>) only knew the flat
-- service name + a gross total + a balance. When a discount was applied
-- the page showed "Total $645.00" then "Balance due $624.74" with no
-- explanation of the $20.26 gap, and add-ons the client picked at booking
-- time were invisible. Clients couldn't reconcile what they were paying.
--
-- This recreates public_get_balance_payment_info to ALSO return:
--   * discount_name / discount_amount  — straight off the appointment's
--     denormalized discount snapshot columns (discounts_v1).
--   * addons / variation_name          — recovered from the booking_request
--     that was converted into this appointment (booking_requests.appointment_id
--     is set by confirm_booking_request_approval). These are display-only
--     snapshots taken at submit time, so editing the catalog later never
--     rewrites a client's in-flight breakdown.
--
-- Money stays anchored to the appointment row: total_price is the GROSS
-- subtotal (pre-discount, add-ons included — matches receipts.ts), and
-- balance_due is authoritative. The add-on list is for display only; the
-- page derives the base service-line price as (subtotal − sum(add-ons)) so
-- the itemization always foots to the appointment's own total.
--
-- Same signature, so CREATE OR REPLACE — no drop / regrant needed.

create or replace function public.public_get_balance_payment_info(
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
  br_addons jsonb;
  br_variation text;
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

  -- Recover the add-on / variation breakdown from the originating
  -- booking request, if this appointment came through a booking link.
  -- Manual (in-app) appointments have no booking_request, so these stay
  -- null and the page falls back to the flat service line.
  select br.selected_addons, br.selected_variation_name
    into br_addons, br_variation
  from public.booking_requests br
  where br.appointment_id = row_out.id
  order by br.created_at desc nulls last
  limit 1;

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
      coalesce(row_out.total_price, 0)
        - coalesce(row_out.discount_amount, 0)
        - coalesce(row_out.deposit_paid, 0))),
    -- Discount snapshot (denormalized onto the appointment at the time
    -- it was applied — survives the discount later being deleted).
    'discount_name', nullif(trim(coalesce(row_out.discount_name, '')), ''),
    'discount_amount', row_out.discount_amount,
    -- Service breakdown (display only; null on manual appointments).
    'variation_name', br_variation,
    'addons', coalesce(br_addons, '[]'::jsonb),
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

notify pgrst, 'reload schema';
