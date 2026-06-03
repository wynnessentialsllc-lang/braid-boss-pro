-- Extend the stylist-edit → booking_request sync to cover price and
-- add-ons, not just the schedule.
--
-- Background: when a stylist edits an existing appointment, the
-- appointments row is the source of truth, but the linked
-- booking_request powers the client portal
-- (public_get_booking_portal_state) and the worker's email enrichment.
-- 20260711000000 added sync_booking_request_schedule for date/time so
-- the portal's "View appointment details" wouldn't show a stale time.
-- Editing add-ons or the total price left the portal stale the same
-- way. This adds a single owner-scoped RPC that propagates all of it.
--
-- Pricing model (see app/api/booking-deposit/checkout/route.ts): the
-- submit RPC folds the picked variation AND every add-on into
-- service_price (the full ticket price). selected_variation_price is a
-- RAW per-variation snapshot that EXCLUDES add-ons; the portal reads
-- coalesce(selected_variation_price, service_price). After a manual
-- stylist edit the stylist's total is the source of truth, so we write
-- service_price = the new total and, only when a variation price was
-- present, collapse it into the same total so the portal's coalesce
-- resolves to the right number. Deposit is left untouched — it's
-- already paid; the portal derives remaining = price - deposit.

create or replace function public.sync_booking_request_after_edit(
  appointment_id_in text,
  new_date          date    default null,
  new_time          text    default null,
  new_total_price   numeric default null,
  new_addons        jsonb   default null
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
        updated_at = now()
  where appointment_id = appointment_id_in
    and user_id = uid;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'updated', n);
end;
$$;

revoke all on function public.sync_booking_request_after_edit(text, date, text, numeric, jsonb) from public;
grant execute on function public.sync_booking_request_after_edit(text, date, text, numeric, jsonb) to authenticated;

notify pgrst, 'reload schema';
