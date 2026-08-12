-- Welcome / account-confirmed email for a newly confirmed stylist.
--
-- This is the ONE lifecycle email the app has no server-side hook for.
-- The other three (trial started, trial ending, subscription confirmed)
-- ride the Stripe subscription webhook, which already runs in the app.
-- Email confirmation, by contrast, happens entirely inside Supabase's
-- auth server, so the only reliable server-side signal is the moment
-- auth.users.email_confirmed_at goes from null to a timestamp.
--
-- What this migration does NOT do:
--   • it does not change any authentication behaviour. The trigger only
--     reads NEW/OLD and enqueues a row. It never blocks, rewrites, or
--     delays a confirmation.
--   • it does not send anything itself. It enqueues into the existing
--     notification_queue, and process-notification-queue renders and
--     delivers it like every other email in the product.
--
-- Safety:
--   • the whole body is wrapped in an exception handler that swallows
--     everything and returns NEW. A broken email must never be able to
--     fail a user's email confirmation.
--   • the dedupe key is per user, so a replayed update, a re-confirm,
--     or a re-run of this migration can never produce a second welcome.
--   • queue_notification already refuses rows with no usable recipient.

-- =====================================================================
-- enqueue_stylist_welcome_email — shared by both triggers below.
-- =====================================================================
create or replace function public.enqueue_stylist_welcome_email(
  user_id_in uuid,
  email_in   text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first_name text;
  v_app_base   text;
begin
  if user_id_in is null or email_in is null or position('@' in email_in) = 0 then
    return;
  end if;

  -- First name, best effort. The signup form collects only an email and
  -- a password today, so this is usually null and the template renders
  -- its no-name variant ("Hi there"). We still look, because the name
  -- lands on the profile as soon as she fills in her business details,
  -- and a re-confirm after that point should greet her properly.
  select nullif(trim(split_part(coalesce(p.full_name, ''), ' ', 1)), '')
    into v_first_name
  from public.profiles p
  where p.id = user_id_in
  limit 1;

  if v_first_name is null then
    select nullif(trim(split_part(coalesce(
             u.raw_user_meta_data ->> 'full_name',
             u.raw_user_meta_data ->> 'name',
             u.raw_user_meta_data ->> 'first_name',
             ''), ' ', 1)), '')
      into v_first_name
    from auth.users u
    where u.id = user_id_in
    limit 1;
  end if;

  v_app_base := coalesce(
    nullif(current_setting('app.public_url', true), ''),
    'https://braidbosspro.app'
  );

  perform public.queue_notification(
    user_id_in           => user_id_in,
    channel_in           => 'email',
    notification_type_in => 'stylist_welcome',
    -- `body` is the plain-text fallback for rows whose renderer does not
    -- build one. The lifecycle templates DO build one and it wins, so
    -- this is a short safety net rather than the real text part.
    body_in              => 'Your Braid Boss Pro account is confirmed. Open your dashboard at '
                            || v_app_base || ' to add your services, set your availability, '
                            || 'connect Stripe, and share your booking link.',
    subject_in           => 'Welcome to Braid Boss Pro. Let''s set up your business.',
    recipient_email_in   => email_in,
    recipient_name_in    => v_first_name,
    payload_in           => jsonb_strip_nulls(jsonb_build_object(
                              'firstName',    v_first_name,
                              'baseUrl',      v_app_base,
                              'dashboardUrl', v_app_base || '/',
                              'setupUrl',     v_app_base || '/'
                            )),
    dedupe_key_in        => 'stylist_welcome:' || user_id_in::text
  );
end;
$$;

revoke all on function public.enqueue_stylist_welcome_email(uuid, text) from public;
revoke all on function public.enqueue_stylist_welcome_email(uuid, text) from anon;
revoke all on function public.enqueue_stylist_welcome_email(uuid, text) from authenticated;
grant execute on function public.enqueue_stylist_welcome_email(uuid, text) to service_role;

-- =====================================================================
-- Trigger fn — fires on the null -> not-null confirmation transition,
-- and on insert for projects where email confirmation is turned off
-- (signUp returns a live session and the row is born confirmed).
-- =====================================================================
create or replace function public.tg_stylist_welcome_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if tg_op = 'INSERT' then
      if new.email_confirmed_at is not null then
        perform public.enqueue_stylist_welcome_email(new.id, new.email);
      end if;
    elsif tg_op = 'UPDATE' then
      if new.email_confirmed_at is not null and old.email_confirmed_at is null then
        perform public.enqueue_stylist_welcome_email(new.id, new.email);
      end if;
    end if;
  exception when others then
    -- Never let an email problem break sign-up or confirmation.
    raise warning 'stylist_welcome enqueue failed for %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists stylist_welcome_email_on_confirm on auth.users;
create trigger stylist_welcome_email_on_confirm
  after update of email_confirmed_at on auth.users
  for each row
  execute function public.tg_stylist_welcome_email();

drop trigger if exists stylist_welcome_email_on_insert on auth.users;
create trigger stylist_welcome_email_on_insert
  after insert on auth.users
  for each row
  execute function public.tg_stylist_welcome_email();

notify pgrst, 'reload schema';
