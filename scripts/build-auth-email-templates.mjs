// Generate the Supabase Auth dashboard email templates.
//
//   node scripts/build-auth-email-templates.mjs
//
// Supabase Auth sends the confirm-signup, password-reset, and
// email-change messages itself: the HTML lives in the dashboard, not in
// this repo, and the secure link is interpolated by Supabase at send
// time as {{ .ConfirmationURL }}. So the templates cannot be "deployed"
// from code. What we CAN do is generate them from the same design kit
// the rest of the emails use, commit the output, and paste it in once.
//
// Writes to docs/email-templates/. Re-run after any change to
// supabase/functions/_shared/ so the pasted templates never drift from
// the in-app ones.
//
// IMPORTANT: the expiry strings below are copy, not configuration.
// Check them against Dashboard → Authentication → Emails (and the OTP
// expiry setting) before pasting, and update here if they differ.

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  renderEmailChange,
  renderPasswordReset,
  renderVerifyEmail,
} from "../supabase/functions/_shared/lifecycle-emails.ts";

/** Supabase interpolates this at send time. Never a real token here. */
const CONFIRMATION_URL = "{{ .ConfirmationURL }}";

const TEMPLATES = [
  {
    file: "supabase-confirm-signup.html",
    dashboard: "Authentication → Emails → Templates → Confirm signup",
    expiresIn: "24 hours",
    render: () =>
      renderVerifyEmail({ confirmationUrl: CONFIRMATION_URL, expiresIn: "24 hours" }),
  },
  {
    file: "supabase-reset-password.html",
    dashboard: "Authentication → Emails → Templates → Reset password",
    expiresIn: "1 hour",
    render: () =>
      renderPasswordReset({ confirmationUrl: CONFIRMATION_URL, expiresIn: "1 hour" }),
  },
  {
    file: "supabase-email-change.html",
    dashboard: "Authentication → Emails → Templates → Change email address",
    expiresIn: "24 hours",
    render: () =>
      renderEmailChange({ confirmationUrl: CONFIRMATION_URL, expiresIn: "24 hours" }),
  },
];

const outDir = resolve(process.cwd(), "docs/email-templates");
await mkdir(outDir, { recursive: true });

for (const t of TEMPLATES) {
  const rendered = t.render();
  const banner = `<!--
  Braid Boss Pro — generated file. Do not edit by hand.

  Source:   supabase/functions/_shared/lifecycle-emails.ts
  Rebuild:  node scripts/build-auth-email-templates.mjs
  Paste to: ${t.dashboard}

  Subject:      ${rendered.subject}
  Preview text: ${rendered.preheader}

  {{ .ConfirmationURL }} is filled in by Supabase at send time. Do not
  wrap it in a click tracker: that would route an authentication token
  through a third party.

  The body states that the link expires in ${t.expiresIn}. Confirm that
  matches the project's actual Auth expiry setting before pasting.
-->
`;
  await writeFile(resolve(outDir, t.file), banner + rendered.html, "utf8");
  // The plain-text part sits beside it for reference. Supabase's
  // dashboard templates are HTML only, so this is documentation rather
  // than something to paste.
  await writeFile(
    resolve(outDir, t.file.replace(/\.html$/, ".txt")),
    rendered.text,
    "utf8",
  );
  console.log(`wrote ${t.file}  (${rendered.html.length} bytes)  subject: ${rendered.subject}`);
}

console.log(`\n${TEMPLATES.length} templates written to docs/email-templates`);
