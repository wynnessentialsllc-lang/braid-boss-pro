-- Client Portal + Style Customization — Phase 1 schema foundation.
--
-- Purely additive. Audited first (see PR description): none of the
-- customization columns exist yet; `services.prep_instructions`
-- already exists (20260512) so it is NOT re-added; add-ons already
-- exist as `services.extras` jsonb so NO service_addons table is
-- created (reusing the existing extras pattern avoids fragmenting
-- add-on logic + the working deposit/booking flow).

-- ===================================================================
-- 1. services — style customization controls
-- ===================================================================
alter table public.services
  add column if not exists hair_included boolean not null default false,
  add column if not exists included_hair_description text,
  add column if not exists allow_client_hair_color_selection boolean not null default false,
  add column if not exists allowed_hair_colors text[] not null default '{}',
  add column if not exists allow_style_notes boolean not null default true,
  add column if not exists allow_inspiration_photos boolean not null default true,
  add column if not exists included_details text,
  add column if not exists customization_enabled boolean not null default true;
-- prep_instructions intentionally NOT added — already exists.

-- ===================================================================
-- 2. booking_requests — captured client customization
-- ===================================================================
alter table public.booking_requests
  add column if not exists selected_hair_color text,
  add column if not exists client_style_notes text,
  add column if not exists inspiration_photo_urls text[] not null default '{}',
  add column if not exists customization_summary jsonb not null default '{}'::jsonb,
  -- Read-only client portal token. Distinct from cancel_token /
  -- reschedule_token (which are burned after use) so the portal
  -- link keeps working for the life of the booking.
  add column if not exists portal_token text;

create unique index if not exists booking_requests_portal_token_uidx
  on public.booking_requests (portal_token)
  where portal_token is not null;

-- ===================================================================
-- 3. Extend the token trigger to also mint portal_token
-- ===================================================================
-- Mirrors the production hotfix: schema-qualified
-- extensions.gen_random_bytes + explicit search_path.
create or replace function public.fn_set_booking_action_tokens()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.appointment_id is not null
     and new.approval_status in ('approved', 'confirmed')
     and (new.cancel_token is null
          or new.reschedule_token is null
          or new.portal_token is null) then
    if new.cancel_token is null then
      new.cancel_token := encode(extensions.gen_random_bytes(16), 'hex');
    end if;
    if new.reschedule_token is null then
      new.reschedule_token := encode(extensions.gen_random_bytes(16), 'hex');
    end if;
    if new.portal_token is null then
      new.portal_token := encode(extensions.gen_random_bytes(16), 'hex');
    end if;
  end if;
  return new;
end $$;

-- Backfill portal_token for bookings that already have action tokens.
update public.booking_requests
set portal_token = encode(extensions.gen_random_bytes(16), 'hex')
where portal_token is null
  and (cancel_token is not null or reschedule_token is not null);

-- ===================================================================
-- 4. public_get_booking_portal_state — read-only, multi-call
-- ===================================================================
-- The client portal reads this with the portal_token from their
-- link. Returns the full appointment + customization snapshot.
-- Unlike the action-state RPC this is non-destructive and may be
-- called any number of times. Echoes the cancel/reschedule tokens
-- (when still valid) so the portal can render the action links
-- without a second lookup.
create or replace function public.public_get_booking_portal_state(
  token_in text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  br public.booking_requests%rowtype;
  studio_name text;
  reschedule_ok boolean;
begin
  if token_in is null or length(trim(token_in)) < 16 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_token');
  end if;

  select * into br from public.booking_requests
  where portal_token = token_in
  limit 1;
  if br.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  studio_name := coalesce(
    nullif(trim(public.public_get_studio_name(br.user_id)), ''),
    'your stylist'
  );
  reschedule_ok := coalesce(br.reschedule_count, 0) = 0
    and br.reschedule_token is not null
    and br.approval_status <> 'cancelled'
    and br.cancelled_at is null;

  return jsonb_build_object(
    'ok',                true,
    'request_id',        br.id,
    'studio_name',       studio_name,
    'client_name',       br.client_name,
    'service_name',      coalesce(br.selected_variation_name, br.service_name),
    'approval_status',   br.approval_status,
    'preferred_date',    br.preferred_date,
    'preferred_time',    br.preferred_time,
    'deposit_amount',    br.deposit_amount,
    'deposit_paid',      br.deposit_paid,
    'service_price',     coalesce(br.selected_variation_price, br.service_price),
    'cancelled_at',      br.cancelled_at,
    'reschedule_count',  br.reschedule_count,
    'deposit_forfeited', br.deposit_forfeited,
    'deposit_rollover',  br.deposit_rollover,
    -- Customization
    'selected_hair_color',   br.selected_hair_color,
    'client_style_notes',    br.client_style_notes,
    'inspiration_photo_urls', coalesce(br.inspiration_photo_urls, '{}'),
    'selected_addons',       coalesce(br.selected_addons, '[]'::jsonb),
    'customization_summary', coalesce(br.customization_summary, '{}'::jsonb),
    'notes',                 br.notes,
    -- Service-level "what's included" + prep, snapshotted live from
    -- the current service row (best-effort; null-safe).
    'service_meta', (
      select jsonb_build_object(
        'hair_included',            s.hair_included,
        'included_hair_description', s.included_hair_description,
        'included_details',         s.included_details,
        'prep_instructions',        s.prep_instructions
      )
      from public.services s
      where s.id = br.service_id
      limit 1
    ),
    -- Action links (only when still actionable)
    'cancel_token',       case when br.approval_status <> 'cancelled'
                               and br.cancelled_at is null
                          then br.cancel_token else null end,
    'reschedule_token',   case when reschedule_ok
                          then br.reschedule_token else null end
  );
end $$;

revoke all on function public.public_get_booking_portal_state(text) from public;
grant execute on function public.public_get_booking_portal_state(text) to anon, authenticated;

notify pgrst, 'reload schema';
