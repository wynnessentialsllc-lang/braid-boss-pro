-- Email the stylist a full copy of the signed contract — their records copy.
--
-- sign_public_contract already (a) flips the booking_contracts row to
-- 'signed', (b) writes a communication_logs audit row, and (c) lights
-- up the stylist's in-app bell via public.notifications. What it has
-- NEVER done is email the stylist a durable, documented copy of what
-- the client actually signed.
--
-- This migration closes that gap. After the signature commits, both
-- overloads now enqueue a 'contract_signed_owner_alert' EMAIL to the
-- stylist through the standard queue_notification path (the same
-- queue the process-notification-queue worker drains). The payload
-- carries the full agreement snapshot + the signature audit trail
-- (typed signature, initials, signed date/time, IP, device) so the
-- rendered email is a self-contained proof-of-signing the stylist can
-- keep, print, or forward.
--
-- Design notes, consistent with the rest of the contract pipeline:
--   * Best-effort. The enqueue is wrapped in EXCEPTION so a mail /
--     lookup problem can NEVER block the signing itself.
--   * Idempotent. dedupe_key 'contract_signed:<id>' (the documented
--     convention in app/lib/notifications.ts dedupe.contractSignedOwnerAlert)
--     makes a re-invocation a no-op rather than a second email.
--   * Anonymous-safe. Signing runs as anon (auth.uid() is null), so
--     queue_notification's caller-match guard is skipped, and
--     public_get_studio_name is already granted to anon.
--   * Owner email resolved from auth.users, mirroring the
--     review_received notification.
--
-- Both overloads are updated; all prior behavior is preserved verbatim
-- and only the email enqueue block is added before the final return.

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
  v_owner_email     text;
  v_studio          text;
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

  -- Email the stylist a full, documented copy of the signed contract.
  -- Best-effort: a mail / lookup failure must never block the sign.
  begin
    select au.email into v_owner_email from auth.users au where au.id = contract_row.user_id;
    v_studio := coalesce(nullif(trim(public.public_get_studio_name(contract_row.user_id)), ''), 'your studio');

    perform public.queue_notification(
      user_id_in            => contract_row.user_id,
      channel_in            => 'email',
      notification_type_in  => 'contract_signed_owner_alert',
      body_in               => coalesce(contract_row.signed_name, contract_row.client_name, 'A client')
                                 || ' signed ' || coalesce(contract_row.title, 'an agreement') || '.',
      subject_in            => 'Signed contract: ' || coalesce(contract_row.title, 'Agreement')
                                 || ' — ' || coalesce(contract_row.signed_name, contract_row.client_name, 'client'),
      recipient_email_in    => v_owner_email,
      recipient_name_in     => v_studio,
      booking_request_id_in => contract_row.booking_request_id,
      appointment_id_in     => contract_row.appointment_id,
      client_id_in          => contract_row.client_id,
      contract_id_in        => contract_row.id,
      payload_in            => jsonb_build_object(
        'studioName',     v_studio,
        'contractTitle',  contract_row.title,
        'serviceName',    contract_row.service_name,
        'clientName',     contract_row.client_name,
        'clientEmail',    contract_row.client_email,
        'clientPhone',    contract_row.client_phone,
        'bodySnapshot',   contract_row.body_snapshot,
        'signedName',     contract_row.signed_name,
        'signatureText',  contract_row.signature_text,
        'initials',       contract_row.initials,
        'signedDate',     contract_row.signed_date,
        'signedAt',       contract_row.signed_at,
        'ipAddress',      contract_row.ip_address,
        'userAgent',      contract_row.user_agent
      ),
      dedupe_key_in         => 'contract_signed:' || contract_row.id::text
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
  contract_row  public.booking_contracts;
  v_owner_email text;
  v_studio      text;
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

  -- Email the stylist a full, documented copy of the signed contract.
  -- Best-effort: a mail / lookup failure must never block the sign.
  begin
    select au.email into v_owner_email from auth.users au where au.id = contract_row.user_id;
    v_studio := coalesce(nullif(trim(public.public_get_studio_name(contract_row.user_id)), ''), 'your studio');

    perform public.queue_notification(
      user_id_in            => contract_row.user_id,
      channel_in            => 'email',
      notification_type_in  => 'contract_signed_owner_alert',
      body_in               => coalesce(contract_row.signed_name, contract_row.client_name, 'A client')
                                 || ' signed ' || coalesce(contract_row.title, 'an agreement') || '.',
      subject_in            => 'Signed contract: ' || coalesce(contract_row.title, 'Agreement')
                                 || ' — ' || coalesce(contract_row.signed_name, contract_row.client_name, 'client'),
      recipient_email_in    => v_owner_email,
      recipient_name_in     => v_studio,
      booking_request_id_in => contract_row.booking_request_id,
      appointment_id_in     => contract_row.appointment_id,
      client_id_in          => contract_row.client_id,
      contract_id_in        => contract_row.id,
      payload_in            => jsonb_build_object(
        'studioName',     v_studio,
        'contractTitle',  contract_row.title,
        'serviceName',    contract_row.service_name,
        'clientName',     contract_row.client_name,
        'clientEmail',    contract_row.client_email,
        'clientPhone',    contract_row.client_phone,
        'bodySnapshot',   contract_row.body_snapshot,
        'signedName',     contract_row.signed_name,
        'signatureText',  contract_row.signature_text,
        'initials',       contract_row.initials,
        'signedDate',     contract_row.signed_date,
        'signedAt',       contract_row.signed_at,
        'ipAddress',      contract_row.ip_address,
        'userAgent',      contract_row.user_agent
      ),
      dedupe_key_in         => 'contract_signed:' || contract_row.id::text
    );
  exception when others then null;
  end;

  return contract_row;
end;
$function$;
