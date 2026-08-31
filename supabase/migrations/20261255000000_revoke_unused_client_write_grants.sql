-- Remove client-role write grants that nothing uses and only RLS denies.
--
-- sms_credits, sms_credit_ledger and sms_credit_purchases each grant
-- INSERT and UPDATE to `authenticated`, while having NO row-level policy
-- that permits a client write. RLS with no permissive policy denies, so
-- today these writes fail and the balances are safe. Verified, not
-- assumed -- there is no client write policy on any of the three.
--
-- The grant is still worth removing, because of what it costs when it is
-- wrong. The prepaid balance in sms_credits IS the product: a stylist who
-- could UPDATE her own row would mint free texts, and every one of those
-- texts is billed to the platform's Twilio account. The only thing
-- standing between that and a real charge is the continued ABSENCE of a
-- policy -- so the day someone adds a well-meaning
--
--   create policy ... on sms_credits for all using (user_id = auth.uid())
--
-- to let a stylist see her own balance, the write opens with it. `for all`
-- is exactly the shape already used elsewhere in this schema
-- (membership_invoices_owner_all, client_memberships_owner_all), so this
-- is a plausible mistake, not a hypothetical one.
--
-- With the grant gone, that mistake is inert: a policy cannot permit a
-- privilege the role does not hold. Two independent things would have to
-- go wrong instead of one.
--
-- SELECT is deliberately untouched -- app/lib/sms-credits.ts reads the
-- balance and the ledger straight from the browser to render the credits
-- card, and those reads are correctly scoped by their SELECT policies.
--
-- Nothing loses a write it was actually performing. The only writer in
-- the codebase is app/api/sms-credits/checkout/route.ts, which uses the
-- service role (`admin.from(...)`), and service_role is unaffected.

revoke insert, update, delete on public.sms_credits          from anon, authenticated;
revoke insert, update, delete on public.sms_credit_ledger    from anon, authenticated;
revoke insert, update, delete on public.sms_credit_purchases from anon, authenticated;

notify pgrst, 'reload schema';
