-- Security fix — v_retail_analytics + v_retail_top_products were
-- flagged by the Supabase Security Advisor as "Security Definer
-- View" (critical).
--
-- ROOT CAUSE
-- A Postgres view created without `security_invoker = on` executes
-- with the VIEW OWNER's privileges and RLS context, not the querying
-- user's. product_orders HAS correct RLS:
--   create policy product_orders_owner_select on public.product_orders
--     for select to authenticated using (user_id = auth.uid());
-- ...but the owner-context view bypassed it. Both views GROUP BY
-- o.user_id across the ENTIRE product_orders table and are granted
-- to `authenticated` + auto-exposed by PostgREST — so any logged-in
-- stylist could GET /rest/v1/v_retail_analytics and read every other
-- stylist's gross revenue / AOV / order counts / top products.
--
-- FIX
--   1. security_invoker = on  → the view reads product_orders as the
--      CALLER, so product_orders' RLS engages and filters to the
--      caller's own rows before aggregation. No cross-tenant row
--      ever enters the GROUP BY, so no aggregation leakage.
--   2. explicit `where o.user_id = (select auth.uid())` → defense in
--      depth. Even if RLS on product_orders were ever disabled, the
--      view still cannot return another tenant's rows. The
--      (select ...) wrapper lets the planner evaluate auth.uid()
--      once per query (initplan) instead of per row.
--
-- IDEMPOTENT: CREATE OR REPLACE VIEW. Output column set / names /
-- order are unchanged (a WHERE clause doesn't alter columns), so the
-- replace is accepted on re-run. No data migration.
--
-- PERFORMANCE: product_orders_user_idx (user_id, created_at desc)
-- already covers the new predicate — per-tenant index range scan,
-- strictly cheaper than the previous full-table aggregate. No new
-- index required.
--
-- NO APP IMPACT: grep of app/ shows neither view is queried by the
-- frontend — this is purely an exposed attack surface, so there is
-- no dashboard query to break.

create or replace view public.v_retail_analytics
with (security_invoker = on) as
select
  o.user_id,
  count(*) filter (where o.status = 'paid')                            as orders_paid,
  count(*) filter (where o.fulfillment_status = 'refunded')            as orders_refunded,
  sum(case when o.status = 'paid' then o.amount_total else 0 end)      as gross_revenue,
  avg(case when o.status = 'paid' then o.amount_total else null end)   as avg_order_value,
  min(o.created_at) as first_order_at,
  max(o.created_at) as last_order_at
from public.product_orders o
where o.user_id = (select auth.uid())
group by o.user_id;

grant select on public.v_retail_analytics to authenticated;

create or replace view public.v_retail_top_products
with (security_invoker = on) as
select
  o.user_id,
  (li->>'product_id')::uuid                                 as product_id,
  li->>'title'                                              as title,
  sum(coalesce((li->>'quantity')::int, 1))                  as units_sold,
  sum(coalesce((li->>'quantity')::int, 1) * coalesce((li->>'unit_amount')::numeric, 0)) as revenue
from public.product_orders o
cross join lateral jsonb_array_elements(coalesce(o.line_items, '[]'::jsonb)) li
where o.status = 'paid'
  and o.user_id = (select auth.uid())
group by o.user_id, (li->>'product_id')::uuid, li->>'title';

grant select on public.v_retail_top_products to authenticated;

notify pgrst, 'reload schema';
