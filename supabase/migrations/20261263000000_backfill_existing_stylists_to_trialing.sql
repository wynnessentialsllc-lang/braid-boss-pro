-- One-time backfill: give every existing stylist who predates the
-- auto-start trial (20261261000000_auto_start_trial_on_signup.sql) the
-- same 30-day trial a brand-new signup now gets automatically.
--
-- Requested directly: these accounts signed up before the trial existed
-- as a concept, so nothing else would ever grant them one -- the
-- trigger only fires on a NEW confirmation event, and none of these
-- accounts will confirm again.
--
-- Same guard as the trigger: skips anyone with lifetime_access,
-- founding_access, or an existing subscription_status (a real paying
-- account, or one already stamped by a prior run of this function).
-- Re-running is a no-op the second time -- the WHERE clause excludes
-- every row it already touched.
--
-- Also enqueues stylist_trial_started for each account actually
-- stamped, same template and payload shape the trigger uses, so this
-- reads as the same "your trial is active" moment a new signup gets,
-- not a silent database change nobody is told about. One account
-- failing to email (a bad address, a transient error) never blocks the
-- rest of the batch -- caught, logged as a warning, loop continues.
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
         -- Re-check under the row lock: guards a concurrent write
         -- between the SELECT above and this UPDATE (e.g. the same
         -- account confirming email and hitting the trigger at this
         -- exact moment).
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
      v_enqueued := v_enqueued + 1;
    exception when others then
      raise warning 'backfill_existing_stylists_to_trialing: failed for %: %', u.user_id, sqlerrm;
    end;
  end loop;

  return v_enqueued;
end $$;

revoke all on function public.backfill_existing_stylists_to_trialing() from public;
grant execute on function public.backfill_existing_stylists_to_trialing() to service_role;

-- Not invoked here -- run manually once, after this migration is
-- applied and the app code that renders/serves the trial is deployed:
--
--   select public.backfill_existing_stylists_to_trialing();
--
-- Verification, before and after:
--   select id, subscription_status, subscription_started_at, subscription_current_period_end
--   from public.profiles
--   where coalesce(lifetime_access,false) is not true and coalesce(founding_access,false) is not true;
--
--   select recipient_email, dedupe_key, status, created_at
--   from public.notification_queue
--   where notification_type = 'stylist_trial_started'
--   order by created_at desc;
