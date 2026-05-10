-- Phase B6 — Booking request snapshots.
--
-- Make booking_requests preserve historical service details at the
-- moment a public booking request is submitted, so later edits or
-- deletes to the services catalog do not change what the client
-- originally asked for.
--
-- This migration is fully defensive:
--   • every column add uses `if not exists`
--   • every constraint is guarded by a pg_constraint lookup
--   • every index uses `create index if not exists`
--   • every backfill checks via information_schema that the source
--     columns it wants to read actually exist (services schema may
--     vary across environments — `price` vs `base_price`, etc.)
--
-- Safe to run on production and on a fresh environment, in either
-- order relative to the in-flight Phase B1 consolidation PR.
-- Re-running is a no-op.

-- =====================================================================
-- 1. Snapshot columns
-- =====================================================================
-- service_id is added (without FK yet) so the FK guard below can
-- safely reference it. service_name_snapshot is a new immutable
-- snapshot column distinct from the existing mutable service_name.
alter table public.booking_requests
  add column if not exists service_id uuid,
  add column if not exists service_name_snapshot text,
  add column if not exists service_price numeric(10, 2),
  add column if not exists service_duration_hours numeric(5, 2),
  add column if not exists service_deposit_required boolean,
  add column if not exists service_deposit_amount numeric(10, 2),
  add column if not exists service_prep_instructions text,
  add column if not exists created_from_public boolean not null default false;

-- =====================================================================
-- 2. Defensive FK booking_requests.service_id -> services(id)
-- =====================================================================
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'services'
  )
  and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'services' and column_name = 'id'
  )
  and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'booking_requests' and column_name = 'service_id'
  )
  and not exists (
    select 1 from pg_constraint where conname = 'booking_requests_service_id_fkey'
  ) then
    execute $ddl$
      alter table public.booking_requests
        add constraint booking_requests_service_id_fkey
        foreign key (service_id) references public.services(id) on delete set null
    $ddl$;
  end if;
end $$;

-- =====================================================================
-- 3. Indexes (only when the underlying column exists)
-- =====================================================================
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='booking_requests' and column_name='service_id'
  ) then
    execute 'create index if not exists booking_requests_service_id_idx
             on public.booking_requests (service_id)
             where service_id is not null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='booking_requests' and column_name='created_from_public'
  ) then
    execute 'create index if not exists booking_requests_created_from_public_idx
             on public.booking_requests (created_from_public)
             where created_from_public is true';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='booking_requests' and column_name='approval_status'
  ) then
    -- An identical index ships with the B5a migration. `if not exists`
    -- makes this re-run safe on environments where B5a is present.
    execute 'create index if not exists booking_requests_approval_status_idx
             on public.booking_requests (user_id, approval_status, created_at desc)';
  end if;
end $$;

