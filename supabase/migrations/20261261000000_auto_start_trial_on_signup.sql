-- Auto-start the 30-day free trial the moment a stylist confirms her
-- account. No card, no separate step, no other option — this is the
-- product decision: every signup is trialing from the first minute she
-- can actually use the app, not from whenever (if ever) she happens to
-- collide with a guest limit and gets shown an upgrade sheet.
--
-- Rides the SAME event as the welcome email (see
-- 20261234000000_stylist_welcome_email.sql): the null -> not-null
-- transition of auth.users.email_confirmed_at, plus the born-confirmed
-- INSERT case for a project with email confirmation turned off. That
-- keeps "you're in" and "your trial started" landing together as one
-- moment instead of two separately-timed triggers that could drift.
--
-- Extends enqueue_stylist_welcome_email() rather than adding a second
-- trigger function, so there is exactly one call site, one exception
-- wrapper, and one place that already looked up the first name and the
-- app base URL.
--
-- What actually happens:
--   1. profiles.subscription_status is stamped 'trialing',
--      subscription_started_at = now(), subscription_current_period_end
--      = now() + 30 days -- using an upsert whose ON CONFLICT ... WHERE
--      guard only fires for a genuinely fresh account: no lifetime_access,
--      no founding_access, and no subscription_status already set. A
--      re-confirm, a replayed trigger, or an account that already has
--      real access is a no-op, not a second trial.
--   2. Only when that upsert actually took effect (RETURNING produced a
--      row), stylist_trial_started is enqueued -- same email template
--      used by the Stripe-driven path (renderTrialStarted), rendered
--      card-less since no Stripe object exists yet.
--
-- These are the exact columns start_subscription_for_user() /
-- apply_subscription_status() already write (see
-- 20260817000000_monthly_subscription.sql), so a REAL Stripe checkout
-- later cleanly supersedes this local trial: subscription_status flips
-- to whatever Stripe reports, subscription_current_period_end is
-- replaced with the real billing period end, and subscription_started_at
-- (coalesced, not overwritten) keeps the true original trial-start date
-- rather than resetting to the day a card was added.

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
  v_first_name   text;
  v_app_base     text;
  v_trial_start  timestamptz;
  v_trial_end    timestamptz;
  v_display_name text;
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

  -- ---------------------------------------------------------------
  -- Auto-start the trial. See migration header for the guard logic.
  -- ---------------------------------------------------------------
  v_trial_start := now();
  v_trial_end   := now() + interval '30 days';

  insert into public.profiles (id, subscription_status, subscription_started_at, subscription_current_period_end)
  values (user_id_in, 'trialing', v_trial_start, v_trial_end)
  on conflict (id) do update
     set subscription_status              = 'trialing',
         subscription_started_at          = v_trial_start,
         subscription_current_period_end  = v_trial_end
   where public.profiles.lifetime_access is not true
     and public.profiles.founding_access is not true
     and public.profiles.subscription_status is null
  returning coalesce(nullif(trim(business_name), ''), nullif(trim(full_name), ''))
       into v_display_name;

  -- FOUND is only true when the upsert's WHERE guard let the row
  -- through -- an account that already had lifetime/founding access, or
  -- was already trialing/subscribed, produces no row and no email here.
  if found then
    perform public.queue_notification(
      user_id_in           => user_id_in,
      channel_in           => 'email',
      notification_type_in => 'stylist_trial_started',
      body_in               => 'Your 30-day Braid Boss Pro free trial is active through '
                               || to_char(v_trial_end, 'FMMonth FMDD, YYYY')
                               || '. No card on file -- open your dashboard at ' || v_app_base
                               || ' to add your services, set your availability, and share your booking link.',
      subject_in            => 'Your 30-day Braid Boss Pro trial has started',
      recipient_email_in    => email_in,
      recipient_name_in     => coalesce(v_display_name, v_first_name),
      payload_in            => jsonb_strip_nulls(jsonb_build_object(
                                 'firstName',    v_first_name,
                                 'planLabel',    'Monthly',
                                 'trialStart',   v_trial_start,
                                 'trialEnd',     v_trial_end,
                                 'baseUrl',      v_app_base,
                                 'dashboardUrl', v_app_base || '/',
                                 'setupUrl',     v_app_base || '/'
                               )),
      dedupe_key_in         => 'stylist_trial_started:' || user_id_in::text
    );
  end if;
end;
$$;

revoke all on function public.enqueue_stylist_welcome_email(uuid, text) from public;
revoke all on function public.enqueue_stylist_welcome_email(uuid, text) from anon;
revoke all on function public.enqueue_stylist_welcome_email(uuid, text) from authenticated;
grant execute on function public.enqueue_stylist_welcome_email(uuid, text) to service_role;

notify pgrst, 'reload schema';

-- Verification:
-- select subscription_status, subscription_started_at, subscription_current_period_end
-- from public.profiles where id = '<a real user id>';
--
-- select notification_type, status, recipient_email, dedupe_key, created_at
-- from public.notification_queue
-- where dedupe_key in (
--   'stylist_welcome:<user id>',
--   'stylist_trial_started:<user id>'
-- )
-- order by created_at;
