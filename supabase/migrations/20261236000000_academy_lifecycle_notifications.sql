-- Academy notifications — the touchpoints after the sale.
--
-- Buying a class or a video already emails both sides (the checkout
-- webhooks send the buyer their access details and queue the braider a
-- sale alert). Everything AFTER that moment was silent:
--
--   * a braider moves a class to a new date, swaps the venue, or drops
--     in the Zoom link  -> nobody who paid is told
--   * a braider cancels a class entirely                 -> same
--   * a class starts tomorrow                            -> no reminder
--   * a paid seat is refunded and re-opens               -> the waitlist
--                                                           never hears
--   * a rented video is hours from expiring              -> no warning,
--                                                           no chance to
--                                                           re-rent
--   * someone joins a class waitlist                     -> the braider
--                                                           is never told
--
-- This migration covers all six through the existing notification
-- queue, so they inherit dedupe, retries, communication_logs mirroring,
-- the stylist push trigger and the bell mirror for free.
--
-- New notification types:
--   client   class_schedule_updated      class was moved / details changed
--   client   class_cancelled             class called off
--   client   class_reminder              starts within 24h
--   client   class_seat_opened           a paid seat was refunded
--   client   video_access_expiring       rental ends within 24h
--   stylist  class_reminder_owner        your class is tomorrow
--   stylist  class_waitlist_join_owner   someone joined a class waitlist
--
-- Every send is best-effort: a notification failure can never roll back
-- the edit, refund or purchase that triggered it.
--
-- The email worker renders all seven; until it is redeployed they fall
-- through to its branded generic renderer, so nothing breaks.

begin;

-- ---------------------------------------------------------------------
-- Shared label/URL resolvers, so seven templates can't drift apart.
-- ---------------------------------------------------------------------

-- Studio name with the Academy's wording — the class pages say
-- "braider", not "stylist", so the generic fallback is swapped.
create or replace function public.academy_braider_name(uid uuid)
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select case
    when public.style_request_studio_name(uid) = 'your stylist' then 'your braider'
    else public.style_request_studio_name(uid)
  end;
$$;

-- The /u/<handle>/… segment of a braider's public pages. Branded slug
-- first, falling back to the booking link's random slug.
create or replace function public.academy_handle(uid uuid)
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select nullif(trim(coalesce(
    (select p.public_slug from public.profiles p where p.id = uid),
    (select bl.slug from public.booking_links bl
      where bl.user_id = uid and bl.active = true
      order by bl.created_at asc limit 1)
  , '')), '');
$$;

-- "Sep 3, 2026, 6:00 PM" in the timezone the class was set in, matching
-- formatClassWhen() in the app. A missing or malformed IANA name falls
-- back to UTC instead of raising.
create or replace function public.academy_when_label(starts_at_in timestamptz, tz_in text)
returns text
language plpgsql
immutable
as $$
begin
  if starts_at_in is null then
    return 'Date to be announced';
  end if;
  begin
    return to_char(starts_at_in at time zone coalesce(nullif(trim(coalesce(tz_in, '')), ''), 'UTC'),
                   'FMMon FMDD, YYYY, FMHH12:MI AM');
  exception when others then
    return to_char(starts_at_in at time zone 'UTC', 'FMMon FMDD, YYYY, FMHH12:MI AM') || ' UTC';
  end;
end;
$$;

