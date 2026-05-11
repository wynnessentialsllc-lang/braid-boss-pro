-- Phase B12.1a fix — anon-callable enqueue wrapper.
--
-- The B12.1a `queue_notification` RPC is granted to `authenticated`
-- and `service_role` only — by design, since granting it to `anon`
-- would let anyone enqueue arbitrary emails through the queue (spam
-- vector). But the public booking submit at /book/<slug> runs as
-- anon, so it couldn't enqueue the booking_confirmation +
-- contract_signing emails the architecture spec calls for.
--
-- This migration adds a thin SECURITY DEFINER wrapper that anon CAN
-- call, scoped to a single booking_request_id. The caller provides
-- the request id they just received from public_submit_booking_request;
-- the wrapper looks up the row server-side, then internally enqueues
-- the right emails. Anon never gets direct write access to the
-- queue table or the lower-level queue_notification RPC — they can
-- only fan out emails for a booking_request that actually exists.
--
-- Idempotent. Dedupe keys collide on retried calls so re-running
-- against the same request id is a no-op for already-enqueued events.

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

  -- Studio display name for the email greeting. Falls back through
  -- business_name → full_name → app default so the email never reads
  -- "from null".
  select coalesce(p.business_name, p.full_name, 'Braid Boss Pro')
    into studio_name
  from public.profiles p
  where p.id = br_row.user_id
  limit 1;
  studio_name := coalesce(studio_name, 'Braid Boss Pro');

  base_url := nullif(trim(coalesce(app_base_url_in, '')), '');

  -- 1. booking_confirmation — only when we have an email to send to.
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

  -- 2. contract_signing — one per non-terminal contract on this request.
  for contract_row in
    select id, title, public_token, status,
           coalesce(client_email, br_row.client_email) as recip_email,
           coalesce(client_name,  br_row.client_name)  as recip_name
    from public.booking_contracts
    where booking_request_id = br_row.id
      and status not in ('signed','declined','voided','expired')
  loop
    if contract_row.recip_email is null
       or position('@' in contract_row.recip_email) = 0
       or contract_row.public_token is null then
      continue;
    end if;
    signing_url := case
      when base_url is not null then base_url || '/contract/' || contract_row.public_token
      else 'https://braidbosspro.app/contract/' || contract_row.public_token
    end;
    payload_obj := jsonb_build_object(
      'clientName',    coalesce(contract_row.recip_name, 'there'),
      'studioName',    studio_name,
      'contractTitle', contract_row.title,
      'serviceName',   br_row.service_name,
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

revoke all on function public.enqueue_public_booking_emails(uuid, text) from public;
grant execute on function public.enqueue_public_booking_emails(uuid, text) to anon, authenticated;
