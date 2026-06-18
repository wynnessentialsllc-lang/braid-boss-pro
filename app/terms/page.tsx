"use client";

import { LegalShell, LegalSection, LegalList } from "../(legal)/_shell";

export default function TermsPage() {
  return (
    <LegalShell
      title="Terms of Service"
      intro="Plain language. Read it, use the app, focus on your clients."
      updated="June 9, 2026">

      <LegalSection title="Who we are">
        <p>
          Braid Boss Pro is owned and operated by <strong>Wynn Essentials, LLC</strong>. All
          references to “Braid Boss Pro,” “we,” “us,” or “our” in these Terms mean Wynn
          Essentials, LLC. The website at{" "}
          <a href="https://braidbosspro.app">https://braidbosspro.app</a> and the email address{" "}
          <a href="mailto:hello@braidbosspro.app">hello@braidbosspro.app</a> are operated by
          Wynn Essentials, LLC.
        </p>
      </LegalSection>

      <LegalSection title="What Braid Boss Pro is">
        <p>
          Braid Boss Pro is software for independent stylists to organize appointments, clients, photos, quotes, and communication. It is a record-keeping and organization tool — nothing more, nothing less.
        </p>
      </LegalSection>

      <LegalSection title="Your responsibility">
        <LegalList items={[
          <>You are responsible for the <strong>accuracy</strong> of every detail you record — pricing, appointments, client notes, photos, and messages.</>,
          <>You are responsible for getting <strong>client consent</strong> before storing their information, especially photos. Don’t add a client’s photo without permission.</>,
          <>You are responsible for following the laws and regulations that apply to your business in your area — licensing, taxation, employment, and health/safety.</>,
          <>You are responsible for keeping your account credentials safe.</>,
        ]} />
      </LegalSection>

      <LegalSection title="No income guarantees">
        <p>
          Braid Boss Pro shows insights, retention metrics, and analytics computed from your own data. These are organizational tools — not predictions or guarantees. We make no claim, promise, or guarantee about the income or business outcomes you’ll see by using the app.
        </p>
      </LegalSection>

      <LegalSection title="No payment processing inside the app">
        <p>
          Braid Boss Pro does <strong>not</strong> process payments. There is no Stripe, no card collection, no checkout, no invoicing service inside the app. Receipts and invoices are PDFs you generate locally and send to clients yourself; the actual money exchange happens off-app via whatever method you and your client agree on (cash, CashApp, Zelle, etc.). Do not enter payment-card data anywhere in the app.
        </p>
      </LegalSection>

      <LegalSection title="Acceptable use">
        <p>You agree not to use Braid Boss Pro to:</p>
        <LegalList items={[
          <>Send messages, reminders, or content that violate anti-spam laws (TCPA, CAN-SPAM, GDPR e-privacy, etc.) in your jurisdiction.</>,
          <>Store or transmit content that’s harassing, illegal, or violates someone else’s rights.</>,
          <>Attempt to break, scrape, or reverse-engineer the service.</>,
          <>Impersonate another stylist or business.</>,
        ]} />
      </LegalSection>

      <LegalSection title="SMS Messaging Terms">
        <p><strong>Program description.</strong> Braid Boss Pro sends:</p>
        <LegalList items={[
          <>Appointment confirmations</>,
          <>Appointment reminders</>,
          <>Booking updates</>,
          <>Booking approvals</>,
          <>Booking denials</>,
          <>Contract reminders</>,
          <>Payment reminders</>,
          <>Review requests</>,
          <>Customer support messages</>,
          <>Promotional messages when consent has been provided</>,
        ]} />
        <p>
          <strong>Message frequency.</strong> Message frequency varies based on user activity and appointments.
        </p>
        <p>
          <strong>Message and data rates.</strong> Message and data rates may apply.
        </p>
        <p>
          <strong>To stop messages.</strong> You may opt out of SMS communications at any time by replying <strong>STOP</strong>. After opting out, a confirmation message may be sent.
        </p>
        <p>
          <strong>To rejoin.</strong> To rejoin, opt in again through the website or reply <strong>START</strong> where supported.
        </p>
        <p>
          <strong>For help.</strong> Reply <strong>HELP</strong> for assistance. You may also contact support through the website, or at <a href="mailto:hello@braidbosspro.app">hello@braidbosspro.app</a>.
        </p>
        <p>
          <strong>Carrier disclaimer.</strong> Mobile carriers are not liable for delayed or undelivered messages.
        </p>
        <p>
          <strong>Privacy.</strong> Questions regarding privacy practices should be directed to our <a href="/privacy">Privacy Policy</a>.
        </p>
      </LegalSection>

      <LegalSection title="Account deletion">
        <p>
          You can delete your account at any time from Account & Sync → Delete account. Deletion is permanent and cascades through every per-user database row we keep. Local device data needs to be cleared by you (uninstall or clear browser storage).
        </p>
      </LegalSection>

      <LegalSection title="Service availability">
        <p>
          We work hard to keep Braid Boss Pro online and synced, but we can’t guarantee zero downtime. Guest mode and offline mode are designed so the app keeps working on your device even when our backend is unavailable.
        </p>
      </LegalSection>

      <LegalSection title="Disclaimer">
        <p>
          The app is provided “as is” and “as available”. To the maximum extent allowed by law, we disclaim warranties of merchantability, fitness for a particular purpose, and non-infringement. Our total liability for any claim related to the app is limited to the amount you paid for the app in the 12 months preceding the claim — which, for the foreseeable future, is $0.
        </p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>
          We may update these terms. Material changes will be highlighted in-app the next time you sign in.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Questions? Contact <strong>Wynn Essentials, LLC</strong> at{" "}
          <a href="mailto:hello@braidbosspro.app">hello@braidbosspro.app</a>.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