-- ---------------------------------------------------------------------
-- Enqueue helpers.
--
-- queue_client_confirmation_email is repeated verbatim from
-- 20261235000000 so this file can be applied on its own; create or
-- replace makes that a no-op when it is already in place. See that
-- migration for why public flows can't call queue_notification.
-- ---------------------------------------------------------------------
create or replace function public.queue_client_confirmation_email(
  user_id_in           uuid,
  notification_type_in text,
  subject_in           text,
  body_in              text,
  recipient_email_in   text,
  recipient_name_in    text  default null,
  payload_in           jsonb default '{}'::jsonb,
  dedupe_key_in        text  default null
)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_id uuid;
begin
  if user_id_in is null or nullif(trim(coalesce(notification_type_in, '')), '') is null then
    return false;
  end if;
  if recipient_email_in is null or position('@' in recipient_email_in) = 0 then
    return false;
  end if;

  insert into public.notification_queue (
    user_id, channel, notification_type,
    recipient_name, recipient_email,
    subject, body, payload, scheduled_for, dedupe_key
  ) values (
    user_id_in, 'email', notification_type_in,
    nullif(trim(coalesce(recipient_name_in, '')), ''),
    trim(recipient_email_in),
    subject_in, coalesce(body_in, ''), coalesce(payload_in, '{}'::jsonb), now(),
    nullif(trim(coalesce(dedupe_key_in, '')), '')
  )
  on conflict (dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;

  return v_id is not null;
exception when others then
  return false;
end;
$$;

revoke all on function public.queue_client_confirmation_email(uuid, text, text, text, text, text, jsonb, text) from public;

-- Owner-addressed twin. queue_stylist_email_alert() already does this,
-- but it routes through queue_notification and so inherits its
-- `auth.uid() = user_id` check — fine from the service role, fatal from
-- a browser-called trigger (a visitor joining a class waitlist). This
-- resolves the braider's login email the same way and inserts directly.
-- The row is stylist-addressed, so trg_push_stylist_addressed turns it
-- into a web push exactly like every other braider alert.
create or replace function public.queue_owner_alert_email(
  user_id_in           uuid,
  notification_type_in text,
  subject_in           text,
  body_in              text,
  payload_in           jsonb default '{}'::jsonb,
  dedupe_key_in        text  default null
)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_email text;
begin
  if user_id_in is null then return false; end if;

  begin
    select email into v_email from auth.users where id = user_id_in;
  exception when others then
    v_email := null;
  end;
  if v_email is null or position('@' in v_email) = 0 then
    return false;
  end if;

  return public.queue_client_confirmation_email(
    user_id_in           => user_id_in,
    notification_type_in => notification_type_in,
    subject_in           => subject_in,
    body_in              => body_in,
    recipient_email_in   => v_email,
    recipient_name_in    => public.academy_braider_name(user_id_in),
    payload_in           => payload_in,
    dedupe_key_in        => dedupe_key_in
  );
exception when others then
  return false;
end;
$$;

revoke all on function public.queue_owner_alert_email(uuid, text, text, text, jsonb, text) from public;

-- ---------------------------------------------------------------------
-- 1) Class moved / changed / cancelled -> everyone who paid.
--
-- Fires on the braider's own edit (class_offerings carries an owner-all
-- policy, so app edits land here). Only the fields a student would need
-- to re-plan around count as a change: start time, timezone, format,
-- venue, join link — renaming a class or fixing a typo in the blurb
-- emails nobody.
--
-- The dedupe key hashes the new schedule, so saving the same values
-- twice sends once, while a genuine second change sends again.
-- ---------------------------------------------------------------------
create or replace function public.class_offerings_notify_changes()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  r             record;
  v_kind        text;
  v_studio      text;
  v_handle      text;
  v_when        text;
  v_when_old    text;
  v_moved       boolean;
  v_access      text;
  v_class_url   text;
  v_reg_url     text;
  v_body        text;
  v_subject     text;
  v_state_hash  text;
