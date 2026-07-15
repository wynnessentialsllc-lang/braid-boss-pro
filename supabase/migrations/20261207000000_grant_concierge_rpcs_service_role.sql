-- Let the booking concierge actually read availability, hours, and policy.
--
-- The public booking-concierge route (/api/booking-concierge) runs with the
-- SERVICE_ROLE key and calls these public_* RPCs to feed the assistant live
-- data. In Supabase, service_role does NOT inherit the anon/authenticated
-- EXECUTE grants — each function must be granted to it explicitly. This was
-- already discovered once for public_resolve_booking_slug, which got its own
-- service_role grant in 20261031000000_grant_resolve_slug_service_role.sql;
-- the resolve call is why the assistant knew the studio name at all.
--
-- The other three RPCs the route calls were never granted to service_role,
-- so every call failed on EXECUTE permission, got swallowed by the route's
-- best-effort try/catch, and left availabilityNote / hoursNote / noShowFeeNote
-- null. The assistant then fell back to "I can't see the live calendar" even
-- when the calendar had plenty of open days. Granting execute here is what
-- makes "when's your next opening?", "what are your hours?", and the
-- cancellation-policy answers work from real data.
--
-- Idempotent: GRANT is a no-op if already present. Signatures match the
-- latest definitions (month availability = 20261126, business hours =
-- 20261048, no-show fee = 20260831).

grant execute on function public.public_get_month_availability(text, integer, integer, uuid, integer) to service_role;
grant execute on function public.public_get_business_hours(text) to service_role;
grant execute on function public.public_get_no_show_fee(uuid) to service_role;

notify pgrst, 'reload schema';
