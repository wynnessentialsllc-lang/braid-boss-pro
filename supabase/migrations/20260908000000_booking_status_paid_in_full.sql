-- Surface pay-in-full state to the public booking-success page.
--
-- The success page polls public_get_booking_request_status to render the
-- confirmation copy. It previously only knew about the deposit, so a
-- pay-in-full BNPL booking showed "Deposit received / $25" instead of
-- "Payment received / $50". Add paid_in_full + amount_paid to the result
-- so the page can render the right wording and amount.
--
-- Changing the RETURNS TABLE shape requires DROP + CREATE; the argument
-- signature is unchanged. Re-grant anon + authenticated afterwards (the
-- public success page runs as anon).

drop function if exists public.public_get_booking_request_status(uuid);

create function public.public_get_booking_request_status(
  request_id_in uuid
)
returns table (
  approval_status text,
  payment_status text,
  deposit_paid boolean,
  deposit_amount numeric,
  paid_in_full boolean,
  amount_paid numeric,
  service_name text,
  preferred_date date,
  preferred_time text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select br.approval_status, br.payment_status, br.deposit_paid,
         br.deposit_amount, br.paid_in_full, br.amount_paid,
         br.service_name, br.preferred_date, br.preferred_time
  from public.booking_requests br
  where br.id = request_id_in
  limit 1;
end;
$$;

revoke all on function public.public_get_booking_request_status(uuid) from public;
grant execute on function public.public_get_booking_request_status(uuid) to anon;
grant execute on function public.public_get_booking_request_status(uuid) to authenticated;
