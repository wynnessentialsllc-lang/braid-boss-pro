-- Month in review for stylists.
--
-- The monthly sibling of the end-of-day summary added in
-- 20261124000000_daily_sales_summary.sql. Mailed on the FIRST of the
-- month, just past the stylist's own local midnight, covering the
-- calendar month that just closed:
--
--   * total collected, and how that compares with the month before
--   * sales count, clients served, new versus returning
--   * best day of the week, by average take on the days that earned
--   * which hours the money came in
--   * biggest single day
--   * top sellers across services and shop items
--
-- Branding and layout live in supabase/functions/_shared/
-- monthly-review-email.ts (notification_type = 'monthly_review'). This
-- migration owns the aggregation and the schedule.
--
-- Rules, mirroring the daily report:
--   * one email per stylist per month, deduped on user + month
--   * a month with no collected sales sends nothing. A recap of $0 is
--     not information, it is a reminder of a bad month.
--   * per-stylist opt-out, defaulting on
--
-- Client identity resolution (client_id, then email, then last ten
-- phone digits) is lifted unchanged from
-- 20261246000000_daily_summary_identify_clients_without_email.sql so a
-- client counted as returning in the daily report is counted as
-- returning here. public._last10_digits() comes from that migration.

-- ---------------------------------------------------------------
-- Per-stylist opt-out (defaults on; mirrors the daily switch)
-- ---------------------------------------------------------------
alter table public.shop_settings
  add column if not exists monthly_review_email_enabled boolean not null default true;

comment on column public.shop_settings.monthly_review_email_enabled is
  'When false, this stylist is skipped by process_monthly_review_reports(). '
  'Independent of daily_sales_summary_enabled so a stylist can keep the '
  'monthly recap while turning the nightly one off, or the reverse.';

-- ---------------------------------------------------------------
-- Aggregator — runs hourly, acts at each stylist's local midnight on
-- the first of the month
-- ---------------------------------------------------------------
-- "The first of the month" is local, and stylists span timezones, so
-- the job runs every hour and only acts for a stylist when it is
-- currently the 00:00 hour of day 1 in their zone. The dedupe key
-- (user + summarized month) makes repeated runs and replays harmless.
--
-- Returns the number of reports enqueued.
create or replace function public.process_monthly_review_reports()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_enqueued      integer := 0;
  u               record;
  v_tz            text;
  v_month_start   date;
  v_month_end     date;   -- exclusive
  v_prev_start    date;
  v_month_label   text;
  v_prev_label    text;
  v_dedupe        text;
  v_owner_email   text;
  v_studio        text;
  v_revenue       numeric;
  v_sales         integer;
  v_customers     integer;
  v_new           integer;
  v_returning     integer;
  v_days          integer;
  v_prev_revenue  numeric;
  v_prev_sales    integer;
  v_best_weekday  text;
  v_best_wd_avg   numeric;
  v_avg_daily     numeric;
  v_by_weekday    jsonb;
  v_by_hour       jsonb;
  v_busy_date     date;
  v_busy_sales    numeric;
  v_top_name      text;
  v_top_sales     numeric;
  v_items         jsonb;
  v_payload       jsonb;
