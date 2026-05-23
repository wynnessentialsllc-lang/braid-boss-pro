-- Notify the stylist when a client signs a contract.
--
-- sign_public_contract previously updated booking_contracts +
-- communication_logs only — no surface in the app reflected the
-- signing. Now it ALSO inserts a row into public.notifications so
-- the stylist's in-app bell lights up immediately (via the same
-- useNotifications fetch that surfaces "Email sent" entries).
--
-- Best-effort and idempotent: deterministic id keyed on the
-- booking_contracts row prevents duplicates if the function is
-- ever re-invoked, and the insert is wrapped in EXCEPTION so a
-- bell-write failure can never block the actual signing.
--
-- Both overloads are updated; behavior is otherwise unchanged.

create or replace function public.sign_public_contract(
  token_in           text,
  signed_name_in     text,
  signature_text_in  text,
  initials_in        text default null,
  ip_address_in      text default null,
  user_agent_in      text default null
)
returns booking_contracts
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  contract_row      public.booking_contracts;
  tmpl_require_init boolean := false;
begin
  if token_in is null or trim(token_in) = '' then
    raise exception 'token_required';
  end if;
  if signed_name_in is null or trim(signed_name_in) = '' then
    raise exception 'signed_name_required';
  end if;
  if signature_text_in is null or trim(signature_text_in) = '' then
    raise exception 'signature_required';
  end if;

  select *
  into contract_row
  from public.booking_contracts bc
  where bc.public_token = token_in
  limit 1;

  if not found then
    raise exception 'contract_not_found' using errcode = 'P0002';
  end if;
  if contract_row.status not in ('pending','viewed') then
    raise exception 'contract_not_signable';
  end if;
  if contract_row.expires_at is not null and contract_row.expires_at < now() then
    update public.booking_contracts bc set status = 'expired' where bc.id = contract_row.id;
    raise exception 'contract_expired';
  end if;

  select ct.require_initials
  into tmpl_require_init
  from public.contract_templates ct
  where ct.id = contract_row.contract_template_id
  limit 1;
  tmpl_require_init := coalesce(tmpl_require_init, false);
  if tmpl_require_init = true and (initials_in is null or trim(initials_in) = '') then
    raise exception 'initials_required';
  end if;

  update public.booking_contracts bc
  set status         = 'signed',
      signed_at      = now(),
      signed_name    = trim(signed_name_in),
      signature_text = trim(signature_text_in),
      initials       = nullif(trim(coalesce(initials_in, '')), ''),
      ip_address     = nullif(trim(coalesce(ip_address_in, '')), ''),
      user_agent     = nullif(trim(coalesce(user_agent_in, '')), '')
  where bc.id = contract_row.id
  returning * into contract_row;

  insert into public.communication_logs (
    user_id, client_id, booking_request_id, appointment_id, booking_contract_id,
    channel, message_type, recipient, subject, body, status, sent_at
  ) values (
    contract_row.user_id, contract_row.client_id, contract_row.booking_request_id,
    contract_row.appointment_id, contract_row.id,
    'system', 'contract_signed', contract_row.client_email, contract_row.title,
    contract_row.signed_name || ' signed at ' ||
      to_char(contract_row.signed_at at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') || ' UTC',
    'sent', now()
  );

  -- Bell notification for the stylist. Best-effort; never blocks
  -- the sign. Deterministic id makes it idempotent.
  begin
    insert into public.notifications (id, user_id, category, title, body, data)
    values (
      'contract_signed:' || contract_row.id::text,
      contract_row.user_id,
      'contract',
      'Contract signed',
      coalesce(contract_row.signed_name, contract_row.client_name, 'Client')
        || ' signed ' || coalesce(contract_row.title, 'an agreement'),
      jsonb_build_object(
        'bookingContractId', contract_row.id,
        'bookingRequestId',  contract_row.booking_request_id,
        'appointmentId',     contract_row.appointment_id,
        'clientName',        contract_row.client_name,
        'clientEmail',       contract_row.client_email,
        'signedAt',          contract_row.signed_at,
        'contractTitle',     contract_row.title
      )
    );
  exception when others then null;
  end;

  return contract_row;
end;
$function$;

create or replace function public.sign_public_contract(
  token_in           text,
  signed_name_in     text,
  signature_text_in  text,
  initials_in        text default null,
  signed_date_in     date default null,
  ip_address_in      text default null,
  user_agent_in      text default null
)
returns booking_contracts
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  contract_row public.booking_contracts;
begin
  if token_in is null or trim(token_in) = '' then raise exception 'token_required'; end if;
  if signed_name_in is null or trim(signed_name_in) = '' then raise exception 'signed_name_required'; end if;
  if signature_text_in is null or trim(signature_text_in) = '' then raise exception 'signature_required'; end if;

  select bc.* into contract_row from public.booking_contracts as bc
  where bc.public_token = token_in limit 1;

  if contract_row.id is null then
    raise exception 'contract_not_found' using errcode = 'P0002';
  end if;
  if contract_row.status not in ('sent','pending_signature','pending','viewed') then
    raise exception 'contract_not_signable_in_state_%', contract_row.status using errcode = 'P0001';
  end if;
  if contract_row.expires_at is not null and contract_row.expires_at < now() then
    raise exception 'contract_expired';
  end if;
  if coalesce(contract_row.require_initials, false) is true
     and (initials_in is null or trim(initials_in) = '') then
    raise exception 'initials_required';
  end if;

  update public.booking_contracts as bc
  set status         = 'signed',
      signed_at      = now(),
      signed_date    = coalesce(signed_date_in, current_date),
      signed_name    = trim(signed_name_in),
      signature_text = trim(signature_text_in),
      initials       = nullif(trim(coalesce(initials_in, '')), ''),
      ip_address     = nullif(trim(coalesce(ip_address_in, '')), ''),
      user_agent     = nullif(trim(coalesce(user_agent_in, '')), '')
  where bc.id = contract_row.id
  returning bc.* into contract_row;

  insert into public.communication_logs (
    user_id, client_id, booking_request_id, appointment_id, booking_contract_id,
    channel, message_type, recipient, subject, body, status, sent_at
  ) values (
    contract_row.user_id, contract_row.client_id, contract_row.booking_request_id,
    contract_row.appointment_id, contract_row.id,
    'system', 'contract_signed', contract_row.client_email, contract_row.title,
    contract_row.signed_name || ' signed on ' || contract_row.signed_date::text,
    'sent', now()
  );

  begin
    insert into public.notifications (id, user_id, category, title, body, data)
    values (
      'contract_signed:' || contract_row.id::text,
      contract_row.user_id,
      'contract',
      'Contract signed',
      coalesce(contract_row.signed_name, contract_row.client_name, 'Client')
        || ' signed ' || coalesce(contract_row.title, 'an agreement'),
      jsonb_build_object(
        'bookingContractId', contract_row.id,
        'bookingRequestId',  contract_row.booking_request_id,
        'appointmentId',     contract_row.appointment_id,
        'clientName',        contract_row.client_name,
        'clientEmail',       contract_row.client_email,
        'signedAt',          contract_row.signed_at,
        'signedDate',        contract_row.signed_date,
        'contractTitle',     contract_row.title
      )
    );
  exception when others then null;
  end;

  return contract_row;
end;
$function$;
