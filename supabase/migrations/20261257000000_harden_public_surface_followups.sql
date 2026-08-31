-- Three small hardening items from the security review.
--
-- ================================================================
-- 1. enqueue_public_booking_emails -- stop anon choosing the base URL
-- ================================================================
--
-- The 2-arg form takes app_base_url_in and interpolates it into the
-- client's confirmation email next to a real portal token:
--
--     'portalUrl', app_base || '/client/appointment/' || portal_token
--
-- An anonymous caller supplying https://evil.example puts a phishing
-- link carrying a genuine portal token into an email sent from our own
-- domain.
--
-- Severity is LOW and it is worth being precise about why: the email
-- goes to br_row.client_email, which for a request the attacker created
-- is the attacker's own address, and request ids are v4 UUIDs so other
-- people's are not enumerable. It is a latent bug that goes live the
-- moment a request id leaks into a URL, a log, or a shared link.
--
-- The fix deliberately does NOT rewrite the function. That body is ~7 KB
-- of email and SMS composition, and a transcription slip in it would
-- silently break real booking confirmations -- a worse outcome than the
-- bug being fixed. Instead the PARAMETER is put out of anon's reach: a
-- 1-arg wrapper is the only form public callers may execute, so there is
-- no argument for them to poison. The 2-arg form keeps its behaviour for
-- service_role and in-DB callers, where the base URL is ours by
-- construction.
--
-- With no URL supplied, the existing fallback chain inside the function
-- resolves app_base to current_setting('app.public_url') or the
-- hardcoded https://braidbosspro.app -- which is what the emails should
-- have been pointing at all along.

create or replace function public.enqueue_public_booking_emails(request_id_in uuid)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.enqueue_public_booking_emails(request_id_in, null::text);
$$;

comment on function public.enqueue_public_booking_emails(uuid) is
  'Public booking-page entry point. Deliberately takes no base URL: the '
  'callers of this form are anonymous, and the base URL lands in a client '
  'email beside a portal token. Use the 2-arg form only from trusted '
  'server-side code.';

revoke all on function public.enqueue_public_booking_emails(uuid) from public;
grant execute on function public.enqueue_public_booking_emails(uuid)
  to anon, authenticated, service_role;

-- The poisonable form is now server-side only.
revoke execute on function public.enqueue_public_booking_emails(uuid, text)
  from public, anon, authenticated;
grant execute on function public.enqueue_public_booking_emails(uuid, text)
  to service_role;

-- ================================================================
-- 2. class_offerings -- honour the "revealed only after they pay" promise
-- ================================================================
--
-- The academy Location field is labelled, in the stylist's own UI,
-- "Revealed to students only after they pay", with the placeholder
-- "123 Main St, Suite 4, Atlanta GA". So the stylist is being invited to
-- type a street address into it on the strength of that promise.
--
-- anon held table-level SELECT on class_offerings, location_text
-- included. The promise is not currently broken -- RLS on the table has
-- only class_offerings_owner_all USING (user_id = auth.uid()), and
-- auth.uid() is NULL for anon, so no row matches. Measured rather than
-- assumed: the table holds 1 row, that row HAS a location, and anon
-- enumerates 0 of it. The public RPCs (public_get_class,
-- public_list_classes) also correctly omit the column.
--
-- The grant is still removed, for the same reason as the SMS credit
-- tables: it is a privilege nothing uses, held shut by the continued
-- absence of a policy. A future "let people browse classes" policy would
-- open the address along with the class list, and the address is the
-- part that was promised to stay private.
--
-- authenticated keeps its grant -- app/lib/academy.ts manages classes
-- from the browser as the signed-in stylist, and RLS already pins that
-- to her own rows.

revoke select on public.class_offerings from anon;

-- ================================================================
-- 3. public_ai_usage -- count what the caps turn away
-- ================================================================
--
-- The caps added in 20261253000000 stop the spend but say nothing when
-- they bite, so a stylist whose clients are being turned away is the
-- only one who finds out. Recording denials makes that measurable, and
-- the routes use it to alert the affected stylist.

alter table public.public_ai_usage
  add column if not exists denied integer not null default 0;

create or replace function public.claim_public_ai_call(
  feature_in    text,
  slug_in       text,
  slug_cap_in   integer,
  global_cap_in integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day        date := (now() at time zone 'utc')::date;
  v_feature    text := left(coalesce(nullif(trim(feature_in), ''), 'unknown'), 60);
  v_slug       text := left(lower(coalesce(nullif(trim(slug_in), ''), '(none)')), 120);
  v_slug_cap   integer := greatest(1, coalesce(slug_cap_in, 40));
  v_global_cap integer := greatest(1, coalesce(global_cap_in, 1000));
  v_global     integer;
  v_slug_calls integer;
begin
  insert into public.public_ai_usage as u (day, feature, scope, scope_key, calls)
  values (v_day, v_feature, 'global', '*', 1)
  on conflict (day, feature, scope, scope_key) do update
    set calls = u.calls + 1
  where u.calls < v_global_cap
  returning u.calls into v_global;

  if v_global is null then
    update public.public_ai_usage set denied = denied + 1
     where day = v_day and feature = v_feature and scope = 'global' and scope_key = '*';
    return jsonb_build_object('ok', false, 'reason', 'global_daily_cap', 'cap', v_global_cap);
  end if;

  insert into public.public_ai_usage as u (day, feature, scope, scope_key, calls)
  values (v_day, v_feature, 'slug', v_slug, 1)
  on conflict (day, feature, scope, scope_key) do update
    set calls = u.calls + 1
  where u.calls < v_slug_cap
  returning u.calls into v_slug_calls;

  if v_slug_calls is null then
    -- Give the global budget back; this call is not happening.
    update public.public_ai_usage
       set calls = greatest(0, calls - 1)
     where day = v_day and feature = v_feature and scope = 'global' and scope_key = '*';
    update public.public_ai_usage set denied = denied + 1
     where day = v_day and feature = v_feature and scope = 'slug' and scope_key = v_slug;
    return jsonb_build_object('ok', false, 'reason', 'slug_daily_cap', 'cap', v_slug_cap);
  end if;

  return jsonb_build_object(
    'ok', true, 'slug_calls', v_slug_calls, 'global_calls', v_global);
end $$;

revoke all on function public.claim_public_ai_call(text, text, integer, integer) from public;
grant execute on function public.claim_public_ai_call(text, text, integer, integer) to service_role;

notify pgrst, 'reload schema';
