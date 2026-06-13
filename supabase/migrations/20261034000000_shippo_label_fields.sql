-- Shippo / live carrier rates, phase 3b (label purchase + tracking).
--
-- The stylist buys the prepaid shipping label from their own Shippo account
-- via /api/shipping-label, which calls Shippo /transactions with the
-- shipping_rate_id we persisted at checkout (phase 3a). The transaction
-- response gives us a label PDF URL, the carrier-issued tracking number,
-- and a public tracking URL — all stored on the order.
--
-- label_url is the Shippo-hosted PDF link the stylist downloads + prints.
-- It's an opaque signed URL with a long-but-finite TTL; we keep it so the
-- stylist can re-open without re-buying. label_purchased_at is set the
-- first time the label is bought and used as an idempotency guard so a
-- double-tap can't issue (and bill) two labels for the same order.

alter table public.product_orders
  add column if not exists label_url            text,
  add column if not exists label_purchased_at   timestamptz;

notify pgrst, 'reload schema';
