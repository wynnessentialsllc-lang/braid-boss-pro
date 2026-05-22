-- Gift cards — PR B: redemption + buyer-chosen amounts.
--
-- Adds: a per-product flag for buyer-chosen ("custom") gift-card
-- amounts; redemption tracking on product_orders; an idempotent
-- redemption ledger + RPC; and the two new product fields surfaced
-- through public_get_product so the checkout route can see them.
--
-- Custom-amount range is enforced in the checkout route at $10-$200.

-- ---------------------------------------------------------------
-- products.gift_card_allow_custom — when true (and is_gift_card),
-- the storefront shows an "Other amount" input on the product page.
-- ---------------------------------------------------------------
alter table public.products
  add column if not exists gift_card_allow_custom boolean not null default false;

-- ---------------------------------------------------------------
-- product_orders — which gift card (if any) was redeemed, and how
-- much. Written by the checkout route; consumed by the webhook.
-- ---------------------------------------------------------------
alter table public.product_orders
  add column if not exists gift_card_id uuid;
alter table public.product_orders
  add column if not exists gift_card_redeemed_amount numeric(10,2);

-- ---------------------------------------------------------------
-- gift_card_redemptions — one row per (card, order). The UNIQUE on
-- product_order_id makes the balance decrement idempotent against
-- Stripe webhook replays.
-- ---------------------------------------------------------------
create table if not exists public.gift_card_redemptions (
  id               uuid primary key default gen_random_uuid(),
  gift_card_id     uuid not null references public.gift_cards(id) on delete cascade,
  product_order_id uuid not null unique,
  user_id          uuid not null,
  amount           numeric(10,2) not null check (amount > 0),
  created_at       timestamptz not null default now()
);

alter table public.gift_card_redemptions enable row level security;
drop policy if exists gift_card_redemptions_owner_select on public.gift_card_redemptions;
create policy gift_card_redemptions_owner_select on public.gift_card_redemptions
  for select using (user_id = auth.uid());

-- ---------------------------------------------------------------
-- redeem_gift_card_for_order — idempotent. Records the redemption
-- and decrements the card balance exactly once per order. A second
-- call (Stripe replay) hits the unique constraint and no-ops.
-- ---------------------------------------------------------------
create or replace function public.redeem_gift_card_for_order(
  card_id_in   uuid,
  order_id_in  uuid,
  user_id_in   uuid,
  amount_in    numeric
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_rows int;
  v_bal  numeric;
begin
  if amount_in is null or amount_in <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'bad_amount');
  end if;

  insert into public.gift_card_redemptions
    (gift_card_id, product_order_id, user_id, amount)
  values (card_id_in, order_id_in, user_id_in, amount_in)
  on conflict (product_order_id) do nothing;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  update public.gift_cards
     set balance    = greatest(0, balance - amount_in),
         status     = case when greatest(0, balance - amount_in) <= 0
                           then 'depleted' else status end,
         updated_at = now()
   where id = card_id_in and user_id = user_id_in
   returning balance into v_bal;

  return jsonb_build_object('ok', true, 'balance', v_bal);
end;
$function$;

revoke all on function public.redeem_gift_card_for_order(uuid,uuid,uuid,numeric) from public;
grant execute on function public.redeem_gift_card_for_order(uuid,uuid,uuid,numeric)
  to service_role;

-- ---------------------------------------------------------------
-- public_get_product — add is_gift_card + gift_card_allow_custom to
-- the return shape. Return type changes, so drop + recreate.
-- ---------------------------------------------------------------
drop function if exists public.public_get_product(text, text);

create function public.public_get_product(slug_in text, product_slug_in text)
returns table(
  id uuid, user_id uuid, title text, slug text, description text,
  image_url text, gallery_images jsonb, price numeric,
  compare_at_price numeric, inventory_count integer, category text,
  is_featured boolean, local_pickup_available boolean,
  external_checkout_url text, requires_shipping boolean,
  variant_label text, variants jsonb, stylist_account_id text,
  stylist_charges_enabled boolean,
  is_gift_card boolean, gift_card_allow_custom boolean
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare resolved record;
begin
  select * into resolved from public.public_resolve_booking_slug(slug_in) limit 1;
  if resolved.user_id is null then return; end if;
  return query
    select p.id, p.user_id, p.title, p.slug, p.description, p.image_url,
      coalesce(p.gallery_images, '[]'::jsonb),
      p.price, p.compare_at_price, p.inventory_count, p.category,
      p.is_featured, p.local_pickup_available,
      p.external_checkout_url, p.requires_shipping,
      p.variant_label,
      coalesce(p.variants, '[]'::jsonb),
      prof.stripe_connect_account_id,
      coalesce(prof.stripe_connect_charges_enabled, false),
      coalesce(p.is_gift_card, false),
      coalesce(p.gift_card_allow_custom, false)
    from public.products p
    left join public.profiles prof on prof.id = p.user_id
    where p.user_id = resolved.user_id and p.active = true and p.slug = product_slug_in
    limit 1;
end $function$;
