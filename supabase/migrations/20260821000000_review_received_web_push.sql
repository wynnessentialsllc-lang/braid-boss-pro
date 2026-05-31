-- Internal SQL helper to dispatch a web push notification to a user
-- by calling the send-push edge function via pg_net.
--
-- Why this exists:
--   submit_review_by_token runs anonymously (anon JWT, no user
--   session). The send-push edge function normally requires a
--   user JWT. To bridge that, send-push accepts the project's
--   SUPABASE_SERVICE_ROLE_KEY as a Bearer token (internal call) and
--   trusts body.user_id. This SQL helper reads the service role key
--   from Supabase Vault and posts the request via pg_net.
--
-- Setup (one-time, done by the project owner — see SETUP_NOTES below):
--   select vault.create_secret(
--     '<your service role key>',
--     'send_push_service_key',
--     'Used by internal_send_push() to invoke send-push edge function'
--   );
--
-- Best-effort: any failure (missing secret, edge function down,
-- network blip) silently no-ops so it can never block the caller.

create or replace function public.internal_send_push(
  target_user uuid,
  title_in    text,
  body_in     text,
  url_in      text default '/',
  tag_in      text default null
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_secret  text;
  v_url     text := 'https://bjqazhplxqqhftekspfl.supabase.co/functions/v1/send-push';
  v_payload jsonb;
begin
  if target_user is null then return; end if;

  -- Read the service role key from vault. If the secret isn't
  -- configured yet, silently no-op so reviews still save and the
  -- email/bell paths still fire.
  begin
    select decrypted_secret into v_secret
      from vault.decrypted_secrets
      where name = 'send_push_service_key'
      limit 1;
  exception when others then
    v_secret := null;
  end;
  if v_secret is null or trim(v_secret) = '' then
    return;
  end if;

  v_payload := jsonb_build_object(
    'user_id', target_user,
    'payload', jsonb_build_object(
      'title', coalesce(title_in, 'Braid Boss Pro'),
      'body',  coalesce(body_in, ''),
      'tag',   tag_in,
      'data',  jsonb_build_object('url', coalesce(url_in, '/'))
    )
  );

  -- Fire-and-forget. pg_net.http_post returns immediately with a
  -- request id; the actual HTTP round-trip is async on the
  -- net.http_request_queue.
  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body    := v_payload
  );
exception when others then
  null;
end;
$function$;

revoke all on function public.internal_send_push(uuid, text, text, text, text) from public;
-- Only callable from SECURITY DEFINER SQL (no grants).

-- Extend submit_review_by_token to also dispatch a web push.
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
  v_push_body text;
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
    -- Outbound email (unchanged from prior migration).
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

    -- In-app bell entry.
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

    -- Web push (OS-level banner). No-op if send_push_service_key
    -- vault secret isn't configured yet — email and bell still fire.
    begin
      v_push_body := coalesce(v_display, 'A client') || ' left a ' ||
        stars_in || '-star review' ||
        case when v_notes is not null then ': "' || left(v_notes, 100) || '"' else '.' end;
      perform public.internal_send_push(
        target_user => row_appt.user_id,
        title_in    => 'New ' || stars_in || '-star review',
        body_in     => v_push_body,
        url_in      => '/?notification=reviews',
        tag_in      => 'review:' || row_appt.id::text
      );
    exception when others then
      null;
    end;
  end if;

  return jsonb_build_object('ok', true);
end;
$function$;
