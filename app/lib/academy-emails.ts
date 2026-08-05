// Shared Academy access-email templates.
//
// One source of truth for the "you now have access" emails sent after a
// paid video purchase or class sign-up. Used by the checkout webhooks
// (fast path), the reconcile sweep (retry), and the owner-facing "Resend
// confirmation" action — so the copy can never drift between them.

export type BuiltEmail = { subject: string; html: string; text: string };

// Human "when" for a class start, in the braider's timezone when set.
export const fmtClassWhen = (startsAt: string | null, tz: string | null): string => {
  if (!startsAt) return "Time TBA — the braider will be in touch.";
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: tz || undefined,
    }).format(new Date(startsAt));
  } catch {
    return new Date(startsAt).toLocaleString();
  }
};

export const buildVideoAccessEmail = (args: {
  videoTitle: string;
  accessToken: string;
  accessModel: string;
  accessExpiresAt: string | null;
  baseUrl: string;
}): BuiltEmail => {
  const watchUrl = `${args.baseUrl.replace(/\/$/, "")}/watch/${encodeURIComponent(args.accessToken)}`;
  const expiryLine =
    args.accessModel === "rent" && args.accessExpiresAt
      ? `<p style="margin:0 0 12px;font-size:13px;color:#6F6477;">Your access is available until ${new Date(
          args.accessExpiresAt,
        ).toLocaleString()}.</p>`
      : `<p style="margin:0 0 12px;font-size:13px;color:#6F6477;">You have permanent access — save this link.</p>`;
  return {
    subject: `Your video access: ${args.videoTitle}`,
    html: `
        <h1 style="font-size:20px;margin:0 0 12px;">Thanks for your purchase! 🎬</h1>
        <p style="margin:0 0 12px;">You now have access to <strong>${args.videoTitle}</strong>.</p>
        <p style="margin:0 0 16px;">
          <a href="${watchUrl}" style="display:inline-block;background:#7C3AED;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;">
            Watch now
          </a>
        </p>
        ${expiryLine}
        <p style="margin:0;font-size:12px;color:#9A8B72;word-break:break-all;">Or paste this link: ${watchUrl}</p>
      `,
    text: `Thanks for your purchase! Watch ${args.videoTitle} here: ${watchUrl}`,
  };
};

export const buildClassAccessEmail = (args: {
  classTitle: string;
  startsAt: string | null;
  timezone: string | null;
  format: string;
  meetingUrl: string | null;
  locationText: string | null;
  seats: number;
}): BuiltEmail => {
  const when = fmtClassWhen(args.startsAt, args.timezone);
  const isVirtual = args.format === "virtual";
  const accessLine = isVirtual
    ? args.meetingUrl
      ? `<p style="margin:0 0 6px;"><strong>Join link:</strong> <a href="${args.meetingUrl}">${args.meetingUrl}</a></p>`
      : `<p style="margin:0 0 6px;">Your join link will be sent before the class.</p>`
    : args.locationText
      ? `<p style="margin:0 0 6px;"><strong>Location:</strong> ${args.locationText}</p>`
      : `<p style="margin:0 0 6px;">Location details will follow from your braider.</p>`;
  const seatLine =
    Number(args.seats) > 1 ? `<p style="margin:0 0 6px;"><strong>Seats:</strong> ${args.seats}</p>` : "";
  return {
    subject: `You're signed up: ${args.classTitle}`,
    html: `
        <h1 style="font-size:20px;margin:0 0 12px;">You're in! 🎉</h1>
        <p style="margin:0 0 12px;">Your spot in <strong>${args.classTitle}</strong> is confirmed.</p>
        <p style="margin:0 0 6px;"><strong>When:</strong> ${when}</p>
        ${seatLine}
        ${accessLine}
        <p style="margin:16px 0 0;font-size:13px;color:#6F6477;">See you there!</p>
      `,
    text: `You're signed up for ${args.classTitle}. When: ${when}. ${
      isVirtual ? `Join: ${args.meetingUrl || "link to follow"}` : `Location: ${args.locationText || "details to follow"}`
    }`,
  };
};
