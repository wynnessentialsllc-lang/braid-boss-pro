-- Marketplace — personalized "you're listed" in-app inbox notice.
--
-- Instead of a one-time mass email blast (enqueue_marketplace_launch_
-- notifications), greet each stylist in their own inbox the first time
-- they're actually listed. notify_self_marketplace_listed() self-gates on
-- the SAME completeness rule the discovery RPC enforces and drops a single,
-- deterministic-id bell (idempotent — safe to call on every load). The app
-- calls it whenever it has the stylist's listing loaded.
--
-- This supersedes the launch-blast helper for ongoing use: any stylist who
-- becomes listed — new or existing — gets the welcome automatically.

create or replace function public.notify_self_marketplace_listed()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  v_listed boolean;
  v_biz text;
begin
  if uid is null then
    return;
  end if;

  select
    bl.active
    and bl.slug is not null
    and coalesce(trim(bl.business_city), '') <> ''
    and bl.marketplace_hidden = false
    and (coalesce(bl.logo_url, '') <> '' or jsonb_array_length(bl.gallery_photos) > 0)
    and exists (
      select 1 from public.services s
      where s.user_id = uid and s.is_active = true and s.base_price > 0
    ),
    bl.business_name
  into v_listed, v_biz
  from public.booking_links bl
  where bl.user_id = uid;

  if not coalesce(v_listed, false) then
    return;
  end if;

  -- One deterministic, idempotent welcome bell per stylist.
  insert into public.notifications (id, user_id, category, title, body, data)
  values (
    'marketplace_listed:' || uid::text,
    uid,
    'marketplace',
    'You''re live in the marketplace 🎉',
    'Welcome, ' || coalesce(nullif(trim(v_biz), ''), 'boss') ||
      '! Your booking page is all set, so new clients can now discover and ' ||
      'book you on the Find a Braider marketplace. Want to stay private? You ' ||
      'can hide your listing anytime in Account & Sync.',
    '{}'::jsonb
  )
  on conflict (id) do nothing;
end;
$$;

revoke all on function public.notify_self_marketplace_listed() from public;
grant execute on function public.notify_self_marketplace_listed() to authenticated;
