"use client";

import { LegalShell, LegalSection, LegalList } from "../(legal)/_shell";

export default function TermsPage() {
  return (
    <LegalShell
      title="Terms of Service"
      intro="Plain language. Read it, use the app, focus on your clients."
      updated="May 8, 2026">

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

      <LegalSection title="SMS messaging">
        <p>
          If a client opts in on a stylist&rsquo;s public booking form, Braid Boss Pro sends the following text messages on the stylist&rsquo;s behalf:
        </p>
        <LegalList items={[
          <>Appointment reminders</>,
          <>Booking notifications</>,
          <>Payment reminders</>,
          <>Contract reminders</>,
          <>Review requests</>,
          <>Customer support communications</>,
          <>Promotional messages when users have opted in</>,
        ]} />
        <p>
          <strong>Message frequency.</strong> Message frequency varies based on account activity and bookings.
        </p>
        <p>
          <strong>Pricing.</strong> Message and data rates may apply.
        </p>
        <p>
          <strong>To stop messages.</strong> Reply <strong>STOP</strong> to cancel SMS messages. A confirmation message will be sent after opting out.
        </p>
        <p>
          <strong>For help.</strong> Reply <strong>HELP</strong> for assistance.
        </p>
        <p>
          <strong>Carrier disclaimer.</strong> Mobile carriers are not liable for delayed or undelivered messages.
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
          Questions? Contact <a href="mailto:hello@hairwellnessslab.com">hello@hairwellnessslab.com</a>.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
