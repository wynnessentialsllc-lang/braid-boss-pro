-- Onboarding activation nudges + a local (card-less) trial-ending
-- reminder.
--
-- The gap this closes: a stylist who signs up gets exactly one email
-- (the welcome message) and then, previously, silence -- nothing in
-- the product ever followed up on whether she actually finished
-- setting up, and nothing ever warned her the trial was ending, unless
-- she happened to be on a real Stripe subscription (whose
-- customer.subscription.trial_will_end webhook is the only thing that
-- already drove stylist_trial_ending). Every trial now starts locally,
-- with no Stripe object at all until she subscribes, so that webhook
-- path never fires for the common case. These two jobs are the
-- server-side follow-through: one nudges her through setup on days
-- 1/3/7/14/21, the other reminds her the trial is ending a few days
-- before it does, whether or not Stripe is involved yet.
--
-- Both mirror the daily/monthly report jobs already in this codebase
-- (20261124000000_daily_sales_summary.sql,
-- 20261260000000_monthly_review_report.sql): an hourly cron, a
-- dedupe_key that makes replay harmless, and "nothing to say" means no
-- email rather than an empty one.
--
-- Branding/layout for the nudge lives in
-- supabase/functions/_shared/activation-nudge-email.ts
-- (notification_type = 'activation_nudge'). The trial-ending reminder
-- reuses the EXISTING renderTrialEnding template
-- (notification_type = 'stylist_trial_ending', already wired into the
-- worker) -- this migration only owns firing it from a cron trigger
-- instead of the Stripe webhook, for the accounts that webhook can
-- never reach.

-- ---------------------------------------------------------------
-- process_activation_nudges — setup checklist, days 1/3/7/14/21
-- ---------------------------------------------------------------
-- Fires once per (user, checkpoint day). Skips entirely when the
-- account has nothing left to finish, so a fully set-up stylist never
-- sees a nag she's already outgrown. When something IS left, the email
-- shows the whole five-step checklist (done steps read as checked off,
-- not-done ones as the action), so it reads as progress, not homework.
--
-- Returns the number of nudges enqueued.
create or replace function public.process_activation_nudges()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_enqueued     integer := 0;
  u              record;
  v_days_since   integer;
  v_checkpoint   integer;
  v_dedupe       text;
  v_owner_email  text;
  v_studio       text;
  v_first_name   text;
  v_business_set boolean;
  v_services_n   integer;
  v_avail_open   boolean;
  v_stripe_on    boolean;
  v_link_active  boolean;
  v_app_base     text;
  v_steps        jsonb;
  v_payload      jsonb;
  -- Only these five checkpoints ever fire. A stylist who opens the app
  -- for the first time on day 9, say, simply gets nothing until day 14
  -- rather than a backlog of missed days firing at once.
  c_checkpoints  constant integer[] := array[1, 3, 7, 14, 21];
