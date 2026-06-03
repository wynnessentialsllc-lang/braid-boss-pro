-- Extend sync_booking_request_after_edit to also propagate edited
-- style customization (braiding-hair color, boho/curl pattern, style
-- notes) to the linked booking_request.
--
-- 20260902000000 added schedule + price + add-ons; 20260903000000 added
-- the service option (variation). The Edit Appointment sheet now also
-- lets a stylist correct the customization the client picked at
-- booking. The client portal reads selected_hair_color /
-- selected_curl_pattern / client_style_notes directly (and emails fall
-- back to customization_summary), so sync all of them — gated by
-- update_customization so an unrelated edit never overwrites them.
--
-- Replaces the 9-arg signature from 20260903000000.

drop function if exists public.sync_booking_request_after_edit(text, date, text, numeric, jsonb, text, text, text, boolean);

create or replace function public.sync_booking_request_after_edit(
  appointment_id_in    text,
  new_date             date    default null,
  new_time             text    default null,
  new_total_price      numeric default null,
  new_addons           jsonb   default null,
  new_variation_id     text    default null,
  new_variation_name   text    default null,
  new_service_name     text    default null,
  update_option        boolean default false,
  new_hair_color       text    default null,
  new_curl_pattern     text    default null,
  new_style_notes      text    default null,
  update_customization boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  n int;
begin
  if uid is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;
  if appointment_id_in is null or trim(appointment_id_in) = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_appointment_id');
  end if;

  update public.booking_requests
    set preferred_date = new_date,
        preferred_time = nullif(trim(coalesce(new_time, '')), ''),
        -- Only overwrite the price when the caller sent one (> 0); a
        -- null leaves the existing ticket price intact.
        service_price = coalesce(new_total_price, service_price),
        selected_variation_price = case
          when new_total_price is not null and selected_variation_price is not null
            then new_total_price
          else selected_variation_price
        end,
        selected_addons = coalesce(new_addons, selected_addons),
        -- Option fields only move when the stylist switched the option.
        selected_variation_id = case when update_option
            then nullif(trim(coalesce(new_variation_id, '')), '')
            else selected_variation_id end,
        selected_variation_name = case when update_option
            then nullif(trim(coalesce(new_variation_name, '')), '')
            else selected_variation_name end,
        service_name = case when update_option
            then coalesce(nullif(trim(coalesce(new_service_name, '')), ''), service_name)
            else service_name end,
        -- Customization fields only move when the stylist edited them.
        -- Empty string collapses to NULL (cleared). The summary jsonb is
        -- merged so email enrichment's custom_* fallback stays in step.
        selected_hair_color = case when update_customization
            then nullif(trim(coalesce(new_hair_color, '')), '')
            else selected_hair_color end,
        selected_curl_pattern = case when update_customization
            then nullif(trim(coalesce(new_curl_pattern, '')), '')
            else selected_curl_pattern end,
        client_style_notes = case when update_customization
            then nullif(trim(coalesce(new_style_notes, '')), '')
            else client_style_notes end,
        customization_summary = case when update_customization
            then coalesce(customization_summary, '{}'::jsonb) || jsonb_build_object(
                   'custom_hair_color',   nullif(trim(coalesce(new_hair_color, '')), ''),
                   'custom_curl_pattern', nullif(trim(coalesce(new_curl_pattern, '')), ''),
                   'notes',               nullif(trim(coalesce(new_style_notes, '')), '')
                 )
            else customization_summary end,
        updated_at = now()
  where appointment_id = appointment_id_in
    and user_id = uid;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'updated', n);
end;
$$;

revoke all on function public.sync_booking_request_after_edit(text, date, text, numeric, jsonb, text, text, text, boolean, text, text, text, boolean) from public;
grant execute on function public.sync_booking_request_after_edit(text, date, text, numeric, jsonb, text, text, text, boolean, text, text, text, boolean) to authenticated;

notify pgrst, 'reload schema';
