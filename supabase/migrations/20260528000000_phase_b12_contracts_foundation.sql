-- Phase B12 — Contracts foundation.
--
-- Adds a contract / agreement layer to the booking lifecycle so the
-- stylist can require clients to review + sign appointment policies
-- alongside (or before) the deposit. Snapshotted at submit time so
-- later edits to a template don't change anything already signed.
--
-- Tables:
--   contract_templates              — owner-managed reusable templates
--   service_contract_templates      — many-to-many: services ↔ templates
--   booking_contracts               — generated instance per booking
--   communication_logs              — delivery-tracking log (NEW; the
--                                     existing public.communications
--                                     table has a different purpose
--                                     and is left untouched)
--
-- Idempotent throughout. Re-runnable. No destructive operations.
--
-- ID type notes:
--   * clients.id and appointments.id are TEXT in this database, not
--     uuid. booking_contracts.client_id and appointment_id (and the
--     same fields on communication_logs) are therefore text.
--   * booking_requests.id and services.id are uuid — those keep uuid.

-- =====================================================================
-- 0. updated_at trigger helper (reuses existing fn if present)
-- =====================================================================
do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'set_updated_at_timestamp'
  ) then
    create or replace function public.set_updated_at_timestamp()
    returns trigger
    language plpgsql
    as $body$
    begin
      new.updated_at := now();
      return new;
    end;
    $body$;
  end if;
end $$;

-- =====================================================================
-- 1. contract_templates
-- =====================================================================
create table if not exists public.contract_templates (
  id                         uuid primary key default gen_random_uuid(),
  user_id                    uuid not null references auth.users(id) on delete cascade,
  title                      text not null,
  template_type              text not null default 'booking_agreement',
  body                       text not null,
  is_active                  boolean not null default true,
  require_signature          boolean not null default true,
  require_initials           boolean not null default false,
  attach_to_all_bookings     boolean not null default false,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'contract_templates_template_type_chk'
  ) then
    alter table public.contract_templates
      add constraint contract_templates_template_type_chk
      check (template_type in (
        'booking_agreement','deposit_agreement','cancellation_policy',
        'no_show_policy','hair_prep_agreement','photo_video_consent',
        'liability_waiver','consultation_agreement','custom'
      ));
  end if;
end $$;

create index if not exists contract_templates_user_id_idx
  on public.contract_templates (user_id, is_active, created_at desc);

drop trigger if exists contract_templates_touch_updated_at on public.contract_templates;
create trigger contract_templates_touch_updated_at
  before update on public.contract_templates
  for each row execute function public.set_updated_at_timestamp();

alter table public.contract_templates enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where policyname='contract_templates_owner_select' and tablename='contract_templates') then
    create policy "contract_templates_owner_select" on public.contract_templates
      for select to authenticated using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname='contract_templates_owner_insert' and tablename='contract_templates') then
    create policy "contract_templates_owner_insert" on public.contract_templates
      for insert to authenticated with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname='contract_templates_owner_update' and tablename='contract_templates') then
    create policy "contract_templates_owner_update" on public.contract_templates
      for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname='contract_templates_owner_delete' and tablename='contract_templates') then
    create policy "contract_templates_owner_delete" on public.contract_templates
      for delete to authenticated using (auth.uid() = user_id);
  end if;
end $$;

-- =====================================================================
-- 2. service_contract_templates  (many-to-many junction)
-- =====================================================================
create table if not exists public.service_contract_templates (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users(id) on delete cascade,
  service_id               uuid not null references public.services(id) on delete cascade,
  contract_template_id     uuid not null references public.contract_templates(id) on delete cascade,
  created_at               timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'service_contract_templates_unique'
  ) then
    alter table public.service_contract_templates
      add constraint service_contract_templates_unique
      unique (service_id, contract_template_id);
  end if;
end $$;

create index if not exists service_contract_templates_user_idx
  on public.service_contract_templates (user_id);
create index if not exists service_contract_templates_service_idx
  on public.service_contract_templates (service_id);

