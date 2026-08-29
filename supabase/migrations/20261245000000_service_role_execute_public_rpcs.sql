-- Fix: mobile service quotes 502 on the public booking page.
--
-- /api/mobile-quote calls public_get_mobile_config with the SERVICE
-- ROLE key (the token has to stay off the client, and the stylist's
-- travel base isn't readable by anon). But that function — like a
-- couple of other public_* helpers — was created with:
--
--   revoke all on function ... from public;
--   grant execute on function ... to anon, authenticated;
--
-- The revoke strips the PUBLIC default, and the grant never names
-- service_role. Postgres checks EXECUTE on the *outer* function before
-- security-definer kicks in, so every service-role call came back as
-- 42501 permission denied. The route caught it and returned a 502
-- "Couldn't look up this booking link.", so clients could never get a
-- travel quote and could never book a mobile service.
--
-- service_role already bypasses RLS and holds table grants, so
-- withholding EXECUTE here bought no safety — it only broke the
-- server-side callers. Grant it on the three public_* RPCs our API
-- routes invoke with the service role.
--
-- Deliberately NOT a blanket grant across every public_* function:
-- the authenticated-only RPCs key off auth.uid() and have no meaning
-- under the service role, so they stay ungranted.

grant execute on function public.public_get_mobile_config(text) to service_role;
grant execute on function public.public_get_studio_name(uuid) to service_role;
grant execute on function public.public_match_braiders(text[], text) to service_role;

notify pgrst, 'reload schema';
