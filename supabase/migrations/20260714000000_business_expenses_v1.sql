-- Business Expenses V1 — lets the braider track outflows, recurring
-- subscriptions, and an estimated profit number alongside revenue.
-- Structured to extend later (tax estimates, style profitability,
-- inventory) without another table.
--
-- Same sync shape as the rest of the app (`user_id uuid + id text`
-- composite PK, free-form `data jsonb` for anything the UI keeps
-- adding) so the existing toCloudRow/fromCloudRow pipeline can carry
-- it. Receipt images live in a private `receipts` Storage bucket;
-- this row only stores the path.

create table if not exists public.business_expenses (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  title text,
  amount numeric(12, 2) not null default 0 check (amount >= 0),
  category text,
  note text,
  expense_date date,
  is_recurring boolean not null default false,
  recurring_interval text,
  next_billing_date date,
  receipt_path text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists business_expenses_user_date_idx
  on public.business_expenses (user_id, expense_date desc);

create index if not exists business_expenses_user_recurring_idx
  on public.business_expenses (user_id, is_recurring)
  where is_recurring = true;

alter table public.business_expenses enable row level security;

drop policy if exists "business_expenses_self_select" on public.business_expenses;
create policy "business_expenses_self_select" on public.business_expenses
  for select using (auth.uid() = user_id);

drop policy if exists "business_expenses_self_insert" on public.business_expenses;
create policy "business_expenses_self_insert" on public.business_expenses
  for insert with check (auth.uid() = user_id);

drop policy if exists "business_expenses_self_update" on public.business_expenses;
create policy "business_expenses_self_update" on public.business_expenses
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "business_expenses_self_delete" on public.business_expenses;
create policy "business_expenses_self_delete" on public.business_expenses
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on public.business_expenses to authenticated;

create or replace function public.business_expenses_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists business_expenses_touch on public.business_expenses;
create trigger business_expenses_touch
  before update on public.business_expenses
  for each row
  execute function public.business_expenses_touch_updated_at();

-- Private Supabase Storage bucket for optional receipt images.
-- Path convention: `{auth.uid()}/{expense_id}.<ext>`. RLS on
-- storage.objects pins reads/writes to the leading folder so a user
-- can never touch another stylist's receipt.
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do update set public = false;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='receipts_owner_select'
  ) then
    create policy receipts_owner_select
      on storage.objects for select to authenticated
      using (
        bucket_id = 'receipts'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='receipts_owner_insert'
  ) then
    create policy receipts_owner_insert
      on storage.objects for insert to authenticated
      with check (
        bucket_id = 'receipts'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='receipts_owner_update'
  ) then
    create policy receipts_owner_update
      on storage.objects for update to authenticated
      using (
        bucket_id = 'receipts'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
      with check (
        bucket_id = 'receipts'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='receipts_owner_delete'
  ) then
    create policy receipts_owner_delete
      on storage.objects for delete to authenticated
      using (
        bucket_id = 'receipts'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;
end $$;