alter table public.service_contract_templates enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where policyname='sct_owner_select' and tablename='service_contract_templates') then
    create policy "sct_owner_select" on public.service_contract_templates
      for select to authenticated using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname='sct_owner_insert' and tablename='service_contract_templates') then
    create policy "sct_owner_insert" on public.service_contract_templates
      for insert to authenticated with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname='sct_owner_update' and tablename='service_contract_templates') then
    create policy "sct_owner_update" on public.service_contract_templates
      for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname='sct_owner_delete' and tablename='service_contract_templates') then
    create policy "sct_owner_delete" on public.service_contract_templates
      for delete to authenticated using (auth.uid() = user_id);
  end if;
end $$;

-- =====================================================================
-- 3. booking_contracts  (generated instance per booking)
-- =====================================================================
create table if not exists public.booking_contracts (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users(id) on delete cascade,
  client_id                text null,
  booking_request_id       uuid null references public.booking_requests(id) on delete set null,
  appointment_id           text null,
  contract_template_id     uuid null references public.contract_templates(id) on delete set null,
  title                    text not null,
  body_snapshot            text not null,
  status                   text not null default 'pending',
  client_name              text null,
  client_email             text null,
  client_phone             text null,
  signed_name              text null,
  signature_text           text null,
  initials                 text null,
  signed_at                timestamptz null,
  viewed_at                timestamptz null,
  declined_at              timestamptz null,
  expires_at               timestamptz null,
  ip_address               text null,
  user_agent               text null,
  public_token             text not null unique default encode(gen_random_bytes(24), 'hex'),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'booking_contracts_status_chk'
  ) then
    alter table public.booking_contracts
      add constraint booking_contracts_status_chk
      check (status in ('pending','viewed','signed','declined','expired','voided'));
  end if;
end $$;

create index if not exists booking_contracts_user_id_idx
  on public.booking_contracts (user_id, created_at desc);
create index if not exists booking_contracts_request_idx
  on public.booking_contracts (booking_request_id)
  where booking_request_id is not null;
create index if not exists booking_contracts_appointment_idx
  on public.booking_contracts (appointment_id)
  where appointment_id is not null;
create index if not exists booking_contracts_client_idx
  on public.booking_contracts (client_id)
  where client_id is not null;
create index if not exists booking_contracts_token_idx
  on public.booking_contracts (public_token);

drop trigger if exists booking_contracts_touch_updated_at on public.booking_contracts;
create trigger booking_contracts_touch_updated_at
  before update on public.booking_contracts
  for each row execute function public.set_updated_at_timestamp();

alter table public.booking_contracts enable row level security;

-- Owner CRUD policies. Public anon clients NEVER read this table
-- directly; they go through get_public_contract_by_token.
do $$
begin
  if not exists (select 1 from pg_policies where policyname='booking_contracts_owner_select' and tablename='booking_contracts') then
    create policy "booking_contracts_owner_select" on public.booking_contracts
      for select to authenticated using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname='booking_contracts_owner_insert' and tablename='booking_contracts') then
    create policy "booking_contracts_owner_insert" on public.booking_contracts
      for insert to authenticated with check (auth.uid() = user_id);
  end if;
  -- Owner can void / mark voided / update small fields. Signed-state
  -- immutability is enforced at the app layer (UI doesn't expose
  -- editing of signed contracts); a future trigger can lock it
  -- harder if needed.
  if not exists (select 1 from pg_policies where policyname='booking_contracts_owner_update' and tablename='booking_contracts') then
    create policy "booking_contracts_owner_update" on public.booking_contracts
      for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname='booking_contracts_owner_delete' and tablename='booking_contracts') then
    create policy "booking_contracts_owner_delete" on public.booking_contracts
      for delete to authenticated using (auth.uid() = user_id);
  end if;
end $$;

