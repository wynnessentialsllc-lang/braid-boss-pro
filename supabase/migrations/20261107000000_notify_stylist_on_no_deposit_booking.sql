-- Notify the stylist when a NO-DEPOSIT booking request lands.
--
-- Context: the deposit-first flow intentionally holds every stylist
-- notification until the deposit clears — the deposit webhook
-- (app/api/booking-deposit/webhook) fires the stylist's "new paid
-- booking" ping (stylist_deposit_paid), so unpaid/abandoned requests
-- never reach the stylist. That was correct only because we assumed
-- every booking required a deposit.
--
-- Not every stylist requires a deposit. A no-deposit request lands as
-- `pending_review` and is a real booking the moment it arrives, yet
-- nothing ever pinged the stylist about it: enqueue_public_booking_
-- emails only sent the CLIENT their "request received" confirmation.
-- The result was a booking the stylist could only stumble on by
-- opening the Approvals queue unprompted.
--
-- Fix: when (and only when) the request requires no deposit, also
-- enqueue a stylist-addressed alert here. Addressing it to the
-- stylist's own login email means the existing push trigger
-- (push_stylist_addressed_email) turns it into a web push, and the
-- notification type (stylist_new_booking) is stylist-facing so it
-- isn't filtered out by the client-facing denylist. Deposit-first
-- requests are untouched — they still stay quiet until the deposit
-- clears.
--
-- Reproduced from 20261020 (hair-bring confirmations) verbatim, with
-- the stylist alert appended. Idempotent: queue_notification dedupes
-- on `new_booking_owner:<request_id>` so a retried submit can't
-- double-ping.

