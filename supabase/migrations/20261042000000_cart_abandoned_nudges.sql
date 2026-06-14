-- Cart-abandonment recovery emails (Phase C8).
--
-- Buyer fills the cart, picks shipping, then closes the tab without paying.
-- Today the pre-insert order row sits in the Abandoned tab forever. If the
-- buyer provided a "Remind me" email upfront (new optional field at
-- checkout), we email them 24h later with a deep link back to the shop.
-- One nudge per order, never. The buyer can also unsubscribe via the
-- existing unsubscribe page (token-based, same as marketing emails).
--
-- Why opt-in (vs. capturing every Stripe email): Stripe only surfaces the
-- buyer's email after they've started filling the Checkout form. The cart
-- drawer never sees it. To recover *truly* abandoned sessions we need the
-- email collected before Stripe — that's the new recovery_email field. By
-- requiring opt-in we also stay CAN-SPAM-friendly: an explicit "yes, send
-- me a reminder" is the cleanest consent.

alter table public.product_orders
  add column if not exists recovery_email          text,
  add column if not exists cart_abandoned_nudged_at timestamptz;

-- Process cart-abandoned nudges. Returns the number of rows nudged.
-- Idempotent — `coalesce(cart_abandoned_nudged_at, …)` prevents re-sends.
-- Called by pg_cron every 30 minutes. The 24h..72h window picks up
-- abandons after a buyer has had a chance to come back on their own (24h)
-- but stops sending after 3 days so we don't email someone weeks later.
create or replace function public.process_cart_abandoned_nudges()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n integer := 0;
  base_url text := coalesce(
    current_setting('app.site_url', true),
    'https://braidbosspro.app'
  );
begin
  for r in
    select o.id, o.user_id, o.customer_token, o.recovery_email, o.line_items,
           coalesce(p.business_name, bl.business_name, 'your stylist') as studio_name,
           coalesce(p.public_slug, bl.slug)                            as handle
    from public.product_orders o
    left join public.profiles p on p.id = o.user_id
    left join lateral (
      select bl.* from public.booking_links bl
      where bl.user_id = o.user_id and bl.active = true
      order by bl.created_at asc limit 1
    ) bl on true
    where o.status = 'pending'
      and o.paid_at is null
      and o.stripe_payment_intent is null
      and o.recovery_email is not null
      and o.cart_abandoned_nudged_at is null
      and o.archived_at is null
      and o.created_at >= now() - interval '72 hours'
      and o.created_at <= now() - interval '24 hours'
    limit 200
  loop
    perform public.queue_notification(
      user_id_in            := r.user_id,
      channel_in            := 'email',
      notification_type_in  := 'cart_abandoned',
      body_in               := 'You left items in your cart at ' || r.studio_name || '.',
      subject_in            := 'You left items in your cart',
      recipient_email_in    := r.recovery_email,
      recipient_name_in     := null,
      payload_in            := jsonb_build_object(
        'studioName',  r.studio_name,
        'handle',      r.handle,
        'orderRef',    upper(substr(r.id::text, 1, 8)),
        'items',       coalesce(r.line_items, '[]'::jsonb),
        'returnUrl',
          case when r.handle is not null
               then base_url || '/@' || r.handle || '/shop'
               else base_url
          end
      ),
      dedupe_key_in         := 'cart_abandoned:' || r.id::text
    );
    update public.product_orders
    set cart_abandoned_nudged_at = now(),
        updated_at = now()
    where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.process_cart_abandoned_nudges() from public;
grant execute on function public.process_cart_abandoned_nudges() to service_role;

-- pg_cron: run every 30 minutes. Upserts by job name so re-running this
-- migration replaces the existing schedule cleanly.
do $$
declare jid bigint;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    select jobid into jid from cron.job where jobname = 'process_cart_abandoned_nudges_30m';
    if jid is not null then
      perform cron.unschedule(jid);
    end if;
    perform cron.schedule(
      'process_cart_abandoned_nudges_30m',
      '*/30 * * * *',
      $cron$ select public.process_cart_abandoned_nudges(); $cron$
    );
  end if;
end $$;

notify pgrst, 'reload schema';
