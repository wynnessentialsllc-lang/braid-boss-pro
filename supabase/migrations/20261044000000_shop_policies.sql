-- Shop policies (Phase 4): shipping, return, refund.
--
-- Three free-text fields on shop_settings that the storefront surfaces on a
-- public /@<handle>/policies page and links to from the cart checkout
-- disclosure. Visible policies are a chargeback / BNPL / consumer-law
-- safety net (see PR description) — not strictly required by law in every
-- state but disabling them makes a stylist's account materially weaker in
-- a dispute.
--
-- Hard-cap each field at 5000 chars so a pathological paste can't bloat
-- the row. The same RPC pattern as the existing booking_policies fields
-- (read-only public RPC, owner-only direct access via RLS).

alter table public.shop_settings
  add column if not exists shipping_policy text,
  add column if not exists return_policy   text,
  add column if not exists refund_policy   text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'shop_settings_policy_len_chk') then
    alter table public.shop_settings
      add constraint shop_settings_policy_len_chk
        check (
          (shipping_policy is null or char_length(shipping_policy) <= 5000)
          and (return_policy   is null or char_length(return_policy)   <= 5000)
          and (refund_policy   is null or char_length(refund_policy)   <= 5000)
        );
  end if;
end $$;

-- Public read-only RPC for the storefront's policies page. Returns the
-- three text fields + the studio name (for the page title) when the slug
-- resolves; otherwise an empty row. Anon-safe by design — these are the
-- buyer-facing texts the shop has chosen to publish.
create or replace function public.public_get_shop_policies(slug_in text)
returns table (
  shipping_policy text,
  return_policy   text,
  refund_policy   text,
  studio_name     text,
  handle          text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved record;
begin
  select * into resolved
    from public.public_resolve_booking_slug(slug_in)
    limit 1;
  if resolved.user_id is null then
    return;
  end if;
  return query
    select
      s.shipping_policy,
      s.return_policy,
      s.refund_policy,
      coalesce(bl.business_name, p.business_name) as studio_name,
      coalesce(p.public_slug, bl.slug)            as handle
    from public.shop_settings s
    left join public.profiles p on p.id = s.user_id
    left join lateral (
      select bl.* from public.booking_links bl
      where bl.user_id = s.user_id and bl.active = true
      order by bl.created_at asc limit 1
    ) bl on true
    where s.user_id = resolved.user_id
    limit 1;
end $$;

revoke all on function public.public_get_shop_policies(text) from public;
grant execute on function public.public_get_shop_policies(text) to anon, authenticated;

notify pgrst, 'reload schema';
