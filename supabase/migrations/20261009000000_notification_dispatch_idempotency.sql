-- Reliability: make notification dispatch idempotent against the
-- "sent but mark_notification_sent failed" window.
--
-- Today the worker claims a row (status -> processing), for SMS consumes
-- a prepaid credit, sends via Twilio, then calls mark_notification_sent.
-- If Twilio ACCEPTS the message but mark_notification_sent then fails
-- (network blip / edge timeout), the row stays 'processing'. After 30
-- min sweep_stuck_notifications flips it back to 'queued', the next tick
-- re-claims it, consumes ANOTHER credit, and sends the SMS AGAIN — a
-- duplicate text and a double charge (and a duplicate email on the same
-- path).
--
-- Fix relies on provider_message_id (the Twilio SID / Resend id), which
-- already exists on notification_queue and is preserved by the sweep
-- (the sweep only touches status/processing_started_at/failure_reason).
-- The worker now stamps provider_message_id with a fast write right
-- after the provider accepts — BEFORE the terminal mark — and on any
-- re-claim of a row that already carries a provider_message_id it
-- finalizes (mark_sent) instead of resending.
--
-- For the worker to see it, the claim RPC must return it. This
-- redefinition is identical to the original EXCEPT it adds
-- provider_message_id to the returned row JSON. Same signature
-- (jsonb, limit_in integer) so it's a drop-in create-or-replace; the
-- claim/lock logic (FOR UPDATE SKIP LOCKED) is unchanged.

create or replace function public.mark_notification_processing(
  limit_in integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_ids uuid[];
  rows_json jsonb;
begin
  with candidates as (
    select id
    from public.notification_queue
    where status = 'queued'
      and scheduled_for <= now()
    order by scheduled_for asc
    limit greatest(1, least(coalesce(limit_in, 25), 200))
    for update skip locked
  ),
  claimed as (
    update public.notification_queue nq
    set status = 'processing',
        processing_started_at = now()
    from candidates c
    where nq.id = c.id
    returning nq.id
  )
  select array_agg(id) into claimed_ids from claimed;

  if claimed_ids is null or array_length(claimed_ids, 1) = 0 then
    return jsonb_build_object('rows', '[]'::jsonb, 'claimed', 0);
  end if;

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
    into rows_json
  from (
    select id, user_id, channel, notification_type,
           recipient_email, recipient_phone, recipient_name,
           subject, body, payload,
           scheduled_for, status, retry_count, dedupe_key,
           booking_request_id, appointment_id, client_id, contract_id,
           provider_message_id
    from public.notification_queue
    where id = any(claimed_ids)
  ) t;

  return jsonb_build_object(
    'rows', rows_json,
    'claimed', coalesce(array_length(claimed_ids, 1), 0)
  );
end;
$$;

revoke all on function public.mark_notification_processing(integer) from public;
grant execute on function public.mark_notification_processing(integer) to service_role;
