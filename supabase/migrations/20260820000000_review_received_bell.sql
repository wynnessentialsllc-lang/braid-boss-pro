-- Add an in-app bell notification when a client submits a review.
--
-- The existing review_received email (20260730000000_review_received_notification.sql)
-- only sends an outbound email. The mirror_client_email_to_notifications
-- trigger explicitly skips stylist-addressed emails so the same row
-- isn't both an outbound and a bell entry. That means review_received
-- currently produces no bell.
--
-- Fix: insert a 'reviews' category row into public.notifications
-- alongside the email enqueue, deduped per appointment.

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
    row_appt.id,
    row_appt.user_id,
    stars_in,
    v_notes,
    would_book_again_in,
    nullif(left(trim(coalesce(private_feedback_in, '')), 4000), ''),
    v_display,
    'pending',
    now(),
    now()
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
    -- Outbound email to the stylist (unchanged from prior migration).
    begin
      v_base := coalesce(
        nullif(current_setting('app.public_url', true), ''),
        'https://braidbosspro.app'
      );
      v_studio := coalesce(
        nullif(trim(public.public_get_studio_name(row_appt.user_id)), ''),
        'your studio'
      );
      select email into v_email from auth.users where id = row_appt.user_id;

      perform public.queue_notification(
        user_id_in           => row_appt.user_id,
        channel_in           => 'email',
        notification_type_in => 'review_received',
        body_in              => coalesce(v_display, 'A client')
                                || ' left a ' || stars_in || '-star review.',
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
    exception when others then
      null;
    end;

    -- In-app bell entry. Deterministic id per appointment prevents
    -- duplicate bell rows even if this function is invoked twice.
    begin
      insert into public.notifications (
        id, user_id, category, title, body, data
      ) values (
        'review:' || row_appt.id::text,
        row_appt.user_id,
        'reviews',
        'New ' || stars_in || '-star review',
        coalesce(v_display, 'A client') || ' left a ' || stars_in
          || '-star review' ||
          case when v_notes is not null then ': "' || left(v_notes, 140) || '"' else '.' end,
        jsonb_build_object(
          'appointmentId', row_appt.id,
          'clientName',    coalesce(v_display, 'A client'),
          'stars',         stars_in,
          'reviewText',    coalesce(v_notes, ''),
          'serviceName',   row_appt.style
        )
      )
      on conflict (id) do nothing;
    exception when others then
      null;
    end;
  end if;

  return jsonb_build_object('ok', true);
end;
$function$;
