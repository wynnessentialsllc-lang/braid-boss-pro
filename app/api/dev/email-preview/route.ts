// Local email preview. Development only.
//
//   GET /api/dev/email-preview              → index of every fixture
//   GET /api/dev/email-preview?id=<id>      → that email's HTML
//   GET /api/dev/email-preview?id=<id>&format=text  → its text/plain part
//
// This route renders the exact same template functions the notification
// worker sends, so what you see here is what lands in the inbox. It
// NEVER sends mail, never touches Stripe, never reads a real user, and
// never needs an account: everything comes from the fixtures in
// supabase/functions/_shared/email-fixtures.ts.
//
// It 404s in production. There is no auth on it because there is
// nothing behind it, but it still should not exist on the public site.

import { NextResponse } from "next/server";
import { FIXTURES, fixtureById } from "../../../../supabase/functions/_shared/email-fixtures.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const notFound = () =>
  new NextResponse("Not found", { status: 404, headers: { "content-type": "text/plain" } });

const escape = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production") return notFound();

  const url = new URL(req.url);
  const id = (url.searchParams.get("id") || "").trim();
  const format = (url.searchParams.get("format") || "html").trim();

  if (!id) return new NextResponse(indexPage(), { headers: htmlHeaders() });

  const fixture = fixtureById(id);
  if (!fixture) return notFound();

  const rendered = fixture.render();

  if (format === "text") {
    return new NextResponse(rendered.text, {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  if (format === "json") {
    return NextResponse.json({
      id: fixture.id,
      subject: rendered.subject,
      preheader: rendered.preheader,
      textLength: rendered.text.length,
      htmlLength: rendered.html.length,
    });
  }
  return new NextResponse(rendered.html, { headers: htmlHeaders() });
}

const htmlHeaders = () => ({
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
});

/**
 * Index. Groups fixtures by the email they belong to and offers the
 * three viewport widths the templates are checked at.
 */
const indexPage = (): string => {
  const groups = new Map<string, typeof FIXTURES>();
  for (const f of FIXTURES) {
    const list = groups.get(f.group) || [];
    list.push(f);
    groups.set(f.group, list);
  }

  const sections = Array.from(groups.entries())
    .map(
      ([group, items]) => `
      <section>
        <h2>${escape(group)}</h2>
        ${items
          .map((f) => {
            const r = f.render();
            return `<article>
              <h3>${escape(f.label)}</h3>
              <p class="subject"><strong>Subject:</strong> ${escape(r.subject)}</p>
              <p class="subject"><strong>Preview text:</strong> ${escape(r.preheader)}</p>
              <p class="note">${escape(f.note)}</p>
              <p class="links">
                <a href="?id=${encodeURIComponent(f.id)}">Open</a>
                <a href="?id=${encodeURIComponent(f.id)}&amp;format=text">Plain text</a>
              </p>
              <div class="frames">
                ${[320, 375, 640]
                  .map(
                    (w) => `<div class="frame">
                      <span>${w}px</span>
                      <iframe src="?id=${encodeURIComponent(f.id)}" width="${w}" height="640" loading="lazy" title="${escape(
                        f.label,
                      )} at ${w} pixels"></iframe>
                    </div>`,
                  )
                  .join("")}
              </div>
            </article>`;
          })
          .join("")}
      </section>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Braid Boss Pro email preview</title>
<style>
  body { margin:0; background:#F1ECF9; color:#15111A; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
  .wrap { max-width:1200px; margin:0 auto; padding:32px 20px 80px; }
  h1 { font-family:Georgia,serif; font-size:34px; margin:0 0 6px; }
  .lead { color:#3D3447; margin:0 0 28px; max-width:70ch; line-height:1.6; }
  h2 { font-size:15px; letter-spacing:.14em; text-transform:uppercase; color:#5B21B6; margin:36px 0 12px; }
  article { background:#fff; border:1px solid #ECE7F2; border-radius:14px; padding:18px; margin:0 0 16px; }
  h3 { margin:0 0 8px; font-size:17px; }
  .subject { margin:0 0 4px; font-size:13px; color:#3D3447; }
  .note { margin:8px 0 10px; font-size:13px; color:#6F6477; line-height:1.5; }
  .links a { display:inline-block; margin-right:12px; font-size:13px; font-weight:700; color:#7C3AED; }
  .frames { display:flex; gap:14px; flex-wrap:wrap; margin-top:12px; }
  .frame span { display:block; font-size:11px; letter-spacing:.1em; text-transform:uppercase; color:#6F6477; margin-bottom:4px; }
  iframe { border:1px solid #ECE7F2; border-radius:8px; background:#fff; }
</style></head>
<body><div class="wrap">
  <h1>Braid Boss Pro email preview</h1>
  <p class="lead">Every fixture renders through the same template functions the notification worker sends. Nothing here sends mail, reads a real account, or calls Stripe. Each email is shown at 320, 375, and 640 pixels wide.</p>
  ${sections}
</div></body></html>`;
};
