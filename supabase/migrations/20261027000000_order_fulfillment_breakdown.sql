-- Surface the fulfillment breakdown (method + subtotal + shipping) on the
-- public order tracking page. The columns were added in 20261026000000;
-- this widens public_get_order to return them. Changing a returns-table
-- signature requires a drop first.

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
  fulfillment_method text
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
    o.subtotal, o.shipping_cost, o.fulfillment_method
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
