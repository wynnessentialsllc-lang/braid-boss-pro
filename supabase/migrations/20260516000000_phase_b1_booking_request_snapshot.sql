-- Phase B1 — booking request service snapshot + public submit RPC.
--
-- Goal: make a public booking submission persist the *full* service
-- snapshot at the moment of booking, not just service_id. If a
-- stylist later edits or deletes the service, the historical request
-- still tells the truth.
--
-- All ALTER / CREATE statements idempotent.

-- =====================================================================
-- booking_requests — service snapshot fields
-- =====================================================================
-- Some of these may already exist on this DB (the edge function
-- already writes service_name / service_duration / service_price);
-- `add column if not exists` is the safe re-runnable path.
alter table public.booking_requests
  add column if not exists service_id uuid,
  add column if not exists service_name text,
  add column if not exists service_price numeric(10, 2),
  add column if not exists service_duration_hours numeric(5, 2),
  add column if not exists service_duration numeric(5, 2),
  add column if not exists service_deposit_required boolean,
  add column if not exists service_deposit_amount numeric(10, 2),
  add column if not exists service_prep_instructions text,
  add column if not exists timezone text,
  add column if not exists locale text,
  add column if not exists created_from_public boolean not null default false;

-- service_id soft FK — the live services table uses uuid PKs, so a
-- real FK is feasible. ON DELETE SET NULL keeps history when a
-- stylist removes a service from the catalog.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'booking_requests_service_id_fkey'
  ) then
    alter table public.booking_requests
      add constraint booking_requests_service_id_fkey
      foreign key (service_id) references public.services(id) on delete set null;
  end if;
end $$;

create index if not exists booking_requests_service_id_idx
  on public.booking_requests (service_id)
  where service_id is not null;


-- =====================================================================
-- public_submit_booking_request(...)  RPC
-- =====================================================================
-- Lets anonymous booking-page visitors INSERT a request without the
-- edge function. Resolves slug → user_id internally, snapshots the
-- service catalog row at submit time, and stamps timezone / locale /
-- created_from_public.
--
-- Returns the new request id so the page can navigate to a thank-you
-- state. Returns null when the slug doesn't match an active link
-- (the page handles this as a generic error so we don't expose
-- enumeration-friendly responses).
create or replace function public.public_submit_booking_request(
  slug_in text,
  client_name_in text,
  client_phone_in text default null,
  client_email_in text default null,
  service_id_in uuid default null,
  preferred_date_in date default null,
  preferred_time_in text default null,
  notes_in text default null,
  timezone_in text default null,
  locale_in text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
  svc record;
  new_id uuid;
  trimmed_name text;
begin
  trimmed_name := nullif(trim(client_name_in), '');
  if trimmed_name is null then
    raise exception 'client_name is required';
  end if;

  -- Resolve slug → owner. The link must be active; otherwise we
  -- bail with a generic null return.
  select user_id into owner_id
  from public.booking_links
  where slug = slug_in
    and active = true
  limit 1;
  if owner_id is null then
    return null;
  end if;

  -- If the caller supplied a service_id, snapshot the live catalog
  -- row at submit time. Service must belong to the same owner.
  if service_id_in is not null then
    select id, name, base_price, duration_hours, deposit_required,
           deposit_amount, prep_instructions
      into svc
    from public.services
    where id = service_id_in
      and user_id = owner_id
      and is_active = true
    limit 1;
    -- If the service id doesn't match an active row for this owner,
    -- silently drop the link rather than failing the whole insert.
    if svc.id is null then
      service_id_in := null;
    end if;
  end if;

  insert into public.booking_requests (
    user_id,
    client_name,
    client_phone,
    client_email,
    service_id,
    service_name,
    service_price,
    service_duration_hours,
    service_duration,
    service_deposit_required,
    service_deposit_amount,
    service_prep_instructions,
    preferred_date,
    preferred_time,
    notes,
    timezone,
    locale,
    created_from_public
  ) values (
    owner_id,
    trimmed_name,
    nullif(trim(client_phone_in), ''),
    nullif(trim(client_email_in), ''),
    service_id_in,
    coalesce(svc.name, null),
    svc.base_price,
    svc.duration_hours,
    svc.duration_hours,
    svc.deposit_required,
    svc.deposit_amount,
    svc.prep_instructions,
    preferred_date_in,
    nullif(trim(preferred_time_in), ''),
    nullif(trim(notes_in), ''),
    nullif(trim(timezone_in), ''),
    nullif(trim(locale_in), ''),
    true
  )
  returning id into new_id;

  return new_id;
end;
$$;

revoke all on function public.public_submit_booking_request(text, text, text, text, uuid, date, text, text, text, text) from public;
grant execute on function public.public_submit_booking_request(text, text, text, text, uuid, date, text, text, text, text) to anon;
grant execute on function public.public_submit_booking_request(text, text, text, text, uuid, date, text, text, text, text) to authenticated;
