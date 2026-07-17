-- "Send test to myself" for the braid care guide editor.
--
-- Lets a signed-in braider email themselves the guide exactly as a client
-- would receive it, using whatever is currently in the editor (saved or not).
-- Security definer so it can enqueue via queue_notification; it only ever
-- sends on behalf of the calling braider (auth.uid()) and to an address they
-- provide (defaulting to their own login email). The existing worker renders
-- it with renderBraidCareGuide and sends from the verified domain.
create or replace function public.send_care_guide_test(
  content_in   jsonb,
  recipient_in text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_email  text;
  v_studio text;
  v_slug   text;
  app_base text;
  v_payload jsonb;
  v_dedupe text;
  v_res    jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  v_email := nullif(trim(coalesce(recipient_in, '')), '');
  if v_email is null then
    select email into v_email from auth.users where id = v_uid;
  end if;
  if v_email is null or position('@' in v_email) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_recipient');
  end if;

  select coalesce(p.business_name, p.full_name, 'your stylist'),
         coalesce((select bl.slug from public.booking_links bl
                     where bl.user_id = v_uid and bl.active = true limit 1),
                  p.public_slug)
    into v_studio, v_slug
  from public.profiles p where p.id = v_uid;

  app_base := coalesce(nullif(current_setting('app.public_url', true), ''), 'https://braidbosspro.app');

  v_payload := jsonb_build_object(
    'content',          coalesce(content_in, '{}'::jsonb),
    'clientName',       'there',
    'studioName',       coalesce(v_studio, 'your stylist'),
    'serviceName',      'Boho Knotless Braids',
    'bookingSlug',      v_slug,
    'unsubscribeToken', null,
    'appBase',          app_base
  );

  -- Unique per click (clock_timestamp isn't folded like now()) so a braider
  -- can fire repeated tests and each one actually sends.
  v_dedupe := 'care_guide_test:' || v_uid::text || ':'
              || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS');

  v_res := public.queue_notification(
    user_id_in           => v_uid,
    channel_in           => 'email',
    notification_type_in => 'braid_care_guide',
    body_in              => 'Caring for your new braids (test)',
    subject_in           => 'Caring for your new braids (test)',
    recipient_email_in   => v_email,
    recipient_name_in    => 'there',
    payload_in           => v_payload,
    dedupe_key_in        => v_dedupe
  );

  return jsonb_build_object('ok', coalesce((v_res->>'ok')::boolean, false), 'email', v_email);
end $$;

revoke all on function public.send_care_guide_test(jsonb, text) from public;
grant execute on function public.send_care_guide_test(jsonb, text) to authenticated;

notify pgrst, 'reload schema';
