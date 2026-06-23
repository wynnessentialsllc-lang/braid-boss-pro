-- Sync settings.business_name -> profiles.business_name
--
-- Bug: the notification/enqueue functions (booking confirmation, reminders,
-- review requests, contract emails, marketing) derive the studio name from
--   coalesce(p.business_name, p.full_name, 'Braid Boss Pro')
-- i.e. they read public.profiles. But the app's Settings screen saves the
-- business name to public.settings.business_name (the payment functions
-- already read it from there). So profiles.business_name was left null for
-- everyone who onboarded normally, and every client SMS/email fell back to
-- the generic "Braid Boss Pro".
--
-- Rather than rewrite ~8 large SECURITY DEFINER functions (regression risk),
-- we keep profiles.business_name mirrored from settings.business_name: a
-- one-time backfill for existing rows + an AFTER trigger for future edits.
-- settings is the source of truth (app writes there); profiles holds a
-- denormalized copy that the existing notification functions already read.

-- 1. Trigger function: mirror a non-empty settings.business_name onto the
--    owner's profile. Only writes when the value actually changes, and never
--    blanks an existing profile name from an empty settings value.
create or replace function public.sync_business_name_to_profile()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $func$
begin
  if nullif(btrim(coalesce(new.business_name, '')), '') is not null then
    update public.profiles
       set business_name = btrim(new.business_name)
     where id = new.user_id
       and business_name is distinct from btrim(new.business_name);
  end if;
  return new;
end;
$func$;

drop trigger if exists settings_sync_business_name on public.settings;
create trigger settings_sync_business_name
  after insert or update of business_name on public.settings
  for each row
  execute function public.sync_business_name_to_profile();

-- 2. One-time backfill: populate profiles.business_name from settings for any
--    account that already has a business name saved. Idempotent.
update public.profiles p
   set business_name = btrim(s.business_name)
  from public.settings s
 where s.user_id = p.id
   and nullif(btrim(coalesce(s.business_name, '')), '') is not null
   and p.business_name is distinct from btrim(s.business_name);
