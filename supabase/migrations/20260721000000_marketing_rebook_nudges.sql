-- Marketing automation V1 — rebook nudges.
--
-- Phase 1 of the marketing automation series. The single highest-ROI
-- automation for a braiding business: a one-tap "your style is due
-- for a refresh" email that fires on a per-service cadence the
-- stylist sets once. CAN-SPAM compliant by design — every recipient
-- has an opaque unsubscribe token, every email includes the link,
-- and the daily cron checks the opt-out flag before enqueueing.

-- ---------------------------------------------------------------
-- Per-service rebook window
-- ---------------------------------------------------------------
-- Number of weeks after an appointment for this service before we
-- consider the client "due for a refresh". NULL = no auto-nudge for
-- this service (digital products, one-off consults, etc.).
alter table public.services
  add column if not exists rebook_after_weeks integer
    check (rebook_after_weeks is null or (rebook_after_weeks > 0 and rebook_after_weeks <= 52));

-- ---------------------------------------------------------------
-- Per-client opt-out + opaque unsubscribe token
-- ---------------------------------------------------------------
-- marketing_emails_enabled defaults to true so existing clients can
-- start receiving nudges as soon as the stylist sets up rebook
-- windows. The unsubscribe page flips this to false. Transactional
-- emails (appointment confirmations, balance paid, etc.) intentionally
-- ignore this flag — opt-out only suppresses marketing notification
-- types listed in MARKETING_NOTIFICATION_TYPES below.
alter table public.clients
  add column if not exists marketing_emails_enabled boolean not null default true,
  add column if not exists marketing_unsubscribe_token text;

create unique index if not exists clients_marketing_unsubscribe_token_uidx
  on public.clients (marketing_unsubscribe_token)
  where marketing_unsubscribe_token is not null;

