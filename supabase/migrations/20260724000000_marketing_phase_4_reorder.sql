-- Marketing automation V4 — product re-order nudges.
--
-- Phase 4: when a customer bought a consumable product N weeks
-- ago (oil, edge control, spray, etc.), email them to restock
-- before they're out. Rides on the same suppression + sender
-- infrastructure from Phases 1–3.
--
-- Scope decision: V1 only nudges buyers who are ALSO already in
-- the clients table (matched by email). Pure storefront one-off
-- buyers without a client record are skipped — auto-creating a
-- client row for every product buyer would pollute the stylist's
-- main clients tab. A future phase can add an opt-in "auto-add
-- product buyers as clients" toggle if needed.

-- ---------------------------------------------------------------
-- Per-product reorder window
-- ---------------------------------------------------------------
alter table public.products
  add column if not exists reorder_after_weeks integer
    check (reorder_after_weeks is null or (reorder_after_weeks > 0 and reorder_after_weeks <= 52));

-- ---------------------------------------------------------------
-- Per-stylist master switch
-- ---------------------------------------------------------------
alter table public.shop_settings
  add column if not exists marketing_reorder_enabled boolean not null default true;

-- ---------------------------------------------------------------
-- Re-order nudge processor
-- ---------------------------------------------------------------
-- For each paid product_orders row with paid_at in the last year,
-- unnest line_items. For each line item whose product has
-- reorder_after_weeks set AND today is past (paid_at + window) AND
-- the buyer's email matches an opted-in client AND that client/
-- product hasn't received a reorder_nudge in the last 60 days,
-- enqueue an email. Dedupe key (order, product) so a re-run skips
-- already-sent rows; the 60-day check stops re-firing for the
-- same client+product on subsequent orders unless they've been
-- quiet a while.
create or replace function public.process_reorder_nudges()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_enqueued int := 0;
  r record;
  v_subject text;
  v_body    text;
  v_payload jsonb;
  v_token   text;
  v_dedupe  text;
begin
  for r in
    with line_items as (
      select
        o.id          as order_id,
        o.user_id,
        o.customer_email,
        o.customer_name,
        o.paid_at,
        (li->>'product_id')::uuid as product_id,
        li->>'title'              as line_title,
        coalesce((li->>'quantity')::int, 1) as quantity
      from public.product_orders o,
           jsonb_array_elements(coalesce(o.line_items, '[]'::jsonb)) as li
      where o.status = 'paid'
        and o.paid_at is not null
        and o.paid_at >= now() - interval '365 days'
        and o.customer_email is not null
        and length(trim(o.customer_email)) > 3
        and (li->>'product_id') is not null
    )
    select
      la.order_id,
      la.user_id,
      la.customer_email,
      la.customer_name,
      la.paid_at,
      la.product_id,
      la.line_title,
      la.quantity,
      p.title           as product_title,
      p.slug            as product_slug,
      p.image_url       as product_image,
      p.reorder_after_weeks,
      c.id              as client_id,
      c.name            as client_name,
      coalesce(pr.business_name, pr.full_name) as studio_name,
      coalesce(bl.slug, pr.public_slug) as booking_slug
    from line_items la
    join public.products p
      on p.id = la.product_id
     and p.user_id = la.user_id
     and p.reorder_after_weeks is not null
    join public.clients c
      on c.user_id = la.user_id
     and lower(trim(c.email)) = lower(trim(la.customer_email))
     and c.marketing_emails_enabled = true
    left join public.shop_settings ss on ss.user_id = la.user_id
    left join public.profiles pr on pr.id = la.user_id
    left join public.booking_links bl on bl.user_id = la.user_id and bl.active = true
    where
      -- Stylist master switch on
      coalesce(ss.marketing_reorder_enabled, true) = true
      -- Today is on/past the reorder window
      and now() >= (la.paid_at + (p.reorder_after_weeks * interval '7 days'))
      -- Cap at "shouldn't be ancient" — past 365 days the email
      -- feels random; we'd rather catch them with a win-back via
      -- the appointments path (Phase 2).
      and la.paid_at >= now() - interval '365 days'
      -- No reorder_nudge for this (client, product) in last 60 days
      and not exists (
        select 1 from public.notification_queue nq
        where nq.client_id = c.id
          and nq.user_id = la.user_id
          and nq.notification_type = 'reorder_nudge'
          and nq.payload->>'productId' = la.product_id::text
          and nq.created_at > now() - interval '60 days'
      )
  loop
    -- Dedupe per (order, product) so the same order line never
    -- multi-sends even on cron re-runs.
    v_dedupe := 'reorder_nudge:' || r.order_id || ':' || r.product_id;
    if exists (
      select 1 from public.notification_queue where dedupe_key = v_dedupe
    ) then
      continue;
    end if;

    v_token := public.ensure_client_marketing_token(r.user_id, r.client_id);

    v_subject := 'Time to restock your ' || coalesce(r.product_title, 'order') || '?';
    v_body    := 'Your ' || coalesce(r.product_title, 'product') || ' from ' || coalesce(r.studio_name, 'us') || ' should be running low about now.';
    v_payload := jsonb_build_object(
      'clientName',       r.client_name,
      'studioName',       coalesce(r.studio_name, 'your stylist'),
      'productId',        r.product_id::text,
      'productTitle',     r.product_title,
      'productSlug',      r.product_slug,
      'productImage',     r.product_image,
      'lastOrderDate',    to_char(r.paid_at, 'YYYY-MM-DD'),
      'weeksSince',       floor(extract(epoch from (now() - r.paid_at)) / 604800)::int,
      'reorderAfterWeeks', r.reorder_after_weeks,
      'bookingSlug',      r.booking_slug,
      'unsubscribeToken', v_token
    );

    perform public.queue_notification(
      r.user_id, 'email', 'reorder_nudge',
      v_body, v_subject, r.customer_email, null, r.client_name,
      v_payload, null, v_dedupe, null, null, r.client_id, null
    );
    v_enqueued := v_enqueued + 1;
  end loop;
  return v_enqueued;
end $$;

revoke all on function public.process_reorder_nudges() from public;
grant execute on function public.process_reorder_nudges() to service_role;

-- ---------------------------------------------------------------
-- Daily cron — same 17:00 UTC slot as the other marketing scanners
-- ---------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'reorder_nudges_daily') then
    perform cron.unschedule('reorder_nudges_daily');
  end if;
end $$;

select cron.schedule(
  'reorder_nudges_daily',
  '0 17 * * *',
  $$select public.process_reorder_nudges();$$
);
