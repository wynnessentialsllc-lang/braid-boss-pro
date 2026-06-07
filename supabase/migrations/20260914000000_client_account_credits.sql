-- Client account credit — a per-client store-credit ledger.
--
-- Lets a stylist put a dollar credit on a client's account (e.g. to make
-- good on a last-minute cancellation) that is later applied to the
-- BALANCE of one of that client's appointments. The deposit flow is
-- untouched: a returning client still pays their deposit to book; the
-- credit only draws down what's owed afterward.
--
-- Design mirrors referral_rewards (the app's existing "account credit"):
-- an append-only-ish ledger of signed entries. Balance for a client is
-- simply sum(amount):
--   * grant  — positive: credit added to the account
--   * redeem — negative: credit applied to an appointment balance
--   * adjust — signed manual correction
--   * void   — reverses a prior entry (signed opposite)
--
-- Grants are surfaced + created client-side (RLS-scoped to the owner,
-- like discounts). Redemptions are written when the stylist applies the
-- credit to an appointment. A partial unique index keeps at most one
-- live redeem row per appointment so re-saving an appointment can't
-- double-spend the credit.

create table if not exists public.client_credits (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  client_id       text not null,
  -- Signed dollars. Positive adds credit, negative consumes it.
  amount          numeric(12, 2) not null,
  kind            text not null default 'grant'
                  check (kind in ('grant', 'redeem', 'adjust', 'void')),
  reason          text,
  -- Set on redeem rows: which appointment the credit was applied to.
  appointment_id  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists client_credits_user_client_idx
  on public.client_credits (user_id, client_id);

-- At most one redeem row per appointment — lets the app upsert the
-- applied amount on every save without stacking redemptions.
create unique index if not exists client_credits_one_redeem_per_appt
  on public.client_credits (user_id, appointment_id)
  where kind = 'redeem' and appointment_id is not null;

alter table public.client_credits enable row level security;

drop policy if exists "client_credits_self_select" on public.client_credits;
create policy "client_credits_self_select" on public.client_credits
  for select using (auth.uid() = user_id);

drop policy if exists "client_credits_self_insert" on public.client_credits;
create policy "client_credits_self_insert" on public.client_credits
  for insert with check (auth.uid() = user_id);

drop policy if exists "client_credits_self_update" on public.client_credits;
create policy "client_credits_self_update" on public.client_credits
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "client_credits_self_delete" on public.client_credits;
create policy "client_credits_self_delete" on public.client_credits
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on public.client_credits to authenticated;

create or replace function public.client_credits_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists client_credits_touch on public.client_credits;
create trigger client_credits_touch
  before update on public.client_credits
  for each row execute function public.client_credits_touch_updated_at();

-- ---------------------------------------------------------------
-- apply_client_credit_to_appointment — idempotent redemption.
--
-- Writes (or rewrites) the single redeem row for an appointment so the
-- credit applied equals `amount_in`, capped at the client's currently
-- available balance (available = grants/adjusts minus the OTHER
-- appointments' redemptions). Re-running with the same or a different
-- amount is safe: it never spends more than is available and never
-- stacks rows. Pass amount_in = 0 to remove the credit from an
-- appointment.
--
-- Returns the amount actually applied + the remaining balance.
-- ---------------------------------------------------------------
create or replace function public.apply_client_credit_to_appointment(
  client_id_in      text,
  appointment_id_in text,
  amount_in         numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller        uuid;
  v_available   numeric;
  v_apply       numeric;
begin
  caller := auth.uid();
  if caller is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;
  if client_id_in is null or appointment_id_in is null then
    raise exception 'client_and_appointment_required' using errcode = '22023';
  end if;

  -- Available = every entry for this client EXCEPT the redeem row we're
  -- about to overwrite for this appointment. That makes the call
  -- idempotent (re-applying doesn't count the prior redemption twice).
  select coalesce(sum(amount), 0) into v_available
  from public.client_credits
  where user_id = caller
    and client_id = client_id_in
    and not (kind = 'redeem' and appointment_id = appointment_id_in);

  v_apply := least(greatest(coalesce(amount_in, 0), 0), greatest(v_available, 0));
  v_apply := round(v_apply, 2);

  -- Remove any existing redemption for this appointment, then add the
  -- new one (negative). Zero clears it without leaving a row.
  delete from public.client_credits
  where user_id = caller
    and kind = 'redeem'
    and appointment_id = appointment_id_in;

  if v_apply > 0 then
    insert into public.client_credits
      (user_id, client_id, amount, kind, reason, appointment_id)
    values
      (caller, client_id_in, -v_apply, 'redeem',
       'Applied to appointment balance', appointment_id_in);
  end if;

  return jsonb_build_object(
    'ok', true,
    'applied', v_apply,
    'remaining', round(greatest(v_available - v_apply, 0), 2)
  );
end;
$$;

revoke all on function public.apply_client_credit_to_appointment(text, text, numeric) from public;
grant execute on function public.apply_client_credit_to_appointment(text, text, numeric)
  to authenticated;
