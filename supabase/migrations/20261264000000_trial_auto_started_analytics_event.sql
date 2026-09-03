-- Instrument the auto-start trial with a trial_auto_started analytics
-- event, and the one-off "you're one tap from getting paid" nudge for
-- stylists who connected Stripe but never turned on their booking link.
--
-- Why a DB-side event instead of a client trackEvent() call: the trial
-- starts inside a trigger on auth.users, not on a page load, so there is
-- no reliable client moment to fire it from (a user might not open the
-- app again for hours after confirming). Writing directly into
-- analytics_events from the same transaction that stamps the trial means
-- the event can never be missed or double-fired independently of the
-- trial itself -- it's exactly as reliable as the trial stamp.
--
-- event_type / event_name have no CHECK constraint in this table (see
-- 20260603000000_analytics_events.sql), so 'trial_auto_started' needs no
-- schema change. 'system' is already a valid AnalyticsEventSource.

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

    insert into public.analytics_events (
      user_id, event_type, event_source, payload,
      event_name, event_category, metadata
    ) values (
      user_id_in, 'trial_auto_started', 'system',
      jsonb_build_object('trial_end', v_trial_end),
      'trial_auto_started', 'system',
      jsonb_build_object('trial_end', v_trial_end)
    );
  end if;
end;
$$;

revoke all on function public.enqueue_stylist_welcome_email(uuid, text) from public;
revoke all on function public.enqueue_stylist_welcome_email(uuid, text) from anon;
revoke all on function public.enqueue_stylist_welcome_email(uuid, text) from authenticated;
grant execute on function public.enqueue_stylist_welcome_email(uuid, text) to service_role;

