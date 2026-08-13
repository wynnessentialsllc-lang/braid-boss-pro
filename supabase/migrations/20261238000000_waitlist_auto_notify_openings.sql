-- Tell the waitlist when a spot opens — without the braider having to.
--
-- The waitlist has always been able to reach clients, but only by hand:
-- a "Notify waitlist" card on a cancelled appointment, and a
-- last-minute-opening form on the Waitlist screen. Both need the
-- braider to notice an opening and go tap something, and both blast
-- every active entry regardless of the date that person asked for.
--
-- The gap that costs bookings is the monthly drop. Braiders on
-- booking_window_mode = 'monthly_release' open their books on a set day
-- ("the 15th"), the regulars grab everything within hours, and the
-- public page has been telling everyone else "join the waitlist and
-- we'll text you when more dates open" — while nothing, anywhere, ever
-- did. This migration makes that sentence true.
--
-- Two automations, one matching rule:
--
--   * release drops   — a daily sweep watches each monthly_release
--                       braider's bookable horizon. When it jumps, the
--                       newly-opened range is announced to the people
--                       waiting for a date inside it.
--   * cancellations   — an appointment flipped to 'cancelled' tells the
--                       people who wanted that exact day. The manual
--                       card stays for anything automation shouldn't
--                       touch.
--
-- Matching: an entry is notified when it named no date (any opening
-- interests them) or named one inside the window that just opened.
-- flexibility is deliberately NOT used to widen this — it describes the
-- time of day ("Anytime that day"), not which day.
--
-- Channels: email to anyone who left one. SMS as well — not instead —
-- when the braider has SMS switched on and the client left a phone,
-- because a text is what actually gets seen on a drop day. SMS stays
-- bounded by the two guards that already exist: the per-braider master
-- switch (default off) and prepaid credits, which the worker consumes
-- per send and which terminal-fail when exhausted. A braider who
-- doesn't want the spend turns SMS off and still gets the emails.
--
-- New notification types:
--   client  waitlist_dates_open   new dates just opened
--   client  waitlist_opening      a booked slot came free (reuses the
--                                 manual broadcast's type + template)
--   stylist waitlist_release_owner  we told your waitlist, here's who
--
-- Builds on the enqueue helpers from 20261235 (client email) and
-- 20261236 (owner alert); both are already in place.

begin;

-- ---------------------------------------------------------------------
-- Where the sweep remembers what it has already announced.
--
-- Holds the horizon (max bookable date) the waitlist has been told
-- about. A drop is detected as "the horizon moved past this", which is
-- self-healing: a missed cron day, a paused project, or a braider
-- changing release_months all resolve on the next run without needing
-- the sweep to land exactly on the release date.
-- ---------------------------------------------------------------------
alter table public.booking_policies
  add column if not exists waitlist_release_notified_through date;

comment on column public.booking_policies.waitlist_release_notified_through is
  'Latest bookable date the waitlist has already been told about. Set by process_waitlist_release_drops(); null bootstraps on the next run without sending.';

-- ---------------------------------------------------------------------
-- Public booking URL for a braider — same resolution order the outreach
-- and SMS senders use.
-- ---------------------------------------------------------------------
create or replace function public.waitlist_booking_url(uid uuid)
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select case
    when s.slug is not null then 'https://braidbosspro.app/book/' || s.slug
    else 'https://braidbosspro.app'
  end
  from (
    select nullif(trim(coalesce(
      (select bl.slug from public.booking_links bl
        where bl.user_id = uid and bl.active = true
        order by bl.created_at desc nulls last limit 1),
      (select p.public_slug from public.profiles p where p.id = uid)
    , '')), '') as slug
  ) s;
$$;

-- ---------------------------------------------------------------------
-- Queue one SMS to a waitlist client.
--
-- Mirrors queue_client_confirmation_email (20261235) for the other
-- channel, including the reason it can't just call queue_notification:
-- that RPC enforces auth.uid() = user_id, which a trigger fired by a
-- client-side cancellation can't satisfy. The one thing it MUST keep
-- from queue_notification is the per-braider SMS master switch, so
-- that check is repeated here verbatim rather than assumed.
-- ---------------------------------------------------------------------
create or replace function public.queue_client_sms(
  user_id_in           uuid,
  notification_type_in text,
  body_in              text,
  recipient_phone_in   text,
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
  if user_id_in is null then return false; end if;
  if recipient_phone_in is null or length(trim(recipient_phone_in)) < 7 then
    return false;
  end if;
  -- Braider's SMS master switch. Off (the default) means email only.
  if not public.sms_notifications_enabled_for(user_id_in) then
    return false;
  end if;

  insert into public.notification_queue (
    user_id, channel, notification_type,
    recipient_name, recipient_phone,
    body, payload, scheduled_for, dedupe_key
  ) values (
    user_id_in, 'sms', notification_type_in,
    nullif(trim(coalesce(recipient_name_in, '')), ''),
    trim(recipient_phone_in),
    coalesce(body_in, ''),
    -- The dispatcher prefers payload.smsText over body; set both so the
    -- text is identical whichever it reads.
    coalesce(payload_in, '{}'::jsonb) || jsonb_build_object('smsText', coalesce(body_in, '')),
    now(),
    nullif(trim(coalesce(dedupe_key_in, '')), '')
  )
  on conflict (dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;

  return v_id is not null;
exception when others then
  return false;
end;
$$;

revoke all on function public.queue_client_sms(uuid, text, text, text, text, jsonb, text) from public;

-- ---------------------------------------------------------------------
-- The shared send: announce an open window to everyone waiting for it.
--
-- from_date/to_date is the range that just became bookable — a single
-- day for a cancellation, a month or more for a release drop.
--
-- Only live entries are reached: 'waiting' or 'contacted' (the same
-- statuses the manual broadcast uses), and joined within the last 180
-- days so a year-old request doesn't get haunted by drops forever.
--
-- Returns the number of people notified (not messages sent — someone
-- reachable by both channels counts once).
-- ---------------------------------------------------------------------
create or replace function public.notify_waitlist_of_opening(
  user_id_in       uuid,
  from_date_in     date,
  to_date_in       date,
  kind_in          text,               -- 'dates_open' | 'opening'
  service_name_in  text default null,
  time_label_in    text default null,  -- cancellations: the freed time
  dedupe_scope_in  text default null   -- what makes this announcement unique
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  r          record;
  v_studio   text;
  v_url      text;
  v_type     text;
  v_range    text;
  v_subject  text;
  v_body     text;
  v_sms      text;
  v_key      text;
  v_reached  boolean;
  n          integer := 0;
begin
  if user_id_in is null or from_date_in is null or to_date_in is null then
    return 0;
  end if;
  if to_date_in < from_date_in then
    return 0;
  end if;

  v_studio := public.style_request_studio_name(user_id_in);
  v_url    := public.waitlist_booking_url(user_id_in);
  v_type   := case when kind_in = 'dates_open' then 'waitlist_dates_open' else 'waitlist_opening' end;
  v_range  := case
    when from_date_in = to_date_in then to_char(from_date_in, 'MM/DD/YYYY')
    else to_char(from_date_in, 'MM/DD/YYYY') || ' – ' || to_char(to_date_in, 'MM/DD/YYYY')
  end;

  for r in
    select w.id, w.client_name, w.client_email, w.client_phone, w.preferred_date, w.service_name
      from public.waitlist_requests w
     where w.user_id = user_id_in
       and w.status in ('waiting', 'contacted')
       and w.created_at >= now() - interval '180 days'
       -- Named no date (any opening will do), or named one inside the
       -- window that just opened.
       and (w.preferred_date is null
            or w.preferred_date between from_date_in and to_date_in)
       and (
         (w.client_email is not null and position('@' in w.client_email) > 0)
         or (w.client_phone is not null and length(trim(w.client_phone)) >= 7)
       )
     order by w.created_at asc
     limit 500
  loop
    v_key := coalesce(v_type, 'waitlist') || ':' || r.id::text || ':' ||
             coalesce(nullif(trim(coalesce(dedupe_scope_in, '')), ''), v_range);

    if kind_in = 'dates_open' then
      v_subject := 'New dates just opened — ' || v_studio;
      v_body :=
        v_studio || ' just opened more dates.' || chr(10) || chr(10) ||
        'Now booking: ' || v_range || chr(10) ||
        case when r.preferred_date is not null
             then 'You asked about ' || to_char(r.preferred_date, 'MM/DD/YYYY') || '.' || chr(10)
             else '' end ||
        chr(10) || 'These go fast — first come, first served.' || chr(10) || chr(10) ||
        'Book here: ' || v_url;
      v_sms := v_studio || ': new dates just opened (' || v_range || '). Book now: ' || v_url;
    else
      v_subject := v_studio || ': a spot just opened up';
      v_body :=
        'A spot just opened at ' || v_studio || '.' || chr(10) || chr(10) ||
        'When: ' || v_range ||
        case when nullif(trim(coalesce(time_label_in, '')), '') is not null
             then ' at ' || time_label_in else '' end || chr(10) ||
        chr(10) || 'First to book it gets it.' || chr(10) || chr(10) ||
        'Book here: ' || v_url;
      v_sms := v_studio || ': a spot opened ' || v_range ||
               case when nullif(trim(coalesce(time_label_in, '')), '') is not null
                    then ' at ' || time_label_in else '' end ||
               '. First to book gets it: ' || v_url;
    end if;

    v_reached := false;

    if r.client_email is not null and position('@' in r.client_email) > 0 then
      if public.queue_client_confirmation_email(
           user_id_in           => user_id_in,
           notification_type_in => v_type,
           subject_in           => v_subject,
           body_in              => v_body,
           recipient_email_in   => r.client_email,
           recipient_name_in    => nullif(trim(coalesce(r.client_name, '')), ''),
           payload_in           => jsonb_build_object(
             'clientName',    coalesce(nullif(trim(coalesce(r.client_name, '')), ''), 'there'),
             'studioName',    v_studio,
             'rangeLabel',    v_range,
             'fromDate',      from_date_in::text,
             'toDate',        to_date_in::text,
             'preferredDate', r.preferred_date::text,
             -- The service THIS person asked for, never the style the
             -- cancelling client had booked — the freed slot isn't
             -- reserved for their style, and it isn't anyone else's
             -- business what it was.
             'serviceName',   r.service_name,
             -- The renderers for both types read `time` / `date`, so
             -- keep the manual broadcast's payload shape intact.
             'date',          v_range,
             'time',          time_label_in,
             'bookUrl',       v_url
           ),
           dedupe_key_in        => v_key
         ) then
        v_reached := true;
      end if;
    end if;

    if public.queue_client_sms(
         user_id_in           => user_id_in,
         notification_type_in => v_type,
         body_in              => v_sms,
         recipient_phone_in   => r.client_phone,
         recipient_name_in    => nullif(trim(coalesce(r.client_name, '')), ''),
         payload_in           => jsonb_build_object('waitlistRequestId', r.id),
         dedupe_key_in        => v_key || ':sms'
       ) then
      v_reached := true;
    end if;

    if v_reached then n := n + 1; end if;
  end loop;

  return n;
end;
$$;

revoke all on function public.notify_waitlist_of_opening(uuid, date, date, text, text, text, text) from public;
grant execute on function public.notify_waitlist_of_opening(uuid, date, date, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------
-- 1) Release day — the books drop, the waitlist hears about it.
--
-- Runs daily. For each braider on monthly_release, compare the horizon
-- the window engine reports now against the one already announced:
--
--   null      -> record it and send nothing. Bootstrapping an existing
--                braider must not blast their whole waitlist about
--                dates that opened before this feature existed.
--   moved up  -> announce (previous horizon, new horizon] — only the
--                genuinely new days, so nobody is told twice about the
--                same month.
--   unchanged -> nothing.
--
-- Restricted to monthly_release on purpose: a rolling window advances
-- one day every day, which would be a daily email, not an event.
-- ---------------------------------------------------------------------
create or replace function public.process_waitlist_release_drops()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  p        record;
  w        record;
  v_from   date;
  v_sent   integer;   -- this braider only; n is the sweep-wide total
  n        integer := 0;
begin
  for p in
    select bp.user_id, bp.waitlist_release_notified_through as announced_through
      from public.booking_policies bp
     where coalesce(bp.booking_window_mode, 'rolling') = 'monthly_release'
  loop
    begin
      select * into w from public.compute_booking_window(p.user_id) limit 1;
      if w.max_date is null then
        continue;
      end if;

      if p.announced_through is null then
        update public.booking_policies
           set waitlist_release_notified_through = w.max_date
         where user_id = p.user_id;
        continue;  -- bootstrap only
      end if;

      if w.max_date <= p.announced_through then
        continue;  -- horizon hasn't moved
      end if;

      -- Only the days that weren't bookable before this drop.
      v_from := p.announced_through + 1;
      v_sent := public.notify_waitlist_of_opening(
        user_id_in      => p.user_id,
        from_date_in    => v_from,
        to_date_in      => w.max_date,
        kind_in         => 'dates_open',
        dedupe_scope_in => 'release:' || w.max_date::text
      );
      n := n + v_sent;

      update public.booking_policies
         set waitlist_release_notified_through = w.max_date
       where user_id = p.user_id;

      -- Tell the braider their waitlist went out. This fires in their
      -- name while they're doing hair, so they should hear about it
      -- from us before a client replies about it.
      if v_sent > 0 then
        perform public.queue_owner_alert_email(
          user_id_in           => p.user_id,
          notification_type_in => 'waitlist_release_owner',
          subject_in           => 'Your waitlist heard your books are open',
          body_in              =>
            'Your books just opened through ' || to_char(w.max_date, 'MM/DD/YYYY') || '.' ||
            chr(10) || chr(10) ||
            'We let your waitlist know — everyone waiting on a date in the new range, ' ||
            'plus anyone who didn''t name a day.' || chr(10) || chr(10) ||
            'Open Braid Boss Pro -> Waitlist to see who''s waiting.',
          payload_in           => jsonb_build_object(
            'openThrough', w.max_date::text,
            'notified',    v_sent
          ),
          dedupe_key_in        => 'waitlist_release_owner:' || p.user_id::text || ':' || w.max_date::text
        );
      end if;
    exception when others then
      -- One braider's bad config can't stop everyone else's drop.
      null;
    end;
  end loop;

  return n;
end;
$$;

revoke all on function public.process_waitlist_release_drops() from public;
grant execute on function public.process_waitlist_release_drops() to service_role;

-- ---------------------------------------------------------------------
-- 2) Cancellation — a booked day comes free, the people who wanted that
--    day hear about it.
--
-- Fires on the transition INTO a cancelled state, so re-saving an
-- already-cancelled appointment is silent. Real appointments only (not
-- blocks or all-day holds), and only for days still in the future —
-- nobody wants an alert about yesterday.
--
-- The manual "Notify waitlist" card is untouched: it broadcasts to
-- every active entry, which is still the right tool when the braider
-- wants to shake the whole tree. This is the automatic, date-matched
-- half that runs whether or not anyone opens the app.
-- ---------------------------------------------------------------------
create or replace function public.appointments_notify_waitlist_on_cancel()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_cancelled text[] := array['cancelled', 'canceled'];
begin
  if not (lower(coalesce(NEW.status, '')) = any(v_cancelled)) then
    return NEW;
  end if;
  if lower(coalesce(OLD.status, '')) = any(v_cancelled) then
    return NEW;  -- already cancelled; not a new opening
  end if;
  if coalesce(NEW.kind, 'appointment') <> 'appointment' then
    return NEW;
  end if;
  if coalesce(NEW.is_all_day, false) then
    return NEW;
  end if;
  if NEW.appt_date is null or NEW.appt_date < current_date then
    return NEW;
  end if;

  perform public.notify_waitlist_of_opening(
    user_id_in      => NEW.user_id,
    from_date_in    => NEW.appt_date,
    to_date_in      => NEW.appt_date,
    kind_in         => 'opening',
    service_name_in => NEW.style,
    time_label_in   => NEW.appt_time::text,
    dedupe_scope_in => 'appt:' || NEW.id::text
  );

  return NEW;
exception when others then
  return NEW;  -- a notification hiccup must never fail the cancellation
end;
$$;

drop trigger if exists trg_appointments_notify_waitlist_on_cancel on public.appointments;
create trigger trg_appointments_notify_waitlist_on_cancel
  after update on public.appointments
  for each row execute function public.appointments_notify_waitlist_on_cancel();

-- ---------------------------------------------------------------------
-- Schedule. Daily, mid-morning UTC — early enough that a drop lands the
-- same morning it opens, and the horizon comparison means the exact
-- hour never matters. Upserts by job name.
-- ---------------------------------------------------------------------
do $$
declare jid bigint;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    select jobid into jid from cron.job where jobname = 'process_waitlist_release_drops_daily';
    if jid is not null then perform cron.unschedule(jid); end if;
    perform cron.schedule(
      'process_waitlist_release_drops_daily',
      '35 13 * * *',
      $cron$ select public.process_waitlist_release_drops(); $cron$
    );
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
