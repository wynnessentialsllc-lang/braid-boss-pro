-- Client Portal + Style Customization — Phase 3 public surface.
--
-- 1. public_list_services now returns the customization flags +
--    allowed color/curl lists so the public booking page can gate
--    + render the selectors. Additive to the return shape.
-- 2. public_attach_booking_customization: a tiny, separate RPC the
--    booking page calls right after public_submit_booking_request
--    succeeds. Kept separate ON PURPOSE — re-emitting the large
--    submit RPC to thread these through risks regressing the
--    deposit/variation/addons logic. This just stamps the new
--    columns onto the freshly-created row by id, best-effort.

-- Return shape changes, so the old signature must be dropped first
-- (Postgres can't CREATE OR REPLACE a function with a new OUT row).
drop function if exists public.public_list_services(text);

create function public.public_list_services(slug_in text)
returns table (
  id uuid,
  name text,
  description text,
  duration_hours numeric(5,2),
  base_price numeric(10,2),
  deposit_required boolean,
  deposit_amount numeric(10,2),
  add_ons jsonb,
  extras jsonb,
  prep_instructions text,
  buffer_before_minutes integer,
  buffer_after_minutes integer,
  max_concurrent integer,
  contract_template_id uuid,
  category_id uuid,
  featured boolean,
  cover_image_url text,
  before_after_image_url text,
  hair_included boolean,
  included_hair_description text,
  allow_client_hair_color_selection boolean,
  allowed_hair_colors text[],
  allow_client_curl_pattern_selection boolean,
  allowed_curl_patterns text[],
  allow_style_notes boolean,
  allow_inspiration_photos boolean,
  included_details text,
  customization_enabled boolean
)
language sql
security definer
set search_path = public
as $$
  select
    s.id, s.name, s.description, s.duration_hours, s.base_price,
    s.deposit_required, s.deposit_amount, s.add_ons, s.extras,
    s.prep_instructions,
    s.buffer_before_minutes, s.buffer_after_minutes, s.max_concurrent,
    s.contract_template_id, s.category_id, coalesce(s.featured, false) as featured,
    s.cover_image_url, s.before_after_image_url,
    coalesce(s.hair_included, false),
    s.included_hair_description,
    coalesce(s.allow_client_hair_color_selection, false),
    coalesce(s.allowed_hair_colors, '{}'),
    coalesce(s.allow_client_curl_pattern_selection, false),
    coalesce(s.allowed_curl_patterns, '{}'),
    coalesce(s.allow_style_notes, true),
    coalesce(s.allow_inspiration_photos, true),
    s.included_details,
    coalesce(s.customization_enabled, true)
  from public.services s
  inner join public.booking_links bl on bl.user_id = s.user_id
  where bl.slug = public._resolve_slug_to_canonical(slug_in)
    and bl.active = true
    and s.is_active = true
  order by coalesce(s.featured, false) desc, s.name asc;
$$;
revoke all on function public.public_list_services(text) from public;
grant execute on function public.public_list_services(text) to anon, authenticated;

-- Stamp customization onto a just-submitted booking request.
-- Best-effort + idempotent: only updates a row that the caller can
-- identify by request id, and never throws in a way that should
-- roll back the booking (the booking page treats failure as
-- non-fatal). selected_hair_color / selected_curl_pattern are the
-- canonical structured fields; custom "Other" free text lands in
-- customization_summary (jsonb) so notes stays the client's own
-- general message.
create or replace function public.public_attach_booking_customization(
  request_id_in        uuid,
  hair_color_in        text default null,
  curl_pattern_in      text default null,
  style_notes_in       text default null,
  custom_hair_color_in text default null,
  custom_curl_in       text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected int;
  summary jsonb := '{}'::jsonb;
begin
  if request_id_in is null then return false; end if;

  if custom_hair_color_in is not null and trim(custom_hair_color_in) <> '' then
    summary := summary || jsonb_build_object('custom_hair_color', left(trim(custom_hair_color_in), 300));
  end if;
  if custom_curl_in is not null and trim(custom_curl_in) <> '' then
    summary := summary || jsonb_build_object('custom_curl_pattern', left(trim(custom_curl_in), 300));
  end if;

  update public.booking_requests
  set selected_hair_color = nullif(trim(coalesce(hair_color_in, '')), ''),
      selected_curl_pattern = nullif(trim(coalesce(curl_pattern_in, '')), ''),
      client_style_notes = nullif(trim(coalesce(style_notes_in, '')), ''),
      customization_summary = coalesce(customization_summary, '{}'::jsonb) || summary,
      updated_at = now()
  where id = request_id_in;

  get diagnostics affected = row_count;
  return affected > 0;
end $$;

revoke all on function public.public_attach_booking_customization(uuid, text, text, text, text, text) from public;
grant execute on function public.public_attach_booking_customization(uuid, text, text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
