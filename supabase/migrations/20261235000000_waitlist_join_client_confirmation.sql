-- Client-facing "you're on the waitlist" confirmations.
--
-- Until now a waitlist join was acknowledged on-screen only. The
-- stylist got a bell + email + push (migration 20261110), but the
-- person who joined got nothing in writing — no record of what they
-- asked for, and nothing to reply to. Both public waitlists now send
-- the joiner a branded confirmation email:
--
--   * booking waitlist  (public.waitlist_requests)  -> waitlist_join_client
--   * class waitlist    (public.class_waitlist)     -> class_waitlist_join_client
--
-- Email only, deliberately: SMS burns the stylist's credits and is
-- gated behind their master switch, and the last-minute-opening
-- broadcast (the other client-facing waitlist message) is email-only
-- for the same reason.
--
-- Both sends are best-effort — every failure is swallowed so a
-- notification hiccup can never stop someone landing on the list.
--
-- Delivery notes:
--   * These rows are client-addressed, so trg_push_stylist_addressed
--     (20260822) skips them — no duplicate push at the stylist.
--   * mirror_client_email_to_notifications (20260808) mirrors them to
--     the stylist's bell as "Email sent", exactly like every other
--     client-addressed email.
--   * The email worker renders both types; until it is redeployed they
--     fall through to its branded generic renderer, so nothing breaks.

begin;

-- ---------------------------------------------------------------------
-- Shared enqueue helper for client-addressed emails on public flows.
--
-- queue_notification() enforces `auth.uid() = user_id`, which a public
-- visitor can never satisfy: an anon joiner has no uid, and a signed-in
-- visitor who isn't the studio owner would trip the user_mismatch
-- raise. The stylist-facing waitlist trigger gets away with it because
-- that insert arrives over the service role, but the class waitlist RPC
-- is called straight from the browser. So client confirmations enqueue
-- directly here — same table, same dedupe contract, same downstream
-- triggers (push + bell mirror) — just without the caller check.
--
-- Email-only by construction, so none of queue_notification's SMS
-- handling is skipped. communication_logs mirroring is unaffected too:
-- it happens worker-side in mark_notification_sent().
--
-- Returns true only when a row was actually enqueued (false on a
-- missing/invalid recipient, a dedupe hit, or any error).
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
  return false;  -- never block the join that triggered this
end;
$$;

-- Internal only — reached through the SECURITY DEFINER triggers below,
-- never called directly by a client (that would be an open mail relay).
revoke all on function public.queue_client_confirmation_email(uuid, text, text, text, text, text, jsonb, text) from public;

-- ---------------------------------------------------------------------
-- Booking waitlist — re-created from 20261110000000 with one addition:
-- step 3, the client's own confirmation. Steps 1 + 2 (the stylist's
-- bell and email) are unchanged.
-- ---------------------------------------------------------------------
create or replace function public.waitlist_requests_notify_joined()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_owner_email text;
  v_studio      text;
  v_who         text;
  v_when        text;
  v_flex        text;
  v_contact     text;
  v_summary     text;
  v_body        text;
  v_slug        text;
  v_book_url    text;
  v_when_client text;
