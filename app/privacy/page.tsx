"use client";

import { LegalShell, LegalSection, LegalList } from "../(legal)/_shell";

export default function PrivacyPage() {
  return (
    <LegalShell
      title="Privacy Policy"
      intro="Braid Boss Pro is a tool for independent braiders to organize their business. We treat your data like it’s ours — minimal, scoped to you, and never sold."
      updated="June 16, 2026">

      <LegalSection title="Information We Collect">
        <p>We collect only what we need to run Braid Boss Pro for you and your clients:</p>
        <LegalList items={[
          <><strong>Name</strong> — your name and the names of clients you record.</>,
          <><strong>Email</strong> — your account email and any client email addresses you save.</>,
          <><strong>Phone number</strong> — your clients’ mobile numbers, used for booking and, with consent, SMS.</>,
          <><strong>Appointment information</strong> — services, dates, times, pricing, payment status, notes, contracts, and photos you attach.</>,
          <><strong>Device information</strong> — browser type, user-agent string, and device identifiers needed to run the app.</>,
          <><strong>Usage information</strong> — first-party, in-app product events (e.g. which screens are used), page paths, and a randomly-generated analytics ID stored on your device. We do not use third-party analytics or advertising products.</>,
        ]} />
      </LegalSection>

      <LegalSection title="How Information Is Collected">
        <LegalList items={[
          <><strong>Booking forms</strong> — when a client submits a public booking request.</>,
          <><strong>Account registration</strong> — when a stylist creates a Braid Boss Pro account.</>,
          <><strong>SMS opt-in forms</strong> — when a client checks the SMS consent box on a booking form.</>,
          <><strong>Customer support requests</strong> — when you contact us for help.</>,
          <><strong>Website interactions</strong> — first-party usage analytics as you use the app.</>,
        ]} />
      </LegalSection>

      <LegalSection title="How Information Is Used">
        <p>We use the information above to provide and operate the service, including to send:</p>
        <LegalList items={[
          <>Appointment reminders</>,
          <>Appointment confirmations</>,
          <>Booking approvals</>,
          <>Booking denials</>,
          <>Contract reminders</>,
          <>Balance reminders</>,
          <>Review requests</>,
          <>Customer support</>,
          <>Marketing communications (only when separately consented)</>,
        ]} />
      </LegalSection>

      <LegalSection title="SMS Communications">
        <p>
          No mobile information will be shared with third parties or affiliates for marketing or promotional purposes.
        </p>
        <p>
          Text messaging originator opt-in data and consent will not be shared, sold, rented, or transferred to any third parties under any circumstances.
        </p>
        <p>
          Information sharing with subcontractors or service providers is permitted solely for the purpose of delivering SMS communications and operating the platform. These providers are bound by confidentiality obligations.
        </p>
      </LegalSection>

      <LegalSection title="SMS Opt-In Information">
        <LegalList items={[
          <><strong>How consent is obtained</strong> — Clients opt in by checking an SMS consent box on the stylist’s public booking form before submitting a booking. The box is unchecked by default, is never pre-checked or bundled with any other agreement, and consent is stored with a timestamp.</>,
          <><strong>What messages are sent</strong> — appointment confirmations, appointment reminders, booking updates, balance reminders, contract reminders, review requests, and (only with separate consent) occasional promotional offers.</>,
          <><strong>Frequency</strong> — message frequency varies based on your appointment activity.</>,
          <><strong>Opt out</strong> — reply <strong>STOP</strong> at any time to stop messages; a confirmation is sent.</>,
          <><strong>Help</strong> — reply <strong>HELP</strong> for assistance.</>,
          <><strong>Rates</strong> — message and data rates may apply.</>,
        ]} />
      </LegalSection>

      <LegalSection title="Data Security">
        <LegalList items={[
          <><strong>Encryption</strong> — data is transmitted over HTTPS and stored in an encrypted, managed Postgres database.</>,
          <><strong>Secure storage</strong> — photos and records live in private storage with per-user row-level security, so your account can only ever read or write rows you own.</>,
          <><strong>Limited employee access</strong> — access to user data is restricted to authorized personnel on a need-to-know basis.</>,
          <><strong>Industry-standard safeguards</strong> — we follow industry-standard practices to protect against unauthorized access, alteration, or disclosure.</>,
        ]} />
      </LegalSection>

      <LegalSection title="Cookies & Tracking">
        <LegalList items={[
          <><strong>Analytics</strong> — first-party only. We record basic in-app product events and do <strong>not</strong> use Google Analytics, advertising pixels, or cross-site tracking.</>,
          <><strong>Session cookies</strong> — used to keep you signed in and maintain your session.</>,
          <><strong>Site functionality</strong> — local storage on your device holds your sign-in session, an offline copy of your own data, and a first-party analytics ID needed for the app to work. Stripe may set its own cookies on its checkout pages.</>,
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
          is governed by <a href="https://stripe.com/privacy">Stripe’s Privacy Policy</a>.
        </p>
      </LegalSection>

      <LegalSection title="Your control">
        <LegalList items={[
          <><strong>Export</strong> — Account &amp; Sync → Export all data (JSON). One tap, downloads everything we have for you.</>,
          <><strong>Deletion</strong> — Account &amp; Sync → Delete account. We delete your auth record and cascade-delete every per-user row in the database. Local-only data on the device is not cleared automatically; uninstall or clear browser storage to remove that.</>,
          <><strong>Notifications</strong> — Toggle off any time in Account &amp; Sync, or revoke at the OS / browser level.</>,
          <><strong>Public booking link</strong> — Pause or revoke any time. Revoked links return a 404 immediately.</>,
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
          Questions? Contact <a href="mailto:support@braidbosspro.app">support@braidbosspro.app</a> or <a href="mailto:hello@hairwellnessslab.com">hello@hairwellnessslab.com</a>.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
