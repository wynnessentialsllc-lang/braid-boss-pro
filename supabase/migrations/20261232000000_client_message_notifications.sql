-- Restore (and de-duplicate) the stylist alert for new client messages.
--
-- What went wrong: 20261105 added an email alert to
-- public_post_client_message, and 20261106 pointed its web push at
-- '/?focus=inbox' so tapping it lands on the Inbox. 20261223
-- (client message photos) then redefined the function to take an
-- image_url and, in doing so, rewrote the body from the 20260827
-- original — silently dropping BOTH: no more email, and the push went
-- back to '/' (the marketing page when signed out). The worker still
-- carries the client_message_owner_alert template; nothing was
-- enqueueing it.
--
-- This redefinition keeps 20261223's photo handling verbatim and puts
-- the alert path back, with three corrections:
--
--   1. Push deep-links to '/?focus=inbox' again.
--   2. The email is enqueued again, photo-aware (an image-only message
--      previews as "📷 Photo" rather than an empty line).
--   3. The RPC's push now honors profiles.push_disabled_types, so the
--      Account → "Real-time activity pushes" toggle actually governs
--      message pushes instead of being bypassed.
--
-- It also fixes a duplicate that predates all of this: enqueuing a
-- stylist-addressed email fires trg_push_stylist_addressed, which
-- pushes a SECOND banner for the same message — different tag, so it
-- doesn't collapse, and pointed at '/' instead of the Inbox. The
-- trigger now skips the types whose own RPC already pushed.

