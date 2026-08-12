// Render every email fixture to disk for review and screenshots.
//
//   node scripts/render-email-previews.mjs [outDir]
//
// Default outDir is .email-previews (gitignored). Writes one .html and
// one .txt per fixture plus an index.html. Sends nothing, reads no
// account, calls no API. Safe to run any time.

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { FIXTURES } from "../supabase/functions/_shared/email-fixtures.ts";

const outDir = resolve(process.cwd(), process.argv[2] || ".email-previews");

const escape = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

await mkdir(outDir, { recursive: true });

const rows = [];
for (const fixture of FIXTURES) {
  const rendered = fixture.render();
  await writeFile(resolve(outDir, `${fixture.id}.html`), rendered.html, "utf8");
  await writeFile(resolve(outDir, `${fixture.id}.txt`), rendered.text, "utf8");
  rows.push({ fixture, rendered });
  console.log(
    `${fixture.id.padEnd(24)} ${String(rendered.html.length).padStart(6)} bytes html  ` +
      `${String(rendered.text.length).padStart(5)} bytes text  ${rendered.subject}`,
  );
}

const index = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>Braid Boss Pro email previews</title>
<style>
 body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#F1ECF9;margin:0;padding:32px;color:#15111A}
 h1{font-family:Georgia,serif}
 table{border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;width:100%;max-width:1000px}
 td,th{padding:10px 14px;border-bottom:1px solid #ECE7F2;font-size:14px;text-align:left;vertical-align:top}
 a{color:#7C3AED;font-weight:700;text-decoration:none}
</style></head><body>
<h1>Braid Boss Pro email previews</h1>
<table><tr><th>Group</th><th>Fixture</th><th>Subject</th><th></th></tr>
${rows
  .map(
    ({ fixture, rendered }) => `<tr>
  <td>${escape(fixture.group)}</td>
  <td>${escape(fixture.label)}</td>
  <td>${escape(rendered.subject)}</td>
  <td><a href="./${fixture.id}.html">HTML</a> &middot; <a href="./${fixture.id}.txt">Text</a></td>
</tr>`,
  )
  .join("\n")}
</table></body></html>`;

await writeFile(resolve(outDir, "index.html"), index, "utf8");
console.log(`\n${FIXTURES.length} fixtures written to ${outDir}`);