begin
  -- Which kind of notice, if any?
  if NEW.status = 'canceled' and coalesce(OLD.status, '') <> 'canceled' then
    v_kind := 'cancelled';
    -- A class that already happened can't be meaningfully cancelled.
    if NEW.starts_at is not null and NEW.starts_at < now() then
      return NEW;
    end if;
  elsif NEW.status = 'published'
    and (OLD.starts_at     is distinct from NEW.starts_at
      or OLD.timezone      is distinct from NEW.timezone
      or OLD.format        is distinct from NEW.format
      or OLD.location_text is distinct from NEW.location_text
      or OLD.meeting_url   is distinct from NEW.meeting_url) then
    v_kind := 'updated';
    -- Nothing to warn about once both the old and the new date are past.
    if coalesce(NEW.starts_at, now()) < now() and coalesce(OLD.starts_at, now()) < now() then
      return NEW;
    end if;
  else
    return NEW;
  end if;

  v_studio   := public.academy_braider_name(NEW.user_id);
  v_handle   := public.academy_handle(NEW.user_id);
  v_when     := public.academy_when_label(NEW.starts_at, NEW.timezone);
  v_when_old := public.academy_when_label(OLD.starts_at, OLD.timezone);
  v_moved    := OLD.starts_at is distinct from NEW.starts_at;
  v_class_url := case
    when v_handle is not null and nullif(trim(coalesce(NEW.slug, '')), '') is not null
      then 'https://braidbosspro.app/u/' || v_handle || '/classes/' || NEW.slug
    else null
  end;

  -- What a student needs to show up: the room or the link.
  v_access := case
    when NEW.format = 'virtual' then nullif(trim(coalesce(NEW.meeting_url, '')), '')
    else nullif(trim(coalesce(NEW.location_text, '')), '')
  end;

  v_state_hash := md5(concat_ws('|',
    coalesce(NEW.starts_at::text, ''), coalesce(NEW.timezone, ''),
    coalesce(NEW.format, ''), coalesce(NEW.location_text, ''),
    coalesce(NEW.meeting_url, '')));

  for r in
    select cr.id, cr.student_name, cr.student_email, cr.seats, cr.access_token
      from public.class_registrations cr
     where cr.class_id = NEW.id
       and cr.status = 'paid'
       and cr.student_email is not null
       and position('@' in cr.student_email) > 0
  loop
    -- Deep link back to their own confirmation panel, which re-reads the
    -- access details live rather than trusting a stale email.
    v_reg_url := case
      when v_class_url is not null and nullif(trim(coalesce(r.access_token, '')), '') is not null
        then v_class_url || '?registered=' || r.access_token
      else v_class_url
    end;

    if v_kind = 'cancelled' then
      v_subject := 'Cancelled: ' || NEW.title;
      v_body :=
        v_studio || ' has cancelled ' || NEW.title || '.' || chr(10) || chr(10) ||
        'It was scheduled for ' || v_when_old || '.' || chr(10) || chr(10) ||
        'You don''t need to do anything to give up your seat. If you paid, ' ||
        'reply to this email and ' || v_studio || ' will sort out your refund.';
    else
      v_subject := case when v_moved
                        then 'New date: ' || NEW.title
                        else 'Updated details: ' || NEW.title end;
      v_body :=
        v_studio || ' updated ' || NEW.title || '.' || chr(10) || chr(10) ||
        case when v_moved
             then 'New time: ' || v_when || chr(10) || 'Previously: ' || v_when_old || chr(10)
             else 'When: ' || v_when || chr(10) end ||
        case when v_access is not null
             then (case when NEW.format = 'virtual' then 'Join link: ' else 'Location: ' end)
                  || v_access || chr(10)
             else '' end ||
        chr(10) || 'Your seat is still yours — nothing to re-book.' ||
        case when v_reg_url is not null
             then chr(10) || chr(10) || 'Your details: ' || v_reg_url else '' end;
    end if;

    perform public.queue_client_confirmation_email(
      user_id_in           => NEW.user_id,
      notification_type_in => case when v_kind = 'cancelled'
                                   then 'class_cancelled' else 'class_schedule_updated' end,
      subject_in           => v_subject,
      body_in              => v_body,
      recipient_email_in   => r.student_email,
      recipient_name_in    => nullif(trim(coalesce(r.student_name, '')), ''),
      payload_in           => jsonb_build_object(
        'clientName',   coalesce(nullif(trim(coalesce(r.student_name, '')), ''), 'there'),
        'studioName',   v_studio,
        'classTitle',   NEW.title,
        'whenLabel',    v_when,
        'previousWhenLabel', case when v_moved then v_when_old else null end,
        'wasMoved',     v_moved,
        'format',       NEW.format,
        'accessLabel',  case when NEW.format = 'virtual' then 'Join link' else 'Location' end,
        'accessValue',  v_access,
        'seats',        r.seats,
        'classUrl',     v_reg_url
      ),
      dedupe_key_in        => case
        when v_kind = 'cancelled' then 'class_cancelled:' || r.id::text
        else 'class_schedule_updated:' || r.id::text || ':' || v_state_hash
      end
    );
  end loop;

  return NEW;
