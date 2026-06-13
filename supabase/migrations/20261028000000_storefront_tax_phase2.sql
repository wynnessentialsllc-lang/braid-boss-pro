-- Storefront tax, phase 2: collect sales tax via Stripe Tax (automatic by
-- buyer address). Opt-in per shop; the checkout route degrades gracefully
-- (retries without tax) if a stylist enables it before Stripe Tax is active
-- on their connected account, so turning it on can never break checkout.

alter table public.shop_settings
  add column if not exists tax_enabled boolean not null default false;

alter table public.product_orders
  add column if not exists tax_amount numeric(10, 2);

-- mark_product_order_paid gains a tax_amount_in arg and now prefers the
-- authoritative Stripe session total post-payment (it includes tax +
-- shipping, which aren't known when the order row is pre-inserted). The
-- 6-arg version is dropped so there's no ambiguous overload.
drop function if exists public.mark_product_order_paid(text, text, numeric, text, text, jsonb);

create or replace function public.mark_product_order_paid(
  session_id_in text,
  payment_intent_in text,
  amount_total_in numeric,
  customer_email_in text,
  customer_name_in text,
  shipping_address_in jsonb,
  tax_amount_in numeric default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.product_orders%rowtype;
  li      jsonb;
  pid     uuid;
  vid     text;
  qty     int;
  var_has_inv boolean;
begin
  select * into existing
    from public.product_orders
    where stripe_session_id = session_id_in
    limit 1;
  if existing.id is null then return false; end if;
  if existing.status = 'paid' then return true; end if;

  update public.product_orders
  set status = 'paid',
      stripe_payment_intent = coalesce(stripe_payment_intent, payment_intent_in),
      customer_email = coalesce(customer_email, customer_email_in),
      customer_name = coalesce(customer_name, customer_name_in),
      shipping_address = coalesce(shipping_address, shipping_address_in),
      -- Post-payment, the Stripe total is authoritative (it folds in tax +
      -- shipping that the pre-insert couldn't know). Fall back to the stored
      -- value when Stripe reports 0 (e.g. a gift-card-covered order).
      amount_total = coalesce(nullif(amount_total_in, 0), amount_total),
      tax_amount = coalesce(tax_amount, tax_amount_in),
      paid_at = now(),
      updated_at = now()
  where id = existing.id;

  for li in select * from jsonb_array_elements(coalesce(existing.line_items, '[]'::jsonb))
  loop
    pid := nullif(li->>'product_id', '')::uuid;
    vid := nullif(li->>'variant_id', '');
    qty := greatest(1, coalesce((li->>'quantity')::int, 1));

    if pid is null then continue; end if;

    var_has_inv := false;
    if vid is not null then
      select exists (
        select 1
        from public.products p, jsonb_array_elements(coalesce(p.variants, '[]'::jsonb)) v
        where p.id = pid
          and p.user_id = existing.user_id
          and (v->>'id') = vid
          and v ? 'inventory_count'
          and (v->>'inventory_count') is not null
      ) into var_has_inv;
    end if;

    if var_has_inv then
      update public.products p
      set variants = (
        select jsonb_agg(
          case
            when (v->>'id') = vid then
              jsonb_set(
                v,
                '{inventory_count}',
                to_jsonb(greatest(0, coalesce((v->>'inventory_count')::int, 0) - qty))
              )
            else v
          end
        )
        from jsonb_array_elements(p.variants) v
      ),
      updated_at = now()
      where p.id = pid and p.user_id = existing.user_id;
    else
      update public.products
      set inventory_count = greatest(0, coalesce(inventory_count, 0) - qty),
          updated_at = now()
      where id = pid
        and user_id = existing.user_id
        and inventory_count is not null;
    end if;
  end loop;

  return true;
end $$;

revoke all on function public.mark_product_order_paid(text, text, numeric, text, text, jsonb, numeric) from public;
grant execute on function public.mark_product_order_paid(text, text, numeric, text, text, jsonb, numeric) to service_role;

-- Widen public_get_order with tax_amount for the tracking page breakdown.
drop function if exists public.public_get_order(text);

create or replace function public.public_get_order(token_in text)
returns table (
  id uuid,
  customer_token text,
  status text,
  fulfillment_status text,
  amount_total numeric,
  currency text,
  customer_email text,
  customer_name text,
  shipping_required boolean,
  shipping_address jsonb,
  line_items jsonb,
  tracking_carrier text,
  tracking_number text,
  tracking_url text,
  shipping_notes text,
  paid_at timestamptz,
  fulfilled_at timestamptz,
  shipped_at timestamptz,
  created_at timestamptz,
  stylist_business_name text,
  stylist_logo_url text,
  stylist_handle text,
  subtotal numeric,
  shipping_cost numeric,
  fulfillment_method text,
  tax_amount numeric
) language plpgsql security definer set search_path = public as $$
begin
  return query
  select o.id, o.customer_token, o.status, o.fulfillment_status,
    o.amount_total, o.currency, o.customer_email, o.customer_name,
    o.shipping_required, o.shipping_address, o.line_items,
    o.tracking_carrier, o.tracking_number, o.tracking_url,
    coalesce(s.shipping_notes, o.shipping_notes) as shipping_notes,
    o.paid_at, o.fulfilled_at, o.shipped_at, o.created_at,
    coalesce(bl.business_name, p.business_name)              as stylist_business_name,
    bl.logo_url                                              as stylist_logo_url,
    coalesce(p.public_slug, bl.slug)                         as stylist_handle,
    o.subtotal, o.shipping_cost, o.fulfillment_method, o.tax_amount
  from public.product_orders o
  left join public.shop_settings s on s.user_id = o.user_id
  left join public.profiles p on p.id = o.user_id
  left join lateral (
    select bl.* from public.booking_links bl
    where bl.user_id = o.user_id and bl.active = true
    order by bl.created_at asc limit 1
  ) bl on true
  where o.customer_token = token_in
  limit 1;
end $$;

revoke all on function public.public_get_order(text) from public;
grant execute on function public.public_get_order(text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
