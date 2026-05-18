-- Client Love — automated post-appointment review requests + moderation.
--
-- Adds the missing pieces so client-submitted reviews become a real
-- moderated "Client Love" pipeline rather than analytics-only rows:
--
--   1. appointments  — secure per-appointment review_request_token
--      (so the public review link never exposes an internal id) plus
--      review_request_sent_at to guarantee one request per appointment.
--   2. appointment_reviews — moderation status (pending|featured|hidden),
--      "would book again", private feedback, client display name,
--      favorite flag. Stays UNIQUE(appointment_id) so re-submits edit.
--   3. Token-based anon RPCs to render + submit the review form.
--   4. Owner RPCs to list + moderate (feature / hide / favorite).
--   5. public_list_reviews recreated to also surface FEATURED client
--      reviews (with stars) alongside the existing manual testimonials.
--   6. enqueue_due_review_requests() + a pg_cron job (every 30 min)
--      mirroring enqueue_due_appointment_reminders: scans appointments
--      whose end time + 2h has passed, skips cancelled / no-show,
--      enqueues a 'review_request' email exactly once.

-- =====================================================================
-- 1. appointments — secure review token + one-shot guard
-- =====================================================================
alter table public.appointments
  add column if not exists review_request_token text,
  add column if not exists review_request_sent_at timestamptz;

update public.appointments
set review_request_token = encode(gen_random_bytes(18), 'hex')
where review_request_token is null;

create unique index if not exists appointments_review_request_token_idx
  on public.appointments (review_request_token)
  where review_request_token is not null;

create or replace function public.fn_set_review_request_token()
returns trigger
language plpgsql
as $$
begin
  if new.review_request_token is null then
    new.review_request_token := encode(gen_random_bytes(18), 'hex');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_review_request_token on public.appointments;
create trigger trg_set_review_request_token
  before insert or update on public.appointments
  for each row execute function public.fn_set_review_request_token();

