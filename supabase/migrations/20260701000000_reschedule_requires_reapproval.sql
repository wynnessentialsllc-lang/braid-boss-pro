-- Reschedule now requires stylist re-approval before it lands on the
-- calendar.
--
-- Problem with the previous behavior: public_reschedule_booking_by_token
-- wrote the new date straight onto the appointments row. But the
-- stylist's calendar is a local store synced separately, and a
-- client-driven write doesn't flow back cleanly — so the appointment
-- got stuck on the original day in the stylist UI, and the stylist
-- never got to approve the new time.
--
-- New behavior:
--   * booking_requests gets the NEW preferred_date/time, but its
--     approval_status is flipped back to 'deposit_paid_pending_approval'
--     so it re-enters the stylist's Approvals queue + dashboard bell.
--   * appointment_id is cleared and the OLD appointment row is
--     cancelled, so the original slot frees up immediately and nothing
--     shows on the calendar until the stylist re-approves.
--   * On re-approval the normal Approve & schedule flow creates a
--     fresh appointment at the new date (store-aware path), so the
--     calendar stays correct.
--   * Deposit still rolls over; reschedule is still one-shot
--     (reschedule_count + burned token).
--
-- Emails reworded: stylist gets "needs your approval", client gets
-- "request received, pending confirmation" (handled in the worker
-- renderers).

create or replace function public.public_reschedule_booking_by_token(
  token_in     text,
  new_date_in  date,
  new_time_in  text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  br             public.booking_requests%rowtype;
  appt_start_ts  timestamptz;
  new_start_ts   timestamptz;
  old_start_ts   timestamptz;
  old_appt_id    text;
  studio_name    text;
  service_label  text;
  audit_entry    jsonb;
begin
  if token_in is null or length(trim(token_in)) < 16 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_token');
  end if;
  if new_date_in is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_date');
  end if;
  if new_time_in is null or new_time_in !~ '^[0-2][0-9]:[0-5][0-9]$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_time');
  end if;
  new_start_ts := (new_date_in::text || ' ' || new_time_in)::timestamp;
  if new_start_ts <= now() then
    return jsonb_build_object('ok', false, 'reason', 'time_in_past');
  end if;

  select * into br from public.booking_requests
  where reschedule_token = token_in
  limit 1;
  if br.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if br.approval_status = 'cancelled' or br.cancelled_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'cancelled');
  end if;
  if br.reschedule_count >= 1 then
    return jsonb_build_object('ok', false, 'reason', 'already_rescheduled');
  end if;
  if br.preferred_date is not null and br.preferred_time is not null then
    appt_start_ts := (br.preferred_date::text || ' ' || br.preferred_time::text)::timestamp;
    if appt_start_ts < now() then
      return jsonb_build_object('ok', false, 'reason', 'appointment_past');
    end if;
    old_start_ts := appt_start_ts;
  end if;

  old_appt_id := br.appointment_id;

  audit_entry := jsonb_build_object(
    'action', 'reschedule_requested',
    'from_date', br.preferred_date,
    'from_time', br.preferred_time,
    'to_date',   new_date_in,
    'to_time',   new_time_in,
    'token_suffix', right(token_in, 6),
    'at', now()
  );

  -- Move the request to the NEW slot but send it back through
  -- approval. appointment_id is cleared so the re-approval creates a
  -- fresh appointment at the new date via the stylist's normal
  -- store-aware Approve & schedule path.
  update public.booking_requests
  set preferred_date            = new_date_in,
      preferred_time            = new_time_in,
      approval_status           = 'deposit_paid_pending_approval',
      appointment_id            = null,
      reschedule_count          = reschedule_count + 1,
      rescheduled_from          = coalesce(rescheduled_from, old_start_ts),
      rescheduled_at            = now(),
      reschedule_token_used_at  = now(),
      reschedule_token          = null,
      deposit_rollover          = true,
      client_action_audit       = coalesce(client_action_audit, '[]'::jsonb) || jsonb_build_array(audit_entry),
      last_reminder_sent_at     = null,
      updated_at                = now()
  where id = br.id;

  -- Free the original calendar slot immediately by cancelling the
  -- old appointment row. The stylist's calendar already hides
  -- status='cancelled', so the original day clears on next sync.
  if old_appt_id is not null then
    update public.appointments
    set status              = 'cancelled',
        cancelled_at        = coalesce(cancelled_at, now()),
        cancellation_reason = coalesce(
          cancellation_reason,
          'Client rescheduled — awaiting stylist re-approval of the new time'
        ),
        updated_at = now()
    where id = old_appt_id;
  end if;

  studio_name := coalesce(nullif(trim(public.public_get_studio_name(br.user_id)), ''), 'your stylist');
  service_label := coalesce(br.selected_variation_name, br.service_name);

  -- Stylist notification — now an action item, not an FYI.
  begin
    perform public.queue_notification(
      user_id_in           => br.user_id,
      channel_in           => 'email',
      notification_type_in => 'stylist_booking_rescheduled',
      body_in              => 'A client requested a new time. Approve it to add it to your calendar.',
      subject_in           => 'Reschedule request — ' || coalesce(br.client_name, 'a client'),
      recipient_email_in   => (select email from auth.users where id = br.user_id),
      recipient_name_in    => null,
      payload_in           => jsonb_build_object(
        'clientName',  coalesce(br.client_name, 'A client'),
        'serviceName', service_label,
        'fromDate',    (old_start_ts at time zone 'UTC')::date,
        'fromTime',    to_char(old_start_ts at time zone 'UTC', 'HH24:MI'),
        'toDate',      new_date_in,
        'toTime',      new_time_in,
        'needsApproval', true
      ),
      dedupe_key_in        => 'stylist_booking_rescheduled:' || br.id::text || ':' || new_date_in::text || ':' || new_time_in,
      booking_request_id_in => br.id
    );
  exception when others then null;
  end;

  -- Client confirmation — pending, not final.
  if br.client_email is not null then
    begin
      perform public.queue_notification(
        user_id_in           => br.user_id,
        channel_in           => 'email',
        notification_type_in => 'client_booking_rescheduled',
        body_in              => 'Your reschedule request was received.',
        subject_in           => 'Reschedule request received',
        recipient_email_in   => br.client_email,
        recipient_name_in    => br.client_name,
        payload_in           => jsonb_build_object(
          'clientName',  coalesce(br.client_name, 'there'),
          'studioName',  studio_name,
          'serviceName', service_label,
          'fromDate',    (old_start_ts at time zone 'UTC')::date,
          'fromTime',    to_char(old_start_ts at time zone 'UTC', 'HH24:MI'),
          'preferredDate', new_date_in,
          'preferredTime', new_time_in,
          'depositRollover', true,
          'depositAmount', br.deposit_amount,
          'pendingApproval', true
        ),
        dedupe_key_in        => 'client_booking_rescheduled:' || br.id::text || ':' || new_date_in::text || ':' || new_time_in,
        booking_request_id_in => br.id
      );
    exception when others then null;
    end;
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', br.id,
    'preferred_date', new_date_in,
    'preferred_time', new_time_in,
    'pending_approval', true
  );
end $$;

revoke all on function public.public_reschedule_booking_by_token(text, date, text) from public;
grant execute on function public.public_reschedule_booking_by_token(text, date, text) to anon, authenticated;
