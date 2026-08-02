"use client";

import { useState } from "react";
import { LegalShell, LegalSection, LEGAL_TOKENS as C } from "../(legal)/_shell";

const FONT_DISPLAY = `"Cormorant Garamond", Georgia, serif`;

const SUPPORT_EMAIL = "hello@braidbosspro.app";

const composeMail = (subject: string, body: string) =>
  `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

const FAQ: { q: string; a: string }[] = [
  {
    q: "Can I use Braid Boss Pro without creating an account?",
    a: "Yes. Guest mode keeps everything on your device. Create an account later if you want sync, cloud backup, or multi-device access — your local data will migrate up the first time you sign in.",
  },
  {
    q: "Why don’t I see push notifications on my iPhone?",
    a: "Browser-based push isn’t supported by every iOS Safari version, and it’s never as reliable as native iOS push. Once we ship the App Store build, you’ll get true iOS push without re-subscribing — your existing setup carries over.",
  },
  {
    q: "Where are my photos stored?",
    a: "If you’re signed in, photos live in a private storage bucket that only your account can read or write. Each photo is also kept locally as a fast cache. Guest mode keeps photos only on the device.",
  },
  {
    q: "How do I export my data?",
    a: "Account & Sync → Export all data (JSON). Downloads everything we have for you in one file.",
  },
  {
    q: "Can I delete my account?",
    a: "Yes. Account & Sync → Delete account. Type 'delete' to confirm; your auth record and per-user database rows are removed permanently. Local-only device data needs to be cleared manually (uninstall or clear browser storage).",
  },
  {
    q: "Does Braid Boss Pro process payments?",
    a: "Yes — through Stripe Connect. You connect your own Stripe account, and card deposits, balance payments, and storefront checkout are paid directly into it (same-day payouts on Stripe's schedule). Braid Boss Pro never custodies your funds or takes a cut of your services; Stripe's standard processing fee (~2.9% + 30¢) applies. Prefer cash, CashApp, or Zelle? You can skip Stripe entirely and just log those payments in the ledger — deposits and card payments are optional, not required.",
  },
];

export default function SupportPage() {
  const [open, setOpen] = useState<Record<number, boolean>>({});

  return (
    <LegalShell
      title="Support"
      intro="We answer email. No bots, no tickets in a queue forever — just a person who reads your message.">

      <LegalSection title="Email us">
        <p>
          The fastest way to reach support is by email at{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
          Include screenshots if you have them — they cut our response time in half.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
          <SupportTile
            label="Report a problem"
            sub="Crashes, weird UI, anything broken"
            href={composeMail(
              "[Bug] Braid Boss Pro",
              "What happened:\n\nWhat I expected:\n\nDevice / browser:\n\n",
            )}
          />
          <SupportTile
            label="Account or sync help"
            sub="Sign-in, lost data, sync stuck"
            href={composeMail(
              "[Account] Braid Boss Pro",
              "Account email:\n\nWhat's happening:\n\nLast time it worked:\n\n",
            )}
          />
          <SupportTile
            label="Delete account help"
            sub="If the in-app delete won’t go through"
            href={composeMail(
              "[Delete] Braid Boss Pro",
              "Account email:\n\nReason for deletion (optional):\n\n",
            )}
          />
        </div>
      </LegalSection>

      <LegalSection title="Frequently asked">
        <div className="space-y-2">
          {FAQ.map((item, i) => {
            const isOpen = !!open[i];
            return (
              <details
                key={i}
                open={isOpen}
                onToggle={(e) => setOpen(prev => ({ ...prev, [i]: (e.target as HTMLDetailsElement).open }))}
                style={{
                  borderRadius: 12,
                  border: `1px solid ${C.hairline}`,
                  background: C.paper,
                  padding: "12px 14px",
                }}>
                <summary
                  style={{
                    cursor: "pointer",
                    listStyle: "none",
                    fontWeight: 600,
                    color: C.espresso,
                    fontSize: 14,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                  }}>
                  <span>{item.q}</span>
                  <span aria-hidden style={{ color: C.muted, fontSize: 16 }}>
                    {isOpen ? "−" : "+"}
                  </span>
                </summary>
                <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.55 }}>{item.a}</p>
              </details>
            );
          })}
        </div>
      </LegalSection>

      <LegalSection title="Service status">
        <p>
          If something is unresponsive or sync looks stuck, check that you have a working connection first. The app keeps running offline — your changes save locally and upload as soon as you’re back on. If it persists, email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> with the time and what you were doing.
        </p>
      </LegalSection>

      <LegalSection title="Legal & privacy">
        <p>
          Looking for our policies? See the <a href="/privacy">Privacy Policy</a> and{" "}
          <a href="/terms">Terms of Service</a>.
        </p>
      </LegalSection>
    </LegalShell>
  );
}

const SupportTile = ({ label, sub, href }: { label: string; sub: string; href: string }) => (
  <a
    href={href}
    style={{
      display: "block",
      padding: 14,
      borderRadius: 14,
      background: C.paper,
      border: `1px solid ${C.hairline}`,
      color: C.espresso,
      textDecoration: "none",
    }}>
    <p style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 600 }}>{label}</p>
    <p style={{ marginTop: 4, fontSize: 12, color: C.muted }}>{sub}</p>
  </a>
);
