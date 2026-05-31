"use client";

import { LegalShell, LegalSection, LegalList } from "../(legal)/_shell";

export default function PrivacyPage() {
  return (
    <LegalShell
      title="Privacy Policy"
      intro="Braid Boss Pro is a tool for independent braiders to organize their business. We treat your data like it’s ours — minimal, scoped to you, and never sold."
      updated="May 8, 2026">

      <LegalSection title="What we collect">
        <p>The data Braid Boss Pro stores is the data you put in. Specifically:</p>
        <LegalList items={[
          <><strong>Account data</strong> — email and a hashed password (handled by our auth provider, Supabase). We never see your plaintext password.</>,
          <><strong>Client data</strong> — names, phone, email, preferred styles, allergies, and notes that you record about your clients.</>,
          <><strong>Appointments</strong> — date, time, service, pricing, payment status, and notes.</>,
          <><strong>Photos</strong> — inspiration, before-and-after, and reference images you attach to client profiles. Stored privately in our secure storage bucket; only you can read them.</>,
          <><strong>Notifications</strong> — a record of subscriptions for browser or device push, plus the dismissed/read state of in-app alerts.</>,
          <><strong>Analytics & insights</strong> — computed in your device or in our backend solely from the data above. We don’t ship your data to a third-party analytics product.</>,
          <><strong>Public booking links</strong> — the slug you generate, plus any incoming requests submitted to it. Anyone with the slug can submit a request; only you can read the inbox.</>,
        ]} />
      </LegalSection>

      <LegalSection title="What we don’t do">
        <LegalList items={[
          <>We do <strong>not</strong> sell, rent, or share your data with advertisers or data brokers.</>,
          <>We do <strong>not</strong> process payments inside the app. There is no Stripe, no payment card collection, and no billing inside Braid Boss Pro. Money you collect from clients happens off-app via the methods you already use (cash, CashApp, Zelle, etc.).</>,
          <>We do <strong>not</strong> read your photos, notes, or client lists for any purpose other than displaying them back to you.</>,
        ]} />
      </LegalSection>

      <LegalSection title="Security">
        <p>
          All data is stored in a managed Postgres database with row-level security: your account can only ever read or write rows you own. Photos live in a private storage bucket with the same per-user isolation. Communication between your device and our servers is always over HTTPS.
        </p>
      </LegalSection>

      <LegalSection title="Your control">
        <LegalList items={[
          <><strong>Export</strong> — Account & Sync → Export all data (JSON). One tap, downloads everything we have for you.</>,
          <><strong>Deletion</strong> — Account & Sync → Delete account. We delete your auth record and cascade-delete every per-user row in the database. Local-only data on the device is not cleared automatically; uninstall or clear browser storage to remove that.</>,
          <><strong>Notifications</strong> — Toggle off any time in Account & Sync, or revoke at the OS / browser level.</>,
          <><strong>Public booking link</strong> — Pause or revoke any time. Revoked links return a 404 immediately.</>,
        ]} />
      </LegalSection>

      <LegalSection title="SMS messaging">
        <p>
          When a stylist books a client through Braid Boss Pro and the client opts in to receive text messages, Braid Boss Pro sends transactional SMS on the stylist&rsquo;s behalf — appointment confirmations, reminders before scheduled appointments, balance-due notifications, and post-appointment rebooking nudges. Frequency depends on the client&rsquo;s appointment activity (typically 1–5 messages per appointment).
        </p>
        <LegalList items={[
          <><strong>Opt-in</strong> — Clients consent by checking the SMS opt-in box on the stylist&rsquo;s public booking form before submitting their booking. Consent is logged with a timestamp on the client&rsquo;s record.</>,
          <><strong>Opt-out</strong> — Clients can reply <strong>STOP</strong> (or STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT) to any message at any time to unsubscribe immediately. Reply <strong>HELP</strong> for help.</>,
          <><strong>Carriers &amp; rates</strong> — Message and data rates may apply depending on the recipient&rsquo;s mobile carrier and plan. Braid Boss Pro does not charge clients for SMS.</>,
          <><strong>Sharing</strong> — Phone numbers and message content are shared only with our SMS delivery provider (Twilio) for the sole purpose of delivering the message. No SMS data is sold, rented, or shared with third parties for marketing.</>,
          <><strong>Mobile information</strong> — Mobile opt-in data and consent is never shared with third parties or affiliates for marketing or promotional purposes.</>,
        ]} />
      </LegalSection>

      <LegalSection title="Guest mode">
        <p>
          If you use Braid Boss Pro without an account, your data is stored only on the device you’re using and never reaches our servers. Clearing browser storage or uninstalling will erase it permanently.
        </p>
      </LegalSection>

      <LegalSection title="Children">
        <p>
          Braid Boss Pro is intended for stylists running a business and is not directed at children under 13. Don’t create an account if you’re under 13.
        </p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>
          If we update this policy in any meaningful way, we’ll surface the change in-app before the next time you sign in. Material changes will require fresh consent.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Questions? Contact <a href="mailto:hello@hairwellnessslab.com">hello@hairwellnessslab.com</a>.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
