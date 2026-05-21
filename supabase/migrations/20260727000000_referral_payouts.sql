-- Referral payouts V1 — track referrals, reward as account credit.
--
-- Roadmap item #16. A client refers a friend; when that friend
-- completes their FIRST paid appointment the referring client
-- earns a fixed account credit. "Account credit" (not a Stripe
-- transfer) because a braiding client will never complete Stripe
-- KYC onboarding for a small reward — the credit is applied as a
-- discount on the referrer's own next appointment.
--
-- Attribution V1 is manual: the stylist sets "referred by" on the
-- new client's profile (clients.referred_by_client_id). A shareable
-- referral link with automatic capture is a clean follow-up that
-- doesn't touch this reward engine.

-- ---------------------------------------------------------------
-- Who referred this client
-- ---------------------------------------------------------------
alter table public.clients
  add column if not exists referred_by_client_id text;

-- ---------------------------------------------------------------
-- Per-stylist referral settings
-- ---------------------------------------------------------------
-- Off by default — referrals only run once the stylist sets a
-- reward amount and flips it on. The cron also gates on
-- referral_reward_amount > 0 so a 0 reward never creates rows.
alter table public.shop_settings
  add column if not exists referral_enabled boolean not null default false,
  add column if not exists referral_reward_amount numeric(12, 2) not null default 0
    check (referral_reward_amount >= 0);

-- ---------------------------------------------------------------
-- Reward ledger
-- ---------------------------------------------------------------
-- One row per (stylist, referred client) — the unique constraint
-- guarantees a person can only ever generate one referral reward,
-- so a referrer can't be double-credited if the cron re-runs.
--   status: earned    — credit available to apply
--           redeemed  — stylist applied it to the referrer's appt
--           void      — manually cancelled (fraud, mistake)
create table if not exists public.referral_rewards (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  referrer_client_id    text not null,
  referred_client_id    text not null,
  trigger_appointment_id text,
  amount                numeric(12, 2) not null default 0 check (amount >= 0),
  status                text not null default 'earned'
                        check (status in ('earned', 'redeemed', 'void')),
  earned_at             timestamptz not null default now(),
  redeemed_at           timestamptz,
  redeemed_note         text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (user_id, referred_client_id)
);

create index if not exists referral_rewards_user_referrer_idx
  on public.referral_rewards (user_id, referrer_client_id, status);

alter table public.referral_rewards enable row level security;

drop policy if exists "referral_rewards_self_select" on public.referral_rewards;
create policy "referral_rewards_self_select" on public.referral_rewards
  for select using (auth.uid() = user_id);

-- Update only — to mark a reward redeemed or void. Inserts come
-- exclusively from process_referral_rewards (security definer, runs
-- as owner, bypasses RLS). No client-side insert path.
drop policy if exists "referral_rewards_self_update" on public.referral_rewards;
create policy "referral_rewards_self_update" on public.referral_rewards
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, update on public.referral_rewards to authenticated;

create or replace function public.referral_rewards_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists referral_rewards_touch on public.referral_rewards;
create trigger referral_rewards_touch
  before update on public.referral_rewards
  for each row execute function public.referral_rewards_touch_updated_at();

-- ---------------------------------------------------------------
-- Reward processor
-- ---------------------------------------------------------------
-- Daily scan: for every client who was referred by someone, has at
-- least one paid appointment, and has no reward row yet — credit the
-- referrer. The lateral join yields no row when the referred client
-- has no paid appointment, so that gate is implicit. The unique
-- (user_id, referred_client_id) constraint + ON CONFLICT DO NOTHING
-- make the whole thing safe to re-run.
create or replace function public.process_referral_rewards()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int := 0;
  r record;
begin
  for r in
    select
      c.user_id,
      c.id                       as referred_id,
      c.referred_by_client_id    as referrer_id,
      ss.referral_reward_amount  as amount,
      fa.appt_id                 as trigger_appt
    from public.clients c
    join public.shop_settings ss on ss.user_id = c.user_id
    join public.clients ref
      on ref.user_id = c.user_id
     and ref.id = c.referred_by_client_id
    cross join lateral (
      select a.id as appt_id
      from public.appointments a
      where a.user_id = c.user_id
        and a.client_id = c.id
        and a.status not in ('cancelled', 'canceled')
        and (a.status = 'completed' or a.payment_status = 'paid')
      order by a.appt_date asc nulls last
      limit 1
    ) fa
    where c.referred_by_client_id is not null
      and c.referred_by_client_id <> c.id
      and ss.referral_enabled = true
      and ss.referral_reward_amount > 0
      and not exists (
        select 1 from public.referral_rewards rr
        where rr.user_id = c.user_id
          and rr.referred_client_id = c.id
      )
  loop
    insert into public.referral_rewards (
      user_id, referrer_client_id, referred_client_id,
      trigger_appointment_id, amount, status
    ) values (
      r.user_id, r.referrer_id, r.referred_id,
      r.trigger_appt, r.amount, 'earned'
    )
    on conflict (user_id, referred_client_id) do nothing;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

revoke all on function public.process_referral_rewards() from public;
grant execute on function public.process_referral_rewards() to service_role;

-- Daily cron at 17:00 UTC alongside the marketing scanners.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'referral_rewards_daily') then
    perform cron.unschedule('referral_rewards_daily');
  end if;
end $$;

select cron.schedule(
  'referral_rewards_daily',
  '0 17 * * *',
  $$select public.process_referral_rewards();$$
);
