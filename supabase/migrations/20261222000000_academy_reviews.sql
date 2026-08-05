-- Academy reviews — per-video and per-class buyer reviews.
--
-- 24h after a buyer first watches a video (opens the /watch page) or a
-- class wraps (start + duration), we email them a thank-you + a link to
-- leave a review. Reviews show on that video's / class's own public page
-- (like product reviews), gated by a per-braider "show reviews" toggle.
--
-- Reuses the appointment-review shape: a per-purchase review_token, a
-- review_request_sent_at guard, a due-sweep that enqueues the existing
-- 'review_request' notification (so the worker sends the same email), and
-- a token-gated public submit. Reviews land in a new academy_reviews
-- table, one per purchase.

begin;

-- 1. Tracking columns on the purchases ────────────────────────────────
alter table public.video_purchases
  add column if not exists first_watched_at       timestamptz,
  add column if not exists review_token           text,
  add column if not exists review_request_sent_at timestamptz,
  add column if not exists review_submitted_at    timestamptz;

alter table public.class_registrations
  add column if not exists review_token           text,
  add column if not exists review_request_sent_at timestamptz,
  add column if not exists review_submitted_at    timestamptz;

create unique index if not exists video_purchases_review_token_idx
  on public.video_purchases (review_token) where review_token is not null;
create unique index if not exists class_registrations_review_token_idx
  on public.class_registrations (review_token) where review_token is not null;

-- 2. Per-braider public toggle ────────────────────────────────────────
alter table public.profiles
  add column if not exists academy_reviews_public boolean not null default true;

-- 3. The reviews table ────────────────────────────────────────────────
create table if not exists public.academy_reviews (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  item_kind    text not null check (item_kind in ('video','class')),
  video_id     uuid references public.video_lessons(id) on delete cascade,
  class_id     uuid references public.class_offerings(id) on delete cascade,
  purchase_id  uuid not null,
  stars        integer not null check (stars between 1 and 5),
  notes        text,
  display_name text,
  status       text not null default 'visible' check (status in ('visible','hidden')),
  submitted_at timestamptz not null default now(),
  unique (item_kind, purchase_id)
);
create index if not exists academy_reviews_video_idx on public.academy_reviews (video_id) where status = 'visible';
create index if not exists academy_reviews_class_idx on public.academy_reviews (class_id) where status = 'visible';

alter table public.academy_reviews enable row level security;
-- Braider reads their own reviews (moderation later); public read goes
-- through the SECURITY DEFINER RPCs below, never direct table access.
drop policy if exists academy_reviews_owner_read on public.academy_reviews;
create policy academy_reviews_owner_read on public.academy_reviews
  for select using (auth.uid() = user_id);

-- 4. Review-page context — what is this token for? ────────────────────
create or replace function public.academy_review_context(token_in text)
returns table (kind text, item_title text, studio_name text, already_reviewed boolean)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_user uuid; v_kind text; v_title text; v_submitted timestamptz;
begin
  select 'video', vp.user_id, vl.title, vp.review_submitted_at
    into v_kind, v_user, v_title, v_submitted
    from public.video_purchases vp
    join public.video_lessons vl on vl.id = vp.video_id
    where vp.review_token = token_in and vp.status = 'paid'
    limit 1;
  if v_user is null then
    select 'class', cr.user_id, co.title, cr.review_submitted_at
      into v_kind, v_user, v_title, v_submitted
      from public.class_registrations cr
      join public.class_offerings co on co.id = cr.class_id
      where cr.review_token = token_in and cr.status = 'paid'
      limit 1;
  end if;
  if v_user is null then
    return;
  end if;
  return query select
    v_kind,
    v_title,
    coalesce(nullif(btrim(public.public_get_studio_name(v_user)), ''), 'your braider'),
    (v_submitted is not null);
end $$;
revoke all on function public.academy_review_context(text) from public;
grant execute on function public.academy_review_context(text) to anon, authenticated;

