-- Per-stylist server-side push notification toggles.
--
-- Adds a profiles.push_disabled_types text[] column that lists
-- notification_type values the stylist has opted out of receiving as
-- web push. The trg_push_stylist_addressed trigger now checks this
-- list and skips the push call when the type is disabled. Email and
-- in-app bell still fire — only the OS-level push is suppressed.
--
-- Default: empty array (everything enabled). Stylists toggle types
-- off in the Account screen.

alter table public.profiles
  add column if not exists push_disabled_types text[] not null default '{}'::text[];

create or replace function public.push_stylist_addressed_email()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_stylist_email   text;
  v_title           text;
  v_body            text;
  v_tag             text;
  v_disabled_types  text[];
begin
  if NEW.channel <> 'email' then return NEW; end if;
  if NEW.recipient_email is null or trim(NEW.recipient_email) = '' then
    return NEW;
  end if;

  begin
    select email into v_stylist_email from auth.users where id = NEW.user_id;
  exception when others then
    v_stylist_email := null;
  end;
  if v_stylist_email is null
     or lower(NEW.recipient_email) <> lower(v_stylist_email) then
    return NEW;
  end if;

  -- Honor the stylist's per-type push opt-outs. Empty array = all on.
  begin
    select coalesce(push_disabled_types, '{}'::text[])
      into v_disabled_types
      from public.profiles
      where id = NEW.user_id;
  exception when others then
    v_disabled_types := '{}'::text[];
  end;
  if NEW.notification_type is not null
     and NEW.notification_type = any(v_disabled_types) then
    return NEW;  -- stylist opted out of push for this type
  end if;

  v_title := nullif(left(trim(coalesce(NEW.subject, '')), 60), '');
  if v_title is null then v_title := 'Braid Boss Pro'; end if;
  v_body := nullif(left(trim(coalesce(NEW.body, '')), 160), '');
  if v_body is null then v_body := ''; end if;
  v_tag := coalesce(NEW.notification_type, 'bbp_notification');
  if NEW.appointment_id is not null then
    v_tag := v_tag || ':' || NEW.appointment_id::text;
  end if;

  begin
    perform public.internal_send_push(
      target_user => NEW.user_id,
      title_in    => v_title,
      body_in     => v_body,
      url_in      => '/',
      tag_in      => v_tag
    );
  exception when others then
    null;
  end;

  return NEW;
end;
$function$;