begin
  v_app_base := coalesce(
    nullif(current_setting('app.public_url', true), ''),
    'https://braidbosspro.app'
  );

  for u in
    select p.id as user_id, p.subscription_started_at, p.subscription_status,
           p.business_name, p.full_name,
           p.stripe_connect_charges_enabled
      from public.profiles p
     where p.subscription_status = 'trialing'
       and p.subscription_started_at is not null
       and p.subscription_started_at >= now() - interval '22 days'
  loop
    v_days_since := floor(extract(epoch from (now() - u.subscription_started_at)) / 86400)::int;

    -- Only act on the exact days a checkpoint lands, not "at least."
    if not (v_days_since = any(c_checkpoints)) then
      continue;
    end if;
    v_checkpoint := v_days_since;

    v_dedupe := 'activation_nudge:' || u.user_id || ':' || v_checkpoint::text;
    if exists (select 1 from public.notification_queue where dedupe_key = v_dedupe) then
      continue;
    end if;

    select email into v_owner_email from auth.users where id = u.user_id;
    if v_owner_email is null or position('@' in v_owner_email) = 0 then
      continue;
    end if;

    v_business_set := coalesce(nullif(trim(u.business_name), ''), nullif(trim(u.full_name), '')) is not null;
    select count(*) into v_services_n from public.services s where s.user_id = u.user_id;
    select exists (
      select 1 from public.availability_rules r where r.user_id = u.user_id and r.is_open is true
    ) into v_avail_open;
    v_stripe_on := u.stripe_connect_charges_enabled is true;
    select exists (
      select 1 from public.booking_links bl where bl.user_id = u.user_id and bl.active is true
    ) into v_link_active;

    -- Nothing left to finish: no email, this account has outgrown the nudge.
    if v_business_set and v_services_n > 0 and v_avail_open and v_stripe_on and v_link_active then
      continue;
    end if;

    v_studio := coalesce(nullif(trim(u.business_name), ''), nullif(trim(u.full_name), ''), 'Your studio');
    v_first_name := nullif(trim(split_part(coalesce(u.full_name, ''), ' ', 1)), '');

    v_steps := jsonb_build_array(
      jsonb_build_object(
        'key', 'businessName', 'done', v_business_set,
        'title', 'Add your business name',
        'body', 'Clients see this on every booking page and receipt.',
        'actionUrl', v_app_base || '/?n=settings',
        'lessonUrl', v_app_base || '/?n=educationHub'
      ),
      jsonb_build_object(
        'key', 'services', 'done', v_services_n > 0,
        'title', 'Add your first service',
        'body', 'Set a price and length for one style -- you can add the rest later.',
        'actionUrl', v_app_base || '/?n=services',
        'lessonUrl', v_app_base || '/?n=educationHub'
      ),
      jsonb_build_object(
        'key', 'availability', 'done', v_avail_open,
        'title', 'Set your open days',
        'body', 'Pick the days and hours clients can actually book you.',
        'actionUrl', v_app_base || '/?n=availability',
        'lessonUrl', v_app_base || '/?n=educationHub'
      ),
      jsonb_build_object(
        'key', 'stripe', 'done', v_stripe_on,
        'title', 'Connect Stripe',
        'body', 'This is how deposits and payments land in your own account.',
        'actionUrl', v_app_base || '/?n=settings',
        'lessonUrl', v_app_base || '/?n=educationHub'
      ),
      jsonb_build_object(
        'key', 'bookingLink', 'done', v_link_active,
        'title', 'Turn on your booking link',
        'body', 'This is the link you actually share -- nothing above matters to a client until this is live.',
        'actionUrl', v_app_base || '/?n=account',
        'lessonUrl', v_app_base || '/?n=educationHub'
      )
    );

    v_payload := jsonb_build_object(
      'studioName',     v_studio,
      'firstName',      v_first_name,
      'daysSinceStart', v_checkpoint,
      'baseUrl',        v_app_base,
      'dashboardUrl',   v_app_base || '/',
      'steps',          v_steps
    );

    perform public.queue_notification(
      user_id_in           => u.user_id,
      channel_in           => 'email',
      notification_type_in => 'activation_nudge',
      body_in               => 'Finish setting up ' || v_studio || ' on Braid Boss Pro.',
      subject_in            => 'Day ' || v_checkpoint || ': finish setting up your business',
      recipient_email_in    => v_owner_email,
      recipient_name_in     => v_studio,
      payload_in            => v_payload,
      dedupe_key_in         => v_dedupe
    );
    v_enqueued := v_enqueued + 1;
  end loop;

  return v_enqueued;
end $$;

revoke all on function public.process_activation_nudges() from public;
grant execute on function public.process_activation_nudges() to service_role;

