-- One-off stylist-composed outreach to a single client — the "Send"
-- behind the Rebooking screen's AI message, so a generated email/text
-- goes straight to the contact on file instead of being copy-pasted
-- into another app.
--
-- Deliberately built on the existing marketing rails rather than a new
-- delivery path:
--   * Enqueues notification_type 'marketing_campaign', the type already
--     reserved for stylist-composed one-offs. That buys the branded
--     email shell, the merge-tag pass, the unsubscribe footer, the
--     marketing FROM identity, and — for SMS — a place on the narrow
--     allow-list of types permitted to leave over Twilio, plus the
--     worker's automatic "Reply STOP to opt out" suffix.
--   * Recipient eligibility mirrors process_marketing_campaign exactly
--     (20261103). A blast and a single send must not have different
--     consent rules; this is the same gate applied to one row.
--
-- Returns { ok, reason, channel, to } rather than raising, so the app
-- can explain precisely why a send is blocked ("no phone on file",
-- "unsubscribed", "out of SMS credits") instead of showing a generic
-- failure.

create or replace function public.send_client_outreach(
  client_id_in text,
  channel_in   text,
  subject_in   text,
  body_in      text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller     uuid := auth.uid();
  v_channel  text := lower(coalesce(channel_in, 'email'));
  v_body     text;
  v_subject  text;
  v_client   record;
  v_studio   text;
  v_slug     text;
  v_book_url text;
  v_token    text;
  v_phone    text;
  v_payload  jsonb;
  v_dedupe   text;
  v_sms      text;
  v_balance  int;
  v_res      jsonb;
begin
  if caller is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;
  if v_channel not in ('email', 'sms') then
    return jsonb_build_object('ok', false, 'reason', 'bad_channel');
  end if;

  v_body := left(trim(coalesce(body_in, '')), 4000);
  if v_body = '' then
    return jsonb_build_object('ok', false, 'reason', 'empty');
  end if;
  v_subject := nullif(left(trim(coalesce(subject_in, '')), 200), '');

  -- Ownership: the client must belong to the caller.
  select c.id, c.name, c.email, c.phone,
         coalesce(c.marketing_emails_enabled, true) as marketing_ok
    into v_client
    from public.clients c
   where c.user_id = caller and c.id = client_id_in
   limit 1;
  if v_client.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select coalesce(p.business_name, p.full_name),
         coalesce(bl.slug, p.public_slug)
    into v_studio, v_slug
    from public.profiles p
    left join public.booking_links bl on bl.user_id = p.id and bl.active = true
   where p.id = caller;
  v_studio := coalesce(nullif(trim(v_studio), ''), 'your stylist');

  v_book_url := case
    when v_slug is not null and length(trim(v_slug)) > 0
      then 'https://braidbosspro.app/book/' || v_slug
    else 'https://braidbosspro.app'
  end;

  -- Collapse an accidental double-tap (same client, same channel, same
  -- minute) while still allowing a deliberate resend later.
  v_dedupe := 'outreach:' || caller::text || ':' || v_client.id || ':' || v_channel
              || ':' || to_char(now() at time zone 'utc', 'YYYYMMDDHH24MI');

  -- ---------------------------------------------------------------
  -- Email
  -- ---------------------------------------------------------------
  if v_channel = 'email' then
    if v_client.email is null or length(trim(v_client.email)) < 3
       or position('@' in v_client.email) = 0 then
      return jsonb_build_object('ok', false, 'reason', 'no_email');
    end if;
    -- Honors the unsubscribe link in every marketing email we send.
    if not v_client.marketing_ok then
      return jsonb_build_object('ok', false, 'reason', 'unsubscribed');
    end if;

    v_token := public.ensure_client_marketing_token(caller, v_client.id);

    v_payload := jsonb_build_object(
      'subject',          coalesce(v_subject, 'A note from ' || v_studio),
      'bodyText',         v_body,
      'clientName',       v_client.name,
      'studioName',       v_studio,
      'bookingSlug',      v_slug,
      'unsubscribeToken', v_token
    );

    v_res := public.queue_notification(
      caller, 'email', 'marketing_campaign',
      v_body, coalesce(v_subject, 'A note from ' || v_studio),
      v_client.email, null, v_client.name,
      v_payload, null, v_dedupe, null, null, v_client.id, null
    );

    return jsonb_build_object(
      'ok',      coalesce((v_res->>'ok')::boolean, false),
      'reason',  coalesce(v_res->>'reason', ''),
      'channel', 'email',
      'to',      v_client.email
    );
  end if;

  -- ---------------------------------------------------------------
  -- SMS — same consent gate as a promotional SMS campaign
  -- ---------------------------------------------------------------
  if not coalesce(
       (select sms_notifications_enabled from public.profiles where id = caller), false) then
    return jsonb_build_object('ok', false, 'reason', 'sms_off');
  end if;
  if not coalesce(
       (select sms_marketing_enabled from public.profiles where id = caller), false) then
    return jsonb_build_object('ok', false, 'reason', 'sms_marketing_off');
  end if;

  v_phone := public.sms_normalize_phone(v_client.phone);
  if v_phone is null or length(v_phone) < 7 then
    return jsonb_build_object('ok', false, 'reason', 'no_phone');
  end if;
  if exists (select 1 from public.sms_opt_outs o where o.phone = v_phone) then
    return jsonb_build_object('ok', false, 'reason', 'stopped');
  end if;
  -- Marketing SMS requires the separate consent given on a booking form.
  if not exists (
    select 1 from public.booking_requests br
     where br.user_id = caller
       and coalesce(br.sms_marketing_opt_in, false) = true
       and public.sms_normalize_phone(br.client_phone) = v_phone
  ) then
    return jsonb_build_object('ok', false, 'reason', 'no_sms_consent');
  end if;

  -- The worker consumes a credit at send time; checking here turns a
  -- silent queue failure into an actionable message.
  select balance into v_balance from public.sms_credits where user_id = caller;
  if coalesce(v_balance, 0) < 1 then
    return jsonb_build_object('ok', false, 'reason', 'no_credits');
  end if;

  -- SMS bodies are plain text, so merge tags are substituted here (the
  -- email path does it in the edge function renderer).
  v_sms := v_body;
  v_sms := replace(v_sms, '{{client_name}}', coalesce(nullif(trim(v_client.name), ''), 'there'));
  v_sms := replace(v_sms, '{{studio_name}}', v_studio);
  v_sms := replace(v_sms, '{{book_url}}', v_book_url);

  v_payload := jsonb_build_object(
    'smsText',    v_sms,
    'clientName', v_client.name,
    'studioName', v_studio
  );

  v_res := public.queue_notification(
    caller, 'sms', 'marketing_campaign',
    v_sms, null,
    null, v_client.phone, v_client.name,
    v_payload, null, v_dedupe, null, null, v_client.id, null
  );

  return jsonb_build_object(
    'ok',      coalesce((v_res->>'ok')::boolean, false),
    'reason',  coalesce(v_res->>'reason', ''),
    'channel', 'sms',
    'to',      v_client.phone
  );
end;
$$;

revoke all on function public.send_client_outreach(text, text, text, text) from public;
grant execute on function public.send_client_outreach(text, text, text, text) to authenticated;
