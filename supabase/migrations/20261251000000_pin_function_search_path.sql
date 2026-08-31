-- Pin search_path on the 29 functions that were missing it.
--
-- Not a live vulnerability, and worth being precise about why rather
-- than fixing it on vibes:
--
--   * All 29 are SECURITY INVOKER, so they run with the caller's
--     rights. The classic search_path escalation needs SECURITY
--     DEFINER, where shadowing a call would borrow the definer's
--     privileges.
--   * Exploiting it also needs CREATE on a schema in the path, and
--     neither anon nor authenticated has CREATE on public.
--
-- So why bother. Two reasons.
--
-- 37 triggers fire these functions, and a trigger fires inside
-- whatever security context performed the write. A SECURITY DEFINER
-- RPC -- public_submit_booking_request, approve_booking_request and
-- the rest -- inserting into a table runs that table's triggers with
-- the definer's privileges. The trigger function's own SECURITY
-- INVOKER marking does not save it there, so an unpinned search_path
-- in a trigger is reachable from elevated context even though the
-- function looks harmless in isolation.
--
-- And the two conditions keeping it safe are both one edit away from
-- changing. Granting CREATE on public, or marking one of these
-- SECURITY DEFINER during some later refactor, opens the hole with
-- nothing to announce it. Pinning the path removes the dependency on
-- both.
--
-- ALTER FUNCTION rather than re-emitting the bodies: it changes only
-- the setting, so there is no chance of a transcription slip in 29
-- function definitions, and no behavioural diff to review.
--
-- pg_temp goes LAST on purpose. Listed first it would let a temp
-- object shadow a real one, which is the very thing being defended
-- against.

alter function public._reserved_public_slugs() set search_path = public, pg_temp;
alter function public.academy_when_label(starts_at_in timestamp with time zone, tz_in text) set search_path = public, pg_temp;
alter function public.appointments_reset_notif_stamps_on_reschedule() set search_path = public, pg_temp;
alter function public.availability_exceptions_touch_updated_at() set search_path = public, pg_temp;
alter function public.availability_rules_touch_updated_at() set search_path = public, pg_temp;
alter function public.bbp_set_updated_at() set search_path = public, pg_temp;
alter function public.booking_policies_touch_updated_at() set search_path = public, pg_temp;
alter function public.booking_requests_reset_reminder_on_reschedule() set search_path = public, pg_temp;
alter function public.business_expenses_touch_updated_at() set search_path = public, pg_temp;
alter function public.client_credits_touch_updated_at() set search_path = public, pg_temp;
alter function public.contract_templates_touch_updated_at() set search_path = public, pg_temp;
alter function public.crown_style_periods_touch_updated_at() set search_path = public, pg_temp;
alter function public.discounts_touch_updated_at() set search_path = public, pg_temp;
alter function public.fn_require_public_booking_datetime() set search_path = public, pg_temp;
alter function public.fn_set_review_request_token() set search_path = public, pg_temp;
alter function public.inventory_items_touch_updated_at() set search_path = public, pg_temp;
alter function public.payment_transactions_touch_updated_at() set search_path = public, pg_temp;
alter function public.product_profit_touch_updated_at() set search_path = public, pg_temp;
alter function public.profiles_touch_updated_at() set search_path = public, pg_temp;
alter function public.referral_rewards_touch_updated_at() set search_path = public, pg_temp;
alter function public.services_touch_updated_at() set search_path = public, pg_temp;
alter function public.set_updated_at_timestamp() set search_path = public, pg_temp;
alter function public.sms_normalize_phone(raw text) set search_path = public, pg_temp;
alter function public.sms_truncate_label(label_in text, max_len_in integer) set search_path = public, pg_temp;
alter function public.stamp_sms_consent() set search_path = public, pg_temp;
alter function public.to_hhmm(mins integer) set search_path = public, pg_temp;
alter function public.to_label(mins integer) set search_path = public, pg_temp;
alter function public.to_min(hhmm text) set search_path = public, pg_temp;
alter function public.waitlist_requests_touch_updated_at() set search_path = public, pg_temp;

-- Verification -- expects 0 rows:
--   select p.proname from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.prokind = 'f' and p.proconfig is null;
