-- Surface "who the appointment is for" on the client portal.
--
-- Adds booked_for_name to public_get_booking_portal_state's response so
-- the client portal ("View appointment details") can show, e.g.,
-- "For: Maya" when a parent booked for their child. Mirrors the
-- 20260704000000 definition verbatim with the single field added.

create or replace function public.public_get_booking_portal_state(
  token_in text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  br public.booking_requests%rowtype;
  studio_name text;
  reschedule_ok boolean;
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
end $$;

revoke all on function public.public_get_booking_portal_state(text) from public;
grant execute on function public.public_get_booking_portal_state(text) to anon, authenticated;

notify pgrst, 'reload schema';
