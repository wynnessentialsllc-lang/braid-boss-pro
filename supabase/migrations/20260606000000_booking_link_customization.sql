-- Booking link customization fields.
--
-- Lets each stylist personalize their public /book/<slug> page:
--   * logo_url      — image URL displayed above the studio headline
--   * location_text — short location string (e.g. "Dallas, TX")
--   * phone         — contact number used for the "Text the studio"
--                     CTA (tel:/sms:) and shown as a contact pill
--   * policies      — markdown-ish multiline policies block rendered
--                     in a collapsible card above the form
--   * accent_color  — single hex that tints the booking page's
--                     primary CTA and gold accents
--
-- Backed by a CHECK constraint on accent_color so the column can't
-- carry CSS injection — only 6- or 8-character hex codes pass.
alter table public.booking_links
  add column if not exists logo_url text,
  add column if not exists location_text text,
  add column if not exists phone text,
  add column if not exists policies text,
  add column if not exists accent_color text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'booking_links_accent_color_chk'
  ) then
    alter table public.booking_links
      add constraint booking_links_accent_color_chk
      check (accent_color is null or accent_color ~ '^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$')
      not valid;
    alter table public.booking_links validate constraint booking_links_accent_color_chk;
  end if;
end $$;
