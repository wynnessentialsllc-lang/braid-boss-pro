-- Braider Academy native video uploads (Phase 4).
--
-- Adds an alternative to pasting an external link: a braider can upload
-- a video file that we host in a PRIVATE Supabase Storage bucket and
-- serve only through short-lived signed URLs minted server-side for a
-- paid, unexpired buyer. The public storefront never sees the object
-- path, and the bucket has no public-read policy, so an uploaded lesson
-- can't be fetched without a fresh signed URL from /api/academy/watch.
--
--   video_lessons.source_type — 'link' (external URL, the default and
--     unchanged existing behavior) or 'upload' (hosted file).
--   video_lessons.storage_path — object path in academy-videos for an
--     uploaded lesson; null for link lessons.
--
-- Playback resolution moves to a service-role RPC (admin_get_video_access)
-- so the signing route can read the path; the anon public_get_video_access
-- is left intact for link lessons and simply returns a null url for
-- uploads (they resolve through the server route instead).

begin;

-- ── Columns ──────────────────────────────────────────────────────────
alter table public.video_lessons
  add column if not exists source_type text not null default 'link'
    check (source_type in ('link', 'upload')),
  add column if not exists storage_path text;

-- ── Private bucket ───────────────────────────────────────────────────
-- 500 MB per-object cap enforced by Storage itself (keeps hosting
-- predictable and playback smooth; longer videos should use a link).
-- Common phone/desktop container types only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'academy-videos', 'academy-videos', false, 524288000,
  array['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v']
)
on conflict (id) do update
  set public = false,
      file_size_limit = 524288000,
      allowed_mime_types = array['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'];

-- Owner-only CRUD, pinned to the {auth.uid()}/<file> folder. NO public
-- read policy — reads require a service-role signed URL.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='academy_videos_owner_insert') then
    create policy academy_videos_owner_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'academy-videos' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='academy_videos_owner_update') then
    create policy academy_videos_owner_update on storage.objects for update to authenticated
      using (bucket_id = 'academy-videos' and (storage.foldername(name))[1] = auth.uid()::text)
      with check (bucket_id = 'academy-videos' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='academy_videos_owner_delete') then
    create policy academy_videos_owner_delete on storage.objects for delete to authenticated
      using (bucket_id = 'academy-videos' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
  -- Owner can read their OWN objects (e.g. to preview in the dashboard).
  -- Buyers never read directly — they get a signed URL from the server.
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='academy_videos_owner_select') then
    create policy academy_videos_owner_select on storage.objects for select to authenticated
      using (bucket_id = 'academy-videos' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
end $$;

-- ── Service-role playback resolver ───────────────────────────────────
-- Full access details for a purchase token, including the storage path,
-- for the signing route. Service-role only (never granted to anon), so
-- the object path is never exposed to a browser — only the signed URL
-- the route returns is.
create or replace function public.admin_get_video_access(token_in text)
returns table (
  ok                boolean,
  reason            text,
  title             text,
  description       text,
  source_type       text,
  access_url        text,
  storage_path      text,
  access_model      text,
  access_expires_at timestamptz,
  buyer_name        text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  pur public.video_purchases%rowtype;
  vid public.video_lessons%rowtype;
begin
  if token_in is null or length(trim(token_in)) = 0 then
    return query select false, 'invalid_token', null::text, null::text, null::text, null::text, null::text, null::text, null::timestamptz, null::text;
    return;
  end if;
  select * into pur from public.video_purchases where access_token = token_in limit 1;
  if pur.id is null then
    return query select false, 'not_found', null::text, null::text, null::text, null::text, null::text, null::text, null::timestamptz, null::text;
    return;
  end if;
  if pur.status <> 'paid' then
    -- 'pending' is still confirming (poll); 'refunded'/'cancelled' access
    -- has been revoked and won't come back (don't poll — say so).
    return query select
      false,
      case when pur.status = 'pending' then 'not_paid' else 'revoked' end,
      null::text, null::text, null::text, null::text, null::text, null::text, null::timestamptz, null::text;
    return;
  end if;
  if pur.access_expires_at is not null and pur.access_expires_at < now() then
    return query select false, 'expired', null::text, null::text, null::text, null::text, null::text, null::text, pur.access_expires_at::timestamptz, null::text;
    return;
  end if;
  select * into vid from public.video_lessons where id = pur.video_id limit 1;
  return query
    select true, null::text, vid.title, vid.description, vid.source_type,
           vid.access_url, vid.storage_path, vid.access_model, pur.access_expires_at, pur.buyer_name;
end $$;

revoke all on function public.admin_get_video_access(text) from public;
grant execute on function public.admin_get_video_access(text) to service_role;

-- ── Reload PostgREST schema cache ────────────────────────────────────
notify pgrst, 'reload schema';

commit;
