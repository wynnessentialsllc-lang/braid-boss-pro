-- Return labels (Phase B7).
--
-- A stylist who needs to accept a return generates a prepaid return label
-- from the order detail sheet. We call Shippo with addresses reversed
-- (from = buyer's shipping address, to = shop's pickup address), buy a
-- label against the chosen rate, and persist the URL + tracking on the
-- order. The label is independent of the refund accounting flow — a
-- stylist can issue a return label without refunding, refund without a
-- return label, or both in any order.

alter table public.product_orders
  add column if not exists return_label_url        text,
  add column if not exists return_tracking_number  text,
  add column if not exists return_tracking_url     text,
  add column if not exists return_purchased_at     timestamptz;

notify pgrst, 'reload schema';