-- =====================================================================
-- 4. Backfill — defensive, services schema may vary
-- =====================================================================
-- Builds the SELECT list dynamically based on which services columns
-- exist. Falls back gracefully when a column is missing — the
-- corresponding snapshot field stays null rather than crashing the
-- migration. Backfill order:
--   (a) join by service_id when present
--   (b) case-insensitive name fallback for legacy rows where
--       service_id is null but service_name matches a current
--       services row owned by the same user
do $$
declare
  has_name      boolean;
  has_price     boolean;
  has_baseprice boolean;
  has_durhours  boolean;
  has_durmins   boolean;
  has_depreq    boolean;
  has_depamt    boolean;
  has_prepinst  boolean;
  expr_name     text;
  expr_price    text;
  expr_duration text;
  expr_depreq   text;
  expr_depamt   text;
  expr_prep     text;
  set_clause    text;
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='services'
  ) then
    raise notice 'phase b6: services table absent — skipping backfill';
    return;
  end if;

  select
    bool_or(column_name = 'name'),
    bool_or(column_name = 'price'),
    bool_or(column_name = 'base_price'),
    bool_or(column_name = 'duration_hours'),
    bool_or(column_name = 'duration_minutes'),
    bool_or(column_name = 'deposit_required'),
    bool_or(column_name = 'deposit_amount'),
    bool_or(column_name = 'prep_instructions')
    into has_name, has_price, has_baseprice, has_durhours, has_durmins,
         has_depreq, has_depamt, has_prepinst
  from information_schema.columns
  where table_schema='public' and table_name='services';

  expr_name     := case when has_name then 's.name' else 'null::text' end;
  expr_price    := case when has_price then 's.price'
                        when has_baseprice then 's.base_price'
                        else 'null::numeric' end;
  expr_duration := case when has_durhours then 's.duration_hours'
                        when has_durmins then '(s.duration_minutes::numeric / 60.0)'
                        else 'null::numeric' end;
  expr_depreq   := case when has_depreq then 's.deposit_required' else 'null::boolean' end;
  expr_depamt   := case when has_depamt then 's.deposit_amount' else 'null::numeric' end;
  expr_prep     := case when has_prepinst then 's.prep_instructions' else 'null::text' end;

  set_clause :=
    'service_name_snapshot = coalesce(br.service_name_snapshot, ' || expr_name || ', br.service_name), '
    || 'service_price = coalesce(br.service_price, ' || expr_price || '), '
    || 'service_duration_hours = coalesce(br.service_duration_hours, ' || expr_duration || ', br.service_duration), '
    || 'service_deposit_required = coalesce(br.service_deposit_required, ' || expr_depreq || '), '
    || 'service_deposit_amount = coalesce(br.service_deposit_amount, ' || expr_depamt || '), '
    || 'service_prep_instructions = coalesce(br.service_prep_instructions, ' || expr_prep || ')';

  -- Pass (a): service_id join. Also lifts service_id where null but
  -- a name match exists.
  execute format($q$
    update public.booking_requests br
    set service_id = coalesce(br.service_id, s.id),
        %s
    from public.services s
    where s.user_id = br.user_id
      and s.id = br.service_id
      and (
        br.service_name_snapshot is null
        or br.service_price is null
        or br.service_duration_hours is null
        or br.service_deposit_required is null
        or br.service_deposit_amount is null
        or br.service_prep_instructions is null
      )
  $q$, set_clause);

  -- Pass (b): name fallback for legacy rows.
  execute format($q$
    update public.booking_requests br
    set service_id = coalesce(br.service_id, s.id),
        %s
    from public.services s
    where s.user_id = br.user_id
      and br.service_id is null
      and br.service_name is not null
      and br.service_name <> ''
      and lower(s.name) = lower(br.service_name)
      and (
        br.service_name_snapshot is null
        or br.service_price is null
        or br.service_duration_hours is null
        or br.service_deposit_required is null
        or br.service_deposit_amount is null
        or br.service_prep_instructions is null
      )
  $q$, set_clause);

  -- Pass (c): copy legacy mutable service_name into the snapshot
  -- column for any row still missing it (no service match found).
  execute $q$
    update public.booking_requests
    set service_name_snapshot = service_name
    where service_name_snapshot is null
      and service_name is not null
      and service_name <> ''
  $q$;

  -- Pass (d): mark public-link rows as such for legacy data.
  execute $q$
    update public.booking_requests
    set created_from_public = true
    where created_from_public is distinct from true
      and link_slug is not null
      and link_slug <> ''
  $q$;
end $$;

-- =====================================================================
-- 5. public_submit_booking_request — snapshot on insert
-- =====================================================================
-- Recreates the security-definer anon RPC. Snapshots service catalog
-- data at submit time so later owner edits don't rewrite history.
-- Signature matches the production frontend caller exactly:
--   (text, text, text, text, uuid, date, text, text, text, text)
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
  svc_row public.services%rowtype;
  new_id uuid;
