-- Make contract generation atomic with booking-request approval.
--
-- Bailey Cooper's symptom: she got the appointment_confirmed email
-- but no contract attached. Her service was correctly linked to a
-- contract template via services.contract_template_id; the
-- generate_booking_contracts function works (manually replayed and
-- it inserted the row). The miss was that the client-side
-- confirmApproval wraps generate_booking_contracts in a swallowing
-- try/catch — a transient error during her approval left her with
-- no contract and us with no log.
--
-- Fix: have confirm_booking_request_approval RPC call
-- generate_booking_contracts itself. The approval and the contract
-- generation now succeed or fail together as one transaction.
-- A flaky network on the client can't drop the contract anymore;
-- if generation errors, the whole approval rolls back and the
-- stylist sees a clear failure to retry.
--
-- Also runs on the "already approved" early-return path so a
-- re-tap of Approve heals any historical row missing its contract
-- (generate_booking_contracts is idempotent).

create or replace function public.confirm_booking_request_approval(
  request_id_in     uuid,
  appointment_id_in text
)
returns booking_requests
language plpgsql
set search_path to 'public'
as $function$
declare
  caller         uuid;
  approval_row   public.booking_requests;
  current_status text;
begin
  caller := auth.uid();

  if caller is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if appointment_id_in is null or trim(appointment_id_in) = '' then
    raise exception 'appointment_id_required';
  end if;

  select br.approval_status
    into current_status
    from public.booking_requests br
   where br.id = request_id_in
     and br.user_id = caller
   limit 1;

  if current_status is null then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;

  -- Already approved: heal any missing contract row (idempotent) +
  -- return the row. The same atomic guarantee applies here too.
  if current_status in ('approved', 'confirmed') then
    perform public.generate_booking_contracts(request_id_in, appointment_id_in);

    select *
      into approval_row
      from public.booking_requests br
     where br.id = request_id_in
       and br.user_id = caller;

    return approval_row;
  end if;

  if current_status not in (
    'deposit_paid_pending_approval',
    'pending_review',
    'approved_pending_deposit'
  ) then
    raise exception 'request_not_approvable_in_state_%', current_status
      using errcode = 'P0001';
  end if;

  update public.booking_requests
    set approval_status     = 'approved',
        approved_at         = coalesce(approved_at, now()),
        confirmed_at        = coalesce(confirmed_at, now()),
        appointment_id      = appointment_id_in,
        approval_expires_at = null,
        status              = case
          when status = 'declined' then 'declined'
          else 'approved'
        end
  where id = request_id_in
    and user_id = caller
  returning * into approval_row;

  -- Generate contracts as part of the SAME transaction. If this
  -- errors (e.g. an offline DB hiccup), the approval rolls back —
  -- no more silent "approved without a contract" cases. The function
  -- is idempotent, so a retry never duplicates.
  perform public.generate_booking_contracts(request_id_in, appointment_id_in);

  return approval_row;
end;
$function$;