create or replace function public.enqueue_public_booking_emails(
  request_id_in    uuid,
  app_base_url_in  text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  br_row public.booking_requests;
  svc_row public.services%rowtype;
  studio_name text;
  enqueued integer := 0;
  payload_obj jsonb;
  rpc_result jsonb;
  app_base text;
  sms_body text;
  v_hair text;
  v_hair_sms text;
  v_owner_email text;
  v_when text;
begin
  if request_id_in is null then
    return jsonb_build_object('ok', false, 'reason', 'request_id_required');
  end if;
  select * into br_row from public.booking_requests where id = request_id_in limit 1;
  if br_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'request_not_found');
  end if;
  select coalesce(p.business_name, p.full_name, 'Braid Boss Pro') into studio_name
  from public.profiles p where p.id = br_row.user_id limit 1;
  studio_name := coalesce(studio_name, 'Braid Boss Pro');
  if br_row.service_id is not null then
    select * into svc_row from public.services where id = br_row.service_id limit 1;
  end if;
  v_hair := public.hair_bring_text(br_row.service_id, false);
  v_hair_sms := public.hair_bring_text(br_row.service_id, true);
  app_base := coalesce(
    nullif(trim(coalesce(app_base_url_in, '')), ''),
    nullif(current_setting('app.public_url', true), ''),
    'https://braidbosspro.app'
  );
  if br_row.client_email is not null and position('@' in br_row.client_email) > 0 then
    payload_obj := jsonb_build_object(
      'clientName', coalesce(br_row.client_name, 'there'),
      'studioName', studio_name,
      'serviceName', br_row.service_name,
      'preferredDate', br_row.preferred_date::text,
      'preferredTime', br_row.preferred_time,
      'approvalStatus', br_row.approval_status,
      'depositRequired', br_row.deposit_required,
      'hairIncluded', coalesce(svc_row.hair_included, false),
      'hairBring', v_hair,
      'selectedHairColor', coalesce(br_row.selected_hair_color, br_row.customization_summary->>'custom_hair_color'),
      'selectedCurlPattern', coalesce(br_row.selected_curl_pattern, br_row.customization_summary->>'custom_curl_pattern'),
      'prepReminder', nullif(trim(coalesce(svc_row.prep_instructions, '')), ''),
      'portalUrl', case when br_row.portal_token is not null
                        then app_base || '/client/appointment/' || br_row.portal_token else null end
    );
    rpc_result := public.queue_notification(
      user_id_in => br_row.user_id,
      channel_in => 'email',
      notification_type_in => 'booking_confirmation',
      body_in => 'Booking request received',
      subject_in => 'Booking request received — ' || studio_name,
      recipient_email_in => br_row.client_email,
      recipient_name_in => br_row.client_name,
      payload_in => payload_obj,
      dedupe_key_in => 'booking_confirmation:' || br_row.id::text,
      booking_request_id_in => br_row.id
    );
    if coalesce((rpc_result->>'ok')::boolean, false)
       and not coalesce((rpc_result->>'skipped')::boolean, false) then
      enqueued := enqueued + 1;
    end if;
  end if;

  if coalesce(br_row.sms_opt_in, false)
     and br_row.client_phone is not null
     and length(public.sms_normalize_phone(br_row.client_phone)) >= 7
     and not exists (select 1 from public.sms_opt_outs o
                     where o.phone = public.sms_normalize_phone(br_row.client_phone))
     and coalesce((select balance from public.sms_credits where user_id = br_row.user_id), 0) > 0
  then
    sms_body := 'Booking request received by ' || studio_name
                || '. You''ll hear back once it''s confirmed.';
    if v_hair_sms is not null then
      sms_body := sms_body || ' Bring: ' || v_hair_sms || '.';
    end if;
    begin
      rpc_result := public.queue_notification(
        user_id_in => br_row.user_id,
        channel_in => 'sms',
        notification_type_in => 'booking_confirmation',
        body_in => sms_body,
        recipient_phone_in => br_row.client_phone,
        recipient_name_in => br_row.client_name,
        payload_in => jsonb_build_object('smsText', sms_body),
        dedupe_key_in => 'booking_confirmation_sms:' || br_row.id::text,
        booking_request_id_in => br_row.id
      );
      if coalesce((rpc_result->>'ok')::boolean, false)
         and not coalesce((rpc_result->>'skipped')::boolean, false) then
        enqueued := enqueued + 1;
      end if;
    exception when others then null;
    end;
  end if;

  -- Stylist alert — NO-DEPOSIT requests only. A deposit-first request
  -- stays quiet until the deposit clears (the deposit webhook pings the
  -- stylist then); a no-deposit request is a confirmed-intent booking
  -- the moment it lands, so the stylist hears about it now. Addressed to
  -- the stylist's own login email so push_stylist_addressed_email turns
  -- it into a web push; stylist_new_booking is stylist-facing so the
  -- client-facing denylist doesn't suppress that push. Best-effort —
  -- never blocks the client confirmation above.
  if not coalesce(br_row.deposit_required, false) then
    begin
      select email into v_owner_email from auth.users where id = br_row.user_id;
    exception when others then
      v_owner_email := null;
    end;
    if v_owner_email is not null and position('@' in v_owner_email) > 0 then
      v_when := nullif(trim(concat_ws(' at ',
                  br_row.preferred_date::text,
                  nullif(trim(coalesce(br_row.preferred_time, '')), ''))), '');
      begin
        rpc_result := public.queue_notification(
          user_id_in => br_row.user_id,
          channel_in => 'email',
          notification_type_in => 'stylist_new_booking',
          body_in => coalesce(br_row.client_name, 'A client')
                     || ' requested ' || coalesce(br_row.service_name, 'an appointment')
                     || case when v_when is not null then ' for ' || v_when else '' end
                     || '. Open Braid Boss Pro to review and confirm.',
          subject_in => 'New booking request — ' || coalesce(br_row.client_name, 'a client'),
          recipient_email_in => v_owner_email,
          recipient_name_in => null,
          payload_in => jsonb_build_object(
            'clientName', coalesce(br_row.client_name, 'A client'),
            'studioName', studio_name,
            'serviceName', br_row.service_name,
            'preferredDate', br_row.preferred_date::text,
            'preferredTime', br_row.preferred_time
          ),
          dedupe_key_in => 'new_booking_owner:' || br_row.id::text,
          booking_request_id_in => br_row.id
        );
        if coalesce((rpc_result->>'ok')::boolean, false)
           and not coalesce((rpc_result->>'skipped')::boolean, false) then
          enqueued := enqueued + 1;
        end if;
      exception when others then null;
      end;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'enqueued', enqueued);
end;
$function$;

notify pgrst, 'reload schema';
