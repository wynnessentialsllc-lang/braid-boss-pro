-- Shippo / live carrier rates, phase 3a (rate-shopping at checkout).
--
-- When a buyer picks a live carrier rate, we persist enough on the order to
-- (a) show carrier + service on the order page, and (b) buy the label in
-- phase 3b without re-quoting (phase 3b uses shipping_rate_id directly).
--
-- All three columns are nullable + optional — flat-rate orders and existing
-- rows are unaffected. shipping_rate_id is the Shippo rate object_id (opaque
-- string, ~25 chars but kept as text). shipping_carrier / shipping_service
-- are the human-readable provider + service name shown to the buyer
-- (e.g. 'USPS' / 'Priority Mail') and reused on the order page.

alter table public.product_orders
  add column if not exists shipping_rate_id        text,
  add column if not exists shipping_carrier        text,
  add column if not exists shipping_service        text,
  add column if not exists shipping_estimated_days integer;

notify pgrst, 'reload schema';
