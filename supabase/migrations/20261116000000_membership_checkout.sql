-- Memberships — Phase 2 (online signup).
--
-- The public buy page is shared between one-time packages and recurring
-- memberships, so the anon template RPC now also returns the billing
-- shape (mode + interval). Everything else about the function is
-- unchanged.

create or replace function public.public_get_package_template(template_id_in uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t            public.package_templates%rowtype;
  studio_name  text;
  can_charge   boolean;
begin
  if template_id_in is null then
    return jsonb_build_object('ok', false);
  end if;

  select * into t from public.package_templates
   where id = template_id_in and active = true
   limit 1;
  if t.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  studio_name := coalesce(
    nullif(trim(public.public_get_studio_name(t.user_id)), ''),
    'your stylist'
  );

  select coalesce(stripe_connect_charges_enabled, false)
    into can_charge
  from public.profiles
  where id = t.user_id
  limit 1;

  return jsonb_build_object(
    'ok',               true,
    'id',               t.id,
    'name',             t.name,
    'kind',             t.kind,
    'visits',           t.visits,
    'credit_amount',    t.credit_amount,
    'price',            t.price,
    'service_label',    t.service_label,
    'billing_mode',     coalesce(t.billing_mode, 'one_time'),
    'billing_interval', t.billing_interval,
    'studio_name',      studio_name,
    'can_charge',       coalesce(can_charge, false)
  );
end;
$$;

revoke all on function public.public_get_package_template(uuid) from public;
grant execute on function public.public_get_package_template(uuid) to anon, authenticated;