exception when others then
  return NEW;  -- a notification hiccup must never fail the braider's edit
end;
$$;

drop trigger if exists trg_class_offerings_notify_changes on public.class_offerings;
create trigger trg_class_offerings_notify_changes
  after update on public.class_offerings
  for each row execute function public.class_offerings_notify_changes();

-- ---------------------------------------------------------------------
-- 2) A paid seat is given back -> tell the waitlist.
--
-- This is what class_waitlist.notified_at was reserved for in
-- 20261212000000 ("v1 is capture + display only … that can layer on
-- later via the notification queue"). First come, first served: the mail
-- points at the public class page, and each person is stamped so a
-- second refund doesn't re-mail the same people.
-- ---------------------------------------------------------------------
create or replace function public.class_registrations_notify_seat_opened()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  w           record;
  v_class     record;
  v_studio    text;
  v_handle    text;
  v_when      text;
  v_class_url text;
begin
  if NEW.status not in ('refunded', 'cancelled') or coalesce(OLD.status, '') <> 'paid' then
    return NEW;
  end if;

  select co.id, co.title, co.slug, co.starts_at, co.timezone, co.status
    into v_class
    from public.class_offerings co
   where co.id = NEW.class_id
   limit 1;

  -- Only worth telling anyone if the class is still on and still ahead.
  if v_class.id is null
     or v_class.status <> 'published'
     or (v_class.starts_at is not null and v_class.starts_at < now()) then
    return NEW;
  end if;

  v_studio := public.academy_braider_name(NEW.user_id);
  v_handle := public.academy_handle(NEW.user_id);
  v_when   := public.academy_when_label(v_class.starts_at, v_class.timezone);
  v_class_url := case
    when v_handle is not null and nullif(trim(coalesce(v_class.slug, '')), '') is not null
      then 'https://braidbosspro.app/u/' || v_handle || '/classes/' || v_class.slug
    else null
  end;

  for w in
    select cw.id, cw.name, cw.email
      from public.class_waitlist cw
     where cw.class_id = NEW.class_id
       and cw.notified_at is null
       and cw.email is not null
       and position('@' in cw.email) > 0
     order by cw.created_at asc
     limit 100
  loop
    perform public.queue_client_confirmation_email(
      user_id_in           => NEW.user_id,
      notification_type_in => 'class_seat_opened',
      subject_in           => 'A seat just opened — ' || v_class.title,
      body_in              =>
        'A seat just opened up in ' || v_class.title || ' with ' || v_studio || '.' || chr(10) || chr(10) ||
        'When: ' || v_when || chr(10) || chr(10) ||
        'It''s first come, first served — the first person to sign up gets it.' ||
        case when v_class_url is not null
             then chr(10) || chr(10) || 'Grab it here: ' || v_class_url else '' end,
      recipient_email_in   => w.email,
      recipient_name_in    => nullif(trim(coalesce(w.name, '')), ''),
      payload_in           => jsonb_build_object(
        'clientName', coalesce(nullif(trim(coalesce(w.name, '')), ''), 'there'),
        'studioName', v_studio,
        'classTitle', v_class.title,
        'whenLabel',  v_when,
        'classUrl',   v_class_url
      ),
      dedupe_key_in        => 'class_seat_opened:' || w.id::text || ':' || NEW.id::text
    );

    update public.class_waitlist set notified_at = now() where id = w.id;
  end loop;

  return NEW;
exception when others then
  return NEW;
end;
$$;

drop trigger if exists trg_class_registrations_notify_seat_opened on public.class_registrations;
create trigger trg_class_registrations_notify_seat_opened
  after update on public.class_registrations
  for each row execute function public.class_registrations_notify_seat_opened();

-- ---------------------------------------------------------------------
-- 3) Someone joined a class waitlist -> tell the braider.
--
-- Its own trigger rather than an edit to class_waitlist_notify_joined
-- (20261235000000), which owns the joiner's side. Same table, two
-- audiences, two independent best-effort sends.
-- ---------------------------------------------------------------------
create or replace function public.class_waitlist_notify_owner()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_title  text;
  v_who    text;
  v_count  integer;
