"use client";

import { LegalShell, LegalSection, LegalList } from "../(legal)/_shell";

export default function PrivacyPage() {
  return (
    <LegalShell
      title="Privacy Policy"
      intro="Braid Boss Pro is a tool for independent braiders to organize their business. We treat your data like it’s ours — minimal, scoped to you, and never sold."
      updated="June 7, 2026">

      <LegalSection title="What we collect">
        <p>The data Braid Boss Pro stores is the data you put in. Specifically:</p>
        <LegalList items={[
          <><strong>Account data</strong> — email and a hashed password (handled by our auth provider, Supabase). We never see your plaintext password.</>,
          <><strong>Client data</strong> — names, phone, email, preferred styles, allergies, and notes that you record about your clients.</>,
          <><strong>Appointments</strong> — date, time, service, pricing, payment status, and notes.</>,
          <><strong>Photos</strong> — inspiration, before-and-after, and reference images you attach to client profiles. Stored privately in our secure storage bucket; only you can read them.</>,
          <><strong>Notifications</strong> — a record of subscriptions for browser or device push, plus the dismissed/read state of in-app alerts.</>,
          <><strong>Usage analytics</strong> — first-party only. We record basic in-app product events (e.g. which screens are used), a randomly-generated analytics ID kept in your device’s local storage, the page path, and your browser’s user-agent, in our own backend. We do <strong>not</strong> use Google Analytics, advertising pixels, or any third-party analytics product, and we do not store your IP address for analytics.</>,
          <><strong>Public booking links</strong> — the slug you generate, plus any incoming requests submitted to it. Anyone with the slug can submit a request; only you can read the inbox.</>,
        ]} />
      </LegalSection>

      <LegalSection title="What we don’t do">
        <LegalList items={[
          <>We do <strong>not</strong> sell, rent, or share your data with advertisers or data brokers.</>,
          <>We do <strong>not</strong> use advertising or cross-site tracking cookies.</>,
          <>We do <strong>not</strong> read your photos, notes, or client lists for any purpose other than displaying them back to you.</>,
        ]} />
      </LegalSection>

      <LegalSection title="Payments">
        <p>
          Braid Boss Pro uses <strong>Stripe</strong> to process payments — client deposits and balance
          payments you collect through the app, and your own Braid Boss Pro subscription. Card details
          are entered directly with Stripe and are <strong>never seen or stored</strong> by Braid Boss
          Pro; we store only the payment metadata we need to show your transactions, issue refunds, and
          reconcile payouts (amounts, status, and Stripe reference IDs). Stripe is an independent,
          PCI-DSS-certified payment processor, and its handling of your and your clients’ payment data
          is governed by <a href="https://stripe.com/privacy">Stripe’s Privacy Policy</a>. Payments you
          also take off-app (cash, CashApp, Zelle, etc.) are recorded by you for your own bookkeeping.
        </p>
      </LegalSection>

      <LegalSection title="Cookies & local storage">
        <p>
          Braid Boss Pro does <strong>not</strong> set advertising or cross-site tracking cookies. To
          function, the app stores data in your browser’s <strong>local storage</strong> on your device:
          your sign-in session, your offline copy of your own data, and a randomly-generated first-party
          analytics ID. These stay on your device and are never shared with advertisers. Stripe may set
          its own cookies on its checkout pages when a payment is made; those are governed by Stripe.
          Because we use only first-party, essential storage and analytics, the app doesn’t show a
          separate cookie-consent pop-up — this policy is the disclosure. If we ever add third-party
          tracking, we’ll ask for your consent first.
        </p>
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

      <LegalSection title="SMS Messaging">
        <p>
          When a client opts in on a stylist&rsquo;s public booking form, Braid Boss Pro sends text messages on the stylist&rsquo;s behalf. In connection with this SMS program, Braid Boss Pro may collect:
        </p>
        <LegalList items={[
          <>Name</>,
          <>Email address</>,
          <>Mobile phone number</>,
        ]} />
        <p>We use this information to send:</p>
        <LegalList items={[
          <>Appointment confirmations</>,
          <>Appointment reminders</>,
          <>Booking approvals</>,
          <>Booking denials</>,
          <>Payment reminders</>,
          <>Contract reminders</>,
          <>Review requests</>,
          <>Promotional offers (when consent is provided)</>,
        ]} />
        <p>
          <strong>No mobile information will be shared with third parties or affiliates for marketing or promotional purposes.</strong>
        </p>
        <p>
          <strong>Text messaging originator opt-in data and consent will not be shared, sold, rented, or transferred to any third parties under any circumstances.</strong>
        </p>
        <p>
          Information may be shared with service providers solely for the purpose of delivering text messaging services and operating the platform.
        </p>
      </LegalSection>

      <LegalSection title="SMS opt-out &amp; help">
        <p>
          Users may opt out at any time by replying <strong>STOP</strong>. Users may request assistance by replying <strong>HELP</strong>.
        </p>
      </LegalSection>

      <LegalSection title="SMS message frequency &amp; rates">
        <p>
          Message frequency varies. Message and data rates may apply.
        </p>
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
