-- Reschedule: keep the appointment_id so re-approval MOVES the
-- existing appointment instead of creating a duplicate.
--
-- Bug: the previous version cleared booking_requests.appointment_id
-- and cancelled the old appointments row. On re-approval the
-- stylist's Approve & schedule path then created a brand-new
-- appointment at the new date — but the stylist's local calendar
-- store still had the old (server-cancelled) row, so the
-- appointment showed on BOTH the old and new dates.
--
-- Fix: leave appointment_id in place and don't cancel the
-- appointment here. The booking still goes back to
-- deposit_paid_pending_approval (so it re-enters the Approvals
-- queue + dashboard bell and nothing is final until the stylist
-- approves), but because the appointment_id is preserved, the
-- stylist's re-approval upserts the SAME appointment record with
-- the new date — the local store moves it in place (old date
-- clears, new date shows), no duplicate.
--
-- Still: one-shot (reschedule_count + burned token), deposit rolls
-- over, stylist gets the action email, NO client email until the
-- stylist approves (handled by confirmApproval's
-- appointment_confirmed, whose dedupe key now includes the date so
-- the post-reschedule approval sends a fresh confirmation).

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

  audit_entry := jsonb_build_object(
    'action', 'reschedule_requested',
    'from_date', br.preferred_date,
    'from_time', br.preferred_time,
    'to_date',   new_date_in,
    'to_time',   new_time_in,
    'token_suffix', right(token_in, 6),
    'at', now()
  );

  -- NOTE: appointment_id is intentionally left as-is, and the
  -- appointments row is NOT cancelled here. Re-approval reuses the
  -- same appointment id and moves it to the new date in one record.
  update public.booking_requests
  set preferred_date            = new_date_in,
      preferred_time            = new_time_in,
      approval_status           = 'deposit_paid_pending_approval',
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

  studio_name := coalesce(nullif(trim(public.public_get_studio_name(br.user_id)), ''), 'your stylist');
  service_label := coalesce(br.selected_variation_name, br.service_name);

  -- Stylist action email only. No client email until the stylist
  -- approves — confirmApproval queues appointment_confirmed then,
  -- and its dedupe key includes the date so the post-reschedule
  -- approval sends a fresh confirmation.
  begin
    perform public.queue_notification(
      user_id_in           => br.user_id,
      channel_in           => 'email',
      notification_type_in => 'stylist_booking_rescheduled',
      body_in              => 'A client requested a new time. Approve it to move it on your calendar.',
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
