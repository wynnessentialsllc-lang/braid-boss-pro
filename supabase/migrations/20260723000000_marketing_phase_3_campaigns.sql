-- Marketing automation V3 — one-off campaign composer.
--
-- Phase 3: a "write an email, pick who gets it, send or schedule"
-- tool sitting on top of the same notification_queue +
-- suppression infrastructure built in Phases 1 and 2. Use cases:
-- "Memorial Day weekend, 15% off everyone who's booked in the last
-- year"; "New service launched, here's the announcement"; etc.
--
-- The composer stores a draft with a chosen segment. The send-now
-- path immediately calls process_marketing_campaign, which resolves
-- the segment to (client, email) tuples and enqueues one row per
-- recipient via queue_notification. Scheduled sends ride a 15-minute
-- cron that picks up campaigns where scheduled_for <= now().

-- ---------------------------------------------------------------
-- marketing_campaigns table
-- ---------------------------------------------------------------
-- body_text is the stylist's plain-text draft. Conversion to safe
-- HTML happens at enqueue time so the editor stays simple (textarea,
-- not WYSIWYG) and we control the rendering pipeline. Merge tags
-- ({{client_name}}, {{studio_name}}, {{book_url}}) are substituted
-- per-recipient at enqueue, not stored substituted.
create table if not exists public.marketing_campaigns (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  name            text not null,
  subject         text not null,
  body_text       text not null,
  -- { kind: "all" } | { kind: "active_last", days: 90 }
  -- | { kind: "lapsed", min_days: 90 }
  segment         jsonb not null default '{"kind":"all"}'::jsonb,
  status          text  not null default 'draft'
                  check (status in ('draft', 'scheduled', 'sending', 'sent', 'failed')),
  scheduled_for   timestamptz,
  sent_at         timestamptz,
  recipient_count integer,
  failed_count    integer not null default 0,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists marketing_campaigns_user_status_idx
  on public.marketing_campaigns (user_id, status, scheduled_for);
create index if not exists marketing_campaigns_due_idx
  on public.marketing_campaigns (status, scheduled_for)
  where status = 'scheduled';

alter table public.marketing_campaigns enable row level security;

drop policy if exists "marketing_campaigns_self_select" on public.marketing_campaigns;
create policy "marketing_campaigns_self_select" on public.marketing_campaigns
  for select using (auth.uid() = user_id);

drop policy if exists "marketing_campaigns_self_insert" on public.marketing_campaigns;
create policy "marketing_campaigns_self_insert" on public.marketing_campaigns
  for insert with check (auth.uid() = user_id);

drop policy if exists "marketing_campaigns_self_update" on public.marketing_campaigns;
create policy "marketing_campaigns_self_update" on public.marketing_campaigns
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "marketing_campaigns_self_delete" on public.marketing_campaigns;
create policy "marketing_campaigns_self_delete" on public.marketing_campaigns
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on public.marketing_campaigns to authenticated;

-- ---------------------------------------------------------------
-- Segment recipient counter — preview helper for the composer
-- ---------------------------------------------------------------
-- Returns how many clients would receive a campaign with the given
-- segment, applying the same filters the send path applies (opted
-- in, has email). Auth-scoped so the composer's "Send to N clients"
-- preview can't peek at another user's count.
create or replace function public.count_marketing_segment(
  segment_in jsonb
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := auth.uid();
  v_kind text := segment_in->>'kind';
  v_days int := nullif(segment_in->>'days', '')::int;
  v_min_days int := nullif(segment_in->>'min_days', '')::int;
  v_count int := 0;
begin
  if caller is null then return 0; end if;

  if v_kind = 'all' or v_kind is null then
    select count(*) into v_count from public.clients c
      where c.user_id = caller
        and c.marketing_emails_enabled = true
        and c.email is not null and length(trim(c.email)) > 3;
  elsif v_kind = 'active_last' then
    select count(distinct c.id) into v_count from public.clients c
      where c.user_id = caller
        and c.marketing_emails_enabled = true
        and c.email is not null and length(trim(c.email)) > 3
        and exists (
          select 1 from public.appointments a
          where a.user_id = caller and a.client_id = c.id
            and a.appt_date >= current_date - make_interval(days => coalesce(v_days, 90))
            and a.status not in ('cancelled', 'canceled')
            and (a.status = 'completed' or a.payment_status = 'paid')
        );
  elsif v_kind = 'lapsed' then
    select count(distinct c.id) into v_count from public.clients c
      where c.user_id = caller
        and c.marketing_emails_enabled = true
        and c.email is not null and length(trim(c.email)) > 3
        and exists (
          select 1 from public.appointments a
          where a.user_id = caller and a.client_id = c.id
            and a.status not in ('cancelled', 'canceled')
            and (a.status = 'completed' or a.payment_status = 'paid')
        )
        and not exists (
          select 1 from public.appointments a2
          where a2.user_id = caller and a2.client_id = c.id
            and a2.appt_date >= current_date - make_interval(days => coalesce(v_min_days, 90))
            and a2.status not in ('cancelled', 'canceled')
            and (a2.status = 'completed' or a2.payment_status = 'paid')
        );
  end if;

  return v_count;
end $$;

revoke all on function public.count_marketing_segment(jsonb) from public;
grant execute on function public.count_marketing_segment(jsonb) to authenticated;

-- ---------------------------------------------------------------
-- Campaign processor
-- ---------------------------------------------------------------
-- Resolves the segment to (client, email) tuples, enqueues one
-- notification per recipient with type "marketing_campaign" and
-- payload { subject, bodyText, studioName, clientName, bookUrl,
-- unsubscribeToken }. Edge function turns bodyText into safe HTML
-- and substitutes merge tags after escaping, so the stylist's draft
-- can contain literal {{client_name}} markers without us having to
-- pre-render per recipient.
--
-- Sets status='sending' for the duration so a concurrent run
-- can't double-fire; finalizes to 'sent' with recipient_count.
create or replace function public.process_marketing_campaign(
  campaign_id_in uuid
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_campaign public.marketing_campaigns%rowtype;
  v_caller uuid := auth.uid();
  v_kind text;
  v_days int;
  v_min_days int;
  v_studio text;
  v_slug text;
  v_enqueued int := 0;
  v_failed int := 0;
  r record;
  v_token text;
  v_dedupe text;
  v_payload jsonb;
begin
  -- Lock the campaign row + only this stylist (or service role) may
  -- run it. Bail if it's already in flight or done.
  select * into v_campaign from public.marketing_campaigns
    where id = campaign_id_in for update;
  if v_campaign.id is null then
    raise exception 'campaign_not_found';
  end if;
  -- Service role bypasses the owner check so the scheduled-sender
  -- cron can run a campaign without owning it.
  if v_caller is not null and v_caller <> v_campaign.user_id then
    raise exception 'forbidden';
  end if;
  if v_campaign.status in ('sending', 'sent') then
    return 0;
  end if;

  update public.marketing_campaigns
    set status = 'sending', updated_at = now()
    where id = campaign_id_in;

  v_kind     := v_campaign.segment->>'kind';
  v_days     := nullif(v_campaign.segment->>'days', '')::int;
  v_min_days := nullif(v_campaign.segment->>'min_days', '')::int;

  select coalesce(p.business_name, p.full_name),
         coalesce(bl.slug, p.public_slug)
    into v_studio, v_slug
    from public.profiles p
    left join public.booking_links bl on bl.user_id = p.id and bl.active = true
    where p.id = v_campaign.user_id;

  -- Iterate over matching clients. The CTE picks the right set
  -- based on segment kind; all three share the opted-in + has-email
  -- filter.
  for r in
    with recipients as (
      select c.id, c.name, c.email
        from public.clients c
       where c.user_id = v_campaign.user_id
         and c.marketing_emails_enabled = true
         and c.email is not null and length(trim(c.email)) > 3
         and (
           v_kind is null or v_kind = 'all'
           or (v_kind = 'active_last' and exists (
             select 1 from public.appointments a
             where a.user_id = v_campaign.user_id and a.client_id = c.id
               and a.appt_date >= current_date - make_interval(days => coalesce(v_days, 90))
               and a.status not in ('cancelled', 'canceled')
               and (a.status = 'completed' or a.payment_status = 'paid')
           ))
           or (v_kind = 'lapsed' and exists (
             select 1 from public.appointments a
             where a.user_id = v_campaign.user_id and a.client_id = c.id
               and a.status not in ('cancelled', 'canceled')
               and (a.status = 'completed' or a.payment_status = 'paid')
           ) and not exists (
             select 1 from public.appointments a2
             where a2.user_id = v_campaign.user_id and a2.client_id = c.id
               and a2.appt_date >= current_date - make_interval(days => coalesce(v_min_days, 90))
               and a2.status not in ('cancelled', 'canceled')
               and (a2.status = 'completed' or a2.payment_status = 'paid')
           ))
         )
    )
    select id, name, email from recipients
  loop
    -- Dedupe on (campaign, client) so a re-run of the same
    -- campaign skips clients who already received it. The unique
    -- index on notification_queue.dedupe_key enforces this even if
    -- two concurrent runs slip past the status='sending' check.
    v_dedupe := 'campaign:' || v_campaign.id || ':' || r.id;
    v_token := public.ensure_client_marketing_token(v_campaign.user_id, r.id);

    v_payload := jsonb_build_object(
      'subject', v_campaign.subject,
      'bodyText', v_campaign.body_text,
      'clientName', r.name,
      'studioName', coalesce(v_studio, 'your stylist'),
      'bookingSlug', v_slug,
      'unsubscribeToken', v_token,
      'campaignId', v_campaign.id::text
    );

    begin
      perform public.queue_notification(
        v_campaign.user_id, 'email', 'marketing_campaign',
        v_campaign.body_text, v_campaign.subject,
        r.email, null, r.name,
        v_payload, null, v_dedupe, null, null, r.id, null
      );
      v_enqueued := v_enqueued + 1;
    exception when others then
      -- Continue on per-row failures so one bad email doesn't kill
      -- the whole campaign. Track the count for the failure pill.
      v_failed := v_failed + 1;
    end;
  end loop;

  update public.marketing_campaigns
    set status = 'sent',
        sent_at = now(),
        recipient_count = v_enqueued,
        failed_count = v_failed,
        updated_at = now()
    where id = campaign_id_in;

  return v_enqueued;
end $$;

revoke all on function public.process_marketing_campaign(uuid) from public;
grant execute on function public.process_marketing_campaign(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------
-- Scheduled-sender cron
-- ---------------------------------------------------------------
-- Every 15 minutes, find campaigns due to send and run them. Runs
-- as service_role via pg_cron, so the owner check inside
-- process_marketing_campaign skips (v_caller is null path).
create or replace function public.process_scheduled_campaigns()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_total int := 0;
begin
  for r in
    select id from public.marketing_campaigns
     where status = 'scheduled'
       and scheduled_for is not null
       and scheduled_for <= now()
     order by scheduled_for asc
     limit 25  -- cap per tick so a backlog can't tie up the worker
  loop
    begin
      v_total := v_total + public.process_marketing_campaign(r.id);
    exception when others then
      update public.marketing_campaigns
        set status = 'failed',
            last_error = sqlerrm,
            updated_at = now()
        where id = r.id;
    end;
  end loop;
  return v_total;
end $$;

revoke all on function public.process_scheduled_campaigns() from public;
grant execute on function public.process_scheduled_campaigns() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'scheduled_campaigns_quarter_hour') then
    perform cron.unschedule('scheduled_campaigns_quarter_hour');
  end if;
end $$;

select cron.schedule(
  'scheduled_campaigns_quarter_hour',
  '*/15 * * * *',
  $$select public.process_scheduled_campaigns();$$
);
