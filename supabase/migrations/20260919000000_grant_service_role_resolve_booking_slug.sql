-- Re-grant service_role EXECUTE on public_resolve_booking_slug.
--
-- 20260622 granted this to service_role, but 20260909 (booking header
-- themes) recreated the function and re-granted only to anon/authenticated,
-- silently dropping the service_role grant. The /api/style-consult route
-- resolves the slug with the service-role client, so without this it 502s
-- ("Couldn't look up this booking link"). Idempotent.

grant execute on function public.public_resolve_booking_slug(text) to service_role;
