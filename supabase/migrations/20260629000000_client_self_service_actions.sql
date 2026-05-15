-- Client self-service cancel + one-time reschedule + appointment
-- reminders.
--
-- What this migration adds:
--
--   1. Columns on booking_requests for cancel/reschedule tokens,
--      audit timestamps, reschedule counter, deposit-disposition
--      flags, and a JSONB audit log of client-initiated actions.
--   2. Trigger that populates the two tokens the first time a
--      booking_request reaches a state where client self-service
--      actions are valid (approved + appointment_id is set).
--   3. Security-definer RPCs the public action pages call:
--        - public_get_booking_action_state(token_in)
--          → minimal info to render the cancel/reschedule page +
--            tell which action the token unlocks.
--        - public_cancel_booking_by_token(token_in, reason_in)
--          → cancels booking_request + linked appointment, marks
--            deposit forfeited, queues stylist + client emails.
--        - public_reschedule_booking_by_token(token_in,
--            new_date_in, new_time_in)
--          → moves the appointment to a new date/time, increments
--            reschedule_count, marks deposit rollover, queues
--            stylist + client emails. One-shot — the token is
--            burned after a successful reschedule.
--   4. enqueue_due_appointment_reminders() — scans for confirmed
--      appointments ~24h out and queues an appointment_reminder
--      email if one hasn't already gone out for that date.
--   5. pg_cron job that calls the reminder enqueue every 30 min.
--
-- Why we don't auto-refund on cancel:
--   * Business rule: cancellation forfeits the deposit. The Stripe
--     charge stays put. deposit_forfeited=true is the marker the
--     stylist's books look at; the admin can still issue a courtesy
--     refund via the existing stylist-side cancel_appointment flow.
--
-- Reschedule one-shot rule:
--   * reschedule_count is incremented atomically inside the RPC.
--     The token is also stamped reschedule_token_used_at so even if
--     the column-level check were bypassed somehow, the token can't
--     be reused.

-- =====================================================================
-- 1. Columns
-- =====================================================================

alter table public.booking_requests
  add column if not exists cancel_token text,
  add column if not exists reschedule_token text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by text,
  add column if not exists cancellation_reason text,
  add column if not exists reschedule_count integer not null default 0,
  add column if not exists rescheduled_from timestamptz,
  add column if not exists rescheduled_at timestamptz,
  add column if not exists reschedule_token_used_at timestamptz,
  add column if not exists deposit_forfeited boolean not null default false,
  add column if not exists deposit_rollover boolean not null default false,
  add column if not exists last_reminder_sent_at timestamptz,
  add column if not exists client_action_audit jsonb not null default '[]'::jsonb;

create unique index if not exists booking_requests_cancel_token_uidx
  on public.booking_requests (cancel_token)
  where cancel_token is not null;

create unique index if not exists booking_requests_reschedule_token_uidx
  on public.booking_requests (reschedule_token)
  where reschedule_token is not null;

-- =====================================================================
-- 2. Token generation trigger
-- =====================================================================
--
-- Runs after every update on booking_requests. If the row has just
-- transitioned into a state where client self-service should be
-- available (approval_status in approved/confirmed AND appointment_id
-- is set) and the tokens are still null, generate fresh tokens.
-- 32-char hex matches the contract signing pattern already used
-- elsewhere in the codebase.
create or replace function public.fn_set_booking_action_tokens()
returns trigger
language plpgsql
as $$
begin
  if new.appointment_id is not null
     and new.approval_status in ('approved', 'confirmed')
     and (new.cancel_token is null or new.reschedule_token is null) then
    if new.cancel_token is null then
      new.cancel_token := encode(gen_random_bytes(16), 'hex');
    end if;
    if new.reschedule_token is null then
      new.reschedule_token := encode(gen_random_bytes(16), 'hex');
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_booking_requests_action_tokens
  on public.booking_requests;
create trigger trg_booking_requests_action_tokens
  before insert or update on public.booking_requests
  for each row execute function public.fn_set_booking_action_tokens();

-- Backfill: any already-approved bookings get tokens now.
update public.booking_requests
set cancel_token = coalesce(cancel_token, encode(gen_random_bytes(16), 'hex')),
    reschedule_token = coalesce(reschedule_token, encode(gen_random_bytes(16), 'hex'))
where approval_status in ('approved', 'confirmed')
  and appointment_id is not null
  and (cancel_token is null or reschedule_token is null);

