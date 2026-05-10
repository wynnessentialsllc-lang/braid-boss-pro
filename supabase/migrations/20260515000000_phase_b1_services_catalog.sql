-- Phase B1 — services catalog enhancements + public services RPC.
--
-- Builds on:
--   - 20260512000000_services_v1.sql (services table)
--   - 20260513000000_phase2_policies_and_availability.sql (availability_*)
--
-- Additions are strictly additive; existing rows keep working
-- (defaults preserve the V1 single-stylist single-chair behaviour).

-- =====================================================================
-- services — buffers + concurrency for the slot engine
-- =====================================================================
-- buffer_before_minutes  : pad reserved time so prep / setup is
--                          protected (e.g. 15 min before braiding starts)
-- buffer_after_minutes   : pad reserved time after the booking so
--                          takedown / clean-up isn't double-booked
-- max_concurrent         : how many of THIS service can run in parallel.
--                          Default 1. Classes / multi-chair studios can
--                          set this higher; the slot engine's
--                          `maxConcurrent` knob already respects it.
alter table public.services
  add column if not exists buffer_before_minutes integer not null default 0
    check (buffer_before_minutes >= 0 and buffer_before_minutes <= 240),
  add column if not exists buffer_after_minutes integer not null default 0
    check (buffer_after_minutes >= 0 and buffer_after_minutes <= 240),
  add column if not exists max_concurrent integer not null default 1
    check (max_concurrent >= 1 and max_concurrent <= 50);


-- =====================================================================
-- public_list_services(slug_in text)
-- =====================================================================
-- Returns the active service catalog for the owner who owns this
-- booking-link slug. Security DEFINER lets anonymous booking-page
-- visitors call it without needing direct SELECT on services
-- (RLS on services blocks anon SELECT entirely — by design). The
-- function only ever returns is_active = true rows, never the
-- owner_id, and is rate-limited at the application layer.
create or replace function public.public_list_services(slug_in text)
returns table (
  id uuid,
  name text,
  description text,
  duration_hours numeric(5,2),
  base_price numeric(10,2),
  deposit_required boolean,
  deposit_amount numeric(10,2),
  add_ons jsonb,
  prep_instructions text,
  buffer_before_minutes integer,
  buffer_after_minutes integer,
  max_concurrent integer
)
language sql
security definer
set search_path = public
as $$
  select
    s.id, s.name, s.description, s.duration_hours, s.base_price,
    s.deposit_required, s.deposit_amount, s.add_ons, s.prep_instructions,
    s.buffer_before_minutes, s.buffer_after_minutes, s.max_concurrent
  from public.services s
  inner join public.booking_links bl on bl.user_id = s.user_id
  where bl.slug = slug_in
    and bl.active = true
    and s.is_active = true
  order by s.name asc;
$$;

-- The function owner runs as the postgres role; explicit grants make
-- it callable from anon (booking page) and authenticated (preview
-- in the stylist app).
revoke all on function public.public_list_services(text) from public;
grant execute on function public.public_list_services(text) to anon;
grant execute on function public.public_list_services(text) to authenticated;
