-- Reliable server-side owner-alert enqueue.
--
-- The booking-deposit Stripe webhook was resolving the stylist's email
-- with `admin.auth.admin.getUserById()` and only enqueuing the
-- "new paid booking" owner alert `if (ownerEmail)`. In the Vercel
-- runtime that call returns no email, so the alert was silently skipped
-- on every paid booking — `stylist_deposit_paid` has never once been
-- enqueued, so the stylist never got a push (email + in-app bell only).
--
-- The no-deposit path (enqueue_public_booking_emails) never had this
-- problem because it reads auth.users.email directly in Postgres. This
-- RPC exposes that same reliable pattern so the JS webhook can enqueue a
-- stylist-addressed email row WITHOUT having to know the owner's email —
-- the resulting row is turned into a web push by
-- trg_push_stylist_addressed exactly like every other stylist alert.
--
-- Additive and safe: a brand-new function, no existing object changed.

create or replace function public.queue_stylist_email_alert(
  user_id_in            uuid,
  notification_type_in  text,
  subject_in            text,
  body_in               text,
  payload_in            jsonb default '{}'::jsonb,
  dedupe_key_in         text  default null,
  booking_request_id_in uuid  default null,
  appointment_id_in     text  default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_owner_email text;
begin
  if user_id_in is null then
    return jsonb_build_object('ok', false, 'skipped', true, 'reason', 'no_user');
  end if;

  -- Resolve the stylist's login email server-side (auth.users is
  -- readable here; the JS service-role client can't SELECT it). Fail
  -- soft to a skip so a lookup error can never bubble into the caller.
  begin
    select email into v_owner_email from auth.users where id = user_id_in;
  exception when others then
    v_owner_email := null;
  end;

  if v_owner_email is null or position('@' in v_owner_email) = 0 then
    return jsonb_build_object('ok', false, 'skipped', true, 'reason', 'no_owner_email');
  end if;

  -- Reuse the shared queue path (validation, dedupe, communication_logs
  -- mirroring). channel is always email; the row is stylist-addressed,
  -- so the push trigger fires for it.
  return public.queue_notification(
    user_id_in            => user_id_in,
    channel_in            => 'email',
    notification_type_in  => notification_type_in,
    body_in               => body_in,
    subject_in            => subject_in,
    recipient_email_in    => v_owner_email,
    payload_in            => coalesce(payload_in, '{}'::jsonb),
    dedupe_key_in         => dedupe_key_in,
    booking_request_id_in => booking_request_id_in,
    appointment_id_in     => appointment_id_in
  );
end;
$function$;

grant execute on function public.queue_stylist_email_alert(
  uuid, text, text, text, jsonb, text, uuid, text
) to service_role;