-- ---------------------------------------------------------------
-- process_local_trial_ending_reminders — trial ends in ~3 days
-- ---------------------------------------------------------------
-- Reuses the existing stylist_trial_ending template (renderTrialEnding
-- in _shared/lifecycle-emails.ts, already wired into the worker), fired
-- here for an account whose trial is LOCAL -- still 'trialing' with no
-- Stripe subscription bound yet, so the Stripe webhook that normally
-- drives this email can never reach it. An account that already
-- converted (stripe_subscription_id is set, or status moved off
-- 'trialing') is excluded here on purpose: the real Stripe-driven path
-- already covers it, and firing both would be two emails saying two
-- different things about the same account.
--
-- One email per stylist, ever, for a given trial's end date -- the
-- dedupe key includes the period end, so if a mid-trial change ever
-- pushed that date out, a fresh reminder is allowed for the new date
-- rather than staying silently suppressed by the old key.
create or replace function public.process_local_trial_ending_reminders()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_enqueued    integer := 0;
  u             record;
  v_dedupe      text;
  v_owner_email text;
  v_first_name  text;
  v_app_base    text;
  v_payload     jsonb;
begin
  v_app_base := coalesce(
    nullif(current_setting('app.public_url', true), ''),
    'https://braidbosspro.app'
  );

  for u in
    select p.id as user_id, p.full_name, p.subscription_current_period_end
      from public.profiles p
     where p.subscription_status = 'trialing'
       and p.stripe_subscription_id is null
       and p.subscription_current_period_end is not null
       and p.subscription_current_period_end > now()
       and p.subscription_current_period_end <= now() + interval '3 days'
  loop
    v_dedupe := 'local_trial_ending:' || u.user_id || ':'
                || to_char(u.subscription_current_period_end, 'YYYY-MM-DD');
    if exists (select 1 from public.notification_queue where dedupe_key = v_dedupe) then
      continue;
    end if;

    select email into v_owner_email from auth.users where id = u.user_id;
    if v_owner_email is null or position('@' in v_owner_email) = 0 then
      continue;
    end if;

    v_first_name := nullif(trim(split_part(coalesce(u.full_name, ''), ' ', 1)), '');

    v_payload := jsonb_build_object(
      'firstName',    v_first_name,
      'planLabel',    'Monthly',
      'trialEnd',     u.subscription_current_period_end,
      'baseUrl',      v_app_base,
      'dashboardUrl', v_app_base || '/'
    );

    perform public.queue_notification(
      user_id_in           => u.user_id,
      channel_in           => 'email',
      notification_type_in => 'stylist_trial_ending',
      body_in               => 'Your Braid Boss Pro trial ends '
                               || to_char(u.subscription_current_period_end, 'FMMonth FMDD, YYYY') || '.',
      subject_in            => 'Your Braid Boss Pro trial is ending soon',
      recipient_email_in    => v_owner_email,
      payload_in            => v_payload,
      dedupe_key_in         => v_dedupe
    );
    v_enqueued := v_enqueued + 1;
  end loop;

  return v_enqueued;
end $$;

revoke all on function public.process_local_trial_ending_reminders() from public;
grant execute on function public.process_local_trial_ending_reminders() to service_role;

-- ---------------------------------------------------------------
-- Hourly crons
-- ---------------------------------------------------------------
create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'activation_nudges_hourly') then
    perform cron.unschedule('activation_nudges_hourly');
  end if;
  if exists (select 1 from cron.job where jobname = 'local_trial_ending_reminders_hourly') then
    perform cron.unschedule('local_trial_ending_reminders_hourly');
  end if;
end $$;

select cron.schedule(
  'activation_nudges_hourly',
  '15 * * * *',
  $$select public.process_activation_nudges();$$
);

select cron.schedule(
  'local_trial_ending_reminders_hourly',
  '20 * * * *',
  $$select public.process_local_trial_ending_reminders();$$
);

-- Staggered minutes (:15 / :20) so neither collides with the daily
-- summary (:00), the monthly review (:05), or each other.

-- Verification:
-- select jobname, schedule, active from cron.job
-- where jobname in ('activation_nudges_hourly', 'local_trial_ending_reminders_hourly');
--
-- What got queued:
-- select notification_type, dedupe_key, subject, status, created_at
-- from public.notification_queue
-- where notification_type in ('activation_nudge', 'stylist_trial_ending')
-- order by created_at desc limit 20;