-- =====================================================================
-- 1. The message RPC — bell + push + email
-- =====================================================================
create or replace function public.public_post_client_message(
  token_in     text,
  body_in      text,
  image_url_in text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  br            public.booking_requests%rowtype;
  v_body        text;
  v_image       text;
  v_client      text;
  v_preview     text;
  v_msg_id      uuid;
  v_owner_email text;
  v_disabled    text[];
begin
  if token_in is null or length(trim(token_in)) < 16 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_token');
  end if;

  v_body := left(trim(coalesce(body_in, '')), 4000);

  -- Only accept an image URL that lives in our own public bucket — the
  -- client hands this back after uploading via /api/client-message-photo,
  -- so anything else is not a real upload from this flow.
  v_image := nullif(trim(coalesce(image_url_in, '')), '');
  if v_image is not null
     and v_image not like '%/storage/v1/object/public/client-message-photos/%' then
    v_image := null;
  end if;

  if (v_body is null or v_body = '') and v_image is null then
    return jsonb_build_object('ok', false, 'reason', 'empty');
  end if;

  select * into br from public.booking_requests
  where portal_token = token_in
  limit 1;
  if br.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  insert into public.client_messages (
    user_id, booking_request_id, sender, body, image_url, read_by_owner, read_by_client
  ) values (
    br.user_id, br.id, 'client', coalesce(v_body, ''), v_image, false, true
  )
  returning id into v_msg_id;

  v_client := coalesce(nullif(trim(br.client_name), ''), 'A client');

  -- One preview line reused by the bell, the push and the email. A
  -- photo with a caption reads "📷 <caption>"; a bare photo reads
  -- "📷 Photo" instead of rendering as blank.
  v_preview := case
    when v_image is not null and coalesce(v_body, '') <> '' then '📷 ' || v_body
    when v_image is not null then '📷 Photo'
    else v_body
  end;

  -- In-app bell for the stylist. Per-message id so each message is its
  -- own entry; the dashboard maps category 'client_message' to an
  -- actionable bell that deep-links to the Inbox.
  begin
    insert into public.notifications (id, user_id, category, title, body, data)
    values (
      'client_message:' || v_msg_id::text,
      br.user_id,
      'client_message',
      'New message from ' || v_client,
      left(v_preview, 140),
      jsonb_build_object(
        'bookingRequestId', br.id,
        'clientName',       v_client,
        'messageId',        v_msg_id
      )
    )
    on conflict (id) do nothing;
  exception when others then
    null;
  end;

  -- Read the stylist's push opt-outs once; both the push below and the
  -- decision to let the email's trigger push are governed by it.
  -- Fails safe to "all on".
  begin
    select coalesce(push_disabled_types, '{}'::text[])
      into v_disabled
      from public.profiles
      where id = br.user_id;
  exception when others then
    v_disabled := '{}'::text[];
  end;
  v_disabled := coalesce(v_disabled, '{}'::text[]);

  -- Web/native push banner, deep-linked to the Inbox. Tagged per thread
  -- so a burst of messages in one conversation collapses into a single
  -- banner rather than stacking. Best-effort.
  if not ('client_message_owner_alert' = any(v_disabled)) then
    begin
      perform public.internal_send_push(
        br.user_id,
        'New message from ' || v_client,
        left(v_preview, 160),
        '/?focus=inbox',
        'client_message:' || br.id::text
      );
    exception when others then
      null;
    end;
  end if;

  -- Email alert to the stylist's login address, so a message still
  -- reaches her with the app closed and push denied. Dedupe keyed on
  -- the message id so a retry can't double-send. Best-effort — never
  -- blocks the message insert.
  begin
    select email into v_owner_email from auth.users where id = br.user_id;
  exception when others then
    v_owner_email := null;
  end;

  if v_owner_email is not null and position('@' in v_owner_email) > 0 then
    begin
      perform public.queue_notification(
        user_id_in            => br.user_id,
        channel_in            => 'email',
        notification_type_in  => 'client_message_owner_alert',
        body_in               => v_client || ' sent you a message: ' || v_preview,
        subject_in            => 'New message from ' || v_client,
        recipient_email_in    => v_owner_email,
        payload_in            => jsonb_build_object(
          'clientName',       v_client,
          'messagePreview',   left(v_preview, 500),
          'imageUrl',         v_image,
          'bookingRequestId', br.id,
          'portalToken',      br.portal_token,
          'messageId',        v_msg_id
        ),
        dedupe_key_in         => 'client_message_email:' || v_msg_id::text,
        booking_request_id_in => br.id
      );
    exception when others then
      null;  -- never block the message insert
    end;
  end if;

  return jsonb_build_object('ok', true, 'id', v_msg_id);
end;
$$;

revoke all on function public.public_post_client_message(text, text, text) from public;
grant execute on function public.public_post_client_message(text, text, text) to anon, authenticated;

-- =====================================================================
-- 2. Stop the queue trigger from double-pushing the same event
-- =====================================================================
-- trg_push_stylist_addressed pushes on every stylist-addressed email.
-- For notification types whose originating RPC already sent its own
-- (better deep-linked) push, that's a second banner for one event.
-- Skip those types here; everything else is unchanged from 20261216.
create or replace function public.push_stylist_addressed_email()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_stylist_email  text;
  v_title          text;
  v_body           text;
  v_tag            text;
  v_disabled_types text[];
  -- Client-facing notification types: these are addressed to the CLIENT
  -- and must never web-push to the stylist, even if the client's email
  -- happens to equal the stylist's login email.
  client_facing_types constant text[] := array[
    'appointment_approved', 'appointment_confirmed', 'appointment_reminder',
    'appointment_rescheduled', 'appointment_updated',
    'balance_paid', 'birthday_greeting',
    'booking_confirmation',
    'booking_denied_no_charge', 'booking_denied_refund_manual', 'booking_denied_refunded',
    'client_booking_cancelled', 'client_booking_rescheduled',
    'contract_invite', 'contract_signing', 'contract_signing_email',
    'deposit_received', 'founding_welcome', 'gift_card_issued',
    'marketing_campaign', 'new_client_welcome',
    'order_confirmation', 'order_ready_for_pickup', 'order_shipped',
    'rebook_nudge', 'reorder_nudge', 'review_request',
    'waitlist_opening', 'winback'
  ];
  -- Types whose own RPC already dispatched a push for this event. The
  -- email still goes out; only the duplicate banner is suppressed.
  self_pushed_types constant text[] := array[
    'client_message_owner_alert'
  ];
begin
  if NEW.channel <> 'email' then return NEW; end if;
  if NEW.recipient_email is null or trim(NEW.recipient_email) = '' then
    return NEW;
  end if;

  -- Client-facing type → never push to the stylist.
  if NEW.notification_type = any(client_facing_types) then
    return NEW;
  end if;

  -- Already pushed by the RPC that enqueued this email.
  if NEW.notification_type = any(self_pushed_types) then
    return NEW;
  end if;

  begin
    select email into v_stylist_email from auth.users where id = NEW.user_id;
  exception when others then
    v_stylist_email := null;
  end;
  if v_stylist_email is null
     or lower(NEW.recipient_email) <> lower(v_stylist_email) then
    return NEW;  -- not addressed to the stylist; nothing to push
  end if;

  -- Honor the stylist's per-type push opt-outs (Account →
  -- "Real-time activity pushes"). Empty/null array = all on. Wrapped so
  -- a missing profiles row or any error fails safe to "all on" and can
  -- never throw out of the trigger and block the queue insert.
  begin
    select coalesce(push_disabled_types, '{}'::text[])
      into v_disabled_types
      from public.profiles
      where id = NEW.user_id;
  exception when others then
    v_disabled_types := '{}'::text[];
  end;
  if NEW.notification_type is not null
     and NEW.notification_type = any(v_disabled_types) then
    return NEW;  -- stylist opted out of push for this type
  end if;

  v_title := nullif(left(trim(coalesce(NEW.subject, '')), 60), '');
  if v_title is null then v_title := 'Braid Boss Pro'; end if;

  v_body := nullif(left(trim(coalesce(NEW.body, '')), 160), '');
  if v_body is null then v_body := ''; end if;

  v_tag := coalesce(NEW.notification_type, 'bbp_notification');
  if NEW.appointment_id is not null then
    v_tag := v_tag || ':' || NEW.appointment_id::text;
  end if;

  begin
    perform public.internal_send_push(
      target_user => NEW.user_id,
      title_in    => v_title,
      body_in     => v_body,
      url_in      => '/',
      tag_in      => v_tag
    );
  exception when others then
    null;
  end;

  return NEW;
end;
$function$;