-- =====================================================================
-- 4. communication_logs  (delivery tracking; NEW, distinct from
--    the existing public.communications which is an outbound
--    copy/template log).
-- =====================================================================
create table if not exists public.communication_logs (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users(id) on delete cascade,
  client_id                text null,
  booking_request_id       uuid null,
  appointment_id           text null,
  booking_contract_id      uuid null references public.booking_contracts(id) on delete set null,
  channel                  text not null,
  message_type             text not null,
  recipient                text null,
  subject                  text null,
  body                     text null,
  status                   text not null default 'queued',
  provider                 text null,
  provider_message_id      text null,
  error_message            text null,
  sent_at                  timestamptz null,
  delivered_at             timestamptz null,
  created_at               timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'communication_logs_channel_chk'
  ) then
    alter table public.communication_logs
      add constraint communication_logs_channel_chk
      check (channel in ('email','sms','in_app','system'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'communication_logs_status_chk'
  ) then
    alter table public.communication_logs
      add constraint communication_logs_status_chk
      check (status in ('queued','sent','delivered','failed','opened','clicked','skipped'));
  end if;
end $$;

create index if not exists communication_logs_user_idx
  on public.communication_logs (user_id, created_at desc);
create index if not exists communication_logs_appointment_idx
  on public.communication_logs (appointment_id)
  where appointment_id is not null;
create index if not exists communication_logs_request_idx
  on public.communication_logs (booking_request_id)
  where booking_request_id is not null;
create index if not exists communication_logs_contract_idx
  on public.communication_logs (booking_contract_id)
  where booking_contract_id is not null;

alter table public.communication_logs enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where policyname='communication_logs_owner_select' and tablename='communication_logs') then
    create policy "communication_logs_owner_select" on public.communication_logs
      for select to authenticated using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname='communication_logs_owner_insert' and tablename='communication_logs') then
    create policy "communication_logs_owner_insert" on public.communication_logs
      for insert to authenticated with check (auth.uid() = user_id);
  end if;
end $$;

