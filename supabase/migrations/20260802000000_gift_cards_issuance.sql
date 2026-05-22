-- Gift cards — PR A: issuance.
--
-- A gift card is sold as an ordinary storefront product flagged
-- is_gift_card, with denominations expressed as the product's
-- existing variants ($25 / $50 / $100 ...). Because it rides the
-- normal product + variant + cart + Stripe checkout path, the
-- PURCHASE flow needs no changes to the checkout route.
--
-- What's new: when a paid order contains a gift-card line, the
-- product-checkout webhook issues one gift_cards row per unit, with
-- a unique redeemable code, and emails the code to the buyer.
--
-- Redemption (spending a code) is PR B — it touches the live
-- checkout route and ships separately.

-- ---------------------------------------------------------------
-- products.is_gift_card — the stylist marks a product as a gift
-- card from the product editor. Off by default; existing products
-- are unaffected.
-- ---------------------------------------------------------------
alter table public.products
  add column if not exists is_gift_card boolean not null default false;

-- ---------------------------------------------------------------
-- gift_cards — one row per issued card.
-- ---------------------------------------------------------------
create table if not exists public.gift_cards (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  code             text not null unique,
  initial_amount   numeric(10,2) not null check (initial_amount > 0),
  balance          numeric(10,2) not null check (balance >= 0),
  currency         text not null default 'usd',
  -- active   — has remaining balance, redeemable
  -- depleted — balance hit 0
  -- void     — manually cancelled by the stylist
  status           text not null default 'active'
                     check (status in ('active', 'depleted', 'void')),
  purchaser_email  text,
  purchaser_name   text,
  -- The storefront order this card was issued from. Also the
  -- idempotency anchor: the webhook will not re-issue cards for an
  -- order that already has them.
  product_order_id uuid,
  issued_at        timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists gift_cards_user_idx
  on public.gift_cards (user_id, issued_at desc);
create index if not exists gift_cards_order_idx
  on public.gift_cards (product_order_id);

alter table public.gift_cards enable row level security;

-- The owning stylist can read their own issued cards. Issuance and
-- (PR B) redemption run through the service role / SECURITY DEFINER
-- RPCs, so no INSERT/UPDATE policy is granted to end users here.
drop policy if exists gift_cards_owner_select on public.gift_cards;
create policy gift_cards_owner_select on public.gift_cards
  for select using (user_id = auth.uid());
