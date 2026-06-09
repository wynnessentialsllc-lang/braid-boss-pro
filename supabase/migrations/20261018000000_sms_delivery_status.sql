-- SMS delivery receipts.
--
-- The worker marks an SMS row 'sent' once Twilio ACCEPTS it, but that
-- isn't the same as the carrier DELIVERING it (e.g. error 30032 — toll-
-- free not verified — is accepted then dropped). The twilio-status edge
-- function receives Twilio's status callbacks and calls this RPC to:
--   * record the real outcome on notification_queue.status
--       delivered            -> 'delivered'
--       undelivered / failed -> 'failed' (+ failure_reason carrier code)
--   * refund one SMS credit when an accepted message ends up undelivered
--     (the worker only refunds on a Twilio API reject, not a later
--     carrier drop), exactly once.
--
-- Idempotent: the refund only fires on the FIRST transition into a
-- failed state (the guarded UPDATE returns no row on repeat callbacks).

create or replace function public.record_sms_delivery_status(
  message_sid_in text,
  status_in      text,
  error_code_in  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_norm text;
begin
  if message_sid_in is null or trim(message_sid_in) = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_sid');
  end if;
  v_norm := lower(coalesce(status_in, ''));

  if v_norm = 'delivered' then
    update public.notification_queue
       set status = 'delivered'
     where provider_message_id = message_sid_in
       and channel = 'sms'
       and status not in ('delivered', 'failed');
    return jsonb_build_object('ok', true, 'status', 'delivered');

  elsif v_norm in ('undelivered', 'failed') then
    -- First transition into failed → refund one credit.
    update public.notification_queue
       set status = 'failed',
           failure_reason = 'carrier_' || coalesce(nullif(error_code_in, ''), v_norm)
     where provider_message_id = message_sid_in
       and channel = 'sms'
       and status <> 'failed'
     returning user_id into v_user;

    if v_user is not null then
      begin
        perform public.refund_sms_credit(
          v_user,
          'sms_undelivered_' || coalesce(nullif(error_code_in, ''), v_norm)
        );
      exception when others then null;
      end;
      return jsonb_build_object('ok', true, 'status', 'failed', 'refunded', true);
    end if;
    return jsonb_build_object('ok', true, 'status', 'failed', 'refunded', false);
  end if;

  -- Intermediate statuses (queued / sending / sent / accepted): ignore.
  return jsonb_build_object('ok', true, 'ignored', v_norm);
end;
$$;

revoke all on function public.record_sms_delivery_status(text, text, text) from public;
grant execute on function public.record_sms_delivery_status(text, text, text) to service_role;
