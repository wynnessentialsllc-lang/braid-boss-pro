-- Performance: add covering indexes for the 9 foreign keys flagged by
-- Supabase's unindexed_foreign_keys advisor.
--
-- A FK with no index on its referencing column forces a sequential scan
-- on the child table for parent-side deletes/updates and for joins that
-- filter by the FK. These are all single-column FKs; a plain btree index
-- on each is a pure additive win (no behavior change). `if not exists`
-- keeps this safe to re-run. Tables are small, so a non-CONCURRENT
-- CREATE INDEX is effectively instant and is required for the migration
-- transaction.

create index if not exists idx_booking_contracts_contract_template_id
  on public.booking_contracts (contract_template_id);

create index if not exists idx_client_packages_template_id
  on public.client_packages (template_id);

create index if not exists idx_gift_card_redemptions_gift_card_id
  on public.gift_card_redemptions (gift_card_id);

create index if not exists idx_package_redemptions_user_id
  on public.package_redemptions (user_id);

create index if not exists idx_service_contract_templates_contract_template_id
  on public.service_contract_templates (contract_template_id);

create index if not exists idx_style_requests_ai_suggested_service_id
  on public.style_requests (ai_suggested_service_id);

create index if not exists idx_support_bug_reports_user_id
  on public.support_bug_reports (user_id);

create index if not exists idx_support_feature_requests_user_id
  on public.support_feature_requests (user_id);

create index if not exists idx_waitlist_requests_service_id
  on public.waitlist_requests (service_id);
