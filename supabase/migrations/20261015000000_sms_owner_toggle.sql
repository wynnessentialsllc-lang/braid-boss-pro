-- Per-stylist master switch for SMS notifications.
--
-- Clients opt in to texts on the booking form and the stylist must hold
-- SMS credits, but until now there was no way for a stylist to turn the
-- whole SMS channel on or off for their account. This adds that switch.
--
-- Design:
--   * profiles.sms_notifications_enabled (boolean, default FALSE) — the
--     owner-level switch. Defaults OFF so SMS is strictly opt-in per
--     stylist even after the platform-wide feature flag is on.
--   * The gate is enforced centrally in queue_notification(): every SMS
--     enqueue path (reminders, confirmations, booking receipts) funnels
--     through it, so one check covers them all without editing each
--     enqueue function.
--   * profiles is intentionally locked for direct client writes (only
--     update(updated_at) is granted, to protect lifetime_access /
--     founding_access / connect columns), so the flag is flipped through
--     a SECURITY DEFINER RPC scoped to the caller's own row.

alter table public.profiles
  add column if not exists sms_notifications_enabled boolean not null default false;

-- Read helper used by the queue gate. STABLE + SECURITY DEFINER so the
-- service-role worker and the enqueue RPCs can both consult it. Defaults
-- to false when the profile row is missing.
create or replace function public.sms_notifications_enabled_for(user_id_in uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select sms_notifications_enabled from public.profiles where id = user_id_in),
    false
  );
$$;

-- Only the service-role worker calls this directly; the enqueue gate
-- reaches it from inside SECURITY DEFINER queue_notification (which runs
-- as its owner), so authenticated does NOT need execute. Keeping it off
-- authenticated avoids exposing another stylist's SMS flag over the API.
revoke all on function public.sms_notifications_enabled_for(uuid) from public;
grant execute on function public.sms_notifications_enabled_for(uuid) to service_role;

-- Owner-controlled setter. Flips the flag for the calling stylist only;
-- never touches any other column or row.
create or replace function public.set_sms_notifications_enabled(enabled_in boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid;
begin
  caller := auth.uid();
  if caller is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  update public.profiles
     set sms_notifications_enabled = coalesce(enabled_in, false),
         updated_at = now()
   where id = caller;
  return coalesce(enabled_in, false);
end;
$$;

revoke all on function public.set_sms_notifications_enabled(boolean) from public;
grant execute on function public.set_sms_notifications_enabled(boolean) to authenticated;

-- =====================================================================
-- queue_notification — re-created verbatim from
-- 20260530000000_phase_b12_1a_notification_queue.sql with ONE addition:
-- a per-owner SMS master-switch gate right after the recipient checks.
-- =====================================================================
create or replace function public.queue_notification(
  user_id_in            uuid,
  channel_in            text,
  notification_type_in  text,
  body_in               text,
  subject_in            text          default null,
  recipient_email_in    text          default null,
  recipient_phone_in    text          default null,
  recipient_name_in     text          default null,
  payload_in            jsonb         default '{}'::jsonb,
  scheduled_for_in      timestamptz   default null,
  dedupe_key_in         text          default null,
  booking_request_id_in uuid          default null,
  appointment_id_in     text          default null,
  client_id_in          text          default null,
  contract_id_in        uuid          default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller        uuid;
  new_id        uuid;
  resolved_when timestamptz;
begin
  caller := auth.uid();
  if caller is not null and caller <> user_id_in then
    raise exception 'user_mismatch' using errcode = '42501';
  end if;
  if user_id_in is null then
    raise exception 'user_id_required' using errcode = '22023';
  end if;
  if channel_in is null or channel_in not in ('email','sms') then
    raise exception 'invalid_channel' using errcode = '22023';
  end if;
  if notification_type_in is null or trim(notification_type_in) = '' then
    raise exception 'notification_type_required' using errcode = '22023';
  end if;
  if body_in is null then
    raise exception 'body_required' using errcode = '22023';
  end if;
  -- Channel-specific recipient sanity. Don't enqueue rows that the
  -- dispatcher will immediately reject.
  if channel_in = 'email' and (recipient_email_in is null or position('@' in recipient_email_in) = 0) then
    return jsonb_build_object(
      'ok', false, 'skipped', true, 'reason', 'no_recipient_email'
    );
  end if;
  if channel_in = 'sms' and (recipient_phone_in is null or length(trim(recipient_phone_in)) < 7) then
    return jsonb_build_object(
      'ok', false, 'skipped', true, 'reason', 'no_recipient_phone'
    );
  end if;

  -- Per-owner SMS master switch. When the stylist has SMS turned off,
  -- drop every SMS row here so a single setting governs all SMS paths
  -- (reminders, confirmations, booking receipts) without editing each
  -- enqueue function. Email is unaffected.
  if channel_in = 'sms' and not public.sms_notifications_enabled_for(user_id_in) then
    return jsonb_build_object(
      'ok', false, 'skipped', true, 'reason', 'sms_disabled_by_owner'
    );
  end if;

  resolved_when := coalesce(scheduled_for_in, now());

  if dedupe_key_in is not null and trim(dedupe_key_in) <> '' then
    insert into public.notification_queue (
      user_id, channel, notification_type,
      recipient_name, recipient_email, recipient_phone,
      subject, body, payload, scheduled_for,
      dedupe_key,
      booking_request_id, appointment_id, client_id, contract_id
    ) values (
      user_id_in, channel_in, notification_type_in,
      recipient_name_in, recipient_email_in, recipient_phone_in,
      subject_in, body_in, coalesce(payload_in, '{}'::jsonb), resolved_when,
      dedupe_key_in,
      booking_request_id_in, appointment_id_in, client_id_in, contract_id_in
    )
    on conflict (dedupe_key) where dedupe_key is not null do nothing
    returning id into new_id;

    if new_id is null then
      return jsonb_build_object(
        'ok', true, 'skipped', true, 'reason', 'dedupe_match'
      );
    end if;
    return jsonb_build_object('ok', true, 'id', new_id, 'skipped', false);
  end if;

  insert into public.notification_queue (
    user_id, channel, notification_type,
    recipient_name, recipient_email, recipient_phone,
    subject, body, payload, scheduled_for,
    booking_request_id, appointment_id, client_id, contract_id
  ) values (
    user_id_in, channel_in, notification_type_in,
    recipient_name_in, recipient_email_in, recipient_phone_in,
    subject_in, body_in, coalesce(payload_in, '{}'::jsonb), resolved_when,
    booking_request_id_in, appointment_id_in, client_id_in, contract_id_in
  )
  returning id into new_id;

  return jsonb_build_object('ok', true, 'id', new_id, 'skipped', false);
end;
$$;

revoke all on function public.queue_notification(
  uuid, text, text, text, text, text, text, text, jsonb, timestamptz,
  text, uuid, text, text, uuid
) from public;
grant execute on function public.queue_notification(
  uuid, text, text, text, text, text, text, text, jsonb, timestamptz,
  text, uuid, text, text, uuid
) to authenticated, service_role;
