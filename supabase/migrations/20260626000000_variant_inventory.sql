-- Phase 2b Section 4 — variant inventory.
--
-- The variant jsonb shape gains optional per-variant fields
-- (inventory_count / low_stock_threshold / compare_at_price /
-- price / image_url). All optional — products without variants
-- keep using products.inventory_count exactly as before.
--
-- No schema change is required for `variants` itself (already
-- jsonb) but mark_product_order_paid needs to decrement the
-- variant's inventory when the variant has its own count.
--
-- Strategy per line_item:
--   1. If line.variant_id is set AND the matching variant has
--      an inventory_count field, decrement the variant's count
--      via jsonb_agg rebuild.
--   2. Otherwise fall back to products.inventory_count when set.
-- greatest(0, …) clamps negatives so a Stripe replay never
-- drives stock below zero.

create or replace function public.mark_product_order_paid(
  session_id_in text,
  payment_intent_in text,
  amount_total_in numeric,
  customer_email_in text,
  customer_name_in text,
  shipping_address_in jsonb
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
      amount_total = coalesce(nullif(amount_total, 0), amount_total_in),
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

revoke all on function public.mark_product_order_paid(text, text, numeric, text, text, jsonb) from public;
grant execute on function public.mark_product_order_paid(text, text, numeric, text, text, jsonb) to service_role;

notify pgrst, 'reload schema';
