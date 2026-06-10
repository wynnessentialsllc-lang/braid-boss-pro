import type { NextRequest } from "next/server";

// Serves a calendar event as `text/calendar` so iOS Safari / the in-app
// SFSafariViewController shows the native "Add to Calendar" prompt.
//
// Why this exists: inside the iOS app the calendar body is a client-side
// string. Handing it to the OS as a Blob (the old path) only opens the
// generic share sheet (AirDrop / Messages / Save to Files) — never the
// calendar. Opening this URL in the in-app browser instead lets iOS
// recognise the response as a calendar event and offer to add it.
//
// The VCALENDAR is passed base64url-encoded in `?data`; `?name` sets the
// download filename. The handler only reflects the body back with the
// right headers — no HTML is rendered, so there's no injection surface.

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const data = params.get("data") || "";
  const name = (params.get("name") || "event")
    .replace(/[^a-z0-9_\-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "event";

  if (!data) return new Response("Missing calendar data", { status: 400 });

  let ics: string;
  try {
    ics = Buffer.from(data, "base64url").toString("utf-8");
  } catch {
    return new Response("Malformed calendar data", { status: 400 });
  }

  // Sanity-check it's actually a calendar and bound the size.
  if (ics.length > 100_000 || !ics.includes("BEGIN:VCALENDAR")) {
    return new Response("Invalid calendar", { status: 400 });
  }

  return new Response(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8; method=PUBLISH",
      "Content-Disposition": `inline; filename="${name}.ics"`,
      "Cache-Control": "no-store",
    },
  });
}
