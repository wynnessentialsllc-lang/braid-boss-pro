-- Phase B12.1a — Email notification queue foundation.
--
-- Universal outbound queue. SMS, scheduled reminders, and UI come in
-- later phases (B12.1b–e). This migration ships:
--   1. notification_queue table (durable, multi-worker safe)
--   2. communication_logs additive columns (no destructive changes)
--   3. RLS owner-only on notification_queue
--   4. set_updated_at_timestamp trigger
--   5. 5 RPCs:
--        queue_notification          — idempotent enqueue with dedupe
--        get_due_notifications       — read-only inspection (no claim)
--        mark_notification_processing — atomic claim via
--                                       FOR UPDATE SKIP LOCKED; used
--                                       by the dispatch worker
--        mark_notification_sent      — success transition + comm-log
--                                       mirror
--        mark_notification_failed    — backoff + retry up to 3 attempts,
--                                       then terminal failure
--
-- Architecture decisions live in docs/b12_1_notification_architecture.md
-- and docs/b12_collision_audit.md. This migration does not redesign
-- the queue — it implements the spec verbatim.
--
-- Idempotent throughout. Re-runnable.

-- =====================================================================
-- 1. notification_queue
-- =====================================================================
create table if not exists public.notification_queue (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references auth.users(id) on delete cascade,

  booking_request_id      uuid null,
  appointment_id          text null,
  client_id               text null,
  contract_id             uuid null,

  channel                 text not null default 'email',
  notification_type       text not null,

  recipient_name          text null,
  recipient_email         text null,
  recipient_phone         text null,

  subject                 text null,
  body                    text not null,
  payload                 jsonb not null default '{}'::jsonb,

  scheduled_for           timestamptz not null default now(),

  status                  text not null default 'queued',
  processing_started_at   timestamptz null,
  sent_at                 timestamptz null,
  delivered_at            timestamptz null,
  failed_at               timestamptz null,

  provider                text null,
  provider_message_id     text null,

  retry_count             integer not null default 0,
  failure_reason          text null,

  dedupe_key              text null,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'notification_queue_status_chk'
  ) then
    alter table public.notification_queue
      add constraint notification_queue_status_chk
      check (status in ('queued','processing','sent','delivered','failed','canceled'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'notification_queue_channel_chk'
  ) then
    alter table public.notification_queue
      add constraint notification_queue_channel_chk
      check (channel in ('email','sms'));
  end if;
end $$;

create index if not exists notification_queue_user_idx
  on public.notification_queue (user_id);
create index if not exists notification_queue_status_idx
  on public.notification_queue (status);
create index if not exists notification_queue_scheduled_idx
  on public.notification_queue (scheduled_for);
create index if not exists notification_queue_contract_idx
  on public.notification_queue (contract_id)
  where contract_id is not null;
create index if not exists notification_queue_request_idx
  on public.notification_queue (booking_request_id)
  where booking_request_id is not null;
create index if not exists notification_queue_dedupe_lookup_idx
  on public.notification_queue (dedupe_key)
  where dedupe_key is not null;

-- Composite — the dispatch worker's hot path. Lets it pull "ready
-- now, owner-scoped" rows without touching the rest of the table.
create index if not exists notification_queue_due_idx
  on public.notification_queue (user_id, status, scheduled_for);

-- Unique partial — the dedupe contract used by queue_notification's
-- on-conflict path. Non-null dedupe_key values must be unique
-- per-queue, regardless of user (callers prefix keys with the
-- relevant scope).
create unique index if not exists notification_queue_dedupe_uniq_idx
  on public.notification_queue (dedupe_key)
  where dedupe_key is not null;

drop trigger if exists notification_queue_touch_updated_at on public.notification_queue;
create trigger notification_queue_touch_updated_at
  before update on public.notification_queue
  for each row execute function public.set_updated_at_timestamp();

alter table public.notification_queue enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where policyname='notification_queue_owner_select' and tablename='notification_queue') then
    create policy "notification_queue_owner_select" on public.notification_queue
      for select to authenticated using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname='notification_queue_owner_insert' and tablename='notification_queue') then
    create policy "notification_queue_owner_insert" on public.notification_queue
      for insert to authenticated with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname='notification_queue_owner_update' and tablename='notification_queue') then
    create policy "notification_queue_owner_update" on public.notification_queue
      for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname='notification_queue_owner_delete' and tablename='notification_queue') then
    create policy "notification_queue_owner_delete" on public.notification_queue
      for delete to authenticated using (auth.uid() = user_id);
  end if;
