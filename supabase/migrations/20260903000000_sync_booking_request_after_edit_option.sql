-- Extend sync_booking_request_after_edit to also propagate a switched
-- service option (variation) to the linked booking_request.
--
-- 20260902000000 added schedule + price + add-on sync. The Edit
-- Appointment sheet now also lets a stylist switch the service option
-- (the booking page's "Choose an option" / services.add_ons variation)
-- for a client who booked the wrong one, which re-prices the ticket.
-- The client portal reads coalesce(selected_variation_name,
-- service_name), so the switched option needs to land on the request
-- too. Adds the variation id/name + composed service name, gated by
-- update_option so an unrelated edit (e.g. just the date) never
-- rewrites the option — passing the fields unconditionally would wipe
-- the variation whenever the appointment's snapshot was thin.
--
-- Replaces the 5-arg signature from 20260902000000.

drop function if exists public.sync_booking_request_after_edit(text, date, text, numeric, jsonb);

create or replace function public.sync_booking_request_after_edit(
  appointment_id_in   text,
  new_date            date    default null,
  new_time            text    default null,
  new_total_price     numeric default null,
  new_addons          jsonb   default null,
  new_variation_id    text    default null,
  new_variation_name  text    default null,
  new_service_name    text    default null,
  update_option       boolean default false
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
        -- new_addons is the edited add-on set (possibly an empty array
        -- when the stylist removed them). null = no change.
        selected_addons = coalesce(new_addons, selected_addons),
        -- Option fields only move when the stylist actually switched
        -- the option. Empty id/name collapses to NULL (back to base).
        selected_variation_id = case when update_option
            then nullif(trim(coalesce(new_variation_id, '')), '')
            else selected_variation_id end,
        selected_variation_name = case when update_option
            then nullif(trim(coalesce(new_variation_name, '')), '')
            else selected_variation_name end,
        service_name = case when update_option
            then coalesce(nullif(trim(coalesce(new_service_name, '')), ''), service_name)
            else service_name end,
        updated_at = now()
  where appointment_id = appointment_id_in
    and user_id = uid;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'updated', n);
end;
$$;

revoke all on function public.sync_booking_request_after_edit(text, date, text, numeric, jsonb, text, text, text, boolean) from public;
grant execute on function public.sync_booking_request_after_edit(text, date, text, numeric, jsonb, text, text, text, boolean) to authenticated;

notify pgrst, 'reload schema';