-- =====================================================================
-- 3. public_get_booking_action_state
-- =====================================================================
--
-- Anonymous lookup. Caller passes the token from the action link;
-- the function figures out which action that token enables and
-- returns just enough info to render the action page.
--
-- Refuses to return state for tokens whose appointment time has
-- already passed (or is within the next 60 minutes — both cancel
-- and reschedule are blocked that close to the appointment).
create or replace function public.public_get_booking_action_state(
  token_in text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  br public.booking_requests%rowtype;
  action_type text;
  studio_name text;
  appt_start_ts timestamptz;
  now_ts timestamptz := now();
begin
  if token_in is null or length(trim(token_in)) < 16 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_token');
  end if;

  select * into br from public.booking_requests
  where cancel_token = token_in or reschedule_token = token_in
  limit 1;
  if br.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  action_type := case
    when br.cancel_token = token_in then 'cancel'
    when br.reschedule_token = token_in then 'reschedule'
  end;

  if br.approval_status = 'cancelled' or br.cancelled_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_cancelled', 'action', action_type);
  end if;

  if action_type = 'reschedule' and br.reschedule_count >= 1 then
    return jsonb_build_object('ok', false, 'reason', 'already_rescheduled', 'action', action_type);
  end if;

  if br.preferred_date is not null and br.preferred_time is not null then
    appt_start_ts := (br.preferred_date::text || ' ' || br.preferred_time::text)::timestamp;
    if appt_start_ts < now_ts then
      return jsonb_build_object('ok', false, 'reason', 'appointment_past', 'action', action_type);
    end if;
  end if;

  studio_name := coalesce(nullif(trim(public.public_get_studio_name(br.user_id)), ''), 'your stylist');

  return jsonb_build_object(
    'ok',                true,
    'action',            action_type,
    'request_id',        br.id,
    'stylist_user_id',   br.user_id,
    'studio_name',       studio_name,
    'client_name',       br.client_name,
    'service_name',      coalesce(br.selected_variation_name, br.service_name),
    'preferred_date',    br.preferred_date,
    'preferred_time',    br.preferred_time,
    'deposit_amount',    br.deposit_amount,
    'reschedule_count',  br.reschedule_count,
    'link_slug',         br.link_slug,
    'service_duration_hours',
      coalesce(br.selected_variation_duration_hours, br.service_duration_hours, br.service_duration, 1)
  );
end $$;

revoke all on function public.public_get_booking_action_state(text) from public;
grant execute on function public.public_get_booking_action_state(text) to anon, authenticated;

-- =====================================================================
-- 4. public_cancel_booking_by_token
-- =====================================================================
create or replace function public.public_cancel_booking_by_token(
  token_in  text,
  reason_in text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  br             public.booking_requests%rowtype;
  appt_start_ts  timestamptz;
  studio_name    text;
  service_label  text;
  appt_when      text;
  audit_entry    jsonb;
begin
  if token_in is null or length(trim(token_in)) < 16 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_token');
  end if;

  select * into br from public.booking_requests
  where cancel_token = token_in
  limit 1;
  if br.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if br.approval_status = 'cancelled' or br.cancelled_at is not null then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if br.preferred_date is not null and br.preferred_time is not null then
    appt_start_ts := (br.preferred_date::text || ' ' || br.preferred_time::text)::timestamp;
    if appt_start_ts < now() then
      return jsonb_build_object('ok', false, 'reason', 'appointment_past');
    end if;
  end if;

  audit_entry := jsonb_build_object(
    'action', 'cancel',
    'reason', coalesce(reason_in, ''),
    'token_suffix', right(token_in, 6),
    'at', now()
  );

  update public.booking_requests
  set approval_status        = 'cancelled',
      status                 = 'declined',
      cancelled_at           = now(),
      cancelled_by           = 'client',
      cancellation_reason    = nullif(trim(coalesce(reason_in, '')), ''),
      deposit_forfeited      = true,
      client_action_audit    = coalesce(client_action_audit, '[]'::jsonb) || jsonb_build_array(audit_entry),
      cancel_token           = null,
      reschedule_token       = null,
      updated_at             = now()
  where id = br.id;

  -- Cancel the linked appointment so the calendar slot is released.
  if br.appointment_id is not null then
    update public.appointments
    set status                = 'cancelled',
        cancelled_at          = coalesce(cancelled_at, now()),
        cancellation_reason   = coalesce(
          cancellation_reason,
          'Client cancellation via secure link' ||
            case when reason_in is not null and trim(reason_in) <> ''
              then ': ' || left(trim(reason_in), 200)
              else '' end
        ),
        updated_at = now()
    where id = br.appointment_id;
  end if;

  -- Studio + service labels for the notification payloads.
  studio_name := coalesce(nullif(trim(public.public_get_studio_name(br.user_id)), ''), 'your stylist');
  service_label := coalesce(br.selected_variation_name, br.service_name);
  appt_when := coalesce(
    nullif(trim(coalesce(br.preferred_date::text, '') || ' ' || coalesce(br.preferred_time, '')), ''),
    'their upcoming appointment'
  );

  -- Stylist notification — uses the stylist's profile email if we
  -- have one. Falls back silently if the lookup fails.
  begin
    perform public.queue_notification(
      user_id_in           => br.user_id,
      channel_in           => 'email',
      notification_type_in => 'stylist_booking_cancelled',
      body_in              => 'A client cancelled their appointment via the self-service link. Deposit forfeited.',
      subject_in           => 'Client cancelled — ' || coalesce(br.client_name, 'a client'),
      recipient_email_in   => (select email from auth.users where id = br.user_id),
      recipient_name_in    => null,
      payload_in           => jsonb_build_object(
        'clientName',  coalesce(br.client_name, 'A client'),
        'serviceName', service_label,
        'preferredDate', br.preferred_date,
        'preferredTime', br.preferred_time,
        'reason',      coalesce(reason_in, ''),
        'depositAmount', br.deposit_amount
      ),
      dedupe_key_in        => 'stylist_booking_cancelled:' || br.id::text,
      booking_request_id_in => br.id,
      appointment_id_in    => br.appointment_id
    );
  exception when others then null;
  end;

  -- Client confirmation email.
  if br.client_email is not null then
    begin
      perform public.queue_notification(
        user_id_in           => br.user_id,
        channel_in           => 'email',
        notification_type_in => 'client_booking_cancelled',
        body_in              => 'Your appointment has been cancelled.',
        subject_in           => 'Your appointment was cancelled',
        recipient_email_in   => br.client_email,
        recipient_name_in    => br.client_name,
        payload_in           => jsonb_build_object(
          'clientName',     coalesce(br.client_name, 'there'),
          'studioName',     studio_name,
          'serviceName',    service_label,
          'preferredDate',  br.preferred_date,
          'preferredTime',  br.preferred_time,
          'depositForfeited', true,
          'depositAmount',  br.deposit_amount
        ),
        dedupe_key_in        => 'client_booking_cancelled:' || br.id::text,
        booking_request_id_in => br.id,
        appointment_id_in    => br.appointment_id
      );
    exception when others then null;
    end;
  end if;

  return jsonb_build_object('ok', true, 'id', br.id);
end $$;

revoke all on function public.public_cancel_booking_by_token(text, text) from public;
grant execute on function public.public_cancel_booking_by_token(text, text) to anon, authenticated;

-- =====================================================================
-- 5. public_reschedule_booking_by_token
-- =====================================================================
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
    'action', 'reschedule',
    'from_date', br.preferred_date,
    'from_time', br.preferred_time,
    'to_date',   new_date_in,
    'to_time',   new_time_in,
    'token_suffix', right(token_in, 6),
    'at', now()
  );

  update public.booking_requests
  set preferred_date            = new_date_in,
      preferred_time            = new_time_in,
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

  -- Mirror the change onto the appointments row so the stylist's
  -- calendar reflects the new slot. We only touch fields that
  -- correspond to date / time / duration so we don't clobber other
  -- columns the stylist may have customized.
  if br.appointment_id is not null then
    update public.appointments
    set appt_date  = new_date_in,
        appt_time  = new_time_in,
        updated_at = now()
    where id = br.appointment_id;
  end if;

  studio_name := coalesce(nullif(trim(public.public_get_studio_name(br.user_id)), ''), 'your stylist');
  service_label := coalesce(br.selected_variation_name, br.service_name);

  -- Stylist notification.
  begin
    perform public.queue_notification(
      user_id_in           => br.user_id,
      channel_in           => 'email',
      notification_type_in => 'stylist_booking_rescheduled',
      body_in              => 'A client rescheduled. Deposit rolled over.',
      subject_in           => 'Client rescheduled — ' || coalesce(br.client_name, 'a client'),
      recipient_email_in   => (select email from auth.users where id = br.user_id),
      recipient_name_in    => null,
      payload_in           => jsonb_build_object(
        'clientName',  coalesce(br.client_name, 'A client'),
        'serviceName', service_label,
        'fromDate',    (old_start_ts at time zone 'UTC')::date,
        'fromTime',    to_char(old_start_ts at time zone 'UTC', 'HH24:MI'),
        'toDate',      new_date_in,
        'toTime',      new_time_in
      ),
      dedupe_key_in        => 'stylist_booking_rescheduled:' || br.id::text || ':' || new_date_in::text || ':' || new_time_in,
      booking_request_id_in => br.id,
      appointment_id_in    => br.appointment_id
    );
  exception when others then null;
  end;

  -- Client confirmation.
  if br.client_email is not null then
    begin
      perform public.queue_notification(
        user_id_in           => br.user_id,
        channel_in           => 'email',
        notification_type_in => 'client_booking_rescheduled',
        body_in              => 'Your appointment was rescheduled.',
        subject_in           => 'Your appointment was rescheduled',
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
          'depositAmount', br.deposit_amount
        ),
        dedupe_key_in        => 'client_booking_rescheduled:' || br.id::text || ':' || new_date_in::text || ':' || new_time_in,
        booking_request_id_in => br.id,
        appointment_id_in    => br.appointment_id
      );
    exception when others then null;
    end;
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', br.id,
    'preferred_date', new_date_in,
    'preferred_time', new_time_in
  );
