-- SMS credits — PR 1: prepaid balance + purchase.
--
-- Stylists buy prepaid SMS credit packs (a platform charge, like
-- founding access — NOT a Connect charge). 1 credit = 1 text.
-- PR 2 wires the notification worker to spend credits when texts
-- actually send.

-- ---------------------------------------------------------------
-- sms_credits — one row per stylist, the current balance.
-- ---------------------------------------------------------------
create table if not exists public.sms_credits (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  balance    integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.sms_credits enable row level security;
-- Read-only for the owner; balance changes go through the
-- SECURITY DEFINER RPCs (purchase here, consumption in PR 2).
drop policy if exists sms_credits_owner_select on public.sms_credits;
create policy sms_credits_owner_select on public.sms_credits
  for select using (user_id = auth.uid());

-- ---------------------------------------------------------------
-- sms_credit_purchases — one row per credit-pack purchase. The
-- UNIQUE stripe_session_id is the idempotency anchor.
-- ---------------------------------------------------------------
create table if not exists public.sms_credit_purchases (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  stripe_session_id  text unique,
  pack_id            text,
  credits            integer not null check (credits > 0),
  amount_cents       integer not null check (amount_cents >= 0),
  status             text not null default 'pending'
                       check (status in ('pending', 'paid', 'failed')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists sms_credit_purchases_user_idx
  on public.sms_credit_purchases (user_id, created_at desc);

alter table public.sms_credit_purchases enable row level security;
drop policy if exists sms_credit_purchases_owner_select on public.sms_credit_purchases;
create policy sms_credit_purchases_owner_select on public.sms_credit_purchases
  for select using (user_id = auth.uid());

-- ---------------------------------------------------------------
-- record_sms_credit_purchase — idempotent. Flips a pending
-- purchase to 'paid' and adds its credits to the balance, exactly
-- once. A Stripe replay finds the row already 'paid' and no-ops.
-- ---------------------------------------------------------------
create or replace function public.record_sms_credit_purchase(session_id_in text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user    uuid;
  v_credits integer;
begin
  update public.sms_credit_purchases
     set status = 'paid', updated_at = now()
   where stripe_session_id = session_id_in
     and status <> 'paid'
   returning user_id, credits into v_user, v_credits;

  if v_user is null then
    -- Unknown session, or already paid → nothing to do.
    return jsonb_build_object('ok', true, 'applied', false);
  end if;

  insert into public.sms_credits (user_id, balance)
  values (v_user, v_credits)
  on conflict (user_id) do update
    set balance    = public.sms_credits.balance + excluded.balance,
        updated_at = now();

  return jsonb_build_object('ok', true, 'applied', true, 'credits', v_credits);
end;
$function$;

revoke all on function public.record_sms_credit_purchase(text) from public;
grant execute on function public.record_sms_credit_purchase(text) to service_role;
