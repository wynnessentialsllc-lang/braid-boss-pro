-- Contract template schema alignment
--
-- Some environments already had the older V1 contract_templates table
-- (title/content/is_active) before Phase B12 shipped. The B12 migration used
-- CREATE TABLE IF NOT EXISTS, so it did not add the newer columns there.

alter table public.contract_templates
  add column if not exists template_type text default 'booking_agreement',
  add column if not exists body text,
  add column if not exists require_signature boolean not null default true,
  add column if not exists require_initials boolean not null default false,
  add column if not exists attach_to_all_bookings boolean not null default false;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'contract_templates'
      and column_name = 'content'
  ) then
    execute 'update public.contract_templates set body = coalesce(body, content)';
  end if;
end $$;

update public.contract_templates
set body = coalesce(body, '')
where body is null;

alter table public.contract_templates
  alter column template_type set not null,
  alter column body set not null;

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

alter table public.services
  add column if not exists contract_template_id uuid references public.contract_templates(id) on delete set null;

create index if not exists services_contract_template_id_idx
  on public.services (contract_template_id);

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

  with candidate_templates as (
    select ct.id as template_id, ct.title, ct.body
    from public.contract_templates ct
    where ct.user_id = br_row.user_id
      and ct.is_active = true
      and (
        ct.attach_to_all_bookings = true
        or exists (
          select 1
          from public.services s
          where s.id = br_row.service_id
            and s.contract_template_id = ct.id
        )
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
      null,
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
