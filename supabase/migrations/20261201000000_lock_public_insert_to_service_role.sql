-- Lock down the two public "with check (true)" INSERT paths.
--
-- style_requests and waitlist_requests each carried an anon INSERT policy
-- with an always-true WITH CHECK clause plus a table-level INSERT grant to
-- `anon`. That let any client holding the public anon key spray unlimited
-- rows straight at these tables, bypassing every app-side guard (Supabase
-- security advisor: rls_policy_always_true).
--
-- Public submissions now go through server routes that rate-limit per IP
-- and validate the target user_id before writing with the service role:
--   * app/api/waitlist-join         -> waitlist_requests
--   * app/api/style-request-submit  -> style_requests
-- The service role bypasses RLS, so it does not need these policies/grants.
--
-- DEPLOY ORDER: apply this migration AFTER the code that repoints those two
-- browser flows to the server routes is live. If applied before the deploy,
-- the still-deployed old frontend (which inserts directly as anon) would
-- fail to submit until the new build ships.
--
-- The owner-side "self_insert" policies (gated by auth.uid()) and the
-- authenticated grant are intentionally left in place — the stylist app
-- still adds manual waitlist entries as an authenticated user.

-- ---- waitlist_requests -------------------------------------------------
drop policy if exists "waitlist_public_insert" on public.waitlist_requests;
revoke insert on public.waitlist_requests from anon;

-- ---- style_requests ----------------------------------------------------
drop policy if exists "style_requests_public_insert" on public.style_requests;
revoke insert on public.style_requests from anon;
