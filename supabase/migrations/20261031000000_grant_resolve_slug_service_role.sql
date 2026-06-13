-- Restore service_role EXECUTE on public_resolve_booking_slug.
--
-- 20260909000000 dropped + recreated this function and only re-granted anon /
-- authenticated, silently dropping the service_role grant from
-- 20260622000000. The /api/delivery-check route resolves a handle → user_id
-- with the service-role key, so without this grant it gets permission-denied
-- and returns "Shop not found" (surfaced to buyers as "Couldn't check that
-- ZIP"). Other public RPCs call this function internally as SECURITY DEFINER,
-- so they were unaffected — only the direct service-role call broke.

grant execute on function public.public_resolve_booking_slug(text) to service_role;

notify pgrst, 'reload schema';