begin
  select co.title into v_title
    from public.class_offerings co where co.id = NEW.class_id limit 1;
  v_title := coalesce(nullif(trim(coalesce(v_title, '')), ''), 'your class');

  v_who := coalesce(nullif(trim(coalesce(NEW.name, '')), ''), NEW.email, 'Someone');

  select count(*) into v_count
    from public.class_waitlist cw where cw.class_id = NEW.class_id;

  -- In-app bell.
  begin
    insert into public.notifications (id, user_id, category, title, body, data)
    values (
      'classwaitlist:' || NEW.id::text,
      NEW.user_id,
      'waitlist',
      v_who || ' joined the waitlist for ' || v_title,
      v_count::text || ' now waiting · ' || coalesce(NEW.email, ''),
      jsonb_build_object(
        'classWaitlistId', NEW.id,
        'classId',         NEW.class_id,
        'name',            NEW.name,
        'email',           NEW.email
      )
    )
    on conflict (id) do nothing;
  exception when others then
    null;
  end;

  perform public.queue_owner_alert_email(
    user_id_in           => NEW.user_id,
    notification_type_in => 'class_waitlist_join_owner',
    subject_in           => v_who || ' joined the waitlist for ' || v_title,
    body_in              =>
      v_who || ' joined the waitlist for ' || v_title || '.' || chr(10) || chr(10) ||
      'Contact: ' || coalesce(NEW.email, '—') || chr(10) ||
      'Waiting so far: ' || v_count::text || chr(10) || chr(10) ||
      'Add seats or free one up and they''ll be emailed automatically.',
    payload_in           => jsonb_build_object(
      'classWaitlistId', NEW.id,
      'classId',         NEW.class_id,
      'classTitle',      v_title,
      'joinerName',      nullif(trim(coalesce(NEW.name, '')), ''),
      'joinerEmail',     NEW.email,
      'waitingCount',    v_count
    ),
    dedupe_key_in        => 'class_waitlist_join_owner:' || NEW.id::text
  );

  return NEW;
exception when others then
  return NEW;
end;
$$;

drop trigger if exists trg_class_waitlist_notify_owner on public.class_waitlist;
create trigger trg_class_waitlist_notify_owner
  after insert on public.class_waitlist
  for each row execute function public.class_waitlist_notify_owner();

-- ---------------------------------------------------------------------
-- 4) Class starts within 24h -> students get a reminder, the braider
--    gets a head-count.
--
-- Dedupe is per registration (and per class for the braider), so the
-- hourly schedule sends each person exactly one reminder no matter how
-- many times the window is swept. Someone who buys 3 hours before the
-- door opens still gets theirs on the next tick.
-- ---------------------------------------------------------------------
create or replace function public.process_class_reminders()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  c            record;
  r            record;
  v_studio     text;
  v_handle     text;
  v_when       text;
  v_access     text;
  v_class_url  text;
  v_reg_url    text;
  v_seats      integer;
  v_regs       integer;
  n            integer := 0;