-- 5. Token-gated public submit ────────────────────────────────────────
create or replace function public.submit_academy_review_by_token(
  token_in text, stars_in integer, notes_in text default null, display_name_in text default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_user uuid; v_kind text; v_video uuid; v_class uuid; v_purchase uuid; v_submitted timestamptz;
begin
  if stars_in is null or stars_in < 1 or stars_in > 5 then
    return jsonb_build_object('ok', false, 'error', 'Please choose a star rating.');
  end if;

  select 'video', vp.user_id, vp.video_id, null::uuid, vp.id, vp.review_submitted_at
    into v_kind, v_user, v_video, v_class, v_purchase, v_submitted
    from public.video_purchases vp
    where vp.review_token = token_in and vp.status = 'paid' limit 1;
  if v_user is null then
    select 'class', cr.user_id, null::uuid, cr.class_id, cr.id, cr.review_submitted_at
      into v_kind, v_user, v_video, v_class, v_purchase, v_submitted
      from public.class_registrations cr
      where cr.review_token = token_in and cr.status = 'paid' limit 1;
  end if;
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'This review link is not valid.');
  end if;
  if v_submitted is not null then
    return jsonb_build_object('ok', false, 'error', 'You have already left a review — thank you!');
  end if;

  insert into public.academy_reviews
    (user_id, item_kind, video_id, class_id, purchase_id, stars, notes, display_name)
  values
    (v_user, v_kind, v_video, v_class, v_purchase, stars_in,
     nullif(btrim(notes_in), ''), nullif(btrim(display_name_in), ''))
  on conflict (item_kind, purchase_id) do nothing;

  if v_kind = 'video' then
    update public.video_purchases set review_submitted_at = now() where id = v_purchase;
  else
    update public.class_registrations set review_submitted_at = now() where id = v_purchase;
  end if;

  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.submit_academy_review_by_token(text, integer, text, text) from public;
grant execute on function public.submit_academy_review_by_token(text, integer, text, text) to anon, authenticated;

-- 6. Public reads — reviews for a video / class page (toggle-gated) ────
create or replace function public.public_video_reviews(slug_in text, video_slug_in text)
returns table (stars integer, notes text, display_name text, submitted_at timestamptz)
language sql security definer set search_path = public, pg_temp
as $$
  select ar.stars, ar.notes, ar.display_name, ar.submitted_at
  from public.booking_links bl
  join public.profiles p on p.id = bl.user_id
  join public.video_lessons vl on vl.user_id = bl.user_id and vl.slug = video_slug_in
  join public.academy_reviews ar on ar.video_id = vl.id and ar.status = 'visible'
  where bl.slug = slug_in and bl.active = true
    and coalesce(p.academy_reviews_public, true) = true
  order by ar.submitted_at desc
  limit 100;
$$;
revoke all on function public.public_video_reviews(text, text) from public;
grant execute on function public.public_video_reviews(text, text) to anon, authenticated;

create or replace function public.public_class_reviews(slug_in text, class_slug_in text)
returns table (stars integer, notes text, display_name text, submitted_at timestamptz)
language sql security definer set search_path = public, pg_temp
as $$
  select ar.stars, ar.notes, ar.display_name, ar.submitted_at
  from public.booking_links bl
  join public.profiles p on p.id = bl.user_id
  join public.class_offerings co on co.user_id = bl.user_id and co.slug = class_slug_in
  join public.academy_reviews ar on ar.class_id = co.id and ar.status = 'visible'
  where bl.slug = slug_in and bl.active = true
    and coalesce(p.academy_reviews_public, true) = true
  order by ar.submitted_at desc
  limit 100;
$$;
revoke all on function public.public_class_reviews(text, text) from public;
grant execute on function public.public_class_reviews(text, text) to anon, authenticated;

-- 7. Due-sweep — enqueue the 24h review-request emails ────────────────
create or replace function public.enqueue_due_academy_review_requests()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  enqueued int := 0;
  app_base text;
  rec record;
  studio_name text;
  tok text;
