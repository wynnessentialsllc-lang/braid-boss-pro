-- Deep-link client-message push notifications to the Inbox.
--
-- public_post_client_message fired its web/native push with path '/',
-- which drops the stylist on the home screen (or the marketing page when
-- signed out) instead of the conversation. The app's deep-link handler
-- now understands ?focus=inbox, so point the push there. Identical to the
-- 20261105 definition except for the push path.

create or replace function public.public_post_client_message(
  token_in text,
  body_in  text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  br            public.booking_requests%rowtype;
  v_body        text;
  v_client      text;
  v_msg_id      uuid;
  v_owner_email text;
begin
  if token_in is null or length(trim(token_in)) < 16 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_token');
  end if;

  v_body := nullif(left(trim(coalesce(body_in, '')), 4000), '');
  if v_body is null then
    return jsonb_build_object('ok', false, 'reason', 'empty');
  end if;

  select * into br from public.booking_requests
  where portal_token = token_in
  limit 1;
  if br.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  insert into public.client_messages (
    user_id, booking_request_id, sender, body, read_by_owner, read_by_client
  ) values (
    br.user_id, br.id, 'client', v_body, false, true
  )
  returning id into v_msg_id;

  v_client := coalesce(nullif(trim(br.client_name), ''), 'A client');

  -- In-app bell for the stylist.
  begin
    insert into public.notifications (id, user_id, category, title, body, data)
    values (
      'client_message:' || v_msg_id::text,
      br.user_id,
      'client_message',
      'New message from ' || v_client,
      left(v_body, 140),
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

  -- Web-push banner — deep-links to the Inbox. Best-effort.
  begin
    perform public.internal_send_push(
      br.user_id,
      'New message from ' || v_client,
      left(v_body, 160),
      '/?focus=inbox',
      'client_message:' || br.id::text
    );
  exception when others then
    null;
  end;

  -- Email alert to the stylist (goes to their login address).
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
        body_in               => v_client || ' sent you a message: ' || v_body,
        subject_in            => 'New message from ' || v_client,
        recipient_email_in    => v_owner_email,
        payload_in            => jsonb_build_object(
          'clientName',       v_client,
          'messagePreview',   left(v_body, 500),
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

revoke all on function public.public_post_client_message(text, text) from public;
grant execute on function public.public_post_client_message(text, text) to anon, authenticated;
