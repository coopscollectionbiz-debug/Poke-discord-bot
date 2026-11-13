#!/usr/bin/env node
// tools/economy-audit/build-html.mjs
// Builds docs/audits/economy-2026-11/REPORT.html from REPORT.md. No
// dependencies: handles the Markdown the report uses (headings, paragraphs,
// lists, tables, fenced code, bold, inline code, links).

import fs from "node:fs";

const dir = new URL("../../docs/audits/economy-2026-11/", import.meta.url);
const md = fs.readFileSync(new URL("REPORT.md", dir), "utf8").replace(/\r\n/g, "\n");

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const lines = md.split("\n");
const out = [];
const toc = [];
let i = 0;
while (i < lines.length) {
  const line = lines[i];
  if (line.startsWith("```")) {
    const buf = [];
    i++;
    while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
    i++;
    out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
    continue;
  }
  const h = /^(#{1,3}) (.*)$/.exec(line);
  if (h) {
    const level = h[1].length, text = h[2], id = slug(text);
    if (level <= 2) toc.push({ level, text, id });
    out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
    i++;
    continue;
  }
  if (line.startsWith("|")) {
    const rows = [];
    while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++]);
    const cells = (r) => r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    const head = cells(rows[0]);
    const body = rows.slice(2).map(cells);
    out.push(`<div class="table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
    continue;
  }
  if (/^(\d+\.|-) /.test(line)) {
    const ordered = /^\d+\./.test(line);
    const items = [];
    while (i < lines.length && /^(\d+\.|-) /.test(lines[i])) items.push(lines[i++].replace(/^(\d+\.|-) /, ""));
    const tag = ordered ? "ol" : "ul";
    out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</${tag}>`);
    continue;
  }
  if (!line.trim()) { i++; continue; }
  const buf = [];
  while (i < lines.length && lines[i].trim() && !/^(#|\||```|- |\d+\. )/.test(lines[i])) buf.push(lines[i++]);
  out.push(`<p>${inline(buf.join(" "))}</p>`);
}

const title = "Economy audit, November 2026";
const nav = toc.map((t) => `<a class="l${t.level}" href="#${t.id}">${esc(t.text)}</a>`).join("");
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
:root { --bg: #fbfaf7; --fg: #1d1d1b; --muted: #66645e; --line: #e2dfd6; --head: #f1eee6; --accent: #b4441f; --code: #f3f1ea; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #161614; --fg: #ecebe6; --muted: #a3a199; --line: #34332e; --head: #22211e; --accent: #f0875f; --code: #24231f; } }
:root[data-theme="dark"] { --bg: #161614; --fg: #ecebe6; --muted: #a3a199; --line: #34332e; --head: #22211e; --accent: #f0875f; --code: #24231f; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
.wrap { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 40px; max-width: 1280px; margin: 0 auto; padding: 32px 24px; }
nav { position: sticky; top: 24px; align-self: start; max-height: calc(100vh - 48px); overflow: auto; font-size: 14px; }
nav a { display: block; color: var(--muted); text-decoration: none; padding: 3px 0; }
nav a.l1 { color: var(--fg); font-weight: 600; margin-top: 10px; }
nav a.l2 { padding-left: 12px; }
nav a:hover { color: var(--accent); }
main { min-width: 0; }
h1 { font-size: 30px; line-height: 1.2; margin: 40px 0 12px; }
h1:first-child { margin-top: 0; }
h2 { font-size: 22px; margin: 36px 0 10px; padding-top: 8px; border-top: 1px solid var(--line); }
h3 { font-size: 18px; margin: 24px 0 8px; }
p, li { max-width: 78ch; }
a { color: var(--accent); }
code { font: 13px/1.4 ui-monospace, "Cascadia Code", Consolas, monospace; background: var(--code); padding: 1px 4px; border-radius: 4px; }
pre { background: var(--code); padding: 12px 14px; border-radius: 8px; overflow-x: auto; }
pre code { background: none; padding: 0; }
.table { overflow-x: auto; margin: 12px 0 20px; border: 1px solid var(--line); border-radius: 8px; }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th, td { text-align: left; vertical-align: top; padding: 8px 10px; border-bottom: 1px solid var(--line); }
th { background: var(--head); font-weight: 600; white-space: nowrap; }
tr:last-child td { border-bottom: 0; }
@media (max-width: 860px) { .wrap { grid-template-columns: 1fr; padding: 20px 16px; } nav { position: static; max-height: none; border-bottom: 1px solid var(--line); padding-bottom: 12px; } }
</style>
</head>
<body>
<div class="wrap">
<nav aria-label="Contents">${nav}</nav>
<main>
${out.join("\n")}
</main>
</div>
</body>
</html>
`;
fs.writeFileSync(new URL("REPORT.html", dir), html);
console.log(`REPORT.html: ${out.length} blocks, ${toc.length} contents entries`);
