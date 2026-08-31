-- Revoke Postgres' default EXECUTE-to-PUBLIC on SECURITY DEFINER functions.
--
-- Postgres grants EXECUTE on every new function to PUBLIC unless you say
-- otherwise. For a SECURITY DEFINER function that means: any caller, anon
-- included, runs it with the DEFINER's privileges. 24 functions in this
-- schema still carried that default. Most are trigger functions, which
-- Postgres refuses to call directly -- but two are ordinary callables
-- with real side effects, and one of those is an open relay.
--
-- ---- queue_stylist_email_alert (the reason this migration exists) ----
--
-- Signature: (user_id_in uuid, notification_type_in text, subject_in text,
--             body_in text, payload_in jsonb, dedupe_key_in text, ...)
--
-- It looks the stylist's login email up out of auth.users and queues a
-- message to it. Caller supplies the subject and the body. So an
-- anonymous caller could send arbitrary email to any stylist on the
-- platform, from the platform's own sending domain, passing SPF and
-- DKIM because it genuinely is us sending it.
--
-- The chain is complete without any privileged access:
--   1. booking slugs are public (they are the whole product),
--   2. public_resolve_booking_slug returns user_id for a slug -- anon,
--   3. that user_id is the only input queue_stylist_email_alert needs.
--
-- dedupe_key_in is caller-supplied too, so varying it defeats the
-- dedupe and the send is unbounded. "Your payout is on hold, confirm
-- your bank details" from the real braidbosspro.app is the obvious use.
--
-- Verified reachable as anon before this migration: calling it as anon
-- with a nonexistent user_id returned the function's own
-- {"skipped": true, "reason": "no_owner_email"}, not a permission error.
--
-- Nothing legitimate loses access. Every caller in the app is a Stripe
-- webhook or an internal API route holding the service role key:
--   app/api/booking-deposit/webhook, .../refund, app/api/class-checkout/
--   webhook, app/api/video-checkout/webhook, app/api/shipping-label
-- and service_role keeps its explicit grant below.
--
-- ---- ensure_client_marketing_token ----
--
-- (user_id_in uuid, client_id_in text) -> mints and returns a client's
-- marketing unsubscribe token, and WRITES it to public.clients. Anon had
-- both the read and the write. It also held an explicit grant to
-- `authenticated`, which is its own cross-tenant hole: the function
-- filters on the user_id it is HANDED, never on auth.uid(), so any
-- signed-in stylist could mint tokens against another stylist's client
-- rows. No application code calls it at all -- its eight in-DB callers
-- (process_marketing_campaign, process_rebook_nudges, and friends) are
-- all SECURITY DEFINER and run as the definer. service_role only.
--
-- ---- The internal name/URL helpers ----
--
-- academy_braider_name, academy_handle, style_request_studio_name and
-- waitlist_booking_url take a raw uid and return display data. Low
-- severity on their own -- the same names are public via the storefront
-- -- but they are plumbing, not API. Every caller is SECURITY DEFINER.
--
-- ---- What deliberately stays anon ----
--
-- public_submit_booking_request IS the public booking form; it is
-- supposed to be callable by anyone with a booking link. It was riding
-- on the same PUBLIC default, so it gets an explicit anon grant here --
-- same reachability, but now it is a decision on the record instead of
-- a default nobody chose.

-- --------------------------------------------------------------
-- Keep the public booking form working, explicitly, BEFORE the sweep.
-- --------------------------------------------------------------
do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname = 'public_submit_booking_request'
  loop
    execute format('grant execute on function %s to anon, authenticated', fn.sig);
  end loop;
end $$;

-- --------------------------------------------------------------
-- The sweep: drop the default PUBLIC grant on every SECURITY DEFINER
-- function in `public` that still carries it.
--
-- Written as a loop rather than a list so it also catches the trigger
-- functions and stays correct if a name is added later. Explicit grants
-- (service_role, authenticated, the anon grant above) are untouched --
-- REVOKE ... FROM PUBLIC only removes the PUBLIC entry.
-- --------------------------------------------------------------
do $$
declare
  fn      record;
  n       integer := 0;
begin
  for fn in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.prokind = 'f'
       and p.prosecdef
       and (p.proacl is null or array_to_string(p.proacl, ' ') like '=X/%'
            or array_to_string(p.proacl, ' ') like '% =X/%')
       and p.proname <> 'public_submit_booking_request'
  loop
    execute format('revoke execute on function %s from public', fn.sig);
    n := n + 1;
  end loop;
  raise notice 'revoked default PUBLIC execute on % security-definer function(s)', n;
end $$;

-- --------------------------------------------------------------
-- Re-assert the grants the real callers depend on. These are almost
-- all already present; stated here so the intended reachability of
-- each function is legible in one place rather than inferred from an
-- ACL dump.
-- --------------------------------------------------------------
grant execute on function public.queue_stylist_email_alert(uuid, text, text, text, jsonb, text, uuid, text) to service_role;
grant execute on function public.ensure_client_marketing_token(uuid, text) to service_role;

-- ensure_client_marketing_token's grant to `authenticated` is the
-- cross-tenant path described above, and no client code uses it.
revoke execute on function public.ensure_client_marketing_token(uuid, text) from authenticated;

notify pgrst, 'reload schema';
