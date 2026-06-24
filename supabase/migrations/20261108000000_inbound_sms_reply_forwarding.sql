-- Forward inbound SMS replies into the existing client_messages thread.
--
-- The shared sending number is one-way by design (notifications + STOP/
-- START). When a client texts back something that ISN'T a keyword, we now
-- route it to the stylist instead of dropping it: resolve the client's
-- most recent booking request (by phone), drop the text into that
-- booking's client_messages thread, and raise the same stylist bell +
-- web push the in-app portal messages do. The stylist answers from the
-- existing Inbox UI.
--
-- Called only by the twilio-inbound edge function (service_role) AFTER it
-- verifies the Twilio signature — never exposed to anon/authenticated, so
-- a spoofed `From` can't inject messages into someone's thread.
--
-- Returns auto_reply=true when this is the first inbound text on the
-- thread in the last 12h, so the edge function can send a single courtesy
-- auto-reply (option 3) without spamming a chatty client.

create or replace function public.record_inbound_sms_reply(
  phone_in text,
  body_in  text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  norm     text;
  br       public.booking_requests%rowtype;
  v_body   text;
  v_client text;
  v_studio text;
  v_msg_id uuid;
  v_recent int;
begin
  norm := public.sms_normalize_phone(coalesce(phone_in, ''));
  if norm is null or length(norm) < 7 then
    return jsonb_build_object('ok', false, 'reason', 'bad_phone');
  end if;

  v_body := nullif(left(trim(coalesce(body_in, '')), 4000), '');
  if v_body is null then
    return jsonb_build_object('ok', false, 'reason', 'empty');
  end if;

  -- Most recent booking request for this phone = the stylist + thread the
  -- client most likely means to reply to.
  select * into br
  from public.booking_requests
  where public.sms_normalize_phone(client_phone) = norm
  order by created_at desc
  limit 1;
  if br.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_thread');
  end if;

  insert into public.client_messages (
    user_id, booking_request_id, sender, body, read_by_owner, read_by_client
  ) values (
    br.user_id, br.id, 'client', v_body, false, true
  )
  returning id into v_msg_id;

  v_client := coalesce(nullif(trim(br.client_name), ''), 'A client');
  v_studio := coalesce(nullif(trim(public.public_get_studio_name(br.user_id)), ''),
                       'your stylist');

  -- In-app bell for the stylist (same shape as portal messages, flagged
  -- viaSms so the UI can label the source if it wants).
  begin
    insert into public.notifications (id, user_id, category, title, body, data)
    values (
      'client_message:' || v_msg_id::text,
      br.user_id,
      'client_message',
      'New text from ' || v_client,
      left(v_body, 140),
      jsonb_build_object(
        'bookingRequestId', br.id,
        'clientName',       v_client,
        'messageId',        v_msg_id,
        'viaSms',           true
      )
    )
    on conflict (id) do nothing;
  exception when others then
    null;
  end;

  -- Best-effort web push.
  begin
    perform public.internal_send_push(
      br.user_id,
      'New text from ' || v_client,
      left(v_body, 160),
      '/',
      'client_message:' || br.id::text
    );
  exception when others then
    null;
  end;

  -- Courtesy auto-reply only on the first inbound text in a 12h window.
  select count(*) into v_recent
  from public.client_messages
  where booking_request_id = br.id
    and sender = 'client'
    and id <> v_msg_id
    and created_at > now() - interval '12 hours';

  return jsonb_build_object(
    'ok',          true,
    'auto_reply',  (v_recent = 0),
    'studio_name', v_studio,
    'message_id',  v_msg_id
  );
end;
$$;

revoke all on function public.record_inbound_sms_reply(text, text) from public;
grant execute on function public.record_inbound_sms_reply(text, text) to service_role;
