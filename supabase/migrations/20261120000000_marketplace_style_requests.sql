-- Marketplace Phase 4 — Open Style Requests (reverse marketplace), sub-step 1.
--
-- A client posts ONE style request to the marketplace (not to a single
-- braider). Matching braiders later see it and send quotes; the client
-- views quotes via a tokenized link and books with whoever they pick.
--
-- This migration lays the foundation:
--   * marketplace_style_requests — the broadcast request (anon, token-addressed)
--   * marketplace_quotes         — a braider's quote on a request (sub-step 2 UI)
--
-- Access model: both tables are RLS-on with NO anon policies. The client
-- side is reached only through the service-role /api/style-request-post
-- route and (sub-step 2) tokenized SECURITY DEFINER RPCs, so anon visitors
-- can never enumerate other people's requests or contact details. Braiders
-- get their own-row access for quotes.

-- ---------------------------------------------------------------
-- Requests
-- ---------------------------------------------------------------
create table if not exists public.marketplace_style_requests (
  id uuid primary key default gen_random_uuid(),

  -- Opaque token the anon client uses to view their request + quotes.
  client_token text not null unique
    default replace(gen_random_uuid()::text, '-', ''),

  -- Client contact (no account required).
  client_name text not null,
  client_email text,
  client_phone text,

  -- Intake (mirrors style_requests, plus a budget the braider quotes against).
  photo_path text,
  style_tags text[] not null default '{}'::text[],
  size text check (size is null or size in ('micro','small','medium','large','jumbo')),
  length text check (length is null or length in ('shoulder','mid_back','waist','hip','butt')),
  budget_min numeric(10,2) check (budget_min is null or budget_min >= 0),
  budget_max numeric(10,2) check (budget_max is null or budget_max >= 0),
  city text,
  state text,
  preferred_date date,
  preferred_time text,
  notes text,

  status text not null default 'open'
    check (status in ('open','closed','expired','booked')),
  -- Stale requests age out so the braider inbox stays fresh.
  expires_at timestamptz not null default (now() + interval '30 days'),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint marketplace_style_requests_name_not_empty
    check (length(trim(client_name)) > 0),
  -- Same canonical vocabulary as services.style_tags so request <-> braider
  -- matching is apples-to-apples.
  constraint marketplace_style_requests_tags_chk check (
    style_tags <@ array[
      'knotless','boho','micros','feed_in','cornrows',
      'twists','locs','passion_twists','kids','takedown'
    ]::text[]
  )
);

create index if not exists marketplace_style_requests_status_idx
  on public.marketplace_style_requests (status, expires_at);
create index if not exists marketplace_style_requests_city_idx
  on public.marketplace_style_requests (city)
  where status = 'open';
create index if not exists marketplace_style_requests_tags_gin
  on public.marketplace_style_requests using gin (style_tags);

alter table public.marketplace_style_requests enable row level security;
-- No anon/authenticated policies: all access is via the service-role route
-- and (sub-step 2) tokenized SECURITY DEFINER RPCs.

-- ---------------------------------------------------------------
-- Quotes (foundation; braider quoting UI lands in sub-step 2)
-- ---------------------------------------------------------------
create table if not exists public.marketplace_quotes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null
    references public.marketplace_style_requests(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  price numeric(10,2) not null check (price >= 0),
  message text,
  available_date date,

  status text not null default 'sent'
    check (status in ('sent','withdrawn','accepted')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One live quote per braider per request (they edit, not stack).
  constraint marketplace_quotes_unique_braider unique (request_id, user_id)
);

create index if not exists marketplace_quotes_request_idx
  on public.marketplace_quotes (request_id);
create index if not exists marketplace_quotes_user_idx
  on public.marketplace_quotes (user_id, created_at desc);

alter table public.marketplace_quotes enable row level security;

-- Braider owns their quotes.
drop policy if exists "marketplace_quotes_self_select" on public.marketplace_quotes;
create policy "marketplace_quotes_self_select" on public.marketplace_quotes
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "marketplace_quotes_self_insert" on public.marketplace_quotes;
create policy "marketplace_quotes_self_insert" on public.marketplace_quotes
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "marketplace_quotes_self_update" on public.marketplace_quotes;
create policy "marketplace_quotes_self_update" on public.marketplace_quotes
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- updated_at trigger (reuses the shared helper if present).
do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_current_timestamp_updated_at') then
    drop trigger if exists marketplace_style_requests_set_updated_at on public.marketplace_style_requests;
    create trigger marketplace_style_requests_set_updated_at
      before update on public.marketplace_style_requests
      for each row execute function public.set_current_timestamp_updated_at();
    drop trigger if exists marketplace_quotes_set_updated_at on public.marketplace_quotes;
    create trigger marketplace_quotes_set_updated_at
      before update on public.marketplace_quotes
      for each row execute function public.set_current_timestamp_updated_at();
  end if;
end $$;
