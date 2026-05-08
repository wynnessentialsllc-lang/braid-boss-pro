-- 20260508001000_grant_authenticated_dml.sql
--
-- Grant standard DML to `authenticated` (and SELECT to `anon`
-- where required) on every app table.
--
-- Symptom this fixes: Account screen shows "SYNC FAILED" with one
-- pending change, and Postgres logs show repeated
--   ERROR  permission denied for table {clients, appointments,
--          settings, quotes, receipts, communications, photos,
--          booking_requests}
-- coming from the `authenticated` role.
--
-- Root cause: same omission we previously fixed for `service_role`
-- in 20260508000000_grant_service_role_dml.sql. The inline SQL
-- used to create the schema didn't include the GRANT block
-- Supabase normally generates for the `authenticated` role, so
-- PostgreSQL rejected every DML attempt at the base-table-grant
-- check before RLS policies could even run.
--
-- Already applied to prod via Supabase MCP on 2026-05-08; this
-- migration commits the same statements so any fresh environment
-- lands at the same state.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.appointments     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quotes           TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.receipts         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.communications   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.photos           TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.settings         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_requests TO authenticated;

-- anon needs SELECT on booking_links so /book/<slug> can resolve
-- the slug. RLS already restricts visible rows to active=true.
GRANT SELECT ON public.booking_links TO anon;

-- Default privileges so future tables created in this schema by
-- the postgres role inherit these grants automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO anon;
