-- Shippo webhook HMAC verification (Phase A2).
--
-- Shippo signs webhook bodies with a per-account secret you can retrieve
-- from goshippo.com → API → Webhooks. When the stylist pastes that secret
-- here, the receiving route additionally verifies the Shippo-Auth-Signature
-- header (HMAC-SHA256 of "<timestamp>.<raw_body>"). The URL ?secret= check
-- stays in place so already-registered webhooks (and any new webhooks
-- without a pasted signing secret) continue to work — HMAC is additive.
--
-- Owner-only RLS via shop_settings; the secret never leaves the server
-- (read only by the webhook route under service role).

alter table public.shop_settings
  add column if not exists shippo_webhook_secret text;

notify pgrst, 'reload schema';