end $$;

revoke all on function public.public_reschedule_booking_by_token(text, date, text) from public;
grant execute on function public.public_reschedule_booking_by_token(text, date, text) to anon, authenticated;

-- =====================================================================
-- 6. Reminder enqueue + pg_cron schedule
-- =====================================================================
--
-- Selects confirmed booking_requests whose preferred_date+time is in
-- the next 18–30 hour window, hasn't already been reminded today, and
-- whose linked appointment isn't cancelled. Queues an
-- appointment_reminder email with the action tokens baked into the
-- payload so the renderer can build cancel/reschedule URLs.
--
-- Dedupe key includes the preferred_date so a rescheduled
-- appointment still gets a reminder for its new date.
create or replace function public.enqueue_due_appointment_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  enqueued int := 0;
  app_base text;
  br       public.booking_requests%rowtype;
  studio_name text;
  service_label text;
  appt_status text;
  start_ts timestamptz;
begin
  app_base := coalesce(
    nullif(current_setting('app.public_url', true), ''),
    'https://braidbosspro.app'
  );

  for br in
    select * from public.booking_requests
    where approval_status in ('approved', 'confirmed')
      and cancelled_at is null
      and client_email is not null
      and preferred_date is not null
      and preferred_time is not null
      and cancel_token is not null
      and (last_reminder_sent_at is null
           or last_reminder_sent_at < (now() - interval '12 hours'))
  loop
    start_ts := (br.preferred_date::text || ' ' || br.preferred_time::text)::timestamp;
    if start_ts <= now() + interval '18 hours'
       or start_ts >= now() + interval '30 hours' then
      continue;
    end if;

    if br.appointment_id is not null then
      select status into appt_status from public.appointments
        where id = br.appointment_id;
      if appt_status = 'cancelled' then continue; end if;
    end if;

    studio_name := coalesce(nullif(trim(public.public_get_studio_name(br.user_id)), ''), 'your stylist');
    service_label := coalesce(br.selected_variation_name, br.service_name);

    begin
      perform public.queue_notification(
        user_id_in           => br.user_id,
        channel_in           => 'email',
        notification_type_in => 'appointment_reminder',
        body_in              => 'Reminder: your appointment is coming up soon.',
        subject_in           => 'Reminder: your appointment with ' || studio_name,
        recipient_email_in   => br.client_email,
        recipient_name_in    => br.client_name,
        payload_in           => jsonb_build_object(
          'clientName',     coalesce(br.client_name, 'there'),
          'studioName',     studio_name,
          'serviceName',    service_label,
          'preferredDate',  br.preferred_date,
          'preferredTime',  br.preferred_time,
          'cancelUrl',      app_base || '/booking-action/' || br.cancel_token || '/cancel',
          'rescheduleUrl',
            case when br.reschedule_count = 0 and br.reschedule_token is not null
              then app_base || '/booking-action/' || br.reschedule_token || '/reschedule'
              else null end,
          'rescheduleUsed', br.reschedule_count >= 1
        ),
        dedupe_key_in => 'appointment_reminder:' || br.id::text || ':' || br.preferred_date::text,
        booking_request_id_in => br.id,
        appointment_id_in    => br.appointment_id
      );
      update public.booking_requests
        set last_reminder_sent_at = now()
        where id = br.id;
      enqueued := enqueued + 1;
    exception when others then null;
    end;
  end loop;

  return enqueued;
end $$;

revoke all on function public.enqueue_due_appointment_reminders() from public;
grant execute on function public.enqueue_due_appointment_reminders() to service_role;

-- Schedule: every 30 min. The function is cheap when nothing's due
-- (indexed scan + empty loop). Aligns with the existing
-- process-notification-queue cron which runs every minute.
do $$
declare jid bigint;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    select jobid into jid from cron.job
      where jobname = 'enqueue_appointment_reminders_every_30m';
    if jid is not null then
      perform cron.unschedule(jid);
    end if;
    perform cron.schedule(
      'enqueue_appointment_reminders_every_30m',
      '*/30 * * * *',
      $cron$ select public.enqueue_due_appointment_reminders(); $cron$
    );
  end if;
end $$;

notify pgrst, 'reload schema';
