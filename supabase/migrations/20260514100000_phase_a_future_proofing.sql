-- Phase A future-proofing — additive columns + analytics_events.
-- Applies cleanly on top of 20260514000000_waitlist_v1.sql.
-- All ALTER / CREATE statements are idempotent so re-running is safe.

-- =====================================================================
-- waitlist_requests — provenance + lifecycle fields
-- =====================================================================
-- converted_appointment_id is `text` (not uuid + FK) because
-- appointments.id is stamped by the app as text (`appt_<uid>`), not
-- a uuid. We keep this column unenforced so the link is informational
-- only — deleting an appointment doesn't auto-null this row, but it
-- also can't fail with 42830 on a missing unique constraint.
alter table public.waitlist_requests
  add column if not exists source text default 'public_waitlist'
    check (source is null or source in ('public_waitlist','manual','imported','referral')),
  add column if not exists tags jsonb not null default '[]'::jsonb,
  add column if not exists contacted_at timestamptz,
  add column if not exists converted_appointment_id text,
  add column if not exists timezone text,
  add column if not exists locale text,
  add column if not exists created_from_public boolean not null default false;

-- Self-heal block. On any environment where converted_appointment_id
-- was previously created as `uuid` (an early draft of this migration
-- declared it that way), normalise it to `text` so the column matches
-- the app's text-typed appointment ids. No-op when the column is
-- already text.
do $$
declare
  current_type text;
begin
  select data_type
    into current_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'waitlist_requests'
    and column_name = 'converted_appointment_id';
  if current_type is not null and current_type <> 'text' then
    execute 'alter table public.waitlist_requests '
         || 'alter column converted_appointment_id type text '
         || 'using converted_appointment_id::text';
  end if;
end $$;

create index if not exists waitlist_requests_converted_idx
  on public.waitlist_requests (user_id, converted_appointment_id)
  where converted_appointment_id is not null;


-- =====================================================================
-- appointments — booking provenance + referral attribution
-- =====================================================================
-- referral_source is free-text on purpose so the studio can answer
-- "where did this client find me" without us hard-coding a closed
-- list. UI surfaces a chip suggester (instagram / tiktok /
-- direct_link / returning_client / waitlist / google) but anything
-- the user types is preserved.
alter table public.appointments
  add column if not exists referral_source text,
  add column if not exists timezone text,
  add column if not exists locale text,
  add column if not exists created_from_public boolean not null default false;

create index if not exists appointments_referral_source_idx
  on public.appointments (user_id, referral_source)
  where referral_source is not null;


-- =====================================================================
-- analytics_events — minimal event log
-- =====================================================================
-- Lightweight write-only stream for future dashboards. Owner reads
-- their own events; anonymous public booking visitors can INSERT
-- rows tied to the salon owner (resolved via the slug → user_id
-- lookup the public page already does). No anon SELECT.
--
-- payload is jsonb so we don't have to migrate every time we add a
-- new event shape. Keep payloads small (≤2 KB) — this is for KPIs
-- and funnel counts, not full request logging.
create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  event_source text not null default 'app'
    check (event_source in ('app','public','system')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_user_type_idx
  on public.analytics_events (user_id, event_type, created_at desc);
create index if not exists analytics_events_user_created_idx
  on public.analytics_events (user_id, created_at desc);

alter table public.analytics_events enable row level security;

-- Owner can read + manage their own events.
drop policy if exists "analytics_events_self_select" on public.analytics_events;
create policy "analytics_events_self_select" on public.analytics_events
  for select using (auth.uid() = user_id);

drop policy if exists "analytics_events_self_insert" on public.analytics_events;
create policy "analytics_events_self_insert" on public.analytics_events
  for insert with check (auth.uid() = user_id);

drop policy if exists "analytics_events_self_delete" on public.analytics_events;
create policy "analytics_events_self_delete" on public.analytics_events
  for delete using (auth.uid() = user_id);

-- Public visitors can INSERT events tied to a salon owner. Cannot
-- SELECT or DELETE — those policies above gate by auth.uid().
drop policy if exists "analytics_events_public_insert" on public.analytics_events;
create policy "analytics_events_public_insert" on public.analytics_events
  for insert with check (true);

grant insert on public.analytics_events to anon;
grant select, insert, delete on public.analytics_events to authenticated;
