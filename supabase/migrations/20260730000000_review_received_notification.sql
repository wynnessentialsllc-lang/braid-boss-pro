-- Notify the stylist by email when a client leaves a review.
--
-- submit_review_by_token (the anon, token-authenticated RPC behind
-- the public /review/<token> page) previously just upserted the
-- appointment_reviews row. Now, on a FIRST submission, it also
-- enqueues a 'review_received' email to the stylist via the
-- standard queue_notification path — the same queue the
-- process-notification-queue worker drains.
--
-- Design notes:
--   * First submission only. appointment_reviews is UNIQUE per
--     appointment, so a re-submit through the same token edits the
--     existing row — we detect that and do NOT re-notify.
--   * Best-effort. The enqueue is wrapped so any failure (missing
--     stylist email, etc.) can never block the review from saving.
--   * dedupe_key 'review_received:<appointment_id>' is a belt-and-
--     suspenders guard against a double enqueue.
--   * queue_notification's caller guard passes here: the public
--     page runs anon (auth.uid() is null), so the user_id/caller
--     mismatch check is skipped.

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

  -- New vs. edit — captured before the upsert.
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

  -- Stylist notification — first submission only, best-effort.
  if not v_existed then
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
      -- Never let a notification problem fail the review submission.
      null;
    end;
  end if;

  return jsonb_build_object('ok', true);
end;
$function$;