-- =====================================================================
-- 5. RPC: get_public_contract_by_token
-- =====================================================================
-- Anon-callable. Returns ONLY the safe public surface. Side effect:
-- when status is 'pending' and viewed_at is null, mark the contract
-- as viewed so the stylist's queue reflects engagement.
create or replace function public.get_public_contract_by_token(token_in text)
returns table (
  id                  uuid,
  title               text,
  body_snapshot       text,
  status              text,
  client_name         text,
  client_email        text,
  signed_at           timestamptz,
  viewed_at           timestamptz,
  expires_at          timestamptz,
  require_signature   boolean,
  require_initials    boolean,
  business_name       text,
  service_name        text,
  preferred_date      date,
  preferred_time      text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  contract_row public.booking_contracts;
begin
  if token_in is null or trim(token_in) = '' then
    return;
  end if;

  select * into contract_row
  from public.booking_contracts bc
  where bc.public_token = token_in
  limit 1;

  if contract_row.id is null then
    return;
  end if;

  if contract_row.status = 'pending' and contract_row.viewed_at is null then
    update public.booking_contracts
    set status = 'viewed',
        viewed_at = now()
    where id = contract_row.id and viewed_at is null;
    contract_row.status := 'viewed';
    contract_row.viewed_at := now();
  end if;

  -- Optional template lookup for require_signature / require_initials.
  -- Falls back to defaults (true/false) if template was deleted.
  declare
    tmpl_require_sig boolean := true;
    tmpl_require_init boolean := false;
  begin
    select ct.require_signature, ct.require_initials
      into tmpl_require_sig, tmpl_require_init
    from public.contract_templates ct
    where ct.id = contract_row.contract_template_id
    limit 1;
    if tmpl_require_sig is null then tmpl_require_sig := true; end if;
    if tmpl_require_init is null then tmpl_require_init := false; end if;

    return query
    select
      contract_row.id,
      contract_row.title,
      contract_row.body_snapshot,
      contract_row.status,
      contract_row.client_name,
      contract_row.client_email,
      contract_row.signed_at,
      contract_row.viewed_at,
      contract_row.expires_at,
      tmpl_require_sig,
      tmpl_require_init,
      coalesce(p.business_name, p.full_name) as business_name,
      br.service_name,
      br.preferred_date,
      br.preferred_time
    from public.profiles p
    left join public.booking_requests br
      on br.id = contract_row.booking_request_id
    where p.id = contract_row.user_id
    limit 1;
  end;
end;
$$;

revoke all on function public.get_public_contract_by_token(text) from public;
grant execute on function public.get_public_contract_by_token(text) to anon, authenticated;

-- =====================================================================
-- 6. RPC: sign_public_contract
-- =====================================================================
create or replace function public.sign_public_contract(
  token_in           text,
  signed_name_in     text,
  signature_text_in  text,
  initials_in        text default null,
  ip_address_in      text default null,
  user_agent_in      text default null
)
returns public.booking_contracts
language plpgsql
security definer
set search_path = public
as $$
declare
  contract_row public.booking_contracts;
  tmpl_require_init boolean := false;
begin
  if token_in is null or trim(token_in) = '' then
    raise exception 'token_required';
  end if;
  if signed_name_in is null or trim(signed_name_in) = '' then
    raise exception 'signed_name_required';
  end if;
  if signature_text_in is null or trim(signature_text_in) = '' then
    raise exception 'signature_required';
  end if;

  select * into contract_row
  from public.booking_contracts
  where public_token = token_in
  limit 1;

  if contract_row.id is null then
    raise exception 'contract_not_found' using errcode = 'P0002';
  end if;
  if contract_row.status not in ('pending','viewed') then
    raise exception 'contract_not_signable_in_state_%', contract_row.status
      using errcode = 'P0001';
  end if;
  if contract_row.expires_at is not null and contract_row.expires_at < now() then
    raise exception 'contract_expired';
  end if;

  -- Initials enforcement when the linked template requires them.
  select ct.require_initials into tmpl_require_init
  from public.contract_templates ct
  where ct.id = contract_row.contract_template_id
  limit 1;
  if tmpl_require_init is true and (initials_in is null or trim(initials_in) = '') then
    raise exception 'initials_required';
  end if;

  update public.booking_contracts
  set status = 'signed',
      signed_at = now(),
      signed_name = trim(signed_name_in),
      signature_text = trim(signature_text_in),
      initials = nullif(trim(coalesce(initials_in, '')), ''),
      ip_address = nullif(trim(coalesce(ip_address_in, '')), ''),
      user_agent = nullif(trim(coalesce(user_agent_in, '')), '')
  where id = contract_row.id
  returning * into contract_row;

  -- Log the signature event. SECURITY DEFINER so anon clients can
  -- write a system-channel comm without RLS getting in the way.
  insert into public.communication_logs (
    user_id, client_id, booking_request_id, appointment_id,
    booking_contract_id, channel, message_type, recipient, subject,
    body, status, sent_at
  ) values (
    contract_row.user_id, contract_row.client_id, contract_row.booking_request_id,
    contract_row.appointment_id, contract_row.id, 'system', 'contract_signed',
    contract_row.client_email, contract_row.title,
    contract_row.signed_name || ' signed at ' || to_char(contract_row.signed_at at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') || ' UTC',
    'sent', now()
  );

  return contract_row;
end;
$$;

revoke all on function public.sign_public_contract(text, text, text, text, text, text) from public;
grant execute on function public.sign_public_contract(text, text, text, text, text, text) to anon, authenticated;

-- =====================================================================
-- 7. RPC: decline_public_contract
-- =====================================================================
create or replace function public.decline_public_contract(
  token_in        text,
  reason_in       text default null,
  ip_address_in   text default null,
  user_agent_in   text default null
)
returns public.booking_contracts
language plpgsql
security definer
set search_path = public
as $$
declare
  contract_row public.booking_contracts;
begin
  if token_in is null or trim(token_in) = '' then
    raise exception 'token_required';
  end if;

  select * into contract_row
  from public.booking_contracts
  where public_token = token_in
  limit 1;

  if contract_row.id is null then
    raise exception 'contract_not_found' using errcode = 'P0002';
  end if;
  if contract_row.status in ('signed','declined','expired','voided') then
    raise exception 'contract_terminal_state_%', contract_row.status
      using errcode = 'P0001';
  end if;

  update public.booking_contracts
  set status = 'declined',
      declined_at = now(),
      ip_address = nullif(trim(coalesce(ip_address_in, '')), ''),
      user_agent = nullif(trim(coalesce(user_agent_in, '')), '')
  where id = contract_row.id
  returning * into contract_row;

  insert into public.communication_logs (
    user_id, client_id, booking_request_id, appointment_id,
    booking_contract_id, channel, message_type, recipient, subject,
    body, status, sent_at
  ) values (
    contract_row.user_id, contract_row.client_id, contract_row.booking_request_id,
    contract_row.appointment_id, contract_row.id, 'system', 'contract_declined',
    contract_row.client_email, contract_row.title,
    coalesce(nullif(trim(coalesce(reason_in, '')), ''), 'Client declined the agreement.'),
    'sent', now()
  );

  return contract_row;
end;
$$;

revoke all on function public.decline_public_contract(text, text, text, text) from public;
grant execute on function public.decline_public_contract(text, text, text, text) to anon, authenticated;

-- =====================================================================
-- 8. RPC: generate_booking_contracts
-- =====================================================================
-- Called from the public booking submit flow. Creates one
-- booking_contracts row per attached template — both per-service
-- attachments AND any template flagged attach_to_all_bookings.
-- Snapshots the template title + body so later edits don't change
-- what the client agreed to. Avoids duplicates by checking the
-- (booking_request_id, contract_template_id) pair.
create or replace function public.generate_booking_contracts(
  booking_request_id_in uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  br_row public.booking_requests;
  inserted_count integer := 0;
begin
  if booking_request_id_in is null then
    return 0;
  end if;

  select * into br_row
  from public.booking_requests
  where id = booking_request_id_in
  limit 1;

  if br_row.id is null then
    return 0;
  end if;

  -- Insert one row per matching template (per-service join + global
  -- attach_to_all_bookings) that doesn't already have a contract on
  -- this request. Atomic and idempotent.
  with candidate_templates as (
    select ct.id as template_id, ct.title, ct.body
    from public.contract_templates ct
    where ct.user_id = br_row.user_id
      and ct.is_active = true
      and (
        ct.attach_to_all_bookings = true
        or exists (
          select 1
          from public.service_contract_templates sct
          where sct.contract_template_id = ct.id
            and sct.service_id = br_row.service_id
        )
      )
  ),
  to_insert as (
    select template_id, title, body
    from candidate_templates ct
    where not exists (
      select 1 from public.booking_contracts bc
      where bc.booking_request_id = br_row.id
        and bc.contract_template_id = ct.template_id
    )
  ),
  inserted as (
    insert into public.booking_contracts (
      user_id, client_id, booking_request_id, contract_template_id,
      title, body_snapshot,
      client_name, client_email, client_phone
    )
    select
      br_row.user_id,
      null,    -- client_id resolved later when stylist matches/creates the client
      br_row.id,
      template_id,
      title,
      body,
      br_row.client_name,
      br_row.client_email,
      br_row.client_phone
    from to_insert
    returning 1
  )
  select count(*) into inserted_count from inserted;

  return coalesce(inserted_count, 0);
end;
$$;

revoke all on function public.generate_booking_contracts(uuid) from public;
grant execute on function public.generate_booking_contracts(uuid) to anon, authenticated;

-- =====================================================================
-- 9. (No starter-template seed in SQL — the app exposes "Add starter
--     templates" button which inserts owner-scoped rows via the
--     authenticated path. Keeps RLS clean and lets the stylist see
--     every template appear with a clear timestamp.)
-- =====================================================================
