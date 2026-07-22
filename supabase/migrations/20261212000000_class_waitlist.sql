-- Class waitlist (Phase 3).
--
-- When a class is at capacity, a would-be student leaves their name +
-- email so the braider can reach out if a seat frees up (a refund, or
-- they add capacity). Public join goes through a SECURITY DEFINER RPC
-- (same resolver as sign-ups); the braider reads their own list via the
-- owner-select RLS policy, exactly like class_registrations.
--
-- v1 is capture + display only — no automated "a seat opened" email.
-- That can layer on later via the notification queue.

begin;

create table if not exists public.class_waitlist (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  class_id    uuid not null references public.class_offerings(id) on delete cascade,
  name        text,
  email       text not null,
  created_at  timestamptz not null default now(),
  -- Stamped if/when the braider notifies this person (future use).
  notified_at timestamptz,
  -- One waitlist spot per email per class — a double submit is a no-op.
  unique (class_id, email)
);

create index if not exists class_waitlist_user_idx
  on public.class_waitlist (user_id, created_at desc);
create index if not exists class_waitlist_class_idx
  on public.class_waitlist (class_id, created_at asc);

alter table public.class_waitlist enable row level security;
-- Braider reads their own waitlist. Writes happen through the
-- service-definer join RPC only, so no authenticated write policies.
drop policy if exists class_waitlist_owner_select on public.class_waitlist;
create policy class_waitlist_owner_select on public.class_waitlist
  for select to authenticated using (user_id = auth.uid());

-- ---- Public RPC: join a class waitlist ----------------------------------
create or replace function public.public_join_class_waitlist(
  slug_in       text,
  class_slug_in text,
  name_in       text,
  email_in      text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved record;
  cls      record;
  clean_email text;
  clean_name  text;
begin
  clean_email := lower(trim(coalesce(email_in, '')));
  -- Light server-side email sanity check — the client validates too.
  if clean_email !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' then
    return false;
  end if;
  clean_name := nullif(left(regexp_replace(coalesce(name_in, ''), '[<>]', '', 'g'), 120), '');

  select * into resolved
    from public.public_resolve_booking_slug(slug_in)
    limit 1;
  if resolved.user_id is null then
    return false;
  end if;

  select id into cls
    from public.class_offerings
    where user_id = resolved.user_id
      and slug = class_slug_in
      and status = 'published'
    limit 1;
  if cls.id is null then
    return false;
  end if;

  insert into public.class_waitlist (user_id, class_id, name, email)
  values (resolved.user_id, cls.id, clean_name, clean_email)
  on conflict (class_id, email) do nothing;

  return true;
end $$;

revoke all on function public.public_join_class_waitlist(text, text, text, text) from public;
grant execute on function public.public_join_class_waitlist(text, text, text, text) to anon, authenticated;

-- ---- Reload PostgREST schema cache --------------------------------------
notify pgrst, 'reload schema';

commit;
