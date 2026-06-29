-- Repair: a client left a review and the stylist got the email, but the
-- in-app bell stayed empty ("You're all caught up").
--
-- How the bell is supposed to fire: submit_review_by_token (the anon,
-- token-authenticated RPC behind the public /review/<token> page) does
-- two independent best-effort things on a FIRST submission —
--   1. enqueue a 'review_received' email via queue_notification, and
--   2. insert a 'reviews' row into public.notifications (the in-app bell
--      reads category = 'reviews' from that table).
-- Each lives in its own begin/exception block, so the email firing tells
-- us nothing about whether the bell insert ran. The reported symptom
-- (email arrived, no bell) means step 2 didn't land in production — most
-- likely the deployed function predates the bell insert, which was only
-- added in 20260820_review_received_bell.sql.
--
-- This migration does two things:
--   A. Re-asserts submit_review_by_token at its canonical definition
--      (identical to 20260822_push_all_stylist_notifications.sql) so the
--      bell insert is guaranteed present. Idempotent no-op if prod is
--      already current.
--   B. Best-effort backfills the missing bell rows for reviews submitted
--      in the last 30 days, so reviews that were swallowed by the bug
--      surface in the bell now. Deterministic id ('review:<appt_id>')
--      makes it dedupe cleanly against any rows the live function already
--      wrote. Wrapped so it can never abort the migration.

-- ---------------------------------------------------------------------
-- A. Canonical submit_review_by_token (email + bell, dedupe-safe).
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- B. Backfill missing bell rows for recent reviews (best-effort).
--    Scoped to the last 30 days so historical reviews the stylist has
--    already seen by email aren't resurfaced as fresh, unread alerts.
-- ---------------------------------------------------------------------
do $$
begin
  insert into public.notifications (id, user_id, category, title, body, data)
  select
    'review:' || ar.appointment_id::text,
    ar.user_id,
    'reviews',
    'New ' || ar.stars || '-star review',
    coalesce(ar.display_name, 'A client') || ' left a ' || ar.stars || '-star review' ||
      case when ar.notes is not null then ': "' || left(ar.notes, 140) || '"' else '.' end,
    jsonb_build_object(
      'appointmentId', ar.appointment_id,
      'clientName',    coalesce(ar.display_name, 'A client'),
      'stars',         ar.stars,
      'reviewText',    coalesce(ar.notes, '')
    )
  from public.appointment_reviews ar
  where ar.submitted_at >= now() - interval '30 days'
  on conflict (id) do nothing;
exception when others then
  -- Never let the backfill abort the migration. If it failed here, the
  -- live notifications insert path likely fails the same way — surface a
  -- hint rather than blocking the deploy.
  raise notice 'review bell backfill skipped: %', sqlerrm;
end $$;
