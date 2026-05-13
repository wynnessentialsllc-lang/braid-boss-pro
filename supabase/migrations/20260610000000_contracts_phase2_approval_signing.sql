-- Contracts Phase 2: generate and send service contracts after booking approval.

alter table public.booking_contracts
  add column if not exists template_type text null,
  add column if not exists service_name text null,
  add column if not exists require_signature boolean not null default true,
  add column if not exists require_initials boolean not null default false,
  add column if not exists signed_date date null;

update public.booking_contracts bc
set template_type = coalesce(bc.template_type, ct.template_type),
    require_signature = coalesce(bc.require_signature, ct.require_signature, true),
    require_initials = coalesce(bc.require_initials, ct.require_initials, false)
from public.contract_templates ct
where ct.id = bc.contract_template_id;

do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'booking_contracts_status_chk'
  ) then
    alter table public.booking_contracts drop constraint booking_contracts_status_chk;
  end if;

  alter table public.booking_contracts
    add constraint booking_contracts_status_chk
    check (status in (
      'sent','pending_signature','pending','viewed',
      'signed','declined','expired','void','voided'
    ));
end $$;

update public.booking_contracts
set status = 'pending_signature'
where status = 'viewed';

create or replace function public.generate_booking_contracts(
  booking_request_id_in uuid,
  appointment_id_in text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  br_row public.booking_requests;
  inserted_count integer := 0;
  effective_appointment_id text;
begin
  if booking_request_id_in is null then
    return 0;
  end if;

  select * into br_row
  from public.booking_requests
  where id = booking_request_id_in
  limit 1;

  if br_row.id is null then
    return 0;
  end if;

  effective_appointment_id := nullif(trim(coalesce(appointment_id_in, br_row.appointment_id, '')), '');

  with candidate_templates as (
    select distinct on (ct.id)
      ct.id as template_id,
      ct.title,
      ct.template_type,
      ct.body,
      ct.require_signature,
      ct.require_initials,
      br_row.service_name as service_name
    from public.contract_templates ct
    left join public.services s
      on s.id = br_row.service_id
     and s.user_id = br_row.user_id
    where ct.user_id = br_row.user_id
      and ct.is_active = true
      and (
        s.contract_template_id = ct.id
        or ct.attach_to_all_bookings = true
        or exists (
          select 1
          from public.service_contract_templates sct
          where sct.contract_template_id = ct.id
            and sct.service_id = br_row.service_id
        )
      )
    order by ct.id, case when s.contract_template_id = ct.id then 0 else 1 end
  ),
  to_insert as (
    select *
    from candidate_templates ct
    where not exists (
      select 1 from public.booking_contracts bc
      where bc.booking_request_id = br_row.id
        and bc.contract_template_id = ct.template_id
    )
  ),
  inserted as (
    insert into public.booking_contracts (
      user_id, client_id, booking_request_id, appointment_id,
      contract_template_id, title, template_type, body_snapshot,
      service_name, require_signature, require_initials,
      status, client_name, client_email, client_phone
    )
    select
      br_row.user_id,
      null,
      br_row.id,
      effective_appointment_id,
      template_id,
      title,
      template_type,
      body,
      service_name,
      require_signature,
      require_initials,
      'sent',
      br_row.client_name,
      br_row.client_email,
      br_row.client_phone
    from to_insert
    returning 1
  )
  select count(*) into inserted_count from inserted;

  update public.booking_contracts bc
  set appointment_id = coalesce(nullif(trim(bc.appointment_id), ''), effective_appointment_id),
      service_name = coalesce(bc.service_name, br_row.service_name),
      client_name = coalesce(bc.client_name, br_row.client_name),
      client_email = coalesce(bc.client_email, br_row.client_email),
      client_phone = coalesce(bc.client_phone, br_row.client_phone)
  where bc.booking_request_id = br_row.id
    and (
      effective_appointment_id is not null
      or bc.service_name is null
      or bc.client_name is null
      or bc.client_email is null
      or bc.client_phone is null
    );

  return coalesce(inserted_count, 0);
end;
$$;

revoke all on function public.generate_booking_contracts(uuid, text) from public;
grant execute on function public.generate_booking_contracts(uuid, text) to anon, authenticated;

create or replace function public.get_public_contract_by_token(token_in text)
returns table (
  id                  uuid,
  title               text,
  template_type       text,
  body_snapshot       text,
  status              text,
  client_name         text,
  client_email        text,
  signed_at           timestamptz,
  signed_date         date,
  viewed_at           timestamptz,
  expires_at          timestamptz,
  require_signature   boolean,
  require_initials    boolean,
  business_name       text,
  service_name        text,
  preferred_date      date,
  preferred_time      text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  contract_row public.booking_contracts;
begin
  if token_in is null or trim(token_in) = '' then
    return;
  end if;

  select * into contract_row
  from public.booking_contracts bc
  where bc.public_token = token_in
  limit 1;

  if contract_row.id is null then
    return;
  end if;

  if contract_row.status in ('sent','pending','viewed') and contract_row.viewed_at is null then
    update public.booking_contracts
    set status = 'pending_signature',
        viewed_at = now()
    where id = contract_row.id and viewed_at is null
    returning * into contract_row;
  elsif contract_row.status in ('pending','viewed') then
    update public.booking_contracts
    set status = 'pending_signature'
    where id = contract_row.id
    returning * into contract_row;
  end if;

  return query
  select
    contract_row.id,
    contract_row.title,
    contract_row.template_type,
    contract_row.body_snapshot,
    contract_row.status,
    contract_row.client_name,
    contract_row.client_email,
    contract_row.signed_at,
    contract_row.signed_date,
    contract_row.viewed_at,
    contract_row.expires_at,
    coalesce(contract_row.require_signature, true),
    coalesce(contract_row.require_initials, false),
    coalesce(p.business_name, p.full_name) as business_name,
    coalesce(contract_row.service_name, br.service_name) as service_name,
    br.preferred_date,
    br.preferred_time
  from public.profiles p
  left join public.booking_requests br
    on br.id = contract_row.booking_request_id
  where p.id = contract_row.user_id
  limit 1;
end;
$$;

revoke all on function public.get_public_contract_by_token(text) from public;
grant execute on function public.get_public_contract_by_token(text) to anon, authenticated;

create or replace function public.sign_public_contract(
  token_in           text,
  signed_name_in     text,
  signature_text_in  text,
  initials_in        text default null,
  signed_date_in     date default null,
  ip_address_in      text default null,
  user_agent_in      text default null
)
returns public.booking_contracts
language plpgsql
security definer
set search_path = public
as $$
declare
  contract_row public.booking_contracts;
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

  select * into contract_row
  from public.booking_contracts
  where public_token = token_in
  limit 1;

  if contract_row.id is null then
    raise exception 'contract_not_found' using errcode = 'P0002';
  end if;
  if contract_row.status not in ('sent','pending_signature','pending','viewed') then
    raise exception 'contract_not_signable_in_state_%', contract_row.status
      using errcode = 'P0001';
  end if;
  if contract_row.expires_at is not null and contract_row.expires_at < now() then
    raise exception 'contract_expired';
  end if;
  if coalesce(contract_row.require_initials, false) is true
     and (initials_in is null or trim(initials_in) = '') then
    raise exception 'initials_required';
  end if;

  update public.booking_contracts
  set status = 'signed',
      signed_at = now(),
      signed_date = coalesce(signed_date_in, current_date),
      signed_name = trim(signed_name_in),
      signature_text = trim(signature_text_in),
      initials = nullif(trim(coalesce(initials_in, '')), ''),
      ip_address = nullif(trim(coalesce(ip_address_in, '')), ''),
      user_agent = nullif(trim(coalesce(user_agent_in, '')), '')
  where id = contract_row.id
  returning * into contract_row;

  insert into public.communication_logs (
    user_id, client_id, booking_request_id, appointment_id,
    booking_contract_id, channel, message_type, recipient, subject,
    body, status, sent_at
  ) values (
    contract_row.user_id, contract_row.client_id, contract_row.booking_request_id,
    contract_row.appointment_id, contract_row.id, 'system', 'contract_signed',
    contract_row.client_email, contract_row.title,
    contract_row.signed_name || ' signed on ' || contract_row.signed_date::text,
    'sent', now()
  );

  return contract_row;
end;
$$;

revoke all on function public.sign_public_contract(text, text, text, text, date, text, text) from public;
grant execute on function public.sign_public_contract(text, text, text, text, date, text, text) to anon, authenticated;

create or replace function public.enqueue_contract_signing_for_request(
  request_id_in       uuid,
  app_base_url_in     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  br_row         public.booking_requests;
  studio_name    text;
  enqueued       integer := 0;
  base_url       text;
  contract_row   record;
  signing_url    text;
  payload_obj    jsonb;
  rpc_result     jsonb;
begin
  if request_id_in is null then
    return jsonb_build_object('ok', false, 'reason', 'request_id_required');
  end if;

  select * into br_row
  from public.booking_requests
  where id = request_id_in
  limit 1;
  if br_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'request_not_found');
  end if;

  perform public.generate_booking_contracts(br_row.id, br_row.appointment_id);

  select coalesce(p.business_name, p.full_name, 'Braid Boss Pro')
    into studio_name
  from public.profiles p
  where p.id = br_row.user_id
  limit 1;
  studio_name := coalesce(studio_name, 'Braid Boss Pro');
  base_url := coalesce(nullif(trim(app_base_url_in), ''), 'https://braidbosspro.app');

  for contract_row in
    select id, title, public_token, status,
           coalesce(client_email, br_row.client_email) as recip_email,
           coalesce(client_name,  br_row.client_name)  as recip_name,
           coalesce(service_name, br_row.service_name) as service_name
    from public.booking_contracts
    where booking_request_id = br_row.id
      and status in ('sent','pending_signature','pending','viewed')
  loop
    if contract_row.recip_email is null
       or position('@' in contract_row.recip_email) = 0
       or contract_row.public_token is null then
      continue;
    end if;
    signing_url := base_url || '/sign/contract/' || contract_row.public_token;
    payload_obj := jsonb_build_object(
      'clientName',    coalesce(contract_row.recip_name, 'there'),
      'studioName',    studio_name,
      'contractTitle', contract_row.title,
      'serviceName',   contract_row.service_name,
      'contractUrl',   signing_url
    );
    rpc_result := public.queue_notification(
      user_id_in            => br_row.user_id,
      channel_in            => 'email',
      notification_type_in  => 'contract_signing',
      body_in               => 'Please review and sign your appointment agreement',
      subject_in            => 'Please review and sign your appointment agreement',
      recipient_email_in    => contract_row.recip_email,
      recipient_name_in     => contract_row.recip_name,
      payload_in            => payload_obj,
      dedupe_key_in         => 'contract_invite:' || contract_row.id::text,
      booking_request_id_in => br_row.id,
      appointment_id_in     => br_row.appointment_id,
      contract_id_in        => contract_row.id
    );
    if coalesce((rpc_result->>'ok')::boolean, false)
       and not coalesce((rpc_result->>'skipped')::boolean, false) then
      enqueued := enqueued + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'enqueued', enqueued);
end;
$$;

revoke all on function public.enqueue_contract_signing_for_request(uuid, text) from public;
grant execute on function public.enqueue_contract_signing_for_request(uuid, text) to authenticated;

create or replace function public.enqueue_public_booking_emails(
  request_id_in       uuid,
  app_base_url_in     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  br_row         public.booking_requests;
  studio_name    text;
  enqueued       integer := 0;
  payload_obj    jsonb;
  rpc_result     jsonb;
begin
  if request_id_in is null then
    return jsonb_build_object('ok', false, 'reason', 'request_id_required');
  end if;

  select * into br_row
  from public.booking_requests
  where id = request_id_in
  limit 1;
  if br_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'request_not_found');
  end if;

  select coalesce(p.business_name, p.full_name, 'Braid Boss Pro')
    into studio_name
  from public.profiles p
  where p.id = br_row.user_id
  limit 1;
  studio_name := coalesce(studio_name, 'Braid Boss Pro');

  if br_row.client_email is not null and position('@' in br_row.client_email) > 0 then
    payload_obj := jsonb_build_object(
      'clientName',     coalesce(br_row.client_name, 'there'),
      'studioName',     studio_name,
      'serviceName',    br_row.service_name,
      'preferredDate',  br_row.preferred_date::text,
      'preferredTime',  br_row.preferred_time,
      'approvalStatus', br_row.approval_status,
      'depositRequired', br_row.deposit_required
    );
    rpc_result := public.queue_notification(
      user_id_in            => br_row.user_id,
      channel_in            => 'email',
      notification_type_in  => 'booking_confirmation',
      body_in               => 'Booking request received',
      subject_in            => 'Booking request received — ' || studio_name,
      recipient_email_in    => br_row.client_email,
      recipient_name_in     => br_row.client_name,
      payload_in            => payload_obj,
      dedupe_key_in         => 'booking_confirmation:' || br_row.id::text,
      booking_request_id_in => br_row.id
    );
    if coalesce((rpc_result->>'ok')::boolean, false)
       and not coalesce((rpc_result->>'skipped')::boolean, false) then
      enqueued := enqueued + 1;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'enqueued', enqueued);
end;
$$;

revoke all on function public.enqueue_public_booking_emails(uuid, text) from public;
grant execute on function public.enqueue_public_booking_emails(uuid, text) to anon, authenticated;
