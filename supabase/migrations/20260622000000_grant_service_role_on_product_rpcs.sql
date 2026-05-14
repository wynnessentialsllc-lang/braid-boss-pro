-- The product-checkout API route runs under service_role to bypass
-- RLS and read across stylists' rows. The Phase-1 migration revoked
-- 'public' execute from the storefront RPCs and granted only to
-- anon + authenticated, which dropped service_role's permission
-- (service_role doesn't inherit from public in Supabase). Re-grant
-- explicitly so /api/product-checkout can resolve products.

grant execute on function public.public_get_product(text, text) to service_role;
grant execute on function public.public_list_products(text) to service_role;
grant execute on function public.public_resolve_booking_slug(text) to service_role;

notify pgrst, 'reload schema';