begin
  -- Public joins only — skip the owner's manual adds.
  if not coalesce(NEW.created_from_public, false) then
    return NEW;
  end if;

  v_studio := public.style_request_studio_name(NEW.user_id);

  begin
    select email into v_owner_email from auth.users where id = NEW.user_id;
  exception when others then
    v_owner_email := null;
  end;

  v_who  := coalesce(nullif(trim(NEW.client_name), ''), 'Someone');
  v_when := nullif(trim(concat_ws(' at ',
              NEW.preferred_date::text,
              nullif(trim(coalesce(NEW.preferred_time, '')), ''))), '');
  v_flex := case NEW.flexibility
              when 'anytime'   then 'Anytime that day'
              when 'morning'   then 'Mornings'
              when 'afternoon' then 'Afternoons'
              when 'evening'   then 'Evenings'
              when 'specific'  then 'A specific time'
              else null
            end;
  v_contact := nullif(concat_ws(' · ',
                 nullif(trim(coalesce(NEW.client_phone, '')), ''),
                 nullif(trim(coalesce(NEW.client_email, '')), '')), '');
  -- One-line "what + when + how flexible" used for the bell + push body.
  v_summary := coalesce(
                 nullif(concat_ws(' · ',
                   nullif(trim(coalesce(NEW.service_name, '')), ''),
                   v_when, v_flex), ''),
                 'Tap to review the request.');

  -- 1) In-app bell entry for the stylist.
  begin
    insert into public.notifications (id, user_id, category, title, body, data)
    values (
      'waitlist:' || NEW.id::text,
      NEW.user_id,
      'waitlist',
      v_who || ' joined your waitlist',
      v_summary,
      jsonb_build_object(
        'waitlistRequestId', NEW.id,
        'clientName',        NEW.client_name,
        'serviceName',       NEW.service_name,
        'preferredDate',     NEW.preferred_date,
        'preferredTime',     NEW.preferred_time,
        'flexibility',       NEW.flexibility
      )
    )
    on conflict (id) do nothing;
  exception when others then
    null;  -- never block the insert
  end;

  -- 2) Stylist email — "someone joined your waitlist". Queuing this row
  --    (channel 'email', recipient = the stylist's own email) ALSO fires
  --    the OS web push automatically via trg_push_stylist_addressed, so
  --    no separate internal_send_push() call is needed (or wanted).
  if v_owner_email is not null and position('@' in v_owner_email) > 0 then
    v_body :=
      v_who || ' just joined your waitlist.' || chr(10) || chr(10) ||
      case when nullif(trim(coalesce(NEW.service_name, '')), '') is not null
           then 'Service: ' || NEW.service_name || chr(10) else '' end ||
      case when v_when is not null then 'Preferred: ' || v_when || chr(10) else '' end ||
      case when v_flex is not null then 'Flexibility: ' || v_flex || chr(10) else '' end ||
      case when v_contact is not null then 'Contact: ' || v_contact || chr(10) else '' end ||
      case when nullif(trim(coalesce(NEW.notes, '')), '') is not null
           then chr(10) || 'Notes: ' || NEW.notes || chr(10) else '' end ||
      chr(10) || 'Open Braid Boss Pro -> Waitlist to reach out or book them in.';
    begin
      perform public.queue_notification(
        user_id_in           => NEW.user_id,
        channel_in           => 'email',
        notification_type_in => 'waitlist_join_owner',
        body_in              => v_body,
        subject_in           => v_who || ' joined your waitlist',
        recipient_email_in   => v_owner_email,
        recipient_name_in    => v_studio,
        payload_in           => jsonb_build_object('waitlistRequestId', NEW.id),
        dedupe_key_in        => 'waitlist_join_owner:' || NEW.id::text
      );
    exception when others then
      null;
    end;
  end if;

  -- (Web push is handled automatically by trg_push_stylist_addressed on
  --  the email row queued above — see the header note.)

  -- 3) Client confirmation — "you're on the waitlist". Email is optional
  --    on this form (only a name is required), so this is a no-op for
  --    anyone who joined without one.
  if NEW.client_email is not null and position('@' in NEW.client_email) > 0 then
    -- Public booking page URL for the "browse open times" CTA. Same
    -- resolution order the outreach/SMS senders use.
    begin
      select coalesce(bl.slug, p.public_slug)
        into v_slug
        from public.profiles p
        left join public.booking_links bl
               on bl.user_id = p.id and bl.active = true
       where p.id = NEW.user_id
       limit 1;
    exception when others then
      v_slug := null;
    end;
    v_book_url := case
      when nullif(trim(coalesce(v_slug, '')), '') is not null
        then 'https://braidbosspro.app/book/' || v_slug
      else null
    end;

    -- The stylist's copy keeps the raw ISO date it has always used; the
    -- client's reads MM/DD/YYYY, matching the HTML template (which runs
    -- preferredDate through the worker's fmtDate) so the plain-text
    -- alternative and the rendered email agree.
    v_when_client := nullif(trim(concat_ws(' at ',
                       to_char(NEW.preferred_date, 'MM/DD/YYYY'),
                       nullif(trim(coalesce(NEW.preferred_time, '')), ''))), '');

    v_body :=
      'You''re on ' || v_studio || '''s waitlist.' || chr(10) || chr(10) ||
      case when nullif(trim(coalesce(NEW.service_name, '')), '') is not null
           then 'Service: ' || NEW.service_name || chr(10) else '' end ||
      case when v_when_client is not null then 'Preferred: ' || v_when_client || chr(10) else '' end ||
      case when v_flex is not null then 'Flexibility: ' || v_flex || chr(10) else '' end ||
      chr(10) || v_studio || ' will reach out if an opening comes up that fits. ' ||
      'Nothing is booked yet — a waitlist spot isn''t an appointment.' ||
      case when v_book_url is not null
           then chr(10) || chr(10) || 'See open times: ' || v_book_url else '' end;

    perform public.queue_client_confirmation_email(
      user_id_in           => NEW.user_id,
      notification_type_in => 'waitlist_join_client',
      subject_in           => 'You''re on the waitlist — ' || v_studio,
      body_in              => v_body,
      recipient_email_in   => NEW.client_email,
      recipient_name_in    => nullif(trim(coalesce(NEW.client_name, '')), ''),
      payload_in           => jsonb_build_object(
        'clientName',    coalesce(nullif(trim(coalesce(NEW.client_name, '')), ''), 'there'),
        'studioName',    v_studio,
        'serviceName',   NEW.service_name,
        'preferredDate', NEW.preferred_date::text,
        'preferredTime', NEW.preferred_time,
        'flexibility',   v_flex,
        'bookUrl',       v_book_url
      ),
      dedupe_key_in        => 'waitlist_join_client:' || NEW.id::text
    );
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_waitlist_requests_notify_joined on public.waitlist_requests;
create trigger trg_waitlist_requests_notify_joined
  after insert on public.waitlist_requests
  for each row execute function public.waitlist_requests_notify_joined();

-- ---------------------------------------------------------------------
-- Class waitlist — new confirmation on public.class_waitlist.
--
-- public_join_class_waitlist() inserts `on conflict (class_id, email)
-- do nothing`, so a double submit never reaches this trigger and can't
-- double-send. The dedupe key is belt-and-braces for a row re-created
-- after a manual delete.
--
-- Client-facing only for now: the braider still has no join alert on
-- this list (they didn't have one before either) — that's a separate
-- change.
-- ---------------------------------------------------------------------
create or replace function public.class_waitlist_notify_joined()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_studio     text;
  v_title      text;
  v_class_slug text;
  v_starts     timestamptz;
  v_tz         text;
  v_when       text;
  v_handle     text;
  v_class_url  text;
  v_body       text;
begin
  if NEW.email is null or position('@' in NEW.email) = 0 then
    return NEW;
  end if;

  -- Academy-side copy says "braider", not "stylist" — swap the shared
  -- resolver's generic fallback so the email matches the class page.
  v_studio := public.style_request_studio_name(NEW.user_id);
  if v_studio = 'your stylist' then
    v_studio := 'your braider';
  end if;

  begin
    select co.title, co.slug, co.starts_at, co.timezone
      into v_title, v_class_slug, v_starts, v_tz
      from public.class_offerings co
     where co.id = NEW.class_id
     limit 1;
  exception when others then
    v_title := null;
  end;
  v_title := coalesce(nullif(trim(coalesce(v_title, '')), ''), 'the class');

  -- Render the start time in the timezone the braider set the class in,
  -- matching formatClassWhen() in the app ("Sep 2, 2026, 6:00 PM").
  -- A bad/unset IANA name falls back to UTC rather than raising.
  if v_starts is not null then
    begin
      v_when := to_char(v_starts at time zone coalesce(nullif(trim(coalesce(v_tz, '')), ''), 'UTC'),
                        'FMMon FMDD, YYYY, FMHH12:MI AM');
    exception when others then
      v_when := to_char(v_starts at time zone 'UTC', 'FMMon FMDD, YYYY, FMHH12:MI AM') || ' UTC';
    end;
  else
    v_when := 'Date to be announced';
  end if;

  -- Public class page lives at /u/<handle>/classes/<slug>, where the
  -- handle prefers the braider's branded slug.
  begin
    select coalesce(p.public_slug, bl.slug)
      into v_handle
      from public.profiles p
      left join public.booking_links bl
             on bl.user_id = p.id and bl.active = true
     where p.id = NEW.user_id
     limit 1;
  exception when others then
    v_handle := null;
  end;
  v_class_url := case
    when nullif(trim(coalesce(v_handle, '')), '') is not null
     and nullif(trim(coalesce(v_class_slug, '')), '') is not null
      then 'https://braidbosspro.app/u/' || v_handle || '/classes/' || v_class_slug
    else null
  end;

  v_body :=
    'You''re on the waitlist for ' || v_title || ' with ' || v_studio || '.' || chr(10) || chr(10) ||
    'When: ' || v_when || chr(10) || chr(10) ||
    'The class is full right now. If a seat frees up, ' || v_studio ||
    ' will email you at ' || NEW.email || '. Your seat isn''t reserved and you haven''t been charged.' ||
    case when v_class_url is not null
         then chr(10) || chr(10) || 'Class details: ' || v_class_url else '' end;

  perform public.queue_client_confirmation_email(
    user_id_in           => NEW.user_id,
    notification_type_in => 'class_waitlist_join_client',
    subject_in           => 'You''re on the waitlist — ' || v_title,
    body_in              => v_body,
    recipient_email_in   => NEW.email,
    recipient_name_in    => nullif(trim(coalesce(NEW.name, '')), ''),
    payload_in           => jsonb_build_object(
      'clientName', coalesce(nullif(trim(coalesce(NEW.name, '')), ''), 'there'),
      'studioName', v_studio,
      'classTitle', v_title,
      'whenLabel',  v_when,
      'classUrl',   v_class_url
    ),
    dedupe_key_in        => 'class_waitlist_join_client:' || NEW.id::text
  );

  return NEW;
exception when others then
  return NEW;  -- a notification hiccup must never fail the join
end;
$$;

drop trigger if exists trg_class_waitlist_notify_joined on public.class_waitlist;
create trigger trg_class_waitlist_notify_joined
  after insert on public.class_waitlist
  for each row execute function public.class_waitlist_notify_joined();

commit;
