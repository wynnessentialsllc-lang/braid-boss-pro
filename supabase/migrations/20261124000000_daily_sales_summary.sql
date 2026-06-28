-- Daily sales summary for stylists.
--
-- A POS-style end-of-day report emailed to the stylist (their login
-- address) at *their local midnight*, summarizing the day that just
-- ended. Branding/layout lives in the process-notification-queue
-- worker (notification_type = 'daily_sales_summary'); this migration
-- owns the aggregation + scheduling.
--
-- Rules (per the feature request):
--   * Sent at midnight the day AFTER a sale was made — i.e. just past
--     local midnight, summarizing the prior local calendar day.
--   * If the day had no collected sales, no email is sent.
--   * One email per stylist per day (deduped on user + local date).

-- ---------------------------------------------------------------
-- Per-stylist opt-out (defaults on; mirrors the marketing switch)
-- ---------------------------------------------------------------
alter table public.shop_settings
  add column if not exists daily_sales_summary_enabled boolean not null default true;

-- ---------------------------------------------------------------
-- Cron processor — runs hourly, fires at each stylist's local midnight
-- ---------------------------------------------------------------
-- Because "midnight" is local and stylists span timezones, the cron
-- runs every hour and only acts for a stylist when it is currently the
-- 00:00 hour in their timezone. The dedupe key (user + summarized
-- local date) makes repeated runs and replays harmless.
--
-- Returns the number of summary emails enqueued.
create or replace function public.process_daily_sales_summaries()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_enqueued    integer := 0;
  u             record;
  v_tz          text;
  v_local_date  date;
  v_dedupe      text;
  v_owner_email text;
  v_studio      text;
  v_revenue     numeric;
  v_sales       integer;
  v_customers   integer;
  v_new         integer;
  v_returning   integer;
  v_top_name    text;
  v_top_sales   numeric;
  v_items       jsonb;
  v_payload     jsonb;
