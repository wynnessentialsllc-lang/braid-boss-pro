-- Phase 1: Contract Templates V1
--
-- Adds reusable contract templates that services can optionally attach.
-- No signing, no emails, no PDFs yet — just storage and association.

create table if not exists public.contract_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  content text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS: users manage their own templates
drop policy if exists "contract_templates_self_select" on public.contract_templates;
create policy "contract_templates_self_select" on public.contract_templates
  for select using (auth.uid() = user_id);

drop policy if exists "contract_templates_self_insert" on public.contract_templates;
create policy "contract_templates_self_insert" on public.contract_templates
  for insert with check (auth.uid() = user_id);

drop policy if exists "contract_templates_self_update" on public.contract_templates;
create policy "contract_templates_self_update" on public.contract_templates
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "contract_templates_self_delete" on public.contract_templates;
create policy "contract_templates_self_delete" on public.contract_templates
  for delete using (auth.uid() = user_id);

-- Table-level grants
grant select, insert, update, delete on public.contract_templates to authenticated;

-- Auto-bump updated_at
create or replace function public.contract_templates_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists contract_templates_touch on public.contract_templates;
create trigger contract_templates_touch
  before update on public.contract_templates
  for each row
  execute function public.contract_templates_touch_updated_at();

-- Add contract_template_id to services
alter table public.services
  add column if not exists contract_template_id uuid references public.contract_templates(id) on delete set null;

-- Index for joins
create index if not exists services_contract_template_id_idx on public.services (contract_template_id);

-- Update public_list_services to include contract_template_id
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
  max_concurrent integer,
  contract_template_id uuid
)
language sql
security definer
set search_path = public
as $$
  select
    s.id, s.name, s.description, s.duration_hours, s.base_price,
    s.deposit_required, s.deposit_amount, s.add_ons, s.prep_instructions,
    s.buffer_before_minutes, s.buffer_after_minutes, s.max_concurrent,
    s.contract_template_id
  from public.services s
  inner join public.booking_links bl on bl.user_id = s.user_id
  where bl.slug = slug_in
    and bl.active = true
    and s.is_active = true
  order by s.name asc;
$$;