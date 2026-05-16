-- Client Portal + Style Customization — Phase 5 (email integration).
--
-- Enrich the public booking-received email payload with the style
-- customization details + a portal link. Re-emits ONLY
-- enqueue_public_booking_emails (self-contained). The worker
-- renderers read these fields optionally, so this is fully
-- backward-compatible. appointment_confirmed is enriched in app
-- code (confirmApproval). Reminder enrichment is a separate small
-- follow-up to avoid re-emitting that function from a reconstructed
-- body.

create or replace function public.enqueue_public_booking_emails(
  request_id_in       uuid,
  app_base_url_in     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  br_row         public.booking_requests;
  svc_row        public.services%rowtype;
  studio_name    text;
  enqueued       integer := 0;
  payload_obj    jsonb;
  rpc_result     jsonb;
  app_base       text;
begin
  if request_id_in is null then
    return jsonb_build_object('ok', false, 'reason', 'request_id_required');
  end if;

  select * into br_row
  from public.booking_requests
  where id = request_id_in
  limit 1;
  if br_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'request_not_found');
  end if;

  select coalesce(p.business_name, p.full_name, 'Braid Boss Pro')
    into studio_name
  from public.profiles p
  where p.id = br_row.user_id
  limit 1;
  studio_name := coalesce(studio_name, 'Braid Boss Pro');

  if br_row.service_id is not null then
    select * into svc_row from public.services where id = br_row.service_id limit 1;
  end if;

  app_base := coalesce(
    nullif(trim(coalesce(app_base_url_in, '')), ''),
    nullif(current_setting('app.public_url', true), ''),
    'https://braidbosspro.app'
  );

  if br_row.client_email is not null and position('@' in br_row.client_email) > 0 then
    payload_obj := jsonb_build_object(
      'clientName',      coalesce(br_row.client_name, 'there'),
      'studioName',      studio_name,
      'serviceName',     br_row.service_name,
      'preferredDate',   br_row.preferred_date::text,
      'preferredTime',   br_row.preferred_time,
      'approvalStatus',  br_row.approval_status,
      'depositRequired', br_row.deposit_required,
      -- Style customization (worker renderer skips nulls):
      'hairIncluded',        coalesce(svc_row.hair_included, false),
      'selectedHairColor',   coalesce(
        br_row.selected_hair_color,
        br_row.customization_summary->>'custom_hair_color'
      ),
      'selectedCurlPattern', coalesce(
        br_row.selected_curl_pattern,
        br_row.customization_summary->>'custom_curl_pattern'
      ),
      'prepReminder',        nullif(trim(coalesce(svc_row.prep_instructions, '')), ''),
      'portalUrl',           case
        when br_row.portal_token is not null
        then app_base || '/client/appointment/' || br_row.portal_token
        else null end
    );
    rpc_result := public.queue_notification(
      user_id_in            => br_row.user_id,
      channel_in            => 'email',
      notification_type_in  => 'booking_confirmation',
      body_in               => 'Booking request received',
      subject_in            => 'Booking request received — ' || studio_name,
      recipient_email_in    => br_row.client_email,
      recipient_name_in     => br_row.client_name,
      payload_in            => payload_obj,
      dedupe_key_in         => 'booking_confirmation:' || br_row.id::text,
      booking_request_id_in => br_row.id
    );
    if coalesce((rpc_result->>'ok')::boolean, false)
       and not coalesce((rpc_result->>'skipped')::boolean, false) then
      enqueued := enqueued + 1;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'enqueued', enqueued);
end;
$$;

revoke all on function public.enqueue_public_booking_emails(uuid, text) from public;
grant execute on function public.enqueue_public_booking_emails(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
