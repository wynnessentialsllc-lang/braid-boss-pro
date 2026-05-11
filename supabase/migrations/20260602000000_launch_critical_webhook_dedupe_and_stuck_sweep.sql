-- Launch-critical: Stripe webhook event-ID dedupe + notification queue
-- stuck-row sweep.
--
-- Item #1 — Stripe webhook idempotency
-- ----------------------------------------------------------------
-- The mark_deposit_paid_via_webhook RPC is internally idempotent
-- (no-op once a row is past awaiting_deposit), but the
-- "read approval_status → write" pattern still has a race window
-- where two simultaneously-replayed events can both pass the
-- check. Stripe replays on any 5xx, and a flaky deploy can briefly
-- emit both. Plus, the post-RPC `update deposit_amount` write is
-- not guarded by the same idempotency check.
--
-- This table is the canonical source of truth for which Stripe
-- event IDs we've already accepted. Both webhook routes
-- (app/api/booking-deposit/webhook and app/api/stripe-connect/webhook)
-- INSERT into it with ON CONFLICT DO NOTHING immediately after
-- signature verification. A duplicate event_id returns 0 rows and
-- the handler short-circuits to 200 "already processed".
--
-- Item #2 — Notification queue stuck-row sweep
-- ----------------------------------------------------------------
-- mark_notification_processing claims rows by flipping their status
-- to 'processing'. If the worker crashes mid-send (edge function
-- timeout, OOM, panic), the row stays in 'processing' forever —
-- never retried, silent data loss. Add a sweeper RPC the worker
-- calls at the top of every tick to reset rows that have been
-- 'processing' for more than 30 minutes back to 'queued'.

-- =====================================================================
-- 1. stripe_webhook_events — idempotency log
-- =====================================================================
create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  endpoint text not null,                  -- 'booking_deposit' | 'stripe_connect'
  account_id text,                          -- evt.account for Connect; null for platform
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  result jsonb
);

comment on table public.stripe_webhook_events is
  'Idempotency log for Stripe webhook deliveries. Insert with ON CONFLICT DO NOTHING; a 0-row insert means the event was already accepted.';

-- For retention monitoring; we'll never query by these aside from
-- ad-hoc debug.
create index if not exists stripe_webhook_events_received_at_idx
  on public.stripe_webhook_events (received_at desc);
create index if not exists stripe_webhook_events_endpoint_type_idx
  on public.stripe_webhook_events (endpoint, event_type, received_at desc);

-- RLS — service role only. No app-side reads.
alter table public.stripe_webhook_events enable row level security;
-- (no policies → fully locked down to service role / definers)

-- =====================================================================
-- 2. record_stripe_webhook_event — atomic claim
-- =====================================================================
-- Returns true when this is the first time we've seen the event,
-- false when it's a duplicate. Webhook handler calls this BEFORE
-- doing any side-effect work.
create or replace function public.record_stripe_webhook_event(
  event_id_in text,
  event_type_in text,
  endpoint_in text,
  account_id_in text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted boolean;
begin
  if event_id_in is null or trim(event_id_in) = '' then
    -- Malformed — caller should treat as already-processed to avoid
    -- retrying garbage forever.
    return false;
  end if;
  insert into public.stripe_webhook_events (event_id, event_type, endpoint, account_id)
  values (event_id_in, coalesce(event_type_in, 'unknown'), coalesce(endpoint_in, 'unknown'), account_id_in)
  on conflict (event_id) do nothing
  returning true into inserted;
  return coalesce(inserted, false);
end;
$$;

revoke all on function public.record_stripe_webhook_event(text, text, text, text) from public;
-- Webhook routes use the service role client, so this grant matters
-- only if a future caller authenticates as service_role explicitly.
grant execute on function public.record_stripe_webhook_event(text, text, text, text) to service_role;

-- Optional helper for marking the event "processed" after the work
-- succeeds. Useful for debug / dashboards. Not required for the
-- dedupe contract — the row exists, that's enough.
create or replace function public.mark_stripe_webhook_event_processed(
  event_id_in text,
  result_in jsonb default null
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.stripe_webhook_events
  set processed_at = now(),
      result = coalesce(result_in, result)
  where event_id = event_id_in;
$$;

revoke all on function public.mark_stripe_webhook_event_processed(text, jsonb) from public;
grant execute on function public.mark_stripe_webhook_event_processed(text, jsonb) to service_role;

-- =====================================================================
-- 3. sweep_stuck_notifications — recover crashed workers
-- =====================================================================
-- Resets rows that have been in 'processing' state past the cutoff
-- back to 'queued', preserving retry_count so retry caps still
-- apply. Worker calls this at the top of each tick; cheap when
-- there's nothing to sweep (single indexed scan + UPDATE on the
-- partial set).
create or replace function public.sweep_stuck_notifications(
  stuck_after_minutes_in integer default 30
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  swept integer;
  cutoff timestamptz;
begin
  cutoff := now() - make_interval(mins => greatest(1, coalesce(stuck_after_minutes_in, 30)));
  with bumped as (
    update public.notification_queue
    set status = 'queued',
        processing_started_at = null,
        failure_reason = coalesce(failure_reason, 'reclaimed_after_stuck_in_processing')
    where status = 'processing'
      and processing_started_at is not null
      and processing_started_at < cutoff
    returning 1
  )
  select count(*)::integer into swept from bumped;
  return coalesce(swept, 0);
end;
$$;

revoke all on function public.sweep_stuck_notifications(integer) from public;
grant execute on function public.sweep_stuck_notifications(integer) to service_role;
grant execute on function public.sweep_stuck_notifications(integer) to authenticated;

-- =====================================================================
-- Verification
-- =====================================================================
-- -- 1. Table + indexes
-- select tablename from pg_tables where schemaname='public' and tablename='stripe_webhook_events';
-- select indexname from pg_indexes where schemaname='public' and tablename='stripe_webhook_events';
--
-- -- 2. RPCs present
-- select proname from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname='public'
--     and proname in ('record_stripe_webhook_event','mark_stripe_webhook_event_processed','sweep_stuck_notifications');
--
-- -- 3. Synthetic dedupe round-trip
-- select public.record_stripe_webhook_event('evt_test_1','checkout.session.completed','booking_deposit', null); -- true
-- select public.record_stripe_webhook_event('evt_test_1','checkout.session.completed','booking_deposit', null); -- false
-- delete from public.stripe_webhook_events where event_id='evt_test_1';
--
-- -- 4. Synthetic stuck-row sweep (only run on a dev env with seed rows)
-- -- update public.notification_queue set status='processing',
-- --   processing_started_at = now() - interval '1 hour'
-- -- where status='queued' limit 1;
-- -- select public.sweep_stuck_notifications(30);
