-- Booking-link referral attribution.
--
-- Capture where a public booking came from (instagram / tiktok /
-- facebook / google / ...) WITHOUT touching the critical
-- public_submit_booking_request RPC. A tiny security-definer tagging
-- function stamps the column AFTER the request row already exists, so
-- attribution can never make a booking fail — worst case the source is
-- simply left null and the app falls back to "Booking link".
--
-- The column flows automatically into the stylist approval queue
-- (which selects *), and the approval->appointment conversion copies it
-- onto appointments.referral_source, where the Analytics "Where
-- bookings come from" breakdown already reads it.

alter table public.booking_requests
  add column if not exists referral_source text;

create or replace function public.public_tag_booking_source(
  request_id_in uuid,
  referral_source_in text
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.booking_requests
     set referral_source = nullif(left(trim(referral_source_in), 60), '')
   where id = request_id_in
     -- Only set it once; never let a later (or spoofed) call overwrite
     -- a value already captured for this request.
     and referral_source is null;
$$;

-- Anon callers submit bookings, so anon must be able to tag the source.
-- The request id is an unguessable UUID returned only to the submitter,
-- which is the capability that gates this update.
revoke all on function public.public_tag_booking_source(uuid, text) from public;
grant execute on function public.public_tag_booking_source(uuid, text) to anon, authenticated;
