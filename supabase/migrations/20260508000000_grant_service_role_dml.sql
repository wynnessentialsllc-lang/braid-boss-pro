-- 20260508000000_grant_service_role_dml.sql
--
-- Restore the standard service_role DML grants on every app table.
--
-- Root cause: when these tables were created from the inline SQL
-- pasted manually during initial setup, the default GRANT block
-- Supabase normally adds for `service_role` was omitted. Result:
-- every Edge Function that runs under SUPABASE_SERVICE_ROLE_KEY hit
-- `permission denied for table …` on the very first query and
-- returned a generic 500 ("server error"), with no clue why.
--
-- Symptoms this fix resolves:
--   - calendar-feed → "server error" instead of ICS text
--   - send-push     → 500 / "Failed to send a request to the Edge
--                     Function" (function couldn't read
--                     push_subscriptions)
--   - delete-account → silent failure on cascade deletes
--
-- This migration was already applied directly to the production DB
-- via the Supabase MCP on 2026-05-08; this file commits the same
-- statements so the change is durable in the repo and any fresh
-- environment lands at the same state.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_feed_tokens TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.appointments         TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.settings             TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_links        TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_requests     TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions   TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients              TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quotes               TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.receipts             TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.communications       TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications        TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.photos               TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles             TO service_role;

-- Default privileges so this never bites us again on tables added
-- later by the postgres role (which is what Supabase migrations
-- run as).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
