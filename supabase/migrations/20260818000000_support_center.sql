-- Support Center — bug reports, feature requests, release notes, and a
-- screenshot bucket. Backs Settings → Support.
--
-- RLS: a stylist can file and read their OWN bug reports; feature
-- requests are readable by all authenticated users (so the future
-- voting UI can list them) but only insertable as yourself. Release
-- notes are world-readable when published and only written via the
-- service role / SQL (no client insert path).

-- ---- Bug reports ----------------------------------------------------
create table if not exists public.support_bug_reports (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  title          text not null,
  description    text,
  device         text,
  browser        text,
  screenshot_url text,
  status         text not null default 'open',
  created_at     timestamptz not null default now()
);
alter table public.support_bug_reports enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='support_bug_reports' and policyname='bug_reports_owner_insert') then
    create policy bug_reports_owner_insert on public.support_bug_reports
      for insert to authenticated with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='support_bug_reports' and policyname='bug_reports_owner_select') then
    create policy bug_reports_owner_select on public.support_bug_reports
      for select to authenticated using (user_id = auth.uid());
  end if;
end $$;

-- ---- Feature requests ----------------------------------------------
create table if not exists public.support_feature_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  description text,
  vote_count  integer not null default 0,
  status      text not null default 'open',
  created_at  timestamptz not null default now()
);
alter table public.support_feature_requests enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='support_feature_requests' and policyname='feature_requests_owner_insert') then
    create policy feature_requests_owner_insert on public.support_feature_requests
      for insert to authenticated with check (user_id = auth.uid());
  end if;
  -- Readable by all authenticated users so the future "vote on
  -- requests" surface can list everyone's submissions.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='support_feature_requests' and policyname='feature_requests_authed_select') then
    create policy feature_requests_authed_select on public.support_feature_requests
      for select to authenticated using (true);
  end if;
end $$;

-- ---- Release notes --------------------------------------------------
create table if not exists public.support_release_notes (
  id           uuid primary key default gen_random_uuid(),
  version      text not null,
  title        text,
  items        jsonb not null default '[]'::jsonb,
  is_published boolean not null default true,
  sort_order   integer not null default 0,
  published_at timestamptz not null default now()
);
alter table public.support_release_notes enable row level security;

do $$
begin
  -- World-readable (anon + authenticated) when published; no client write.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='support_release_notes' and policyname='release_notes_public_read') then
    create policy release_notes_public_read on public.support_release_notes
      for select to anon, authenticated using (is_published = true);
  end if;
end $$;

-- Seed the current release note (idempotent on version).
insert into public.support_release_notes (version, title, items, sort_order, published_at)
select '2.3.0', 'What''s New',
  jsonb_build_array(
    'Pricing Calculator improvements',
    'Contract reminders',
    'Cloud Backup enhancements',
    'Client Love reviews'
  ),
  230, now()
where not exists (select 1 from public.support_release_notes where version = '2.3.0');

-- ---- Screenshot storage bucket -------------------------------------
insert into storage.buckets (id, name, public)
values ('support-screenshots', 'support-screenshots', true)
on conflict (id) do update set public = true;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='support_screenshots_owner_insert') then
    create policy support_screenshots_owner_insert on storage.objects
      for insert to authenticated
      with check (bucket_id = 'support-screenshots' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='support_screenshots_public_read') then
    create policy support_screenshots_public_read on storage.objects
      for select using (bucket_id = 'support-screenshots');
  end if;
end $$;

notify pgrst, 'reload schema';