end $$;

-- =====================================================================
-- 2. communication_logs additive upgrades
-- =====================================================================
alter table public.communication_logs
  add column if not exists notification_queue_id   uuid,
  add column if not exists delivery_provider       text,
  add column if not exists delivery_status         text,
  add column if not exists metadata                jsonb not null default '{}'::jsonb;

-- provider_message_id / delivered_at / failed_at already exist on
-- communication_logs from the B12.0 migration; the spec asks for
-- "add if not exists" so the alter below is a no-op in our case.
alter table public.communication_logs
  add column if not exists provider_message_id     text,
  add column if not exists delivered_at            timestamptz,
  add column if not exists failed_at               timestamptz;

create index if not exists communication_logs_queue_idx
  on public.communication_logs (notification_queue_id)
  where notification_queue_id is not null;

-- =====================================================================
-- 3. RPC: queue_notification — idempotent enqueue
-- =====================================================================
-- SECURITY DEFINER. Accepts both authenticated-owner calls and
-- service-role calls (auth.uid() is null under service_role; we let
-- it through so the dispatch worker / webhook handlers can enqueue
-- follow-ups). When called as an authenticated user, the auth.uid()
-- must match user_id_in. Dedupe by dedupe_key when provided —
-- ON CONFLICT against the partial unique index makes duplicates a
-- no-op so retried call sites never double-send.
create or replace function public.queue_notification(
  user_id_in            uuid,
  channel_in            text,
  notification_type_in  text,
  body_in               text,
  subject_in            text          default null,
  recipient_email_in    text          default null,
  recipient_phone_in    text          default null,
  recipient_name_in     text          default null,
  payload_in            jsonb         default '{}'::jsonb,
  scheduled_for_in      timestamptz   default null,
  dedupe_key_in         text          default null,
  booking_request_id_in uuid          default null,
  appointment_id_in     text          default null,
  client_id_in          text          default null,
  contract_id_in        uuid          default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller        uuid;
  new_id        uuid;
  resolved_when timestamptz;
begin
  caller := auth.uid();
  if caller is not null and caller <> user_id_in then
    raise exception 'user_mismatch' using errcode = '42501';
  end if;
  if user_id_in is null then
    raise exception 'user_id_required' using errcode = '22023';
  end if;
  if channel_in is null or channel_in not in ('email','sms') then
    raise exception 'invalid_channel' using errcode = '22023';
  end if;
  if notification_type_in is null or trim(notification_type_in) = '' then
    raise exception 'notification_type_required' using errcode = '22023';
  end if;
  if body_in is null then
    raise exception 'body_required' using errcode = '22023';
  end if;
  -- Channel-specific recipient sanity. Don't enqueue rows that the
  -- dispatcher will immediately reject.
  if channel_in = 'email' and (recipient_email_in is null or position('@' in recipient_email_in) = 0) then
    return jsonb_build_object(
      'ok', false, 'skipped', true, 'reason', 'no_recipient_email'
    );
  end if;
  if channel_in = 'sms' and (recipient_phone_in is null or length(trim(recipient_phone_in)) < 7) then
    return jsonb_build_object(
      'ok', false, 'skipped', true, 'reason', 'no_recipient_phone'
    );
  end if;

  resolved_when := coalesce(scheduled_for_in, now());

  if dedupe_key_in is not null and trim(dedupe_key_in) <> '' then
    insert into public.notification_queue (
      user_id, channel, notification_type,
      recipient_name, recipient_email, recipient_phone,
      subject, body, payload, scheduled_for,
      dedupe_key,
      booking_request_id, appointment_id, client_id, contract_id
    ) values (
      user_id_in, channel_in, notification_type_in,
      recipient_name_in, recipient_email_in, recipient_phone_in,
      subject_in, body_in, coalesce(payload_in, '{}'::jsonb), resolved_when,
      dedupe_key_in,
      booking_request_id_in, appointment_id_in, client_id_in, contract_id_in
    )
    on conflict (dedupe_key) where dedupe_key is not null do nothing
    returning id into new_id;

    if new_id is null then
      return jsonb_build_object(
        'ok', true, 'skipped', true, 'reason', 'dedupe_match'
      );
    end if;
    return jsonb_build_object('ok', true, 'id', new_id, 'skipped', false);
  end if;

  insert into public.notification_queue (
    user_id, channel, notification_type,
    recipient_name, recipient_email, recipient_phone,
    subject, body, payload, scheduled_for,
    booking_request_id, appointment_id, client_id, contract_id
  ) values (
    user_id_in, channel_in, notification_type_in,
    recipient_name_in, recipient_email_in, recipient_phone_in,
    subject_in, body_in, coalesce(payload_in, '{}'::jsonb), resolved_when,
    booking_request_id_in, appointment_id_in, client_id_in, contract_id_in
  )
  returning id into new_id;

  return jsonb_build_object('ok', true, 'id', new_id, 'skipped', false);
end;
$$;

revoke all on function public.queue_notification(
  uuid, text, text, text, text, text, text, text, jsonb, timestamptz,
  text, uuid, text, text, uuid
) from public;
grant execute on function public.queue_notification(
  uuid, text, text, text, text, text, text, text, jsonb, timestamptz,
  text, uuid, text, text, uuid
) to authenticated, service_role;

-- =====================================================================
-- 4. RPC: get_due_notifications — read-only inspection
-- =====================================================================
-- Returns up to `limit_in` queued rows whose scheduled_for has passed.
-- Does NOT claim them — the worker uses mark_notification_processing
-- for that. This function is for dashboards, debugging, and tests.
create or replace function public.get_due_notifications(
  limit_in integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid;
  rows_json jsonb;
begin
  caller := auth.uid();
  -- Only the owner sees their own rows; service role (caller is null)
  -- gets everything for worker introspection.
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
    into rows_json
  from (
    select id, user_id, channel, notification_type,
           recipient_email, recipient_phone, recipient_name,
           subject, body, payload,
           scheduled_for, status, retry_count, dedupe_key,
           booking_request_id, appointment_id, client_id, contract_id
    from public.notification_queue
    where status = 'queued'
      and scheduled_for <= now()
      and (caller is null or user_id = caller)
    order by scheduled_for asc
    limit greatest(1, least(coalesce(limit_in, 25), 200))
  ) t;
  return jsonb_build_object('rows', rows_json);
end;
$$;

revoke all on function public.get_due_notifications(integer) from public;
grant execute on function public.get_due_notifications(integer) to authenticated, service_role;

-- =====================================================================
-- 5. RPC: mark_notification_processing — atomic claim
-- =====================================================================
-- Worker's claim path. Uses SELECT ... FOR UPDATE SKIP LOCKED so
-- multiple concurrent invocations (parallel cron runs, manual
-- re-runs) never claim the same row twice. Returns the claimed
-- rows as a jsonb array.
create or replace function public.mark_notification_processing(
  limit_in integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_ids uuid[];
  rows_json jsonb;
begin
  with candidates as (
    select id
    from public.notification_queue
    where status = 'queued'
      and scheduled_for <= now()
    order by scheduled_for asc
    limit greatest(1, least(coalesce(limit_in, 25), 200))
    for update skip locked
  ),
  claimed as (
    update public.notification_queue nq
    set status = 'processing',
        processing_started_at = now()
    from candidates c
    where nq.id = c.id
    returning nq.id
  )
  select array_agg(id) into claimed_ids from claimed;

  if claimed_ids is null or array_length(claimed_ids, 1) = 0 then
    return jsonb_build_object('rows', '[]'::jsonb, 'claimed', 0);
  end if;

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
    into rows_json
  from (
    select id, user_id, channel, notification_type,
           recipient_email, recipient_phone, recipient_name,
           subject, body, payload,
           scheduled_for, status, retry_count, dedupe_key,
           booking_request_id, appointment_id, client_id, contract_id
    from public.notification_queue
    where id = any(claimed_ids)
  ) t;

  return jsonb_build_object(
    'rows', rows_json,
    'claimed', coalesce(array_length(claimed_ids, 1), 0)
  );
end;
$$;

revoke all on function public.mark_notification_processing(integer) from public;
grant execute on function public.mark_notification_processing(integer) to service_role;

-- =====================================================================
-- 6. RPC: mark_notification_sent
-- =====================================================================
-- Worker calls this after a successful provider send. Transitions
-- the queue row to `sent` and mirrors the outcome to
-- communication_logs (insert when not yet present, update when it
-- already is — keyed by notification_queue_id).
create or replace function public.mark_notification_sent(
  id_in                    uuid,
  provider_in              text default null,
  provider_message_id_in   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  q_row public.notification_queue;
begin
  update public.notification_queue
  set status = 'sent',
      sent_at = now(),
      provider = coalesce(provider_in, provider),
      provider_message_id = coalesce(provider_message_id_in, provider_message_id),
      failed_at = null,
      failure_reason = null
  where id = id_in
  returning * into q_row;

  if q_row.id is null then
    raise exception 'notification_not_found' using errcode = 'P0002';
  end if;

  -- Mirror to communication_logs. If a row already exists (from a
  -- previous attempt), update it; otherwise insert.
  insert into public.communication_logs (
    user_id, client_id, booking_request_id, appointment_id,
    booking_contract_id,
    channel, message_type, recipient, subject, body,
    status,
    notification_queue_id, delivery_provider, delivery_status,
    provider, provider_message_id,
    sent_at
  )
  select
    q_row.user_id, q_row.client_id, q_row.booking_request_id, q_row.appointment_id,
    q_row.contract_id,
    q_row.channel, q_row.notification_type,
    coalesce(q_row.recipient_email, q_row.recipient_phone),
    q_row.subject, q_row.body,
    'sent',
    q_row.id, q_row.provider, 'sent',
    q_row.provider, q_row.provider_message_id,
    q_row.sent_at
  where not exists (
    select 1 from public.communication_logs cl
    where cl.notification_queue_id = q_row.id
  );

  update public.communication_logs
  set status = 'sent',
      delivery_status = 'sent',
      delivery_provider = q_row.provider,
      provider = q_row.provider,
      provider_message_id = q_row.provider_message_id,
      sent_at = q_row.sent_at,
      failed_at = null,
      error_message = null
  where notification_queue_id = q_row.id;

  return jsonb_build_object('ok', true, 'id', q_row.id);
end;
$$;

revoke all on function public.mark_notification_sent(uuid, text, text) from public;
grant execute on function public.mark_notification_sent(uuid, text, text) to service_role;

-- =====================================================================
-- 7. RPC: mark_notification_failed — backoff + cap at 3 attempts
-- =====================================================================
-- Increment retry_count. If the (incremented) count reaches 3 the
-- row transitions to terminal `failed`. Otherwise it's requeued
-- with a 5-minute backoff. Communication_logs receives a failed
-- row on terminal failure.
create or replace function public.mark_notification_failed(
  id_in       uuid,
  reason_in   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  q_row       public.notification_queue;
  new_count   integer;
  is_terminal boolean;
  next_status text;
begin
  select * into q_row
  from public.notification_queue
  where id = id_in
  limit 1;

  if q_row.id is null then
    raise exception 'notification_not_found' using errcode = 'P0002';
  end if;

  new_count := q_row.retry_count + 1;
  is_terminal := new_count >= 3;
  next_status := case when is_terminal then 'failed' else 'queued' end;

  update public.notification_queue
  set retry_count = new_count,
      failure_reason = nullif(trim(coalesce(reason_in, '')), ''),
      status = next_status,
      scheduled_for = case when is_terminal then scheduled_for else now() + interval '5 minutes' end,
      failed_at = case when is_terminal then now() else null end,
      processing_started_at = null
  where id = id_in
  returning * into q_row;

  if is_terminal then
    insert into public.communication_logs (
      user_id, client_id, booking_request_id, appointment_id,
      booking_contract_id,
      channel, message_type, recipient, subject, body,
      status,
      notification_queue_id, delivery_provider, delivery_status,
      provider, error_message, failed_at
    )
    select
      q_row.user_id, q_row.client_id, q_row.booking_request_id, q_row.appointment_id,
      q_row.contract_id,
      q_row.channel, q_row.notification_type,
      coalesce(q_row.recipient_email, q_row.recipient_phone),
      q_row.subject, q_row.body,
      'failed',
      q_row.id, q_row.provider, 'failed',
      q_row.provider, q_row.failure_reason, q_row.failed_at
    where not exists (
      select 1 from public.communication_logs cl
      where cl.notification_queue_id = q_row.id
    );

    update public.communication_logs
    set status = 'failed',
        delivery_status = 'failed',
        error_message = q_row.failure_reason,
        failed_at = q_row.failed_at
    where notification_queue_id = q_row.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', q_row.id,
    'terminal', is_terminal,
    'retry_count', new_count
  );
end;
$$;

revoke all on function public.mark_notification_failed(uuid, text) from public;
grant execute on function public.mark_notification_failed(uuid, text) to service_role;

-- =====================================================================
-- 8. RPC: public_list_contracts_for_request
-- =====================================================================
-- Anon-callable. Returns the minimal subset needed to enqueue
-- contract-invite emails immediately after a public booking submit.
-- No auth required — the booking_request_id alone is sufficient
-- because the caller just inserted that row via the public submit
-- RPC. Returns id, title, public_token, status, client_name,
-- client_email so the app can build a signing URL and enqueue an
-- email per contract.
create or replace function public.public_list_contracts_for_request(
  request_id_in uuid
)
returns table (
  id            uuid,
  title         text,
  public_token  text,
  status        text,
  client_name   text,
  client_email  text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if request_id_in is null then
    return;
  end if;
  return query
  select bc.id, bc.title, bc.public_token, bc.status,
         bc.client_name, bc.client_email
  from public.booking_contracts bc
  where bc.booking_request_id = request_id_in
  order by bc.created_at asc;
end;
$$;

revoke all on function public.public_list_contracts_for_request(uuid) from public;
grant execute on function public.public_list_contracts_for_request(uuid) to anon, authenticated;

-- =====================================================================
-- 9. Future cron schedule (DOCUMENTATION ONLY)
-- =====================================================================
-- B12.1a does NOT enable pg_cron. The dispatch worker (edge function
-- at supabase/functions/process-notification-queue) is meant to be
-- invoked once per minute. For B12.1a, invocation can be:
--   • Manual via `curl -X POST` for local testing.
--   • Stripe / Vercel cron (cheap, no DB extension required).
--   • pg_cron once a follow-up migration enables it:
--
--       create extension if not exists pg_cron;
--       select cron.schedule(
--         'notification-queue-tick',
--         '* * * * *',
--         $$ select net.http_post(
--              url := '<edge function URL>',
--              headers := '{"Authorization":"Bearer <service role>"}'::jsonb
--            ) $$
--       );
--
-- Documenting here so a future operator doesn't grep for cron and
-- find nothing.