begin
  if slug_in is null or trim(slug_in) = '' then
    return null;
  end if;
  if client_name_in is null or trim(client_name_in) = '' then
    return null;
  end if;

  select user_id into owner_id
  from public.booking_links
  where slug = slug_in and active = true
  limit 1;
  if owner_id is null then
    return null;
  end if;

  -- Resolve the service. Explicit uuid wins; otherwise no snapshot
  -- (service_name + duration come straight from the payload via the
  -- legacy edge-function path when this RPC isn't given an id).
  if service_id_in is not null then
    select * into svc_row
    from public.services
    where id = service_id_in and user_id = owner_id and is_active = true
    limit 1;
  end if;

  insert into public.booking_requests (
    user_id, link_slug,
    client_name, client_phone, client_email,
    service_id, service_name, service_name_snapshot,
    service_duration, service_duration_hours,
    service_price,
    service_deposit_required, service_deposit_amount,
    service_prep_instructions,
    preferred_date, preferred_time, notes,
    created_from_public,
    status, approval_status
  ) values (
    owner_id,
    nullif(trim(slug_in), ''),
    nullif(trim(client_name_in), ''),
    nullif(trim(coalesce(client_phone_in, '')), ''),
    nullif(trim(coalesce(client_email_in, '')), ''),
    svc_row.id,
    coalesce(svc_row.name, null),
    coalesce(svc_row.name, null),
    svc_row.duration_hours,
    svc_row.duration_hours,
    svc_row.base_price,
    svc_row.deposit_required,
    svc_row.deposit_amount,
    svc_row.prep_instructions,
    preferred_date_in,
    nullif(trim(coalesce(preferred_time_in, '')), ''),
    nullif(trim(coalesce(notes_in, '')), ''),
    true,
    'pending',
    'pending_review'
  )
  returning id into new_id;

  return new_id;
end;
$$;

revoke all on function public.public_submit_booking_request(
  text, text, text, text, uuid, date, text, text, text, text
) from public;
grant execute on function public.public_submit_booking_request(
  text, text, text, text, uuid, date, text, text, text, text
) to anon;
grant execute on function public.public_submit_booking_request(
  text, text, text, text, uuid, date, text, text, text, text
) to authenticated;

-- =====================================================================
-- 6. approve_booking_request — prefer snapshot over live services
-- =====================================================================
-- Reads only snapshot fields off booking_requests. The hotfix and
-- consolidation versions already do this; re-creating it here keeps
-- the migration self-sufficient if it lands ahead of those PRs.
create or replace function public.approve_booking_request(
  request_id_in uuid,
  deposit_amount_in numeric default null,
  expires_minutes_in integer default 30
)
returns public.booking_requests
language plpgsql
security invoker
set search_path = public
as $$
declare
  caller uuid;
  row_out public.booking_requests;
  resolved_deposit numeric;
  expires_minutes integer;
begin
  caller := auth.uid();
  if caller is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;
  expires_minutes := greatest(5, least(coalesce(expires_minutes_in, 30), 24 * 60));

  -- Snapshot wins; explicit override wins over snapshot. Live
  -- services lookup is the last resort and only fires when the
  -- request never carried a snapshot AND the caller didn't override.
  select coalesce(
    deposit_amount_in,
    case when br.service_deposit_required then br.service_deposit_amount end,
    (
      select case when s.deposit_required then s.deposit_amount end
      from public.services s
      where s.user_id = caller
        and (
          (br.service_id is not null and s.id = br.service_id)
          or (br.service_id is null and br.service_name is not null
              and lower(s.name) = lower(br.service_name))
        )
      limit 1
    )
  )
    into resolved_deposit
  from public.booking_requests br
  where br.id = request_id_in and br.user_id = caller;

  update public.booking_requests
  set approval_status = 'approved_pending_deposit',
      deposit_amount = resolved_deposit,
      approval_expires_at = now() + (expires_minutes || ' minutes')::interval,
      approved_at = now(),
      expired_at = null,
      declined_at = null,
      decline_reason = null,
      status = 'approved'
  where id = request_id_in and user_id = caller
  returning * into row_out;

  if row_out.id is null then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
  return row_out;
end;
$$;

revoke all on function public.approve_booking_request(uuid, numeric, integer) from public;
grant execute on function public.approve_booking_request(uuid, numeric, integer) to authenticated;

-- =====================================================================
-- Verification (run manually after the migration applies)
-- =====================================================================
-- -- 1. Snapshot columns exist
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema='public' and table_name='booking_requests'
--   and column_name in (
--     'service_id','service_name_snapshot','service_price',
--     'service_duration_hours','service_deposit_required',
--     'service_deposit_amount','service_prep_instructions',
--     'created_from_public'
--   )
-- order by column_name;
--
-- -- 2. FK exists
-- select pg_get_constraintdef(oid) from pg_constraint
-- where conname='booking_requests_service_id_fkey';
--
-- -- 3. Indexes exist
-- select indexname from pg_indexes
-- where schemaname='public'
--   and indexname in (
--     'booking_requests_service_id_idx',
--     'booking_requests_created_from_public_idx',
--     'booking_requests_approval_status_idx'
--   )
-- order by indexname;
--
-- -- 4. RPC exists with the expected signature
-- select pg_get_function_identity_arguments(p.oid) as args
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname='public' and p.proname='public_submit_booking_request';
--
-- -- 5. Backfill landed
-- select count(*) total,
--        count(service_id) with_service_id,
--        count(service_name_snapshot) with_name_snapshot,
--        count(service_duration_hours) with_duration_hours,
--        count(service_deposit_amount) with_deposit_amount
-- from public.booking_requests;
--
-- -- 6. Round-trip a synthetic submit (substitute a real slug + active service id)
-- -- select public.public_submit_booking_request(
-- --   '<slug>', 'Audit Test', null, 'audit@example.com',
-- --   '<service_uuid>', current_date + 7, '10:00', null, null, null
-- -- );
-- -- select service_id, service_name_snapshot, service_price,
-- --        service_duration_hours, service_deposit_required,
-- --        service_deposit_amount, service_prep_instructions,
-- --        created_from_public, status, approval_status
-- -- from public.booking_requests
-- -- order by created_at desc limit 1;