-- Same addition to the one-time backfill, so the 8 accounts it already
-- moved to trialing (and anyone it's re-run against later) show up in
-- the same funnel.
create or replace function public.backfill_existing_stylists_to_trialing()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_enqueued     integer := 0;
  u              record;
  v_trial_start  timestamptz;
  v_trial_end    timestamptz;
  v_app_base     text;
  v_owner_email  text;
  v_first_name   text;
  v_display_name text;
  v_stamped_id   uuid;
begin
  v_app_base := coalesce(
    nullif(current_setting('app.public_url', true), ''),
    'https://braidbosspro.app'
  );
  v_trial_start := now();
  v_trial_end   := now() + interval '30 days';

  for u in
    select p.id as user_id
      from public.profiles p
     where coalesce(p.lifetime_access, false) is not true
       and coalesce(p.founding_access, false) is not true
       and p.subscription_status is null
  loop
    begin
      update public.profiles
         set subscription_status             = 'trialing',
             subscription_started_at         = v_trial_start,
             subscription_current_period_end = v_trial_end
       where id = u.user_id
         and coalesce(lifetime_access, false) is not true
         and coalesce(founding_access, false) is not true
         and subscription_status is null
      returning id, coalesce(nullif(trim(business_name), ''), nullif(trim(full_name), '')),
                nullif(trim(split_part(coalesce(full_name, ''), ' ', 1)), '')
           into v_stamped_id, v_display_name, v_first_name;

      if not found then
        continue;
      end if;

      select email into v_owner_email from auth.users where id = v_stamped_id;
      if v_owner_email is null or position('@' in v_owner_email) = 0 then
        continue;
      end if;

      perform public.queue_notification(
        user_id_in           => v_stamped_id,
        channel_in           => 'email',
        notification_type_in => 'stylist_trial_started',
        body_in               => 'Your 30-day Braid Boss Pro free trial is active through '
                                 || to_char(v_trial_end, 'FMMonth FMDD, YYYY')
                                 || '. No card on file -- open your dashboard at ' || v_app_base
                                 || ' to add your services, set your availability, and share your booking link.',
        subject_in            => 'Your 30-day Braid Boss Pro trial has started',
        recipient_email_in    => v_owner_email,
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
        dedupe_key_in         => 'stylist_trial_started:' || v_stamped_id::text
      );

      insert into public.analytics_events (
        user_id, event_type, event_source, payload,
        event_name, event_category, metadata
      ) values (
        v_stamped_id, 'trial_auto_started', 'system',
        jsonb_build_object('trial_end', v_trial_end, 'backfilled', true),
        'trial_auto_started', 'system',
        jsonb_build_object('trial_end', v_trial_end, 'backfilled', true)
      );

      v_enqueued := v_enqueued + 1;
    exception when others then
      raise warning 'backfill_existing_stylists_to_trialing: failed for %: %', u.user_id, sqlerrm;
    end;
  end loop;

  return v_enqueued;
end $$;

revoke all on function public.backfill_existing_stylists_to_trialing() from public;
grant execute on function public.backfill_existing_stylists_to_trialing() to service_role;

-- Historical catch-up: the 8 braiders the backfill already moved to
-- trialing (before this migration existed) never got a trial_auto_started
-- row. Backfill it directly, idempotent via the not-exists guard so
-- re-running this migration is harmless.
insert into public.analytics_events (
  user_id, event_type, event_source, payload,
  event_name, event_category, metadata
)
select
  p.id, 'trial_auto_started', 'system',
  jsonb_build_object('trial_end', p.subscription_current_period_end, 'backfilled', true),
  'trial_auto_started', 'system',
  jsonb_build_object('trial_end', p.subscription_current_period_end, 'backfilled', true)
from public.profiles p
where p.subscription_status = 'trialing'
  and p.stripe_subscription_id is null
  and not exists (
    select 1 from public.analytics_events ae
    where ae.user_id = p.id and ae.event_type = 'trial_auto_started'
  );

-- ---------------------------------------------------------------
-- One-off "you're one tap from getting paid" nudge
-- ---------------------------------------------------------------
-- Targeted, not recurring: stylists who connected Stripe (did the hard
-- part) but never turned on their booking link, so nothing they set up
-- can actually take a payment yet. Reuses the SAME activation_nudge
-- template as the day 1/3/7/14/21 drip (renderActivationNudge, already
-- deployed) with four steps marked done and only bookingLink open, so
-- the checklist reads as "you're almost there" rather than a generic
-- reminder. daysSinceStart is set to 21 purely for template tone (see
-- COPY.day21 in _shared/activation-nudge-email.ts: "These last steps are
-- what's left" / "once these are done, your booking page is completely
-- live for clients") -- it does not gate anything and is unrelated to
-- how long the account has actually been trialing.
--
-- One-time send: the dedupe key has no date/checkpoint component, so
-- this can be re-run safely (a stylist who already got it is skipped)
-- but will not repeat for someone it already reached.
do $$
declare
  v_app_base text;
  u          record;
  v_studio   text;
  v_steps    jsonb;
begin
  v_app_base := coalesce(
    nullif(current_setting('app.public_url', true), ''),
    'https://braidbosspro.app'
  );

  for u in
    select p.id as user_id, p.business_name, p.full_name, ua.email as owner_email
      from public.profiles p
      join auth.users ua on ua.id = p.id
     where p.stripe_connect_charges_enabled = true
       and not exists (
         select 1 from public.booking_links bl where bl.user_id = p.id and bl.active = true
       )
       and ua.email is not null
       and position('@' in ua.email) > 0
       and not exists (
         select 1 from public.notification_queue nq
         where nq.dedupe_key = 'stalled_payment_ready_nudge:' || p.id::text
       )
  loop
    v_studio := coalesce(nullif(trim(u.business_name), ''), nullif(trim(u.full_name), ''), 'Your studio');

    v_steps := jsonb_build_array(
      jsonb_build_object('key', 'businessName', 'done', true,
        'title', 'Add your business name', 'body', 'Clients see this on every booking page and receipt.',
        'actionUrl', v_app_base || '/?n=settings', 'lessonUrl', v_app_base || '/?n=educationHub'),
      jsonb_build_object('key', 'services', 'done', true,
        'title', 'Add your first service', 'body', 'Set a price and length for one style.',
        'actionUrl', v_app_base || '/?n=services', 'lessonUrl', v_app_base || '/?n=educationHub'),
      jsonb_build_object('key', 'availability', 'done', true,
        'title', 'Set your open days', 'body', 'Pick the days and hours clients can actually book you.',
        'actionUrl', v_app_base || '/?n=availability', 'lessonUrl', v_app_base || '/?n=educationHub'),
      jsonb_build_object('key', 'stripe', 'done', true,
        'title', 'Connect Stripe', 'body', 'This is how deposits and payments land in your own account.',
        'actionUrl', v_app_base || '/?n=settings', 'lessonUrl', v_app_base || '/?n=educationHub'),
      jsonb_build_object('key', 'bookingLink', 'done', false,
        'title', 'Turn on your booking link',
        'body', 'This is the link you actually share -- nothing above matters to a client until this is live.',
        'actionUrl', v_app_base || '/?n=account', 'lessonUrl', v_app_base || '/?n=educationHub')
    );

    perform public.queue_notification(
      user_id_in           => u.user_id,
      channel_in           => 'email',
      notification_type_in => 'activation_nudge',
      body_in               => 'Turn on your booking link to start getting paid through ' || v_studio || '.',
      subject_in            => 'One step left: turn on your booking link',
      recipient_email_in    => u.owner_email,
      recipient_name_in     => v_studio,
      payload_in            => jsonb_build_object(
                                 'studioName',     v_studio,
                                 'daysSinceStart', 21,
                                 'baseUrl',        v_app_base,
                                 'dashboardUrl',   v_app_base || '/',
                                 'steps',          v_steps
                               ),
      dedupe_key_in         => 'stalled_payment_ready_nudge:' || u.user_id::text
    );
  end loop;
end $$;

-- Verification:
-- select recipient_email, dedupe_key, status, created_at from public.notification_queue
-- where notification_type = 'activation_nudge' and dedupe_key like 'stalled_payment_ready_nudge:%'
-- order by created_at desc;
--
-- select event_type, count(*) from public.analytics_events
-- where event_type = 'trial_auto_started' group by event_type;