begin
  for c in
    select co.id, co.user_id, co.title, co.slug, co.starts_at, co.timezone,
           co.format, co.location_text, co.meeting_url
      from public.class_offerings co
     where co.status = 'published'
       and co.starts_at is not null
       and co.starts_at > now()
       and co.starts_at <= now() + interval '24 hours'
  loop
    v_studio := public.academy_braider_name(c.user_id);
    v_handle := public.academy_handle(c.user_id);
    v_when   := public.academy_when_label(c.starts_at, c.timezone);
    v_access := case
      when c.format = 'virtual' then nullif(trim(coalesce(c.meeting_url, '')), '')
      else nullif(trim(coalesce(c.location_text, '')), '')
    end;
    v_class_url := case
      when v_handle is not null and nullif(trim(coalesce(c.slug, '')), '') is not null
        then 'https://braidbosspro.app/u/' || v_handle || '/classes/' || c.slug
      else null
    end;

    for r in
      select cr.id, cr.student_name, cr.student_email, cr.seats, cr.access_token
        from public.class_registrations cr
       where cr.class_id = c.id
         and cr.status = 'paid'
         and cr.student_email is not null
         and position('@' in cr.student_email) > 0
    loop
      v_reg_url := case
        when v_class_url is not null and nullif(trim(coalesce(r.access_token, '')), '') is not null
          then v_class_url || '?registered=' || r.access_token
        else v_class_url
      end;

      if public.queue_client_confirmation_email(
           user_id_in           => c.user_id,
           notification_type_in => 'class_reminder',
           subject_in           => 'Tomorrow: ' || c.title,
           body_in              =>
             c.title || ' with ' || v_studio || ' is coming up.' || chr(10) || chr(10) ||
             'When: ' || v_when || chr(10) ||
             case when v_access is not null
                  then (case when c.format = 'virtual' then 'Join link: ' else 'Location: ' end)
                       || v_access || chr(10)
                  else '' end ||
             case when r.seats > 1 then 'Seats: ' || r.seats::text || chr(10) else '' end ||
             case when v_reg_url is not null
                  then chr(10) || 'Your details: ' || v_reg_url else '' end,
           recipient_email_in   => r.student_email,
           recipient_name_in    => nullif(trim(coalesce(r.student_name, '')), ''),
           payload_in           => jsonb_build_object(
             'clientName',  coalesce(nullif(trim(coalesce(r.student_name, '')), ''), 'there'),
             'studioName',  v_studio,
             'classTitle',  c.title,
             'whenLabel',   v_when,
             'format',      c.format,
             'accessLabel', case when c.format = 'virtual' then 'Join link' else 'Location' end,
             'accessValue', v_access,
             'seats',       r.seats,
             'classUrl',    v_reg_url
           ),
           dedupe_key_in        => 'class_reminder:' || r.id::text
         ) then
        n := n + 1;
      end if;
    end loop;

    -- Braider head-count, once per class.
    select count(*), coalesce(sum(cr.seats), 0)
      into v_regs, v_seats
      from public.class_registrations cr
     where cr.class_id = c.id and cr.status = 'paid';

    if public.queue_owner_alert_email(
         user_id_in           => c.user_id,
         notification_type_in => 'class_reminder_owner',
         subject_in           => 'Tomorrow: ' || c.title || ' (' || v_seats::text || ' seat' ||
                                 case when v_seats = 1 then '' else 's' end || ' sold)',
         body_in              =>
           c.title || ' runs ' || v_when || '.' || chr(10) || chr(10) ||
           'Sold: ' || v_seats::text || ' seat' || case when v_seats = 1 then '' else 's' end ||
           ' across ' || v_regs::text || ' sign-up' || case when v_regs = 1 then '' else 's' end || '.' ||
           chr(10) ||
           case when v_access is not null
                then (case when c.format = 'virtual' then 'Join link: ' else 'Location: ' end)
                     || v_access || chr(10)
                else (case when c.format = 'virtual'
                           then 'No join link is set yet — add one and everyone who paid is emailed automatically.'
                           else 'No location is set yet — add one and everyone who paid is emailed automatically.' end)
                     || chr(10) end ||
           chr(10) || 'Open Braid Boss Pro -> Classes to see the roster.',
         payload_in           => jsonb_build_object(
           'classId',     c.id,
           'classTitle',  c.title,
           'whenLabel',   v_when,
           'seatsSold',   v_seats,
           'signUps',     v_regs,
           'accessValue', v_access
         ),
         dedupe_key_in        => 'class_reminder_owner:' || c.id::text
       ) then
      n := n + 1;
    end if;
  end loop;

  return n;
end;
$$;

revoke all on function public.process_class_reminders() from public;
grant execute on function public.process_class_reminders() to service_role;

