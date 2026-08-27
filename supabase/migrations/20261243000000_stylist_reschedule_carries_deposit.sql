-- A stylist-side reschedule must carry the client's deposit forward.
--
-- Bug: when the stylist moved an appointment (Edit Appointment → Move),
-- only the appointments row was updated. The deposit stayed on the
-- appointment, but everything the CLIENT sees reads the linked
-- booking_request:
--
--   * public_get_booking_portal_state renders "Deposit paid",
--     "Balance due", the date/time and the "your deposit rolled over"
--     note straight off booking_requests;
--   * deposit_rollover was only ever set by the three client-initiated
--     reschedule RPCs, never by the stylist moving the appointment.
--
-- So a moved booking showed the client the old slot with no rollover
-- marker — the deposit read as belonging to an appointment that no
-- longer existed. The app now calls sync_booking_request_after_edit on
-- the Move path; this migration makes that function do the deposit half
-- of the job as well.
--
-- Signature is unchanged so existing callers (the Edit Appointment save
-- path) pick the behavior up without a code change.
--
-- Deliberately NOT touched here:
--   * reschedule_count / reschedule_token — those govern the client's
--     one-shot self-service reschedule. A stylist moving the booking
--     must not burn the client's own allowance.
--   * deposit_forfeited — only cancellation forfeits a deposit.

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
  uid          uuid := auth.uid();
  n            int;
  br           public.booking_requests%rowtype;
  moved        boolean := false;
  carried      boolean := false;
  old_start_ts timestamptz;
  audit_entry  jsonb;
begin
  if uid is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;
  if appointment_id_in is null or trim(appointment_id_in) = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_appointment_id');
  end if;

  select * into br
  from public.booking_requests
  where appointment_id = appointment_id_in
    and user_id = uid
  limit 1;

  if br.id is null then
    return jsonb_build_object('ok', true, 'updated', 0);
  end if;

  -- Did the slot actually move? A price-only or add-on-only edit must
  -- not stamp reschedule bookkeeping onto the request.
  moved := (new_date is not null and new_date is distinct from br.preferred_date)
        or (nullif(trim(coalesce(new_time, '')), '') is not null
            and nullif(trim(coalesce(new_time, '')), '') is distinct from br.preferred_time);

  -- The deposit rolls over whenever one was actually collected. This is
  -- what makes the portal say "Your deposit rolled over to this
  -- appointment — no second charge" on the new date.
  carried := moved and coalesce(br.deposit_paid, false)
             and coalesce(br.deposit_amount, 0) > 0;

  if moved and br.preferred_date is not null and br.preferred_time is not null then
    old_start_ts := (br.preferred_date::text || ' ' || br.preferred_time::text)::timestamp;
  end if;

  audit_entry := jsonb_build_object(
    'action',    'reschedule_by_stylist',
    'from_date', br.preferred_date,
    'from_time', br.preferred_time,
    'to_date',   new_date,
    'to_time',   nullif(trim(coalesce(new_time, '')), ''),
    'deposit_rollover', carried,
    'at',        now()
  );

  update public.booking_requests
    -- coalesce, not a bare assignment: a caller that sends only a price
    -- or add-on edit passes no date/time, and the previous definition
    -- blanked the client's slot when that happened. There is no case
    -- where clearing the booked date is the intent.
    set preferred_date = coalesce(new_date, preferred_date),
        preferred_time = coalesce(nullif(trim(coalesce(new_time, '')), ''), preferred_time),
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
        -- ---- Reschedule bookkeeping (only when the slot moved) ------
        -- The deposit follows the booking to its new date. Once true it
        -- stays true: a second move doesn't un-roll the first.
        deposit_rollover = case when carried then true else deposit_rollover end,
        rescheduled_from = case when moved
            then coalesce(rescheduled_from, old_start_ts) else rescheduled_from end,
        rescheduled_at   = case when moved then now() else rescheduled_at end,
        -- Let the 24h reminder cron re-arm against the new date instead
        -- of treating the old send as covering it.
        last_reminder_sent_at = case when moved then null else last_reminder_sent_at end,
        client_action_audit = case when moved
            then coalesce(client_action_audit, '[]'::jsonb) || jsonb_build_array(audit_entry)
            else client_action_audit end,
        updated_at = now()
  where appointment_id = appointment_id_in
    and user_id = uid;
  get diagnostics n = row_count;
  return jsonb_build_object(
    'ok', true,
    'updated', n,
    'moved', moved,
    'deposit_rollover', carried
  );
end;
$$;

revoke all on function public.sync_booking_request_after_edit(text, date, text, numeric, jsonb, text, text, text, boolean, text, text, text, boolean) from public;
grant execute on function public.sync_booking_request_after_edit(text, date, text, numeric, jsonb, text, text, text, boolean, text, text, text, boolean) to authenticated;

notify pgrst, 'reload schema';
