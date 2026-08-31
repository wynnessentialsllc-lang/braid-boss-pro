-- Fix: the daily sales summary reported 0 customers on days that
-- clearly had sales.
--
-- process_daily_sales_summaries() identified a customer purely by
-- email address:
--
--   emails_today as (
--     select email from appt_sales where email <> ''
--     union select email from ord where email <> ''
--   )
--
-- That `email <> ''` dropped every ticket without one. A stylist who
-- books in person or over the phone rarely captures an email, so the
-- customer disappeared from the count entirely -- not misfiled as new
-- versus returning, but gone before that comparison ran. Customers
-- read 0, new read 0, and returning (customers - new) read 0, while
-- revenue and sales -- counted straight off the rows -- were right.
-- Three tiles contradicting the two above them.
--
-- The appointment already carries client_id linking it to the client
-- book, and that column was going unused. In this database every paid
-- appointment has a client_id while only two thirds carry an email,
-- so email was the weakest key available.
--
-- Identity now falls back through three identifiers, and any of them
-- matching a prior row makes the client returning:
--
--   1. the appointment's client_id (plus the email / phone on that
--      client's record, so a ticket missing both still resolves)
--   2. email address
--   3. phone number, normalized to its last 10 digits
--
-- Email stays the key that unifies a customer ACROSS streams, since
-- product_orders has no client_id -- so it is preferred when present
-- and the other two only fill in behind it.
--
-- Everything else about the function (scheduling, local-midnight
-- firing, dedupe, opt-out, revenue math, item rollup) is unchanged.

-- Phone numbers are stored however they were typed -- "+1 (562)
-- 682-4907" here, a bare "5626824907" there. Compare only the last
-- ten digits so the same number matches across both. Anything with
-- fewer than ten digits is not a usable identifier and returns null,
-- so a partial entry never collides with someone else's.
create or replace function public._last10_digits(raw text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $fn$
  select case
           when length(regexp_replace(coalesce(raw, ''), '\D', '', 'g')) >= 10
             then right(regexp_replace(raw, '\D', '', 'g'), 10)
           else null
         end;
$fn$;

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
  for u in
    select distinct a.user_id
    from public.appointments a
    where a.appt_date >= current_date - 3
  loop
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

    if not coalesce(
         (select ss.daily_sales_summary_enabled
            from public.shop_settings ss
           where ss.user_id = u.user_id),
         true) then
      continue;
    end if;

    with appt_real as (
      select
        a.id as row_id,
        nullif(trim(coalesce(a.client_id, '')), '') as client_id,
        -- Fall back to the client book: a ticket taken in person often
        -- carries only the link, while the contact details sit on the
        -- client record. Pulling them through is what lets an
        -- appointment unify with a shop order for the same person.
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
        and a.appt_date = v_local_date
        and lower(coalesce(a.status, '')) not in
            ('cancelled', 'canceled', 'no-show', 'no_show', 'noshow', 'declined')
    ),
    appt_sales as (
      select * from appt_real where collected > 0
    ),
    ord as (
      select
        o.id::text as row_id,
        null::text as client_id,
        lower(nullif(trim(coalesce(o.customer_email, '')), '')) as email,
        public._last10_digits(o.customer_phone) as phone10,
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
    -- Every paying row from both streams, reduced to the identifiers
    -- we hold for whoever paid.
    parties as (
      select row_id, client_id, email, phone10 from appt_sales
      union all
      select row_id, client_id, email, phone10 from ord
    ),
    keyed as (
      select
        -- Email first: it is the only identifier shared by both
        -- streams, so it keeps one person from counting twice when
        -- they book AND buy on the same day. client_id and phone
        -- carry the rows email never reaches. A row with no
        -- identifier at all keys on itself, so it still counts as
        -- one customer rather than vanishing -- with nothing to match
        -- against it lands in "new", the only reading available.
        coalesce('e:' || email, 'c:' || client_id, 'p:' || phone10, 'r:' || row_id) as customer_key,
        client_id, email, phone10
      from parties
    ),
    customers_today as (
      select
        customer_key,
        max(client_id) as client_id,
        max(email)     as email,
        max(phone10)   as phone10
      from keyed
      group by customer_key
    ),
    -- Returning if ANY identifier we hold for them appears on an
    -- earlier appointment or an earlier paid order. Matching on any of
    -- the three means a client who gave an email once and a phone the
    -- next time is still recognized.
    classified as (
      select
        ct.customer_key,
        (exists (
           select 1 from public.appointments a2
            left join public.clients c2
              on c2.id = a2.client_id and c2.user_id = a2.user_id
            where a2.user_id = u.user_id
              and a2.appt_date < v_local_date
              and lower(coalesce(a2.status, '')) not in
                  ('cancelled', 'canceled', 'no-show', 'no_show', 'noshow', 'declined')
              and (
                    (ct.client_id is not null
                       and nullif(trim(coalesce(a2.client_id, '')), '') = ct.client_id)
                 or (ct.email is not null
                       and lower(nullif(trim(coalesce(nullif(trim(coalesce(a2.client_email, '')), ''),
                                                      c2.email, '')), '')) = ct.email)
                 or (ct.phone10 is not null
                       and public._last10_digits(
                             coalesce(nullif(trim(coalesce(a2.client_phone, '')), ''), c2.phone)
                           ) = ct.phone10)
              )
         )
         or exists (
           select 1 from public.product_orders o2
            where o2.user_id = u.user_id
              and o2.status = 'paid'
              and o2.paid_at is not null
              and ((o2.paid_at at time zone v_tz)::date) < v_local_date
              and (
                    (ct.email is not null
                       and lower(nullif(trim(coalesce(o2.customer_email, '')), '')) = ct.email)
                 or (ct.phone10 is not null
                       and public._last10_digits(o2.customer_phone) = ct.phone10)
              )
         )) as seen_before
      from customers_today ct
    )
    select
      (select coalesce(sum(collected), 0) from appt_sales) + (select coalesce(sum(amt), 0) from ord),
      (select count(*) from appt_sales) + (select count(*) from ord),
      (select count(*) from customers_today),
      (select count(*) from classified where not seen_before),
      (select item_name from by_item order by sales desc, cnt desc limit 1),
      (select coalesce(sales, 0) from by_item order by sales desc, cnt desc limit 1),
      (select coalesce(
                jsonb_agg(jsonb_build_object('name', item_name, 'count', cnt, 'sales', sales)
                          order by sales desc),
                '[]'::jsonb)
         from by_item)
    into v_revenue, v_sales, v_customers, v_new, v_top_name, v_top_sales, v_items;

    v_returning := greatest(0, coalesce(v_customers, 0) - coalesce(v_new, 0));

    if coalesce(v_revenue, 0) <= 0 then
      continue;
    end if;

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