begin
  app_base := coalesce(nullif(current_setting('app.public_url', true), ''), 'https://braidbosspro.app');

  -- Videos: 24h after first watch.
  for rec in
    select vp.id, vp.user_id, vp.buyer_email, vp.buyer_name, vp.review_token, vp.first_watched_at, vl.title
    from public.video_purchases vp
    join public.video_lessons vl on vl.id = vp.video_id
    where vp.status = 'paid'
      and vp.review_request_sent_at is null
      and vp.buyer_email is not null and vp.buyer_email <> ''
      and vp.first_watched_at is not null
      and now() >= vp.first_watched_at + interval '24 hours'
    limit 200
  loop
    if rec.first_watched_at < now() - interval '30 days' then
      update public.video_purchases set review_request_sent_at = now() where id = rec.id;
      continue;
    end if;
    tok := rec.review_token;
    if tok is null then
      tok := replace(replace(replace(encode(gen_random_bytes(18), 'base64'), '+', '-'), '/', '_'), '=', '');
      update public.video_purchases set review_token = tok where id = rec.id;
    end if;
    studio_name := coalesce(nullif(btrim(public.public_get_studio_name(rec.user_id)), ''), 'your braider');
    begin
      perform public.queue_notification(
        user_id_in           => rec.user_id,
        channel_in           => 'email',
        notification_type_in => 'review_request',
        body_in              => 'Thanks again for your purchase! How was "' || rec.title || '"? Leave a quick review.',
        subject_in           => 'How was "' || rec.title || '"?',
        recipient_email_in   => rec.buyer_email,
        recipient_name_in    => rec.buyer_name,
        payload_in           => jsonb_build_object(
          'clientName',  coalesce(rec.buyer_name, 'there'),
          'studioName',  studio_name,
          'serviceName', rec.title,
          'reviewUrl',   app_base || '/review/academy/' || tok
        ),
        dedupe_key_in        => 'academy_review_video:' || rec.id
      );
      update public.video_purchases set review_request_sent_at = now() where id = rec.id;
      enqueued := enqueued + 1;
    exception when others then null;
    end;
  end loop;

  -- Classes: 24h after class end (start + duration).
  for rec in
    select cr.id, cr.user_id, cr.student_email, cr.student_name, cr.review_token, co.title,
           (co.starts_at + make_interval(mins => coalesce(co.duration_minutes, 0))) as end_ts
    from public.class_registrations cr
    join public.class_offerings co on co.id = cr.class_id
    where cr.status = 'paid'
      and cr.review_request_sent_at is null
      and cr.student_email is not null and cr.student_email <> ''
      and co.starts_at is not null
      and now() >= (co.starts_at + make_interval(mins => coalesce(co.duration_minutes, 0))) + interval '24 hours'
    limit 200
  loop
    if rec.end_ts < now() - interval '30 days' then
      update public.class_registrations set review_request_sent_at = now() where id = rec.id;
      continue;
    end if;
    tok := rec.review_token;
    if tok is null then
      tok := replace(replace(replace(encode(gen_random_bytes(18), 'base64'), '+', '-'), '/', '_'), '=', '');
      update public.class_registrations set review_token = tok where id = rec.id;
    end if;
    studio_name := coalesce(nullif(btrim(public.public_get_studio_name(rec.user_id)), ''), 'your braider');
    begin
      perform public.queue_notification(
        user_id_in           => rec.user_id,
        channel_in           => 'email',
        notification_type_in => 'review_request',
        body_in              => 'Thanks again for joining "' || rec.title || '"! Leave a quick review.',
        subject_in           => 'How was "' || rec.title || '"?',
        recipient_email_in   => rec.student_email,
        recipient_name_in    => rec.student_name,
        payload_in           => jsonb_build_object(
          'clientName',  coalesce(rec.student_name, 'there'),
          'studioName',  studio_name,
          'serviceName', rec.title,
          'reviewUrl',   app_base || '/review/academy/' || tok
        ),
        dedupe_key_in        => 'academy_review_class:' || rec.id
      );
      update public.class_registrations set review_request_sent_at = now() where id = rec.id;
      enqueued := enqueued + 1;
    exception when others then null;
    end;
  end loop;

  return enqueued;
end $$;
revoke all on function public.enqueue_due_academy_review_requests() from public;
grant execute on function public.enqueue_due_academy_review_requests() to service_role;

-- 8. Schedule the sweep every 15 minutes ──────────────────────────────
create extension if not exists pg_cron;
do $$
declare jid bigint;
begin
  select jobid into jid from cron.job where jobname = 'academy_review_requests_sweep';
  if jid is not null then perform cron.unschedule(jid); end if;
end $$;
select cron.schedule(
  'academy_review_requests_sweep',
  '*/15 * * * *',
  $cron$ select public.enqueue_due_academy_review_requests(); $cron$
);

commit;
