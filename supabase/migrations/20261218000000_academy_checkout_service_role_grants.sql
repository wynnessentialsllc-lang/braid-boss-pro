-- Braider Academy checkout grants fix.
--
-- The class + video checkout routes (/api/class-checkout,
-- /api/video-checkout) resolve the offering through the service-role
-- admin client by calling the same SECURITY DEFINER resolvers the public
-- storefront uses: public_get_class(text, text) / public_get_video(text,
-- text). Those functions were revoked from PUBLIC and granted only to
-- `anon, authenticated` (braider_classes_v1 / braider_video_lessons_v1),
-- so the service_role could not execute them.
--
-- Effect: the anonymous buy pages loaded fine (anon has execute), but the
-- moment a buyer tapped "Reserve"/"Get access" the checkout route hit a
-- `permission denied for function` error and returned the generic
-- "Couldn't load the class/video." — no checkout could ever start.
--
-- These resolvers are SECURITY DEFINER and already gate on published +
-- non-secret columns (they never return the class location, meeting URL,
-- or the video's secret access_url), so granting execute to service_role
-- exposes nothing the anon grant didn't already. This mirrors
-- class_seats_remaining, which was correctly granted to service_role.

begin;

grant execute on function public.public_get_class(text, text) to service_role;
grant execute on function public.public_get_video(text, text) to service_role;

commit;
