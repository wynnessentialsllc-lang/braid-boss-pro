-- Auto-push every stylist-addressed notification_queue row.
--
-- Existing pattern:
--   • notification_queue is the one-stop pipeline for outbound
--     transactional notifications (email + sms).
--   • Stylist-addressed rows (recipient_email == the stylist's own
--     auth.users.email) cover review_received, stylist_booking_*,
--     contract_signed_owner_alert, etc. The trigger
--     mirror_client_email_to_notifications already SKIPS these
--     because the stylist is the inbox.
--   • For web push, we want the OPPOSITE — fire a push for
--     stylist-addressed rows so the OS-level banner pops on the
--     stylist's phone/desktop.
--
-- This trigger does exactly that, and only that:
--   1. Channel == 'email' (we don't push for SMS rows).
--   2. recipient_email present and case-insensitively equal to the
--      stylist's auth.users.email.
--   3. Calls public.internal_send_push() with subject/body trimmed
--      for a notification banner.
--
-- Best-effort: any failure (no push subs, vault secret unset,
-- network blip) silently no-ops. Never blocks the queue insert.

create or replace function public.push_stylist_addressed_email()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_stylist_email text;
  v_title         text;
  v_body          text;
  v_tag           text;
begin
  if NEW.channel <> 'email' then return NEW; end if;
  if NEW.recipient_email is null or trim(NEW.recipient_email) = '' then
    return NEW;
  end if;

  begin
    select email into v_stylist_email from auth.users where id = NEW.user_id;
  exception when others then
    v_stylist_email := null;
  end;
  if v_stylist_email is null
     or lower(NEW.recipient_email) <> lower(v_stylist_email) then
    return NEW;  -- not addressed to the stylist; nothing to push
  end if;

  -- Subject is designed for an email subject line — typically
  -- short enough to use as a push title verbatim. Trim hard cap
  -- so iOS / Android banners don't truncate awkwardly.
  v_title := nullif(left(trim(coalesce(NEW.subject, '')), 60), '');
  if v_title is null then v_title := 'Braid Boss Pro'; end if;

  v_body := nullif(left(trim(coalesce(NEW.body, '')), 160), '');
  if v_body is null then v_body := ''; end if;

  -- Tag groups related pushes so the OS replaces older instances
  -- of the same type (no banner pile-up). Per-appointment is the
  -- most natural grouping when an appointment_id is present.
  v_tag := coalesce(NEW.notification_type, 'bbp_notification');
  if NEW.appointment_id is not null then
    v_tag := v_tag || ':' || NEW.appointment_id::text;
  end if;

  begin
    perform public.internal_send_push(
      target_user => NEW.user_id,
      title_in    => v_title,
      body_in     => v_body,
      url_in      => '/',
      tag_in      => v_tag
    );
  exception when others then
    null;
  end;

  return NEW;
end;
$function$;

drop trigger if exists trg_push_stylist_addressed on public.notification_queue;
create trigger trg_push_stylist_addressed
  after insert on public.notification_queue
  for each row execute function public.push_stylist_addressed_email();

-- Now that every stylist-addressed queue row auto-pushes, drop the
-- explicit internal_send_push call added in the previous migration
-- for submit_review_by_token — otherwise reviews would push twice
-- (once from the RPC, once from the trigger firing on the same
-- queue_notification insert).

create or replace function public.submit_review_by_token(
  token_in            text,
  stars_in            smallint,
  review_text_in      text    default null,
  would_book_again_in boolean default null,
  private_feedback_in text    default null,
  display_name_in     text    default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  row_appt  public.appointments;
  v_existed boolean := false;
  v_notes   text;
  v_display text;
  v_studio  text;
  v_email   text;
  v_base    text;
begin
  if token_in is null or trim(token_in) = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_token');
  end if;
  if stars_in is null or stars_in < 1 or stars_in > 5 then
    return jsonb_build_object('ok', false, 'reason', 'bad_stars');
  end if;

  select * into row_appt from public.appointments
    where review_request_token = token_in limit 1;
  if row_appt.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if coalesce(row_appt.status, '') in
       ('cancelled', 'no-show', 'no_show', 'noshow', 'declined') then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_notes   := nullif(left(trim(coalesce(review_text_in, '')), 4000), '');
  v_display := nullif(left(trim(coalesce(display_name_in, '')), 80), '');

  select exists(
    select 1 from public.appointment_reviews where appointment_id = row_appt.id
  ) into v_existed;

  insert into public.appointment_reviews (
    appointment_id, user_id, stars, notes,
    would_book_again, private_feedback, display_name,
    status, submitted_at, updated_at
  ) values (
    row_appt.id, row_appt.user_id, stars_in, v_notes,
    would_book_again_in,
    nullif(left(trim(coalesce(private_feedback_in, '')), 4000), ''),
    v_display, 'pending', now(), now()
  )
  on conflict (appointment_id) do update
    set stars            = excluded.stars,
        notes            = excluded.notes,
        would_book_again = excluded.would_book_again,
        private_feedback = excluded.private_feedback,
        display_name     = excluded.display_name,
        status           = 'pending',
        submitted_at     = now(),
        updated_at       = now();

  if not v_existed then
    -- Email (will also fire push via trg_push_stylist_addressed).
    begin
      v_base := coalesce(nullif(current_setting('app.public_url', true), ''), 'https://braidbosspro.app');
      v_studio := coalesce(nullif(trim(public.public_get_studio_name(row_appt.user_id)), ''), 'your studio');
      select email into v_email from auth.users where id = row_appt.user_id;
      perform public.queue_notification(
        user_id_in           => row_appt.user_id,
        channel_in           => 'email',
        notification_type_in => 'review_received',
        body_in              => coalesce(v_display, 'A client') || ' left a ' || stars_in || '-star review.',
        subject_in           => 'New ' || stars_in || '-star review',
        recipient_email_in   => v_email,
        recipient_name_in    => v_studio,
        payload_in           => jsonb_build_object(
          'clientName',  coalesce(v_display, 'A client'),
          'studioName',  v_studio,
          'serviceName', row_appt.style,
          'stars',       stars_in,
          'reviewText',  coalesce(v_notes, ''),
          'appUrl',      v_base
        ),
        dedupe_key_in        => 'review_received:' || row_appt.id
      );
    exception when others then null; end;

    -- In-app bell entry.
    begin
      insert into public.notifications (id, user_id, category, title, body, data) values (
        'review:' || row_appt.id::text,
        row_appt.user_id,
        'reviews',
        'New ' || stars_in || '-star review',
        coalesce(v_display, 'A client') || ' left a ' || stars_in || '-star review' ||
          case when v_notes is not null then ': "' || left(v_notes, 140) || '"' else '.' end,
        jsonb_build_object(
          'appointmentId', row_appt.id,
          'clientName', coalesce(v_display, 'A client'),
          'stars', stars_in,
          'reviewText', coalesce(v_notes, ''),
          'serviceName', row_appt.style
        )
      ) on conflict (id) do nothing;
    exception when others then null; end;
  end if;

  return jsonb_build_object('ok', true);
end;
$function$;
