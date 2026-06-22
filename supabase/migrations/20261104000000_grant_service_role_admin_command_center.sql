-- Fix: grant execute on the admin RPCs to service_role.
--
-- Both /api/admin/command-center and /api/admin/analytics run under
-- service_role to bypass RLS and aggregate across every braider's rows.
-- Their migrations revoked 'public' execute and granted only to
-- authenticated, which dropped service_role's permission — service_role
-- does NOT inherit from public/authenticated in Supabase — so the RPCs
-- fail with "permission denied for function …". This is the same
-- omission already fixed for the storefront RPCs in
-- 20260622000000_grant_service_role_on_product_rpcs.sql.
--
--   admin_command_center        (20261047000000) — the reported failure.
--   analytics_summary_for_admin (20260603000000) — same latent bug; its
--                                route calls it as service_role too.
--
-- Safe + additive: both functions are still gated by the route's JWT
-- check AND an in-function email allow-list (they raise 'not_admin'
-- otherwise), so granting execute to service_role does not widen who can
-- read the data.

grant execute on function public.admin_command_center(text, integer) to service_role;
grant execute on function public.analytics_summary_for_admin(text, integer) to service_role;

notify pgrst, 'reload schema';