-- ---------------------------------------------------------------------
-- 5) A rented video is about to expire -> warn the buyer.
--
-- Rentals only (a permanent buy has no access_expires_at). The
-- `paid_at` floor keeps a same-day rental from being warned minutes
-- after purchase: a 1-day rental is inside the 24h window immediately,
-- so without it the "expiring" mail would land on top of the receipt.
-- ---------------------------------------------------------------------
create or replace function public.process_video_access_expiring()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  p           record;
  v_studio    text;
  v_handle    text;
  v_watch_url text;
  v_buy_url   text;
  v_expires   text;
  n           integer := 0;
begin
  for p in
    select vp.id, vp.user_id, vp.buyer_name, vp.buyer_email, vp.access_token,
           vp.access_expires_at, vl.title, vl.slug
      from public.video_purchases vp
      join public.video_lessons vl on vl.id = vp.video_id
     where vp.status = 'paid'
       and vp.access_expires_at is not null
       and vp.access_expires_at > now()
       and vp.access_expires_at <= now() + interval '24 hours'
       and vp.paid_at is not null
       and vp.paid_at < now() - interval '6 hours'
       and vp.buyer_email is not null
       and position('@' in vp.buyer_email) > 0
  loop
    v_studio := public.academy_braider_name(p.user_id);
    v_handle := public.academy_handle(p.user_id);
    v_watch_url := case
      when nullif(trim(coalesce(p.access_token, '')), '') is not null
        then 'https://braidbosspro.app/watch/' || p.access_token
      else null
    end;
    v_buy_url := case
      when v_handle is not null and nullif(trim(coalesce(p.slug, '')), '') is not null
        then 'https://braidbosspro.app/u/' || v_handle || '/videos/' || p.slug
      else null
    end;
    -- Rentals are sold in whole days, so the hour is what matters here.
    v_expires := to_char(p.access_expires_at at time zone 'UTC', 'FMMon FMDD, YYYY, FMHH12:MI AM') || ' UTC';

    if public.queue_client_confirmation_email(
         user_id_in           => p.user_id,
         notification_type_in => 'video_access_expiring',
         subject_in           => 'Last chance to watch: ' || p.title,
         body_in              =>
           'Your access to ' || p.title || ' from ' || v_studio || ' ends ' || v_expires || '.' ||
           chr(10) || chr(10) ||
           case when v_watch_url is not null
                then 'Watch it before then: ' || v_watch_url || chr(10) || chr(10) else '' end ||
           case when v_buy_url is not null
                then 'Need longer? You can rent it again here: ' || v_buy_url
                else 'Need longer? Ask ' || v_studio || ' about renting it again.' end,
         recipient_email_in   => p.buyer_email,
         recipient_name_in    => nullif(trim(coalesce(p.buyer_name, '')), ''),
         payload_in           => jsonb_build_object(
           'clientName',  coalesce(nullif(trim(coalesce(p.buyer_name, '')), ''), 'there'),
           'studioName',  v_studio,
           'videoTitle',  p.title,
           'expiresAt',   p.access_expires_at,
           'expiresLabel', v_expires,
           'watchUrl',    v_watch_url,
           'buyUrl',      v_buy_url
         ),
         dedupe_key_in        => 'video_access_expiring:' || p.id::text
       ) then
      n := n + 1;
    end if;
  end loop;

  return n;
end;
$$;

revoke all on function public.process_video_access_expiring() from public;
grant execute on function public.process_video_access_expiring() to service_role;

-- ---------------------------------------------------------------------
-- Schedules. Hourly is enough for both: reminders have a 24h window to
-- land in and expiry warnings a 18h one, so a missed tick is harmless.
-- Upserts by job name, so re-running this migration is safe.
-- ---------------------------------------------------------------------
do $$
declare jid bigint;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    select jobid into jid from cron.job where jobname = 'process_class_reminders_hourly';
    if jid is not null then perform cron.unschedule(jid); end if;
    perform cron.schedule(
      'process_class_reminders_hourly',
      '7 * * * *',
      $cron$ select public.process_class_reminders(); $cron$
    );

    select jobid into jid from cron.job where jobname = 'process_video_access_expiring_hourly';
    if jid is not null then perform cron.unschedule(jid); end if;
    perform cron.schedule(
      'process_video_access_expiring_hourly',
      '22 * * * *',
      $cron$ select public.process_video_access_expiring(); $cron$
    );
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
