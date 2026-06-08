-- Build Your Style — client-facing AI consultation requests.
--
-- When a client doesn't see the style they want on the booking page, they
-- describe it (photo + a few structured answers + a desired date/time), an
-- AI proposes the closest catalog match and a BALLPARK price range, and the
-- request lands here for the stylist to approve or deny. On approval it is
-- wired into the normal deposit-first booking flow (booking_request_id).
--
-- Anonymous booking-page visitors can INSERT (user_id resolved from the
-- slug, same pattern as waitlist_requests). They can never read/update/
-- delete — those are gated to the owner by auth.uid().

create table if not exists public.style_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Client contact
  client_name text not null,
  client_phone text,
  client_email text,

  -- Intake
  photo_path text,
  size text check (size is null or size in ('micro','small','medium','large','jumbo')),
  length text check (length is null or length in ('shoulder','mid_back','waist','hip','butt')),
  hair_included boolean,
  human_hair boolean,
  color text,
  notes text,

  -- Desired date/time (mirrors booking_requests.preferred_date/time)
  preferred_date date,
  preferred_time text,

  -- AI ballpark snapshot (price ANCHORED to a real catalog service; the
  -- model only picks the closest service, pricing comes from base_price).
  ai_style_family text,
  ai_suggested_service_id uuid references public.services(id) on delete set null,
  ai_price_low numeric(10,2),
  ai_price_high numeric(10,2),
  ai_est_duration_hours numeric(5,2),
  ai_rationale text,

  -- Review workflow
  status text not null default 'submitted'
    check (status in ('submitted','approved','denied','deposit_pending','booked','archived')),
  review_notes text,
  -- Link to the booking_request created when the stylist approves. Plain
  -- uuid (no FK) to keep this migration independent of the booking_requests
  -- definition; the app reconciles the link on approval.
  booking_request_id uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint style_requests_name_not_empty check (length(trim(client_name)) > 0)
);

create index if not exists style_requests_user_status_idx
  on public.style_requests (user_id, status);
create index if not exists style_requests_user_created_idx
  on public.style_requests (user_id, created_at desc);

alter table public.style_requests enable row level security;

-- Owner — full CRUD on their own requests.
drop policy if exists "style_requests_self_select" on public.style_requests;
create policy "style_requests_self_select" on public.style_requests
  for select using (auth.uid() = user_id);

drop policy if exists "style_requests_self_update" on public.style_requests;
create policy "style_requests_self_update" on public.style_requests
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "style_requests_self_delete" on public.style_requests;
create policy "style_requests_self_delete" on public.style_requests
  for delete using (auth.uid() = user_id);

drop policy if exists "style_requests_self_insert" on public.style_requests;
create policy "style_requests_self_insert" on public.style_requests
  for insert with check (auth.uid() = user_id);

-- Anonymous booking-page visitors can INSERT (user_id resolved from the
-- slug). They can never SELECT/UPDATE/DELETE — those gate by auth.uid().
drop policy if exists "style_requests_public_insert" on public.style_requests;
create policy "style_requests_public_insert" on public.style_requests
  for insert with check (true);

grant insert on public.style_requests to anon;
grant select, insert, update, delete on public.style_requests to authenticated;

-- Auto-bump updated_at.
create or replace function public.style_requests_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists style_requests_touch on public.style_requests;
create trigger style_requests_touch
  before update on public.style_requests
  for each row execute function public.style_requests_touch_updated_at();