-- =====================================================================
-- 2. appointment_reviews — moderation columns
-- =====================================================================
alter table public.appointment_reviews
  add column if not exists status text not null default 'pending',
  add column if not exists would_book_again boolean,
  add column if not exists private_feedback text,
  add column if not exists display_name text,
  add column if not exists is_favorite boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'appointment_reviews_status_chk'
  ) then
    alter table public.appointment_reviews
      add constraint appointment_reviews_status_chk
      check (status in ('pending', 'featured', 'hidden'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'appointment_reviews'
      and policyname = 'appointment_reviews_owner_update'
  ) then
    create policy appointment_reviews_owner_update
      on public.appointment_reviews for update
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

-- =====================================================================
-- 3. Token-based anon RPCs (render + submit the review form)
-- =====================================================================
create or replace function public.public_get_review_by_token(
  token_in text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row_appt public.appointments;
  studio   text;
  existing public.appointment_reviews;
begin
  if token_in is null or trim(token_in) = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_token');
  end if;

  -- Primary path: opaque review token (no internal id exposed).
  select * into row_appt from public.appointments
    where review_request_token = token_in limit 1;

  -- Backward-compat fallback: older transactional emails linked
  -- /review/<appointment_id> directly. Still honor those.
  if row_appt.id is null then
    select * into row_appt from public.appointments
      where id = token_in limit 1;
  end if;

  if row_appt.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if coalesce(row_appt.status, '') in
       ('cancelled', 'no-show', 'no_show', 'noshow', 'declined') then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  studio := public.public_get_studio_name(row_appt.user_id);
  select * into existing from public.appointment_reviews
    where appointment_id = row_appt.id;

  return jsonb_build_object(
    'ok', true,
    'studio_name', coalesce(studio, ''),
    'service_name', row_appt.style,
    'client_name', row_appt.client_name,
    'appt_date', row_appt.appt_date,
    'appt_time', row_appt.appt_time,
    'already_submitted', existing.id is not null,
    'existing_stars', existing.stars,
    'existing_text', existing.notes,
    'existing_would_book_again', existing.would_book_again,
    'existing_display_name', existing.display_name
  );
end;
$$;

revoke all on function public.public_get_review_by_token(text) from public;
grant execute on function public.public_get_review_by_token(text) to anon, authenticated;

create or replace function public.submit_review_by_token(
  token_in text,
  stars_in smallint,
  review_text_in text default null,
  would_book_again_in boolean default null,
  private_feedback_in text default null,
  display_name_in text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row_appt public.appointments;
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
    select * into row_appt from public.appointments
      where id = token_in limit 1;
  end if;
  if row_appt.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if coalesce(row_appt.status, '') in
       ('cancelled', 'no-show', 'no_show', 'noshow', 'declined') then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- New + edited submissions land back in 'pending' so nothing
  -- auto-publishes; the stylist re-moderates after any change.
  insert into public.appointment_reviews (
    appointment_id, user_id, stars, notes,
    would_book_again, private_feedback, display_name,
    status, submitted_at, updated_at
  ) values (
    row_appt.id,
    row_appt.user_id,
    stars_in,
    nullif(left(trim(coalesce(review_text_in, '')), 4000), ''),
    would_book_again_in,
    nullif(left(trim(coalesce(private_feedback_in, '')), 4000), ''),
    nullif(left(trim(coalesce(display_name_in, '')), 80), ''),
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

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.submit_review_by_token(text, smallint, text, boolean, text, text) from public;
grant execute on function public.submit_review_by_token(text, smallint, text, boolean, text, text) to anon, authenticated;

-- =====================================================================
-- 4. Owner moderation RPCs (list / feature / hide / favorite)
-- =====================================================================
create or replace function public.owner_list_client_reviews()
returns table (
  id uuid,
  appointment_id text,
  stars smallint,
  notes text,
  would_book_again boolean,
  private_feedback text,
  display_name text,
  status text,
  is_favorite boolean,
  submitted_at timestamptz,
  client_name text,
  service_name text,
  appt_date date
)
language sql
security definer
set search_path = public
as $$
  select ar.id, ar.appointment_id, ar.stars, ar.notes,
         ar.would_book_again, ar.private_feedback, ar.display_name,
         ar.status, ar.is_favorite, ar.submitted_at,
         a.client_name, a.style as service_name, a.appt_date
  from public.appointment_reviews ar
  left join public.appointments a
         on a.id = ar.appointment_id and a.user_id = ar.user_id
  where ar.user_id = auth.uid()
  order by
    case ar.status when 'pending' then 0 when 'featured' then 1 else 2 end,
    ar.is_favorite desc,
    ar.submitted_at desc;
$$;

revoke all on function public.owner_list_client_reviews() from public;
grant execute on function public.owner_list_client_reviews() to authenticated;

create or replace function public.set_client_review_status(
  review_id_in uuid,
  status_in text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  affected int;
begin
  if status_in not in ('pending', 'featured', 'hidden') then
    return jsonb_build_object('ok', false, 'reason', 'bad_status');
  end if;
  update public.appointment_reviews
    set status = status_in, updated_at = now()
    where id = review_id_in and user_id = auth.uid();
  get diagnostics affected = row_count;
  if affected = 0 then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.set_client_review_status(uuid, text) from public;
grant execute on function public.set_client_review_status(uuid, text) to authenticated;

create or replace function public.set_client_review_favorite(
  review_id_in uuid,
  favorite_in boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  affected int;
begin
  update public.appointment_reviews
    set is_favorite = coalesce(favorite_in, false), updated_at = now()
    where id = review_id_in and user_id = auth.uid();
  get diagnostics affected = row_count;
  if affected = 0 then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.set_client_review_favorite(uuid, boolean) from public;
grant execute on function public.set_client_review_favorite(uuid, boolean) to authenticated;

-- =====================================================================
-- 5. public_list_reviews — manual testimonials + FEATURED client
--    reviews (with stars). Return signature changes (adds `stars`),
--    so drop + recreate.
-- =====================================================================
drop function if exists public.public_list_reviews(text);

create function public.public_list_reviews(slug_in text)
returns table (
  id uuid,
  reviewer_name text,
  review_text text,
  service_name text,
  image_url text,
  is_featured boolean,
  is_verified_booking boolean,
  created_at timestamptz,
  stars smallint
)
language sql
security definer
set search_path = public
as $$
  with canon as (
    select bl.user_id
    from public.booking_links bl
    where bl.slug = public._resolve_slug_to_canonical(slug_in)
      and bl.active = true
    limit 1
  )
  select * from (
    select r.id, r.reviewer_name, r.review_text, r.service_name,
           r.image_url, r.is_featured, r.is_verified_booking,
           r.created_at, null::smallint as stars
    from public.public_reviews r
    where r.stylist_user_id = (select user_id from canon)
    union all
    select ar.id,
           coalesce(
             nullif(trim(ar.display_name), ''),
             split_part(coalesce(a.client_name, 'Guest'), ' ', 1)
           ) as reviewer_name,
           trim(ar.notes) as review_text,
           a.style as service_name,
           null::text as image_url,
           true as is_featured,
           true as is_verified_booking,
           ar.submitted_at as created_at,
           ar.stars
    from public.appointment_reviews ar
    join public.appointments a
      on a.id = ar.appointment_id and a.user_id = ar.user_id
    where ar.user_id = (select user_id from canon)
      and ar.status = 'featured'
      and coalesce(nullif(trim(ar.notes), ''), '') <> ''
  ) merged
  order by merged.is_featured desc, merged.created_at desc
  limit 24;
$$;

revoke all on function public.public_list_reviews(text) from public;
grant execute on function public.public_list_reviews(text) to anon, authenticated;

-- =====================================================================
-- 6. enqueue_due_review_requests() + pg_cron (every 30 min)
-- =====================================================================
-- Scans appointments whose computed end time (appt_date + appt_time +
-- duration_hours) + 2h has passed. Skips cancelled / no-show / declined
-- and rows with no client email. Sends exactly once via the
-- review_request_sent_at guard + a 'review_request:<id>' dedupe key.
-- Appointments that ended more than 14 days ago are marked sent
-- WITHOUT emailing so the historical backlog isn't blasted on the
-- first run and the scan stays cheap.
create or replace function public.enqueue_due_review_requests()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  enqueued int := 0;
  app_base text;
  a        public.appointments%rowtype;
  studio_name text;
  end_ts   timestamp;
begin
  app_base := coalesce(
    nullif(current_setting('app.public_url', true), ''),
    'https://braidbosspro.app'
  );

  for a in
    select * from public.appointments
    where coalesce(status, '') not in
            ('cancelled', 'no-show', 'no_show', 'noshow', 'declined')
      and client_email is not null and client_email <> ''
      and appt_date is not null and appt_time is not null
      and review_request_sent_at is null
      and review_request_token is not null
      and coalesce(kind, 'appointment') = 'appointment'
      and coalesce(is_all_day, false) = false
  loop
    begin
      end_ts := (a.appt_date::text || ' ' || a.appt_time)::timestamp
                + (coalesce(a.duration_hours, 0)::text || ' hours')::interval;
    exception when others then
      continue;
    end;

    if now() < end_ts + interval '2 hours' then
      continue;
    end if;

    if end_ts < now() - interval '14 days' then
      update public.appointments
        set review_request_sent_at = now()
        where id = a.id and user_id = a.user_id;
      continue;
    end if;

    studio_name := coalesce(
      nullif(trim(public.public_get_studio_name(a.user_id)), ''),
      'your stylist'
    );

    begin
      perform public.queue_notification(
        user_id_in           => a.user_id,
        channel_in           => 'email',
        notification_type_in => 'review_request',
        body_in              => 'How was your appointment? Leave a quick review.',
        subject_in           => 'How was your appointment?',
        recipient_email_in   => a.client_email,
        recipient_name_in    => a.client_name,
        payload_in           => jsonb_build_object(
          'clientName',  coalesce(a.client_name, 'there'),
          'studioName',  studio_name,
          'serviceName', a.style,
          'reviewUrl',   app_base || '/review/' || a.review_request_token
        ),
        dedupe_key_in        => 'review_request:' || a.id,
        appointment_id_in    => a.id
      );
      update public.appointments
        set review_request_sent_at = now()
        where id = a.id and user_id = a.user_id;
      enqueued := enqueued + 1;
    exception when others then null;
    end;
  end loop;

  return enqueued;
end;
$$;

revoke all on function public.enqueue_due_review_requests() from public;
grant execute on function public.enqueue_due_review_requests() to service_role;

do $$
declare jid bigint;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    select jobid into jid from cron.job
      where jobname = 'enqueue_review_requests_every_30m';
    if jid is not null then
      perform cron.unschedule(jid);
    end if;
    perform cron.schedule(
      'enqueue_review_requests_every_30m',
      '*/30 * * * *',
      $cron$ select public.enqueue_due_review_requests(); $cron$
    );
  end if;
end $$;

notify pgrst, 'reload schema';
