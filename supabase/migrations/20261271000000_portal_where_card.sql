-- Give the client appointment portal the address it never had.
--
-- Bug: a client with a confirmed, studio-based appointment had nowhere
-- to find the street address on the day of. The reminder email's "View
-- appointment details" button lands on this portal, and the portal
-- listed Service / For / Date / Time / Stylist / payment / booked style
-- / prep instructions — and no location at all. The only place the real
-- address existed was inside the free-text agreement body, which by the
-- morning of the appointment is a weeks-old email. So clients message
-- the stylist to ask where to go, which is exactly the texting this
-- portal exists to prevent.
--
-- Two values are added to the portal RPC:
--   * studio_address — the stylist's configured location, resolved with
--     the same studio_location_text() the confirmation and reminder
--     emails use, so all three surfaces agree on one answer.
--   * contract_body  — the linked agreement's text, so the portal can
--     recover an address the stylist typed in there when no street
--     address is configured (a studio saved as only "City, ST" still
--     gets a usable address, with nothing to re-enter). Detection stays
--     in app/lib/address-link.ts — one tested implementation, already
--     used by the signing page — rather than being duplicated here as
--     a SQL regex that would drift from it.
--
-- Mobile services are excluded from BOTH: that appointment happens at
-- the client's own address, so the studio's would be actively
-- misleading. Mirrors the same guard in enqueue_appointment_confirmation.
--
-- Everything else about the function is unchanged.

create or replace function public.public_get_booking_portal_state(token_in text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  br public.booking_requests%rowtype;
  studio_name text;
  reschedule_ok boolean;
  v_mobile boolean;
  v_addr text;
  v_contract_body text;
begin
  if token_in is null or length(trim(token_in)) < 16 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_token');
  end if;

  select * into br from public.booking_requests
  where portal_token = token_in
  limit 1;
  if br.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  studio_name := coalesce(
    nullif(trim(public.public_get_studio_name(br.user_id)), ''),
    'your stylist'
  );
  reschedule_ok := coalesce(br.reschedule_count, 0) = 0
    and br.reschedule_token is not null
    and br.approval_status <> 'cancelled'
    and br.cancelled_at is null;

  -- Location, for studio-based services only.
  select coalesce(s.mobile_service, false) into v_mobile
  from public.services s where s.id = br.service_id limit 1;
  if not coalesce(v_mobile, false) then
    v_addr := nullif(trim(public.studio_location_text(br.user_id)), '');
    -- The agreement for THIS booking, newest first. Matched by booking
    -- request, falling back to the appointment the request produced.
    select c.body_snapshot into v_contract_body
    from public.booking_contracts c
    where (c.booking_request_id = br.id
           or (br.appointment_id is not null and c.appointment_id = br.appointment_id))
      and c.user_id = br.user_id
      and nullif(trim(coalesce(c.body_snapshot, '')), '') is not null
    order by c.created_at desc nulls last
    limit 1;
  end if;

  return jsonb_build_object(
    'ok',                true,
    'request_id',        br.id,
    'studio_name',       studio_name,
    'client_name',       br.client_name,
    'booked_for_name',   br.booked_for_name,
    'service_name',      coalesce(br.selected_variation_name, br.service_name),
    'approval_status',   br.approval_status,
    'preferred_date',    br.preferred_date,
    'preferred_time',    br.preferred_time,
    'deposit_amount',    br.deposit_amount,
    'deposit_paid',      br.deposit_paid,
    'service_price',     coalesce(br.selected_variation_price, br.service_price),
    'cancelled_at',      br.cancelled_at,
    'reschedule_count',  br.reschedule_count,
    'deposit_forfeited', br.deposit_forfeited,
    'deposit_rollover',  br.deposit_rollover,
    'studio_address',    v_addr,
    'contract_body',     v_contract_body,
    'selected_hair_color',   br.selected_hair_color,
    'selected_curl_pattern', br.selected_curl_pattern,
    'client_style_notes',    br.client_style_notes,
    'inspiration_photo_urls', coalesce(br.inspiration_photo_urls, '{}'),
    'selected_addons',       coalesce(br.selected_addons, '[]'::jsonb),
    'customization_summary', coalesce(br.customization_summary, '{}'::jsonb),
    'notes',                 br.notes,
    'service_meta', (
      select jsonb_build_object(
        'hair_included',                       s.hair_included,
        'included_hair_description',           s.included_hair_description,
        'included_details',                    s.included_details,
        'prep_instructions',                   s.prep_instructions,
        'allow_client_hair_color_selection',   s.allow_client_hair_color_selection,
        'allowed_hair_colors',                 coalesce(s.allowed_hair_colors, '{}'),
        'allow_client_curl_pattern_selection', s.allow_client_curl_pattern_selection,
        'allowed_curl_patterns',               coalesce(s.allowed_curl_patterns, '{}')
      )
      from public.services s
      where s.id = br.service_id
      limit 1
    ),
    'cancel_token',       case when br.approval_status <> 'cancelled'
                               and br.cancelled_at is null
                          then br.cancel_token else null end,
    'reschedule_token',   case when reschedule_ok
                          then br.reschedule_token else null end
  );
end $function$;

notify pgrst, 'reload schema';