-- Lazy token generator — called the first time a client is queued
-- for any marketing email. Returns the existing token if set.
create or replace function public.ensure_client_marketing_token(
  user_id_in uuid,
  client_id_in text
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token text;
  -- 128 bits of entropy in url-safe base64 (no padding) = 22 chars.
  -- Generated via encode(gen_random_bytes(16), 'base64') with the
  -- non-url-safe chars swapped out.
  v_new   text;
begin
  select marketing_unsubscribe_token into v_token
    from public.clients
   where user_id = user_id_in and id = client_id_in;
  if v_token is not null and length(v_token) > 0 then
    return v_token;
  end if;
  v_new := replace(replace(replace(
    encode(gen_random_bytes(16), 'base64'),
    '+', '-'), '/', '_'), '=', '');
  update public.clients
     set marketing_unsubscribe_token = v_new
   where user_id = user_id_in and id = client_id_in;
  return v_new;
end $$;

grant execute on function public.ensure_client_marketing_token(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------
-- Per-stylist master switch
-- ---------------------------------------------------------------
-- Defaults to true on insert — a stylist who hasn't set up marketing
-- still has no nudges sent because no service yet has
-- rebook_after_weeks. The flag exists so a stylist can globally
-- pause all marketing emails without unsetting every service window.
alter table public.shop_settings
  add column if not exists marketing_rebook_nudges_enabled boolean not null default true;

-- ---------------------------------------------------------------
-- Public unsubscribe RPC — anon-callable
-- ---------------------------------------------------------------
-- The unsubscribe page calls this with the opaque token. Returns the
-- studio name + client name so the page can show a personalized
-- "You've been unsubscribed from [studio]" confirmation.
create or replace function public.public_unsubscribe_marketing(token_in text)
returns table (
  ok boolean,
  client_name text,
  studio_name text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_client record;
  v_studio text;
begin
  if token_in is null or length(token_in) < 8 then
    return query select false, null::text, null::text;
    return;
  end if;
  update public.clients
     set marketing_emails_enabled = false,
         updated_at = now()
   where marketing_unsubscribe_token = token_in
     and marketing_emails_enabled = true
   returning user_id, name into v_client;
  if v_client.user_id is null then
    -- Token didn't match OR they were already unsubscribed.
    -- Still fetch the client so the page can show confirmation.
    select user_id, name into v_client
      from public.clients
     where marketing_unsubscribe_token = token_in;
    if v_client.user_id is null then
      return query select false, null::text, null::text;
      return;
    end if;
  end if;
  select coalesce(business_name, full_name) into v_studio
    from public.profiles
   where id = v_client.user_id;
  return query select true, v_client.name, v_studio;
end $$;

revoke all on function public.public_unsubscribe_marketing(text) from public;
grant execute on function public.public_unsubscribe_marketing(text) to anon, authenticated;

-- ---------------------------------------------------------------
-- Cron processor — runs daily, enqueues rebook nudges
-- ---------------------------------------------------------------
-- For each (user, client) pair, look at the client's most recent
-- COMPLETED appointment that's tied to a service with a non-null
-- rebook_after_weeks. If today is on/past that window AND the
-- client hasn't received this exact nudge yet AND has no future
-- bookings AND is opted in AND has an email AND the stylist's
-- master switch is on — enqueue the email.
--
-- Idempotency lives in the notification_queue dedupe_key: the key
-- includes the last appointment's date, so once they book a new
-- appointment the cycle resets and they're eligible for the next
-- nudge (at the new last-appt + rebook_after_weeks).
--
-- Returns count enqueued; harmless to run repeatedly.
create or replace function public.process_rebook_nudges()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_enqueued integer := 0;
  r record;
  v_subject text;
  v_body    text;
  v_payload jsonb;
  v_token   text;
  v_slug    text;
  v_studio  text;
  v_dedupe  text;
begin
  for r in
    with last_completed as (
      -- For each (user, client, service), pick the most recent
      -- billable / completed appointment. Cancelled rows ignored.
      select distinct on (a.user_id, a.client_id, s.id)
        a.user_id,
        a.client_id,
        a.id            as appointment_id,
        a.appt_date     as appointment_date,
        a.style         as appointment_style,
        s.id            as service_id,
        s.name          as service_name,
        s.rebook_after_weeks
      from public.appointments a
      join public.services s on s.id = a.service_id and s.user_id = a.user_id
      where s.rebook_after_weeks is not null
        and a.client_id is not null
        and a.status not in ('cancelled', 'canceled')
        and (a.status = 'completed' or a.payment_status = 'paid')
        and a.appt_date is not null
        and a.appt_date <= current_date
      order by a.user_id, a.client_id, s.id, a.appt_date desc
    ),
    eligible as (
      select
        lc.*,
        c.name  as client_name,
        c.email as client_email,
        c.marketing_emails_enabled,
        coalesce(ss.marketing_rebook_nudges_enabled, true) as stylist_marketing_on,
        coalesce(p.business_name, p.full_name) as studio_name,
        coalesce(bl.slug, p.public_slug) as booking_slug
      from last_completed lc
      join public.clients c
        on c.user_id = lc.user_id and c.id = lc.client_id
      left join public.shop_settings ss on ss.user_id = lc.user_id
      left join public.profiles p on p.id = lc.user_id
      left join public.booking_links bl on bl.user_id = lc.user_id and bl.active = true
      where
        -- Today is on/past the rebook window
        current_date >= (lc.appointment_date + (lc.rebook_after_weeks * 7))
        -- Opt-in (default true)
        and c.marketing_emails_enabled = true
        -- Stylist hasn't paused marketing
        and coalesce(ss.marketing_rebook_nudges_enabled, true) = true
        -- Must have an email to send to
        and c.email is not null and length(trim(c.email)) > 3
        -- No future appointments already booked — they're not stale
        and not exists (
          select 1 from public.appointments fa
          where fa.user_id = lc.user_id
            and fa.client_id = lc.client_id
            and fa.appt_date > current_date
            and fa.status not in ('cancelled', 'canceled')
        )
    )
    select * from eligible
  loop
    -- Dedupe per (client, appointment) so a re-run, an additional
    -- nudge-eligible service on the same client, or a Stripe-style
    -- replay can't multi-send. The key is keyed on the appointment
    -- the nudge is for, not the calendar day — so the row blocks
    -- ALL future re-runs for this cycle. Once the client books a
    -- new appointment, last_completed picks a different row and a
    -- fresh dedupe key becomes eligible.
    v_dedupe := 'rebook_nudge:' || r.user_id || ':' || r.client_id || ':' || r.appointment_id;

    -- Skip if we've already enqueued this one — check directly so
    -- we don't waste a queue_notification round-trip that would
    -- error on the unique index.
    if exists (
      select 1 from public.notification_queue
      where dedupe_key = v_dedupe
    ) then
      continue;
    end if;

    v_token := public.ensure_client_marketing_token(r.user_id, r.client_id);
    v_slug  := r.booking_slug;
    v_studio := coalesce(r.studio_name, 'your stylist');

    v_subject := 'Time to refresh your ' || coalesce(r.service_name, 'style') || '?';
    v_body    := 'Your ' || coalesce(r.service_name, 'style') || ' is due for a refresh — tap to book your next appointment.';
    v_payload := jsonb_build_object(
      'clientName', r.client_name,
      'studioName', v_studio,
      'serviceName', r.service_name,
      'lastAppointmentDate', r.appointment_date::text,
      'weeksSince', floor((current_date - r.appointment_date) / 7.0)::int,
      'bookingSlug', v_slug,
      'unsubscribeToken', v_token
    );

    perform public.queue_notification(
      r.user_id,
      'email',
      'rebook_nudge',
      v_body,
      v_subject,
      r.client_email,
      null,
      r.client_name,
      v_payload,
      null,
      v_dedupe,
      null,
      r.appointment_id,
      r.client_id,
      null
    );
    v_enqueued := v_enqueued + 1;
  end loop;
  return v_enqueued;
end $$;

revoke all on function public.process_rebook_nudges() from public;
grant execute on function public.process_rebook_nudges() to service_role;

-- ---------------------------------------------------------------
-- Daily cron — 10am Pacific (17:00 UTC standard, 18:00 UTC during DST)
-- ---------------------------------------------------------------
-- pg_cron expects UTC. 17:00 UTC = 10am PST / 9am PDT. Good window:
-- not too early to wake people up, not too late that they miss it
-- during their morning phone scroll. One cron, runs every day.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'rebook_nudges_daily') then
    perform cron.unschedule('rebook_nudges_daily');
  end if;
end $$;

select cron.schedule(
  'rebook_nudges_daily',
  '0 17 * * *',
  $$select public.process_rebook_nudges();$$
);