begin
  -- Candidates: anyone who took an appointment or a paid shop order in
  -- the last ~70 days. That covers the whole prior month plus enough
  -- slack for every timezone. The daily job looks at appointments only,
  -- which would miss a stylist whose month was all shop orders.
  for u in
    select user_id from (
      select distinct a.user_id
        from public.appointments a
       where a.appt_date >= current_date - 70
      union
      select distinct o.user_id
        from public.product_orders o
       where o.status = 'paid'
         and o.paid_at is not null
         and o.paid_at >= now() - interval '70 days'
    ) s
  loop
    v_tz := coalesce(
      (select nullif(pr.timezone, '')
         from public.profiles pr
        where pr.id = u.user_id),
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

    -- Fire only in the 00:00 hour of the first local day of the month.
    -- An unknown or bogus zone raises here and skips the stylist rather
    -- than mailing them at the wrong hour.
    begin
      if extract(hour from (now() at time zone v_tz)) <> 0
         or extract(day from (now() at time zone v_tz)) <> 1 then
        continue;
      end if;
      v_month_start := (date_trunc('month', (now() at time zone v_tz)::date) - interval '1 month')::date;
    exception when others then
      continue;
    end;

    v_month_end  := (v_month_start + interval '1 month')::date;
    v_prev_start := (v_month_start - interval '1 month')::date;
    v_month_label := to_char(v_month_start, 'FMMonth YYYY');
    v_prev_label  := to_char(v_prev_start,  'FMMonth YYYY');

    v_dedupe := 'monthly_review:' || u.user_id || ':' || to_char(v_month_start, 'YYYY-MM');
    if exists (select 1 from public.notification_queue where dedupe_key = v_dedupe) then
      continue;
    end if;

    if not coalesce(
         (select ss.monthly_review_email_enabled
            from public.shop_settings ss
           where ss.user_id = u.user_id),
         true) then
      continue;
    end if;

    with appt_real as (
      select
        a.id as row_id,
        a.appt_date as sale_date,
        -- appt_time is 24h "HH:MM" text (see public.to_min). A booking
        -- with no time recorded contributes to every total except the
        -- hourly split, which drops it rather than guessing noon.
        case
          when a.appt_time ~ '^[0-9]{1,2}:'
            then least(23, greatest(0, split_part(a.appt_time, ':', 1)::int))
          else null
        end as sale_hour,
        nullif(trim(coalesce(a.client_id, '')), '') as client_id,
        lower(nullif(trim(coalesce(nullif(trim(coalesce(a.client_email, '')), ''),
                                   c.email, '')), '')) as email,
        public._last10_digits(coalesce(nullif(trim(coalesce(a.client_phone, '')), ''), c.phone)) as phone10,
        coalesce(nullif(s.name, ''), nullif(a.style, ''), 'Service') as item_name,
        case
          when (coalesce(a.balance_paid, false)
                or coalesce(a.payment_status, '') = 'paid'
                or coalesce(a.balance_due, -1) = 0)
               and greatest(0, coalesce(a.total_price, 0) - coalesce(a.discount_amount, 0)) > 0
            then round(greatest(0, coalesce(a.total_price, 0) - coalesce(a.discount_amount, 0))::numeric, 2)
          when coalesce(a.deposit_paid, 0) > 0
            then round(coalesce(a.deposit_paid, 0)::numeric, 2)
          else 0
        end as collected
      from public.appointments a
      left join public.services s
        on s.id = a.service_id and s.user_id = a.user_id
      left join public.clients c
        on c.id = a.client_id and c.user_id = a.user_id
      where a.user_id = u.user_id
        and a.appt_date >= v_month_start
        and a.appt_date <  v_month_end
        and lower(coalesce(a.status, '')) not in
            ('cancelled', 'canceled', 'no-show', 'no_show', 'noshow', 'declined')
    ),
    appt_sales as (
      select * from appt_real where collected > 0
    ),
    ord as (
      select
        o.id::text as row_id,
        ((o.paid_at at time zone v_tz)::date) as sale_date,
        extract(hour from (o.paid_at at time zone v_tz))::int as sale_hour,
        null::text as client_id,
        lower(nullif(trim(coalesce(o.customer_email, '')), '')) as email,
        public._last10_digits(o.customer_phone) as phone10,
        coalesce(o.amount_total, 0)::numeric as amt,
        coalesce(o.line_items, '[]'::jsonb) as line_items
      from public.product_orders o
      where o.user_id = u.user_id
        and o.status = 'paid'
        and o.paid_at is not null
        and ((o.paid_at at time zone v_tz)::date) >= v_month_start
        and ((o.paid_at at time zone v_tz)::date) <  v_month_end
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
    -- Every paying row from both streams, reduced to when it landed and
    -- what it was worth. This is the spine of the day, weekday, and
    -- hour rollups below.
    money_rows as (
      select sale_date, sale_hour, collected as amt from appt_sales
      union all
      select sale_date, sale_hour, amt from ord
    ),
    by_day as (
      select sale_date, sum(amt) as sales
      from money_rows
      group by sale_date
      having sum(amt) > 0
    ),
    -- A weekday's average is taken over the days it actually EARNED,
    -- not over every occurrence in the month. A braider who works
    -- Thursday to Saturday should not have her Saturday average
    -- diluted by the Saturdays she was closed.
    by_weekday as (
      select
        extract(dow from sale_date)::int as dow,
        trim(to_char(sale_date, 'Day')) as weekday,
        round(avg(sales), 2) as avg_sales,
        sum(sales) as total_sales
      from by_day
      group by 1, 2
    ),
    by_hour as (
      select sale_hour as hour, sum(amt) as sales
      from money_rows
      where sale_hour is not null
      group by sale_hour
      having sum(amt) > 0
    ),
    parties as (
      select row_id, client_id, email, phone10 from appt_sales
      union all
      select row_id, client_id, email, phone10 from ord
    ),
    keyed as (
      select
        coalesce('e:' || email, 'c:' || client_id, 'p:' || phone10, 'r:' || row_id) as customer_key,
        client_id, email, phone10
      from parties
    ),
    customers_month as (
      select
        customer_key,
        max(client_id) as client_id,
        max(email)     as email,
        max(phone10)   as phone10
      from keyed
      group by customer_key
    ),
    -- "New" means new to this stylist, not new this month: returning if
    -- any identifier we hold for them appears on an appointment or a
    -- paid order from BEFORE the month being summarized.
    classified as (
      select
        cm.customer_key,
        (exists (
           select 1 from public.appointments a2
            left join public.clients c2
              on c2.id = a2.client_id and c2.user_id = a2.user_id
            where a2.user_id = u.user_id
              and a2.appt_date < v_month_start
              and lower(coalesce(a2.status, '')) not in
                  ('cancelled', 'canceled', 'no-show', 'no_show', 'noshow', 'declined')
              and (
                    (cm.client_id is not null
                       and nullif(trim(coalesce(a2.client_id, '')), '') = cm.client_id)
                 or (cm.email is not null
                       and lower(nullif(trim(coalesce(nullif(trim(coalesce(a2.client_email, '')), ''),
                                                      c2.email, '')), '')) = cm.email)
                 or (cm.phone10 is not null
                       and public._last10_digits(
                             coalesce(nullif(trim(coalesce(a2.client_phone, '')), ''), c2.phone)
                           ) = cm.phone10)
              )
         )
         or exists (
           select 1 from public.product_orders o2
            where o2.user_id = u.user_id
              and o2.status = 'paid'
              and o2.paid_at is not null
              and ((o2.paid_at at time zone v_tz)::date) < v_month_start
              and (
                    (cm.email is not null
                       and lower(nullif(trim(coalesce(o2.customer_email, '')), '')) = cm.email)
                 or (cm.phone10 is not null
                       and public._last10_digits(o2.customer_phone) = cm.phone10)
              )
         )) as seen_before
      from customers_month cm
    )
    select
      (select coalesce(sum(collected), 0) from appt_sales) + (select coalesce(sum(amt), 0) from ord),
      (select count(*) from appt_sales) + (select count(*) from ord),
      (select count(*) from customers_month),
      (select count(*) from classified where not seen_before),
      (select count(*) from by_day),
      (select round(avg(sales), 2) from by_day),
      (select weekday from by_weekday order by avg_sales desc, total_sales desc limit 1),
      (select avg_sales from by_weekday order by avg_sales desc, total_sales desc limit 1),
      (select coalesce(
                jsonb_agg(jsonb_build_object('weekday', weekday, 'sales', avg_sales) order by dow),
                '[]'::jsonb)
         from by_weekday),
      (select coalesce(
                jsonb_agg(jsonb_build_object('hour', hour, 'sales', sales) order by hour),
                '[]'::jsonb)
         from by_hour),
      (select sale_date from by_day order by sales desc, sale_date limit 1),
      (select sales     from by_day order by sales desc, sale_date limit 1),
      (select item_name from by_item order by sales desc, cnt desc limit 1),
      (select coalesce(sales, 0) from by_item order by sales desc, cnt desc limit 1),
      (select coalesce(
                jsonb_agg(jsonb_build_object('name', item_name, 'count', cnt, 'sales', sales)
                          order by sales desc),
                '[]'::jsonb)
         from by_item)
    into
      v_revenue, v_sales, v_customers, v_new, v_days, v_avg_daily,
      v_best_weekday, v_best_wd_avg, v_by_weekday, v_by_hour,
      v_busy_date, v_busy_sales, v_top_name, v_top_sales, v_items;

    v_returning := greatest(0, coalesce(v_customers, 0) - coalesce(v_new, 0));

    -- No money last month, no email.
    if coalesce(v_revenue, 0) <= 0 then
      continue;
    end if;

    -- The month before, for the comparison line. Deliberately just the
    -- two headline figures: the rest of the report is about the month
    -- that closed, not a second full report beside it.
    -- Counted the same way as the month above: an appointment counts as
    -- a sale only once it has collected something, while every paid
    -- order counts. Comparing two figures built by different rules
    -- would put a percentage on the difference between the rules.
    select
      coalesce(sum(amt), 0), coalesce(sum(is_sale), 0)
      into v_prev_revenue, v_prev_sales
    from (
      select
        case when ((coalesce(a.balance_paid, false)
                     or coalesce(a.payment_status, '') = 'paid'
                     or coalesce(a.balance_due, -1) = 0)
                    and greatest(0, coalesce(a.total_price, 0) - coalesce(a.discount_amount, 0)) > 0)
                   or coalesce(a.deposit_paid, 0) > 0
             then 1 else 0 end as is_sale,
        case
          when (coalesce(a.balance_paid, false)
                or coalesce(a.payment_status, '') = 'paid'
                or coalesce(a.balance_due, -1) = 0)
               and greatest(0, coalesce(a.total_price, 0) - coalesce(a.discount_amount, 0)) > 0
            then round(greatest(0, coalesce(a.total_price, 0) - coalesce(a.discount_amount, 0))::numeric, 2)
          when coalesce(a.deposit_paid, 0) > 0
            then round(coalesce(a.deposit_paid, 0)::numeric, 2)
          else 0
        end as amt
      from public.appointments a
      where a.user_id = u.user_id
        and a.appt_date >= v_prev_start
        and a.appt_date <  v_month_start
        and lower(coalesce(a.status, '')) not in
            ('cancelled', 'canceled', 'no-show', 'no_show', 'noshow', 'declined')
      union all
      select 1 as is_sale, coalesce(o.amount_total, 0)::numeric as amt
      from public.product_orders o
      where o.user_id = u.user_id
        and o.status = 'paid'
        and o.paid_at is not null
        and ((o.paid_at at time zone v_tz)::date) >= v_prev_start
        and ((o.paid_at at time zone v_tz)::date) <  v_month_start
    ) prev;

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
      'monthLabel',         v_month_label,
      'prevMonthLabel',     v_prev_label,
      'monthStart',         v_month_start::text,
      'currency',           'USD',
      'revenue',            v_revenue,
      'prevRevenue',        v_prev_revenue,
      'salesCount',         v_sales,
      'prevSalesCount',     v_prev_sales,
      'customersServed',    coalesce(v_customers, 0),
      'newCustomers',       coalesce(v_new, 0),
      'returningCustomers', coalesce(v_returning, 0),
      'daysWithSales',      coalesce(v_days, 0),
      'bestWeekday',        v_best_weekday,
      'bestWeekdayAvg',     coalesce(v_best_wd_avg, 0),
      'avgDailySales',      coalesce(v_avg_daily, 0),
      'byWeekday',          coalesce(v_by_weekday, '[]'::jsonb),
      'byHour',             coalesce(v_by_hour, '[]'::jsonb),
      'busiestDate',        v_busy_date::text,
      'busiestDateSales',   coalesce(v_busy_sales, 0),
      'topServiceName',     v_top_name,
      'topServiceSales',    coalesce(v_top_sales, 0),
      'items',              coalesce(v_items, '[]'::jsonb)
    );

    perform public.queue_notification(
      user_id_in           => u.user_id,
      channel_in           => 'email',
      notification_type_in => 'monthly_review',
      body_in              => 'Your ' || v_month_label || ' month in review',
      subject_in           => v_month_label || ' in review: ' || v_studio,
      recipient_email_in   => v_owner_email,
      recipient_name_in    => v_studio,
      payload_in           => v_payload,
      dedupe_key_in        => v_dedupe
    );
    v_enqueued := v_enqueued + 1;
  end loop;

  return v_enqueued;
end $$;

revoke all on function public.process_monthly_review_reports() from public;
grant execute on function public.process_monthly_review_reports() to service_role;


-- ---------------------------------------------------------------
-- Owner toggles for both report emails
-- ---------------------------------------------------------------
-- The report itself tells the stylist she can turn it off in Settings,
-- so there has to be something in Settings that does it. shop_settings
-- is written from server routes with the service role today and the
-- browser holds no write grant on it, so the switch goes through a
-- definer RPC, matching set_sms_notifications_enabled.
--
-- The daily summary shipped without a switch of its own, so this RPC
-- covers both flags: one call site, and the older report stops being
-- the one email a stylist cannot turn off.
create or replace function public.set_report_email_prefs(
  daily_in   boolean default null,
  monthly_in boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller    uuid;
  v_daily   boolean;
  v_monthly boolean;
begin
  caller := auth.uid();
  if caller is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  -- A null argument means "leave this one alone", so the two toggles can
  -- be saved independently without either reading the other first.
  insert into public.shop_settings (user_id, daily_sales_summary_enabled, monthly_review_email_enabled)
  values (caller, coalesce(daily_in, true), coalesce(monthly_in, true))
  on conflict (user_id) do update
     set daily_sales_summary_enabled =
           coalesce(daily_in, public.shop_settings.daily_sales_summary_enabled),
         monthly_review_email_enabled =
           coalesce(monthly_in, public.shop_settings.monthly_review_email_enabled),
         updated_at = now()
   returning daily_sales_summary_enabled, monthly_review_email_enabled
        into v_daily, v_monthly;

  -- RETURNING covers both branches of ON CONFLICT DO UPDATE, so the
  -- settled values are in hand whether the row was created or amended.
  return jsonb_build_object(
    'dailySalesSummaryEnabled', coalesce(v_daily, true),
    'monthlyReviewEnabled',     coalesce(v_monthly, true)
  );
end;
$$;

revoke all on function public.set_report_email_prefs(boolean, boolean) from public;
grant execute on function public.set_report_email_prefs(boolean, boolean) to authenticated;

-- Read side. shop_settings has an owner SELECT policy, but a stylist who
-- has never opened the shop has no row at all, and "no row" means both
-- reports are ON. Returning the defaults here keeps that rule in one
-- place instead of repeating it in the client.
create or replace function public.get_report_email_prefs()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller    uuid;
  v_daily   boolean;
  v_monthly boolean;
begin
  caller := auth.uid();
  if caller is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select daily_sales_summary_enabled, monthly_review_email_enabled
    into v_daily, v_monthly
    from public.shop_settings
   where user_id = caller;

  return jsonb_build_object(
    'dailySalesSummaryEnabled', coalesce(v_daily, true),
    'monthlyReviewEnabled',     coalesce(v_monthly, true)
  );
end;
$$;

revoke all on function public.get_report_email_prefs() from public;
grant execute on function public.get_report_email_prefs() to authenticated;

-- ---------------------------------------------------------------
-- Hourly cron — every stylist is summarized at their own local
-- midnight on the first of the month
-- ---------------------------------------------------------------
create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'monthly_review_report_hourly') then
    perform cron.unschedule('monthly_review_report_hourly');
  end if;
end $$;

select cron.schedule(
  'monthly_review_report_hourly',
  '5 * * * *',
  $$select public.process_monthly_review_reports();$$
);

-- Runs at :05 rather than :00 so it does not contend with the daily
-- sales summary, which fires on the hour and touches the same tables.

-- Verification:
-- select jobid, schedule, jobname, active from cron.job
-- where jobname = 'monthly_review_report_hourly';
--
-- Dry run for one stylist (enqueues for real, so use a test account):
-- select public.process_monthly_review_reports();
--
-- What got queued:
-- select dedupe_key, subject, status, created_at
-- from public.notification_queue
-- where notification_type = 'monthly_review'
-- order by created_at desc limit 10;