begin
  -- Only consider stylists with recent appointment activity, so we
  -- don't resolve a timezone for every account every hour.
  for u in
    select distinct a.user_id
    from public.appointments a
    where a.appt_date >= current_date - 3
  loop
    -- Resolve the stylist's local timezone using the same fallback
    -- chain as the review-email cron (appointment tz → most recent
    -- booking-request tz → Pacific default).
    v_tz := coalesce(
      (select nullif(a.timezone, '')
         from public.appointments a
        where a.user_id = u.user_id and nullif(a.timezone, '') is not null
        order by a.appt_date desc nulls last
        limit 1),
      (select br.timezone
         from public.booking_requests br
        where br.user_id = u.user_id and br.timezone is not null and br.timezone <> ''
        order by br.created_at desc
        limit 1),
      'America/Los_Angeles'
    );

    -- Fire only just past local midnight; summarize the day that ended.
    -- A bad/unknown tz string raises, in which case we skip safely.
    begin
      if extract(hour from (now() at time zone v_tz)) <> 0 then
        continue;
      end if;
      v_local_date := ((now() at time zone v_tz)::date) - 1;
    exception when others then
      continue;
    end;

    v_dedupe := 'daily_summary:' || u.user_id || ':' || v_local_date;
    if exists (select 1 from public.notification_queue where dedupe_key = v_dedupe) then
      continue;
    end if;

    -- Respect the per-stylist opt-out.
    if not coalesce(
         (select ss.daily_sales_summary_enabled
            from public.shop_settings ss
           where ss.user_id = u.user_id),
         true) then
      continue;
    end if;

    -- Aggregate the prior local day's collected sales across BOTH
    -- revenue streams:
    --   * appointments — "collected" mirrors the app's finance helpers
    --     (deposits / amount paid, or the net post-discount total when
    --     the ticket is marked paid in full).
    --   * shop orders (product_orders) — paid orders bucketed to the
    --     stylist's local day by paid_at; amount_total is the gross.
    -- Customers are unified by email across both streams so "new vs
    -- returning" reflects the whole business, not just the chair.
    with appt_real as (
      select
        lower(trim(coalesce(a.client_email, ''))) as email,
        coalesce(nullif(s.name, ''), nullif(a.style, ''), 'Service') as item_name,
        case
          when greatest(coalesce(a.deposit_paid, 0), coalesce(a.amount_paid, 0)) > 0
            then round((case
                          when greatest(0, coalesce(a.total_price, 0) - coalesce(a.discount_amount, 0)) > 0
                            then least(greatest(coalesce(a.deposit_paid, 0), coalesce(a.amount_paid, 0)),
                                       greatest(0, coalesce(a.total_price, 0) - coalesce(a.discount_amount, 0)))
                          else greatest(coalesce(a.deposit_paid, 0), coalesce(a.amount_paid, 0))
                        end)::numeric, 2)
          when (coalesce(a.payment_status, '') = 'paid' or lower(coalesce(a.status, '')) = 'completed')
               and greatest(0, coalesce(a.total_price, 0) - coalesce(a.discount_amount, 0)) > 0
            then round(greatest(0, coalesce(a.total_price, 0) - coalesce(a.discount_amount, 0))::numeric, 2)
          else 0
        end as collected
      from public.appointments a
      left join public.services s
        on s.id = a.service_id and s.user_id = a.user_id
      where a.user_id = u.user_id
        and a.appt_date = v_local_date
        and lower(coalesce(a.status, '')) not in
            ('cancelled', 'canceled', 'no-show', 'no_show', 'noshow', 'declined')
    ),
    appt_sales as (
      select * from appt_real where collected > 0
    ),
    ord as (
      select
        o.id,
        lower(trim(coalesce(o.customer_email, ''))) as email,
        coalesce(o.amount_total, 0)::numeric as amt,
        coalesce(o.line_items, '[]'::jsonb) as line_items
      from public.product_orders o
      where o.user_id = u.user_id
        and o.status = 'paid'
        and o.paid_at is not null
        and ((o.paid_at at time zone v_tz)::date) = v_local_date
    ),
    ord_items as (
      select
        coalesce(nullif(li->>'title', ''), nullif(li->>'name', ''), 'Product') as item_name,
        coalesce(nullif(li->>'quantity', '')::numeric, 1) as qty,
        coalesce(nullif(li->>'unit_amount', '')::numeric, 0) as unit
      from ord
      cross join lateral jsonb_array_elements(ord.line_items) li
    ),
    items_all as (
      select item_name, collected as sales, 1::numeric as cnt from appt_sales
      union all
      select item_name, round((unit * qty)::numeric, 2) as sales, qty as cnt from ord_items
    ),
    by_item as (
      select item_name, sum(sales) as sales, sum(cnt) as cnt
      from items_all
      group by item_name
    ),
    emails_today as (
      select email from appt_sales where email <> ''
      union
      select email from ord where email <> ''
    )
    select
      (select coalesce(sum(collected), 0) from appt_sales) + (select coalesce(sum(amt), 0) from ord),
      (select count(*) from appt_sales) + (select count(*) from ord),
      (select count(*) from emails_today),
      (select count(*) from emails_today et
         where not exists (
           select 1 from public.appointments a2
            where a2.user_id = u.user_id
              and lower(trim(coalesce(a2.client_email, ''))) = et.email
              and a2.appt_date < v_local_date
              and lower(coalesce(a2.status, '')) not in
                  ('cancelled', 'canceled', 'no-show', 'no_show', 'noshow', 'declined')
         )
         and not exists (
           select 1 from public.product_orders o2
            where o2.user_id = u.user_id
              and o2.status = 'paid'
              and lower(trim(coalesce(o2.customer_email, ''))) = et.email
              and o2.paid_at is not null
              and ((o2.paid_at at time zone v_tz)::date) < v_local_date
         )),
      (select item_name from by_item order by sales desc, cnt desc limit 1),
      (select coalesce(sales, 0) from by_item order by sales desc, cnt desc limit 1),
      (select coalesce(
                jsonb_agg(jsonb_build_object('name', item_name, 'count', cnt, 'sales', sales)
                          order by sales desc),
                '[]'::jsonb)
         from by_item)
    into v_revenue, v_sales, v_customers, v_new, v_top_name, v_top_sales, v_items;

    v_returning := greatest(0, coalesce(v_customers, 0) - coalesce(v_new, 0));

    -- No money collected that day → no email.
    if coalesce(v_revenue, 0) <= 0 then
      continue;
    end if;

    -- The summary is addressed to the stylist's login email.
    select email into v_owner_email from auth.users where id = u.user_id;
    if v_owner_email is null or position('@' in v_owner_email) = 0 then
      continue;
    end if;

    select coalesce(business_name, full_name, 'Your studio')
      into v_studio
      from public.profiles
     where id = u.user_id;
    v_studio := coalesce(v_studio, 'Your studio');

    v_payload := jsonb_build_object(
      'studioName',         v_studio,
      'summaryDate',        v_local_date::text,
      'weekday',            trim(to_char(v_local_date, 'Day')),
      'currency',           'USD',
      'revenue',            v_revenue,
      'salesCount',         v_sales,
      'customersServed',    v_customers,
      'newCustomers',       coalesce(v_new, 0),
      'returningCustomers', coalesce(v_returning, 0),
      'topServiceName',     v_top_name,
      'topServiceSales',    coalesce(v_top_sales, 0),
      'items',              coalesce(v_items, '[]'::jsonb)
    );

    perform public.queue_notification(
      user_id_in           => u.user_id,
      channel_in           => 'email',
      notification_type_in => 'daily_sales_summary',
      body_in              => 'Your sales summary for ' || to_char(v_local_date, 'MM/DD/YYYY'),
      subject_in           => v_studio || ' — your sales summary for ' || to_char(v_local_date, 'MM/DD/YYYY'),
      recipient_email_in   => v_owner_email,
      recipient_name_in    => v_studio,
      payload_in           => v_payload,
      dedupe_key_in        => v_dedupe
    );
    v_enqueued := v_enqueued + 1;
  end loop;

  return v_enqueued;
end $$;

revoke all on function public.process_daily_sales_summaries() from public;
grant execute on function public.process_daily_sales_summaries() to service_role;

-- ---------------------------------------------------------------
-- Hourly cron — every stylist gets summarized at their local midnight
-- ---------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'daily_sales_summary_hourly') then
    perform cron.unschedule('daily_sales_summary_hourly');
  end if;
end $$;

select cron.schedule(
  'daily_sales_summary_hourly',
  '0 * * * *',
  $$select public.process_daily_sales_summaries();$$
);
